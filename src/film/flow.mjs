// flow.json — a film as a canvas of nodes. A node is a note, a person, a place, a picture, a spoken line, a clip, a piece of music
// or a cut, and says what it is made from: its words, the model to ask, and the other nodes it works from. Any node can work from
// any other: write "@name" in a prompt and a note's words are put in its place, a person or a place is described, and a picture,
// clip or recording is handed to the model as a reference ("image 2"); a clip names its first frame, its last, and the recording
// its actor performs to. Nothing here knows what an episode or a shot is — that is one way of filling the canvas (director.mjs),
// and a person or an agent may add, rewire or replace any node by hand.
//
// Every result is a take, kept under a key made from everything it was made from. So asking again costs nothing, and changing one
// thing — a line, a face, a model — leaves exactly the nodes that work from it to be made again. Earlier takes are kept; any of
// them can be chosen (pick), and a chosen take can be held whatever changes around it (lock).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cut } from './cut.mjs';
import * as MODELS from './models.mjs';
import { nameOf, secondsOf } from './models.mjs';
import { ASPECT, LEAD, lengthOf, speechSeconds } from './series.mjs';
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
  voice: { one: ['text', 'file'], may: ['who', 'how', 'voice', 'model', 'style', 'speed', 'options'], ext: 'wav' },
  clip: { one: ['prompt', 'file'], may: ['frame', 'end', 'voice', 'heard', 'refs', 'model', 'seconds', 'sound', 'resolution', 'options'], ext: 'mp4' },
  music: { one: ['prompt', 'file'], may: ['model', 'options'], ext: 'mp3' },
  cut: { must: ['shots'], may: ['music', 'title', 'notice', 'subtitles', 'musicVolume'], ext: 'mp4' },
};
const ANY = ['kind', 'label', 'group', 'note', 'by', 'as', 'of', 'xy'];      // what every node may carry (by, as, of: the director's marks; xy: where it sits on the canvas)
const WORD = { picture: 'image', clip: 'video', voice: 'audio', music: 'audio' };
const SLOTS = { picture: ['grab'], clip: ['frame', 'end', 'voice'], cut: ['music'] };      // the fields in which a node names another it is made from
const made = (node) => !!KINDS[node?.kind]?.ext;
export const idOf = (ref) => String(ref || '').replace(/^@/, '');
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const shotOf = (s) => (typeof s === 'string' ? { clip: s } : s || {});

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
  for (const slot of SLOTS[n.kind] || []) if (n[slot]) add(n[slot]);
  for (const r of list(n.refs)) add(r);
  if (n.kind === 'cut') for (const s of list(n.shots)) { const c = idOf(shotOf(s).clip); add(c); if (flow.nodes[c]?.voice) add(flow.nodes[c].voice); }
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
    slot('frame', 'picture'); slot('end', 'picture'); slot('grab', 'clip'); if (n.kind === 'clip') slot('voice', 'voice'); if (n.kind === 'voice') slot('who', 'person'); if (n.kind === 'cut') slot('music', 'music');
    for (const r of list(n.refs)) if (!is(r, 'picture')) bad.push(`${id}.refs: "${r}" is not a picture node`);
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
// .songbe/flow/takes.json: { takes: { key: [{ n, file, at, by, took, info }] }, picks: { node: { key, n } }, locks: { node: true } }
const storeDir = (dir) => path.join(dir, '.songbe', 'flow');
export function openStore(dir) {
  const file = path.join(storeDir(dir), 'takes.json');
  let s = { takes: {}, picks: {}, locks: {} };
  if (exists(file)) try { s = { ...s, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  const abs = (t) => (t ? { ...t, file: path.join(storeDir(dir), t.file) } : null), there = (t) => t && exists(path.join(storeDir(dir), t.file));
  return {
    save() { mkdir(storeDir(dir)); fs.writeFileSync(file, JSON.stringify(s, null, 1)); },
    all: (key) => (s.takes[key] || []).filter(there).map(abs),
    // the take in use for a node asked for as `key`: the chosen one, else the latest
    current(id, key) { const mine = (s.takes[key] || []).filter(there), p = s.picks[id]; return abs((p && p.key === key && mine.find((t) => t.n === p.n)) || mine.at(-1) || null); },
    // a take held whatever is asked for now
    held(id) { const p = s.picks[id]; if (!s.locks[id] || !p) return null; const t = (s.takes[p.key] || []).find((x) => x.n === p.n); return there(t) ? { ...abs(t), key: p.key } : null; },
    next(key, ext) { const n = ((s.takes[key] || []).at(-1)?.n || 0) + 1; mkdir(path.join(storeDir(dir), 'takes')); return { n, name: `takes/${key}-${n}.${ext}`, file: path.join(storeDir(dir), 'takes', `${key}-${n}.${ext}`) }; },
    add(id, key, take) { (s.takes[key] ||= []).push(take); s.picks[id] = { key, n: take.n }; this.save(); return abs(take); },
    pick(id, key, n) { if (!(s.takes[key] || []).some((t) => t.n === n)) throw new Error(`${id} has no take ${n}`); s.picks[id] = { key, n }; this.save(); },
    // hold the take a node stands on now (named by its key and number), or let the node follow what it is made from again
    hold(id, key, n) { this.pick(id, key, n); s.locks[id] = true; this.save(); }, release(id) { delete s.locks[id]; this.save(); }, locked: (id) => !!s.locks[id], picked: (id) => s.picks[id] || null,
  };
}
const own = (dir, node) => { const file = path.resolve(dir, node.file); if (!exists(file)) throw new Error(`the file ${node.file} is not there`); return { file, take: 'own-' + crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16), info: {} }; };

// ---- how each kind is made ----
// Each returns { recipe: everything the result depends on, by: the model, info: what later steps need to know, make(file, { seed }) }.
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
  return { recipe: { kind: 'picture', model: r.name, prompt: w.words, refs: files.map(take), aspect, options: n.options }, by: r,
    make: (file, { seed }) => c.use.makePicture(r, { prompt: w.words, refs: files.map((f) => f.file), aspect, seed, options: n.options }, file, c.env) };
}
function voice(c, id, n) {
  const person = n.who ? c.flow.nodes[idOf(n.who)] : null, set = { ...(person?.voice || {}), ...Object.fromEntries(['voice', 'model', 'style', 'speed'].filter((k) => n[k] !== undefined).map((k) => [k, n[k]])) };
  const r = c.use.modelFor('voice', set.model || c.flow.models?.voice, c.env, c.strict), language = c.flow.language || null, name = set.voice || Object.keys(r.known?.voices?.female || {})[0] || undefined;
  // a model that takes direction is told who speaks and how; one that does not is given the language and the line
  const style = r.known?.directed ? [`Language: ${language || 'the language the line is written in'}${c.flow.accent ? ', ' + c.flow.accent : ''}.`, person ? `Speaker: ${person.name}${person.manner ? ', ' + person.manner : ''}.` : null, set.style ? `Voice: ${set.style}.` : null,
    `Delivery: ${n.how || 'natural'}. A line of dialogue in a film, said to someone in the same room: conversational pace, not a narrator, not an announcer.`].filter(Boolean).join('\n') : set.style || null;
  return { recipe: { kind: 'voice', model: r.name, voice: name, style, text: n.text, language, speed: set.speed, options: n.options }, by: r,
    make: (file) => c.use.makeVoice(r, { text: n.text, voice: name, style, language: language || 'auto', speed: set.speed, options: n.options }, file, c.env) };
}
async function clip(c, id, n) {
  const line = n.voice ? c.flow.nodes[idOf(n.voice)] : null, seen = !!line && !n.heard, r = c.use.modelFor(seen ? 'talk' : 'clip', n.model || c.flow.models?.[seen ? 'talk' : 'clip'], c.env, c.strict);
  const frame = n.frame ? c.got(idOf(n.frame)) : null, end = n.end ? c.got(idOf(n.end)) : null, w = wordsOf(c.flow, n.prompt, c.got);
  const refs = [...w.files, ...more(c, n, w)];
  const can = await c.use.clipAbilities(r, { frame: !!frame, refs });
  // someone seen speaking: the model acts to our recording when it can, speaks the line itself when it can only do that; a voice
  // that is only heard is laid over a clip in which nobody speaks
  const how = !line ? 'plain' : !seen ? 'over' : can.acts ? 'voice' : can.speaks ? 'native' : 'over';
  const rec = line && how !== 'native' ? c.got(idOf(n.voice)) : null, said = rec ? secondsOf(rec.file) : null;
  const length = how === 'native' ? n.seconds || +(speechSeconds(line.text, c.flow.language) + 1.6).toFixed(1) : lengthOf(n, said), seconds = MODELS.fitSeconds(can, length);
  if (rec && seconds < length - .05) throw new Error(`the line runs ${said.toFixed(1)} s and ${r.name} makes at most ${seconds} s: shorten the line, or give part of it to another shot`);
  if (end && !can.end) throw new Error(`${r.name} does not take a last frame`);
  const who = (line?.who && c.flow.nodes[idOf(line.who)]?.name) || 'The speaker', manner = line?.how ? ` (${line.how})` : '';
  const speech = how === 'voice' ? ` ${who} speaks${manner}, saying: "${line.text}" The lips move with the words. Nobody else speaks.`
    : how === 'native' ? ` ${who} says in ${c.flow.language || 'the language of the line'}${manner}: "${line.text}" Nobody else speaks.` : ' Nobody in the frame speaks; lips stay closed.';
  const prompt = `${w.words.trim()}${speech} No subtitles, no captions, no text on screen. No music.`, aspect = ASPECT[c.flow.format] || ASPECT.tall, resolution = n.resolution || c.flow.resolution || '720p';
  return { recipe: { kind: 'clip', model: r.name, how, prompt, frame: take(frame), end: take(end), voice: how === 'voice' ? rec.take : undefined, refs: refs.map(take), seconds, aspect, resolution, sound: n.sound !== false, options: n.options }, by: r,
    info: { how, length: how === 'native' ? null : length, keeps: how === 'voice' && can.acts === 'keeps' },
    make: async (file, { seed }) => {
      const track = how === 'voice' ? file + '.talk.wav' : null;      // the recording as the actor hears it: a breath of silence, the line, then silence to the end of the clip
      if (track) ff('-f', 'lavfi', '-t', String(LEAD), '-i', 'anullsrc=r=48000:cl=mono', '-i', rec.file, '-filter_complex', `[0][1]concat=n=2:v=0:a=1,apad=whole_dur=${Math.max(2, seconds)}`, '-ar', '48000', '-ac', '1', track);
      try { await c.use.makeClip(r, { prompt, frame: frame?.file, end: end?.file, voice: track, refs: refs.map((f) => ({ file: f.file, kind: f.kind })), seconds, aspect, resolution, sound: n.sound !== false, seed, options: n.options }, file, c.env); }
      finally { if (track) fs.rmSync(track, { force: true }); }
    } };
}
function music(c, id, n) {
  const r = c.use.modelFor('music', n.model || c.flow.models?.music, c.env, c.strict), w = wordsOf(c.flow, n.prompt, () => ({}));
  return { recipe: { kind: 'music', model: r.name, prompt: w.words, options: n.options }, by: r, make: (file, { seed }) => c.use.makeMusic(r, { prompt: w.words, seed, options: n.options }, file, c.env) };
}
function cutting(c, id, n) {
  const parts = list(n.shots).map((s) => { const x = shotOf(s), cid = idOf(x.clip), cn = c.flow.nodes[cid], got = c.got(cid), line = cn.voice ? c.flow.nodes[idOf(cn.voice)] : null, rec = line ? c.got(idOf(cn.voice)) : null;
    return { id: cid, file: got.file, take: got.take, info: got.info || {}, from: x.from, to: x.to, text: line?.text || null, who: (line?.who && c.flow.nodes[idOf(line.who)]?.name) || null, rec }; });
  const bed = n.music ? c.got(idOf(n.music)) : null, size = FORMATS[c.flow.format] || FORMATS.tall;
  const settings = { title: n.title || null, notice: n.notice ?? null, subtitles: n.subtitles !== false, musicVolume: n.musicVolume ?? .22, size };
  return { recipe: { kind: 'cut', parts: parts.map((p) => ({ clip: p.take, voice: take(p.rec), from: p.from, to: p.to, text: p.text, info: p.info })), music: take(bed), ...settings }, by: null,
    make: (file) => cut(file, { parts: parts.map((p) => ({ ...p, voice: p.rec?.file || null })), music: bed?.file || null, ...settings }) };
}
const PLAN = { picture, voice, clip, music, cut: cutting };

// ---- the run ----
const seedOf = (key, n) => (parseInt(key.slice(0, 7), 16) + n * 7919) % 2147483647;
// What stands for each node now, without making anything: [{ id, kind, state, file, take, by, why }] where state is
//   words (nothing to make) · own (a file of yours) · ready · held (a chosen take kept although what it is made from changed)
//   make (to be made: `first` when it has no take at all) · wait (needs something not made yet) · stuck (cannot be planned: `why`)
export async function look(dir, flow, { env = process.env, use = MODELS } = {}) {
  const store = openStore(dir), out = new Map(), rows = [];
  for (const id of ordered(flow)) {
    const n = flow.nodes[id];
    if (!made(n)) { rows.push({ id, kind: n.kind, state: 'words' }); continue; }
    try {
      if (n.file) { const o = own(dir, n); out.set(id, o); rows.push({ id, kind: n.kind, state: 'own', ...o }); continue; }
      const held = store.held(id);
      if (held) { out.set(id, { file: held.file, take: `${held.key}-${held.n}`, info: held.info }); rows.push({ id, kind: n.kind, state: 'held', file: held.file, take: `${held.key}-${held.n}`, by: held.by, n: held.n }); continue; }
      const missing = needs(flow, id).filter((d) => !out.has(d));
      if (missing.length) { rows.push({ id, kind: n.kind, state: 'wait', why: 'needs ' + missing.join(', ') }); continue; }
      const p = await PLAN[n.kind]({ flow, env, use, strict: false, got: (x) => out.get(x) }, id, n), key = sha(p.recipe), t = store.current(id, key);
      const asked = p.recipe.prompt ? { recipe: { model: p.recipe.model, prompt: p.recipe.prompt, refs: p.recipe.refs, how: p.recipe.how, seconds: p.recipe.seconds } } : {};      // what the model is told, for whoever wants to read it
      if (t) { out.set(id, { file: t.file, take: `${key}-${t.n}`, info: t.info }); rows.push({ id, kind: n.kind, state: 'ready', file: t.file, take: `${key}-${t.n}`, by: t.by, n: t.n, takes: store.all(key).length, ...asked }); }
      else rows.push({ id, kind: n.kind, state: 'make', by: p.by ? nameOf(p.by) : null, first: !store.picked(id), ...asked });
    } catch (e) { rows.push({ id, kind: n.kind, state: 'stuck', why: e.message }); }
  }
  return rows;
}

// Makes what is missing or out of date among `want` (node names; everything when left out) and whatever those work from.
// `again` names nodes to make another take of even though one stands. Up to `limit` models are asked at once; a node that fails
// is reported and everything that does not need it still gets made. `on` hears { type: 'start' | 'done' | 'failed' | 'ready' | 'own', id, … }.
// (`use` stands in for the models in tests.)
export async function runFlow(dir, flow, { want = null, again = [], limit = 4, env = process.env, use = MODELS, on = () => {} } = {}) {
  const bad = checkFlow(flow, dir); if (bad.length) throw new Error(`flow.json has ${bad.length} problem${bad.length > 1 ? 's' : ''}:\n  - ` + bad.join('\n  - '));
  const store = openStore(dir), order = ordered(flow, want || Object.keys(flow.nodes)).filter((id) => made(flow.nodes[id])), redo = new Set(again);
  const out = new Map(), failed = new Map(), busy = new Map(), result = { made: [], ready: [], failed: [] };
  const settle = async (id) => {
    const n = flow.nodes[id];
    if (n.file) { out.set(id, own(dir, n)); on({ type: 'own', id }); return; }
    const held = !redo.has(id) && store.held(id);
    if (held) { out.set(id, { file: held.file, take: `${held.key}-${held.n}`, info: held.info }); result.ready.push(id); on({ type: 'ready', id, held: true }); return; }
    const p = await PLAN[n.kind]({ flow, env, use, strict: true, got: (x) => out.get(x) }, id, n), key = sha(p.recipe), t = redo.has(id) ? null : store.current(id, key);
    if (t) { out.set(id, { file: t.file, take: `${key}-${t.n}`, info: t.info }); result.ready.push(id); on({ type: 'ready', id }); return; }
    const slot = store.next(key, KINDS[n.kind].ext), t0 = Date.now(), by = p.by ? nameOf(p.by) : 'here';
    on({ type: 'start', id, kind: n.kind, by });
    busy.set(id, (async () => {
      try {
        for (let tries = 1; ; tries++) {      // a busy or unreachable provider gets a second and a third chance; a refusal does not
          try { await p.make(slot.file, { seed: seedOf(key, slot.n), n: slot.n }); break; }
          catch (e) { fs.rmSync(slot.file, { force: true }); if (tries >= 3 || !/could not be reached|answered (429|5\d\d)|fal (429|5\d\d)|timed out|fetch failed|ECONNRESET/i.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 4000 * tries)); }
        }
        if (!exists(slot.file) || !fs.statSync(slot.file).size) throw new Error('nothing was written');
        const kept = store.add(id, key, { n: slot.n, file: slot.name, at: new Date().toISOString(), by, took: +((Date.now() - t0) / 1000).toFixed(1), ...(p.info ? { info: p.info } : {}) });
        out.set(id, { file: kept.file, take: `${key}-${slot.n}`, info: p.info }); result.made.push(id); on({ type: 'done', id, kind: n.kind, by, took: kept.took, file: kept.file, n: slot.n });
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
  return { ...result, out };
}
