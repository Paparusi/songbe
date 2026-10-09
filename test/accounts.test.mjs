// Signing in with ChatGPT, and who writes. OpenAI is replaced by a small server here that answers the way OpenAI's published
// contract says (developers.openai.com/siwc): it issues this installation a client id, checks the PKCE proof, signs the identity
// with a key it publishes, renews tokens, streams answers, and can refuse. Nothing leaves this computer and nothing is spent.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-accounts-'));
process.env.SONGBE_DATA = path.join(scratch, 'data'); process.env.SONGBE_HOME = path.join(scratch, 'videos');
for (const k of ['FAL_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY', 'SONGBE_WRITER', 'SONGBE_WRITER_MODEL']) delete process.env[k];
test.after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

// ---- a stand-in for OpenAI ----
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), b64 = (x) => Buffer.from(x).toString('base64url');
const signed = (claims) => { const h = b64(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })), p = b64(JSON.stringify(claims)); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), rsa.privateKey).toString('base64url')}`; };
const openai = { mode: 'ok', seen: [], tokens: 0, revoked: [], asked: [] };
const stand = http.createServer(async (req, res) => {
  const u = new URL(req.url, origin), chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8'), json = (code, x) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x)); }, q = Object.fromEntries(u.searchParams), f = Object.fromEntries(new URLSearchParams(body));
  if (u.pathname === '/.well-known/openid-configuration') return json(200, { issuer: origin, jwks_uri: origin + '/jwks', revocation_endpoint: origin + '/revoke' });
  if (u.pathname === '/jwks') return json(200, { keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] });
  if (u.pathname === '/api/accounts/authorize') {      // the person at OpenAI's page: they agree, decline, or something answers for another sign-in
    openai.seen.push(q); openai.challenge = q.code_challenge; openai.nonce = q.nonce;
    const back = new URL(q.redirect_uri);
    if (openai.mode === 'declined') { back.searchParams.set('error', 'access_denied'); back.searchParams.set('state', q.state); }
    else { back.searchParams.set('code', 'code-1'); back.searchParams.set('state', openai.mode === 'other' ? 'someone-else' : q.state); if (q.client_id === 'dynamic_agent_client') back.searchParams.set('client_id', 'oaiapp_songbe_1'); }
    res.writeHead(302, { Location: back.href }); return res.end();
  }
  if (u.pathname === '/api/accounts/oauth/token') {
    openai.tokens++; openai.lastToken = f;
    if (f.grant_type === 'authorization_code') {
      if (f.code !== 'code-1' || b64(crypto.createHash('sha256').update(f.code_verifier || '').digest()) !== openai.challenge) return json(400, { error: 'invalid_grant', error_description: 'the proof does not match' });
      return json(200, { access_token: 'at-1', refresh_token: 'rt-1', token_type: 'Bearer', expires_in: 3600, scope: openai.mode === 'noplan' ? 'openid profile email offline_access' : 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke',
        id_token: signed({ iss: openai.mode === 'forged' ? 'https://elsewhere.example' : origin, aud: f.client_id, sub: 'user-42', email: 'bi@example.com', exp: Math.floor(Date.now() / 1000) + 600, nonce: openai.nonce }) });
    }
    if (f.grant_type === 'refresh_token') return openai.mode === 'gone' ? json(400, { error: 'invalid_grant' }) : f.refresh_token === 'rt-1' && f.client_id === 'oaiapp_songbe_1' ? json(200, { access_token: 'at-2', refresh_token: 'rt-2', token_type: 'Bearer', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
    return json(400, { error: 'unsupported_grant_type' });
  }
  if (u.pathname === '/revoke') { openai.revoked.push(f); res.writeHead(200); return res.end(); }
  const bearer = (req.headers.authorization || '').replace('Bearer ', '');
  if (u.pathname === '/v1/models') return bearer.startsWith('at-') ? json(200, { data: [{ id: 'gpt-6.1-sol', visibility: 'list' }, { id: 'internal-thing', visibility: 'hide' }] }) : json(401, { error: { code: 'invalid_token' } });
  if (u.pathname === '/v1/responses') {
    const b = JSON.parse(body); openai.asked.push({ bearer, ...b });
    if (openai.mode === 'limit') return json(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const say = (e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    say({ type: 'response.created' }); say({ type: 'response.output_text.delta', delta: '{"title": "Hai giờ' }); say({ type: 'response.output_text.delta', delta: ' sáng"}' });
    if (openai.mode === 'cut') return res.end(); if (openai.mode === 'failed') { say({ type: 'response.failed', response: { error: { code: 'subscription_sharing_user_not_eligible', message: 'no' } } }); return res.end(); }
    say({ type: 'response.completed', response: {} }); return res.end();
  }
  json(404, { error: 'not found' });
});
const origin = await new Promise((ok) => stand.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${stand.address().port}`)));
test.after(() => { stand.close(); stand.closeAllConnections?.(); });
process.env.SONGBE_OPENAI_AUTH = origin; process.env.SONGBE_OPENAI_API = origin + '/v1';
const chatgpt = await import('../src/providers/chatgpt.mjs');
const { ask, chooseWriter, chosenWriter, writerFor, writersFor } = await import('../src/providers/llm.mjs');
const { serve } = await import('../src/studio.mjs');
// the person's browser: it goes where it is sent, and follows OpenAI back to Songbe
const browser = async (url) => { const r = await fetch(url, { redirect: 'manual' }); await fetch(r.headers.get('location')); };
const kept = () => JSON.parse(fs.readFileSync(path.join(process.env.SONGBE_DATA, 'accounts', 'chatgpt.json'), 'utf8'));

test('signing in with ChatGPT: the published flow, step by step, and what is kept of it', async () => {
  assert.equal(chatgpt.signedIn(), false); assert.equal(writerFor({}), null);
  const who = await chatgpt.signIn({ open: browser });
  assert.deepEqual(who, { email: 'bi@example.com' }); assert.equal(chatgpt.signedIn(), true);
  // what OpenAI was asked: a first registration, for this host, with the plan scopes, a PKCE challenge, and a loopback address to come back to
  const q = openai.seen[0];
  assert.equal(q.client_id, 'dynamic_agent_client'); assert.equal(q.agent_name_hint, 'Songbe'); assert.match(q.ext_agent_host_id, /^urn:uuid:[0-9a-f-]{36}$/); assert.equal(q.response_type, 'code');
  assert.equal(q.scope, 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'); assert.equal(q.resource, 'https://api.openai.com/v1'); assert.equal(q.code_challenge_method, 'S256');
  assert.match(q.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/); assert.ok(q.state.length > 20 && q.nonce.length > 20 && q.code_challenge.length === 43);
  assert.deepEqual([openai.lastToken.grant_type, openai.lastToken.client_id, openai.lastToken.redirect_uri, openai.lastToken.resource], ['authorization_code', 'oaiapp_songbe_1', q.redirect_uri, 'https://api.openai.com/v1']); assert.equal(openai.lastToken.client_secret, undefined);
  // what is kept: the issued client id and the tokens, in a file only this user can read; a page is told who, never a token
  const s = kept(); assert.deepEqual(s.registration, { client_id: 'oaiapp_songbe_1', email: 'bi@example.com', subject: 'user-42' }); assert.equal(s.host, q.ext_agent_host_id);
  assert.deepEqual([s.account.access_token, s.account.refresh_token, s.account.client_id, s.account.subject], ['at-1', 'rt-1', 'oaiapp_songbe_1', 'user-42']); assert.ok(s.account.scopes.includes('chatgpt.tokens.use.direct'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(process.env.SONGBE_DATA, 'accounts', 'chatgpt.json')).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(chatgpt.account()).sort(), ['email', 'model', 'since']); assert.equal(chatgpt.firstTime(), true); assert.equal(chatgpt.firstTime(), false, 'the first sign-in is announced once');
});

test('with a sign-in the writer writes on the person\'s plan: streamed, complete or not at all, and renewed when the token runs out', async () => {
  assert.equal(writerFor({}), 'chatgpt'); assert.deepEqual(writersFor({ FAL_KEY: 'f' }), ['chatgpt', 'fal']); assert.equal(writerFor({ ANTHROPIC_API_KEY: 'a' }), 'anthropic', 'a key for a writer that comes first still comes first');
  const r = await ask({ system: 'You write JSON.', prompt: 'A title.' }, {});
  assert.deepEqual(r, { text: '{"title": "Hai giờ sáng"}', provider: 'chatgpt', model: 'gpt-6.1-sol' });
  const sent = openai.asked.at(-1); assert.deepEqual([sent.bearer, sent.model, sent.store, sent.stream], ['at-1', 'gpt-6.1-sol', false, true]); assert.deepEqual(sent.input, [{ role: 'system', content: 'You write JSON.' }, { role: 'user', content: 'A title.' }]);
  for (const never of ['max_output_tokens', 'temperature', 'metadata', 'user', 'tools']) assert.ok(!(never in sent), `${never} is not sent: plan usage refuses it`);
  assert.equal(kept().model, 'gpt-6.1-sol', 'the model the plan offers is asked for once and remembered');
  // an answer that stops early, or is refused, is not an answer
  openai.mode = 'cut'; await assert.rejects(ask({ prompt: 'x' }, {}), /ended before it was complete/);
  openai.mode = 'failed'; await assert.rejects(ask({ prompt: 'x' }, {}), /cannot lend its plan to apps \(that needs Plus or Pro\)/);
  openai.mode = 'limit'; await assert.rejects(ask({ prompt: 'x' }, {}), /used the share of your ChatGPT plan it may use this week/);
  // the hour is up: the token is renewed with the issued client id, the new pair replaces the old, and the question goes out with it
  openai.mode = 'ok'; const s = kept(); s.account.expires_at = Date.now() - 1000; fs.writeFileSync(path.join(process.env.SONGBE_DATA, 'accounts', 'chatgpt.json'), JSON.stringify(s));
  await ask({ prompt: 'again' }, {}); assert.deepEqual([openai.lastToken.grant_type, openai.lastToken.client_id, openai.lastToken.refresh_token, openai.lastToken.scope], ['refresh_token', 'oaiapp_songbe_1', 'rt-1', undefined]);
  assert.deepEqual([kept().account.access_token, kept().account.refresh_token, openai.asked.at(-1).bearer], ['at-2', 'rt-2', 'at-2']);
});

test('signing out takes the grant back; signing in again is the same registration; a sign-in that goes wrong leaves nothing behind', async () => {
  assert.equal(await chatgpt.signOut(), true); assert.deepEqual(openai.revoked.at(-1), { token: 'rt-2', token_type_hint: 'refresh_token', client_id: 'oaiapp_songbe_1' });
  assert.equal(chatgpt.signedIn(), false); assert.equal(kept().account, undefined); assert.equal(kept().registration.client_id, 'oaiapp_songbe_1', 'what names this installation is kept'); assert.equal(writerFor({}), null);
  await assert.rejects(ask({ prompt: 'x' }, { SONGBE_WRITER: 'chatgpt' }), /needs a key/);
  for (const [mode, why] of [['declined', /The sign-in was declined/], ['other', /This answer belongs to another sign-in/], ['noplan', /was not allowed to use your ChatGPT plan/], ['forged', /not issued by OpenAI/]]) {
    openai.mode = mode; await assert.rejects(chatgpt.signIn({ open: browser }), why, mode); assert.equal(chatgpt.signedIn(), false, mode);
  }
  await assert.rejects(chatgpt.signIn({ open: async () => {}, timeout: 60 }), /nobody came back from the sign-in/);
  openai.mode = 'ok'; const host = kept().host; await chatgpt.signIn({ open: browser });
  const again = openai.seen.at(-1); assert.deepEqual([again.client_id, again.login_hint, again.agent_name_hint, again.ext_agent_host_id], ['oaiapp_songbe_1', 'bi@example.com', undefined, host]); assert.equal(chatgpt.firstTime(), false);
  // a sign-in that OpenAI has taken back is noticed at the next renewal, and said in words
  const s = kept(); s.account.expires_at = 0; fs.writeFileSync(path.join(process.env.SONGBE_DATA, 'accounts', 'chatgpt.json'), JSON.stringify(s)); openai.mode = 'gone';
  await assert.rejects(ask({ prompt: 'x' }, {}), /has run out or was taken back\. Sign in again/); assert.equal(chatgpt.signedIn(), false); openai.mode = 'ok';
});

test('who writes can be chosen, and the app offers the sign-in, the choice and the new keys', async () => {
  assert.throws(() => chooseWriter('copilot'), /is not one of anthropic, google, chatgpt, openai, xai, fal/);
  chooseWriter('xai'); assert.equal(chosenWriter(), 'xai'); assert.equal(writerFor({ GEMINI_API_KEY: 'g', XAI_API_KEY: 'x' }), 'xai'); assert.equal(writerFor({ GEMINI_API_KEY: 'g' }), 'google', 'a chosen writer that is not set up gives way');
  assert.equal(writerFor({ GEMINI_API_KEY: 'g', XAI_API_KEY: 'x', SONGBE_WRITER: 'google' }), 'google', 'the environment has the last word'); chooseWriter(null); assert.equal(chosenWriter(), null);
  const s = await serve({ port: 0, home: process.env.SONGBE_HOME, browse: browser }), at = s.url.replace(/\/$/, '');
  const call = (p, method = 'GET', body) => fetch(at + p, { method, headers: { 'X-Songbe': '1' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const home = await call('/api/home'); assert.deepEqual([home.accounts.chatgpt.signedIn, home.accounts.chatgpt.pending, home.accounts.writer.using, home.accounts.writer.can], [false, false, null, []]); assert.equal(home.keys.openai, false); assert.equal(home.keys.xai, false);
    assert.equal(Object.keys(home.accounts.writer.names).join(), 'anthropic,google,chatgpt,openai,xai,fal'); assert.equal(JSON.stringify(home).includes('rt-'), false, 'no token ever reaches a page');
    assert.deepEqual(await call('/api/accounts/chatgpt/signin', 'POST'), { status: 200, started: true });
    let a; for (let i = 0; i < 100; i++) { a = await call('/api/accounts'); if (!a.chatgpt.pending) break; await new Promise((ok) => setTimeout(ok, 30)); }
    assert.deepEqual([a.chatgpt.signedIn, a.chatgpt.email, a.chatgpt.error, a.writer.using, a.writer.can], [true, 'bi@example.com', null, 'chatgpt', ['chatgpt']]);
    await call('/api/keys', 'PUT', { XAI_API_KEY: 'xai-test-key-000000' }); const both = await call('/api/accounts'); assert.deepEqual(both.writer.can, ['chatgpt', 'xai']); assert.equal((await call('/api/home')).keys.xai, true);
    assert.equal((await call('/api/writer', 'PUT', { writer: 'xai' })).writer.using, 'xai'); assert.match((await call('/api/writer', 'PUT', { writer: 'nobody' })).error, /is not one of/); assert.equal((await call('/api/writer', 'PUT', { writer: '' })).writer.using, 'chatgpt');
    const out = await call('/api/accounts/chatgpt/signout', 'POST'); assert.deepEqual([out.chatgpt.signedIn, out.writer.using], [false, 'xai']);
  } finally { s.close(); }
});
