// The shape of video.json, in one table. The validator and the JSON Schema (`songbe schema`) are both derived from it,
// so the documentation an agent reads and the checks a build runs cannot drift apart.
//
// Notation: 'str' | 'num' | 'bool' | 'text' (a string or a list of strings) | 'media' (a path, or { generate: { image, motion } })
//           'settings' (an object handed to a model as it is: that model's own settings, by its own names)
//           ['a', 'b'] one of these literals · [shape] a list · { key: shape } an object · a trailing ! on a key marks it required.
import fs from 'node:fs';
import path from 'node:path';
import { styleNames } from './packs.mjs';

const COLOUR = 'str';
const PICTURE = /\.(png|jpe?g|webp)$/i;
// The phone number of every example, starter and template: one that no network can ring (Vietnamese numbers do not start with 01).
// A video that still shows it is not finished, and the plan says so.
export const NO_SUCH_NUMBER = '0123456789';
// what "generate" may hold; anything else is a slip of the pen and is said so
const GENERATE = ['image', 'motion', 'from', 'imageModel', 'videoModel', 'model', 'seconds', 'resolution', 'seed', 'aspect', 'imageOptions', 'videoOptions'];
const common = { say: 'text', duration: 'num', minDuration: 'num', notice: 'str' };

export const SCENES = {
  footage: { ...common, media: 'media', mediaOffset: 'num', label: 'str', labelStyle: ['plain', 'pill'], pin: 'bool', 'title!': 'text', sub: 'str', chip: 'str' },
  card: { ...common, label: 'str', 'title!': 'text', media: 'media', mediaOffset: 'num', caption: 'str', stat: { 'badge!': 'str', 'heading!': 'str', sub: 'str' } },
  list: { ...common, tone: ['light', 'dark'], label: 'str', 'title!': 'text', 'items!': [{ 'text!': 'str', sub: 'str', icon: 'str' }] },
  phone: { ...common, tone: ['dark', 'light'], label: 'str', 'title!': 'text', screens: 'text', callouts: [{ 'text!': 'str', side: ['left', 'right'], y: 'num' }] },
  chat: { ...common, label: 'str', 'title!': 'text', messages: [{ 'from!': ['them', 'us'], 'text!': 'str' }],
    contact: { kicker: 'str', button: 'str', 'number!': 'text', sub: 'str' }, footer: { name: 'str', line: 'str' } },
  offer: { ...common, tone: ['dark', 'light'], label: 'str', 'title!': 'text', 'price!': 'str', was: 'str', terms: 'str', code: 'str' },
  photos: { ...common, tone: ['light', 'dark'], label: 'str', 'title!': 'text', 'photos!': [{ src: 'str', caption: 'str' }] },
  quote: { ...common, tone: ['light', 'dark'], label: 'str', 'quote!': 'str', name: 'str', role: 'str', stars: 'num', photo: 'str' },
  end: { ...common, tone: ['dark', 'light'], name: 'str', tagline: 'str', cta: 'str', badges: ['str'], url: 'str' },
};

// A minimal valid scene of each type: what `songbe studio` inserts when you add a scene, and a starting point for agents.
export const TEMPLATES = {
  footage: { type: 'footage', say: 'Open with one short question or promise.', label: 'Small label', title: ['Two short', 'headline lines'] },
  card: { type: 'card', say: 'Back the claim with one number.', label: 'Why it matters', title: ['A claim', 'worth showing'], stat: { badge: '24h', heading: 'One number', sub: 'and what it means' } },
  list: { type: 'list', say: 'Name three benefits, in the order they appear.', label: 'What you get', title: ['Three things', 'that matter'],
    items: [{ icon: 'check', text: 'First benefit', sub: 'A few words more' }, { icon: 'bolt', text: 'Second benefit', sub: 'A few words more' }, { icon: 'heart', text: 'Third benefit', sub: 'A few words more' }] },
  phone: { type: 'phone', say: 'Show the product being used.', label: 'In the app', title: ['See it', 'in action'], callouts: [{ text: 'A short callout', side: 'right', y: 0.3 }] },
  chat: { type: 'chat', say: ['Tell people how to reach you.', 'Oh one two three, four five six, seven eight nine.'], label: 'Get in touch', title: 'Message us',
    messages: [{ from: 'them', text: 'Hi, I am interested' }, { from: 'us', text: 'Hello! Happy to help.' }], contact: { kicker: 'Phone', button: 'Message', number: ['0123', '456', '789'], sub: 'Replies within the day' } },
  offer: { type: 'offer', say: 'Say the offer and until when it runs.', label: 'This week only', title: ['The offer', 'in two lines'], price: '-20%', terms: 'Until Sunday, in store' },
  photos: { type: 'photos', say: 'Show what people get.', label: 'Have a look', title: ['See it', 'for yourself'], photos: [{ caption: 'First picture' }, { caption: 'Second picture' }] },
  quote: { type: 'quote', say: 'Let a customer say it.', label: 'What customers say', quote: 'Replace this with the words of a real customer.', name: 'Their name', role: 'Who they are', stars: 5 },
  end: { type: 'end', say: 'Close with the call to action.', tagline: 'One line that sums it up', cta: 'Get started' },
};

// the two looks of the kit plus the looks of every pack that is found; refreshStyles() looks again (a pack was just added)
export const STYLES = styleNames();
export const refreshStyles = () => { STYLES.splice(0, STYLES.length, ...styleNames()); return STYLES; };
// named frames; "size": [w, h] in the spec overrides them for anything else (4:5 and the like use the square layouts)
export const FORMATS = { tall: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] };
export const TOP = {
  style: STYLES, format: Object.keys(FORMATS), captions: 'bool', size: ['num'], fps: 'num', tail: 'num', motionBlur: 'bool',
  'brand!': { name: 'str', ink: COLOUR, primary: COLOUR, accent: COLOUR, paper: COLOUR, muted: COLOUR, logo: { mark: 'str', word: 'str' } },
  voice: { model: 'str', voice: 'str', language: 'str', speed: 'num', emotion: 'str', options: 'settings' },
  music: { prompt: 'str', file: 'str', volume: 'num', sync: 'bool', avoid: 'str', model: 'str', seed: 'num', options: 'settings' },
};

const key = (k) => (k.endsWith('!') ? [k.slice(0, -1), true] : [k, false]);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function walk(value, shape, at, errs, dir) {
  if (shape === 'str') { if (typeof value !== 'string') errs.push(`${at}: expected text`); return; }
  if (shape === 'num') { if (typeof value !== 'number' || Number.isNaN(value)) errs.push(`${at}: expected a number`); return; }
  if (shape === 'bool') { if (typeof value !== 'boolean') errs.push(`${at}: expected true or false`); return; }
  if (shape === 'text') {
    if (typeof value === 'string') return;
    if (Array.isArray(value) && value.length && value.every((x) => typeof x === 'string')) return;
    errs.push(`${at}: expected text or a list of texts`); return;
  }
  if (shape === 'settings') { if (!isObj(value)) errs.push(`${at}: expected an object of that model's own settings, like { "stability": 0.4 }`); return; }
  if (shape === 'media') {
    if (typeof value === 'string') { if (dir && !fs.existsSync(path.resolve(dir, value))) errs.push(`${at}: file not found: ${value}`); return; }
    if (isObj(value) && isObj(value.generate)) {
      const g = value.generate, from = g.from === undefined ? [] : [].concat(g.from), words = typeof g.image === 'string';
      for (const k of Object.keys(g)) if (!GENERATE.includes(k)) errs.push(`${at}.generate.${k}: unknown field` + suggest(k, GENERATE));
      if (g.image !== undefined && !words) errs.push(`${at}.generate.image: expected a description of the picture`);
      if (!from.every((f) => typeof f === 'string' && f)) errs.push(`${at}.generate.from: expected the path of a picture, or a list of them`);
      else for (const f of from) {
        if (!PICTURE.test(f)) errs.push(`${at}.generate.from: ${f} is not a picture (png, jpg or webp)`);
        else if (dir && !fs.existsSync(path.resolve(dir, f))) errs.push(`${at}.generate.from: file not found: ${f}`);
      }
      if (!words && !from.length) errs.push(`${at}.generate: describe the picture ("image"), or name a picture of your own to start from ("from")`);
      if (from.length && !String(g.image || '').trim() && !String(g.motion || '').trim()) errs.push(`${at}.generate: "from" alone generates nothing: describe the new picture ("image") or what moves in yours ("motion"), or put the file itself as the media`);
      for (const k of ['imageOptions', 'videoOptions']) if (g[k] !== undefined && !isObj(g[k])) errs.push(`${at}.generate.${k}: expected an object of that model's own settings, like { "guidance_scale": 3 }`);
      return;
    }
    errs.push(`${at}: expected a file path or { "generate": { "image": "…", "motion": "…" } }`); return;
  }
  if (Array.isArray(shape)) {
    if (shape.length > 1 || (typeof shape[0] === 'string' && !['str', 'num', 'bool', 'text', 'media', 'settings'].includes(shape[0]))) {   // literals
      if (!shape.includes(value)) errs.push(`${at}: must be one of ${shape.map((x) => JSON.stringify(x)).join(', ')}`); return;
    }
    if (!Array.isArray(value)) { errs.push(`${at}: expected a list`); return; }
    value.forEach((v, i) => walk(v, shape[0], `${at}[${i}]`, errs, dir)); return;
  }
  if (!isObj(value)) { errs.push(`${at}: expected an object`); return; }
  const known = new Map(Object.keys(shape).map((k) => { const [n, req] = key(k); return [n, [shape[k], req]]; }));
  for (const k of Object.keys(value)) if (!known.has(k)) errs.push(`${at}.${k}: unknown field` + suggest(k, [...known.keys()]));
  for (const [n, [sub, req]] of known) {
    if (value[n] === undefined || value[n] === null) { if (req) errs.push(`${at}.${n}: required`); continue; }
    walk(value[n], sub, `${at}.${n}`, errs, dir);
  }
}

function suggest(k, names) {
  const d = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
  const best = names.map((n) => [d(k.toLowerCase(), n.toLowerCase()), n]).sort((a, b) => a[0] - b[0])[0];
  return best && best[0] <= 2 ? ` (did you mean "${best[1]}"?)` : '';
}

// Returns a list of problems; empty means the spec is fine. `dir` enables file-existence checks.
export function validate(spec, dir) {
  const errs = [];
  if (!isObj(spec)) return ['video.json must be an object'];
  const { scenes, ...top } = spec;
  for (const k of ['voice', 'music']) if (top[k] === false) delete top[k];      // false switches the voice or the music off
  walk(top, TOP, 'video', errs, dir);
  if (top.size && (top.size.length !== 2)) errs.push('video.size: expected [width, height]');
  // a colour is a colour and nothing more (it is handed to the style sheet as written)
  for (const k of ['ink', 'primary', 'accent', 'paper', 'muted']) { const v = top.brand?.[k];
    if (typeof v === 'string' && !/^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl|hwb|lab|lch|oklab|oklch)a?\([-0-9a-z.,%/\s]+\))$/i.test(v.trim())) errs.push(`video.brand.${k}: expected a colour such as "#0A1B31"`); }
  for (const f of ['mark', 'word']) { const v = top.brand?.logo?.[f]; if (typeof v === 'string' && dir && !fs.existsSync(path.resolve(dir, v))) errs.push(`video.brand.logo.${f}: file not found: ${v}`); }
  if (top.music?.file && dir && !fs.existsSync(path.resolve(dir, top.music.file))) errs.push(`video.music.file: file not found: ${top.music.file}`);
  if (!Array.isArray(scenes) || !scenes.length) { errs.push('video.scenes: at least one scene is required'); return errs; }
  scenes.forEach((sc, i) => {
    const at = `scenes[${i}]`;
    if (!isObj(sc)) return errs.push(`${at}: expected an object`);
    if (!SCENES[sc.type]) return errs.push(`${at}.type: must be one of ${Object.keys(SCENES).join(', ')}` + (sc.type ? suggest(String(sc.type), Object.keys(SCENES)) : ''));
    const { type, ...rest } = sc;
    walk(rest, SCENES[type], at, errs, dir);
    if (type === 'phone' && dir) for (const s of [].concat(sc.screens || [])) if (typeof s === 'string' && !fs.existsSync(path.resolve(dir, s))) errs.push(`${at}.screens: file not found: ${s}`);
    if (type === 'photos' && dir && Array.isArray(sc.photos)) sc.photos.forEach((p, n) => { if (typeof p?.src === 'string' && !fs.existsSync(path.resolve(dir, p.src))) errs.push(`${at}.photos[${n}].src: file not found: ${p.src}`); });
    if (type === 'photos' && Array.isArray(sc.photos) && (sc.photos.length < 1 || sc.photos.length > 4)) errs.push(`${at}.photos: one to four pictures`);
    if (type === 'quote' && dir && typeof sc.photo === 'string' && !fs.existsSync(path.resolve(dir, sc.photo))) errs.push(`${at}.photo: file not found: ${sc.photo}`);
    if (type === 'quote' && typeof sc.stars === 'number' && (sc.stars < 1 || sc.stars > 5)) errs.push(`${at}.stars: from 1 to 5`);
    if (!sc.say && !sc.duration) errs.push(`${at}: give the scene something to "say" or a "duration" in seconds`);
  });
  return errs;
}

// JSON Schema (draft 2020-12) generated from the same table, for editors and agents.
function toSchema(shape) {
  if (shape === 'str') return { type: 'string' };
  if (shape === 'num') return { type: 'number' };
  if (shape === 'bool') return { type: 'boolean' };
  if (shape === 'text') return { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }] };
  if (shape === 'settings') return { type: 'object', description: "that model's own settings by their own names (songbe model <endpoint> lists them)" };
  if (shape === 'media') return { anyOf: [{ type: 'string', description: 'path to a video or image' },
    { type: 'object', required: ['generate'], properties: { generate: { type: 'object', anyOf: [{ required: ['image'] }, { required: ['from'] }], properties: { image: { type: 'string', description: 'the still picture, described; with "from", what to make of your own picture' }, motion: { type: 'string', description: 'what moves; leave out for a still' },
      from: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }], description: 'a picture of your own (or several) to start from: with "image" the same thing in a new setting, with only "motion" your picture set in motion' },
      imageModel: { type: 'string', description: 'any text-to-image endpoint on fal.ai; with "from", one that takes pictures' }, videoModel: { type: 'string', description: 'any image-to-video endpoint on fal.ai' }, seconds: { type: 'number' }, resolution: { type: 'string' }, seed: { type: 'number' },
      imageOptions: { type: 'object', description: 'settings of the picture model by their own names (songbe model <endpoint> lists them)' }, videoOptions: { type: 'object', description: 'settings of the clip model by their own names' } } } } }] };
  if (Array.isArray(shape)) {
    if (shape.length > 1 || (typeof shape[0] === 'string' && !['str', 'num', 'bool', 'text', 'media', 'settings'].includes(shape[0]))) return { enum: shape };
    return { type: 'array', items: toSchema(shape[0]) };
  }
  const properties = {}, required = [];
  for (const k of Object.keys(shape)) { const [n, req] = key(k); properties[n] = toSchema(shape[k]); if (req) required.push(n); }
  return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) };
}
export function jsonSchema() {
  const top = toSchema(TOP);
  top.properties.scenes = { type: 'array', minItems: 1, items: { oneOf: Object.entries(SCENES).map(([type, shape]) => {
    const s = toSchema(shape); s.properties = { type: { const: type }, ...s.properties }; s.required = ['type', ...(s.required || [])]; return s; }) } };
  top.required = [...(top.required || []), 'scenes'];
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Songbe video.json', ...top };
}
