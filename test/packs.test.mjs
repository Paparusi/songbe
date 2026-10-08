// Packs: looks and starters from outside the core — the bundled one, one linked for development, one installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-packs-'));
process.env.SONGBE_DATA = path.join(scratch, 'data'); process.env.SONGBE_HOME = path.join(scratch, 'videos');
// a pack as someone would build one: a look (style sheet + numbers), a starter, and things that must be ignored
const mine = path.join(scratch, 'dev', 'neon');
fs.mkdirSync(path.join(mine, 'styles'), { recursive: true }); fs.mkdirSync(path.join(mine, 'starters', 'sale'), { recursive: true });
fs.writeFileSync(path.join(mine, 'pack.json'), JSON.stringify({ name: 'Neon', version: '0.3.0', about: 'Night colours', licence: 'Commercial' }));
fs.writeFileSync(path.join(mine, 'styles', 'neon.css'), '[data-style="neon"] { --r-card: 0px; }');
fs.writeFileSync(path.join(mine, 'styles', 'neon.json'), JSON.stringify({ title: { scale: 9, lead: 1.3 }, reveal: 'explode', wipe: 'veil' }));
fs.writeFileSync(path.join(mine, 'styles', 'bold.css'), '/* a pack may not replace a look of the kit */'); fs.writeFileSync(path.join(mine, 'styles', 'Bad Name.css'), '');
fs.writeFileSync(path.join(mine, 'starters', 'sale', 'video.json'), JSON.stringify({ style: 'neon', brand: { name: 'Sale' }, scenes: [{ type: 'end', duration: 3, tagline: 'Tonight only' }] }));
fs.writeFileSync(path.join(mine, 'starters', 'sale', 'starter.json'), JSON.stringify({ name: 'Night sale', about: 'One evening, one offer.', order: 5 }));
process.env.SONGBE_PACKS = path.join(scratch, 'dev');

const { listPacks, packStyles, starterList, starterDir, installPack, removePack, styleParams, installedPacksDir } = await import('../src/packs.mjs');
const { STYLES, refreshStyles, validate } = await import('../src/spec.mjs');
const { makePlan } = await import('../src/plan.mjs');
const { fitTable, limitOf } = await import('../src/fit.mjs');
const { serve } = await import('../src/studio.mjs');
const { ROOT } = await import('../src/util.mjs');
test.after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

test('the bundled pack brings a third look and a starter', () => {
  const classic = listPacks().find((p) => p.id === 'classic');
  assert.equal(classic.where, 'bundled'); assert.deepEqual(classic.styles.map((s) => s.name), ['classic']); assert.deepEqual(classic.starters.map((s) => s.id), ['classic/quan-ca-phe']);
  assert.ok(STYLES.includes('classic')); assert.deepEqual(STYLES.slice(0, 2), ['soft', 'bold']);
  const spec = JSON.parse(fs.readFileSync(path.join(starterDir('classic/quan-ca-phe'), 'video.json'), 'utf8'));
  assert.deepEqual(validate(spec, starterDir('classic/quan-ca-phe')), []);
  assert.equal(validate({ ...spec, style: 'gothic' }).length, 1, 'a look nobody provides is still an error');
  assert.equal(limitOf('footage.title', 'classic'), fitTable()['footage.title'].classic); assert.ok(Number.isInteger(limitOf('end.cta', 'classic')), 'the pack measured its own look');
  for (const f of ['styles/classic.css', 'styles/classic.json', 'styles/fonts/playfair.css', 'styles/fonts/OFL-PlayfairDisplay.txt', 'fit.json', 'starters/quan-ca-phe/poster.jpg']) assert.ok(fs.existsSync(path.join(classic.dir, f)), f);
});

test('a pack under development is found, read with care, and never replaces what the kit owns', () => {
  const neon = listPacks().find((p) => p.id === 'neon');
  assert.equal(neon.where, 'linked'); assert.equal(neon.licence, 'Commercial');
  assert.deepEqual(neon.styles.map((s) => s.name), ['neon'], 'neither "bold" nor a badly named file becomes a look');
  assert.deepEqual(neon.styles[0].params, { title: { scale: 1, lead: 1.3 }, reveal: 'rise', wipe: 'veil' }, 'numbers out of range and unknown words fall back');
  assert.deepEqual(styleParams(null), { title: { scale: 1, lead: 0 }, reveal: 'rise', wipe: 'slab' });
  assert.ok(STYLES.includes('neon') && packStyles().get('neon').css.endsWith('neon.css'));
  const sale = starterList().find((s) => s.id === 'neon/sale'); assert.equal(sale.name, 'Night sale'); assert.equal(starterDir('neon/../../etc'), null);
  assert.deepEqual(starterList().map((s) => s.id).slice(0, 2), ['app-launch-en', 'recruitment-vi'], 'Songbe\'s own examples keep their plain names and come first');
});

test('a plan in a pack\'s look carries the pack\'s style sheet and numbers', async () => {
  const dir = path.join(scratch, 'p1'); fs.cpSync(starterDir('classic/quan-ca-phe'), dir, { recursive: true });
  const plan = await makePlan(dir, { offline: true });
  assert.equal(plan.style, 'classic'); assert.deepEqual(plan.styleParams, { title: { scale: 1, lead: 1.2 }, reveal: 'rise', wipe: 'veil' });
  assert.equal(fileURLToPath(plan.styleCss), path.join(ROOT, 'packs', 'classic', 'styles', 'classic.css'));
  const other = await makePlan(dir, { offline: true, style: 'bold' }); assert.equal(other.styleCss, undefined, 'the kit\'s own looks need neither');
});

test('installing copies a pack onto this computer; removing takes only that copy', () => {
  assert.throws(() => installPack(scratch), /not a pack/);
  const p = installPack(mine);
  assert.equal(p.where, 'installed'); assert.equal(p.dir, path.join(installedPacksDir(), 'neon')); assert.ok(fs.existsSync(path.join(p.dir, 'styles', 'neon.css')));
  assert.throws(() => removePack('classic'), /no installed pack/); assert.throws(() => removePack('../neon'), /no installed pack/);
  removePack('neon'); assert.ok(!fs.existsSync(p.dir)); assert.ok(fs.existsSync(mine), 'the folder it came from is untouched');
  refreshStyles(); assert.ok(STYLES.includes('neon'), 'still linked for development');
});

test('the app offers pack starters and serves a pack\'s style sheet and fonts, and nothing else of it', async () => {
  const s = await serve({ port: 0 }), u = s.url.slice(0, -1), J = (r) => r.json(), own = { 'X-Songbe': '1' };
  try {
    const h = await fetch(u + '/api/home').then(J);
    assert.deepEqual(h.packs.map((p) => [p.id, p.where]).sort(), [['classic', 'bundled'], ['neon', 'linked']]);
    assert.deepEqual(h.starters.map((x) => x.id), ['app-launch-en', 'recruitment-vi', 'neon/sale', 'classic/quan-ca-phe', 'blank']);
    assert.ok(h.styles.includes('classic') && h.styles.includes('neon'));
    const poster = await fetch(u + h.starters.find((x) => x.id === 'classic/quan-ca-phe').poster); assert.equal(poster.headers.get('content-type'), 'image/jpeg');
    const { id } = await fetch(u + '/api/projects', { method: 'POST', headers: own, body: JSON.stringify({ name: 'Quán của tôi', starter: 'classic/quan-ca-phe' }) }).then(J);
    assert.deepEqual(fs.readdirSync(path.join(process.env.SONGBE_HOME, 'Quán của tôi')).sort(), ['video.json'], 'the starter\'s poster and description stay behind');
    const st = await fetch(`${u}/p/${id}/api/state`).then(J);
    assert.deepEqual(st.errors, []); assert.equal(st.plan.styleCss, '/pack/classic/styles/classic.css'); assert.ok(st.table.TOP.style.includes('classic'), 'the editor offers the look');
    const page = await fetch(`${u}/p/${id}/preview`).then((r) => r.text()); assert.ok(page.includes('<link rel="stylesheet" href="/pack/classic/styles/classic.css">'));
    assert.match(await fetch(u + '/pack/classic/styles/classic.css').then((r) => r.text()), /data-style="classic"/);
    assert.equal((await fetch(u + '/pack/classic/styles/fonts/playfair-vi.woff2')).headers.get('content-type'), 'font/woff2');
    for (const bad of ['/pack/classic/..%2F..%2Fpackage.json', '/pack/classic/%2e%2e/%2e%2e/src/cli.mjs', '/pack/nope/styles/x.css', '/starter-poster?id=..%2F..']) assert.equal((await fetch(u + bad)).status, 404, bad);
  } finally { s.close(); }
});
