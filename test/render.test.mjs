// Drawing: the bundled examples must pass the layout check in every frame and look, and a still must come out at the right size.
// Needs Chrome and ffmpeg; skipped when they are not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePlan } from '../src/plan.mjs';
import { lintLayout, stills, openPage, writePage, pageHtml } from '../src/render.mjs';
import { FORMATS, STYLES, TEMPLATES } from '../src/spec.mjs';
import { tools, run, ROOT } from '../src/util.mjs';
import { fitTable } from '../src/fit.mjs';

const root = ROOT;
let ready = true; try { tools.chrome; tools.ffmpeg; tools.ffprobe; } catch { ready = false; }
const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-draw-'));
const copy = (name) => { const to = path.join(copies, name); if (!fs.existsSync(to)) fs.cpSync(path.join(root, 'examples', name), to, { recursive: true, filter: (f) => !/[\\/](\.songbe|out)([\\/]|$)/.test(f) }); return to; };
test.after(() => fs.rmSync(copies, { recursive: true, force: true }));
delete process.env.FAL_KEY;

for (const name of ['app-launch-en', 'recruitment-vi', 'sale-vi']) for (const format of Object.keys(FORMATS)) for (const style of STYLES) {
  test(`${name} · ${format} · ${style}: nothing leaves the frame, overlaps or is covered by captions`, { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
    for (const captions of [true, false]) {
      const found = await lintLayout(copy(name), await makePlan(copy(name), { offline: true, format, style, captions }));
      assert.deepEqual(found.filter((f) => f.level === 'problem').map((f) => `scene ${f.scene}: ${f.message}`), [], captions ? 'with captions' : 'without captions');
    }
  });
}

test('the layout check notices text that cannot fit', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  const dir = path.join(copies, 'crowded'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ brand: { name: 'Crowded' }, scenes: [{ type: 'list', duration: 4, title: ['Too', 'many', 'rows'],
    items: Array.from({ length: 5 }, (_, i) => ({ text: `Benefit number ${i + 1} with a very long name that keeps going and going`, sub: 'More words underneath it' })) }] }));
  const found = await lintLayout(dir, await makePlan(dir, { offline: true }));
  assert.ok(found.some((f) => f.message.includes('shrunk')), 'reports the shrunken type');
  assert.equal(found.filter((f) => f.level === 'problem').length, 0, 'but the rows were squeezed to stay inside the frame');
});

test('any size is the same design drawn larger or smaller', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  const dir = path.join(copies, 'sizes'); fs.cpSync(path.join(root, 'examples', 'app-launch-en'), dir, { recursive: true, filter: (f) => !/[\\/](\.songbe|out)([\\/]|$)/.test(f) });
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
  for (const size of [[540, 960], [1440, 2560], [1280, 720], [720, 720]]) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...spec, size, captions: true }));
    const plan = await makePlan(dir, { offline: true }), found = await lintLayout(dir, plan);
    assert.deepEqual(found.map((f) => f.message), [], size.join('×'));
    const { files } = await stills(dir, plan, [1.5]);
    assert.equal(run(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', files[0]]).trim(), size.join(','));
  }
});

test('a still has the size of its frame', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  for (const [format, [w, h]] of Object.entries(FORMATS)) {
    const { files } = await stills(copy('app-launch-en'), await makePlan(copy('app-launch-en'), { offline: true, format }), [1.5]);
    const size = run(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', files[0]]).trim();
    assert.equal(size, `${w},${h}`, format);
  }
});

// A project can come from anywhere: a shared folder, a download, an agent. Its words must stay words.
test('text from a spec never becomes markup', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  const X = '"><img src=x onerror="window.__pwned=1"></title></script><script>window.__pwned=2</script>';
  const dir = path.join(copies, 'hostile'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ captions: true, brand: { name: 'B' + X }, scenes: [
    { type: 'footage', say: 'One ' + X, label: X, labelStyle: 'pill', title: ['T' + X, '[[' + X + ']] **' + X + '**'], sub: X, chip: X, notice: X },
    { type: 'card', say: 'Two', label: X, title: X, caption: X, stat: { badge: X, heading: X, sub: X } },
    { type: 'list', say: 'Three', label: X, title: X, items: [{ text: X, sub: X, icon: 'check' + X }, { text: 'second', icon: 'number' }] },
    { type: 'phone', say: 'Four', label: X, title: X, callouts: [{ text: X, side: 'left', y: 0.3 }] },
    { type: 'chat', say: 'Five', label: X, title: X, messages: [{ from: 'them', text: X }, { from: 'us', text: X }], contact: { kicker: X, button: X, number: [X, '00'], sub: X }, footer: { name: X, line: X } },
    { type: 'end', say: 'Six', name: X, tagline: X, cta: X, badges: [X], url: X }] }));
  const plan = await makePlan(dir, { offline: true }), html = pageHtml(plan, (f) => 'file://' + f);
  assert.ok(!html.includes('<script>window.__pwned') && !html.includes('<img src=x'), 'the page itself carries the text only as data');
  const page = await openPage(writePage(dir, plan), plan.size);
  try {
    for (const sc of plan.scenes) await page.evaluate(`SB.draw(${(sc.start + (sc.end - sc.start) * .8).toFixed(2)})`);
    const seen = JSON.parse(await page.evaluate(`JSON.stringify({ ran: window.__pwned ?? null, images: document.querySelectorAll('img[src=x]').length, handlers: document.querySelectorAll('[onerror]').length, scripts: document.querySelectorAll('#stage script').length })`));
    assert.deepEqual(seen, { ran: null, images: 0, handlers: 0, scripts: 0 });
  } finally { await page.close(); }
});

// The promise behind "it checks its own work": words that cannot fit are never drawn badly in silence.
const WORDS = 'Tuyển công nhân sản xuất chế độ đầy đủ đi làm ngay gần nhà bạn không mất bất kỳ khoản phí nào hết nhé các anh chị em ơi mau mau đăng ký ngay hôm nay kẻo lỡ dịp may hiếm có này';
const long = (key, style) => WORDS.slice(0, Math.max(150, fitTable()[key][style] * 3));      // far beyond what any one-line place can hold
const PLACES = {      // one scene per one-line text field, with that field hopelessly long (chat messages wrap by design and have their own test)
  footage: { base: { type: 'footage', duration: 5, label: 'Nhãn', title: ['Tiêu đề', 'ngắn'] }, put: { label: (s, t) => { s.label = t; }, title: (s, t) => { s.title = [t, 'ngắn']; }, sub: (s, t) => { s.sub = t; }, chip: (s, t) => { s.chip = t; } } },
  card: { base: { type: 'card', duration: 5, title: ['Tiêu đề', 'ngắn'], stat: { badge: '24h', heading: 'Đề mục', sub: 'Dòng phụ' } }, put: { label: (s, t) => { s.label = t; }, title: (s, t) => { s.title = ['Tiêu đề', t]; }, 'stat.heading': (s, t) => { s.stat.heading = t; }, 'stat.sub': (s, t) => { s.stat.sub = t; } } },
  list: { base: { type: 'list', duration: 5, title: ['Tiêu đề', 'ngắn'], items: [{ text: 'Một', sub: 'Phụ' }, { text: 'Hai', sub: 'Phụ' }] }, put: { 'items.text': (s, t) => { s.items[0].text = t; }, 'items.sub': (s, t) => { s.items[1].sub = t; } } },
  phone: { base: { type: 'phone', duration: 5, title: ['Tiêu đề', 'ngắn'], callouts: [{ text: 'Ngắn', side: 'right', y: 0.3 }] }, put: { 'callouts.text': (s, t) => { s.callouts[0].text = t; } } },
  chat: { base: { type: 'chat', duration: 9, title: 'Tiêu đề', messages: [{ from: 'them', text: 'Chào' }, { from: 'us', text: 'Dạ' }], contact: { kicker: 'Zalo', button: 'Nhắn', number: ['0900', '000', '000'], sub: 'Phụ' }, footer: { name: 'Tên', line: 'Dòng' } },
    put: { 'contact.kicker': (s, t) => { s.contact.kicker = t; }, 'contact.button': (s, t) => { s.contact.button = t; }, 'contact.sub': (s, t) => { s.contact.sub = t; }, 'footer.name': (s, t) => { s.footer.name = t; }, 'footer.line': (s, t) => { s.footer.line = t; } } },
  offer: { base: { type: 'offer', duration: 5, title: ['Tiêu đề', 'ngắn'], price: '-20%' }, put: { price: (s, t) => { s.price = t; }, was: (s, t) => { s.was = t; }, terms: (s, t) => { s.terms = t; }, code: (s, t) => { s.code = t; } } },
  photos: { base: { type: 'photos', duration: 5, title: ['Tiêu đề', 'ngắn'], photos: [{ caption: 'Một' }, { caption: 'Hai' }] }, put: { caption: (s, t) => { s.photos[0].caption = t; } } },
  quote: { base: { type: 'quote', duration: 6, quote: 'Lời khen ngắn.', name: 'Tên', role: 'Vai' }, put: { name: (s, t) => { s.name = t; }, role: (s, t) => { s.role = t; } } },
  end: { base: { type: 'end', duration: 5, name: 'Tên', tagline: 'Khẩu hiệu', cta: 'Bấm' }, put: { name: (s, t) => { s.name = t; }, tagline: (s, t) => { s.tagline = t; }, cta: (s, t) => { s.cta = t; }, badges: (s, t) => { s.badges = [t, t]; }, url: (s, t) => { s.url = t; } } },
};
for (const style of STYLES) {
  test(`${style}: text far too long for its place is always reported, never drawn badly in silence`, { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
    const dir = path.join(copies, 'overlong-' + style), trials = [];
    for (const [type, { base, put }] of Object.entries(PLACES)) for (const [field, set] of Object.entries(put)) { const scene = structuredClone(base); set(scene, long(`${type}.${field}`, style)); trials.push({ at: `${type}.${field}`, scene }); }
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ style, voice: false, music: false, brand: { name: 'Dài' }, scenes: trials.map((t) => t.scene) }));
    const found = await lintLayout(dir, await makePlan(dir, { offline: true }));
    const silent = trials.filter((t, i) => !found.some((f) => f.scene === i + 1 && !f.message.includes('placeholder'))).map((t) => t.at);
    assert.deepEqual(silent, []);
  });
}

test('a chat with long messages stays whole in every frame and look', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  const dir = path.join(copies, 'talk'); fs.mkdirSync(dir, { recursive: true });
  const scene = { type: 'chat', duration: 9, label: 'Đặt trước', title: ['Nhắn', 'cho Mộc'], messages: [{ from: 'them', text: 'Chị ơi cho em đặt 12 ly cà phê sữa đá giao lên xưởng B lúc 9 giờ sáng mai được không ạ?' }, { from: 'us', text: 'Dạ được em nhé! Chị giao tận xưởng, em cho chị xin số người nhận.' }],
    contact: { kicker: 'Zalo', button: 'Nhắn tin', number: ['0900', '111', '222'], sub: 'Giao miễn phí trong khu' }, footer: { name: 'Cà phê Mộc', line: 'Rang tươi mỗi sáng' } };
  for (const style of STYLES) for (const format of Object.keys(FORMATS)) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ style, format, voice: false, music: false, brand: { name: 'Mộc' }, scenes: [scene] }));
    const found = await lintLayout(dir, await makePlan(dir, { offline: true }));
    assert.deepEqual(found.filter((f) => f.level === 'problem').map((f) => f.message), [], `${style} ${format}`);
  }
});

test('a phone with no screenshot draws a placeholder and says so', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  const dir = path.join(copies, 'bare-phone'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice: false, music: false, brand: { name: 'x' }, scenes: [{ type: 'phone', duration: 4, title: ['Đặt qua', 'điện thoại'] }] }));
  const found = await lintLayout(dir, await makePlan(dir, { offline: true }));
  assert.deepEqual(found.map((f) => [f.level, f.message.includes('placeholder')]), [['note', true]]);
});

test('every scene type, as the editor inserts it, is clean in every frame and look', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  const dir = path.join(copies, 'templates'); fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.copyFileSync(path.join(root, 'examples', 'app-launch-en', 'media', 'screen-today.png'), path.join(dir, 'media', 'p.png'));
  const scenes = Object.values(TEMPLATES).map((t) => { const sc = structuredClone(t); sc.duration = 6; delete sc.say; if (sc.type === 'phone') sc.screens = ['media/p.png']; if (sc.type === 'photos') sc.photos = sc.photos.map((p) => ({ ...p, src: 'media/p.png' })); return sc; });
  for (const style of STYLES) for (const format of Object.keys(FORMATS)) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ style, format, voice: false, music: false, brand: { name: 'Mẫu' }, scenes }));
    const found = await lintLayout(dir, await makePlan(dir, { offline: true }));
    assert.deepEqual(found.filter((f) => f.level === 'problem').map((f) => `${f.type}: ${f.message}`), [], `${style} ${format}`);
  }
});
