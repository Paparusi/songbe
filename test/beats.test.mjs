// Finding the beat of a track and moving cuts onto it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onsets, grid, snapCuts, beatsOf } from '../src/beats.mjs';
import { makePlan } from '../src/plan.mjs';
import { tools } from '../src/util.mjs';

// a click on every beat over a bed of noise
function clicks(bpm, offset, seconds, rate = 22050) {
  const x = new Float32Array(rate * seconds); let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - .5);
  for (let i = 0; i < x.length; i++) x[i] = rnd() * .05;
  for (let t = offset; t < seconds; t += 60 / bpm) { const at = Math.round(t * rate); for (let i = 0; i < 1200 && at + i < x.length; i++) x[at + i] += Math.sin(2 * Math.PI * 90 * i / rate) * Math.exp(-i / 260) * .9; }
  return x;
}
function wav(file, x, rate = 22050) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, b);
}
const offBeat = (t, { first, period }) => { const k = Math.round((t - first) / period); return Math.abs(t - (first + k * period)); };

for (const [bpm, offset] of [[96, .137], [120, .31], [140, .05]]) {
  test(`a ${bpm} BPM pulse is found, with its phase`, () => {
    const found = grid(onsets(clicks(bpm, offset, 24)));
    assert.ok(Math.abs(found.bpm - bpm) < bpm * .004, `tempo ${found.bpm}`);
    assert.ok(offBeat(offset, found) < .03, `first beat ${found.first} against ${offset}`);
    assert.ok(found.confidence > 4);
  });
}

test('noise has no beat to speak of', () => {
  let seed = 3; const x = Float32Array.from({ length: 22050 * 12 }, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - .5) * .3);
  assert.ok(grid(onsets(x)).confidence < 4);
});

test('cuts move to the next beat, or to one just before when it is close', () => {
  const beat = { period: .5, first: .2 };
  assert.deepEqual(snapCuts([2.6], beat), [{ at: 2.7, delay: .1 }]);                       // next beat, everything after pushed back
  assert.deepEqual(snapCuts([2.8], beat), [{ at: 2.7, delay: 0 }]);                        // a beat 0.1 s earlier: the cut alone moves
  assert.deepEqual(snapCuts([2.6, 6.9, 9.94], beat), [{ at: 2.7, delay: .1 }, { at: 7.2, delay: .3 }, { at: 10.2, delay: .3 }]);
  for (const { at } of snapCuts([1.03, 4.4, 7.77, 13.1], { period: .5558, first: .232 })) assert.ok(offBeat(at, { period: .5558, first: .232 }) < .002);
});

test('with music in the project every cut is on a beat and no line is cut into', { skip: (() => { try { tools.ffmpeg; return false; } catch { return 'ffmpeg not found'; } })() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-beat-')); fs.mkdirSync(path.join(dir, 'media'));
  try {
    wav(path.join(dir, 'media', 'pulse.wav'), clicks(100, .21, 30));
    const spec = { brand: { name: 'Pulse' }, voice: false, music: { file: 'media/pulse.wav' }, scenes: [
      { type: 'end', say: 'A first line of some length.' }, { type: 'list', say: 'Then a second one, a little longer than the first.', title: 'Two', items: [{ text: 'One' }] },
      { type: 'end', say: 'And a third.' }, { type: 'end', duration: 3 }] };
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(spec));
    const plan = await makePlan(dir, { offline: true });
    assert.ok(Math.abs(plan.beats.bpm - 100) < .5, `tempo ${plan.beats.bpm}`);
    for (const c of plan.cuts) assert.ok(offBeat(c, plan.beats) < .003, `cut at ${c}`);
    plan.scenes.forEach((sc, i) => { for (const s of sc.say) { assert.ok(s.start >= sc.start, `scene ${i + 1} speaks after its cut`); assert.ok(s.end <= sc.end + .001, `scene ${i + 1} finishes before the next cut`); } });
    // and the same project with syncing turned off keeps the voice's own timing
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...spec, music: { file: 'media/pulse.wav', sync: false } }));
    const free = await makePlan(dir, { offline: true });
    assert.equal(free.beats, null);
    assert.ok(free.duration <= plan.duration);
    assert.equal(beatsOf(path.join(dir, 'media', 'pulse.wav'), path.join(dir, '.songbe', 'cache')).bpm, plan.beats.bpm, 'the analysis is cached');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
