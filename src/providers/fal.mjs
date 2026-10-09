// fal.ai adapter (bring your own FAL_KEY). Plain HTTPS: fal.run for quick calls, queue.fal.run + polling for long ones.
import fs from 'node:fs';

const key = () => { if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not set'); return process.env.FAL_KEY; };
async function call(url, body) {
  const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Key ' + key(), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`fal ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
const quick = (model, args) => call('https://fal.run/' + model, args);
async function queued(model, args, timeoutSec = 900) {
  const job = await call('https://queue.fal.run/' + model, args), t0 = Date.now();
  while (Date.now() - t0 < timeoutSec * 1000) {
    const s = await call(job.status_url);
    if (s.status === 'COMPLETED') return call(job.response_url);
    if (!['IN_QUEUE', 'IN_PROGRESS'].includes(s.status)) throw new Error('fal job failed: ' + JSON.stringify(s).slice(0, 300));
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error('fal job timed out');
}
async function save(url, file) { fs.writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer())); return file; }
const urlOf = (x) => (typeof x === 'string' ? x : x?.url);
// a picture as a data: address, named for what its bytes are rather than for how its file name ends
const dataUri = (file) => { const b = fs.readFileSync(file), kind = b[0] === 0x89 && b[1] === 0x50 ? 'png' : b.toString('latin1', 0, 4) === 'RIFF' ? 'webp' : 'jpeg'; return `data:image/${kind};base64,${b.toString('base64')}`; };

export const available = () => !!process.env.FAL_KEY;

// text → speech. The default is MiniMax speech (v.voice is one of its voice ids, with speed, emotion and a language hint); with
// v.model set to another text-to-speech endpoint the text, the voice and the speed go in under the names that model uses.
const VOICE = 'fal-ai/minimax/speech-02-hd';
const CODES = { vietnamese: 'vi', english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko', french: 'fr', german: 'de', spanish: 'es', portuguese: 'pt', indonesian: 'id', thai: 'th', hindi: 'hi', arabic: 'ar', russian: 'ru', italian: 'it' };
export async function speak(text, v, file) {
  const model = v.model || VOICE, inputs = model === VOICE && !v.options ? null : await inputsOf(model);      // the default is known by heart; its description is fetched only to check settings somebody set
  if (!inputs || 'voice_setting' in inputs) {      // MiniMax's own shape
    const r = await quick(model, { text, voice_setting: { voice_id: v.voice || 'Casual_Guy', speed: v.speed ?? 1.08, vol: 1, pitch: 0, emotion: v.emotion || 'happy' }, language_boost: v.language || 'auto', ...own(inputs, v.options, model), output_format: 'url' });
    return save(urlOf(r.audio), file);
  }
  return save(fileIn(await queued(model, { ...speechFor(inputs, text, v, model), ...own(inputs, v.options, model) })), file);
}
// Settings of one model that Songbe has no word for ("options" in the spec): passed on as they are, once the model is seen to take them
function own(inputs, options, model = 'this model') {
  for (const k of Object.keys(options || {})) if (inputs && !(k in inputs)) throw new Error(`${model} has no setting called "${k}" (it takes: ${Object.keys(inputs).join(', ')}). "songbe model ${model}" lists them.`);
  return options || {};
}
// the request for a text-to-speech model that is not MiniMax's
export function speechFor(inputs, text, v, model = 'that model') {
  const a = {}, has = (n) => n in inputs, said = ['text', 'input', 'prompt', 'gen_text'].find(has);
  if (!said) throw new Error(`${model} does not look like a text-to-speech model (it takes: ${Object.keys(inputs).join(', ')})`);
  a[said] = text;
  for (const n of ['voice', 'voice_id', 'speaker']) if (has(n) && v.voice) { a[n] = v.voice; break; }
  if (has('speed') && v.speed) a.speed = v.speed;
  const code = CODES[String(v.language || '').toLowerCase()];
  if (has('language_code') && code) a.language_code = code; else if (has('language') && v.language && v.language !== 'auto') a.language = inputs.language.options?.find((o) => String(o).toLowerCase() === String(v.language).toLowerCase() || o === code) ?? v.language;
  return a;
}
// ---- any model on fal.ai ----
// Pictures, clips and music are not tied to the models named below. fal publishes what every model takes (its OpenAPI description);
// Songbe reads that once per run and fills in what it knows — the prompt, the picture to animate, the frame's shape, the length,
// the resolution, a seed — under whatever names that model uses. So `"imageModel"`, `"videoModel"` or the music's `"model"` can be
// any endpoint in fal's catalogue.
export const DEFAULTS = { image: 'fal-ai/flux-pro/v1.1-ultra', edit: 'fal-ai/nano-banana/edit', video: 'fal-ai/bytedance/seedance/v1/pro/image-to-video', music: 'fal-ai/lyria2', voice: VOICE };
// a few that are known to work, offered by the editor; any other endpoint id can be typed in
export const CATALOGUE = {
  image: ['fal-ai/flux-pro/v1.1-ultra', 'fal-ai/flux/schnell', 'fal-ai/bytedance/seedream/v4/text-to-image', 'fal-ai/nano-banana', 'fal-ai/recraft/v3/text-to-image', 'fal-ai/ideogram/v3', 'fal-ai/qwen-image'],
  // from a picture of your own: the same thing somewhere else, in another light, at another angle
  edit: ['fal-ai/nano-banana/edit', 'fal-ai/nano-banana-pro/edit', 'fal-ai/bytedance/seedream/v4/edit', 'fal-ai/flux-pro/kontext', 'fal-ai/flux-2-pro/edit', 'fal-ai/qwen-image-edit'],
  video: ['fal-ai/bytedance/seedance/v1/pro/image-to-video', 'fal-ai/bytedance/seedance/v1/lite/image-to-video', 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', 'fal-ai/veo3/fast/image-to-video',
    'fal-ai/wan/v2.2-a14b/image-to-video', 'fal-ai/minimax/hailuo-02/standard/image-to-video', 'fal-ai/luma-dream-machine/ray-2/image-to-video'],
};
const described = new Map();
// What fal.ai publishes about a model — { model, category, inputs: { name: { options, object, type, default, min, max, required, about } } },
// inputs in the order fal lists them — or null when the description cannot be had (offline, or fal changed its address).
export async function describe(model) {
  if (described.has(model)) return described.get(model);
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(String(model))) throw new Error(`"${model}" is not the name of a model on fal.ai (they look like fal-ai/flux/schnell)`);
  let found = null;
  try {
    const r = await fetch('https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=' + model.split('/').map(encodeURIComponent).join('/'), { signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const doc = await r.json(), input = Object.entries(doc.components?.schemas || {}).find(([k]) => k.endsWith('Input'))?.[1];
      if (input?.properties) {
        const order = input['x-fal-order-properties'] || [], must = new Set(input.required || []);
        const names = [...order.filter((n) => n in input.properties), ...Object.keys(input.properties).filter((n) => !order.includes(n))];
        found = { model, category: doc.info?.['x-fal-metadata']?.category || null, inputs: Object.fromEntries(names.map((name) => {
          const v = input.properties[name], kinds = [v, ...(v.anyOf || []), ...(v.allOf || [])];
          return [name, { options: kinds.find((x) => Array.isArray(x.enum))?.enum || null, object: kinds.some((x) => x.$ref || x.type === 'object'),
            type: kinds.map((x) => x.type).find((t) => t && t !== 'null') || null, ...(v.default !== undefined && v.default !== null ? { default: v.default } : {}),
            ...(v.minimum !== undefined ? { min: v.minimum } : {}), ...(v.maximum !== undefined ? { max: v.maximum } : {}), required: must.has(name),
            about: String(v.description || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0].slice(0, 200) }];
        })) };
      }
    } else if (r.status === 404) throw new Error(`fal.ai has no model called "${model}"`);
  } catch (e) { if (/no model called/.test(e.message)) throw e; }
  described.set(model, found); return found;
}
export const inputsOf = async (model) => (await describe(model))?.inputs ?? null;
// the inputs through which a model is handed a picture, in the order Songbe tries them
const PICTURE = ['image_urls', 'image_url', 'start_image_url'];
export const takesPicture = (inputs) => PICTURE.find((n) => inputs && n in inputs) || null;
// what Songbe fills in from the spec (the words, the picture, the frame's shape, the length, the seed, the voice…), so a list of a
// model's settings can leave these out
export const FILLED = new Set(['prompt', ...PICTURE, 'aspect_ratio', 'image_size', 'duration', 'seconds_total', 'resolution', 'seed', 'num_images', 'output_format', 'sync_mode',
  'text', 'input', 'gen_text', 'voice', 'voice_id', 'speaker', 'voice_setting', 'language_boost', 'language_code']);
// what Songbe sends unless the spec says otherwise
export const PRESET = { raw: true, camera_fixed: false, generate_audio: false, enable_safety_checker: true };
// A model's description sorted for a person: what Songbe fills in, and the settings that are theirs to set ("options" in the spec)
export function settingsOf(d) {
  const names = Object.keys(d.inputs), clip = /video/.test(d.category || '') || 'duration' in d.inputs, mine = (n) => FILLED.has(n) && (n !== 'resolution' || clip);      // only a clip's resolution is Songbe's to choose
  return { model: d.model, category: d.category, filled: names.filter(mine),
    settings: names.filter((n) => !mine(n)).map((name) => { const v = d.inputs[name];
      return { name, type: v.object ? 'object' : v.type, options: v.options, ...(v.default !== undefined ? { default: v.default } : {}), ...(v.min !== undefined ? { min: v.min } : {}), ...(v.max !== undefined ? { max: v.max } : {}),
        about: v.about, ...(name in PRESET ? { preset: PRESET[name] } : {}) }; }) };
}
const ratioOf = (s) => { const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(s)); return m ? +m[1] / +m[2] : null; };
const SIZES = { square_hd: 1, square: 1, portrait_4_3: 3 / 4, portrait_16_9: 9 / 16, landscape_4_3: 4 / 3, landscape_16_9: 16 / 9 };
const nearest = (options, want, value) => options.map((o) => [o, value(o)]).filter(([, v]) => v !== null && v !== undefined).sort((a, b) => Math.abs(Math.log(a[1] / want)) - Math.abs(Math.log(b[1] / want)))[0]?.[0];
// The request for one model: what Songbe wants to say, under the names and within the choices that model has.
export function requestFor(inputs, want) {
  const a = {}, has = (n) => inputs && n in inputs, opts = (n) => inputs[n].options, shape = ratioOf(want.aspect || '9:16');
  if (has('prompt')) a.prompt = want.prompt;
  const pictures = want.images?.length ? want.images : want.image ? [want.image] : [], into = pictures.length && takesPicture(inputs);
  if (into) a[into] = into === 'image_urls' ? pictures : pictures[0];
  if (has('aspect_ratio') && opts('aspect_ratio')) { const o = opts('aspect_ratio'); a.aspect_ratio = o.includes(want.aspect) ? want.aspect : want.image && o.includes('auto') ? 'auto' : nearest(o, shape, ratioOf) ?? o[0]; }
  else if (has('image_size')) { const o = opts('image_size'); if (o) a.image_size = nearest(o.filter((x) => x in SIZES).sort((x, y) => (y.endsWith('_hd') ? 1 : 0) - (x.endsWith('_hd') ? 1 : 0)), shape, (x) => SIZES[x]) ?? o[0]; else if (inputs.image_size.object) a.image_size = { width: shape >= 1 ? 1920 : 1080, height: shape > 1 ? 1080 : shape === 1 ? 1920 : 1920 }; }
  for (const name of ['duration', 'seconds_total']) if (has(name) && want.seconds) {      // the shortest choice that is long enough, written the way the model writes it ("5", "5s", 5)
    const o = opts(name); if (!o) { a[name] = want.seconds; continue; }
    const by = o.map((x) => [x, parseFloat(x)]).filter(([, n]) => !Number.isNaN(n)).sort((x, y) => x[1] - y[1]); a[name] = (by.find(([, n]) => n >= want.seconds) || by.at(-1) || [o[0]])[0];
  }
  // a clip's resolution: the wanted one, or the best below it. (A picture model's "resolution" — 1K, 2K, 4K — is left at what the model
  // does by itself: the largest costs several times the smallest, and that is the spec's to ask for in imageOptions.)
  if (want.kind === 'video' && has('resolution') && opts('resolution')) { const o = opts('resolution'), px = (x) => parseInt(x, 10), top = px(want.resolution || '1080p');
    a.resolution = o.find((x) => String(x).toLowerCase() === String(want.resolution || '1080p').toLowerCase()) || o.filter((x) => px(x) <= top).sort((x, y) => px(y) - px(x))[0] || o[0]; }
  if (has('seed') && want.seed !== undefined) a.seed = want.seed;
  if (has('negative_prompt') && want.avoid) a.negative_prompt = want.avoid;
  if (has('num_images')) a.num_images = 1;
  if (has('output_format') && opts('output_format')?.includes('jpeg') && want.kind === 'image') a.output_format = 'jpeg';
  if (has('enable_safety_checker')) a.enable_safety_checker = true;
  if (has('raw')) a.raw = true;                       // photographs that look like photographs
  if (has('camera_fixed')) a.camera_fixed = false;
  if (has('generate_audio')) a.generate_audio = false;      // the clip's own sound is never used
  return { ...a, ...own(inputs, want.options, want.model) };      // what the spec sets for this model by name has the last word
}
// the first file address in an answer, wherever the model put it
function fileIn(answer) {
  const seen = (v) => { if (!v || typeof v !== 'object') return null; if (typeof v.url === 'string' && /^https?:/.test(v.url)) return v.url; for (const x of Array.isArray(v) ? v : Object.values(v)) { const u = seen(x); if (u) return u; } return null; };
  const u = seen(answer); if (!u) throw new Error('fal.ai answered without a file: ' + JSON.stringify(answer).slice(0, 200)); return u;
}

// prompt → still image (jpg). o.imageModel (or o.model) picks the model; o.aspect is the frame's shape. With o.from — pictures of
// your own, as files — the picture is made from them by a model that takes pictures: the same product in another place.
export async function image(prompt, o, file) {
  const from = [].concat(o.from ?? []), model = o.imageModel || o.model || (from.length ? DEFAULTS.edit : DEFAULTS.image), inputs = await inputsOf(model), into = takesPicture(inputs);
  if (inputs && from.length && !into) throw new Error(`${model} makes pictures from words alone. To start from a picture of your own, use a model that takes one, for example ${DEFAULTS.edit}.`);
  if (inputs && !from.length && into && inputs[into].required) throw new Error(`${model} needs a picture to start from: name one of yours in "from", or use a model that works from words, for example ${DEFAULTS.image}.`);
  if (inputs && from.length > 1 && into !== 'image_urls') throw new Error(`${model} takes one picture and "from" names ${from.length}. Name one, or use a model that takes several, for example ${DEFAULTS.edit}.`);
  const args = inputs ? requestFor(inputs, { kind: 'image', model, prompt, images: from.map(dataUri), aspect: o.aspect || '9:16', seed: o.seed ?? 41, options: o.imageOptions })
    : from.length ? { prompt, image_urls: from.map(dataUri), aspect_ratio: o.aspect || '9:16', num_images: 1, output_format: 'jpeg', ...o.imageOptions }      // fal's description could not be had: what the default models are known to take
      : { prompt, aspect_ratio: o.aspect || '9:16', raw: true, num_images: 1, output_format: 'jpeg', enable_safety_checker: true, seed: o.seed ?? 41, ...o.imageOptions };
  return save(fileIn(await queued(model, args)), file);
}
// still image + motion prompt → a clip of about five seconds (mp4). o.videoModel picks the model.
export async function animate(imageFile, prompt, o, file) {
  const model = o.videoModel || DEFAULTS.video, inputs = await inputsOf(model);
  if (inputs && !takesPicture(inputs)) throw new Error(`${model} makes clips from words alone. Songbe sets a picture in motion, so the clip model has to take one, for example ${DEFAULTS.video}.`);
  const args = inputs ? requestFor(inputs, { kind: 'video', model, prompt, image: dataUri(imageFile), aspect: o.aspect || '9:16', seconds: o.seconds || 5, resolution: o.resolution || '1080p', seed: o.seed ?? 7, options: o.videoOptions })
    : { prompt, image_url: dataUri(imageFile), resolution: o.resolution || '1080p', duration: String(o.seconds || 5), camera_fixed: false, seed: o.seed ?? 7, ...o.videoOptions };
  return save(fileIn(await queued(model, args)), file);
}
// prompt → instrumental music (about 30 s). o.model picks the model.
export async function music(prompt, o, file) {
  const model = o.model || DEFAULTS.music, inputs = await inputsOf(model), avoid = o.avoid || 'vocals, singing, lyrics, speech, low quality, distorted';
  const args = inputs ? requestFor(inputs, { kind: 'music', model, prompt, avoid, seconds: o.seconds || 30, seed: o.seed ?? 808, options: o.options }) : { prompt, negative_prompt: avoid, seed: o.seed ?? 808, ...o.options };
  return save(fileIn(await queued(model, args)), file);
}
