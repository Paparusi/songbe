// The director: fills the canvas from a series and its scripts. The bible becomes notes, people and places; every person gets a
// face and a reference sheet, every place a plate, every scene a wide master picture that fixes where everyone is and the light,
// every shot a first frame drawn from that master, its line recorded in its speaker's voice, and a clip; every episode its music
// and its cut. These are ordinary nodes of flow.json: once there, any of them can be changed by hand.
//
// Each node the director writes remembers what it was written from (`of`). A node is written again only when that changed — so a
// film already made is not disturbed by a new version of Songbe that words its prompts differently — and never when a person has
// changed it since: that one is left alone, and said to be.
import { idOf, needs, readFlow, writeFlow } from './flow.mjs';
import { KNOWN } from './models.mjs';
import { SIZES, checkEpisode, checkSeries, shotsOf, speechOf } from './series.mjs';
import { sha } from '../util.mjs';

const NO_TEXT = 'No text, captions, watermarks or logos anywhere in the picture.';
const NOTICE = { vietnamese: 'Nội dung tạo bằng AI', english: 'Made with AI' };
const names = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1));
const sentence = (t) => String(t || '').trim().replace(/([^.!?])$/, '$1.');
const plain = (t) => String(t ?? '').trim().replace(/@/g, '@@');      // words put into a prompt as they are
const sheets = (people) => people.map((p) => `@${p.id}-sheet is the reference sheet of ${p.name}.`).join(' ');
// Someone lying down was seen drawn with the hair out of sight behind the head; the clip that starts on that picture then has
// to make the hair up when they rise, and made a short crop of shoulder-length hair. So a picture is told that hair is seen.
// the shots in which a face fills the frame: the first frame shows the clip model all it needs of the person
const CLOSE = new Set(['close', 'extreme close', 'insert']);
// the people of a shot as a clip model is told of them: [{ name, figure, wardrobe }] → a sentence ('' when there is nothing to tell)
const plainly = (t) => String(t || '').trim().replace(/[.;,\s]+$/, '').replace(/^(An?|The)\b/, (w) => w.toLowerCase());
function afar(people) {
  const told = (people || []).map((p) => (typeof p === 'string' ? `@${p}` : (() => { const more = [plainly(p.figure), p.wardrobe ? `wearing ${plainly(p.wardrobe)}` : ''].filter(Boolean).join('; '); return more ? `${p.name} (${more})` : ''; })())).filter(Boolean);
  return told.length ? ` How they look, for what the first frame does not show of them: ${told.join('; ')}.` : '';
}
const HAIR = 'Hair is as long as on the sheet in every pose: on someone lying down it is seen, spread loose beside the head.';
export const shotId = (n, shot) => `e${n}-s${shot.id}`;

// How each node is worded. Every one of these sees only the facts it is given (x), so those facts are exactly what the node is
// written from.
const WRITE = {
  style: (x) => ({ kind: 'text', text: sentence(x.style), group: 'series', label: 'The medium: what kind of picture this is' }),
  look: (x) => ({ kind: 'text', text: [x.medium ? '@style' : null, sentence(x.look)].filter(Boolean).join(' '), group: 'series', label: 'The look of every picture' }),
  // A clip starts from a picture that already has the look. Told the palette again, a clip model has been seen to paint one of
  // its colours onto a face halfway through; so a clip is told the medium, and to keep what its first frame shows — the light,
  // the colours, who everyone is. Not how their faces stand: told that "everyone's face stays as in the first frame", a model
  // froze them (the picture of a whole episode moved half as much as that of a film made without those words). So it is also
  // told that the people are alive.
  keep: (x) => ({ kind: 'text', text: `${x.medium ? '@style ' : ''}The light and the colours stay as they are in the first frame, and everyone stays the same person, with the same hair and clothes. The acting is alive: people blink and breathe, their eyes move, and what they feel shows in the face and changes as the shot goes on.`, group: 'series', label: 'What every clip keeps from its first frame, and what it does not' }),
  person: (x) => ({ kind: 'person', name: x.name, ...(x.look ? { look: x.look } : {}), ...(x.figure ? { figure: x.figure } : {}), ...(x.wardrobe ? { wardrobe: x.wardrobe } : {}), ...(x.manner ? { manner: x.manner } : {}), ...(x.voice ? { voice: x.voice } : {}), group: 'cast' }),
  // A face is who someone is: it is drawn from what they look like and never from what they wear, so that giving someone other
  // clothes leaves them the same person (their sheet is drawn again from the same face). Faces are drawn in the medium, in plain
  // light: the mood of the series is for scenes.
  face: (x) => (x.own ? { kind: 'picture', file: x.own, group: 'cast', label: `${x.name}: face` }
    : { kind: 'picture', prompt: `${x.medium ? '@style' : '@look'} Portrait of ${plain(x.name)}${x.look ? `: ${plain(x.look).replace(/\.$/, '')}` : ''}. Chest-up, facing the camera, calm neutral expression, eyes to the lens. Wearing a plain dark top. Even soft daylight on the face, plain light-grey backdrop, sharp focus. ${NO_TEXT}`, aspect: '3:4', group: 'cast', label: `${x.name}: face` }),
  sheet: (x) => (x.own ? { kind: 'picture', file: x.own, group: 'cast', label: `${x.name}: reference sheet` }
    : { kind: 'picture', prompt: `A character reference sheet of the person in @${x.id}-face, for film continuity, drawn in the same style as that picture. One wide picture on a plain light-grey background showing the SAME person five times, side by side, evenly lit: the face from the front, the face in three-quarter view, the face in profile, the whole figure standing seen from the front, and the whole figure standing seen from behind. Face, hair, age and build are identical in every view${x.wardrobe ? `, and every view wears ${x.wardrobe}` : ''}. ${NO_TEXT}`,
      aspect: '16:9', group: 'cast', label: `${x.name}: reference sheet` }),
  place: (x) => ({ kind: 'place', name: x.name, ...(x.look ? { look: x.look } : {}), group: 'places' }),
  plate: (x) => (x.own ? { kind: 'picture', file: x.own, group: 'places', label: `${x.name}: plate` }
    : { kind: 'picture', prompt: `@look @${x.id}. A wide establishing view of the whole place with nobody in it. ${NO_TEXT}`, aspect: '16:9', group: 'places', label: `${x.name}: plate` }),
  // The plate of a place is drawn in a light of its own (a room by day). A scene at another hour was seen to keep that light — a
  // bright window at midnight — when the hour was only named beside the place; so the scene is told that the hour is its own.
  scene: (x) => ({ kind: 'picture', group: `e${x.n}`, label: `Episode ${x.n}, scene ${x.s}: the whole scene`, aspect: '16:9',
    prompt: `@look One moment of a film scene, in a wide shot that shows the whole space and everyone in it. The place is @${x.where}-plate: its walls, furniture and layout are kept.${x.time ? ` The hour and the light are this moment's, not that picture's: ${plain(x.time).replace(/\.$/, '')}. Any window shows the sky of that hour.` : ''} ${String(x.staging || '').trim()} ${sheets(x.people)}${x.people.length ? ` Everyone keeps exactly the face, hair, build and clothes of their reference sheet. ${HAIR}` : ''} ${NO_TEXT}` }),
  frame: (x) => (x.after ? { kind: 'picture', grab: `@e${x.n}-s${x.after}`, at: 'end', group: `e${x.n}`, label: `Shot ${x.shot}: first frame (where shot ${x.after} ends)` }
    : { kind: 'picture', group: `e${x.n}`, label: `Shot ${x.shot}: first frame`,
      prompt: `@e${x.n}-scene${x.s} is a wide view of one moment in a film: the place, the light, and where everyone is. ${sheets(x.who)} Show that same moment from another camera position. ${SIZES[x.size] || SIZES.medium}. This picture is the first frame of a film shot in which this happens: ${String(x.action).trim()} Show the instant before it happens — the pose and the expression it starts from — so that the shot has it still to do. `
        + `${x.who.length ? `In the frame: ${names(x.who.map((p) => p.name))}${x.others.length ? `; ${names(x.others)} ${x.others.length > 1 ? 'are' : 'is'} outside the frame` : ''}.` : 'Nobody is in the frame.'}`
        + `${x.speaker ? ` ${x.speaker}'s mouth is closed, about to speak.` : ''} Same place, same light and same time of day as the wide view${x.who.length ? `; everyone keeps exactly the face, hair and clothes of their reference sheet. ${HAIR}` : '.'} @look A frame from a film, not a posed photograph: nobody looks into the camera. ${NO_TEXT}` }),
  line: (x) => ({ kind: 'voice', who: `@${x.who}`, text: x.text, ...(x.how ? { how: x.how } : {}), ...(x.toPicture ? { fit: `@e${x.n}-s${x.shot}` } : {}), group: `e${x.n}`, label: `Shot ${x.shot}: ${x.name}` }),
  clip: (x) => ({ kind: 'clip', frame: `@e${x.n}-s${x.shot}-frame`, ...(x.speech ? { voice: `@e${x.n}-s${x.shot}-line` } : {}), ...(x.speech === 'heard' ? { heard: true } : {}), ...(x.seconds ? { seconds: x.seconds } : {}), ...(x.model ? { model: x.model } : {}), ...(x.hear?.length ? { sounds: x.hear.map((h) => ({ sound: `@${h.sound}`, at: h.at ?? 0, ...(h.volume ? { volume: h.volume } : {}), ...(h.to ? { to: h.to } : {}) })) } : {}), group: `e${x.n}`, label: `Shot ${x.shot}`,
    // (a shot of a thing alone is told that nobody comes into it: a clip model was seen to walk someone through a wall insert)
    // (a clip model sees its first frame and nothing else of the people in it: someone small in a wide frame, or seen from behind, was
    // given another face and other clothes as he turned and came closer. A shot that is not close is told in words how its people are
    // known from afar — their figure and what they wear. Not the face: told of "a prominent mole", a clip painted a black coin on a cheek.)
    prompt: `${(SIZES[x.size] || SIZES.medium).split(':')[0]}${x.camera ? `, ${x.camera}` : ''}. ${String(x.action).trim()}${x.acting ? ` ${sentence(x.acting)}` : ''}${x.empty ? ' Nobody is in the frame and nobody enters it.' : ''}${x.sound ? ` Sound: ${String(x.sound).trim().replace(/\.$/, '')}.` : ''} @keep${afar(x.people)}` }),
  // a sound of the series: made once, the same every time it is heard
  sound: (x) => (x.file ? { kind: 'sound', file: x.file, group: 'series', label: x.name || 'A sound' } : { kind: 'sound', prompt: sentence(x.prompt), ...(x.seconds ? { seconds: x.seconds } : {}), group: 'series', label: x.name || 'A sound' }),
  music: (x) => ({ kind: 'music', prompt: `Instrumental film score, no vocals, no singing. ${x.music || 'Quiet and tense, sparse piano and low strings.'}`, group: `e${x.n}`, label: `Episode ${x.n}: music` }),
  cut: (x) => ({ kind: 'cut', shots: x.shots.map((s) => `@e${x.n}-s${s}`), music: `@e${x.n}-music`, ...(x.title ? { title: x.title } : {}), notice: x.notice, group: `e${x.n}`, label: `Episode ${x.n}${x.title ? ': ' + x.title : ''}` }),
};

// series + scripts ({ episode number: script }) → { format, language, …, nodes }; each node carries `of`, a mark of the facts it was written from.
// (`was`, which is not written to the file: for a node whose facts an older Songbe counted differently, the marks it gave then —
// a node that carries one of those was written from the same facts, and keeps its words.)
export function expand(series, scripts = {}) {
  const nodes = {}, was = {}, cast = series.cast || {}, places = series.places || {}, medium = !!series.style;
  const put = (id, how, x, ...older) => { nodes[id] = { ...WRITE[how](x), of: sha([how, x]) }; if (older.length) was[id] = older.map((o) => sha([how, o])); };
  if (medium) put('style', 'style', { style: series.style });
  put('look', 'look', { medium, look: series.look }); put('keep', 'keep', { medium });
  for (const [id, c] of Object.entries(cast)) {
    const own = [].concat(c.pictures ?? []);
    put(id, 'person', { name: c.name, look: c.look, ...(c.figure ? { figure: c.figure } : {}), wardrobe: c.wardrobe, manner: c.manner, voice: c.voice });
    put(`${id}-face`, 'face', { id, name: c.name, own: own[0] || null, medium, look: c.look }, { id, name: c.name, own: own[0] || null, medium }); put(`${id}-sheet`, 'sheet', { id, name: c.name, own: own[1] || null, wardrobe: c.wardrobe });
  }
  for (const [id, s] of Object.entries(series.sounds || {})) put(id, 'sound', { name: s.name, prompt: s.prompt, seconds: s.seconds, file: s.file });
  for (const [id, p] of Object.entries(places)) { put(id, 'place', { name: p.name, look: p.look }); put(`${id}-plate`, 'plate', { id, name: p.name, own: [].concat(p.pictures ?? [])[0] || null }); }
  for (const [key, ep] of Object.entries(scripts)) {
    const n = +key, all = shotsOf(ep), person = (id) => ({ id, name: cast[id].name });
    (ep.scenes || []).forEach((scene, k) => put(`e${n}-scene${k + 1}`, 'scene', { n, s: k + 1, where: scene.where, time: scene.time, staging: scene.staging, people: [...new Set(scene.shots.flatMap((x) => x.who || []))].filter((id) => cast[id]).map(person) }));
    all.forEach(({ shot, scene, s, i }) => {
      const id = shotId(n, shot), who = (shot.who || []).filter((x) => cast[x]), others = [...new Set(scene.shots.flatMap((x) => x.who || []))].filter((x) => cast[x] && !who.includes(x)), speech = speechOf(shot), prev = i > 0 && all[i - 1].s === s ? all[i - 1].shot : null;
      put(`${id}-frame`, 'frame', shot.continues && prev ? { n, shot: shot.id, after: prev.id } : { n, s, shot: shot.id, size: shot.size, action: shot.action, who: who.map(person), others: others.map((x) => cast[x].name), speaker: speech === 'seen' ? cast[shot.line.who].name : null });
      // the model of this shot: its own, else the one the episode names for its kind of shot (the series' is left to the canvas)
      const model = shot.model || ep.models?.[speech === 'seen' ? 'talk' : 'clip'];
      // a model that acts to a recording gets the line recorded first; one that only speaks films first, and the line is recorded to its lips
      const talks = KNOWN[model || series.models?.talk], toPicture = speech === 'seen' && !!talks?.speaks && !talks.acts;
      if (shot.line) put(`${id}-line`, 'line', { n, shot: shot.id, who: shot.line.who, name: cast[shot.line.who]?.name || shot.line.who, text: shot.line.text, how: shot.line.how, ...(toPicture ? { toPicture } : {}) });
      const facts = { n, shot: shot.id, size: shot.size, camera: shot.camera, action: shot.action, sound: shot.sound, seconds: shot.seconds, model, speech, ...(shot.hear?.length ? { hear: shot.hear } : {}), ...(shot.acting ? { acting: shot.acting } : {}) };      // (a shot nothing is set into, and nobody is directed in, is written from what it always was)
      // nobody in the frame: said to the clip model. A shot that is not close: the clip model is told how its people are known from afar
      // (their figure, what they wear). One written before either was said keeps its words.
      // (for a short while its people were named and described whole, face and all: a clip written then keeps its words too)
      if (!who.length) put(id, 'clip', { ...facts, empty: true }, facts); else if (CLOSE.has(shot.size)) put(id, 'clip', facts);
      else put(id, 'clip', { ...facts, people: who.map((w) => ({ name: cast[w].name, ...(cast[w].figure ? { figure: cast[w].figure } : {}), ...(cast[w].wardrobe ? { wardrobe: cast[w].wardrobe } : {}) })) }, facts, { ...facts, people: who });
    });
    put(`e${n}-music`, 'music', { n, music: ep.music || series.tone });
    put(`e${n}`, 'cut', { n, shots: all.map(({ shot }) => shot.id), title: ep.title, notice: series.notice ?? NOTICE[String(series.language || '').toLowerCase()] ?? NOTICE.english });
  }
  const flow = { format: series.format || 'tall', ...(series.language ? { language: series.language } : {}), ...(series.accent ? { accent: series.accent } : {}), ...(series.resolution ? { resolution: series.resolution } : {}), ...(series.models ? { models: series.models } : {}), ...(typeof series.budget === 'number' ? { budget: series.budget } : {}), ...(Number.isInteger(series.retakes) ? { retakes: series.retakes } : {}), ...(typeof series.inspect === 'boolean' ? { inspect: series.inspect } : {}), nodes };
  return Object.defineProperty(flow, 'was', { value: was });
}

const bare = ({ by, as, of, xy, ...rest }) => rest;      // a node without the director's bookkeeping and its place on the canvas
// Brings flow.json up to the series and scripts. Returns { flow, added, updated, removed, kept, mended } — `kept` are nodes whose
// facts changed, or which the script no longer has, and which were left as they are because a person had changed them or
// something that stays still works from them. With `rewrite` every node still as the director wrote it is worded afresh (after
// an update of Songbe, to have its newer wording; what was made from those nodes is made again) — or, given a list of names,
// only those nodes.
//
// A cut is the one node whose making-of follows the script even after a person changed it (`mended`): their order, their trims
// and the clips they added stay; a shot the script lost leaves the cut, and a shot it gained goes in after the shot it follows.
export function sync(dir, series, scripts = {}, { rewrite = false } = {}) {
  const bad = [...checkSeries(series, dir), ...Object.entries(scripts).flatMap(([n, ep]) => checkEpisode(series, ep).map((x) => `episode ${n}: ${x}`))];
  if (bad.length) throw new Error(`the series has ${bad.length} problem${bad.length > 1 ? 's' : ''}:\n  - ` + bad.join('\n  - '));
  const flow = readFlow(dir), wanted = expand(series, scripts), added = [], updated = [], removed = [], kept = [], mended = [];
  const afresh = (id) => rewrite === true || (Array.isArray(rewrite) && rewrite.includes(id));
  const untouched = (have) => have.by === 'director' && have.as === sha(bare(have)), written = (node, have) => ({ ...node, by: 'director', as: sha(bare(node)), ...(have?.xy ? { xy: have.xy } : {}) });
  for (const [id, node] of Object.entries(wanted.nodes)) {
    const have = flow.nodes[id];
    if (!have) { flow.nodes[id] = written(node); added.push(id); continue; }
    if (have.by !== 'director') { kept.push(id); continue; }                                    // a node of the person's own under a name the director uses
    if (have.of === undefined) { have.of = node.of; continue; }                                 // written before nodes remembered their facts: taken as it stands
    if ((have.of === node.of || (wanted.was[id] || []).includes(have.of)) && !(afresh(id) && untouched(have))) continue;      // the same facts: its wording stays
    if (!untouched(have)) { kept.push(id); continue; }
    if (sha(bare(have)) !== sha(bare(node)) || have.of !== node.of) { flow.nodes[id] = written(node, have); updated.push(id); }
  }
  // what the script no longer has: a node still as the director wrote it goes, one a person changed stays
  const gone = Object.entries(flow.nodes).filter(([id, have]) => have.by === 'director' && !wanted.nodes[id]), leaving = new Set(gone.filter(([, have]) => untouched(have)).map(([id]) => id));
  for (const [id] of gone) if (!leaving.has(id)) kept.push(id);
  const clipOf = (s) => idOf(typeof s === 'string' ? s : s?.clip);
  for (const [id, node] of Object.entries(wanted.nodes)) {      // the cuts a person changed
    const have = flow.nodes[id];
    if (node.kind !== 'cut' || have?.kind !== 'cut' || !kept.includes(id) || !Array.isArray(have.shots)) continue;
    const order = node.shots.map(clipOf), shots = have.shots.filter((s) => !leaving.has(clipOf(s))), there = new Set(shots.map(clipOf));
    for (const c of order) if (added.includes(c) && !there.has(c)) { const before = order.slice(0, order.indexOf(c)).reverse().find((x) => there.has(x)); shots.splice(before ? shots.findIndex((s) => clipOf(s) === before) + 1 : 0, 0, '@' + c); there.add(c); }
    if (JSON.stringify(shots) !== JSON.stringify(have.shots)) { have.shots = shots; mended.push(id); }
  }
  // nothing that stays may be left working from a node that goes
  for (let again = true; again;) { again = false; for (const id of [...leaving]) if (Object.keys(flow.nodes).some((x) => !leaving.has(x) && needs(flow, x).includes(id))) { leaving.delete(id); kept.push(id); again = true; } }
  for (const id of leaving) { delete flow.nodes[id]; removed.push(id); }
  const { nodes, ...settings } = wanted;
  for (const k of ['format', 'language', 'accent', 'resolution', 'models', 'budget', 'retakes', 'inspect']) { if (settings[k] === undefined) delete flow[k]; else flow[k] = settings[k]; }
  writeFlow(dir, { ...Object.fromEntries(Object.entries(flow).filter(([k]) => k !== 'nodes')), nodes: flow.nodes });
  return { flow, added, updated, removed, kept, mended };
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
