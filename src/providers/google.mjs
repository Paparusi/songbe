// Google's own API (bring your own GEMINI_API_KEY): text (Gemini), pictures (Nano Banana), clips (Veo), speech (Gemini TTS) and
// music (Lyria), each asked for directly. Plain HTTPS: one request for text, pictures, speech and music; clips are a job that is
// started and then asked about until it is done.
import fs from 'node:fs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/';
const keyOf = (env = process.env) => { const k = env.GEMINI_API_KEY || env.GOOGLE_API_KEY; if (!k) throw new Error('GEMINI_API_KEY is not set'); return k; };
export const available = (env = process.env) => !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);

async function call(where, body, { env = process.env, timeout = 300000 } = {}) {
  let r; try { r = await fetch(/^https:/.test(where) ? where : BASE + where, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-goog-api-key': keyOf(env), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new Error(`Google could not be reached: ${e.name === 'TimeoutError' ? `no answer within ${Math.round(timeout / 1000)} seconds` : e.message}`); }
  const text = await r.text();
  if (!r.ok) { let said = text; try { said = JSON.parse(text).error?.message || text; } catch {} throw Object.assign(new Error(`Google answered ${r.status}: ${String(said).slice(0, 300)}`), { status: r.status }); }
  try { return JSON.parse(text); } catch { throw new Error('Google sent something that is not JSON: ' + text.slice(0, 200)); }
}
const MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const mimeOf = (file) => { const b = fs.readFileSync(file).subarray(0, 12); return b[0] === 0x89 && b[1] === 0x50 ? MIME.png : b.toString('latin1', 0, 4) === 'RIFF' ? MIME.webp : MIME.jpg; };
const b64 = (file) => fs.readFileSync(file).toString('base64');
const partsOf = (j) => j.candidates?.[0]?.content?.parts || [];
// why nothing came back, in the model's own words when it gives any
const why = (j) => { const c = j.candidates?.[0], said = partsOf(j).map((p) => p.text).filter(Boolean).join(' ').trim(), block = j.promptFeedback?.blockReason;
  return block ? ` (refused: ${block})` : c?.finishReason && c.finishReason !== 'STOP' ? ` (stopped: ${c.finishReason})` : said ? ` (it said: ${said.slice(0, 200)})` : ''; };

// { system, prompt } → text. `json` asks for one JSON value and nothing around it.
export async function text({ model, system, prompt, maxTokens = 16000, json = false }, env = process.env) {
  const j = await call(`models/${model}:generateContent`, { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) } }, { env, timeout: 420000 });
  const out = partsOf(j).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!out) throw new Error(`${model} returned no text` + why(j));
  return out;
}

// a recording (wav) → the words spoken in it, as the model wrote them down; '' when it makes out none
export async function hear({ model, file, language }, env = process.env) {
  const j = await call(`models/${model}:generateContent`, { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: b64(file) } },
    { text: `Write down the words spoken in this recording, exactly as they are said${language ? ` (the language is ${language})` : ''}. Do not correct them and do not guess at what was meant. Answer with those words only; if no words can be made out, answer with the single word NONE.` }] }],
    generationConfig: { maxOutputTokens: 2000, temperature: 0 } }, { env, timeout: 60000 });
  const out = partsOf(j).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  return /^none\.?$/i.test(out) ? '' : out;
}

// pictures and a question about them → what the model answers
export async function see({ model, files, prompt }, env = process.env) {
  const j = await call(`models/${model}:generateContent`, { contents: [{ role: 'user', parts: [...files.map((f) => ({ inlineData: { mimeType: mimeOf(f), data: b64(f) } })), { text: prompt }] }],
    generationConfig: { maxOutputTokens: 2000, temperature: 0 } }, { env, timeout: 60000 });
  return partsOf(j).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
}

// words (and pictures to work from, in the order the words refer to them) → one picture. Returns the bytes and what they are.
export async function picture({ model, prompt, refs = [], aspect = '9:16', size }, env = process.env) {
  const j = await call(`models/${model}:generateContent`, { contents: [{ parts: [...refs.map((f) => ({ inlineData: { mimeType: mimeOf(f), data: b64(f) } })), { text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, ...(size ? { imageSize: size } : {}) } } }, { env });
  const part = partsOf(j).find((p) => p.inlineData);
  if (!part) throw new Error(`${model} returned no picture` + why(j));
  return { bytes: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType };
}

// A sound file as returned: already in a container (WAV, MP3), or bare 16-bit samples that are given a WAV header here.
function sound(part) {
  const bytes = Buffer.from(part.inlineData.data, 'base64'), mime = part.inlineData.mimeType || '';
  if (!/L16|pcm/i.test(mime)) return { bytes, mime };
  const rate = +(/rate=(\d+)/.exec(mime)?.[1] || 24000), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + bytes.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(bytes.length, 40);
  return { bytes: Buffer.concat([h, bytes]), mime: 'audio/wav' };
}
// A line and how to say it → speech. The direction goes in as director's notes above the transcript: put in front of the line as a
// plain sentence, the model reads it aloud.
// its voices, each with Google's own word for how it sounds
export const VOICES = {
  female: { Kore: 'firm', Aoede: 'breezy', Leda: 'youthful', Zephyr: 'bright', Callirrhoe: 'easy-going', Autonoe: 'bright', Despina: 'smooth', Erinome: 'clear', Laomedeia: 'upbeat', Achernar: 'soft', Gacrux: 'mature', Pulcherrima: 'forward', Vindemiatrix: 'gentle', Sulafat: 'warm' },
  male: { Charon: 'informative', Puck: 'upbeat', Fenrir: 'excitable', Orus: 'firm', Enceladus: 'breathy', Iapetus: 'clear', Umbriel: 'easy-going', Algieba: 'smooth', Algenib: 'gravelly', Rasalgethi: 'informative', Alnilam: 'firm', Schedar: 'even', Achird: 'friendly', Zubenelgenubi: 'casual', Sadachbia: 'lively', Sadaltager: 'knowledgeable' },
};
export async function speech({ model, text: line, voice = 'Kore', style }, env = process.env) {
  const said = style ? `### DIRECTOR'S NOTES\n${style}\n\n#### TRANSCRIPT\n${line}` : line;
  const j = await call(`models/${model}:generateContent`, { contents: [{ parts: [{ text: said }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }, { env });
  const part = partsOf(j).find((p) => p.inlineData);
  if (!part) throw new Error(`${model} returned no speech` + why(j));
  return sound(part);
}

// a description → instrumental music (about a minute)
export async function music({ model, prompt }, env = process.env) {
  const j = await call(`models/${model}:generateContent`, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'] } }, { env, timeout: 420000 });
  const part = partsOf(j).find((p) => p.inlineData);
  if (!part) throw new Error(`${model} returned no music` + why(j));
  return sound(part);
}

// What a clip model of Google's can be asked for (Veo makes 4, 6 or 8 seconds; above 720p only 8).
export const CLIP = { seconds: [4, 6, 8], resolutions: ['720p', '1080p'], end: true, speaks: true };
// A first frame and a description → a clip (mp4), with the sound the model makes for it. `end` is a last frame to arrive at.
export async function clip({ model, prompt, frame, end, seconds = 8, aspect = '9:16', resolution = '720p', avoid }, env = process.env, { every = 8000, limit = 900000 } = {}) {
  const img = (f) => ({ bytesBase64Encoded: b64(f), mimeType: mimeOf(f) }), res = CLIP.resolutions.includes(resolution) ? resolution : '720p';
  const length = res !== '720p' ? 8 : CLIP.seconds.find((s) => s >= seconds) ?? 8;
  const job = await call(`models/${model}:predictLongRunning`, { instances: [{ prompt, ...(frame ? { image: img(frame) } : {}), ...(end ? { lastFrame: img(end) } : {}) }],
    parameters: { aspectRatio: aspect === '9:16' || aspect === '16:9' ? aspect : '16:9', resolution: res, durationSeconds: length, ...(avoid ? { negativePrompt: avoid } : {}) } }, { env });
  for (const t0 = Date.now(); Date.now() - t0 < limit;) {
    await new Promise((r) => setTimeout(r, every));
    const s = await call(job.name, undefined, { env });
    if (!s.done) continue;
    if (s.error) throw new Error(`${model} failed: ${String(s.error.message || JSON.stringify(s.error)).slice(0, 300)}`);
    const made = s.response?.generateVideoResponse, uri = made?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error(`${model} returned no clip` + (made?.raiMediaFilteredReasons?.length ? ` (refused: ${made.raiMediaFilteredReasons.join('; ').slice(0, 240)})` : ''));
    const r = await fetch(uri, { headers: { 'x-goog-api-key': keyOf(env) } });
    if (!r.ok) throw new Error(`the clip could not be fetched from Google (${r.status})`);
    return { bytes: Buffer.from(await r.arrayBuffer()), mime: 'video/mp4' };
  }
  throw new Error(`${model} did not finish within ${Math.round(limit / 60000)} minutes`);
}
