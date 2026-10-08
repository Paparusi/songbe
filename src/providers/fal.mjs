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
const dataUri = (file) => `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;

export const available = () => !!process.env.FAL_KEY;

// text → speech (mp3)
export async function speak(text, v, file) {
  const r = await quick(v.model || 'fal-ai/minimax/speech-02-hd', {
    text, voice_setting: { voice_id: v.voice || 'Casual_Guy', speed: v.speed ?? 1.08, vol: 1, pitch: 0, emotion: v.emotion || 'happy' },
    language_boost: v.language || 'auto', output_format: 'url' });
  return save(urlOf(r.audio), file);
}
// ---- any model on fal.ai ----
// Pictures, clips and music are not tied to the models named below. fal publishes what every model takes (its OpenAPI description);
// Songbe reads that once per run and fills in what it knows — the prompt, the picture to animate, the frame's shape, the length,
// the resolution, a seed — under whatever names that model uses. So `"imageModel"`, `"videoModel"` or the music's `"model"` can be
// any endpoint in fal's catalogue.
export const DEFAULTS = { image: 'fal-ai/flux-pro/v1.1-ultra', video: 'fal-ai/bytedance/seedance/v1/pro/image-to-video', music: 'fal-ai/lyria2' };
// a few that are known to work, offered by the editor; any other endpoint id can be typed in
export const CATALOGUE = {
  image: ['fal-ai/flux-pro/v1.1-ultra', 'fal-ai/flux/schnell', 'fal-ai/bytedance/seedream/v4/text-to-image', 'fal-ai/nano-banana', 'fal-ai/recraft/v3/text-to-image', 'fal-ai/ideogram/v3', 'fal-ai/qwen-image'],
  video: ['fal-ai/bytedance/seedance/v1/pro/image-to-video', 'fal-ai/bytedance/seedance/v1/lite/image-to-video', 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', 'fal-ai/veo3/fast/image-to-video',
    'fal-ai/wan/v2.2-a14b/image-to-video', 'fal-ai/minimax/hailuo-02/standard/image-to-video', 'fal-ai/luma-dream-machine/ray-2/image-to-video'],
};
const described = new Map();
// { name: { options: [...] | null, object: bool } } for every input a model takes, or null when its description cannot be had
export async function inputsOf(model) {
  if (described.has(model)) return described.get(model);
  let found = null;
  try {
    const r = await fetch('https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=' + model.split('/').map(encodeURIComponent).join('/'), { signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const schemas = (await r.json()).components?.schemas || {}, input = Object.entries(schemas).find(([k]) => k.endsWith('Input'))?.[1];
      if (input?.properties) found = Object.fromEntries(Object.entries(input.properties).map(([name, v]) => {
        const kinds = [v, ...(v.anyOf || []), ...(v.allOf || [])];
        return [name, { options: kinds.find((x) => Array.isArray(x.enum))?.enum || null, object: kinds.some((x) => x.$ref || x.type === 'object') }];
      }));
    } else if (r.status === 404) throw new Error(`fal.ai has no model called "${model}"`);
  } catch (e) { if (/no model called/.test(e.message)) throw e; }
  described.set(model, found); return found;
}
const ratioOf = (s) => { const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(s)); return m ? +m[1] / +m[2] : null; };
const SIZES = { square_hd: 1, square: 1, portrait_4_3: 3 / 4, portrait_16_9: 9 / 16, landscape_4_3: 4 / 3, landscape_16_9: 16 / 9 };
const nearest = (options, want, value) => options.map((o) => [o, value(o)]).filter(([, v]) => v !== null && v !== undefined).sort((a, b) => Math.abs(Math.log(a[1] / want)) - Math.abs(Math.log(b[1] / want)))[0]?.[0];
// The request for one model: what Songbe wants to say, under the names and within the choices that model has.
export function requestFor(inputs, want) {
  const a = {}, has = (n) => inputs && n in inputs, opts = (n) => inputs[n].options, shape = ratioOf(want.aspect || '9:16');
  if (has('prompt')) a.prompt = want.prompt;
  if (want.image) { if (has('image_url')) a.image_url = want.image; else if (has('image_urls')) a.image_urls = [want.image]; else if (has('start_image_url')) a.start_image_url = want.image; }
  if (has('aspect_ratio') && opts('aspect_ratio')) { const o = opts('aspect_ratio'); a.aspect_ratio = o.includes(want.aspect) ? want.aspect : want.image && o.includes('auto') ? 'auto' : nearest(o, shape, ratioOf) ?? o[0]; }
  else if (has('image_size')) { const o = opts('image_size'); if (o) a.image_size = nearest(o.filter((x) => x in SIZES).sort((x, y) => (y.endsWith('_hd') ? 1 : 0) - (x.endsWith('_hd') ? 1 : 0)), shape, (x) => SIZES[x]) ?? o[0]; else if (inputs.image_size.object) a.image_size = { width: shape >= 1 ? 1920 : 1080, height: shape > 1 ? 1080 : shape === 1 ? 1920 : 1920 }; }
  for (const name of ['duration', 'seconds_total']) if (has(name) && want.seconds) {      // the shortest choice that is long enough, written the way the model writes it ("5", "5s", 5)
    const o = opts(name); if (!o) { a[name] = want.seconds; continue; }
    const by = o.map((x) => [x, parseFloat(x)]).filter(([, n]) => !Number.isNaN(n)).sort((x, y) => x[1] - y[1]); a[name] = (by.find(([, n]) => n >= want.seconds) || by.at(-1) || [o[0]])[0];
  }
  if (has('resolution') && opts('resolution')) { const o = opts('resolution'), px = (x) => parseInt(x, 10), top = px(want.resolution || '1080p');      // the wanted one, or the best below it
    a.resolution = o.find((x) => String(x).toLowerCase() === String(want.resolution || '1080p').toLowerCase()) || o.filter((x) => px(x) <= top).sort((x, y) => px(y) - px(x))[0] || o[0]; }
  if (has('seed') && want.seed !== undefined) a.seed = want.seed;
  if (has('negative_prompt') && want.avoid) a.negative_prompt = want.avoid;
  if (has('num_images')) a.num_images = 1;
  if (has('output_format') && opts('output_format')?.includes('jpeg') && !want.image && want.kind === 'image') a.output_format = 'jpeg';
  if (has('enable_safety_checker')) a.enable_safety_checker = true;
  if (has('raw')) a.raw = true;                       // photographs that look like photographs
  if (has('camera_fixed')) a.camera_fixed = false;
  if (has('generate_audio')) a.generate_audio = false;      // the clip's own sound is never used
  return a;
}
// the first file address in an answer, wherever the model put it
function fileIn(answer) {
  const seen = (v) => { if (!v || typeof v !== 'object') return null; if (typeof v.url === 'string' && /^https?:/.test(v.url)) return v.url; for (const x of Array.isArray(v) ? v : Object.values(v)) { const u = seen(x); if (u) return u; } return null; };
  const u = seen(answer); if (!u) throw new Error('fal.ai answered without a file: ' + JSON.stringify(answer).slice(0, 200)); return u;
}

// prompt → still image (jpg). o.imageModel (or o.model) picks the model; o.aspect is the frame's shape.
export async function image(prompt, o, file) {
  const model = o.imageModel || o.model || DEFAULTS.image, inputs = await inputsOf(model);
  const args = inputs ? requestFor(inputs, { kind: 'image', prompt, aspect: o.aspect || '9:16', seed: o.seed ?? 41 })
    : { prompt, aspect_ratio: o.aspect || '9:16', raw: true, num_images: 1, output_format: 'jpeg', enable_safety_checker: true, seed: o.seed ?? 41 };      // fal's description could not be had: what the default model is known to take
  return save(fileIn(await queued(model, args)), file);
}
// still image + motion prompt → a clip of about five seconds (mp4). o.videoModel picks the model.
export async function animate(imageFile, prompt, o, file) {
  const model = o.videoModel || DEFAULTS.video, inputs = await inputsOf(model);
  const args = inputs ? requestFor(inputs, { kind: 'video', prompt, image: dataUri(imageFile), aspect: o.aspect || '9:16', seconds: o.seconds || 5, resolution: o.resolution || '1080p', seed: o.seed ?? 7 })
    : { prompt, image_url: dataUri(imageFile), resolution: o.resolution || '1080p', duration: String(o.seconds || 5), camera_fixed: false, seed: o.seed ?? 7 };
  return save(fileIn(await queued(model, args)), file);
}
// prompt → instrumental music (about 30 s). o.model picks the model.
export async function music(prompt, o, file) {
  const model = o.model || DEFAULTS.music, inputs = await inputsOf(model), avoid = o.avoid || 'vocals, singing, lyrics, speech, low quality, distorted';
  const args = inputs ? requestFor(inputs, { kind: 'music', prompt, avoid, seconds: o.seconds || 30, seed: o.seed ?? 808 }) : { prompt, negative_prompt: avoid, seed: o.seed ?? 808 };
  return save(fileIn(await queued(model, args)), file);
}
