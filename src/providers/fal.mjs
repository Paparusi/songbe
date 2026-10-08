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
// prompt → still image (jpg)
export async function image(prompt, o, file) {
  const r = await queued(o.model || 'fal-ai/flux-pro/v1.1-ultra', { prompt, aspect_ratio: o.aspect || '9:16', raw: true, num_images: 1, output_format: 'jpeg', enable_safety_checker: true, seed: o.seed ?? 41 });
  return save(r.images[0].url, file);
}
// still image + motion prompt → 5 s clip (mp4)
export async function animate(imageFile, prompt, o, file) {
  const r = await queued(o.model || 'fal-ai/bytedance/seedance/v1/pro/image-to-video', { prompt, image_url: dataUri(imageFile), resolution: o.resolution || '1080p', duration: String(o.seconds || 5), camera_fixed: false, seed: o.seed ?? 7 });
  return save(urlOf(r.video), file);
}
// prompt → instrumental music (wav, about 30 s)
export async function music(prompt, o, file) {
  const r = await queued(o.model || 'fal-ai/lyria2', { prompt, negative_prompt: o.avoid || 'vocals, singing, lyrics, speech, low quality, distorted', seed: o.seed ?? 808 });
  return save(urlOf(r.audio), file);
}
