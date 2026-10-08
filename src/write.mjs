// A brief in, a video.json out. A language model drafts; Songbe then checks the draft the way it checks any spec — its shape, how
// much text fits, the layout as actually drawn, numbers and addresses that are not in the brief, colours that cannot be read — and
// hands every finding back for another pass. What reaches the disk has been through those checks, and whatever could not be fixed
// is reported instead of hidden.
import fs from 'node:fs';
import path from 'node:path';
import { fitGuide, tooLong, tooLongNote } from './fit.mjs';
import { packStyles } from './packs.mjs';
import { makePlan } from './plan.mjs';
import { ask as askModel, modelFor, writerFor } from './providers/llm.mjs';      // (writerFor is re-exported below for the app)
import { lintLayout } from './render.mjs';
import { FORMATS, STYLES, jsonSchema, validate } from './spec.mjs';
import { ROOT, exists, mkdir, run, tools } from './util.mjs';

// the voices the examples were tuned with; any other language gets a neutral voice and lets the provider find the language
const VOICES = { vietnamese: { voice: 'Casual_Guy', language: 'Vietnamese', speed: 1.08, emotion: 'happy' }, english: { voice: 'Friendly_Person', language: 'English', speed: 1.05, emotion: 'happy' } };
const LANGUAGE = { vi: 'Vietnamese', vn: 'Vietnamese', 'tiếng việt': 'Vietnamese', en: 'English' };
const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
const FRAME = { tall: 'tall 9:16 (phone feeds: TikTok, Reels, Shorts)', square: 'square 1:1 (feeds)', wide: 'wide 16:9 (YouTube, screens)' };
const MEDIA = /\.(png|jpe?g|webp|gif|svg|mp4|mov|webm)$/i, VIDEO = /\.(mp4|mov|webm)$/i;

// ---- what the model is told ----
const pattern = (name) => {      // an example, reduced to the part a writer writes
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', name, 'video.json'), 'utf8'));
  return JSON.stringify({ style: s.style || 'soft', brand: { ...s.brand, logo: undefined }, voice: { language: s.voice?.language }, music: { prompt: s.music?.prompt }, scenes: s.scenes });
};
// the looks a writer may choose from, each with a line on what it suits
const LOOKS = () => [['soft', 'rounded and friendly: apps, services, food, care'], ['bold', 'condensed capitals and flat colour: promotions, recruitment, retail, events'],
  ...[...packStyles().values()].map((s) => [s.name, s.about || 'a look from the pack "' + s.pack + '"'])];
export function systemPrompt({ style, footage = false } = {}) {
  return `You write video.json files for Songbe, a tool that turns one JSON description into a finished short ad with voice-over, motion graphics and music.
Reply with one JSON object and nothing else: no explanation before or after, no code fence.

THE OBJECT
{ ${style ? '' : `"style": ${LOOKS().map(([n]) => `"${n}"`).join(' | ')}, `}"brand": { … }, "voice": { "language": "…" }, "music": { "prompt": "…" }, "scenes": [ … ] }
- brand: "name", and five colours written as #RRGGBB: "ink" (very dark; white text is set on it), "primary" (the brand colour; white text is set on it), "accent" (bright; ink text is set on it), "paper" (very light; ink text is set on it), "muted" (a grey for secondary text on white). Use the colours the brief names; otherwise choose a palette that suits the business.
- voice.language: the language of the brief as an English word, for example "Vietnamese" or "English". Write every "say" and every text in that language.
- music.prompt: one sentence describing an instrumental track that suits the ad: mood, instruments, and a tempo between 96 and 112 BPM.${style ? '' : '\n- style: ' + LOOKS().map(([n, about]) => `"${n}" (${about})`).join('; ') + '.'}
- scenes: four or five, one idea each. A scene lasts as long as its "say" takes to read aloud; aim for 15 to 25 seconds in all, which is 45 to 65 words (60 to 90 syllables in Vietnamese).

SCENE TYPES
- "footage": the hook. A headline over full-frame footage or, without media, over a plain branded background. Fields: label, title, sub, chip, pin (true puts a location pin before the label), media.
- "card": one claim, with an optional picture (media, caption) and an optional stat card (stat.badge is 2 to 4 characters such as "0đ" or "24h", then stat.heading and stat.sub).
- "list": benefits arriving one by one. items[] of { icon, text, sub }; three rows are best. icon is one of: check, star, bolt, heart, shield, drop, clock, bell, sun, pin, number.
- "phone": an app or website in use. Needs "screens" (portrait screenshots from the available media); one or two callouts[] of { text, side: "left" | "right", y: 0.2 to 0.7 }. Never use this type without screens.
- "chat": how to get in touch. messages[] of { from: "them" | "us", text } (them asks first, us answers), contact { kicker, button, number, sub }, footer { name, line }. contact.number is the phone number as a list of digit groups, for example ["0900", "000", "000"].
- "end": the sign-off. name (defaults to the brand), tagline, cta (the button), badges[], url.
A good order: hook, proof or benefits, how it works or what you get, how to act.

EVERY SCENE
- "say": what the voice reads. One or two short sentences that sound natural spoken aloud. Where reading aloud differs from spelling (abbreviations, codes, numbers), write both as {spoken|shown}: the first part is read, the second appears in captions. Example: "Call {zero nine hundred, zero zero zero|0900 000}." Do the same for prices and figures the voice says, so that captions show the figure: "{twenty-nine dollars|$29} a month".
- A chat scene that shows contact.number must end its "say" by reading the number aloud, digit group by digit group, in that {spoken|shown} form.
- On screen: few words, sentence case. "title" is a list of lines. [[words]] puts them on a highlight plate: use it once per scene, on the one or two words that carry the idea. **words** colours them with the accent.
- Do not repeat on screen the full sentence the voice says; the screen carries the key words.

FACTS
Use only what the brief states. Never add a price, salary, number, statistic, rating, phone number, address, web address, award, guarantee or benefit that the brief does not contain, and no promise it does not make ("no hidden fees", "cancel anytime", "included", "guaranteed", "the best"). No number in the brief worth showing: no stat card. No contact detail in the brief: close with the brand and a call to action that needs none.

HOW MUCH FITS (characters as shown, counting spaces)
${fitGuide(style || '*')}
Shorter is better than exactly at the limit; never go over.

MEDIA
Use only the files listed under "Available media" in the request, with their paths exactly as given. "footage" and "card" also work without media.${footage
    ? '\nYou may ask for generated footage on at most two footage or card scenes: "media": { "generate": { "image": "a detailed description of the still picture", "motion": "what moves, in a few words" } }. Every scene that does so must also set "notice" to a short AI disclosure in the brief\'s language, for example "Illustration generated with AI".'
    : '\nDo not ask for generated footage.'}
Never put another company's logo or name in the video unless the brief says it may be used.

SCHEMA of the whole file (the validator uses exactly this; a field it does not list is an error). You write only brand, voice.language, music.prompt, ${style ? '' : 'style, '}and scenes; everything else is set for you.
${JSON.stringify(jsonSchema())}

TWO EXAMPLES, for the shape and the tone, not the content
${pattern('app-launch-en')}
${pattern('recruitment-vi')}`;
}
export function userPrompt({ brief, style, format = 'tall', captions = true, media = [] }) {
  return `BRIEF
${brief.trim()}

SETTINGS
Frame: ${FRAME[format] || format}. Look: ${style ? `"${style}" (already chosen)` : 'yours to choose'}. Captions: ${captions ? 'on, so every "say" should read well as text too' : 'off'}.
Available media: ${media.length ? '\n' + media.map((m) => `- ${m.path} (${m.kind}${m.size ? `, ${m.size[0]}×${m.size[1]}, ${m.size[1] > m.size[0] ? 'portrait' : m.size[1] === m.size[0] ? 'square' : 'landscape'}` : ''})`).join('\n') : 'none'}`;
}

// the pictures and clips already in the project, which the draft may use
export function mediaOf(dir) {
  const base = path.join(dir, 'media'), out = [];
  if (!exists(base)) return out;
  for (const name of fs.readdirSync(base).sort()) {
    if (!MEDIA.test(name) || /^(logo|mark|wordmark)\./i.test(name)) continue;
    let size = null;
    try { const st = JSON.parse(run(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path.join(base, name)])).streams[0]; if (st?.width) size = [st.width, st.height]; } catch {}
    out.push({ path: 'media/' + name, kind: VIDEO.test(name) ? 'video' : 'image', size });
  }
  return out.slice(0, 24);
}

// ---- what a reply is turned into ----
// the one JSON object in a reply, even when it arrives wrapped in a sentence or a code fence
export function parseReply(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('there is no JSON object in the reply');
  return JSON.parse(text.slice(a, b + 1));
}
const languageName = (given, brief) => {
  const g = String(given || '').trim(), known = LANGUAGE[g.toLowerCase()] || (g && g[0].toUpperCase() + g.slice(1).toLowerCase());
  return /^[A-Za-z]{3,20}$/.test(known || '') ? known : VIETNAMESE.test(brief) ? 'Vietnamese' : 'English';
};
// The file as it will be saved: the model's brand, music and scenes, with what is not the model's to decide set here.
function finish(draft, { brief, style, format, captions, language, dir }) {
  const lang = languageName(language || draft.voice?.language, brief), logo = exists(path.join(dir, 'media')) ? fs.readdirSync(path.join(dir, 'media')).find((n) => /^(logo|mark)\.(svg|png|webp|jpe?g)$/i.test(n)) : null;
  const brand = draft.brand && typeof draft.brand === 'object' ? { ...draft.brand } : {};
  delete brand.logo; if (logo) brand.logo = { mark: 'media/' + logo };
  return { format, style: style || (STYLES.includes(draft.style) ? draft.style : 'soft'), captions, brand, voice: VOICES[lang.toLowerCase()] || { voice: 'Friendly_Person', language: 'auto' },
    ...(typeof draft.music?.prompt === 'string' && draft.music.prompt.trim() ? { music: { prompt: draft.music.prompt.trim() } } : {}), scenes: draft.scenes };
}

// ---- checks beyond the validator ----
const squash = (s) => String(s).replace(/(?<=\d)[\s.,\-–](?=\d)/g, '');      // "0900 000 000" and "4,000" as runs of digits
const NOT_TEXT = new Set(['type', 'icon', 'side', 'from', 'tone', 'labelStyle', 'media', 'screens', 'y', 'pin', 'duration', 'minDuration', 'mediaOffset']);
function texts(value, at, out = []) {
  if (typeof value === 'string') out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => texts(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (!NOT_TEXT.has(k)) texts(v, `${at}.${k}`, out);
  return out;
}
// Numbers and web addresses in the scenes that the brief never mentions. (Single digits are let through: "3 steps" is counting, not a claim.)
export function inventedFacts(spec, brief) {
  const known = squash(brief).toLowerCase(), out = [];
  for (const [at, text] of texts(spec.scenes, 'scenes')) {
    for (const run of squash(text).match(/\d{2,}/g) || []) if (!known.includes(run)) out.push(`${at}: "${text}" shows the number ${run}, which is not in the brief`);
    for (const site of text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|vn|net|org|io|app|co|me|asia|shop|store|info|biz|example)(?:\.[a-z]{2})?\b/gi) || []) if (!known.includes(site.toLowerCase())) out.push(`${at}: "${text}" shows the address ${site}, which is not in the brief`);
  }
  return [...new Set(out)];
}
// Colour pairs the kit sets text on, which must stay readable.
const lum = (hex) => { const h = hex.replace('#', ''), f = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6); return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255).map((c) => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [.2126, .7152, .0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
export function unreadable(brand = {}) {
  const hex = (k) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(brand[k] || '') ? brand[k] : null), c = { ink: hex('ink') || '#0A1B31', primary: hex('primary') || '#004DFC', accent: hex('accent') || '#4FE0D6', paper: hex('paper') || '#F2F6FC', muted: hex('muted') || '#51627A' }, out = [];
  const need = (a, b, least, what) => { if ((brand[a] || brand[b]) && ratio(c[a] || a, c[b] || b) < least) out.push(`brand: ${what} (${c[a] || a} with ${c[b] || b}) has too little contrast to read; it needs a ratio of ${least} and has ${ratio(c[a] || a, c[b] || b).toFixed(1)}`); };
  need('ink', '#FFFFFF', 7, 'white text on ink'); need('paper', 'ink', 7, 'ink text on paper'); need('accent', 'ink', 4.5, 'ink text on accent');
  need('primary', '#FFFFFF', 3, 'white text on primary'); need('primary', 'paper', 3, 'primary text on paper'); need('muted', '#FFFFFF', 3.5, 'muted text on white');
  if (out.some((x) => x.includes('on primary'))) out.push('brand: a light brand colour (yellow, lime, pale blue) belongs in "accent", where ink text sits on it; "primary" must be dark enough for white text');
  return out;
}

// Everything worth sending back to the writer about one draft. `fatal` are the findings a file must not be saved with.
export async function review(spec, dir, { brief, draw = true } = {}) {
  const fatal = validate(spec, dir).map((e) => 'not valid: ' + e), other = [];
  if (fatal.length) return { fatal, other };
  for (const sc of spec.scenes) if (sc.type === 'phone' && ![].concat(sc.screens || []).length) fatal.push('a "phone" scene has no screens: use another scene type, there is nothing to show in the phone');
  if (spec.scenes.length < 4) other.push(`there are only ${spec.scenes.length} scenes; an ad wants four or five (a hook, the reasons, how to act, a sign-off with the brand)`);
  other.push(...tooLong(spec).map((f) => tooLongNote(f) + (f.count ? '' : ': say it in fewer words (count the characters)')), ...inventedFacts(spec, brief), ...unreadable(spec.brand));
  let seconds = null;
  try {
    const plan = await makePlan(dir, { offline: true, spec }); seconds = plan.duration;
    let canDraw = draw; try { tools.chrome; } catch { canDraw = false; }
    if (canDraw) for (const f of await lintLayout(dir, plan)) if (f.level === 'problem' || f.message.includes('too long')) other.push(`scene ${f.scene} (${f.type}) as drawn: ${f.message}`);
  } catch (e) { other.push('could not be laid out: ' + e.message); }
  if (seconds !== null && seconds > 32) other.push(`the voice-over runs about ${Math.round(seconds)} seconds; shorten the "say" texts to land between 15 and 25`);
  if (seconds !== null && seconds < 9) other.push(`the voice-over runs only about ${Math.round(seconds)} seconds; give the scenes a little more to say`);
  return { fatal, other, seconds };
}

// Writes <dir>/video.json from a brief. Returns { file, spec, rounds, provider, model, left } where `left` lists what the checks
// still found after the last pass. `ask` is the model (injected in tests); `onStep` hears { step: 'write' | 'check' | 'fix', round, found }.
export async function writeSpec(dir, brief, { style, format = 'tall', captions = true, language, footage = false, rounds = 3, force = false, ask, env = process.env, onStep = () => {} } = {}) {
  if (!brief || brief.trim().length < 12) throw new Error('Say a little more about the ad: what it is for, who it is for, and what people should do.');
  if (style && !STYLES.includes(style)) throw new Error(`unknown style "${style}" — choose one of: ${STYLES.join(', ')}`);
  if (!FORMATS[format]) throw new Error(`unknown format "${format}" — choose from: ${Object.keys(FORMATS).join(', ')}`);
  const file = path.join(mkdir(dir), 'video.json');
  if (exists(file) && !force) throw new Error(`${dir} already has a video.json (use --force to write over it)`);
  let provider = ask ? 'custom' : writerFor(env), model = ask ? null : modelFor(provider, env), note = null;
  if (!provider) throw new Error('Writing needs a key: ANTHROPIC_API_KEY, or the FAL_KEY that also makes the voice and music.');
  const say = async (q) => { const r = await (ask ? ask(q) : askModel(q, env)); if (typeof r === 'string') return r; ({ provider, model } = r); note = r.note || note; return r.text; }, system = systemPrompt({ style, footage }), first = userPrompt({ brief, style, format, captions, media: mediaOf(dir) });

  let spec = null, found = null, last = '', used = 0;
  for (let round = 1; round <= rounds; round++) {
    onStep({ step: round === 1 ? 'write' : 'fix', round, found: found ? found.fatal.length + found.other.length : 0 });
    const prompt = round === 1 ? first : `${first}\n\nYOUR PREVIOUS DRAFT\n${last}\n\nThe checks found the problems below. Fix every one of them, change nothing that was not wrong, and reply with the complete corrected JSON object and nothing else.\n${[...found.fatal, ...found.other].map((x) => '- ' + x).join('\n')}`;
    const reply = await say({ system, prompt }); used = round;
    let draft; try { draft = parseReply(reply); } catch (e) { last = reply.slice(0, 6000); spec = null; found = { fatal: [`the reply was not one JSON object (${e.message})`], other: [] }; continue; }
    spec = finish(draft, { brief, style, format, captions, language, dir }); last = JSON.stringify({ ...(style ? {} : { style: spec.style }), brand: spec.brand, voice: { language: spec.voice.language }, music: spec.music, scenes: spec.scenes });
    onStep({ step: 'check', round });
    found = await review(spec, dir, { brief });
    if (!found.fatal.length && !found.other.length) break;
  }
  if (!spec || found.fatal.length) throw new Error(`The writer could not produce a valid video after ${used} ${used === 1 ? 'try' : 'tries'}:\n  - ` + found.fatal.join('\n  - '));
  fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n');
  return { file, spec, rounds: used, provider, model, note, seconds: found.seconds ?? null, left: found.other };
}
export { writerFor };
