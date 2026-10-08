// plan → sound. Voice clips are placed on the timeline, music ducks under the voice, and light interface-style sound
// effects are synthesised here from the cue list the page reported (so they always land on the animation).
import fs from 'node:fs';
import path from 'node:path';
import * as fal from './providers/fal.mjs';
import { run, sha, mkdir, exists, tools, log } from './util.mjs';

const SR = 48000;

// ---- tiny synth ----
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const noise = (r) => (r() + r() + r() - 1.5) * 1.6;               // roughly gaussian
const time = (d) => Float64Array.from({ length: Math.floor(d * SR) }, (_, i) => i / SR);
function whoosh(r, d) {                                           // filtered noise that opens and closes
  const x = time(d), y = new Float64Array(x.length); let p = 0;
  for (let i = 0; i < x.length; i++) {
    const k = x[i] / d, a = k < .6 ? .02 + (.25 - .02) * (k / .6) : .25 + (.04 - .25) * ((k - .6) / .4);
    p += a * (noise(r) - p); y[i] = p * Math.sin(Math.PI * k) ** 2 * 1.6;
  }
  return y;
}
function pop() { const x = time(.09), y = new Float64Array(x.length); let ph = 0; for (let i = 0; i < x.length; i++) { ph += 2 * Math.PI * (500 + 1400 * x[i] / .09) / SR; y[i] = Math.sin(ph) * Math.exp(-x[i] * 45); } return y; }
function tap(r) { const x = time(.05); return x.map((t) => Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t * 160) + noise(r) * Math.exp(-t * 400) * .3); }
function ding() {
  const x = time(.9), k = Math.floor(.13 * SR);
  return x.map((t, i) => (Math.sin(2 * Math.PI * 1318 * t) + .4 * Math.sin(2 * Math.PI * 2636 * t)) * Math.exp(-t * 5)
    + (i >= k ? (Math.sin(2 * Math.PI * 1760 * x[i - k]) + .4 * Math.sin(2 * Math.PI * 3520 * x[i - k])) * Math.exp(-x[i - k] * 4.5) : 0));
}
const MAKE = { whoosh: (r) => [whoosh(r, .62), .32], swish: (r) => [whoosh(r, .42), .21], pop: () => [pop(), .32], tap: (r) => [tap(r), .45], ding: () => [ding(), .30] };

function effects(cues, total, file) {
  const n = Math.floor(total * SR), L = new Float64Array(n), R = new Float64Array(n), r = rng(5);
  for (const c of cues) {
    if (!MAKE[c.kind] || c.t < 0) continue;
    const [s, g] = MAKE[c.kind](r), gain = g * (c.gain ?? 1) * .3, pan = c.kind === 'tap' ? (r() - .5) * .6 : 0, i0 = Math.floor(c.t * SR);
    for (let i = 0; i < s.length && i0 + i < n; i++) { L[i0 + i] += s[i] * gain * Math.sqrt(1 - pan); R[i0 + i] += s[i] * gain * Math.sqrt(1 + pan); }
  }
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  const q = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(q(L[i]), 44 + i * 4); buf.writeInt16LE(q(R[i]), 46 + i * 4); }
  fs.writeFileSync(file, buf);
}

export async function makeAudio(dir, plan) {
  const work = path.join(dir, '.songbe'), cache = mkdir(path.join(work, 'cache')), out = mkdir(path.join(dir, 'out')), D = plan.duration;
  const cues = JSON.parse(fs.readFileSync(path.join(work, 'cues.json'), 'utf8'));
  const sfx = path.join(work, 'effects.wav'); effects(cues, D, sfx);

  const voice = plan.scenes.flatMap((s) => s.say).filter((s) => s.file);
  let music = null;
  if (plan.music?.file) music = path.resolve(dir, plan.music.file);
  else if (plan.music?.prompt) {                       // reuse a cached track even when no key is set
    const file = path.join(cache, `music-${sha(['music', plan.music])}.wav`);
    if (!exists(file) && fal.available()) { log('  music:', plan.music.prompt.slice(0, 70) + '…'); await fal.music(plan.music.prompt, plan.music, file); }
    if (exists(file)) music = file;
  }

  const inputs = ['-i', sfx], f = []; let idx = 1, mix = [];
  if (voice.length) {
    voice.forEach((s, i) => { inputs.push('-i', s.file); const ms = Math.round(s.start * 1000); f.push(`[${idx + i}]adelay=${ms}|${ms}[s${i}]`); });
    f.push(`${voice.map((_, i) => `[s${i}]`).join('')}amix=inputs=${voice.length}:normalize=0,apad,atrim=0:${D},asplit[v][vk]`); idx += voice.length;
  }
  if (music) {
    inputs.push('-i', music);
    f.push(`[${idx}]atrim=0:${D},asetpts=PTS-STARTPTS,volume=${plan.music.volume ?? 0.5},afade=t=in:d=0.15,afade=t=out:st=${(D - 1.6).toFixed(2)}:d=1.6[m0]`);
    f.push(voice.length ? '[m0][vk]sidechaincompress=threshold=0.025:ratio=7:attack=8:release=260[m]' : '[m0]anull[m]');
    mix.push('[m]');
  } else if (voice.length) f.push('[vk]anullsink');
  if (voice.length) mix.push('[v]');
  mix.push('[0]');
  const weights = mix.map((x) => (x === '[v]' ? 1.2 : 1)).join(' ');
  // effects alone are already at a sensible level; with voice or music the programme is normalised to −14 LUFS
  f.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:weights=${weights}${voice.length || music ? ',loudnorm=I=-14:TP=-1.5:LRA=11' : ''}[o]`);
  const file = path.join(out, 'audio.wav');
  run(tools.ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', f.join(';'), '-map', '[o]', '-t', String(D), '-ar', String(SR), '-ac', '2', file]);
  return { file, voice: voice.length, music: !!music };
}

export function mux(dir, plan) {
  const out = path.join(dir, 'out', `video${plan.tag || ''}.mp4`);
  run(tools.ffmpeg, ['-v', 'error', '-y', '-i', path.join(dir, '.songbe', 'picture.mp4'), '-i', path.join(dir, 'out', 'audio.wav'), '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-ac', '2', '-t', String(plan.duration), '-movflags', '+faststart', out]);
  return out;
}
