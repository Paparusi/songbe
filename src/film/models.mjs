// Which model does a piece of work, and through which door it is reached. A model is named by one of the short names below or,
// for anything else, as "fal:<endpoint>" or "google:<model id>" — so nothing here limits what can be used. A known model is asked
// at its maker's own API when that key is set, and through fal.ai otherwise. What a model can do (act to a recording, speak a line
// itself, take a last frame, how long a clip it makes) is known by heart for the names below and read from fal's description of
// the endpoint for everything else.
import fs from 'node:fs';
import * as fal from '../providers/fal.mjs';
import * as google from '../providers/google.mjs';
import { run, tools } from '../util.mjs';

// acts: performs to a recording handed to it ('keeps': the clip comes back with that recording as its sound)
// speaks: says a line written in its prompt, in a voice of its own choosing
// lasts, ends: how long a clip it makes when started from a frame (as its maker's description said in October 2026), and whether
//      it takes a last frame — known by heart so that looking at a canvas asks nobody anything
// usd: a list price as read in October 2026 — per picture, per second of clip at about 720p, per thousand characters spoken —
//      for an estimate before a run. Makers change their prices and bill by their own count: the invoice decides, not this.
export const KNOWN = {
  // pictures
  'nano-banana-2.1': { kind: 'picture', by: 'Google', usd: .05, google: 'gemini-nano-banana-2.1', fal: { words: 'google/nano-banana-2.1', refs: 'google/nano-banana-2.1/edit' } },
  'nano-banana-pro': { kind: 'picture', by: 'Google', google: 'gemini-3-pro-image', fal: { words: 'fal-ai/nano-banana-pro', refs: 'fal-ai/nano-banana-pro/edit' } },
  'seedream-4': { kind: 'picture', by: 'ByteDance', fal: { words: 'fal-ai/bytedance/seedream/v4/text-to-image', refs: 'fal-ai/bytedance/seedream/v4/edit' } },
  // clips
  'hailuo-h3': { kind: 'clip', by: 'MiniMax', usd: .06, lasts: { min: 5, max: 15, whole: true }, ends: true, fal: { frame: 'minimax/h3/image-to-video', refs: 'minimax/h3/reference-to-video' }, acts: 'keeps', sound: true },
  'hailuo-h3-max': { kind: 'clip', by: 'MiniMax', usd: .08, lasts: { min: .92, max: 15 }, ends: true, fal: { frame: 'minimax/h3-max/image-to-video' }, acts: 'keeps', sound: true },
  'veo-3.1': { kind: 'clip', by: 'Google', usd: .4, lasts: { options: [4, 6, 8] }, google: 'veo-3.1-generate-preview', fal: { frame: 'fal-ai/veo3.1/image-to-video', refs: 'fal-ai/veo3.1/reference-to-video' }, speaks: true, sound: true },
  'veo-3.1-fast': { kind: 'clip', by: 'Google', usd: .15, lasts: { options: [4, 6, 8] }, google: 'veo-3.1-fast-generate-preview', fal: { frame: 'fal-ai/veo3.1/fast/image-to-video' }, speaks: true, sound: true },
  'veo-3.1-lite': { kind: 'clip', by: 'Google', usd: .05, lasts: { options: [4, 6, 8] }, google: 'veo-3.1-lite-generate-preview', fal: { frame: 'fal-ai/veo3.1/lite/image-to-video' }, speaks: true, sound: true },
  'seedance-2.5': { kind: 'clip', by: 'ByteDance', usd: .47, lasts: { min: 4, max: 30, whole: true }, ends: true, fal: { frame: 'bytedance/seedance-2.5/image-to-video', refs: 'bytedance/seedance-2.5/reference-to-video' }, speaks: true, sound: true },
  'wan-3.0': { kind: 'clip', by: 'Alibaba', usd: .1, lasts: { min: 2, max: 30, whole: true }, ends: true, fal: { frame: 'alibaba/wan-3.0/image-to-video', refs: 'alibaba/wan-3.0/reference-to-video' }, speaks: true, sound: true },
  'kling-3': { kind: 'clip', by: 'Kuaishou', usd: .17, lasts: { min: 3, max: 15, whole: true }, ends: true, fal: { frame: 'fal-ai/kling-video/v3/pro/image-to-video' }, sound: true },
  'gemini-omni-flash': { kind: 'clip', by: 'Google', usd: .1, lasts: { min: 3, max: 10, whole: true }, ends: true, fal: { frame: 'google/gemini-omni-flash/v1.1/image-to-video', refs: 'google/gemini-omni-flash/v1.1/reference-to-video' }, speaks: true, sound: true },
  // voices
  'gemini-tts': { kind: 'voice', by: 'Google', usd: .045, google: 'gemini-3.8-flash-tts', fal: 'google/gemini-3.8-flash-tts', directed: true, voices: google.VOICES },
  'minimax-speech': { kind: 'voice', by: 'MiniMax', usd: .1, fal: 'fal-ai/minimax/speech-2.8-hd',
    voices: { female: { Calm_Woman: 'calm', Wise_Woman: 'wise, older', Lively_Girl: 'lively, young', Sweet_Girl_2: 'sweet, young', Lovely_Girl: 'lovely, young', Exuberant_Girl: 'exuberant', Inspirational_girl: 'inspiring', Abbess: 'stern, older' },
      male: { Casual_Guy: 'casual', Patient_Man: 'patient', Deep_Voice_Man: 'deep', Determined_Man: 'determined', Elegant_Man: 'elegant', Decent_Boy: 'decent, young', Young_Knight: 'young, bold', Imposing_Manner: 'imposing' } } },
  // music
  'lyria-3.5': { kind: 'music', by: 'Google', google: 'lyria-3.5' },
  'lyria-2': { kind: 'music', by: 'Google', fal: 'fal-ai/lyria2' },
};
// What each kind of work is given when nothing says otherwise: the first of these that can be reached with the keys at hand.
// (`talk` is a clip in which someone seen in the frame speaks.)
export const PREFER = { picture: ['nano-banana-2.1', 'seedream-4'], clip: ['hailuo-h3', 'veo-3.1-fast'], talk: ['hailuo-h3', 'veo-3.1-fast'], voice: ['gemini-tts', 'minimax-speech'], music: ['lyria-3.5', 'lyria-2'] };
const DOORS = { google: { has: google.available, key: 'GEMINI_API_KEY' }, fal: { has: (env) => !!env.FAL_KEY, key: 'FAL_KEY' } };
const kindOf = (role) => (role === 'talk' ? 'clip' : role);

// A model's name → how it is reached: { name, door: 'google' | 'fal', id, known }. `id` is that door's own name for it (for fal,
// one endpoint or a set of them by what the request starts from).
// With `strict` off a model whose key is missing is still described (by its first door), so that what stands can be looked at
// without keys; making anything with it fails then, saying which key.
export function reach(name, env = process.env, strict = true) {
  const raw = /^(fal|google):(.+)$/.exec(String(name));
  if (raw) { if (strict && !DOORS[raw[1]].has(env)) throw new Error(`${name} needs ${DOORS[raw[1]].key}`); return { name, door: raw[1], id: raw[2], known: null }; }
  const known = KNOWN[name];
  if (!known) throw new Error(`no model is called "${name}". Known: ${Object.keys(KNOWN).join(', ')}. Anything else is named by its door, like fal:<endpoint> or google:<model id>.`);
  for (const door of Object.keys(DOORS)) if (known[door] && DOORS[door].has(env)) return { name, door, id: known[door], known };      // the maker's own door first
  if (!strict) { const door = Object.keys(DOORS).find((d) => known[d]); return { name, door, id: known[door], known }; }
  throw new Error(`${name} needs ${Object.keys(DOORS).filter((d) => known[d]).map((d) => DOORS[d].key).join(' or ')}`);
}
// the model for a kind of work: the one named, or the first preferred one that the keys reach
export function modelFor(role, named, env = process.env, strict = true) {
  if (named) { const r = reach(named, env, strict); if (r.known && r.known.kind !== kindOf(role)) throw new Error(`${named} makes a ${r.known.kind}, not a ${kindOf(role)}`); return r; }
  for (const name of PREFER[role] || []) { try { return reach(name, env); } catch {} }
  if (!strict && PREFER[role]) return reach(PREFER[role][0], env, false);
  throw new Error(`nothing can make a ${kindOf(role)} with the keys that are set: add GEMINI_API_KEY or FAL_KEY (songbe doctor shows which are)`);
}
export const available = (role, env = process.env) => { try { modelFor(role, null, env); return true; } catch { return false; } };
// the models a new series is given, by name, so that it keeps them whatever keys are set later
export const chosen = (env = process.env) => Object.fromEntries(Object.keys(PREFER).map((role) => { try { return [role, modelFor(role, null, env).name]; } catch { return null; } }).filter(Boolean));

// ---- what a clip model can be asked for ----
const SOUND_IN = ['target_audio_url', 'audio_url', 'driving_audio_url'], LAST = ['end_image_url', 'tail_image_url', 'last_frame_url', 'last_image_url'], FIRST = ['image_url', 'start_image_url', 'first_frame_url', 'first_image_url'];
const MANY = { picture: ['reference_image_urls', 'image_urls'], voice: ['reference_audio_urls', 'audio_urls'], music: ['reference_audio_urls', 'audio_urls'], clip: ['reference_video_urls', 'video_urls'] };
const endpointFor = (r, w) => (typeof r.id === 'string' ? r.id : (w.frame && r.id.frame) || (w.refs?.length && r.id.refs) || r.id.frame || r.id.words || r.id.refs || Object.values(r.id)[0]);
// { seconds: { min, max, whole, options }, end, acts, speaks, sound, resolutions } for a clip model reached as `r`
export async function clipAbilities(r, w = { frame: true }) {
  if (r.door === 'google') return { seconds: { options: google.CLIP.seconds }, end: true, acts: false, speaks: true, sound: true, resolutions: google.CLIP.resolutions };
  if (r.known?.lasts && w.frame && !w.refs?.length) return { seconds: r.known.lasts, end: !!r.known.ends, acts: r.known.acts || false, speaks: !!r.known.speaks, sound: !!r.known.sound, resolutions: null };
  const id = endpointFor(r, w), inputs = await fal.inputsOf(id);
  if (!inputs) throw new Error(`fal.ai's description of ${id} could not be had (no connection?)`);
  const d = inputs.duration, options = d?.options?.map((x) => parseFloat(x)).filter((x) => !Number.isNaN(x)) || null;
  return { seconds: d ? (options?.length ? { options } : { min: d.min ?? 1, max: d.max ?? 15, whole: d.type === 'integer' }) : null, end: LAST.some((n) => n in inputs),
    acts: SOUND_IN.some((n) => n in inputs) ? r.known?.acts || true : false, speaks: !!r.known?.speaks, sound: !!r.known?.sound || 'generate_audio' in inputs || 'audio' in inputs, resolutions: inputs.resolution?.options || null };
}
// the length to ask for: the shortest the model makes that is long enough
export function fitSeconds(ab, want) {
  const s = ab.seconds; if (!s) return want;
  if (s.options) { const by = [...s.options].sort((a, b) => a - b); return by.find((x) => x >= want - .01) ?? by.at(-1); }
  const v = Math.min(s.max, Math.max(s.min, want)); return s.whole ? Math.min(s.max, Math.ceil(v - .01)) : +v.toFixed(2);
}

// ---- making ----
const ff = (...args) => run(tools.ffmpeg, ['-v', 'error', '-y', ...args]);
const isJpeg = (b) => b[0] === 0xFF && b[1] === 0xD8;
// whatever came back, kept as what the flow expects: a JPEG picture, a WAV recording, an MP3 of music
function keep(bytes, file, as) {
  const fine = as === 'jpg' ? isJpeg(bytes) : as === 'wav' ? bytes.toString('latin1', 0, 4) === 'RIFF' : as === 'mp3' ? (bytes.toString('latin1', 0, 3) === 'ID3' || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) : true;
  if (fine) return fs.writeFileSync(file, bytes);
  const raw = file + '.raw'; fs.writeFileSync(raw, bytes);
  try { ff('-i', raw, ...(as === 'jpg' ? ['-frames:v', '1', '-q:v', '2'] : as === 'wav' ? ['-ar', '48000', '-ac', '1'] : ['-b:a', '192k']), file); } finally { fs.rmSync(raw, { force: true }); }
}
const convert = (file, as) => keep(fs.readFileSync(file), file, as);

// { prompt, refs: [files, in the order the prompt speaks of them], aspect, seed } → a picture (jpg)
export async function makePicture(r, w, file, env = process.env) {
  if (r.door === 'google') { const p = await google.picture({ model: r.id, prompt: w.prompt, refs: w.refs || [], aspect: w.aspect, size: w.options?.size }, env); return keep(p.bytes, file, 'jpg'); }
  const refs = w.refs || [], id = typeof r.id === 'string' ? r.id : refs.length ? r.id.refs : r.id.words;
  if (!id) throw new Error(`${r.name} cannot ${refs.length ? 'work from pictures' : 'work from words alone'}`);
  await fal.image(w.prompt, { imageModel: id, from: refs, aspect: w.aspect, seed: w.seed, imageOptions: w.options }, file); convert(file, 'jpg');
}

// { text, voice, style, language, speed } → a recording (wav) with the silence before and after the words taken off
export async function makeVoice(r, w, file, env = process.env) {
  if (r.door === 'google') { const s = await google.speech({ model: r.id, text: w.text, voice: w.voice, style: w.style }, env); keep(s.bytes, file, 'wav'); }
  else { await fal.speak(w.text, { model: r.id, voice: w.voice, speed: w.speed ?? 1, emotion: w.emotion || 'neutral', language: w.language || 'auto', style: w.style, options: w.options }, file); convert(file, 'wav'); }
  const tight = file + '.tight.wav', cut = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02';
  try { ff('-i', file, '-af', `${cut},areverse,${cut},areverse`, '-ar', '48000', '-ac', '1', tight); fs.renameSync(tight, file); } finally { fs.rmSync(tight, { force: true }); }
}

// { prompt } → instrumental music (mp3)
export async function makeMusic(r, w, file, env = process.env) {
  if (r.door === 'google') { const s = await google.music({ model: r.id, prompt: w.prompt }, env); return keep(s.bytes, file, 'mp3'); }
  await fal.music(w.prompt, { model: r.id, seconds: w.seconds, seed: w.seed, options: w.options }, file); convert(file, 'mp3');
}

const PIXELS = { '2k': 1440, '4k': 2160 }, pixels = (x) => PIXELS[String(x).toLowerCase()] || parseInt(x, 10) || 0;
// { prompt, frame, end, voice (a recording to act to), refs: [{ file, kind }], seconds, aspect, resolution, sound, seed } → a clip (mp4)
export async function makeClip(r, w, file, env = process.env) {
  if (r.door === 'google') {
    if (w.voice) throw new Error(`${r.name} cannot act to a recording; it speaks the line itself`);
    if (w.refs?.length) throw new Error(`${r.name} is asked at Google with a first frame only; for reference pictures name the fal.ai endpoint (fal:…)`);
    const c = await google.clip({ model: r.id, prompt: w.prompt, frame: w.frame, end: w.end, seconds: w.seconds, aspect: w.aspect, resolution: w.resolution, avoid: w.avoid }, env);
    return fs.writeFileSync(file, c.bytes);
  }
  const id = endpointFor(r, w), inputs = await fal.inputsOf(id);
  if (!inputs) throw new Error(`fal.ai's description of ${id} could not be had (no connection?)`);
  const has = (n) => n in inputs, first = (names) => names.find(has);
  const a = fal.requestFor(inputs, { kind: 'video', model: id, prompt: w.prompt, aspect: w.aspect, seed: w.seed, options: w.options });
  if (w.frame) { const into = first(FIRST); if (!into) throw new Error(`${id} does not start from a picture`); a[into] = fal.fileUri(w.frame); }
  if (w.end) { const into = first(LAST); if (!into) throw new Error(`${id} does not take a last frame`); a[into] = fal.fileUri(w.end); }
  if (w.voice) { const into = first(SOUND_IN); if (!into) throw new Error(`${id} cannot act to a recording`); a[into] = fal.fileUri(w.voice); }
  for (const kind of new Set((w.refs || []).map((f) => f.kind || 'picture'))) {      // references by what they are: pictures, recordings, clips
    const into = (MANY[kind] || []).find((n) => has(n) && !(w.frame && n === 'image_urls'));
    if (!into) throw new Error(`${id} takes no ${kind === 'picture' ? 'reference pictures' : kind === 'clip' ? 'reference clips' : 'reference recordings'}`);
    a[into] = w.refs.filter((f) => (f.kind || 'picture') === kind).map((f) => fal.fileUri(f.file));
  }
  if (has('duration') && w.seconds) { const o = inputs.duration.options; a.duration = o ? o.find((x) => parseFloat(x) === w.seconds) ?? o.at(-1) : w.seconds; }
  if (has('resolution') && inputs.resolution.options && !w.options?.resolution) { const want = pixels(w.resolution || '720p');
    a.resolution = [...inputs.resolution.options].sort((x, y) => Math.abs(Math.log(pixels(x) / want)) - Math.abs(Math.log(pixels(y) / want)))[0]; }
  if (has('generate_audio') && w.options?.generate_audio === undefined) a.generate_audio = w.sound !== false;      // a film keeps the sound a clip is made with
  await fal.run(id, a, file, 1500);
}

// seconds of a sound or a clip, and whether a clip has sound
export const secondsOf = (file) => parseFloat(run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
export const hasSound = (file) => run(tools.ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).trim().length > 0;
// what one piece of work costs by list price, or null when no price is known for its model (units: pictures, seconds, thousands of characters)
export const costOf = (r, units) => (r?.known?.usd === undefined || units === undefined ? null : +(r.known.usd * units).toFixed(4));
export const nameOf = (r) => `${r.name}${r.known ? ` (${r.door === 'fal' ? 'through fal.ai' : 'at ' + r.known.by})` : ''}`;
