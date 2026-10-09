// "Continue with ChatGPT": a person signs in with their own ChatGPT account and lets Songbe use their ChatGPT plan for what it
// writes (series, scripts), instead of an API key. This follows OpenAI's published contract for apps that run on the person's
// computer — developers.openai.com/siwc, "ChatGPT plan usage" — and nothing else: OpenID Connect with PKCE, a loopback callback
// on 127.0.0.1, a client id that OpenAI issues to this installation at the first sign-in, tokens kept in a file only this user
// can read, and requests to the Responses API with the person's own token. The plan covers text; pictures, clips and voices are
// not part of it.
//
// OpenAI offers plan usage to open-source projects and to apps a person runs for themselves; a paid app has to be accepted by
// OpenAI first (openai.com/form/sign-in-with-chatgpt-interest). Until Songbe is, this must not be advertised to buyers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dataDir, mkdir } from '../util.mjs';

const RESOURCE = 'https://api.openai.com/v1';      // what the grant is for, whichever host answers
const AUTH = () => process.env.SONGBE_OPENAI_AUTH || 'https://auth.openai.com', API = () => process.env.SONGBE_OPENAI_API || RESOURCE;      // (a test points these at a stand-in)
export const MANAGE = 'https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites';      // where a person reads how to manage an app's share of their plan
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', PLAN = 'chatgpt.tokens.use.direct', NAME = 'Songbe';
const b64 = (b) => Buffer.from(b).toString('base64url'), form = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null))).toString();

// ---- what is kept: { host, registration: { client_id, email, subject }, account: { …tokens } } ----
const file = () => path.join(dataDir(), 'accounts', 'chatgpt.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
function write(x) {      // whole, then renamed into place; readable by this user only
  const f = file(), part = f + '.part'; mkdir(path.dirname(f));
  fs.writeFileSync(part, JSON.stringify(x, null, 1), { mode: 0o600 }); try { fs.chmodSync(part, 0o600); } catch {} fs.renameSync(part, f);
}
export const signedIn = () => !!read().account?.refresh_token;
// who is signed in, for a page: never a token
export const account = () => { const s = read(), a = s.account; return a ? { email: a.email, since: a.saved_at, model: s.model || null } : null; };

async function post(url, body, what) {
  let r; try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body), signal: AbortSignal.timeout(30000) }); } catch (e) { throw new Error(`OpenAI could not be reached (${what}): ${e.message}`); }
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) throw Object.assign(new Error(`OpenAI refused (${what}): ${j?.error_description || j?.error?.message || j?.error || text.slice(0, 200) || r.status}`), { code: typeof j?.error === 'string' ? j.error : j?.error?.code, status: r.status });
  return j ?? {};
}
const known = new Map();
const discover = async (auth) => { if (!known.has(auth)) { const r = await fetch(`${auth}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('OpenAI did not say how its sign-in is checked'); known.set(auth, await r.json()); } return known.get(auth); };
// The ID token is who signed in. It is believed only when OpenAI's published key signed it, it was issued to this client, it has
// not run out, and it answers this very sign-in (the nonce).
async function identity(idToken, { auth, client, nonce }) {
  const [h, p, s] = String(idToken || '').split('.'); if (!s) throw new Error('OpenAI sent no identity');
  const head = JSON.parse(Buffer.from(h, 'base64url')), claims = JSON.parse(Buffer.from(p, 'base64url')), conf = await discover(auth);
  const keys = (await (await fetch(conf.jwks_uri, { signal: AbortSignal.timeout(20000) })).json()).keys || [], jwk = keys.find((k) => k.kid === head.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) throw new Error('the identity OpenAI sent is signed with a key it does not publish');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' }), data = Buffer.from(`${h}.${p}`), sig = Buffer.from(s, 'base64url');
  const good = head.alg === 'RS256' ? crypto.verify('RSA-SHA256', data, key, sig) : head.alg === 'ES256' ? crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig) : false;
  if (!good) throw new Error('the identity OpenAI sent does not carry its signature');
  if (claims.iss !== (conf.issuer || auth)) throw new Error('the identity was not issued by OpenAI');
  if (![].concat(claims.aud).includes(client)) throw new Error('the identity was issued to another app');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('the identity has already run out');
  if (nonce && claims.nonce !== nonce) throw new Error('the identity answers another sign-in');
  return claims;
}
const kept = (t, was = {}) => ({ ...was, access_token: t.access_token, refresh_token: t.refresh_token || was.refresh_token, id_token: t.id_token || was.id_token, token_type: t.token_type || 'Bearer',
  scopes: String(t.scope || '').split(/\s+/).filter(Boolean).length ? String(t.scope).split(/\s+/).filter(Boolean) : was.scopes, expires_at: Date.now() + (t.expires_in || 3600) * 1000, saved_at: new Date().toISOString() });

// Signs a person in. `open(url)` shows the address in their browser; the promise settles when they come back to the loopback
// address (or decline, or five minutes pass). Returns { email }.
export async function signIn({ open, auth = AUTH(), timeout = 300000 } = {}) {
  const s = read(), host = s.host || `urn:uuid:${crypto.randomUUID()}`, reg = s.registration || null;      // the host id is made once and kept, also across sign-outs
  const verifier = b64(crypto.randomBytes(48)), state = b64(crypto.randomBytes(24)), nonce = b64(crypto.randomBytes(24));
  const server = http.createServer(), port = await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', () => ok(server.address().port)); }), back = `http://127.0.0.1:${port}/callback`;
  const page = (words) => `<!doctype html><meta charset="utf-8"><title>Songbe</title><body style="font:16px system-ui;background:#0D1117;color:#E7ECF2;display:grid;place-items:center;height:100vh;margin:0"><p>${words}</p></body>`;
  try {
    const came = new Promise((ok, no) => {
      const late = setTimeout(() => no(new Error('nobody came back from the sign-in within five minutes')), timeout);
      server.on('request', (req, res) => {
        const u = new URL(req.url, back);
        if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
        const q = Object.fromEntries(u.searchParams), bad = q.state !== state ? 'this answer belongs to another sign-in' : q.error ? (q.error === 'access_denied' ? 'the sign-in was declined' : `${q.error}${q.error_description ? ': ' + q.error_description : ''}`) : !q.code ? 'no code came back' : null;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page(bad ? 'Songbe was not signed in. You can close this window.' : 'You are signed in. You can close this window and go back to Songbe.'));
        clearTimeout(late); if (bad) no(new Error(bad[0].toUpperCase() + bad.slice(1) + '.')); else ok(q);
      });
    });
    came.catch(() => {});
    await open(`${auth}/api/accounts/authorize?` + form({ client_id: reg?.client_id || 'dynamic_agent_client', ...(reg ? { login_hint: reg.email } : { agent_name_hint: NAME }), ext_agent_host_id: host, response_type: 'code', redirect_uri: back,
      scope: SCOPE, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: b64(crypto.createHash('sha256').update(verifier).digest()) }));
    const q = await came, client = q.client_id || reg?.client_id;
    if (!client) throw new Error('OpenAI did not issue this installation a client id');
    const t = await post(`${auth}/api/accounts/oauth/token`, { grant_type: 'authorization_code', code: q.code, code_verifier: verifier, redirect_uri: back, client_id: client, resource: RESOURCE }, 'the sign-in');
    const who = await identity(t.id_token, { auth, client, nonce });
    if (!String(t.scope || '').split(/\s+/).includes(PLAN)) throw new Error('You are signed in, but Songbe was not allowed to use your ChatGPT plan. Sign in again and allow it, or use an API key instead.');
    write({ ...s, host, registration: { client_id: client, email: who.email || null, subject: who.sub }, account: kept(t, { email: who.email || null, issuer: who.iss, subject: who.sub, client_id: client, ext_agent_host_id: host }), fresh: !s.registration });
    return { email: who.email || null };
  } finally { server.close(); server.closeAllConnections?.(); }
}
// Signs out: the grant is taken back at OpenAI, then the tokens are dropped here. What identifies this installation is kept, as
// OpenAI asks, so that signing in again is the same registration.
export async function signOut({ auth = AUTH() } = {}) {
  const s = read(), a = s.account; if (!a) return false;
  let told = true; try { const conf = await discover(auth); if (conf.revocation_endpoint) await post(conf.revocation_endpoint, { token: a.refresh_token, token_type_hint: 'refresh_token', client_id: a.client_id }, 'signing out'); } catch { told = false; }
  delete s.account; delete s.fresh; write(s); return told;
}
// the first sign-in is told once that the plan is now in use; a page asks and the answer is not given twice
export function firstTime() { const s = read(); if (!s.fresh) return false; delete s.fresh; write(s); return true; }

let refreshing = null;
// A token that is good now: the kept one, or a new one when that is about to run out (one refresh at a time).
async function token({ auth = AUTH() } = {}) {
  const a = read().account; if (!a?.refresh_token) throw new Error('Nobody is signed in with ChatGPT.');
  if (a.access_token && a.expires_at - Date.now() > 120000) return a.access_token;
  refreshing ||= (async () => {
    try { const t = await post(`${auth}/api/accounts/oauth/token`, { grant_type: 'refresh_token', client_id: a.client_id, refresh_token: a.refresh_token, resource: RESOURCE }, 'renewing the sign-in'); const s = read(); s.account = kept(t, s.account); write(s); return s.account.access_token; }
    catch (e) { if (/invalid_grant|invalid_refresh_token|token_expired|refresh_token_expired/.test(e.code || e.message)) { const s = read(); delete s.account; write(s); throw new Error('The sign-in with ChatGPT has run out or was taken back. Sign in again.'); } throw e; }
    finally { refreshing = null; }
  })();
  return refreshing;
}
// what OpenAI's refusals mean for the person
const SAID = { subscription_sharing_usage_limit_exceeded: 'Songbe has used the share of your ChatGPT plan it may use this week. Raise it in ChatGPT\'s settings, or let another writer do this.',
  subscription_sharing_user_not_eligible: 'This ChatGPT account cannot lend its plan to apps (that needs Plus or Pro). Use an API key for the writer instead.',
  subscription_sharing_invalid_user: 'ChatGPT no longer knows this sign-in. Sign in again.', subscription_sharing_unsupported_capability: 'ChatGPT plan usage does not cover what was asked for.',
  chatpass_v2_scope_not_authorized: 'Songbe is not allowed to use your ChatGPT plan. Sign in again and allow it.' };
const refusal = (code, message, status) => Object.assign(new Error(SAID[code] || `ChatGPT refused${status ? ` (${status})` : ''}: ${message || code || 'no reason given'}`), { code, status });

// the models this person's plan offers apps
export async function models({ api = API(), auth = AUTH() } = {}) {
  const r = await fetch(`${api}/models`, { headers: { Authorization: 'Bearer ' + await token({ auth }) }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw refusal(null, (await r.text()).slice(0, 200), r.status);
  return ((await r.json()).data || []).filter((m) => !m.visibility || m.visibility === 'list').map((m) => m.id || m.slug).filter(Boolean);
}
// { system, prompt } → text, on the person's plan. The answer arrives as a stream and counts only once OpenAI says it is complete.
export async function text({ system, prompt, model }, { api = API(), auth = AUTH() } = {}) {
  const s = read(); let use = model || s.model;
  if (!use) { use = (await models({ api, auth }))[0]; if (!use) throw new Error('ChatGPT offers this account no model for apps.'); const now = read(); now.model = use; write(now); }
  for (let tries = 1; ; tries++) {
    const r = await fetch(`${api}/responses`, { method: 'POST', headers: { Authorization: 'Bearer ' + await token({ auth }), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model: use, input: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], store: false, stream: true }), signal: AbortSignal.timeout(420000) });
    if (!r.ok) { let j = null; const body = await r.text(); try { j = JSON.parse(body); } catch {} const code = j?.error?.code;
      if (r.status === 503 && tries < 3) { await new Promise((ok) => setTimeout(ok, 1500 * tries)); continue; }
      throw refusal(code, j?.error?.message || body.slice(0, 200), r.status); }
    let out = '', done = false, buffer = '';
    const take = (block) => { const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join(''); if (!data || data === '[DONE]') return; let e; try { e = JSON.parse(data); } catch { return; }
      if (e.type === 'response.output_text.delta') out += e.delta || ''; else if (e.type === 'response.completed') done = true;
      else if (e.type === 'response.failed' || e.type === 'error') { const err = e.response?.error || e.error || e; throw refusal(err.code, err.message); }
      else if (e.type === 'response.incomplete') throw new Error('ChatGPT stopped before the answer was complete.'); };
    for await (const chunk of r.body) { buffer += Buffer.from(chunk).toString('utf8'); let cut; while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) { take(buffer.slice(0, cut)); buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, ''); } }
    if (buffer.trim()) take(buffer);
    if (!done) throw new Error('ChatGPT\'s answer ended before it was complete.');
    if (!out) throw new Error('ChatGPT returned no text.');
    return { text: out, model: use };
  }
}
