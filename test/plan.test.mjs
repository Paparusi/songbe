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

for (const name of ['app-launch-en', 'recruitment-vi', 'sale-vi']) {
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
    const off = await makePlan(copy(name), { offline: true, captions: false }), on = await makePlan(copy(name), { offline: true, captions: true });
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

// One adapter for every model on fal.ai: what Songbe wants to say, under the names and within the choices each model has.
test('a request is shaped to what each model takes', async () => {
  const { requestFor } = await import('../src/providers/fal.mjs');
  const o = (...options) => ({ options, object: false }), any = { options: null, object: false };
  const ultra = { prompt: any, seed: any, num_images: any, raw: any, aspect_ratio: o('21:9', '16:9', '1:1', '9:16'), output_format: o('jpeg', 'png') };
  assert.deepEqual(requestFor(ultra, { kind: 'image', prompt: 'a bowl', aspect: '9:16', seed: 41 }), { prompt: 'a bowl', aspect_ratio: '9:16', seed: 41, num_images: 1, output_format: 'jpeg', raw: true });
  const sized = { prompt: any, image_size: o('square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_16_9'), enable_safety_checker: any };
  assert.equal(requestFor(sized, { kind: 'image', prompt: 'p', aspect: '9:16' }).image_size, 'portrait_16_9');
  assert.equal(requestFor(sized, { kind: 'image', prompt: 'p', aspect: '1:1' }).image_size, 'square_hd', 'the larger of two equal shapes');
  assert.equal(requestFor(sized, { kind: 'image', prompt: 'p', aspect: '16:9' }).image_size, 'landscape_16_9');
  assert.equal(requestFor({ prompt: any, aspect_ratio: o('16:9', '4:3', '2:3', '3:4') }, { kind: 'image', prompt: 'p', aspect: '9:16' }).aspect_ratio, '2:3', 'the nearest shape there is');
  const clip = { prompt: any, image_url: any, aspect_ratio: o('auto', '16:9', '9:16'), duration: o('4s', '6s', '8s'), resolution: o('720p', '1080p'), generate_audio: any, camera_fixed: any };
  assert.deepEqual(requestFor(clip, { kind: 'video', prompt: 'steam rises', image: 'data:x', aspect: '1:1', seconds: 5, resolution: '1080p' }),
    { prompt: 'steam rises', image_url: 'data:x', aspect_ratio: 'auto', duration: '6s', resolution: '1080p', camera_fixed: false, generate_audio: false }, 'the picture sets the shape, the shortest long-enough length, no sound of its own');
  assert.equal(requestFor({ prompt: any, image_url: any, duration: o('5', '10'), resolution: o('512P', '768P') }, { kind: 'video', prompt: 'p', image: 'd', seconds: 12, resolution: '1080p' }).duration, '10', 'the longest when none is long enough');
  assert.equal(requestFor({ prompt: any, image_url: any, resolution: o('512P', '768P') }, { kind: 'video', prompt: 'p', image: 'd', resolution: '1080p' }).resolution, '768P', 'the best below what was asked');
  assert.deepEqual(requestFor({ prompt: any, duration: any }, { kind: 'music', prompt: 'guitar', avoid: 'vocals', seconds: 30 }), { prompt: 'guitar', duration: 30 });
  assert.deepEqual(requestFor({ prompt: any, negative_prompt: any, seed: any }, { kind: 'music', prompt: 'guitar', avoid: 'vocals', seed: 808 }), { prompt: 'guitar', seed: 808, negative_prompt: 'vocals' });
});
