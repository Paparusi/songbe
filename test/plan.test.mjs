// Planning without any key: timelines, frames and captions for the bundled examples, on copies so the repository stays clean.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, tools } from '../src/util.mjs';
import { makePlan } from '../src/plan.mjs';
import { FORMATS } from '../src/spec.mjs';

const root = ROOT;
const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-test-'));
const copy = (name) => { const to = path.join(copies, name); if (!fs.existsSync(to)) fs.cpSync(path.join(root, 'examples', name), to, { recursive: true, filter: (f) => !/[\\/](\.songbe|out)([\\/]|$)/.test(f) }); return to; };
test.after(() => fs.rmSync(copies, { recursive: true, force: true }));
delete process.env.FAL_KEY;                      // these tests must never spend anything
// the example with footage needs ffmpeg to cut its frames; the one without runs anywhere
let ffmpeg = true; try { tools.ffmpeg; tools.ffprobe; } catch { ffmpeg = false; }
const needs = (name) => ({ skip: name === 'recruitment-vi' && !ffmpeg && 'ffmpeg not found' });

for (const name of ['app-launch-en', 'recruitment-vi']) {
  test(`${name}: scenes follow one another without gaps`, needs(name), async () => {
    const plan = await makePlan(copy(name), { offline: true });
    assert.equal(plan.scenes[0].start, 0);
    for (let i = 1; i < plan.scenes.length; i++) assert.equal(plan.scenes[i].start, plan.scenes[i - 1].end, `scene ${i + 1}`);
    assert.equal(plan.scenes.at(-1).end, plan.duration);
    assert.deepEqual(plan.cuts, plan.scenes.slice(1).map((s) => s.start));
    for (const sc of plan.scenes) for (const s of sc.say) { assert.ok(s.start >= sc.start - 0.001 && s.end <= sc.end + 0.001, `"${s.text}" lies inside its scene`); assert.ok(s.end > s.start); }
    assert.ok(plan.notes.some((n) => n.includes('not generated yet')), 'says that the timing is an estimate');
  });

  test(`${name}: the same timeline in every frame`, needs(name), async () => {
    const tall = await makePlan(copy(name), { offline: true });
    for (const format of Object.keys(FORMATS)) {
      const plan = await makePlan(copy(name), { offline: true, format });
      assert.deepEqual(plan.size, FORMATS[format]);
      assert.equal(plan.tag, '-' + format);
      assert.equal(plan.duration, tall.duration);
      assert.deepEqual(plan.cuts, tall.cuts);
    }
  });

  test(`${name}: captions cover the speech and nothing else`, needs(name), async () => {
    const off = await makePlan(copy(name), { offline: true }), on = await makePlan(copy(name), { offline: true, captions: true });
    assert.equal(off.captions.length, 0);
    assert.ok(on.captions.length >= on.scenes.length);
    for (let i = 0; i < on.captions.length; i++) {
      const c = on.captions[i];
      assert.ok(c.start >= 0 && c.end <= on.duration && c.end > c.start);
      if (i) assert.ok(c.start >= on.captions[i - 1].start);
    }
    const shown = on.scenes.flatMap((sc) => sc.say.map((s) => s.show)).join(' ');
    assert.equal(on.captions.map((c) => c.words.map((w) => w.text).join(' ')).join(' '), shown);
  });
}

test('a portrait clip in a wide frame is kept whole at the side; in a square one the crop leans upward', needs('recruitment-vi'), async () => {
  const dir = copy('recruitment-vi');
  const wide = await makePlan(dir, { offline: true, format: 'wide' }), square = await makePlan(dir, { offline: true, format: 'square' }), tall = await makePlan(dir, { offline: true });
  assert.equal(wide.scenes[0].media.fit, 'side');
  assert.ok(wide.scenes[0].media.ratio < 0.9);
  assert.equal(square.scenes[0].media.fit, 'cover');
  assert.equal(tall.scenes[0].media.fit, 'cover');
  assert.ok(tall.scenes[0].media.count > 30, 'frames were cut for the scene');
});

test('a broken spec stops planning with every problem listed', async () => {
  const dir = path.join(copies, 'broken'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ brand: {}, scenes: [{ type: 'lst', say: 'x' }, { type: 'card', say: 'y' }] }));
  await assert.rejects(makePlan(dir, { offline: true }), (e) => e.message.includes('2 problems') && e.message.includes('"list"') && e.message.includes('scenes[1].title: required'));
});
