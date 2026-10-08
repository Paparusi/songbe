// video.json → plan: generate the voice, lay scenes out on a timeline that follows the spoken lines, and prepare footage.
// Everything generated is cached under <project>/.fw/cache by a hash of its inputs, so editing one line only redoes that line.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as fal from './providers/fal.mjs';
import { run, sha, mkdir, exists, tools, duration, log } from './util.mjs';

const GAP = 0.35;          // pause between sentences
const LEAD = 0.25;         // silence before the first word
const VIDEO = /\.(mp4|mov|webm|mkv)$/i;
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const url = (f) => pathToFileURL(f).href;

export async function makePlan(dir, opts = {}) {
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
  const work = mkdir(path.join(dir, '.fw')), cache = mkdir(path.join(work, 'cache'));
  const size = spec.size || [1080, 1920], fps = spec.fps || 30;
  const notes = [];

  // ---- voice: one clip per sentence, silence trimmed ----
  const useVoice = spec.voice !== false && fal.available();
  if (spec.voice !== false && !fal.available()) notes.push('FAL_KEY not set: built without voice-over, sentence lengths are estimated from the text.');
  const scenes = [];
  for (const sc of spec.scenes) {
    const say = [];
    for (const text of list(sc.say)) {
      let file = null, dur = Math.max(1.6, text.length / 15);
      if (useVoice) {
        const v = spec.voice || {}, id = sha(['vo', text, v]);
        const raw = path.join(cache, `vo-${id}.mp3`); file = path.join(cache, `vo-${id}.wav`);
        if (!exists(raw) || opts.force) { log('  voice:', text); await fal.speak(text, v, raw); }
        if (!exists(file) || opts.force) {
          const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03';
          run(tools.ffmpeg, ['-v', 'error', '-y', '-i', raw, '-af', `${trim},areverse,${trim},areverse`, '-ar', '48000', '-ac', '2', file]);
        }
        dur = duration(file);
      }
      say.push({ text, file, dur });
    }
    scenes.push({ ...sc, say });
  }

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
      if (!fal.available()) { notes.push(`Scene "${sc.type}" asks for generated footage but FAL_KEY is not set: using the plain background.`); src = null; }
      else {
        const g = src.generate, id = sha(['gen', g]);
        const still = path.join(cache, `gen-${id}.jpg`), clip = path.join(cache, `gen-${id}.mp4`);
        if (!exists(still)) { log('  image:', g.image.slice(0, 70) + '…'); await fal.image(g.image, g, still); }
        if (g.motion && !exists(clip)) { log('  clip:', g.motion.slice(0, 70) + '…'); await fal.animate(still, g.motion, g, clip); }
        src = g.motion ? clip : still;
      }
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
