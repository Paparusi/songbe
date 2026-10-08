// The app's server: projects, starters, keys, and what it refuses. Runs against scratch folders and never calls a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-app-'));
process.env.SONGBE_DATA = path.join(scratch, 'data'); process.env.SONGBE_HOME = path.join(scratch, 'videos');
delete process.env.FAL_KEY; delete process.env.GROQ_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const { serve, tidyName, trusted, forBrowser, idOf } = await import('../src/studio.mjs');
const { ROOT, tools } = await import('../src/util.mjs');

let s, u; const mine = { 'X-Songbe': '1' }, J = (r) => r.json();
const post = (where, data) => fetch(u + where, { method: 'POST', headers: mine, body: JSON.stringify(data) });
test.before(async () => { s = await serve({ port: 0 }); u = s.url.slice(0, -1); });
test.after(() => { s.close(); fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

test('a typed name becomes a folder name every system accepts', () => {
  assert.equal(tidyName('  Ra mắt: bản "thử" 1/2?  '), 'Ra mắt bản thử 1 2');
  assert.equal(tidyName('Tuyển công nhân.'), 'Tuyển công nhân');
  assert.equal(tidyName('con'), '_con');
  assert.equal(tidyName('..\\..\\Windows'), 'Windows');
  assert.equal(tidyName(' . '), '');
  assert.equal(tidyName('x'.repeat(200)).length, 60);
});

test('only this computer\'s own pages are answered', () => {
  const req = (method, headers) => ({ method, headers });
  assert.ok(trusted(req('GET', { host: '127.0.0.1:4173' })));
  assert.ok(trusted(req('POST', { host: 'localhost:4173', origin: 'http://localhost:4173', 'x-songbe': '1' })));
  assert.ok(!trusted(req('GET', { host: 'evil.example:4173' })), 'a name that merely resolves here');
  assert.ok(!trusted(req('GET', { host: '127.0.0.1:4173', origin: 'https://evil.example' })), 'another site reading');
  assert.ok(!trusted(req('POST', { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' })), 'a change without the header a form cannot set');
  assert.ok(!trusted(req('POST', { host: '127.0.0.1:4173', origin: 'null', 'x-songbe': '1' })));
});

test('file addresses in a plan become links the page can load', () => {
  const file = path.join(scratch, 'thư mục có dấu & ký tự #1', 'ảnh+1.png'), dir = path.join(scratch, 'frames', 'abc');
  const plan = { brand: { logo: { mark: pathToFileURL(file).href } }, scenes: [{ media: { kind: 'frames', dir: pathToFileURL(dir).href } }], musicFile: file, n: 3 };
  const seen = [], out = forBrowser(plan, (abs) => { seen.push(abs); return '/x?p=' + encodeURIComponent(abs); });
  assert.deepEqual(seen, [file, dir], 'every file:// address, decoded back to the real path');
  assert.equal(new URL(out.brand.logo.mark, 'http://x').searchParams.get('p'), file);
  assert.equal(new URL(out.scenes[0].media.dir + '/0001.jpg', 'http://x').searchParams.get('p'), dir + '/0001.jpg', 'the page appends frame names to a folder link');
  assert.equal(out.musicFile, file); assert.equal(out.n, 3);
});

test('the home screen starts empty, with starters to pick from', async () => {
  const h = await fetch(u + '/api/home').then(J);
  assert.deepEqual(h.projects, []);
  assert.equal(h.home, process.env.SONGBE_HOME);
  assert.deepEqual(h.starters.map((x) => x.id), ['app-launch-en', 'recruitment-vi', 'sale-vi', 'classic/quan-ca-phe', 'blank']);
  for (const st of h.starters.filter((x) => x.id !== 'blank')) { assert.ok(st.poster, `${st.id} has a poster`); assert.equal((await fetch(u + st.poster)).headers.get('content-type'), 'image/jpeg'); }
  assert.deepEqual(h.keys, { fal: false, falFrom: null, groq: false, groqFrom: null, anthropic: false, anthropicFrom: null });
  for (const page of ['/home', '/studio/ui.css', '/studio/icon.svg', '/kit/fonts/fonts.css']) assert.equal((await fetch(u + page)).status, 200, page);
  assert.equal((await fetch(u + '/', { redirect: 'manual' })).headers.get('location'), '/home');
  assert.equal(h.writer, null);
  const refused = await post('/api/projects', { name: 'x', starter: 'write', brief: 'A long enough description of an ad.' });
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /needs a key/);
});

test('a new video is a copy of its starter, without the starter\'s own leftovers', async () => {
  const made = {};
  for (const [name, starter] of [['Ra mắt app', 'app-launch-en'], ['Tuyển công nhân', 'recruitment-vi'], ['Trống', 'blank'], ['Tuyển công nhân', 'recruitment-vi']]) {
    const r = await post('/api/projects', { name, starter }); assert.equal(r.status, 200); made[name + (made[name] ? ' 2' : '')] = (await r.json()).id;
  }
  assert.deepEqual(fs.readdirSync(process.env.SONGBE_HOME).sort(), ['Ra mắt app', 'Trống', 'Tuyển công nhân', 'Tuyển công nhân 2'], 'a taken name gets a number');
  const dir = path.join(process.env.SONGBE_HOME, 'Ra mắt app');
  assert.equal(idOf(dir), made['Ra mắt app']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['media', 'video.json'], 'no cache, renders, poster or starter description');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'app-launch-en', 'video.json'), 'utf8')));
  const { validate } = await import('../src/spec.mjs');
  assert.deepEqual(validate(JSON.parse(fs.readFileSync(path.join(process.env.SONGBE_HOME, 'Trống', 'video.json'), 'utf8')), path.join(process.env.SONGBE_HOME, 'Trống')), [], 'the blank starter is a valid video');
  for (const bad of [{ name: '', starter: 'blank' }, { name: 'x', starter: '../../etc' }, { name: 'x', starter: 'nope' }, { name: 'x' }]) assert.equal((await post('/api/projects', bad)).status, 400, JSON.stringify(bad));
  const h = await fetch(u + '/api/home').then(J);
  assert.equal(h.projects.length, 4);
  for (const p of h.projects) { assert.equal(p.built, null); assert.equal(p.broken, false); assert.equal(p.elsewhere, false); assert.deepEqual(p.size, [1080, 1920]); }
});

test('a project page, its state and its files', async () => {
  const id = idOf(path.join(process.env.SONGBE_HOME, 'Trống')), dir = path.join(process.env.SONGBE_HOME, 'Trống');
  assert.equal((await fetch(`${u}/p/${id}`, { redirect: 'manual' })).headers.get('location'), `/p/${id}/`);
  assert.match(await fetch(`${u}/p/${id}/`).then((r) => r.text()), /<title>Songbe<\/title>/);
  const st = await fetch(`${u}/p/${id}/api/state`).then(J);
  assert.equal(st.name, 'Trống'); assert.equal(st.spec.scenes.length, 3); assert.deepEqual(st.errors, []);
  assert.equal(st.plan.scenes.length, 3); assert.ok(st.plan.duration > 5);
  assert.match(await fetch(`${u}/p/${id}/preview`).then((r) => r.text()), /SB\.mount\(/);
  // saving: a spec with a mistake is reported and not written
  const good = st.spec, bad = { ...good, scenes: [{ type: 'footage', titel: 'x' }] };
  const r1 = await fetch(`${u}/p/${id}/api/spec`, { method: 'PUT', headers: mine, body: JSON.stringify(bad) }).then(J);
  assert.equal(r1.saved, false); assert.ok(r1.errors.some((e) => e.includes('did you mean "title"')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')), good);
  good.brand.name = 'Tên mới';
  assert.equal((await fetch(`${u}/p/${id}/api/spec`, { method: 'PUT', headers: mine, body: JSON.stringify(good) }).then(J)).saved, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')).brand.name, 'Tên mới');
  // adding media keeps accented names and refuses what is not media
  const up = await fetch(`${u}/p/${id}/api/upload?name=${encodeURIComponent('ảnh bìa (1).png')}`, { method: 'POST', headers: mine, body: Buffer.from('not really a png') }).then(J);
  assert.equal(up.path, 'media/ảnh-bìa-1-.png'); assert.ok(fs.existsSync(path.join(dir, up.path)));
  assert.equal((await fetch(`${u}/p/${id}/api/upload?name=run.exe`, { method: 'POST', headers: mine, body: 'x' })).status, 400);
  assert.equal((await fetch(`${u}/p/${id}/api/upload?name=${encodeURIComponent('../../x.png')}`, { method: 'POST', headers: mine, body: 'x' }).then(J)).path, 'media/x.png', 'a path in the name cannot leave the project');
  // files: the project and the kit, nothing else
  const file = (p) => fetch(`${u}/p/${id}/file?p=${encodeURIComponent(p)}`).then((r) => r.status);
  assert.equal(await file(path.join(dir, 'video.json')), 200);
  fs.writeFileSync(path.join(dir, '.env'), 'FAL_KEY=project-key-123456\n');
  assert.equal(await file(path.join(dir, '.env')), 404, 'never the keys');
  assert.equal(await file(path.join(process.env.SONGBE_DATA, 'projects.json')), 404);
  assert.equal(await file(path.join(process.env.SONGBE_HOME, 'Ra mắt app', 'video.json')), 404, 'not another project either');
  assert.equal(await file(path.join(os.homedir(), '.ssh', 'id_rsa')), 404);
  assert.equal((await fetch(u + '/kit/..%2Fpackage.json')).status, 404);
  assert.equal((await fetch(u + '/studio/..%2F..%2Fpackage.json')).status, 404);
  assert.equal((await fetch(`${u}/p/0123456789abcdef/`)).status, 404, 'an unknown project');
  assert.equal((await fetch(`${u}/p/${id}/api/state`).then(J)).keys.falFrom, 'project', 'the project\'s own key is found');
  fs.rmSync(path.join(dir, '.env'));
});

test('requests from anywhere else are refused before anything happens', async () => {
  assert.equal((await fetch(u + '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'x', starter: 'blank' }) })).status, 403);
  assert.equal((await fetch(u + '/api/home', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(u + '/api/keys', { method: 'PUT', headers: { Origin: 'https://evil.example', 'X-Songbe': '1' }, body: '{"FAL_KEY":"stolen-credit-123"}' })).status, 403);
  assert.ok(!fs.existsSync(path.join(process.env.SONGBE_HOME, 'x')));
});

test('keys are saved on this computer and never sent back', async () => {
  const put = (data) => fetch(u + '/api/keys', { method: 'PUT', headers: mine, body: JSON.stringify(data) });
  const r = await put({ FAL_KEY: 'test-key-0123456789' }), text = await r.text();
  assert.deepEqual(JSON.parse(text), { fal: true, falFrom: 'saved', groq: false, groqFrom: null, anthropic: false, anthropicFrom: null });
  assert.ok(!text.includes('0123456789') && !(await fetch(u + '/api/home').then((x) => x.text())).includes('0123456789'));
  const file = path.join(process.env.SONGBE_DATA, '.env');
  assert.equal(fs.readFileSync(file, 'utf8'), 'FAL_KEY=test-key-0123456789\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal((await put({ FAL_KEY: 'two words' })).status, 400); assert.equal((await put({ FAL_KEY: 'a\nINJECTED=1' })).status, 400);
  assert.equal((await put({ GROQ_API_KEY: 'gsk_test_0123456789' }).then(J)).groq, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'FAL_KEY=test-key-0123456789\nGROQ_API_KEY=gsk_test_0123456789\n', 'saving one key keeps the other');
  assert.deepEqual(await put({ FAL_KEY: '', GROQ_API_KEY: '' }).then(J), { fal: false, falFrom: null, groq: false, groqFrom: null, anthropic: false, anthropicFrom: null });
});

test('a folder from elsewhere can join the list and leave it again', async () => {
  const dir = path.join(scratch, 'elsewhere', 'by-hand'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ brand: { name: 'By hand' }, scenes: [{ type: 'end', duration: 3 }] }));
  assert.equal((await post('/api/projects/open', { dir: scratch })).status, 400);
  const { id } = await post('/api/projects/open', { dir: `"${path.join(dir, 'video.json')}"` }).then(J);      // pasted with quotes, pointing at the file
  assert.equal(id, idOf(dir));
  const found = (await fetch(u + '/api/home').then(J)).projects.find((p) => p.id === id);
  assert.equal(found.elsewhere, true); assert.equal(found.brand, 'By hand');
  await post('/api/projects/forget', { id });
  assert.ok(!(await fetch(u + '/api/home').then(J)).projects.some((p) => p.id === id));
  assert.ok(fs.existsSync(path.join(dir, 'video.json')), 'forgetting never deletes');
});

test('"Write it for me" makes the project in the background and says how it is getting on', async () => {
  const BRIEF = 'Quán cà phê Mộc ở Thủ Dầu Một, rang hạt tại quán mỗi sáng, mở cửa từ 6 giờ. Đặt qua Zalo 0900 111 222.';
  const draft = { style: 'soft', brand: { name: 'Mộc', ink: '#2A1A12', primary: '#8A4B2A', accent: '#F2C879', paper: '#FBF5EC', muted: '#7A6A5E' }, voice: { language: 'Vietnamese' }, music: { prompt: 'Warm acoustic instrumental, 100 BPM' },
    scenes: [{ type: 'footage', say: 'Sáng nay bạn uống cà phê ở đâu?', label: 'Thủ Dầu Một', title: ['Cà phê', '[[rang mộc]]'] },
      { type: 'list', say: 'Mộc rang hạt mỗi sáng và mở cửa từ sáu giờ.', title: ['Ngon từ', 'hạt mới'], items: [{ icon: 'sun', text: 'Rang mỗi sáng' }, { icon: 'clock', text: 'Mở cửa từ 6 giờ' }] },
      { type: 'chat', say: ['Nhắn Zalo cho Mộc nhé.', '{Không chín trăm, một một một, hai hai hai|0900 111 222}.'], title: 'Nhắn Mộc', messages: [{ from: 'them', text: 'Cho mình 2 ly' }, { from: 'us', text: 'Có ngay!' }], contact: { kicker: 'Zalo', number: ['0900', '111', '222'] } },
      { type: 'end', say: 'Mộc, cà phê rang mỗi sáng.', tagline: 'Cà phê rang mỗi sáng', cta: 'Nhắn Zalo đặt ngay' }] };
  let answer = JSON.stringify(draft); const asked = [];
  const w = await serve({ port: 0, ask: async (q) => { asked.push(q); return answer; } }), wu = w.url.slice(0, -1), send = (data) => fetch(wu + '/api/projects', { method: 'POST', headers: mine, body: JSON.stringify(data) });
  const wait = async (id) => { for (let i = 0; i < 200; i++) { const j = await fetch(`${wu}/api/writing/${id}`).then(J); if (j.done) return j; await new Promise((r) => setTimeout(r, 100)); } throw new Error('the writing never finished'); };
  try {
    const h = await fetch(wu + '/api/home').then(J);
    assert.equal(h.writer, 'custom'); assert.deepEqual(h.styles, ['soft', 'bold', 'classic']); assert.deepEqual(h.formats, ['tall', 'square', 'wide']);
    for (const bad of [{ name: 'x', starter: 'write' }, { name: '', starter: 'write', brief: BRIEF }, { name: 'x', starter: 'write', brief: BRIEF, style: 'neon' }, { name: 'x', starter: 'write', brief: BRIEF, format: 'round' }]) assert.equal((await send(bad)).status, 400, JSON.stringify(bad));
    assert.equal(asked.length, 0, 'nothing is asked of the model for a request that is turned down');
    const r = await send({ name: 'Quán Mộc viết hộ', starter: 'write', brief: BRIEF, format: 'square' }).then(J);
    assert.equal(r.writing, true); assert.equal(r.id, idOf(path.join(process.env.SONGBE_HOME, 'Quán Mộc viết hộ')));
    const done = await wait(r.id);
    assert.equal(done.error, null); assert.deepEqual(done.left, []);
    assert.ok(asked[0].prompt.includes(BRIEF) && asked[0].prompt.includes('square 1:1'));
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.SONGBE_HOME, 'Quán Mộc viết hộ', 'video.json'), 'utf8'));
    assert.equal(saved.format, 'square'); assert.equal(saved.voice.language, 'Vietnamese'); assert.equal(saved.scenes.length, 4);
    assert.ok((await fetch(wu + '/api/home').then(J)).projects.some((p) => p.id === r.id), 'and it is on the home screen');
    assert.deepEqual((await fetch(`${wu}/p/${r.id}/api/state`).then(J)).errors, []);
    // a model that never produces a video: the reason is reported and no empty folder is left behind
    answer = 'I am sorry, I cannot help with that.';
    const f = await send({ name: 'Không ra gì', starter: 'write', brief: BRIEF }).then(J), failed = await wait(f.id);
    assert.match(failed.error, /could not produce a valid video/);
    assert.ok(!fs.existsSync(path.join(process.env.SONGBE_HOME, 'Không ra gì')));
    assert.equal((await fetch(`${wu}/api/writing/0123456789abcdef`)).status, 404);
  } finally { w.close(); }
});

test('a project can be copied and renamed; its caches and renders stay out of the copy', async () => {
  const dir = path.join(process.env.SONGBE_HOME, 'Trống'), id = idOf(dir);
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true }); fs.writeFileSync(path.join(dir, 'out', 'video.mp4'), 'x'); fs.mkdirSync(path.join(dir, '.songbe', 'cache'), { recursive: true }); fs.writeFileSync(path.join(dir, '.songbe', 'cache', 'a.wav'), 'x');
  const copy = await post('/api/projects/duplicate', { id }).then(J);
  assert.equal(copy.name, 'Trống copy'); assert.deepEqual(fs.readdirSync(path.join(process.env.SONGBE_HOME, 'Trống copy')).sort(), ['media', 'video.json']);
  assert.equal((await post('/api/projects/duplicate', { id, name: 'Trống copy' }).then(J)).name, 'Trống copy 2', 'a taken name gets a number');
  const renamed = await post('/api/projects/rename', { id: copy.id, name: 'Bản nháp: "mới"' }).then(J);
  assert.equal(renamed.name, 'Bản nháp mới'); assert.ok(!fs.existsSync(path.join(process.env.SONGBE_HOME, 'Trống copy')) && fs.existsSync(path.join(process.env.SONGBE_HOME, 'Bản nháp mới', 'video.json')));
  assert.equal((await fetch(`${u}/p/${copy.id}/`)).status, 404, 'the old address is gone'); assert.equal((await fetch(`${u}/p/${renamed.id}/api/state`).then(J)).name, 'Bản nháp mới');
  assert.equal((await post('/api/projects/rename', { id: renamed.id, name: ' . ' })).status, 400); assert.equal((await post('/api/projects/rename', { id: '0123456789abcdef', name: 'x' })).status, 404);
  assert.ok(fs.existsSync(path.join(dir, 'out', 'video.mp4')), 'the original keeps everything');
});

test('rewriting a scene and generating footage answer plainly when there is no key', async () => {
  const id = idOf(path.join(process.env.SONGBE_HOME, 'Trống'));
  const r = await fetch(`${u}/p/${id}/api/rewrite`, { method: 'POST', headers: mine, body: JSON.stringify({ scene: 0, ask: 'Shorter.' }) });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /needs a key/);
  assert.equal((await fetch(`${u}/p/${id}/api/state`).then(J)).writer, null);
  assert.deepEqual(await fetch(`${u}/p/${id}/api/footage`).then(J), { done: true, idle: true });
  assert.equal((await fetch(`${u}/p/${id}/api/footage`, { method: 'POST', headers: mine, body: JSON.stringify({ scene: 0 }) })).status, 200);
  let f; for (let i = 0; i < 100; i++) { f = await fetch(`${u}/p/${id}/api/footage`).then(J); if (f.done) break; await new Promise((ok) => setTimeout(ok, 100)); }
  assert.equal(f.done, true); assert.match(f.error, /does not describe footage to generate/, 'the scene has no footage description: said so, nothing spent');
});

test('Linux: a menu entry that starts Songbe with this Node, and leaves when the window closes', { skip: process.platform !== 'linux' && 'Linux only' }, async () => {
  const { launcher } = await import('../src/launcher.mjs'), was = { ...process.env };
  process.env.XDG_DATA_HOME = path.join(scratch, 'share'); process.env.SONGBE_CHROME = '/bin/sh';      // stands in for a browser that can show a window
  try {
    assert.match(launcher(true), /added Songbe to the applications menu/);
    const entry = fs.readFileSync(path.join(scratch, 'share', 'applications', 'songbe.desktop'), 'utf8');
    assert.ok(entry.includes(`Exec="${process.execPath}" "${path.join(ROOT, 'bin', 'songbe.mjs')}" app --exit-with-window`) && entry.includes('Icon=songbe') && entry.includes('Terminal=false'));
    assert.ok(fs.existsSync(path.join(scratch, 'share', 'icons', 'hicolor', 'scalable', 'apps', 'songbe.svg')));
    assert.match(launcher(false), /removed/); assert.ok(!fs.existsSync(path.join(scratch, 'share', 'applications', 'songbe.desktop')));
  } finally { process.env.XDG_DATA_HOME = was.XDG_DATA_HOME; if (was.SONGBE_CHROME === undefined) delete process.env.SONGBE_CHROME; else process.env.SONGBE_CHROME = was.SONGBE_CHROME; if (was.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME; tools.reset(); }
});

let ready = true; try { tools.chrome; tools.ffmpeg; tools.ffprobe; } catch { ready = false; }
test('every project gets a poster of its opening scene', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  let h;
  for (let i = 0; i < 90; i++) { h = await fetch(u + '/api/home').then(J); if (h.projects.every((p) => p.poster.state !== 'pending')) break; await new Promise((r) => setTimeout(r, 500)); }
  for (const p of h.projects) {
    assert.equal(p.poster.state, 'ready', p.name);
    const r = await fetch(u + p.poster.url); assert.equal(r.headers.get('content-type'), 'image/jpeg');
    const b = Buffer.from(await r.arrayBuffer()); assert.ok(b.length > 4000 && b[0] === 0xff && b[1] === 0xd8, `${p.name}: a real picture`);
  }
});

// The editor itself, in a real browser: what a person does with the mouse.
test('clicking words in the preview puts the cursor in their field; undo and redo walk the saved states', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  const { openPage } = await import('../src/render.mjs');
  const { id } = await post('/api/projects', { name: 'Bấm để sửa', starter: 'sale-vi' }).then(J);
  const page = await openPage(`${u}/p/${id}/`, [1440, 900]), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (what, expr) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(expr).catch(() => false)) return; await wait(150); } assert.fail('never happened: ' + what); };
  try {
    await until('the preview is drawn', `!!document.querySelector('#pv')?.contentDocument?.querySelector('#s0 .hl') && !!document.querySelector('#strip div')`);
    // the highlighted words of the first scene's headline
    await page.evaluate(`document.querySelector('#pv').contentDocument.querySelector('#s0 .hl').click()`);
    await until('the headline box has the cursor', `document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.closest('[data-path]')?.dataset.path === 'title'`);
    assert.equal(await page.evaluate(`document.activeElement.value.slice(document.activeElement.selectionStart, document.activeElement.selectionEnd)`), 'có ngay', 'and the clicked words are selected');
    // a scene that is not open: show it, click its price
    await page.evaluate(`document.querySelectorAll('#strip div')[1].click()`); await wait(700);
    await page.evaluate(`document.querySelector('#pv').contentDocument.querySelector('#s1 .pr span').click()`);
    await until('the price box of scene 2 has the cursor', `document.activeElement?.closest('[data-path]')?.dataset.path === 'price' && document.querySelector('.card.open .n').textContent === '2'`);
    // change it, wait for the save, undo, redo
    await page.evaluate(`(() => { const b = document.activeElement; b.value = '19k'; b.dispatchEvent(new Event('input', { bubbles: true })); b.blur(); })()`);
    const saved = () => JSON.parse(fs.readFileSync(path.join(process.env.SONGBE_HOME, 'Bấm để sửa', 'video.json'), 'utf8')).scenes[1].price;
    for (let i = 0; i < 60 && saved() !== '19k'; i++) await wait(100); assert.equal(saved(), '19k');
    assert.equal(await page.evaluate(`document.querySelector('#undo').disabled`), false);
    await page.evaluate(`document.querySelector('#undo').click()`); for (let i = 0; i < 60 && saved() !== '25k'; i++) await wait(100); assert.equal(saved(), '25k', 'undo restores the file');
    await page.evaluate(`document.querySelector('#redo').click()`); for (let i = 0; i < 60 && saved() !== '19k'; i++) await wait(100); assert.equal(saved(), '19k', 'redo brings the change back');
    assert.equal(await page.evaluate(`document.querySelector('#redo').disabled`), true);
  } finally { await page.close(); }
});
