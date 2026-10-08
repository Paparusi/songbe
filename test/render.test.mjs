// Drawing: the bundled examples must pass the layout check in every frame and look, and a still must come out at the right size.
// Needs Chrome and ffmpeg; skipped when they are not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePlan } from '../src/plan.mjs';
import { lintLayout, stills } from '../src/render.mjs';
import { FORMATS, STYLES } from '../src/spec.mjs';
import { tools, run } from '../src/util.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
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

test('a still has the size of its frame', { skip: !ready && 'Chrome or ffmpeg not found' }, async () => {
  for (const [format, [w, h]] of Object.entries(FORMATS)) {
    const { files } = await stills(copy('app-launch-en'), await makePlan(copy('app-launch-en'), { offline: true, format }), [1.5]);
    const size = run(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', files[0]]).trim();
    assert.equal(size, `${w},${h}`, format);
  }
});
