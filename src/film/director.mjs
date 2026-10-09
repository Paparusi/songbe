// The director: fills the canvas from a series and its scripts. The bible becomes notes, people and places; every person gets a
// face and a reference sheet, every place a plate, every scene a wide master picture that fixes where everyone is and the light,
// every shot a first frame drawn from that master, its line recorded in its speaker's voice, and a clip; every episode its music
// and its cut. These are ordinary nodes of flow.json: once there, any of them can be changed by hand.
//
// Each node the director writes remembers what it was written from (`of`). A node is written again only when that changed — so a
// film already made is not disturbed by a new version of Songbe that words its prompts differently — and never when a person has
// changed it since: that one is left alone, and said to be.
import { readFlow, writeFlow } from './flow.mjs';
import { SIZES, checkEpisode, checkSeries, shotsOf, speechOf } from './series.mjs';
import { sha } from '../util.mjs';

const NO_TEXT = 'No text, captions, watermarks or logos anywhere in the picture.';
const NOTICE = { vietnamese: 'Nội dung tạo bằng AI', english: 'Made with AI' };
const names = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1));
const sentence = (t) => String(t || '').trim().replace(/([^.!?])$/, '$1.');
const sheets = (people) => people.map((p) => `@${p.id}-sheet is the reference sheet of ${p.name}.`).join(' ');
export const shotId = (n, shot) => `e${n}-s${shot.id}`;

// How each node is worded. Every one of these sees only the facts it is given (x), so those facts are exactly what the node is
// written from.
const WRITE = {
  style: (x) => ({ kind: 'text', text: sentence(x.style), group: 'series', label: 'The medium: what kind of picture this is' }),
  look: (x) => ({ kind: 'text', text: [x.medium ? '@style' : null, sentence(x.look)].filter(Boolean).join(' '), group: 'series', label: 'The look of every picture' }),
  person: (x) => ({ kind: 'person', name: x.name, ...(x.look ? { look: x.look } : {}), ...(x.wardrobe ? { wardrobe: x.wardrobe } : {}), ...(x.manner ? { manner: x.manner } : {}), ...(x.voice ? { voice: x.voice } : {}), group: 'cast' }),
  face: (x) => (x.own ? { kind: 'picture', file: x.own, group: 'cast', label: `${x.name}: face` }      // (faces are drawn in the medium, in plain light: the mood of the series is for scenes)
    : { kind: 'picture', prompt: `${x.medium ? '@style' : '@look'} Portrait of @${x.id}. Chest-up, facing the camera, calm neutral expression, eyes to the lens. Even soft daylight on the face, plain light-grey backdrop, sharp focus. ${NO_TEXT}`, aspect: '3:4', group: 'cast', label: `${x.name}: face` }),
  sheet: (x) => (x.own ? { kind: 'picture', file: x.own, group: 'cast', label: `${x.name}: reference sheet` }
    : { kind: 'picture', prompt: `A character reference sheet of the person in @${x.id}-face, for film continuity, drawn in the same style as that picture. One wide picture on a plain light-grey background showing the SAME person five times, side by side, evenly lit: the face from the front, the face in three-quarter view, the face in profile, the whole figure standing seen from the front, and the whole figure standing seen from behind. Face, hair, age and build are identical in every view${x.wardrobe ? `, and every view wears ${x.wardrobe}` : ''}. ${NO_TEXT}`,
      aspect: '16:9', group: 'cast', label: `${x.name}: reference sheet` }),
  place: (x) => ({ kind: 'place', name: x.name, ...(x.look ? { look: x.look } : {}), group: 'places' }),
  plate: (x) => (x.own ? { kind: 'picture', file: x.own, group: 'places', label: `${x.name}: plate` }
    : { kind: 'picture', prompt: `@look @${x.id}. A wide establishing view of the whole place with nobody in it. ${NO_TEXT}`, aspect: '16:9', group: 'places', label: `${x.name}: plate` }),
  scene: (x) => ({ kind: 'picture', group: `e${x.n}`, label: `Episode ${x.n}, scene ${x.s}: the whole scene`, aspect: '16:9',
    prompt: `@look One moment of a film scene, in a wide shot that shows the whole space and everyone in it. The place is @${x.where}-plate${x.time ? `, ${x.time}` : ''}. ${String(x.staging || '').trim()} ${sheets(x.people)}${x.people.length ? ' Everyone keeps exactly the face, hair, build and clothes of their reference sheet.' : ''} ${NO_TEXT}` }),
  frame: (x) => (x.after ? { kind: 'picture', grab: `@e${x.n}-s${x.after}`, at: 'end', group: `e${x.n}`, label: `Shot ${x.shot}: first frame (where shot ${x.after} ends)` }
    : { kind: 'picture', group: `e${x.n}`, label: `Shot ${x.shot}: first frame`,
      prompt: `@e${x.n}-scene${x.s} is a wide view of one moment in a film: the place, the light, and where everyone is. ${sheets(x.who)} Show that same moment from another camera position. ${SIZES[x.size] || SIZES.medium}. ${String(x.action).trim()} `
        + `${x.who.length ? `In the frame: ${names(x.who.map((p) => p.name))}${x.others.length ? `; ${names(x.others)} ${x.others.length > 1 ? 'are' : 'is'} outside the frame` : ''}.` : 'Nobody is in the frame.'}`
        + `${x.speaker ? ` ${x.speaker}'s mouth is closed, about to speak.` : ''} Same place, same light and same time of day as the wide view${x.who.length ? '; everyone keeps exactly the face, hair and clothes of their reference sheet' : ''}. @look A frame from a film, not a posed photograph: nobody looks into the camera. ${NO_TEXT}` }),
  line: (x) => ({ kind: 'voice', who: `@${x.who}`, text: x.text, ...(x.how ? { how: x.how } : {}), group: `e${x.n}`, label: `Shot ${x.shot}: ${x.name}` }),
  clip: (x) => ({ kind: 'clip', frame: `@e${x.n}-s${x.shot}-frame`, ...(x.speech ? { voice: `@e${x.n}-s${x.shot}-line` } : {}), ...(x.speech === 'heard' ? { heard: true } : {}), ...(x.seconds ? { seconds: x.seconds } : {}), ...(x.model ? { model: x.model } : {}), group: `e${x.n}`, label: `Shot ${x.shot}`,
    prompt: `${(SIZES[x.size] || SIZES.medium).split(':')[0]}${x.camera ? `, ${x.camera}` : ''}. ${String(x.action).trim()}${x.sound ? ` Sound: ${String(x.sound).trim().replace(/\.$/, '')}.` : ''} @look` }),
  music: (x) => ({ kind: 'music', prompt: `Instrumental film score, no vocals, no singing. ${x.music || 'Quiet and tense, sparse piano and low strings.'}`, group: `e${x.n}`, label: `Episode ${x.n}: music` }),
  cut: (x) => ({ kind: 'cut', shots: x.shots.map((s) => `@e${x.n}-s${s}`), music: `@e${x.n}-music`, ...(x.title ? { title: x.title } : {}), notice: x.notice, group: `e${x.n}`, label: `Episode ${x.n}${x.title ? ': ' + x.title : ''}` }),
};

// series + scripts ({ episode number: script }) → { format, language, …, nodes }; each node carries `of`, a mark of the facts it was written from
export function expand(series, scripts = {}) {
  const nodes = {}, cast = series.cast || {}, places = series.places || {}, medium = !!series.style;
  const put = (id, how, x) => { nodes[id] = { ...WRITE[how](x), of: sha([how, x]) }; };
  if (medium) put('style', 'style', { style: series.style });
  put('look', 'look', { medium, look: series.look });
  for (const [id, c] of Object.entries(cast)) {
    const own = [].concat(c.pictures ?? []);
    put(id, 'person', { name: c.name, look: c.look, wardrobe: c.wardrobe, manner: c.manner, voice: c.voice });
    put(`${id}-face`, 'face', { id, name: c.name, own: own[0] || null, medium }); put(`${id}-sheet`, 'sheet', { id, name: c.name, own: own[1] || null, wardrobe: c.wardrobe });
  }
  for (const [id, p] of Object.entries(places)) { put(id, 'place', { name: p.name, look: p.look }); put(`${id}-plate`, 'plate', { id, name: p.name, own: [].concat(p.pictures ?? [])[0] || null }); }
  for (const [key, ep] of Object.entries(scripts)) {
    const n = +key, all = shotsOf(ep), person = (id) => ({ id, name: cast[id].name });
    (ep.scenes || []).forEach((scene, k) => put(`e${n}-scene${k + 1}`, 'scene', { n, s: k + 1, where: scene.where, time: scene.time, staging: scene.staging, people: [...new Set(scene.shots.flatMap((x) => x.who || []))].filter((id) => cast[id]).map(person) }));
    all.forEach(({ shot, scene, s, i }) => {
      const id = shotId(n, shot), who = (shot.who || []).filter((x) => cast[x]), others = [...new Set(scene.shots.flatMap((x) => x.who || []))].filter((x) => cast[x] && !who.includes(x)), speech = speechOf(shot), prev = i > 0 && all[i - 1].s === s ? all[i - 1].shot : null;
      put(`${id}-frame`, 'frame', shot.continues && prev ? { n, shot: shot.id, after: prev.id } : { n, s, shot: shot.id, size: shot.size, action: shot.action, who: who.map(person), others: others.map((x) => cast[x].name), speaker: speech === 'seen' ? cast[shot.line.who].name : null });
      if (shot.line) put(`${id}-line`, 'line', { n, shot: shot.id, who: shot.line.who, name: cast[shot.line.who]?.name || shot.line.who, text: shot.line.text, how: shot.line.how });
      put(id, 'clip', { n, shot: shot.id, size: shot.size, camera: shot.camera, action: shot.action, sound: shot.sound, seconds: shot.seconds, model: shot.model, speech });
    });
    put(`e${n}-music`, 'music', { n, music: ep.music || series.tone });
    put(`e${n}`, 'cut', { n, shots: all.map(({ shot }) => shot.id), title: ep.title, notice: series.notice ?? NOTICE[String(series.language || '').toLowerCase()] ?? NOTICE.english });
  }
  return { format: series.format || 'tall', ...(series.language ? { language: series.language } : {}), ...(series.accent ? { accent: series.accent } : {}), ...(series.resolution ? { resolution: series.resolution } : {}), ...(series.models ? { models: series.models } : {}), nodes };
}

const bare = ({ by, as, of, xy, ...rest }) => rest;      // a node without the director's bookkeeping and its place on the canvas
// Brings flow.json up to the series and scripts. Returns { flow, added, updated, removed, kept } — `kept` are nodes whose facts
// changed and which were left as they are because a person had changed them. With `rewrite` every node still as the director
// wrote it is worded afresh (after an update of Songbe, to have its newer wording; what was made from those nodes is made again).
export function sync(dir, series, scripts = {}, { rewrite = false } = {}) {
  const bad = [...checkSeries(series, dir), ...Object.entries(scripts).flatMap(([n, ep]) => checkEpisode(series, ep).map((x) => `episode ${n}: ${x}`))];
  if (bad.length) throw new Error(`the series has ${bad.length} problem${bad.length > 1 ? 's' : ''}:\n  - ` + bad.join('\n  - '));
  const flow = readFlow(dir), wanted = expand(series, scripts), added = [], updated = [], removed = [], kept = [];
  const untouched = (have) => have.by === 'director' && have.as === sha(bare(have)), written = (node, have) => ({ ...node, by: 'director', as: sha(bare(node)), ...(have?.xy ? { xy: have.xy } : {}) });
  for (const [id, node] of Object.entries(wanted.nodes)) {
    const have = flow.nodes[id];
    if (!have) { flow.nodes[id] = written(node); added.push(id); continue; }
    if (have.by !== 'director') { kept.push(id); continue; }                                    // a node of the person's own under a name the director uses
    if (have.of === undefined) { have.of = node.of; continue; }                                 // written before nodes remembered their facts: taken as it stands
    if (have.of === node.of && !(rewrite && untouched(have))) continue;                         // the same facts: its wording stays
    if (!untouched(have)) { kept.push(id); continue; }
    if (sha(bare(have)) !== sha(bare(node)) || have.of !== node.of) { flow.nodes[id] = written(node, have); updated.push(id); }
  }
  for (const [id, have] of Object.entries(flow.nodes)) if (have.by === 'director' && !wanted.nodes[id]) { if (untouched(have)) { delete flow.nodes[id]; removed.push(id); } else kept.push(id); }
  const { nodes, ...settings } = wanted;
  for (const k of ['format', 'language', 'accent', 'resolution', 'models']) { if (settings[k] === undefined) delete flow[k]; else flow[k] = settings[k]; }
  writeFlow(dir, { ...Object.fromEntries(Object.entries(flow).filter(([k]) => k !== 'nodes')), nodes: flow.nodes });
  return { flow, added, updated, removed, kept };
}

// The nodes of one episode up to a stage of the work, for running a part of it:
//   cast (faces, sheets, plates) → board (+ scene pictures and first frames) → voice (+ lines) → clips → cut
export const STAGES = ['cast', 'board', 'voice', 'clips', 'cut'];
export function stageNodes(flow, n, stage = 'cut') {
  const upto = STAGES.indexOf(stage), group = `e${n}`, of = (kind, g) => Object.entries(flow.nodes).filter(([, x]) => x.kind === kind && g.includes(x.group)).map(([id]) => id);
  if (upto < 0) throw new Error(`"${stage}" is not one of ${STAGES.join(', ')}`);
  const drawn = (id) => upto >= 3 || !flow.nodes[id].grab;      // a frame taken from a clip waits for the clips
  return [...of('picture', ['cast', 'places']), ...(upto >= 1 ? of('picture', [group]).filter(drawn) : []), ...(upto >= 2 ? of('voice', [group]) : []), ...(upto >= 3 ? of('clip', [group]) : []), ...(upto >= 4 ? [...of('music', [group]), ...of('cut', [group])] : [])];
}
