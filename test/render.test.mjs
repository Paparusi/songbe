// Drawing: the bundled examples must pass the layout check in every frame and look, and a still must come out at the right size.
// Needs Chrome and ffmpeg; skipped when they are not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePlan } from '../src/plan.mjs';
import { lintLayout, stills, openPage, writePage, pageHtml } from '../src/render.mjs';
import { FORMATS, STYLES } from '../src/spec.mjs';
import { tools, run, ROOT } from '../src/util.mjs';

const root = ROOT;
let ready = true; try { tools.chrome; tools.ffmpeg; tools.ffprobe; } catch { ready = false; }
const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-draw-'));
const copy = (name) => { const to = path.join(copies, name); if (!fs.existsSync(to)) fs.cpSync(path.join(root, 'examples', name), to, { recursive: true, filter: (f) => !/[\\/](\.songbe|out)([\\/]|$)/.test(f) }); return to; };
test.after(() => fs.rmSync(copies, { recursive: true, force: true }));
delete process.env.FAL_KEY;

for (const name of ['app-launch-en', 'recruitment-vi']) for (const format of Object.keys(FORMATS)) for (const style of STYLES) {
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
