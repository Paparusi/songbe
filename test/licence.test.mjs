// The licence: what a key says and who can write one, the trial of a copy without a key, and that making — and only making — asks.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-licence-'));
process.env.SONGBE_DATA = path.join(scratch, 'data'); process.env.SONGBE_HOME = path.join(scratch, 'videos'); delete process.env.SONGBE_LICENCE;
for (const k of ['FAL_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY']) delete process.env[k];
test.after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const { TRIAL, enter, forget, inWords, licence, mayMake, readKey, writeKey } = await import('../src/licence.mjs');
const { main } = await import('../src/cli.mjs');
const { serve } = await import('../src/studio.mjs');

// a seller of our own: Songbe's real private key is nowhere near the tests
const pair = crypto.generateKeyPairSync('ed25519'), mine = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) }, DAY = 86400000;
const state = (s) => fs.writeFileSync(path.join(fs.mkdirSync(process.env.SONGBE_DATA, { recursive: true }) || process.env.SONGBE_DATA, 'licence.json'), JSON.stringify(s));

test('a key says who it is for and until when; only its issuer can write one, and a changed or foreign key is refused', () => {
  const key = writeKey({ to: 'Nguyễn Văn A', email: 'a@example.com', plan: 'studio', until: '2027-10-09', id: 'k1', issued: '2026-10-09' }, pair.privateKey);
  assert.match(key, /^SB1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(readKey(key, { ...mine, now: Date.parse('2026-12-01') }), { ok: true, to: 'Nguyễn Văn A', email: 'a@example.com', plan: 'studio', issued: '2026-10-09', until: '2027-10-09', id: 'k1' });
  assert.equal(readKey(key, { ...mine, now: Date.parse('2027-10-09T20:00:00Z') }).ok, true, 'good through its last day');
  assert.match(readKey(key, { ...mine, now: Date.parse('2027-10-10T01:00:00Z') }).why, /ran out on 2027-10-09/);
  assert.equal(readKey(writeKey({ to: 'B' }, pair.privateKey), mine).until, null, 'a key without a date never runs out');
  // not ours, changed, or not a key at all
  assert.match(readKey(key).why, /not one Songbe issued/, 'the build\'s own public key does not know this seller');
  const [head, note, sig] = key.split('.'), forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(note, 'base64url')), until: '2099-01-01' })).toString('base64url');
  assert.match(readKey(`${head}.${forged}.${sig}`, mine).why, /not one Songbe issued/); assert.match(readKey(key.slice(0, -4), mine).why, /not one Songbe issued|not a Songbe licence key/);
  for (const junk of ['', 'hello', 'SB2.a.b', 'PRO-AAAA-BBBB']) assert.match(readKey(junk, mine).why, /not a Songbe licence key/);
  assert.throws(() => writeKey({ to: '' }, pair.privateKey), /who is the licence for/); assert.throws(() => writeKey({ to: 'A', until: 'next year' }, pair.privateKey), /a date like/);
});

test('a copy without a key is a trial from its first start; then it makes nothing new until a key is entered', () => {
  const t0 = Date.parse('2026-10-09T08:00:00Z');
  assert.deepEqual(licence({ ...mine, now: t0 }), { kind: 'trial', left: TRIAL }); assert.equal(TRIAL, 14);
  assert.deepEqual(licence({ ...mine, now: t0 + 13.5 * DAY }), { kind: 'trial', left: 1 }); assert.equal(inWords(licence({ ...mine, now: t0 + 13.5 * DAY })), 'Trial: 1 day left');
  assert.deepEqual(licence({ ...mine, now: t0 + 15 * DAY }), { kind: 'over', left: 0 }); assert.equal(mayMake({ ...mine, now: t0 + DAY }).kind, 'trial');
  assert.throws(() => mayMake({ ...mine, now: t0 + 15 * DAY }), /The trial of Songbe is over\. Everything you made is still here and still opens; to make more, enter a licence key/);
  // a key ends the question, whenever it is entered
  const key = writeKey({ to: 'Xưởng phim Sông Bé', until: '2027-01-31' }, pair.privateKey), later = { ...mine, now: t0 + 40 * DAY };
  assert.throws(() => enter('SB1.nope.nope', later), /not one Songbe issued/); assert.equal(licence(later).kind, 'over', 'a bad key changes nothing');
  assert.deepEqual(enter(key, later), { kind: 'licensed', to: 'Xưởng phim Sông Bé', email: null, plan: 'studio', until: '2027-01-31', id: licence(later).id }); assert.equal(inWords(licence(later)), 'Licensed to Xưởng phim Sông Bé until 2027-01-31');
  assert.equal(mayMake(later).kind, 'licensed');
  // when the key runs out the copy is as it would be without one, and says why
  assert.deepEqual(licence({ ...mine, now: Date.parse('2027-03-01') }), { kind: 'over', left: 0, why: 'That key ran out on 2027-01-31.' });
  assert.equal(forget(later).kind, 'over'); assert.equal(licence({ ...mine, now: t0 + 2 * DAY }).kind, 'trial', 'the first start is remembered, not reset');
  assert.equal(licence({ ...mine, now: t0 + 40 * DAY, env: { SONGBE_LICENCE: key } }).kind, 'licensed', 'a key may also come from the environment');
});

test('making asks the licence; looking never does — on the command line and in the app', async () => {
  const dir = path.join(scratch, 'ad'); fs.cpSync(new URL('../examples/sale-vi', import.meta.url).pathname, dir, { recursive: true });
  const film = path.join(scratch, 'canvas'); fs.mkdirSync(film); fs.writeFileSync(path.join(film, 'flow.json'), JSON.stringify({ nodes: { rain: { kind: 'picture', prompt: 'Rain on glass.' } } }));
  state({ first: new Date(Date.now() - 30 * DAY).toISOString() });      // a copy whose trial ended a fortnight ago
  for (const cmd of [['build', dir], ['footage', dir, '--scene=1'], ['write', path.join(scratch, 'new'), 'A bakery in Saigon, open from six.'], ['film', 'new', path.join(scratch, 'film'), 'Lan finds out that her husband leaves at two every night.'], ['flow', 'run', film], ['flow', 'retake', film, 'rain']])
    await assert.rejects(main(cmd), /The trial of Songbe is over/, cmd.join(' '));
  const said = []; const log = console.log; console.log = (...a) => said.push(a.join(' '));
  try { await main(['validate', dir]); await main(['flow', film]); await main(['flow', 'plan', film]); await main(['licence']); await main(['doctor']); } finally { console.log = log; }
  assert.match(said.join('\n'), /video\.json is valid[\s\S]*rain[\s\S]*a run would ask for[\s\S]*The trial is over\. Everything you made still opens; to make more, enter a key[\s\S]*licence:  The trial is over/);
  // the app: says where the copy stands, refuses to start making, takes a key
  const s = await serve({ port: 0, home: process.env.SONGBE_HOME, licencePublic: mine.publicKey, ask: async () => '{}' }), at = s.url.replace(/\/$/, '');
  const call = (p, method = 'GET', body) => fetch(at + p, { method, headers: { 'X-Songbe': '1' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    assert.deepEqual((await call('/api/home')).licence, { kind: 'over', left: 0, words: 'The trial is over' });
    const refused = await call('/api/films', 'POST', { idea: 'Lan finds out that her husband leaves at two every night.' }); assert.equal(refused.status, 402); assert.match(refused.error, /The trial of Songbe is over/); assert.equal(refused.licence.kind, 'over');
    assert.equal((await call('/api/projects', 'POST', { name: 'Viết hộ', starter: 'write', brief: 'A bakery in Saigon, open from six in the morning.' })).status, 402);
    const blank = await call('/api/projects', 'POST', { name: 'Trống', starter: 'blank' }); assert.equal(blank.status, 200, 'a new project from a starter asks no model, so it is still allowed');
    assert.equal((await call(`/p/${blank.id}/api/build`, 'POST', {})).status, 402); assert.equal((await call(`/p/${blank.id}/api/state`)).status, 200);
    assert.match((await call('/api/licence', 'PUT', { key: 'SB1.x.y' })).error, /not one Songbe issued/);
    const key = writeKey({ to: 'Bi', email: 'bi@example.com' }, pair.privateKey), ok = await call('/api/licence', 'PUT', { key });
    assert.deepEqual([ok.status, ok.kind, ok.to, ok.words], [200, 'licensed', 'Bi', 'Licensed to Bi']); assert.equal((await call('/api/home')).licence.email, 'bi@example.com');
    assert.equal((await call('/api/licence', 'DELETE')).kind, 'over');
  } finally { s.close(); }
});
