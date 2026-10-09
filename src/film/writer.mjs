// The writer: an idea becomes a series bible (series.json), and each episode a shot table (episodes/NN.json). A language model
// drafts; Songbe checks the draft the way it checks a hand-written one and hands every finding back for another pass. What these
// files say is written for the models that will film it: few people, few places, one simple action per shot, one speaker per shot.
import { chosen, modelFor } from './models.mjs';
import { SIZES, checkEpisode, checkSeries, episodeFile, hasEpisode, lengthOf, readEpisode, seriesFile, shotsOf, speechSeconds, writeJson } from './series.mjs';
import { NO_KEY, ask as askModel, writerFor } from '../providers/llm.mjs';
import { parseReply } from '../write.mjs';
import { FORMATS } from '../spec.mjs';
import { exists } from '../util.mjs';

const CANNOT = `WHAT THE VIDEO MODELS CANNOT FILM — write around it
- Crowds, fights, sport, driving, animals doing tricks, anything with many moving parts.
- Text that has to be read: signs, letters, phone and computer screens. If a message matters, someone says it.
- Fine work with hands (writing, typing, cooking, tying), eating and drinking, people passing through doors, people touching each other in complicated ways.
- Children, real people, brands.
What they film well: faces, looks, a turn of the head, someone standing up or sitting down, walking a few steps, an object held or put down, light, weather, rooms.`;
const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
export const languageOf = (given, idea) => { const g = String(given || '').trim(); return g ? g[0].toUpperCase() + g.slice(1).toLowerCase() : VIETNAMESE.test(idea) ? 'Vietnamese' : 'English'; };

const voiceList = (catalogue) => ['female', 'male'].map((g) => `${g}: ${Object.entries(catalogue[g] || {}).map(([name, sounds]) => `${name} (${sounds})`).join(', ')}`).join('\n  ');
export function bibleSystem({ language, episodes, seconds, voices = null }) {
  return `You are the head writer of a short-form drama series that is filmed entirely by AI video models. You design series these models can film well: two to four people, a few places, strong faces, simple physical action, feeling carried by looks and short lines.
Reply with one JSON object and nothing else: no explanation, no code fence.

THE OBJECT
{ "title": "…", "logline": "…", "style": "…", "look": "…", "tone": "…", "accent": "…",
  "cast": { "<id>": { "name": "…", "gender": "female" | "male", "role": "…", "look": "…", "wardrobe": "…", "manner": "…", "voice": { ${voices ? '"voice": "…", ' : ''}"style": "…" } } },
  "places": { "<id>": { "name": "…", "look": "…" } },
  "sounds": { "<id>": { "name": "…", "prompt": "…", "seconds": 2 } },
  "episodes": [ { "title": "…", "summary": "…" } ] }

LANGUAGES
- In ${language}: title, logline, the names of people, places and sounds, role, and each episode's title and summary.
- In English, because the picture models read English best: style, look, tone, accent, each look, wardrobe, manner and voice.style, and each sound's prompt.

FIELDS
- style: the medium, in a few words: "Photorealistic live action, natural skin, a still from a 35mm film", or "3D animation in the manner of a family feature film", or "Hand-drawn anime, clean line, flat shading". Nothing about light or mood.
- look: two sentences on the light, the lens, a palette of three or four named colours, the era and the country. Together with the style it is put in front of every picture prompt, so it must fit every scene. Do not mention the shape or size of the frame.
- tone: one sentence for the music and the acting.
- accent: how the voices sound, for example "Southern Vietnamese (Saigon) accent"; "" when it does not matter.
- cast: 2 to 4 people. The id is lower-case letters, digits and dashes ("lan", "ong-tu").
  look: face and body only — age, build, face shape, skin, hair (colour, length, how it is worn), and one feature that sets them apart (a mole, glasses, a scar, a grey streak). Concrete enough that two painters would paint the same person. No clothes here.
  wardrobe: the one outfit they wear through the whole series: garments and colours, simple, unlike anyone else's.
  manner: how they speak and carry themselves, one sentence.
  voice.style: the sound of the voice in a few words (pitch, texture, pace).${voices ? `
  voice.voice: the voice that suits the person, by name from this list, a different one for each person:
  ${voiceList(voices)}` : ''}
- places: 2 to 4. look: a set designer's note — size, furniture, materials, colours, where the light comes from, what is seen through the windows. No people in it.
- sounds: leave this out unless the story turns on a sound that must be the same every time it is heard — a knock on a wall, a phone ringing, a gunshot. At most three. prompt: exactly what is heard, one sound, in a few words, with nothing before or after it; seconds: how long it lasts. Shots then say at which second it is heard. Ordinary background (rain, room tone, footsteps) does not belong here.
- episodes: exactly ${episodes}. Each summary is two or three sentences: what happens, the image or line it opens on, and the question it ends on. Every episode runs about ${seconds} seconds on screen — one or two scenes, one turn of the story — opens on something that stops a thumb, and ends before its question is answered.

${CANNOT}`;
}
export function scriptSystem({ language, seconds }) {
  const low = Math.max(6, Math.round(seconds / 6)), high = Math.max(low + 2, Math.round(seconds / 3.6));
  return `You write the shooting script of one episode of a short-form drama series that is filmed entirely by AI video models. The script is a shot table: every shot is one camera setup that a model films as one clip.
Reply with one JSON object and nothing else: no explanation, no code fence.

THE OBJECT
{ "title": "…", "summary": "…", "music": "…",
  "scenes": [ { "where": "<place id>", "time": "…", "staging": "…",
    "shots": [ { "id": "1", "size": "…", "camera": "…", "who": ["<cast id>"], "action": "…", "line": { "who": "<cast id>", "text": "…", "how": "…" }, "sound": "…", "hear": [ { "sound": "<sound id>", "at": 1.0 } ], "seconds": 3 } ] } ] }

LANGUAGES
- In ${language}: title, summary, and every line's text. Lines are spoken language the way people really talk: short, with the everyday particles and contractions of ${language}, never bookish.
- In English: time, staging, camera, action, how, sound, music.

THE EPISODE
- About ${seconds} seconds: ${low} to ${high} shots in one or two scenes (three at most).
- The first shot must stop a thumb: a face in the middle of something, a line that raises a question. No slow establishing opening.
- The last shot leaves a question open: a reveal, a look, a line that changes what we thought.

SCENES
- where: one of the place ids you are given. time: the hour and the light, for example "late night, one desk lamp, rain outside".
- staging: where everyone is and the state of the room at this moment, in two sentences. A wide master picture of the scene is drawn from it, and every shot's first frame is drawn from that master, so name everyone present and where they stand or sit, left and right.

SHOTS
- id: "1", "2", "3", … through the whole episode.
- size: one of ${Object.keys(SIZES).map((s) => `"${s}"`).join(', ')}. Vary them. Dialogue is covered in alternating close-ups and over-the-shoulder shots, with a wider shot when someone moves.
- camera: how the camera moves, a few words: "static", "slow push in", "slow pull back", "handheld, slight sway", "slow pan left to right", "tilt up".
- who: the cast ids visible in this frame, and nobody else. "over shoulder" and "two shot" list both; "insert" lists nobody.
- action: present tense, only what is seen: posture, gesture, expression, where the eyes go. Begin with the person's name. ONE simple action per shot. No dialogue in it, no camera words, no thoughts.
- line: at most one per shot, said by one person, at most about fourteen words. Leave "line" out of shots nobody speaks in.
  When the speaker is in "who" we see them say it. To lay a line over the person listening, put only the listener in "who": the voice is then heard from off screen — good for reactions.
  how: the delivery, for example "quiet, hurt, holding back anger".
- sound: what is heard besides voices — room tone, rain, a door, footsteps. No music here.
- hear: only when the series has sounds of its own (you are given them): each time one of them is heard in this shot, with the second of the shot at which it begins. Three knocks are three entries. Give such a shot "seconds" enough for what is heard, and do not describe that sound again in "sound". Leave "hear" out everywhere else.
- seconds: for shots without a line, 2 to 5. Leave it out of shots with a line; they last as long as the line.
- "continues": true on a shot that carries straight on from the last frame of the shot before it (same framing, the action goes on). Use it rarely.
- Everyone wears their one outfit from the first shot to the last: nobody puts on or takes off a garment, and nothing is carried that the staging does not mention.
- music: one sentence for this episode's instrumental score: mood, instruments, tempo.
Use the cast and places you are given, by their ids, and nobody and nowhere else.

${CANNOT}`;
}

// ---- voices ----
// the voices of the model a series speaks with, by gender, or null when that model has no list
export function voicesFor(models, env = process.env) { try { return modelFor('voice', models?.voice, env, false).known?.voices || null; } catch { return null; } }
// Everyone ends up with a voice of that model: the one written for them when it is on the list and nobody has it yet, otherwise
// one of their gender that nobody has.
export function castVoices(series, env = process.env) {
  const catalogue = voicesFor(series.models, env);
  if (!catalogue) return series;
  const all = new Set([...Object.keys(catalogue.female || {}), ...Object.keys(catalogue.male || {})]), used = new Set();
  for (const c of Object.values(series.cast || {})) {
    const pool = Object.keys(catalogue[c.gender === 'male' ? 'male' : 'female'] || {}), want = c.voice?.voice;
    const pick = want && all.has(want) && !used.has(want) ? want : pool.find((v) => !used.has(v)) || pool[0];
    if (pick) { c.voice = { ...(c.voice || {}), voice: pick }; used.add(pick); }
  }
  return series;
}

// ---- the loop: draft, check, hand the findings back ----
async function drafted({ system, first, check, rounds, ask, env, onStep, what }) {
  let provider = ask ? 'custom' : writerFor(env), model = null, note = null, value = null, found = [], last = '', used = 0;
  if (!provider) throw new Error('Writing ' + NO_KEY);
  const say = async (q) => { const r = await (ask ? ask(q) : askModel({ ...q, maxTokens: 12000, json: true }, env)); if (typeof r === 'string') return r; ({ provider, model } = r); note = r.note || note; return r.text; };
  for (let round = 1; round <= rounds; round++) {
    onStep({ step: round === 1 ? 'write' : 'fix', round, found: found.length });
    const prompt = round === 1 ? first : `${first}\n\nYOUR PREVIOUS DRAFT\n${last}\n\nThe checks found the problems below. Fix every one of them, change nothing that was not wrong, and reply with the complete corrected JSON object and nothing else.\n${found.map((x) => '- ' + x).join('\n')}`;
    const reply = await say({ system, prompt }); used = round;
    try { value = parseReply(reply); } catch (e) { value = null; last = reply.slice(0, 8000); found = [`the reply was not one JSON object (${e.message})`]; continue; }
    last = JSON.stringify(value); found = check(value);
    if (!found.length) break;
  }
  if (!value || found.length) throw new Error(`The writer could not produce a valid ${what} after ${used} ${used === 1 ? 'try' : 'tries'}:\n  - ` + found.join('\n  - '));
  return { value, rounds: used, provider, model, note };
}

// An idea → series.json. `ask` is the model (injected in tests); `onStep` hears { step: 'write' | 'fix', round, found }.
export async function writeSeries(dir, idea, { episodes = 3, seconds = 60, format = 'tall', language, models, rounds = 3, force = false, ask, env = process.env, onStep = () => {} } = {}) {
  if (!idea || idea.trim().length < 12) throw new Error('Say a little more about the story: who it is about, where, and what goes wrong.');
  if (!FORMATS[format]) throw new Error(`unknown format "${format}" — choose from: ${Object.keys(FORMATS).join(', ')}`);
  if (exists(seriesFile(dir)) && !force) throw new Error(`${dir} already has a series.json (use --force to write over it)`);
  const lang = languageOf(language, idea), using = { ...chosen(env), ...(models || {}) };
  const settle = (d) => ({ title: d.title, language: lang, format, ...(d.logline ? { logline: d.logline } : {}), ...(d.style ? { style: d.style } : {}), look: d.look, ...(d.tone ? { tone: d.tone } : {}), ...(d.accent ? { accent: d.accent } : {}), seconds, ...(Object.keys(using).length ? { models: using } : {}),
    cast: d.cast, places: d.places, ...(d.sounds && typeof d.sounds === 'object' && Object.keys(d.sounds).length ? { sounds: d.sounds } : {}), episodes: Array.isArray(d.episodes) ? d.episodes : [] });
  const r = await drafted({ system: bibleSystem({ language: lang, episodes, seconds, voices: voicesFor(using, env) }), first: `THE IDEA\n${idea.trim()}\n\nSETTINGS\nLanguage: ${lang}. Frame: ${format === 'tall' ? 'tall 9:16, for phones' : format === 'wide' ? 'wide 16:9' : 'square'}. Episodes: ${episodes}, about ${seconds} seconds each.`,
    check: (d) => { const s = settle(d), bad = checkSeries(s); if (!bad.length && s.episodes.length !== episodes) bad.push(`episodes: there are ${s.episodes.length}, and ${episodes} were asked for`); return bad; }, rounds, ask, env, onStep, what: 'series' });
  const series = castVoices(settle(r.value), env);
  return { file: writeJson(seriesFile(dir), series), series, rounds: r.rounds, provider: r.provider, model: r.model, note: r.note };
}

// how long an episode's script runs, before anything is recorded
export const scriptSeconds = (series, episode) => +shotsOf(episode).reduce((t, { shot }) => t + lengthOf(shot, shot.line ? speechSeconds(shot.line.text, series.language) : null), 0).toFixed(1);
// The script of episode n → episodes/NN.json, written knowing the bible and what happened before.
export async function writeEpisode(dir, series, n, { rounds = 3, force = false, ask, env = process.env, onStep = () => {} } = {}) {
  const outline = series.episodes?.[n - 1];
  if (!outline) throw new Error(`the series has no episode ${n} (it plans ${series.episodes?.length || 0})`);
  if (hasEpisode(dir, n) && !force) throw new Error(`episode ${n} already has a script (use --force to write over it)`);
  const seconds = series.seconds || 60, before = [];
  for (let k = 1; k < n; k++) { const done = hasEpisode(dir, k) ? readEpisode(dir, k) : null, last = done ? shotsOf(done).slice(-3).map(({ shot }) => `${shot.action}${shot.line ? ` — ${series.cast[shot.line.who]?.name || shot.line.who}: "${shot.line.text}"` : ''}`) : null;
    before.push(`Episode ${k}: ${done?.title || series.episodes[k - 1].title}. ${done?.summary || series.episodes[k - 1].summary}${last ? `\n  It ended on: ${last.join(' / ')}` : ''}`); }
  const bible = { title: series.title, logline: series.logline, tone: series.tone, cast: Object.fromEntries(Object.entries(series.cast).map(([id, c]) => [id, { name: c.name, role: c.role, look: c.look, manner: c.manner }])),
    places: Object.fromEntries(Object.entries(series.places).map(([id, p]) => [id, { name: p.name, look: p.look }])),
    ...(series.sounds && Object.keys(series.sounds).length ? { sounds: Object.fromEntries(Object.entries(series.sounds).map(([id, x]) => [id, { name: x.name, heard: x.prompt, seconds: x.seconds }])) } : {}) };
  const first = `THE SERIES\n${JSON.stringify(bible)}\n\n${before.length ? `THE STORY SO FAR\n${before.join('\n')}\n\n` : ''}WRITE EPISODE ${n} OF ${series.episodes.length}: ${outline.title}\n${outline.summary}${n < series.episodes.length ? `\n\n(The next episode will be: ${series.episodes[n].summary})` : '\n\n(This is the last episode.)'}`;
  const r = await drafted({ system: scriptSystem({ language: series.language || 'English', seconds }), first, rounds, ask, env, onStep, what: 'script',
    check: (d) => { const bad = checkEpisode(series, d); if (bad.length) return bad; const runs = scriptSeconds(series, d);
      return runs > seconds * 1.45 ? [`the episode runs about ${Math.round(runs)} seconds; bring it to about ${seconds} by cutting shots or shortening lines`] : runs < seconds * .55 ? [`the episode runs only about ${Math.round(runs)} seconds; it should be about ${seconds}`] : []; } });
  const episode = { title: r.value.title || outline.title, summary: r.value.summary || outline.summary, ...(r.value.music ? { music: r.value.music } : {}), scenes: r.value.scenes };
  return { file: writeJson(episodeFile(dir, n), episode), episode, seconds: scriptSeconds(series, episode), rounds: r.rounds, provider: r.provider, model: r.model, note: r.note };
}
