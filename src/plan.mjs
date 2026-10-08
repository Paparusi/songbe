// video.json → plan: generate the voice, lay scenes out on a timeline that follows the spoken lines, and prepare footage.
// Everything generated is cached under <project>/.songbe/cache by a hash of its inputs, so editing one line only redoes that line.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as fal from './providers/fal.mjs';
import { run, sha, mkdir, exists, tools, duration, log } from './util.mjs';
import { validate } from './spec.mjs';

const GAP = 0.35;          // pause between sentences
const LEAD = 0.25;         // silence before the first word
const VIDEO = /\.(mp4|mov|webm|mkv)$/i;
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const url = (f) => pathToFileURL(f).href;

export async function makePlan(dir, opts = {}) {
  let spec;
  try { spec = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')); } catch (e) { throw new Error('video.json is not valid JSON: ' + e.message); }
  const errs = validate(spec, dir);
  if (errs.length) throw new Error(`video.json has ${errs.length} problem${errs.length > 1 ? 's' : ''}:\n  - ` + errs.join('\n  - '));
  const work = mkdir(path.join(dir, '.songbe')), cache = mkdir(path.join(work, 'cache'));
  const size = spec.size || [1080, 1920], fps = spec.fps || 30;
  const notes = [];

  // ---- voice: one clip per sentence, silence trimmed ----
  // offline (studio preview): never call a provider; use what is cached and estimate the rest from the text
  const wantVoice = spec.voice !== false, canGen = fal.available() && !opts.offline;
  let pending = 0;
  const scenes = [];
  for (const sc of spec.scenes) {
    const say = [];
    for (const text of list(sc.say)) {
      let file = null, dur = Math.max(1.6, text.length / 15);
      if (wantVoice) {
        const v = spec.voice || {}, id = sha(['vo', text, v]);
        const raw = path.join(cache, `vo-${id}.mp3`), wav = path.join(cache, `vo-${id}.wav`);
        if (canGen && (!exists(raw) || opts.force)) { log('  voice:', text); await fal.speak(text, v, raw); }
        if (exists(raw)) {
          if (!exists(wav) || opts.force) {
            const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03';
            run(tools.ffmpeg, ['-v', 'error', '-y', '-i', raw, '-af', `${trim},areverse,${trim},areverse`, '-ar', '48000', '-ac', '2', wav]);
          }
          file = wav; dur = duration(wav);
        } else pending++;
      }
      say.push({ text, file, dur });
    }
    scenes.push({ ...sc, say });
  }
  if (pending) notes.push(opts.offline ? `${pending} voice line${pending > 1 ? 's' : ''} not generated yet: timing is estimated until the next build.`
    : `FAL_KEY not set: ${pending} line${pending > 1 ? 's' : ''} built without voice-over, lengths estimated from the text.`);

  // ---- timeline: each scene opens just before its first sentence ----
  let t = LEAD, talkEnd = 0;
  scenes.forEach((sc, i) => {
    sc.start = i === 0 ? 0 : +(t - 0.10).toFixed(3);
    let cursor = t;
    for (const s of sc.say) { s.start = +cursor.toFixed(3); s.end = +(cursor + s.dur).toFixed(3); cursor = s.end + GAP; }
    talkEnd = sc.say.length ? cursor - GAP : sc.start + (sc.duration || 3);
    t = Math.max(talkEnd + GAP + 0.03, sc.start + (sc.duration || sc.minDuration || 2.6) + 0.10);
  });
  const total = +(talkEnd + (spec.tail ?? 2.3)).toFixed(2);
  scenes.forEach((sc, i) => { sc.end = i < scenes.length - 1 ? scenes[i + 1].start : total; });

  // ---- footage: local file, still image, or generated (image → animated clip) ----
  for (const sc of scenes) {
    let src = sc.media;
    if (src && typeof src === 'object' && src.generate) {
      const g = src.generate, id = sha(['gen', g]);
      const still = path.join(cache, `gen-${id}.jpg`), clip = path.join(cache, `gen-${id}.mp4`);
      if (canGen) {
        if (!exists(still)) { log('  image:', g.image.slice(0, 70) + '…'); await fal.image(g.image, g, still); }
        if (g.motion && !exists(clip)) { log('  clip:', g.motion.slice(0, 70) + '…'); await fal.animate(still, g.motion, g, clip); }
      }
      src = g.motion && exists(clip) ? clip : exists(still) ? still : null;
      if (!src) notes.push(opts.offline ? `Scene "${sc.type}": footage not generated yet, showing the plain background.`
        : `Scene "${sc.type}" asks for generated footage but FAL_KEY is not set: using the plain background.`);
    } else if (typeof src === 'string') src = path.resolve(dir, src);
    if (!src) { sc.media = null; continue; }
    if (!exists(src)) throw new Error(`media not found: ${src}`);
    const [w, h] = sc.type === 'card' ? [1024, 576] : size;
    if (VIDEO.test(src)) {
      const len = +(sc.end - sc.start + 0.6).toFixed(2), off = sc.mediaOffset || 0;
      const out = path.join(work, 'frames', sha(['fr', src, fs.statSync(src).mtimeMs, w, h, fps, off, len]));
      if (!exists(out)) {
        mkdir(out);
        run(tools.ffmpeg, ['-v', 'error', '-y', '-ss', String(off), '-t', String(len), '-i', src, '-vf',
          `fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`, '-q:v', '2', path.join(out, '%04d.jpg')]);
      }
      sc.media = { kind: 'frames', dir: url(out), count: fs.readdirSync(out).length, fps, offset: 0 };
    } else sc.media = { kind: 'image', src: url(src) };
  }

  for (const sc of scenes) if (sc.screens) sc.screens = list(sc.screens).map((p) => url(path.resolve(dir, p)));
  const brand = { ...spec.brand };
  if (brand.logo) brand.logo = Object.fromEntries(Object.entries(brand.logo).map(([k, v]) => [k, url(path.resolve(dir, v))]));
  const plan = {
    size, fps, duration: total, brand, motionBlur: spec.motionBlur !== false, music: spec.music || null,
    cuts: scenes.slice(1).map((s) => s.start),
    scenes: scenes.map(({ minDuration, mediaOffset, ...sc }) => sc),
    previewAudio: url(path.join(dir, 'out', 'audio.wav')), notes,
  };
  fs.writeFileSync(path.join(work, 'plan.json'), JSON.stringify(plan, null, 1));
  return plan;
}
