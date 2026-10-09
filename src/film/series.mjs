// A film project on disk: series.json — the bible every episode shares (the look, the cast with their faces and voices, the
// places) — and episodes/NN.json, the script of one episode as a shot table. Both are plain files a person or an agent can edit;
// this module reads them, says what is wrong with them, and holds the few numbers the rest of the flow times itself by.
import fs from 'node:fs';
import path from 'node:path';
import { FORMATS } from '../spec.mjs';
import { exists, mkdir } from '../util.mjs';

export const NAME = /^[a-z][a-z0-9-]{0,23}$/;      // how cast, places and shots are named: short, typed by hand in commands
// How much of the subject a shot shows. The words on the right are what a picture model is told.
export const SIZES = {
  wide: 'Wide shot: the whole space with everyone in it, the figures small in the frame',
  full: 'Full shot: the figure from head to toe, with some of the room around',
  medium: 'Medium shot, from the waist up',
  'two shot': 'Medium two-shot: both people in the frame, from the waist up',
  'over shoulder': 'Over-the-shoulder shot: the nearer person is a soft, out-of-focus shoulder and back of the head at the edge of the frame, the other faces the camera in focus',
  close: 'Close-up: the face and shoulders fill the frame',
  'extreme close': 'Extreme close-up: only the eyes and part of the face, or one small detail',
  insert: 'Insert shot: a close view of the object alone, no faces',
};
export const ASPECT = { tall: '9:16', wide: '16:9', square: '1:1' };
export const frameOf = (series) => ({ size: FORMATS[series.format] || FORMATS.tall, aspect: ASPECT[series.format] || ASPECT.tall });

// ---- timing ----
export const LEAD = 0.3, TAIL = 0.5;      // silence before a line and after it, inside its shot
export const PLAIN = 4;                   // a shot nobody speaks in, when the script does not say how long
// How long a line takes to say, before it has been recorded: Vietnamese is counted in syllables, other languages in words.
// `voiceSeconds` is the voice alone; `speechSeconds` adds the pauses its punctuation asks for.
export const voiceSeconds = (text, language = 'English') => +(String(text).trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length / (/vietnam/i.test(language) ? 4.4 : 2.7)).toFixed(2);
export function speechSeconds(text, language = 'English') {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length, pauses = (String(text).match(/[.,;:!?…]/g) || []).length;
  return +(words / (/vietnam/i.test(language) ? 4.4 : 2.7) + pauses * .22).toFixed(2);
}
// What a shot is for the sound: someone in the frame speaks ('seen'), a voice is heard over it ('heard'), or nobody speaks.
export const speechOf = (shot) => (!shot.line ? null : (shot.who || []).includes(shot.line.who) ? 'seen' : 'heard');
// How long a shot runs in the cut, given how long its line turned out (null: nobody speaks, or the model speaks at its own pace).
export const lengthOf = (shot, lineSeconds = null) => +Math.max(shot.seconds || (lineSeconds === null ? PLAIN : 0), lineSeconds === null ? 0 : LEAD + lineSeconds + TAIL).toFixed(2);

// ---- files ----
const two = (n) => String(n).padStart(2, '0');
export const seriesFile = (dir) => path.join(dir, 'series.json');
export const episodeFile = (dir, n) => path.join(dir, 'episodes', `${two(n)}.json`);
const readJson = (file, what) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(e.code === 'ENOENT' ? `there is no ${what} here (${file})` : `${what} is not valid JSON: ${e.message}`); } };
export const readSeries = (dir) => readJson(seriesFile(dir), 'series.json');
export const readEpisode = (dir, n) => readJson(episodeFile(dir, n), `script of episode ${n}`);
export const hasEpisode = (dir, n) => exists(episodeFile(dir, n));
// the numbers of the episodes that have a script, in order
export const written = (dir) => (exists(path.join(dir, 'episodes')) ? fs.readdirSync(path.join(dir, 'episodes')).map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b) : []);
export function writeJson(file, value) { mkdir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); return file; }

// every shot of an episode in order, with the scene it belongs to: [{ shot, scene, s (scene number), i (place in the episode) }]
export const shotsOf = (episode) => (episode.scenes || []).flatMap((scene, s) => (scene.shots || []).map((shot) => ({ shot, scene, s: s + 1 }))).map((x, i) => ({ ...x, i }));

// ---- what is wrong with them ----
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function checkSeries(series, dir = null) {
  const bad = [];
  if (!isObject(series)) return ['series.json must be an object'];
  if (!text(series.title)) bad.push('title: the series needs a name');
  if (!text(series.look)) bad.push('look: describe how the pictures look (live action or drawn, the light, the lens, the colours) in a sentence or two');
  if (series.format !== undefined && !FORMATS[series.format]) bad.push(`format: "${series.format}" is not one of ${Object.keys(FORMATS).join(', ')}`);
  const sets = [['cast', 'someone in the cast'], ['places', 'a place']];
  for (const [set, what] of sets) {
    if (!isObject(series[set]) || !Object.keys(series[set]).length) { bad.push(`${set}: the series needs at least ${what}`); continue; }
    for (const [id, x] of Object.entries(series[set])) {
      const at = `${set}.${id}`;
      if (!NAME.test(id)) bad.push(`${at}: names here are lower-case letters, digits and dashes, starting with a letter (like "lan" or "old-house")`);
      if (id === 'look' || id === 'style' || id === 'keep' || /^e\d+(-|$)/.test(id) || /-(face|sheet|plate)$/.test(id)) bad.push(`${at}: "${id}" is a name the canvas uses itself; choose another`);
      if (set === 'places' && series.cast?.[id]) bad.push(`${at}: "${id}" already names someone in the cast`);
      if (!isObject(x)) { bad.push(`${at}: must be an object`); continue; }
      if (!text(x.name)) bad.push(`${at}.name: what is ${set === 'cast' ? 'this person' : 'this place'} called?`);
      const own = [].concat(x.pictures ?? []);
      if (!text(x.look) && !own.length) bad.push(`${at}: needs a "look" (what ${set === 'cast' ? 'they look' : 'it looks'} like) or "pictures" of your own`);
      for (const p of own) if (!text(p)) bad.push(`${at}.pictures: each is the path of a picture`); else if (dir && !exists(path.resolve(dir, p))) bad.push(`${at}.pictures: ${p} is not there`);
      if (set === 'cast' && x.voice !== undefined && !isObject(x.voice)) bad.push(`${at}.voice: must be an object like { "voice": "Kore" }`);
    }
  }
  // the sounds the story turns on (a knock, a phone ringing): each is made once, and shots say at which second it is heard
  if (series.sounds !== undefined && !isObject(series.sounds)) bad.push('sounds: must be an object like { "knock": { "prompt": "one slow knock on a concrete wall" } }');
  else for (const [id, x] of Object.entries(series.sounds || {})) {
    const at = `sounds.${id}`;
    if (!NAME.test(id)) bad.push(`${at}: names here are lower-case letters, digits and dashes, starting with a letter (like "knock")`);
    if (id === 'look' || id === 'style' || id === 'keep' || /^e\d+(-|$)/.test(id) || /-(face|sheet|plate)$/.test(id)) bad.push(`${at}: "${id}" is a name the canvas uses itself; choose another`);
    if (series.cast?.[id] || series.places?.[id]) bad.push(`${at}: "${id}" already names someone in the cast or a place`);
    if (!isObject(x)) { bad.push(`${at}: must be an object`); continue; }
    if (!text(x.prompt) && !text(x.file)) bad.push(`${at}: say what is heard ("prompt"), or name a recording of your own ("file")`);
    if (text(x.file) && dir && !exists(path.resolve(dir, x.file))) bad.push(`${at}.file: ${x.file} is not there`);
    if (x.seconds !== undefined && !(typeof x.seconds === 'number' && x.seconds > 0 && x.seconds <= 30)) bad.push(`${at}.seconds: how long the sound lasts, up to 30`);
  }
  if (series.models !== undefined && !isObject(series.models)) bad.push('models: must be an object like { "clip": "veo-3.1-fast" }');
  if (series.episodes !== undefined && !Array.isArray(series.episodes)) bad.push('episodes: must be a list');
  else (series.episodes || []).forEach((e, i) => { if (!isObject(e) || !text(e.title)) bad.push(`episodes[${i}]: every episode planned needs a title`); });
  if (series.seconds !== undefined && !(typeof series.seconds === 'number' && series.seconds >= 5 && series.seconds <= 600)) bad.push('seconds: how long an episode runs, between 5 and 600');
  if (series.budget !== undefined && !(typeof series.budget === 'number' && series.budget >= 0)) bad.push('budget: what a run may spend, a number of dollars');
  if (series.retakes !== undefined && !(Number.isInteger(series.retakes) && series.retakes >= 0 && series.retakes <= 3)) bad.push('retakes: how many more takes a run may ask for by itself when a take cannot be used, 0 to 3');
  return bad;
}
export function checkEpisode(series, episode) {
  const bad = [], cast = series.cast || {}, places = series.places || {}, seen = new Set();
  if (!isObject(episode)) return ['the script must be an object'];
  if (!Array.isArray(episode.scenes) || !episode.scenes.length) return ['scenes: an episode needs at least one scene'];
  if (episode.models !== undefined && !isObject(episode.models)) bad.push('models: must be an object like { "clip": "veo-3.1-lite", "talk": "veo-3.1-fast" }');
  episode.scenes.forEach((scene, s) => {
    const at = `scenes[${s}]`;
    if (!isObject(scene)) return bad.push(`${at}: must be an object`);
    if (!places[scene.where]) bad.push(`${at}.where: "${scene.where}" is not one of the places (${Object.keys(places).join(', ')})`);
    if (!text(scene.staging)) bad.push(`${at}.staging: say where everyone is and what the room looks like at this moment, in one or two sentences`);
    if (!Array.isArray(scene.shots) || !scene.shots.length) return bad.push(`${at}.shots: a scene needs at least one shot`);
    scene.shots.forEach((shot, k) => {
      const here = `${at}.shots[${k}]`;
      if (!isObject(shot)) return bad.push(`${here}: must be an object`);
      if (!text(shot.id) || !NAME.test('s' + shot.id)) bad.push(`${here}.id: every shot needs a short name of its own, like "7" or "7b"`);
      else if (seen.has(shot.id)) bad.push(`${here}.id: "${shot.id}" names two shots`); else seen.add(shot.id);
      if (!SIZES[shot.size]) bad.push(`${here}.size: "${shot.size}" is not one of ${Object.keys(SIZES).join(', ')}`);
      if (!text(shot.action)) bad.push(`${here}.action: say what is seen happening`);
      const who = shot.who ?? [];
      if (!Array.isArray(who)) bad.push(`${here}.who: must be a list of the cast seen in the frame`);
      else for (const w of who) if (!cast[w]) bad.push(`${here}.who: "${w}" is not in the cast (${Object.keys(cast).join(', ')})`);
      if (shot.seconds !== undefined && !(typeof shot.seconds === 'number' && shot.seconds >= 1 && shot.seconds <= 15)) bad.push(`${here}.seconds: between 1 and 15`);
      if (shot.continues && k === 0) bad.push(`${here}.continues: the first shot of a scene has nothing to continue from`);
      if (shot.hear !== undefined) { const sounds = series.sounds || {};
        if (!Array.isArray(shot.hear)) bad.push(`${here}.hear: a list like [{ "sound": "knock", "at": 1.5 }]`);
        else shot.hear.forEach((h, i) => { if (!isObject(h) || !sounds[h.sound]) bad.push(`${here}.hear[${i}]: "${h?.sound}" is not one of the sounds of the series (${Object.keys(sounds).join(', ') || 'it has none'})`);
          else if (h.at !== undefined && !(typeof h.at === 'number' && h.at >= 0 && h.at <= 15)) bad.push(`${here}.hear[${i}].at: the second of the shot at which it is heard`);
          else if (h.to !== undefined && !(typeof h.to === 'number' && h.to > 0)) bad.push(`${here}.hear[${i}].to: how many seconds of the sound are heard, from its beginning`); }); }
      if (shot.line !== undefined) {
        const l = shot.line;
        if (!isObject(l) || !text(l.text)) return bad.push(`${here}.line: must be { "who": …, "text": … }`);
        if (!cast[l.who]) bad.push(`${here}.line.who: "${l.who}" is not in the cast (${Object.keys(cast).join(', ')})`);
        const takes = speechSeconds(l.text, series.language);
        if (takes > 11) bad.push(`${here}.line: about ${Math.round(takes)} seconds of speech is too long for one shot; give the rest to another shot (cut to who is listening, or to another angle)`);
      }
    });
  });
  return bad;
}
