// Songbe is sold: a licence key lets a copy make things. A copy without one runs as a trial for some days from its first start;
// after that it still opens every project and shows what was made, but makes nothing new until a key is entered.
//
// A key is a small signed note — who it is for, which plan, until when — that this file can check by itself, with no server and
// no connection: "SB1." + the note + "." + its signature, both in URL-safe base64. Only the holder of the private key can write
// one (tools/licence.mjs); the public key below can only check. A key says nothing about the computer it is on, so the same key
// works on a person's second machine, and nothing stops it being passed on: it deters copying, it does not prevent it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, mkdir } from './util.mjs';

export const TRIAL = 14;      // days a copy runs without a key
const PUBLIC = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjAW7/xXvtOXIappTFWHs3ll4nvWVhVrAFTlwZAHp95g=
-----END PUBLIC KEY-----`;
const DAY = 86400000, b64 = (s) => Buffer.from(s, 'base64url');
const day = (t) => new Date(t).toISOString().slice(0, 10);

// What a key says: { ok, to, email, plan, issued, until, id } — or { ok: false, why } for one that is not Songbe's, was changed, or has run out.
export function readKey(key, { publicKey = PUBLIC, now = Date.now() } = {}) {
  const m = /^SB1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(key || '').trim());
  if (!m) return { ok: false, why: 'That is not a Songbe licence key (they begin with SB1.).' };
  let good = false; try { good = crypto.verify(null, Buffer.from(m[1]), publicKey, b64(m[2])); } catch {}
  if (!good) return { ok: false, why: 'That key is not one Songbe issued, or part of it is missing.' };
  let note; try { note = JSON.parse(b64(m[1]).toString('utf8')); } catch { return { ok: false, why: 'That key cannot be read.' }; }
  const says = { to: String(note.to || ''), email: note.email ? String(note.email) : null, plan: String(note.plan || 'studio'), issued: note.issued || null, until: note.until || null, id: String(note.id || '') };
  if (says.until && now > Date.parse(says.until + 'T23:59:59Z')) return { ok: false, ...says, why: `That key ran out on ${says.until}.` };
  return { ok: true, ...says };
}
// A key, written by whoever holds the private key (used by tools/licence.mjs and the tests).
export function writeKey({ to, email = null, plan = 'studio', until = null, id = crypto.randomBytes(6).toString('hex'), issued = day(Date.now()) }, privateKey) {
  if (!String(to || '').trim()) throw new Error('who is the licence for?');
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error('"until" is a date like 2027-10-09');
  const note = Buffer.from(JSON.stringify({ v: 1, id, to: String(to).trim(), ...(email ? { email } : {}), plan, issued, ...(until ? { until } : {}) })).toString('base64url');
  return `SB1.${note}.${crypto.sign(null, Buffer.from(note), privateKey).toString('base64url')}`;
}

// ---- this copy ----
const file = () => path.join(dataDir(), 'licence.json');
const saved = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
const save = (x) => { fs.writeFileSync(path.join(mkdir(dataDir()), 'licence.json'), JSON.stringify(x, null, 1)); };
// Where this copy stands: { kind: 'licensed' | 'trial' | 'over', to, plan, until, left (days of trial), why }.
// The key is the one in SONGBE_LICENCE when that is set (for a machine without the app's settings), else the one entered in the app.
export function licence({ env = process.env, now = Date.now(), publicKey = PUBLIC } = {}) {
  const s = saved(), key = env.SONGBE_LICENCE || s.key || null;
  if (!s.first) { s.first = new Date(now).toISOString(); try { save(s); } catch {} }      // the trial starts when Songbe is first asked
  const k = key ? readKey(key, { publicKey, now }) : null;
  if (k?.ok) return { kind: 'licensed', to: k.to, email: k.email, plan: k.plan, until: k.until, id: k.id };
  const left = Math.max(0, Math.ceil(TRIAL - (now - Date.parse(s.first)) / DAY));
  return { kind: left > 0 ? 'trial' : 'over', left, ...(k ? { why: k.why } : {}) };
}
// Enters a key for this copy; throws with the reason when the key is not good.
export function enter(key, o = {}) {
  const k = readKey(key, { publicKey: o.publicKey || PUBLIC, now: o.now || Date.now() });
  if (!k.ok) throw new Error(k.why);
  save({ ...saved(), key: String(key).trim() }); return licence(o);
}
export function forget(o = {}) { const s = saved(); delete s.key; save(s); return licence(o); }
// In words, for a command line or a page.
export function inWords(l) {
  return l.kind === 'licensed' ? `Licensed to ${l.to}${l.until ? ` until ${l.until}` : ''}` : l.kind === 'trial' ? `Trial: ${l.left} day${l.left === 1 ? '' : 's'} left` : 'The trial is over';
}
// Making something needs a licence or a running trial; looking, changing and exporting what exists never does.
export function mayMake(o = {}) {
  const l = licence(o);
  if (l.kind === 'over') throw new Error(`The trial of Songbe is over${l.why ? ` (${l.why.replace(/\.$/, '')})` : ''}. Everything you made is still here and still opens; to make more, enter a licence key: songbe licence <key>, or Settings in the app.`);
  return l;
}
