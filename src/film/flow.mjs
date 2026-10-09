// flow.json — a film as a canvas of nodes. A node is a note, a person, a place, a picture, a spoken line, a clip, a piece of music,
// a sound or a cut, and says what it is made from: its words, the model to ask, and the other nodes it works from. Any node can work from
// any other: write "@name" in a prompt and a note's words are put in its place, a person or a place is described, and a picture,
// clip or recording is handed to the model as a reference ("image 2"); a clip names its first frame, its last, and the recording
// its actor performs to. Nothing here knows what an episode or a shot is — that is one way of filling the canvas (director.mjs),
// and a person or an agent may add, rewire or replace any node by hand.
//
// Every result is a take, kept under a key made from everything it was made from. So asking again costs nothing, and changing one
// thing — a line, a face, a model — leaves exactly the nodes that work from it to be made again. Earlier takes are kept; any of
// them can be chosen (pick), and a chosen take can be held whatever changes around it (lock).
//
// A run looks at every take it makes (review.mjs). A take that cannot be used — nobody says the line, the recording is not the
// line — is asked for again by the run itself, as often as `retakes` allows; one that is merely odd is used and pointed at.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cut } from './cut.mjs';
import * as MODELS from './models.mjs';
import { costOf, nameOf, secondsOf } from './models.mjs';
import { grave, inWords, reviewClip, reviewFit, reviewPicture, reviewSound, reviewVoice } from './review.mjs';
import { ASPECT, LEAD, TAIL, lengthOf, speechSeconds } from './series.mjs';
import { layLine, speechSpans, spokenPart } from './speech.mjs';
import { FORMATS } from '../spec.mjs';
import { exists, mkdir, run, sha, tools } from '../util.mjs';

export const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MENTION = /@(@|[a-z0-9]+(?:-[a-z0-9]+)*)/g;
// what a node of each kind must say, what it may say, and the file its takes are (none: it is words, not a result)
export const KINDS = {
  text: { must: ['text'], may: [] },
  person: { must: ['name'], may: ['look', 'wardrobe', 'manner', 'voice'] },
  place: { must: ['name'], may: ['look'] },
  picture: { one: ['prompt', 'file', 'grab'], may: ['model', 'aspect', 'refs', 'at', 'options'], ext: 'jpg' },
  voice: { one: ['text', 'file'], may: ['who', 'how', 'voice', 'model', 'style', 'speed', 'fit', 'options'], ext: 'wav' },
  clip: { one: ['prompt', 'file'], may: ['frame', 'end', 'voice', 'heard', 'ownVoice', 'refs', 'model', 'seconds', 'sound', 'sounds', 'resolution', 'options'], ext: 'mp4' },
  music: { one: ['prompt', 'file'], may: ['model', 'options'], ext: 'mp3' },
  // a sound made from words (a knock, a door, rain) or a recording of your own; a clip says at which second it is heard ("sounds")
  sound: { one: ['prompt', 'file'], may: ['model', 'seconds', 'options'], ext: 'wav' },
  cut: { must: ['shots'], may: ['music', 'title', 'notice', 'subtitles', 'musicVolume'], ext: 'mp4' },
};
const ANY = ['kind', 'label', 'group', 'note', 'by', 'as', 'of', 'xy'];      // what every node may carry (by, as, of: the director's marks; xy: where it sits on the canvas)
const WORD = { picture: 'image', clip: 'video', voice: 'audio', music: 'audio', sound: 'audio' };
const SLOTS = { picture: ['grab'], clip: ['frame', 'end', 'voice'], voice: ['fit'], cut: ['music'] };      // the fields in which a node names another it is made from
// a line recorded to the lips of a clip ("fit") is made after that clip, not before it
const fitted = (flow, clip) => { const v = flow.nodes[idOf(flow.nodes[clip]?.voice)]; return !!v && idOf(v.fit) === clip; };
const made = (node) => !!KINDS[node?.kind]?.ext;
// what a maker says when it will not be paid: its credit is used up, its spending cap is reached, the account is locked. Asking
// again changes nothing, and neither does asking it for the next piece.
const NO_MONEY = /answered 402|prepay|credits? (?:are|is|have been) (?:depleted|exhausted|used up)|insufficient (?:funds|balance|credits?)|locked|TOP_UP|spending cap|spend cap|billing|not enabled/i;
const DOOR = { google: "Google's API", fal: 'fal.ai' };
const NEAR = Math.log(1.12);      // a recording within this of the place it goes (about a tenth, either way) is stretched to it unheard
const ONE_WORD = .4;              // a phrase shorter than this many seconds is a single word
export const idOf = (ref) => String(ref || '').replace(/^@/, '');
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const shotOf = (s) => (typeof s === 'string' ? { clip: s } : s || {});
// the sounds a clip is heard with: [{ sound: "@knock", at (the second of the clip, 0 when left out), volume, to (only its first seconds) }]
const soundsOf = (n) => list(n?.sounds).map((s) => (typeof s === 'string' ? { sound: s } : s || {}));

// ---- the file ----
export const flowFile = (dir) => path.join(dir, 'flow.json');
export function readFlow(dir) {
  if (!exists(flowFile(dir))) return { nodes: {} };
  let flow; try { flow = JSON.parse(fs.readFileSync(flowFile(dir), 'utf8')); } catch (e) { throw new Error('flow.json is not valid JSON: ' + e.message); }
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) throw new Error('flow.json must be an object');
  flow.nodes ||= {}; return flow;
}
export function writeFlow(dir, flow) { mkdir(dir); fs.writeFileSync(flowFile(dir), JSON.stringify(flow, null, 1) + '\n'); return flowFile(dir); }

// ---- what a node works from ----
// the nodes a text mentions, notes followed through to what they mention in turn
function mentioned(flow, text, into = [], depth = 0) {
  for (const m of String(text || '').matchAll(MENTION)) {
    const id = m[1], n = flow.nodes[id];
    if (!n || id === '@') continue;
    if (n.kind === 'text') { if (depth < 6) mentioned(flow, n.text, into, depth + 1); } else if (!into.includes(id)) into.push(id);
  }
  return into;
}
// every node whose result this one is made from
export function needs(flow, id) {
  const n = flow.nodes[id], out = new Set();
  if (!n || n.file) return [];
  const add = (ref) => { const x = idOf(ref); if (flow.nodes[x] && made(flow.nodes[x])) out.add(x); };
  for (const x of mentioned(flow, n.prompt)) add(x);
  for (const slot of SLOTS[n.kind] || []) if (n[slot] && !(slot === 'voice' && fitted(flow, id))) add(n[slot]);
  for (const r of list(n.refs)) add(r);
  if (n.kind === 'cut') for (const s of list(n.shots)) { const c = idOf(shotOf(s).clip); add(c); if (flow.nodes[c]?.voice) add(flow.nodes[c].voice); for (const x of soundsOf(flow.nodes[c])) add(x.sound); }      // (a clip is filmed without its line laid over and without its sounds: the cut puts them in)
  out.delete(id); return [...out];
}
// the nodes in an order in which each comes after what it works from; a node that works from itself (through others) is named
export function ordered(flow, ids = Object.keys(flow.nodes)) {
  const out = [], state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') throw new Error(`${[...trail.slice(trail.indexOf(id)), id].join(' → ')}: these nodes work from each other in a circle`);
    state.set(id, 'open'); for (const d of needs(flow, id)) visit(d, [...trail, id]); state.set(id, 'done'); out.push(id);
  };
  for (const id of ids) if (flow.nodes[id]) visit(id, []);
  return out;
}

// ---- what is wrong with it ----
export function checkFlow(flow, dir = null) {
  const bad = [], nodes = flow.nodes || {}, is = (ref, ...kinds) => kinds.includes(nodes[idOf(ref)]?.kind);
  if (flow.format !== undefined && !FORMATS[flow.format]) bad.push(`format: "${flow.format}" is not one of ${Object.keys(FORMATS).join(', ')}`);
  if (flow.budget !== undefined && !(typeof flow.budget === 'number' && flow.budget >= 0)) bad.push('budget: what a run may spend, a number of dollars');
  if (flow.retakes !== undefined && !(Number.isInteger(flow.retakes) && flow.retakes >= 0 && flow.retakes <= 3)) bad.push('retakes: how many more takes a run may ask for by itself when a take cannot be used, 0 to 3');
  for (const [id, n] of Object.entries(nodes)) {
    if (!ID.test(id) || id.length > 48) bad.push(`${id}: a node's name is lower-case letters, digits and dashes (like "lan-sheet" or "e1-s3")`);
    const shape = KINDS[n?.kind];
    if (!shape) { bad.push(`${id}: its kind "${n?.kind}" is not one of ${Object.keys(KINDS).join(', ')}`); continue; }
    for (const f of shape.must || []) if (n[f] === undefined || n[f] === '') bad.push(`${id}: a ${n.kind} needs "${f}"`);
    if (shape.one && !shape.one.some((f) => n[f] !== undefined && n[f] !== '')) bad.push(`${id}: a ${n.kind} needs ${shape.one.map((f) => `"${f}"`).join(' or ')}`);
    for (const f of Object.keys(n)) if (![...ANY, ...(shape.must || []), ...(shape.one || []), ...shape.may].includes(f)) bad.push(`${id}: a ${n.kind} has no "${f}"`);
    if (n.file && dir && !exists(path.resolve(dir, n.file))) bad.push(`${id}: the file ${n.file} is not there`);
    for (const m of String(n.prompt || n.text || '').matchAll(MENTION)) if (m[1] !== '@' && !nodes[m[1]]) bad.push(`${id}: it mentions @${m[1]}, and there is no such node (write @@ for a plain @)`);
    for (const x of mentioned(flow, n.kind === 'text' ? '' : n.prompt)) if (n.kind === 'picture' && !is(x, 'picture', 'person', 'place')) bad.push(`${id}: a picture can only be made from pictures, and @${x} is a ${nodes[x].kind}`);
    const slot = (f, ...kinds) => { if (n[f] !== undefined && !is(n[f], ...kinds)) bad.push(`${id}.${f}: must name a ${kinds.join(' or ')} node, like "@${kinds[0] === 'picture' ? 'lan-face' : 'e1-s1'}"`); };
    slot('frame', 'picture'); slot('end', 'picture'); slot('grab', 'clip'); if (n.kind === 'clip') slot('voice', 'voice'); if (n.kind === 'voice') { slot('who', 'person'); slot('fit', 'clip'); if (n.fit && idOf(nodes[idOf(n.fit)]?.voice) !== id) bad.push(`${id}.fit: ${n.fit} does not have this line as its "voice"`); } if (n.kind === 'cut') slot('music', 'music');
    for (const r of list(n.refs)) if (!is(r, 'picture')) bad.push(`${id}.refs: "${r}" is not a picture node`);
    if (n.sounds !== undefined) { if (!Array.isArray(n.sounds)) bad.push(`${id}.sounds: a list like [{ "sound": "@knock", "at": 1.5 }]`);
      else soundsOf(n).forEach((x, i) => { if (!is(x.sound, 'sound')) bad.push(`${id}.sounds[${i}]: "${x.sound}" is not a sound node`); if (x.at !== undefined && !(typeof x.at === 'number' && x.at >= 0)) bad.push(`${id}.sounds[${i}].at: the second of the clip at which it is heard`);
        if (x.volume !== undefined && !(typeof x.volume === 'number' && x.volume > 0 && x.volume <= 4)) bad.push(`${id}.sounds[${i}].volume: how loud, where 1 is as loud as sounds are set by themselves (up to 4)`);
        if (x.to !== undefined && !(typeof x.to === 'number' && x.to > 0)) bad.push(`${id}.sounds[${i}].to: how many seconds of the sound are heard, from its beginning`); }); }
    if (n.kind === 'cut') { if (!Array.isArray(n.shots) || !n.shots.length) bad.push(`${id}: a cut needs its shots, in order`);
      else n.shots.forEach((s, i) => { const c = shotOf(s); if (!is(c.clip, 'clip')) bad.push(`${id}.shots[${i}]: "${c.clip}" is not a clip node`); if (c.from !== undefined && c.to !== undefined && !(c.to > c.from)) bad.push(`${id}.shots[${i}]: "to" must come after "from"`); }); }
    if (n.seconds !== undefined && !(typeof n.seconds === 'number' && n.seconds > 0 && n.seconds <= 60)) bad.push(`${id}.seconds: a number of seconds`);
  }
  if (!bad.length) try { ordered(flow); } catch (e) { bad.push(e.message); }
  return bad;
}

// ---- words ----
// A prompt as the model reads it: notes put in, people and places described (in full the first time), and every picture, clip or
// recording it mentions numbered in the order of mention — those are returned in `files`, to be handed over in that order.
export function wordsOf(flow, text, got, state = { files: [], count: {}, at: new Map(), named: new Set() }, depth = 0) {
  const words = String(text || '').replace(MENTION, (all, id) => {
    if (id === '@') return '@';
    const n = flow.nodes[id]; if (!n) return all;
    if (n.kind === 'text') return depth < 6 ? wordsOf(flow, n.text, got, state, depth + 1).words : '';
    if (n.kind === 'person' || n.kind === 'place') {
      const more = [n.look, n.kind === 'person' && n.wardrobe ? 'wearing ' + n.wardrobe : null].filter(Boolean).join('; '), first = !state.named.has(id); state.named.add(id);
      return first && more ? `${n.name} (${more})` : n.name;
    }
    if (!state.at.has(id)) { const w = WORD[n.kind] || 'file'; state.count[w] = (state.count[w] || 0) + 1; state.at.set(id, `${w} ${state.count[w]}`); state.files.push({ id, kind: n.kind, ...got(id) }); }
    return state.at.get(id);
  });
  return { words, files: state.files };
}

// ---- takes ----
// .songbe/flow/takes.json: { takes: { key: [{ n, file, at, by, took, info, review, bad }] }, picks: { node: { key, n, chosen } }, locks: { node: true } }
// `review` is what looking at the take found; `bad` marks a take the run that made it could not use. A bad take stands for its
// node only when a person chose it (`chosen`).
const storeDir = (dir) => path.join(dir, '.songbe', 'flow');
export function openStore(dir) {
  const file = path.join(storeDir(dir), 'takes.json');
  let s = { takes: {}, picks: {}, locks: {} };
  if (exists(file)) try { s = { ...s, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  const abs = (t) => (t ? { ...t, file: path.join(storeDir(dir), t.file) } : null), there = (t) => t && exists(path.join(storeDir(dir), t.file));
  return {
    save() { mkdir(storeDir(dir)); fs.writeFileSync(file, JSON.stringify(s, null, 1)); },
    all: (key) => (s.takes[key] || []).filter(there).map(abs),
    // the take in use for a node asked for as `key`: the chosen one, else the latest — of those that can be used
    current(id, key) { const p = s.picks[id], mine = (s.takes[key] || []).filter(there).filter((t) => !t.bad || (!!p?.chosen && p.key === key && p.n === t.n)); return abs((p && p.key === key && mine.find((t) => t.n === p.n)) || mine.at(-1) || null); },
    // the takes a run made for `key` and could not use
    refused: (key) => (s.takes[key] || []).filter(there).filter((t) => t.bad).map(abs),
    // a take held whatever is asked for now
    held(id) { const p = s.picks[id]; if (!s.locks[id] || !p) return null; const t = (s.takes[p.key] || []).find((x) => x.n === p.n); return there(t) ? { ...abs(t), key: p.key } : null; },
    next(key, ext) { const n = ((s.takes[key] || []).at(-1)?.n || 0) + 1; mkdir(path.join(storeDir(dir), 'takes')); return { n, name: `takes/${key}-${n}.${ext}`, file: path.join(storeDir(dir), 'takes', `${key}-${n}.${ext}`) }; },
    add(id, key, take) { (s.takes[key] ||= []).push(take); s.picks[id] = { key, n: take.n }; this.save(); return abs(take); },
    stand(id, key, n) { s.picks[id] = { key, n }; this.save(); },      // the take a run settled on, of several it made
    // Something learnt about a take afterwards. It is written into the file as the file is now, so that what another process
    // chose in the meantime is kept (takes are looked at in a process of their own while the canvas is open).
    note(key, n, more) { const mine = (s.takes[key] || []).find((x) => x.n === n); if (!mine) return; Object.assign(mine, more);
      let now = s; if (exists(file)) try { now = { takes: {}, picks: {}, locks: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
      const theirs = (now.takes[key] || []).find((x) => x.n === n); if (theirs) Object.assign(theirs, more); mkdir(storeDir(dir)); fs.writeFileSync(file, JSON.stringify(now, null, 1)); },
    back(id, was) { if (was) s.picks[id] = was; else delete s.picks[id]; this.save(); },      // a node's choice as it was before a run that came to nothing
    // a person's choice: it stands even when the run that made it could not use it
    pick(id, key, n) { if (!(s.takes[key] || []).some((t) => t.n === n)) throw new Error(`${id} has no take ${n}`); s.picks[id] = { key, n, chosen: true }; this.save(); },
    // hold the take a node stands on now (named by its key and number), or let the node follow what it is made from again
    // (`why`: who holds it, when it is not the person — so that only they let go of it again)
    hold(id, key, n, why = true) { this.pick(id, key, n); s.locks[id] = why; this.save(); }, release(id) { delete s.locks[id]; this.save(); }, locked: (id) => !!s.locks[id], heldFor: (id) => s.locks[id] || null, picked: (id) => s.picks[id] || null,
  };
}
const own = (dir, node) => { const file = path.resolve(dir, node.file); if (!exists(file)) throw new Error(`the file ${node.file} is not there`); return { file, take: 'own-' + crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16), info: {} }; };

// ---- how each kind is made ----
// Each returns { recipe: everything the result depends on, by: the model, info: what later steps need to know, make(file, { seed }),
// review(file, found): what is wrong with a take of it (found: what making it learnt, kept in the take's info) }.
const ff = (...args) => run(tools.ffmpeg, ['-v', 'error', '-y', ...args]);
const take = (x) => x?.take;
// the references a node lists in "refs" beyond those its prompt mentions
const more = (c, n, w) => list(n.refs).filter((x) => !w.files.some((f) => f.id === idOf(x))).map((x) => ({ id: idOf(x), kind: c.flow.nodes[idOf(x)].kind, ...c.got(idOf(x)) }));
function picture(c, id, n) {
  if (n.grab) {      // one frame of a clip, as the start of something else
    const clip = c.got(idOf(n.grab)), at = n.at === undefined || n.at === 'end' ? 'end' : +n.at;
    return { recipe: { kind: 'grab', clip: clip.take, at }, by: null, make: (file) => (at === 'end' ? ff('-sseof', '-0.12', '-i', clip.file, '-update', '1', '-q:v', '2', file) : ff('-ss', String(at), '-i', clip.file, '-frames:v', '1', '-q:v', '2', file)) };
  }
  const r = c.use.modelFor('picture', n.model || c.flow.models?.picture, c.env, c.strict), w = wordsOf(c.flow, n.prompt, c.got), files = [...w.files, ...more(c, n, w)];
  const aspect = n.aspect || ASPECT[c.flow.format] || ASPECT.tall;
  return { recipe: { kind: 'picture', model: r.name, prompt: w.words, refs: files.map(take), aspect, options: n.options }, by: r, units: 1, review: (file) => reviewPicture(file, { aspect }),
    make: (file, { seed }) => c.use.makePicture(r, { prompt: w.words, refs: files.map((f) => f.file), aspect, seed, options: n.options }, file, c.env) };
}
function voice(c, id, n) {
  const person = n.who ? c.flow.nodes[idOf(n.who)] : null, set = { ...(person?.voice || {}), ...Object.fromEntries(['voice', 'model', 'style', 'speed'].filter((k) => n[k] !== undefined).map((k) => [k, n[k]])) };
  const r = c.use.modelFor('voice', set.model || c.flow.models?.voice, c.env, c.strict), language = c.flow.language || null, name = set.voice || Object.keys(r.known?.voices?.female || {})[0] || undefined;
  // a model that takes direction is told who speaks and how; one that does not is given the language and the line
  const style = r.known?.directed ? [`Language: ${language || 'the language the line is written in'}${c.flow.accent ? ', ' + c.flow.accent : ''}.`, person ? `Speaker: ${person.name}${person.manner ? ', ' + person.manner : ''}.` : null, set.style ? `Voice: ${set.style}.` : null,
    `Delivery: ${n.how || 'natural'}. A line of dialogue in a film, said to someone in the same room: conversational pace, not a narrator, not an announcer.`].filter(Boolean).join('\n') : set.style || null;
  const say = (how, file) => c.use.makeVoice(r, { text: n.text, voice: name, style: how, language: language || 'auto', speed: set.speed, options: n.options }, file, c.env);
  const spoken = String(n.text).length / 1000;      // thousands of characters, which is what voices are priced by
  if (!n.fit) return { recipe: { kind: 'voice', model: r.name, voice: name, style, text: n.text, language, speed: set.speed, options: n.options }, by: r, units: spoken, make: (file) => say(style, file), review: (file) => reviewVoice(file, { text: n.text, language }) };
  // Recorded to picture, the way a line is dubbed: the clip was filmed first with the actor speaking in a voice of the model's
  // choosing; the line is now recorded in the person's own voice to last as long as the lips moved, and set exactly where they
  // moved. The result is as long as the clip.
  //
  // A recording is stretched to its place, and stretching is heard: sped up by a fifth, a whispered line is no longer made out
  // (measured: a transcriber that understood the model's own voice word for word got half of ours). So the line is asked for
  // again — a recording costs next to nothing — until every phrase is within about a tenth of the place it goes, phrase by
  // phrase when the voice pauses where the lips paused; only what is left after four tries is stretched further.
  const clip = c.got(idOf(n.fit)), spoke = spokenPart(clip.info?.spoke || [], speechSeconds(n.text, language)), target = +spoke.reduce((t, [a, b]) => t + b - a, 0).toFixed(2);
  return { recipe: { kind: 'voice', model: r.name, voice: name, style, text: n.text, language, speed: set.speed, options: n.options, fit: { clip: clip.take, spoke } }, by: r, units: spoken * 2,
    make: async (file) => {
      if (!spoke.length) { await say(style, file); return { fit: false }; }      // nobody was heard speaking in the clip: the line is recorded as it is and laid over
      const place = spoke.map(([a, b]) => b - a), NTH = ['first', 'second', 'third', 'fourth', 'fifth'], within = (x, i) => Math.min(place[i] * 2, Math.max(place[i] * .5, x));
      let best = null, ask = [...place];
      for (let tries = 1; tries <= 4; tries++) {
        // first as the line comes naturally (a voice told to hurry speaks less clearly); only when that does not fit is it told how long to take
        const tmp = `${file}.${tries}.wav`, pace = place.length > 1 && place.length <= 5 ? `Pace: in ${place.length} phrases with a clear pause between them. ${ask.map((x, i) => `The ${NTH[i]} phrase takes about ${x.toFixed(1)} seconds to say`).join('; ')}.`
          : `Pace: in one breath, with no pause inside the line. From the first word to the last, the line lasts about ${ask.reduce((t, x) => t + x, 0).toFixed(1)} seconds.`;
        await say(r.known?.directed && tries > 1 ? `${style}\n${pace}` : style, tmp);
        const said = speechSpans(tmp), each = said.map(([a, b]) => b - a), lasts = each.reduce((t, x) => t + x, 0), alike = each.length === place.length && place.length <= 5;
        // how far the recording is from its place: by its worst phrase when it pauses where the lips paused (a phrase of one
        // syllable aside: no voice can be told how long to take over a single word, and stretched it sounds no different);
        // as a whole otherwise — and then a pause of its own may fall where the lips moved, which counts against it
        const long = place.map((x, i) => i).filter((i) => place[i] >= ONE_WORD), far = (i) => Math.abs(Math.log(each[i] / place[i]));
        const off = !lasts ? Infinity : alike ? Math.max(...(long.length ? long : place.map((x, i) => i)).map(far)) : Math.abs(Math.log(lasts / target)) + .25;
        if (!best || off < best.off) { if (best) fs.rmSync(best.tmp, { force: true }); best = { tmp, said, lasts, off, tries }; } else fs.rmSync(tmp, { force: true });
        if (off <= NEAR) break;
        ask = alike ? ask.map((x, i) => within(x * place[i] / each[i], i)) : ask.map((x, i) => within(x * target / (lasts || target), i));      // too slow: ask for less time; too quick: for more
      }
      const lay = layLine(spoke, best.said), total = secondsOf(clip.file);
      try { ff(...lay.flatMap((l) => ['-ss', String(l.from), '-t', String(+(l.to - l.from).toFixed(3)), '-i', best.tmp]), '-filter_complex',
        lay.map((l, i) => `[${i}:a]atempo=${l.tempo}${l.at > 0 ? `,adelay=${Math.round(l.at * 1000)}:all=1` : ''}[p${i}]`).join(';') + `;${lay.map((_, i) => `[p${i}]`).join('')}amix=inputs=${lay.length}:normalize=0,apad=whole_dur=${total}[o]`, '-map', '[o]', '-t', String(total), '-ar', '48000', '-ac', '1', file); }
      finally { fs.rmSync(best.tmp, { force: true }); }
      return { fit: true, lay, takes: best.tries };
    }, review: (file, found) => reviewFit(found) };
}
async function clip(c, id, n) {
  const line = n.voice ? c.flow.nodes[idOf(n.voice)] : null, seen = !!line && !n.heard, r = c.use.modelFor(seen ? 'talk' : 'clip', n.model || c.flow.models?.[seen ? 'talk' : 'clip'], c.env, c.strict);
  const frame = n.frame ? c.got(idOf(n.frame)) : null, end = n.end ? c.got(idOf(n.end)) : null, w = wordsOf(c.flow, n.prompt, c.got);
  const refs = [...w.files, ...more(c, n, w)];
  const can = await c.use.clipAbilities(r, { frame: !!frame, refs });
  // someone seen speaking: the model acts to our recording when it can; when it can only speak the line itself it does, and the
  // cut puts the person's own recorded voice where the model spoke (unless the node keeps the model's voice: ownVoice). A voice
  // that is only heard is laid over a clip in which nobody speaks.
  const dubbed = !!line && idOf(line.fit) === id;      // its line is recorded to its lips afterwards: the model has to speak the line itself
  if (dubbed && (!seen || !can.speaks)) throw new Error(seen ? `${r.name} does not speak a line by itself, so the line cannot be recorded to its lips: take "fit" off ${n.voice}, and the model acts to the recording instead` : `${n.voice} is recorded to the lips of ${id}, where the speaker is only heard: take "fit" off it`);
  const how = !line ? 'plain' : !seen ? 'over' : dubbed ? 'native' : can.acts ? 'voice' : can.speaks ? 'native' : 'over';
  const rec = line && !dubbed ? c.got(idOf(n.voice)) : null, said = rec ? secondsOf(rec.file) : null;
  const length = how === 'native' ? n.seconds || +(LEAD + (said ?? speechSeconds(line.text, c.flow.language)) * 1.15 + TAIL + .4).toFixed(1) : lengthOf(n, said), seconds = MODELS.fitSeconds(can, length);
  if (rec && seconds < (how === 'native' ? said + .5 : length - .05)) throw new Error(`the line runs ${said.toFixed(1)} s and ${r.name} makes at most ${seconds} s: shorten the line, or give part of it to another shot`);
  if (end && !can.end) throw new Error(`${r.name} does not take a last frame`);
  const who = (line?.who && c.flow.nodes[idOf(line.who)]?.name) || 'The speaker', manner = line?.how ? ` (${line.how})` : '';
  const speech = how === 'voice' ? ` ${who} speaks${manner}, saying: "${line.text}" The lips move with the words. Nobody else speaks.`
    : how === 'native' ? ` ${who} says in ${c.flow.language || 'the language of the line'}${manner}: "${line.text}" Nobody else speaks.` : ' Nobody in the frame speaks; lips stay closed.';
  const prompt = `${w.words.trim()}${speech} No subtitles, no captions, no text on screen. No music.`, aspect = ASPECT[c.flow.format] || ASPECT.tall, resolution = n.resolution || c.flow.resolution || '720p';
  return { recipe: { kind: 'clip', model: r.name, how, prompt, frame: take(frame), end: take(end), voice: how === 'voice' ? rec.take : undefined, refs: refs.map(take), seconds, aspect, resolution, sound: n.sound !== false, options: n.options }, by: r,
    info: { how, length: how === 'native' ? null : length, keeps: how === 'voice' && can.acts === 'keeps' }, units: seconds,
    review: (file, found) => reviewClip(file, { start: frame?.file || null, how, spoke: found?.spoke || null, text: line?.text || null, language: c.flow.language, asked: seconds }),
    make: async (file, { seed }) => {
      const track = how === 'voice' ? file + '.talk.wav' : null;      // the recording as the actor hears it: a breath of silence, the line, then silence to the end of the clip
      if (track) ff('-f', 'lavfi', '-t', String(LEAD), '-i', 'anullsrc=r=48000:cl=mono', '-i', rec.file, '-filter_complex', `[0][1]concat=n=2:v=0:a=1,apad=whole_dur=${Math.max(2, seconds)}`, '-ar', '48000', '-ac', '1', track);
      try { await c.use.makeClip(r, { prompt, frame: frame?.file, end: end?.file, voice: track, refs: refs.map((f) => ({ file: f.file, kind: f.kind })), seconds, aspect, resolution, sound: n.sound !== false, seed, options: n.options }, file, c.env); }
      finally { if (track) fs.rmSync(track, { force: true }); }
      if (how === 'native') return { spoke: speechSpans(file) };      // where the model spoke, for the cut
      // a model that keeps the recording it acts to, and came back without it: the cut lays the recording in
      return how === 'voice' && can.acts === 'keeps' && !(MODELS.hasSound(file) && speechSpans(file).length) ? { lost: true } : null;
    } };
}
function music(c, id, n) {
  const r = c.use.modelFor('music', n.model || c.flow.models?.music, c.env, c.strict), w = wordsOf(c.flow, n.prompt, () => ({}));
  return { recipe: { kind: 'music', model: r.name, prompt: w.words, options: n.options }, by: r, units: 1, make: (file, { seed }) => c.use.makeMusic(r, { prompt: w.words, seed, options: n.options }, file, c.env) };
}
function sound(c, id, n) {
  const r = c.use.modelFor('sound', n.model || c.flow.models?.sound, c.env, c.strict), w = wordsOf(c.flow, n.prompt, () => ({})), seconds = n.seconds || 3;
  return { recipe: { kind: 'sound', model: r.name, prompt: w.words, seconds, options: n.options }, by: r, units: seconds, review: (file) => reviewSound(file),
    make: (file, { seed }) => c.use.makeSound(r, { prompt: w.words, seconds, seed, options: n.options }, file, c.env) };
}
function cutting(c, id, n) {
  const parts = list(n.shots).map((s) => { const x = shotOf(s), cid = idOf(x.clip), cn = c.flow.nodes[cid], got = c.got(cid), line = cn.voice ? c.flow.nodes[idOf(cn.voice)] : null, rec = line ? c.got(idOf(cn.voice)) : null;
    const sounds = soundsOf(cn).map((s) => { const g = c.got(idOf(s.sound)); return { id: idOf(s.sound), file: g.file, take: g.take, at: s.at ?? 0, volume: s.volume ?? 1, ...(s.to ? { to: s.to } : {}) }; });
    return { id: cid, file: got.file, take: got.take, info: got.info || {}, from: x.from, to: x.to, text: line?.text || null, who: (line?.who && c.flow.nodes[idOf(line.who)]?.name) || null, rec, ownVoice: !!cn.ownVoice, lay: rec?.info?.fit ? rec.info.lay : null, sounds }; });
  const bed = n.music ? c.got(idOf(n.music)) : null, size = FORMATS[c.flow.format] || FORMATS.tall;
  const settings = { title: n.title || null, notice: n.notice ?? null, subtitles: n.subtitles !== false, musicVolume: n.musicVolume ?? .22, size };
  return { recipe: { kind: 'cut', parts: parts.map((p) => ({ clip: p.take, voice: take(p.rec), from: p.from, to: p.to, text: p.text, info: p.info, ownVoice: p.ownVoice, lay: p.lay, ...(p.sounds.length ? { sounds: p.sounds.map(({ take: t, at, volume, to }) => ({ take: t, at, volume, ...(to ? { to } : {}) })) } : {}) })), music: take(bed), ...settings }, by: null,
    make: (file) => cut(file, { parts: parts.map((p) => ({ ...p, voice: p.rec?.file || null })), music: bed?.file || null, ...settings }) };
}
const PLAN = { picture, voice, clip, music, sound, cut: cutting };

// ---- the run ----
const seedOf = (key, n) => (parseInt(key.slice(0, 7), 16) + n * 7919) % 2147483647;
// what looking at a take finds wrong with it; nothing at all when its kind is not looked at, or it cannot be (no conclusion is drawn from that)
const looked = (p, file, info) => { if (!p.review) return undefined; try { return p.review(file, info || {}) || []; } catch { return undefined; } };
// What stands for each node now, without making anything: [{ id, kind, state, file, take, by, why }] where state is
//   words (nothing to make) · own (a file of yours) · ready · held (a chosen take kept although what it is made from changed)
//   make (to be made: `first` when it has no take at all, `refused` when a run made takes it could not use)
//   wait (needs something not made yet) · stuck (cannot be planned: `why`)
// A take that was looked at and found odd carries `review`. With `review` set, the takes that were never looked at are looked at
// now ('all': every take, afresh) and what is found is kept with them; no model is asked for that.
export async function look(dir, flow, { env = process.env, use = MODELS, review = false } = {}) {
  const store = openStore(dir), out = new Map(), rows = [];
  for (const id of ordered(flow)) {
    const n = flow.nodes[id];
    if (!made(n)) { rows.push({ id, kind: n.kind, state: 'words' }); continue; }
    try {
      if (n.file) { const o = own(dir, n); out.set(id, o); rows.push({ id, kind: n.kind, state: 'own', ...o }); continue; }
      const held = store.held(id);
      if (held) { out.set(id, { file: held.file, take: `${held.key}-${held.n}`, info: held.info }); rows.push({ id, kind: n.kind, state: 'held', file: held.file, take: `${held.key}-${held.n}`, key: held.key, by: held.by, n: held.n, ...(held.review ? { looked: true } : {}), ...(held.review?.length ? { review: held.review } : {}) }); continue; }
      const missing = needs(flow, id).filter((d) => !out.has(d));
      if (missing.length) { rows.push({ id, kind: n.kind, state: 'wait', why: 'needs ' + missing.join(', ') }); continue; }
      const p = await PLAN[n.kind]({ flow, env, use, strict: false, got: (x) => out.get(x) }, id, n), key = sha(p.recipe), t = store.current(id, key);
      const asked = p.recipe.prompt ? { recipe: { model: p.recipe.model, prompt: p.recipe.prompt, refs: p.recipe.refs, how: p.recipe.how, seconds: p.recipe.seconds } } : {};      // what the model is told, for whoever wants to read it
      if (t) {
        let found = t.review;
        if (review && (found === undefined || review === 'all')) { const now = looked(p, t.file, t.info); if (now) { found = now; store.note(key, t.n, { review: now }); } }
        out.set(id, { file: t.file, take: `${key}-${t.n}`, info: t.info }); rows.push({ id, kind: n.kind, state: 'ready', file: t.file, take: `${key}-${t.n}`, key, by: t.by, n: t.n, takes: store.all(key).length, ...(found ? { looked: true } : {}), ...(found?.length ? { review: found } : {}), ...asked });
      } else { const refused = store.refused(key).map((x) => ({ n: x.n, why: inWords(grave(x.review)) }));
        rows.push({ id, kind: n.kind, state: 'make', key, by: p.by ? nameOf(p.by) : null, first: !store.picked(id), ...(refused.length ? { refused } : {}), ...asked, ...(p.by ? { model: p.by.name, units: p.units, usd: costOf(p.by, p.units) } : {}) }); }
    } catch (e) { rows.push({ id, kind: n.kind, state: 'stuck', why: e.message }); }
  }
  return rows;
}

// Makes what is missing or out of date among `want` (node names; everything when left out) and whatever those work from.
// `again` names nodes to make another take of even though one stands. Up to `limit` models are asked at once; a node that fails
// is reported and everything that does not need it still gets made. `on` hears { type: 'start' | 'done' | 'failed' | 'ready' | 'own' | 'again' | 'wait' | 'note', id, … }.
// (`use` stands in for the models in tests.)
// `budget` (US dollars by list price) is the most this run may ask models for: once the next piece would go over it, that piece
// and whatever needs it are held back and said to be.
// Every take is looked at as soon as it is made. One that cannot be used is asked for again, up to `retakes` more times (one,
// unless the canvas or the caller says otherwise; each counts against the budget); the best of them stands. A node none of whose
// takes can be used is reported as not made, so nothing is built on it — its takes are kept, and a person may choose one anyway.
// A take that is only odd stands, and is listed in `flagged`. → { made, ready, failed, flagged: [{ id, review }], out, spent }
export async function runFlow(dir, flow, { want = null, again = [], limit = 4, env = process.env, use = MODELS, on = () => {}, pause = 1, budget = null, retakes = null } = {}) {
  const c0 = { pause };      // (tests shorten the waits)
  let spent = 0;
  const more = Math.max(0, Math.min(3, retakes ?? flow.retakes ?? 1)), over = (usd) => budget !== null && budget !== undefined && !!usd && spent + usd > budget + 1e-9;
  const bad = checkFlow(flow, dir); if (bad.length) throw new Error(`flow.json has ${bad.length} problem${bad.length > 1 ? 's' : ''}:\n  - ` + bad.join('\n  - '));
  const store = openStore(dir), order = ordered(flow, want || Object.keys(flow.nodes)).filter((id) => made(flow.nodes[id])), redo = new Set(again);
  const out = new Map(), failed = new Map(), busy = new Map(), result = { made: [], ready: [], failed: [], flagged: [] };
  const broke = new Map();      // a door that answered that the money has run out, and what it said: it is not asked again in this run
  const settle = async (id) => {
    const n = flow.nodes[id];
    if (n.file) { out.set(id, own(dir, n)); on({ type: 'own', id }); return; }
    const held = !redo.has(id) && store.held(id);
    if (held) { out.set(id, { file: held.file, take: `${held.key}-${held.n}`, info: held.info }); result.ready.push(id); on({ type: 'ready', id, held: true }); return; }
    // what stands is found without asking whether its model can be reached: a film made with a key that is no longer there can
    // still be looked at, cut again and added to. Only making something needs the key of the model that makes it.
    const stands = await PLAN[n.kind]({ flow, env, use, strict: false, got: (x) => out.get(x) }, id, n), had = redo.has(id) ? null : store.current(id, sha(stands.recipe));
    if (had) { out.set(id, { file: had.file, take: `${sha(stands.recipe)}-${had.n}`, info: had.info }); result.ready.push(id); on({ type: 'ready', id }); return; }
    const p = await PLAN[n.kind]({ flow, env, use, strict: true, got: (x) => out.get(x) }, id, n), key = sha(p.recipe);
    const usd = p.by ? costOf(p.by, p.units) : 0;
    if (p.by && broke.has(p.by.door)) throw new Error(`not asked: ${DOOR[p.by.door] || p.by.door} has already answered in this run that it will not be paid — ${broke.get(p.by.door)}`);
    if (over(usd)) throw new Error(`held back: it would take this run to about $${(spent + usd).toFixed(2)}, over its budget of $${(+budget).toFixed(2)} (--budget=N raises it)`);
    spent += usd || 0;
    const by = p.by ? nameOf(p.by) : 'here', was = store.picked(id);
    on({ type: 'start', id, kind: n.kind, by, usd });
    busy.set(id, (async () => {
      try {
        let best = null, last = null, tried = 0;
        for (;;) {      // a take, and another as long as it cannot be used and the run may ask again
          const slot = store.next(key, KINDS[n.kind].ext), t0 = Date.now(); let found = null;      // found: what making it learnt about the result, kept with the take
          for (let tries = 1; ; tries++) {      // a busy or unreachable provider gets a second and a third chance; a refusal does not
            try { found = await p.make(slot.file, { seed: seedOf(key, slot.n), n: slot.n }); break; }
            catch (e) { fs.rmSync(slot.file, { force: true });
              // a provider that says "too many at once" is given a good while (its limits are counted by the minute), up to five times
              const paid = !NO_MONEY.test(e.message), full = /(answered|fal) 429/.test(e.message) && paid, again = full || (paid && /could not be reached|answered 5\d\d|fal 5\d\d|timed out|fetch failed|ECONNRESET/i.test(e.message));
              if (!paid && p.by) broke.set(p.by.door, e.message.split('\n')[0].slice(0, 200));
              if (!again || tries >= (full ? 5 : 3)) throw e;
              if (full) on({ type: 'wait', id, seconds: 45 * tries, why: 'the provider asks for a pause' });
              await new Promise((r) => setTimeout(r, (full ? 45000 : 4000) * tries * (c0.pause ?? 1))); }
          }
          if (!exists(slot.file) || !fs.statSync(slot.file).size) throw new Error('nothing was written');
          const info = p.info || found ? { ...(p.info || {}), ...(found || {}) } : null, seen = looked(p, slot.file, info), review = seen || [], faults = grave(review);
          const kept = store.add(id, key, { n: slot.n, file: slot.name, at: new Date().toISOString(), by, took: +((Date.now() - t0) / 1000).toFixed(1), ...(usd ? { usd } : {}), ...(info ? { info } : {}), ...(seen ? { review } : {}), ...(faults.length ? { bad: true } : {}) });
          last = { n: slot.n, file: kept.file, info, review, faults, took: kept.took }; tried++;
          if (!best || last.faults.length < best.faults.length || (last.faults.length === best.faults.length && last.review.length <= best.review.length)) best = last;
          if (!faults.length || tried > more) break;
          if (over(usd)) { on({ type: 'note', id, text: `${id}: ${faults[0].says}; another take would go over the budget of this run` }); break; }
          spent += usd || 0; on({ type: 'again', id, kind: n.kind, by, usd, why: faults[0].says });
        }
        if (best.faults.length) { store.back(id, was);      // what stood before still stands
          throw new Error(`${tried > 1 ? `${tried} takes were made and none can be used` : 'the take that was made cannot be used'}: ${best.faults[0].says}. Choose a take to use it as it is, or run again for another.`); }
        if (best.n !== last.n) store.stand(id, key, best.n);
        out.set(id, { file: best.file, take: `${key}-${best.n}`, info: best.info }); result.made.push(id); if (best.review.length) result.flagged.push({ id, review: best.review });
        on({ type: 'done', id, kind: n.kind, by, took: best.took, file: best.file, n: best.n, ...(best.review.length ? { review: best.review } : {}) });
      } catch (e) { failed.set(id, e.message); result.failed.push({ id, error: e.message }); on({ type: 'failed', id, error: e.message }); }
      finally { busy.delete(id); }
    })());
  };
  for (;;) {
    let moved = false;
    for (const id of order) {
      if (out.has(id) || failed.has(id) || busy.has(id)) continue;
      const deps = needs(flow, id), broken = deps.find((d) => failed.has(d));
      if (broken) { failed.set(id, `needs ${broken}`); result.failed.push({ id, error: `needs ${broken}, which was not made` }); on({ type: 'failed', id, error: `needs ${broken}, which was not made`, skipped: true }); moved = true; continue; }
      if (deps.some((d) => !out.has(d)) || busy.size >= limit) continue;
      try { await settle(id); } catch (e) { failed.set(id, e.message); result.failed.push({ id, error: e.message }); on({ type: 'failed', id, error: e.message }); }
      moved = true;
    }
    if (busy.size) await Promise.race(busy.values()); else if (!moved) break;
  }
  return { ...result, out, spent: +spent.toFixed(2) };
}

// What a run would ask of which model, and about what that costs by list price, before anything is asked:
// { pieces: [{ id, kind, model, units, usd }], usd (the sum of what has a price), unpriced (how many pieces have none) }.
// A piece whose inputs are not made yet is counted from what its node says (a clip from the length of its line).
export async function estimate(dir, flow, { want = null, again = [], env = process.env, use = MODELS } = {}) {
  const rows = new Map((await look(dir, flow, { env, use })).map((r) => [r.id, r])), wanted = new Set(ordered(flow, want || Object.keys(flow.nodes))), redo = new Set(again), pieces = [];
  for (const id of wanted) {
    const n = flow.nodes[id], r = rows.get(id);
    if (!made(n) || n.file || n.kind === 'cut' || n.grab || !(redo.has(id) || ['make', 'wait'].includes(r?.state))) continue;
    try {
      if (r?.state === 'make' && r.model) { pieces.push({ id, kind: n.kind, model: r.model, units: r.units, usd: r.usd }); continue; }
      const line = n.kind === 'clip' && n.voice ? flow.nodes[idOf(n.voice)] : null, role = n.kind === 'clip' ? (line && !n.heard ? 'talk' : 'clip') : n.kind;
      const by = use.modelFor(role, n.model || (n.kind === 'voice' && flow.nodes[idOf(n.who)]?.voice?.model) || flow.models?.[role], env, false);
      let units = n.kind === 'voice' ? String(n.text).length / 1000 * (n.fit ? 2 : 1) : n.kind === 'sound' ? n.seconds || 3 : 1;
      if (n.kind === 'clip') { const guess = n.seconds || (line ? LEAD + speechSeconds(line.text, flow.language) * 1.15 + TAIL + .4 : 4); try { units = MODELS.fitSeconds(await use.clipAbilities(by, { frame: !!n.frame }), guess); } catch { units = Math.ceil(guess); } }
      pieces.push({ id, kind: n.kind, model: by.name, units: +(+units).toFixed(3), usd: costOf(by, units) });
    } catch (e) { pieces.push({ id, kind: n.kind, model: null, units: null, usd: null, why: e.message }); }
  }
  return { pieces, usd: +pieces.reduce((t, p) => t + (p.usd || 0), 0).toFixed(2), unpriced: pieces.filter((p) => p.usd === null).length };
}
