// The film side: the canvas (flow.json), the run that makes what is missing and nothing else, the director that fills the canvas
// from a series, the writer, and the cut. The models are replaced by stand-ins that write small real files, so nothing is spent
// and what gets tested is the flow itself: what is made, from what, in which order, and what is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boardHtml } from '../src/film/board.mjs';
import { timeline } from '../src/film/cut.mjs';
import { expand, stageNodes, sync } from '../src/film/director.mjs';
import { checkFlow, look, needs, openStore, ordered, readFlow, runFlow, wordsOf, writeFlow } from '../src/film/flow.mjs';
import { KNOWN, chosen, fitSeconds, modelFor, reach, secondsOf } from '../src/film/models.mjs';
import { LEAD, TAIL, checkEpisode, checkSeries, lengthOf, readEpisode, readSeries, speechSeconds } from '../src/film/series.mjs';
import { castVoices, writeEpisode, writeSeries } from '../src/film/writer.mjs';
import { serve } from '../src/studio.mjs';
import { run, sha, tools } from '../src/util.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-film-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const fresh = (name) => { const d = path.join(scratch, name); fs.mkdirSync(d, { recursive: true }); return d; };
const ff = (...a) => run(tools.ffmpeg, ['-v', 'error', '-y', ...a]);

// Stand-ins for the models: each remembers what it was asked and writes a real, tiny file. "speaker" is a clip model that says the
// line itself and cannot act to a recording; every other clip model acts to the recording and returns it as the clip's sound.
function standIns({ refuse = null } = {}) {
  const asked = [];
  return { asked,
    modelFor: (role, named) => ({ name: named || `stand-in-${role === 'talk' ? 'clip' : role}`, door: 'none', id: 'x', known: { kind: role === 'talk' ? 'clip' : role, by: 'nobody', directed: true, voices: { female: { Ann: 'plain' }, male: { Bob: 'plain' } } } }),
    clipAbilities: async (r) => ({ seconds: { min: 1, max: 12, whole: true }, end: true, acts: r.name === 'speaker' ? false : 'keeps', speaks: r.name === 'speaker', sound: true }),
    makePicture: async (r, w, file) => { asked.push({ kind: 'picture', ...w }); if (refuse?.test(w.prompt)) throw new Error('the model refused'); ff('-f', 'lavfi', '-i', 'color=c=gray:s=180x320', '-frames:v', '1', '-q:v', '6', file); },
    makeVoice: async (r, w, file) => { asked.push({ kind: 'voice', ...w }); ff('-f', 'lavfi', '-t', String(Math.max(.6, w.text.split(/\s+/).length * .3)), '-i', 'sine=frequency=220:sample_rate=48000', file); },
    makeClip: async (r, w, file) => { asked.push({ kind: 'clip', model: r.name, ...w, heard: w.voice ? secondsOf(w.voice) : null });
      ff('-f', 'lavfi', '-t', String(w.seconds), '-i', 'testsrc2=s=180x320:r=24', '-f', 'lavfi', '-t', String(w.seconds), '-i', 'sine=frequency=330:sample_rate=48000', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file); },
    makeMusic: async (r, w, file) => { asked.push({ kind: 'music', ...w }); ff('-f', 'lavfi', '-t', '6', '-i', 'sine=frequency=110:sample_rate=44100', '-b:a', '64k', file); } };
}
// a canvas small enough to follow by eye: a note, a person with a face and a sheet, one shot with a line, music, and the cut
const small = () => ({ format: 'tall', language: 'Vietnamese', nodes: {
  look: { kind: 'text', text: 'Soft window light.' },
  lan: { kind: 'person', name: 'Lan', look: 'short black hair', wardrobe: 'a yellow cardigan', voice: { voice: 'Ann' } },
  'lan-face': { kind: 'picture', prompt: '@look Portrait of @lan.', aspect: '3:4' },
  'lan-sheet': { kind: 'picture', prompt: 'A reference sheet of the person in @lan-face.' },
  's1-frame': { kind: 'picture', prompt: '@lan-sheet is the sheet of @lan. Close-up of @lan at a table. @look' },
  's1-line': { kind: 'voice', who: '@lan', text: 'Anh về rồi à?', how: 'quiet' },
  s1: { kind: 'clip', frame: '@s1-frame', voice: '@s1-line', prompt: 'Close-up, static. Lan looks up.' },
  s2: { kind: 'clip', frame: '@s1-frame', prompt: 'Wide, static. The room is empty.', seconds: 2 },
  music: { kind: 'music', prompt: 'Sparse piano.' },
  film: { kind: 'cut', shots: ['@s1', { clip: '@s2', to: 1.5 }], music: '@music', title: 'Tập 1', notice: 'Nội dung tạo bằng AI' } } });
const madeOf = (r) => [...r.made].sort().join(' ');

test('what is wrong with a canvas is said in words', () => {
  assert.deepEqual(checkFlow(small()), []);
  const bad = (change) => { const f = small(); change(f.nodes, f); return checkFlow(f).join('\n'); };
  assert.match(bad((n) => { n.x = { kind: 'movie' }; }), /x: its kind "movie" is not one of/);
  assert.match(bad((n) => { delete n['lan-face'].prompt; }), /lan-face: a picture needs "prompt" or "file" or "grab"/);
  assert.match(bad((n) => { n.s1.prompt += ' @nobody'; }), /s1: it mentions @nobody, and there is no such node/);
  assert.match(bad((n) => { n.s1.frame = '@s1-line'; }), /s1\.frame: must name a picture node/);
  assert.match(bad((n) => { n.s1.voice = '@lan-face'; }), /s1\.voice: must name a voice node/);
  assert.match(bad((n) => { n['lan-face'].prompt += ' as in @s1'; }), /a picture can only be made from pictures, and @s1 is a clip/);
  assert.match(bad((n) => { n['lan-face'].prompt += ' like @lan-sheet'; }), /lan-face → lan-sheet → lan-face: these nodes work from each other in a circle/);
  assert.match(bad((n) => { n.film.shots = ['@music']; }), /film\.shots\[0\]: "@music" is not a clip node/);
  assert.match(bad((n) => { n.s2.colour = 'red'; }), /s2: a clip has no "colour"/);
  assert.match(bad((n, f) => { f.format = 'round'; }), /format: "round" is not one of/);
  assert.equal(bad((n) => { n.note = { kind: 'text', text: 'write to me @@ home' }; }), '');
});

test('a prompt as the model reads it: notes put in, people described once, pictures numbered in the order they are mentioned', () => {
  const f = small(); f.nodes.mood = { kind: 'text', text: '@look Nobody smiles.' };
  const got = (id) => ({ file: `/takes/${id}.jpg`, take: id + '-1' });
  const w = wordsOf(f, '@mood @lan-sheet is the sheet of @lan; @lan-face is her face. Draw @lan as in @lan-sheet. Mail @@ home.', got);
  assert.equal(w.words, 'Soft window light. Nobody smiles. image 1 is the sheet of Lan (short black hair; wearing a yellow cardigan); image 2 is her face. Draw Lan as in image 1. Mail @ home.');
  assert.deepEqual(w.files.map((x) => x.id), ['lan-sheet', 'lan-face']);
  assert.deepEqual(needs(f, 's1').sort(), ['s1-frame', 's1-line']); assert.deepEqual(needs(f, 'film').sort(), ['music', 's1', 's1-line', 's2']);
  const order = ordered(f); for (const id of order) for (const d of needs(f, id)) assert.ok(order.indexOf(d) < order.indexOf(id), `${d} before ${id}`);
});

test('a run makes everything once, in order, each thing from what it names — and a second run makes nothing', async () => {
  const dir = fresh('run'), flow = small(), use = standIns(), events = [];
  const first = await runFlow(dir, flow, { use, on: (e) => events.push(`${e.type} ${e.id}`) });
  assert.equal(madeOf(first), 'film lan-face lan-sheet music s1 s1-frame s1-line s2'); assert.deepEqual(first.failed, []);
  const asked = (kind, part) => use.asked.find((a) => a.kind === kind && a.prompt?.includes(part));
  assert.equal(asked('picture', 'Portrait').prompt, 'Soft window light. Portrait of Lan (short black hair; wearing a yellow cardigan).'); assert.equal(asked('picture', 'Portrait').aspect, '3:4');
  assert.deepEqual(asked('picture', 'reference sheet').refs, [first.out.get('lan-face').file]);
  assert.equal(asked('picture', 'Close-up').aspect, '9:16', 'a picture without a shape of its own has the frame\'s');
  const line = use.asked.find((a) => a.kind === 'voice'); assert.equal(line.voice, 'Ann'); assert.match(line.style, /Language: Vietnamese\.\nSpeaker: Lan\.\nDelivery: quiet\./);
  // the shot with a line: the actor is handed the recording (a breath of silence, the line, silence to the end) and told the words
  const talk = use.asked.find((a) => a.kind === 'clip' && a.voice), said = secondsOf(first.out.get('s1-line').file);
  assert.equal(talk.frame, first.out.get('s1-frame').file); assert.equal(talk.seconds, Math.ceil(LEAD + said + TAIL)); assert.ok(Math.abs(talk.heard - Math.max(2, talk.seconds)) < .06);
  assert.match(talk.prompt, /^Close-up, static\. Lan looks up\. Lan speaks \(quiet\), saying: "Anh về rồi à\?" The lips move with the words\. Nobody else speaks\. No subtitles/);
  assert.match(use.asked.find((a) => a.kind === 'clip' && !a.voice).prompt, /Nobody in the frame speaks; lips stay closed\./);
  assert.ok(events.indexOf('done lan-face') < events.indexOf('start lan-sheet') && events.indexOf('done s1-line') < events.indexOf('start s1'));
  // the cut: both shots, the second one trimmed, a subtitle where the line is
  const film = first.out.get('film').file, laid = JSON.parse(fs.readFileSync(film.replace(/\.mp4$/, '.json'), 'utf8'));
  assert.equal(laid.parts.length, 2); assert.equal(laid.parts[1].length, 1.5); assert.ok(Math.abs(secondsOf(film) - laid.seconds) < .12);
  assert.match(fs.readFileSync(film.replace(/\.mp4$/, '.srt'), 'utf8'), /^1\n00:00:00,300 --> 00:00:0\d,\d{3}\nAnh về rồi à\?\n$/);
  const seen = JSON.parse(run(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', film])).streams;
  assert.deepEqual([seen.find((s) => s.codec_type === 'video').width, seen.find((s) => s.codec_type === 'video').height], [1080, 1920]); assert.ok(seen.some((s) => s.codec_type === 'audio'));

  const n = use.asked.length, again = await runFlow(dir, flow, { use });
  assert.deepEqual(again.made, []); assert.equal(again.ready.length, 8); assert.equal(use.asked.length, n, 'nothing was asked of any model');
  assert.ok((await look(dir, flow, { use })).filter((r) => r.state !== 'words').every((r) => r.state === 'ready'));
});

test('changing one thing leaves exactly what works from it to be made again; takes are kept and can be chosen or held', async () => {
  const dir = fresh('change'), flow = small(), use = standIns();
  await runFlow(dir, flow, { use });
  flow.nodes['s1-line'].text = 'Anh về rồi à? Em chờ mãi.';
  assert.deepEqual((await look(dir, flow, { use })).filter((r) => r.state === 'make' || r.state === 'wait').map((r) => `${r.id} ${r.state}`), ['s1-line make', 's1 wait', 'film wait']);
  assert.equal(madeOf(await runFlow(dir, flow, { use })), 'film s1 s1-line');
  // another take of the face: a new picture, and everything drawn from it follows
  const retake = await runFlow(dir, flow, { use, again: ['lan-face'] });
  assert.equal(madeOf(retake), 'film lan-face lan-sheet s1 s1-frame s2');
  const face = (await look(dir, flow, { use })).find((r) => r.id === 'lan-face'); assert.equal(face.n, 2); assert.equal(face.takes, 2);
  // back to the first take: what was made from it is still there, so nothing is asked for again
  const store = openStore(dir); store.pick('lan-face', face.take.slice(0, face.take.lastIndexOf('-')), 1);
  const n = use.asked.length, back = await runFlow(dir, flow, { use }); assert.deepEqual(back.made, []); assert.equal(use.asked.length, n);
  // a held take stays whatever is asked for now
  const s2 = (await look(dir, flow, { use })).find((r) => r.id === 's2'); openStore(dir).hold('s2', s2.take.slice(0, s2.take.lastIndexOf('-')), s2.n); flow.nodes.s2.prompt = 'Wide, static. Rain on the window.';
  assert.equal((await look(dir, flow, { use })).find((r) => r.id === 's2').state, 'held'); assert.deepEqual((await runFlow(dir, flow, { use })).made, []);
  openStore(dir).release('s2'); assert.equal(madeOf(await runFlow(dir, flow, { use })), 'film s2');
});

test('a node that fails is reported, what needs it is not attempted, and everything else is still made', async () => {
  const dir = fresh('fail'), flow = small(), use = standIns({ refuse: /reference sheet/ });
  const r = await runFlow(dir, flow, { use });
  assert.equal(madeOf(r), 'lan-face music s1-line');
  assert.deepEqual(r.failed.map((f) => f.id), ['lan-sheet', 's1-frame', 's1', 's2', 'film']); assert.equal(r.failed[0].error, 'the model refused'); assert.match(r.failed[1].error, /needs lan-sheet/);
  assert.equal(madeOf(await runFlow(dir, flow, { use: standIns() })), 'film lan-sheet s1 s1-frame s2', 'the next run picks up where this one stopped');
  await assert.rejects(runFlow(dir, { nodes: { a: { kind: 'picture' } } }, { use }), /flow\.json has 1 problem/);
});

test('a line can be acted to, spoken by the model itself, or only heard — and a file of your own stands in for any node', async () => {
  const dir = fresh('ways'), flow = small(), use = standIns();
  fs.mkdirSync(path.join(dir, 'media')); ff('-f', 'lavfi', '-i', 'color=c=blue:s=90x160', '-frames:v', '1', path.join(dir, 'media', 'me.jpg'));
  flow.nodes['lan-face'] = { kind: 'picture', file: 'media/me.jpg' };
  flow.nodes.s1.model = 'speaker';                                   // says the line itself
  flow.nodes.s3 = { kind: 'clip', frame: '@s1-frame', voice: '@s1-line', heard: true, prompt: 'Medium. A man listens.' };      // the voice comes from off screen
  flow.nodes['s3-end'] = { kind: 'picture', grab: '@s3' }; flow.nodes.film.shots.push('@s3');
  const r = await runFlow(dir, flow, { use });
  assert.ok(!r.made.includes('lan-face')); assert.equal(use.asked.find((a) => a.prompt?.includes('reference sheet')).refs[0], path.join(dir, 'media', 'me.jpg'));
  const spoken = use.asked.find((a) => a.kind === 'clip' && a.model === 'speaker'); assert.equal(spoken.voice, null); assert.match(spoken.prompt, /Lan says in Vietnamese \(quiet\): "Anh về rồi à\?"/);
  const over = use.asked.find((a) => a.kind === 'clip' && a.prompt.startsWith('Medium')); assert.equal(over.voice, null); assert.match(over.prompt, /Nobody in the frame speaks/);
  const laid = JSON.parse(fs.readFileSync(r.out.get('film').file.replace(/\.mp4$/, '.json'), 'utf8')).parts;
  assert.deepEqual(laid.map((p) => p.how), ['native', 'plain', 'over']); assert.ok(laid[2].line[0] - laid[2].start - LEAD < .01, 'the heard line starts a breath into its shot');
  assert.ok(fs.statSync(r.out.get('s3-end').file).size > 200, 'a frame taken from a clip');
  fs.rmSync(path.join(dir, 'media', 'me.jpg')); assert.match(checkFlow(flow, dir).join('\n'), /lan-face: the file media\/me\.jpg is not there/);
});

// ---- the director and the writer ----
const SERIES = { title: 'Hai giờ sáng', language: 'Vietnamese', format: 'tall', style: 'Photorealistic live action.', look: 'Cold blue moonlight, deep shadows', accent: 'Southern Vietnamese (Saigon) accent', seconds: 20,
  cast: { lan: { name: 'Lan', gender: 'female', look: '26, slim, a black bob', wardrobe: 'a beige blouse', manner: 'speaks softly', voice: { voice: 'Kore' } }, minh: { name: 'Minh', gender: 'male', look: '31, broad shoulders', wardrobe: 'a navy shirt', voice: { voice: 'Charon' } } },
  places: { 'can-ho': { name: 'Căn hộ', look: 'a small living room with a grey sofa and glass balcony doors' } }, episodes: [{ title: 'Hai giờ sáng', summary: 'Lan bắt gặp Minh rời nhà.' }, { title: 'Cánh cửa', summary: 'Lan đi theo.' }] };
const EPISODE = { title: 'Hai giờ sáng', summary: 'Lan bắt gặp Minh rời nhà.', music: 'A slow cello, 60 BPM.', scenes: [{ where: 'can-ho', time: '2 AM, moonlight', staging: 'Lan stands on the left by the hallway. Minh stands in the middle, facing the balcony doors.', shots: [
  { id: '1', size: 'close', camera: 'static', who: ['lan'], action: 'Lan stares from the shadows.', line: { who: 'lan', text: 'Lại hai giờ sáng. Anh đi đâu vậy?', how: 'whispering' }, sound: 'a ticking clock' },
  { id: '2', size: 'medium', camera: 'slow push in', who: ['minh'], action: 'Minh stands with his back to the camera.', seconds: 3 },
  { id: '3', size: 'close', who: ['minh'], action: 'Minh listens without turning.', line: { who: 'lan', text: 'Minh?', how: 'quietly' } },
  { id: '4', size: 'close', who: ['minh'], action: 'Minh lowers his head.', continues: true, seconds: 2 }] }] };
const scripted = (...replies) => { const asked = []; const ask = async (q) => { asked.push(q); const r = replies[Math.min(asked.length, replies.length) - 1]; return typeof r === 'string' ? r : JSON.stringify(r); }; return { ask, asked }; };

test('a series and its script are checked in words, and timed by how long the lines take to say', () => {
  assert.deepEqual(checkSeries(SERIES), []); assert.deepEqual(checkEpisode(SERIES, EPISODE), []);
  const series = (change) => { const s = structuredClone(SERIES); change(s); return checkSeries(s).join('\n'); }, script = (change) => { const e = structuredClone(EPISODE); change(e.scenes[0], e); return checkEpisode(SERIES, e).join('\n'); };
  assert.match(series((s) => { delete s.look; }), /look: describe how the pictures look/); assert.match(series((s) => { s.cast.look = s.cast.lan; }), /cast\.look: "look" is a name the canvas uses itself/);
  assert.match(series((s) => { s.places.lan = s.places['can-ho']; }), /places\.lan: "lan" already names someone in the cast/); assert.match(series((s) => { delete s.cast.minh.look; }), /cast\.minh: needs a "look"/);
  assert.match(script((sc) => { sc.where = 'beach'; }), /scenes\[0\]\.where: "beach" is not one of the places \(can-ho\)/); assert.match(script((sc) => { sc.shots[1].who = ['tam']; }), /shots\[1\]\.who: "tam" is not in the cast/);
  assert.match(script((sc) => { sc.shots[1].size = 'huge'; }), /shots\[1\]\.size: "huge" is not one of wide, full/); assert.match(script((sc) => { sc.shots[2].id = '1'; }), /shots\[2\]\.id: "1" names two shots/);
  assert.match(script((sc) => { sc.shots[0].continues = true; }), /the first shot of a scene has nothing to continue from/); assert.match(script((sc) => { delete sc.staging; }), /staging: say where everyone is/);
  assert.match(script((sc) => { sc.shots[0].line.text = 'Em nói mãi '.repeat(20); }), /seconds of speech is too long for one shot/);
  assert.ok(speechSeconds('Lại hai giờ sáng. Anh đi đâu vậy?', 'Vietnamese') > 1.8 && speechSeconds('Lại hai giờ sáng. Anh đi đâu vậy?', 'Vietnamese') < 3);
  assert.equal(lengthOf({ seconds: 3 }), 3); assert.equal(lengthOf({}), 4); assert.equal(lengthOf({}, 2), +(LEAD + 2 + TAIL).toFixed(2)); assert.equal(lengthOf({ seconds: 6 }, 2), 6);
});

test('the director fills the canvas: everyone a face and a sheet, every scene a wide picture, every shot a frame, a line and a clip', () => {
  const flow = expand(SERIES, { 1: EPISODE }), n = flow.nodes;
  assert.deepEqual(checkFlow(flow), []); assert.equal(flow.language, 'Vietnamese'); assert.equal(flow.accent, SERIES.accent);
  assert.deepEqual(Object.keys(n), ['style', 'look', 'lan', 'lan-face', 'lan-sheet', 'minh', 'minh-face', 'minh-sheet', 'can-ho', 'can-ho-plate', 'e1-scene1', 'e1-s1-frame', 'e1-s1-line', 'e1-s1', 'e1-s2-frame', 'e1-s2', 'e1-s3-frame', 'e1-s3-line', 'e1-s3', 'e1-s4-frame', 'e1-s4', 'e1-music', 'e1']);
  assert.equal(n.look.text, '@style Cold blue moonlight, deep shadows.'); assert.match(n['lan-face'].prompt, /^@style Portrait of @lan\./); assert.match(n['lan-sheet'].prompt, /the person in @lan-face.*every view wears a beige blouse/);
  assert.deepEqual(needs(flow, 'e1-scene1').sort(), ['can-ho-plate', 'lan-sheet', 'minh-sheet']); assert.deepEqual(needs(flow, 'e1-s1-frame').sort(), ['e1-scene1', 'lan-sheet']);
  assert.match(n['e1-s1-frame'].prompt, /In the frame: Lan; Minh is outside the frame\. Lan's mouth is closed, about to speak\./);
  assert.deepEqual([n['e1-s1'].voice, n['e1-s1'].heard, n['e1-s3'].heard, n['e1-s2'].seconds], ['@e1-s1-line', undefined, true, 3], 'a line whose speaker is not in the frame is heard, not seen');
  const { of, ...grabbed } = n['e1-s4-frame']; assert.deepEqual(grabbed, { kind: 'picture', grab: '@e1-s3', at: 'end', group: 'e1', label: 'Shot 4: first frame (where shot 3 ends)' }); assert.match(of, /^[0-9a-f]{16}$/);
  assert.equal(n['e1-s1'].prompt, 'Close-up, static. Lan stares from the shadows. Sound: a ticking clock. @look'); assert.deepEqual(n.e1.shots, ['@e1-s1', '@e1-s2', '@e1-s3', '@e1-s4']); assert.equal(n.e1.notice, 'Nội dung tạo bằng AI');
  // a part of the work: the board is every picture that needs no clip
  assert.deepEqual(stageNodes(flow, 1, 'cast'), ['lan-face', 'lan-sheet', 'minh-face', 'minh-sheet', 'can-ho-plate']);
  assert.deepEqual(stageNodes(flow, 1, 'board').slice(5), ['e1-scene1', 'e1-s1-frame', 'e1-s2-frame', 'e1-s3-frame']); assert.ok(stageNodes(flow, 1, 'cut').includes('e1')); assert.throws(() => stageNodes(flow, 1, 'later'), /is not one of cast, board/);
  assert.match(boardHtml(flow, [], { title: 'T' }), /<b>Lan<\/b> · voice Kore[\s\S]*Episode 1: Hai giờ sáng[\s\S]*<b>Lan \(off screen\):<\/b> Minh\?/);
});

test('the director rewrites only what is still as it wrote it: a node changed by hand is left alone, and said to be', () => {
  const dir = fresh('sync');
  const first = sync(dir, SERIES, { 1: EPISODE }); assert.equal(first.added.length, 23); assert.deepEqual(sync(dir, SERIES, { 1: EPISODE }).added.concat(sync(dir, SERIES, { 1: EPISODE }).updated), []);
  const flow = readFlow(dir); flow.nodes['e1-s2'].model = 'veo-3.1-fast'; flow.nodes.rain = { kind: 'picture', prompt: 'Rain on glass.' }; writeFlow(dir, flow);
  const changed = structuredClone(EPISODE); changed.scenes[0].shots[1].action = 'Minh turns around.'; changed.scenes[0].shots[0].line.text = 'Anh đi đâu vậy?'; changed.scenes[0].shots.pop();
  const second = sync(dir, SERIES, { 1: changed });
  assert.deepEqual(second.updated.sort(), ['e1', 'e1-s1-line', 'e1-s2-frame']); assert.deepEqual(second.removed.sort(), ['e1-s4', 'e1-s4-frame']); assert.deepEqual(second.kept, ['e1-s2']);
  const now = readFlow(dir).nodes; assert.equal(now['e1-s2'].model, 'veo-3.1-fast'); assert.match(now['e1-s2'].prompt, /his back to the camera/, 'the clip changed by hand keeps its words too'); assert.ok(now.rain, 'a node added by hand is never touched');
  assert.throws(() => sync(dir, { ...SERIES, look: '' }, {}), /the series has 1 problem/);
  // a film made with an older Songbe keeps the words its nodes were written in: only changed facts rewrite a node
  const old = readFlow(dir), bare = ({ by, as, of, xy, ...rest }) => rest; old.nodes['lan-face'].prompt = 'Portrait of @lan, as an older version worded it.'; old.nodes['lan-face'].as = sha(bare(old.nodes['lan-face'])); delete old.nodes['minh-face'].of; writeFlow(dir, old);
  assert.deepEqual(sync(dir, SERIES, { 1: changed }).updated, []); assert.match(readFlow(dir).nodes['lan-face'].prompt, /as an older version worded it/); assert.match(readFlow(dir).nodes['minh-face'].of, /^[0-9a-f]{16}$/, 'a node from before the marks is taken as it stands');
  const renamed = structuredClone(SERIES); renamed.cast.lan.wardrobe = 'a red coat'; assert.deepEqual(sync(dir, renamed, { 1: changed }).updated.sort(), ['lan', 'lan-sheet'], 'what the face is written from did not change');
  assert.deepEqual(sync(dir, renamed, { 1: changed }, { rewrite: true }).updated, ['lan-face']); assert.match(readFlow(dir).nodes['lan-face'].prompt, /^@style Portrait of @lan\./);
});

test('the writer drafts a series and a script, and is handed back what the checks find', async () => {
  const dir = fresh('write'), env = { GEMINI_API_KEY: 'x' }, draft = { title: SERIES.title, logline: 'Một bí mật.', style: SERIES.style, look: SERIES.look, accent: SERIES.accent, cast: structuredClone(SERIES.cast), places: SERIES.places, episodes: SERIES.episodes };
  draft.cast.minh.voice = { voice: 'Kore', style: 'low' };                  // the same voice as Lan: one of them gets another
  const noLook = { ...draft, look: '' }, model = scripted('Here you are: ' + JSON.stringify(noLook), draft);
  const s = await writeSeries(dir, 'Lan phát hiện chồng rời nhà lúc hai giờ sáng.', { episodes: 2, seconds: 12, ask: model.ask, env });
  assert.equal(s.rounds, 2); assert.match(model.asked[1].prompt, /YOUR PREVIOUS DRAFT[\s\S]*- look: describe how the pictures look/); assert.match(model.asked[0].system, /voice\.voice: the voice that suits the person[\s\S]*Gacrux \(mature\)/);
  const saved = readSeries(dir); assert.equal(saved.language, 'Vietnamese'); assert.deepEqual(saved.models, chosen(env)); assert.deepEqual([saved.cast.lan.voice.voice, saved.cast.minh.voice.voice], ['Kore', 'Charon']); assert.equal(saved.cast.minh.voice.style, 'low');
  await assert.rejects(writeSeries(dir, 'Lan phát hiện chồng rời nhà lúc hai giờ sáng.', { ask: model.ask, env }), /already has a series\.json/); await assert.rejects(writeSeries(fresh('nokey'), 'Lan phát hiện chồng rời nhà.', { env: {} }), /needs a key/);
  await assert.rejects(writeSeries(fresh('few'), 'Lan phát hiện chồng rời nhà lúc hai giờ sáng.', { episodes: 3, ask: scripted(draft).ask, env, rounds: 1 }), /episodes: there are 2, and 3 were asked for/);

  const stranger = structuredClone(EPISODE); stranger.scenes[0].shots[1].who = ['tam'];
  const writer = scripted(stranger, EPISODE), e = await writeEpisode(dir, saved, 1, { ask: writer.ask, env });
  assert.equal(e.rounds, 2); assert.match(writer.asked[1].prompt, /"tam" is not in the cast/); assert.deepEqual(readEpisode(dir, 1).scenes, EPISODE.scenes); assert.ok(e.seconds > 7 && e.seconds < 17);
  const next = scripted(EPISODE); await writeEpisode(dir, saved, 2, { ask: next.ask, env });
  assert.match(next.asked[0].prompt, /THE STORY SO FAR\nEpisode 1: Hai giờ sáng\.[\s\S]*It ended on: [\s\S]*WRITE EPISODE 2 OF 2: Cánh cửa[\s\S]*\(This is the last episode\.\)/);
  await assert.rejects(writeEpisode(dir, saved, 3, { ask: next.ask, env }), /the series has no episode 3/); await assert.rejects(writeEpisode(dir, saved, 1, { ask: next.ask, env }), /already has a script/);
  const long = structuredClone(EPISODE); for (let i = 5; i < 30; i++) long.scenes[0].shots.push({ id: String(i), size: 'close', who: ['lan'], action: 'Lan waits.', seconds: 5 });
  await assert.rejects(writeEpisode(fresh('long'), saved, 1, { ask: scripted(long).ask, env, rounds: 1 }), /the episode runs about \d+ seconds; bring it to about 12/);
});

test('a model is reached at its maker when that key is set and through fal.ai otherwise; anything else is named by its door', () => {
  assert.deepEqual([reach('veo-3.1', { GEMINI_API_KEY: 'g', FAL_KEY: 'f' }).door, reach('veo-3.1', { FAL_KEY: 'f' }).door, reach('hailuo-h3', { GEMINI_API_KEY: 'g', FAL_KEY: 'f' }).door], ['google', 'fal', 'fal']);
  assert.throws(() => reach('hailuo-h3', { GEMINI_API_KEY: 'g' }), /hailuo-h3 needs FAL_KEY/); assert.throws(() => reach('veo-3.1', {}), /veo-3\.1 needs GEMINI_API_KEY or FAL_KEY/); assert.throws(() => reach('sora', { FAL_KEY: 'f' }), /no model is called "sora"/);
  assert.deepEqual(reach('fal:some/new/endpoint', { FAL_KEY: 'f' }), { name: 'fal:some/new/endpoint', door: 'fal', id: 'some/new/endpoint', known: null }); assert.throws(() => reach('google:veo-9', {}), /google:veo-9 needs GEMINI_API_KEY/);
  assert.equal(reach('hailuo-h3', {}, false).door, 'fal', 'looked at without its key'); assert.equal(modelFor('clip', null, {}, false).name, 'hailuo-h3');
  assert.deepEqual(chosen({ GEMINI_API_KEY: 'g' }), { picture: 'nano-banana-2.1', clip: 'veo-3.1-fast', talk: 'veo-3.1-fast', voice: 'gemini-tts', music: 'lyria-3.5' });
  assert.deepEqual(chosen({ FAL_KEY: 'f' }), { picture: 'nano-banana-2.1', clip: 'hailuo-h3', talk: 'hailuo-h3', voice: 'gemini-tts', music: 'lyria-2' }); assert.deepEqual(chosen({}), {});
  assert.throws(() => modelFor('voice', 'veo-3.1', { GEMINI_API_KEY: 'g' }), /veo-3\.1 makes a clip, not a voice/); assert.throws(() => modelFor('clip', null, {}), /nothing can make a clip with the keys that are set/);
  for (const [name, m] of Object.entries(KNOWN)) assert.ok(['picture', 'clip', 'voice', 'music'].includes(m.kind) && (m.google || m.fal), name);
  assert.deepEqual([fitSeconds({ seconds: { min: 5, max: 15, whole: true } }, 2.2), fitSeconds({ seconds: { min: 5, max: 15, whole: true } }, 6.1), fitSeconds({ seconds: { options: [4, 6, 8] } }, 4.6), fitSeconds({ seconds: { options: [4, 6, 8] } }, 11), fitSeconds({ seconds: { min: .92, max: 15 } }, 3.456), fitSeconds({}, 3)], [5, 7, 6, 8, 3.46, 3]);
  const cast = castVoices({ models: { voice: 'minimax-speech' }, cast: { a: { gender: 'male' }, b: { gender: 'male', voice: { voice: 'Kore' } } } }, { FAL_KEY: 'f' }).cast; assert.deepEqual([cast.a.voice.voice, cast.b.voice.voice], ['Casual_Guy', 'Patient_Man'], 'a voice of another model is replaced by one of this model');
});

test('the timeline of a cut: every part where it falls, each line a breath into its shot', () => {
  const dir = fresh('timeline'), clip = path.join(dir, 'c.mp4'), line = path.join(dir, 'l.wav');
  ff('-f', 'lavfi', '-t', '5', '-i', 'testsrc2=s=90x160:r=24', '-pix_fmt', 'yuv420p', clip); ff('-f', 'lavfi', '-t', '1.5', '-i', 'sine=frequency=220:sample_rate=48000', line);
  const rows = timeline([{ id: 'a', file: clip, info: { how: 'voice', length: 2.3 }, voice: line, text: 'Một' }, { id: 'b', file: clip, info: { how: 'plain', length: 6 } }, { id: 'c', file: clip, from: 1, to: 2.5, info: { how: 'native', length: null }, text: 'Hai' }, { id: 'd', file: clip }]);
  assert.deepEqual(rows.map((r) => [r.start, r.end, r.pad]), [[0, 2.3, 0], [2.3, 8.3, 1], [8.3, 9.8, 0], [9.8, 14.8, 0]]);
  assert.deepEqual(rows[0].line, [LEAD, 1.95]); assert.equal(rows[1].line, null); assert.deepEqual(rows[2].line, [8.5, 9.65], 'a line the model spoke itself is shown for the whole of its shot');
});

test('the canvas window is handed the nodes, what stands for each and the lines between them, and keeps only changes that leave the canvas sound', async () => {
  const dir = fresh('canvas'), home = fresh('canvas-home');
  fs.mkdirSync(path.join(dir, 'media')); ff('-f', 'lavfi', '-i', 'color=c=blue:s=90x160', '-frames:v', '1', path.join(dir, 'media', 'me.jpg'));
  writeFlow(dir, { format: 'tall', nodes: { look: { kind: 'text', text: 'Soft light.' }, lan: { kind: 'person', name: 'Lan' }, 'lan-face': { kind: 'picture', file: 'media/me.jpg' }, 'lan-sheet': { kind: 'picture', prompt: 'A sheet of the person in @lan-face. @look', by: 'director', as: 'a', of: 'b' } } });
  const s = await serve({ port: 0, film: dir, home }), origin = s.url.replace(/\/$/, '');
  try {
    const front = await fetch(s.url, { redirect: 'manual' }), where = front.headers.get('location'); assert.equal(front.status, 302); assert.match(where, /^\/c\/[0-9a-f]{16}\/$/);
    const at = origin + where.replace(/\/$/, ''), get = (p) => fetch(at + p).then((r) => r.json()), send = (p, method, body) => fetch(at + p, { method, headers: { 'X-Songbe': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
    assert.match(await fetch(at + '/').then((r) => r.text()), /id="board"/);
    const st = await get('/api/state');
    assert.deepEqual(st.rows.map((r) => `${r.id} ${r.state}`), ['look words', 'lan words', 'lan-face own', 'lan-sheet make']); assert.deepEqual(st.edges, [['lan-face', 'lan-sheet']]);
    assert.equal(st.rows[3].recipe.prompt, 'A sheet of the person in image 1. Soft light.', 'the prompt as the model will read it'); assert.equal(st.models.known['hailuo-h3'].acts, true);
    assert.equal((await fetch(origin + st.rows[2].url)).status, 200); assert.equal((await fetch(at + '/file?p=' + encodeURIComponent('/etc/passwd'))).status, 404, 'only files of the film are served');
    assert.equal((await fetch(at + '/api/node?id=x', { method: 'PUT', body: '{}' })).status, 403, 'a change needs the header a foreign page cannot send');
    const unsound = await send('/api/node?id=rain', 'PUT', { kind: 'picture', prompt: 'Like @nobody.' }); assert.equal(unsound.saved, false); assert.match(unsound.bad[0], /it mentions @nobody/); assert.ok(!readFlow(dir).nodes.rain);
    const kept = await send('/api/node?id=rain', 'PUT', { kind: 'picture', prompt: 'Rain on glass. @look', by: 'director', as: 'x' }); assert.equal(kept.saved, true); assert.deepEqual(readFlow(dir).nodes.rain, { kind: 'picture', prompt: 'Rain on glass. @look' }, 'the director\'s marks are not the page\'s to set');
    await send('/api/node?id=lan-sheet', 'PUT', { kind: 'picture', prompt: 'A sheet of @lan as in @lan-face.' }); assert.deepEqual([readFlow(dir).nodes['lan-sheet'].by, readFlow(dir).nodes['lan-sheet'].of], ['director', 'b'], 'and those it has stay');
    assert.match((await send('/api/node?id=Bad Name', 'PUT', { kind: 'text', text: 'x' })).error, /lower-case letters/);
    assert.match((await send('/api/delete', 'POST', { id: 'lan-face' })).error, /lan-sheet works from it/); assert.match((await send('/api/delete', 'POST', { id: 'lan' })).error, /lan-sheet works from it/, 'a person is in use where a prompt mentions them');
    assert.equal((await send('/api/delete', 'POST', { id: 'rain' })).saved, true); assert.ok(!readFlow(dir).nodes.rain);
    await send('/api/place', 'POST', { lan: [120.4, 40], nobody: [1, 2] }); assert.deepEqual(readFlow(dir).nodes.lan.xy, [120, 40]);
    assert.match((await send('/api/pick', 'POST', { id: 'lan-sheet', n: 1 })).error, /no take yet/); assert.deepEqual((await get('/api/takes?id=lan-sheet')).takes, []);
  } finally { s.close(); }
});
