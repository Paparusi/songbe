// The film side: the canvas (flow.json), the run that makes what is missing and nothing else, the director that fills the canvas
// from a series, the writer, and the cut. The models are replaced by stand-ins that write small real files, so nothing is spent
// and what gets tested is the flow itself: what is made, from what, in which order, and what is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { boardHtml } from '../src/film/board.mjs';
import { timeline } from '../src/film/cut.mjs';
import { expand, stageNodes, sync } from '../src/film/director.mjs';
import { checkFlow, estimate, look, needs, openStore, ordered, readFlow, runFlow, wordsOf, writeFlow } from '../src/film/flow.mjs';
import { KNOWN, chosen, costOf, fitSeconds, modelFor, reach, secondsOf } from '../src/film/models.mjs';
import { grave, inWords, reviewClip, reviewFit, reviewPicture, reviewVoice } from '../src/film/review.mjs';
import { LEAD, TAIL, checkEpisode, checkSeries, episodeFile, lengthOf, readEpisode, readSeries, seriesFile, speechSeconds, writeJson, written } from '../src/film/series.mjs';
import { layLine, speechSpans, spokenPart } from '../src/film/speech.mjs';
import { castVoices, writeEpisode, writeSeries } from '../src/film/writer.mjs';
import { serve } from '../src/studio.mjs';
import { run, sha, tools } from '../src/util.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-film-'));
process.env.SONGBE_DATA = path.join(scratch, 'data');      // the app's own files (its list of recent projects, saved keys) are this test's, not this computer's
delete process.env.FAL_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.GROQ_API_KEY;
test.after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const fresh = (name) => { const d = path.join(scratch, name); fs.mkdirSync(d, { recursive: true }); return d; };
const ff = (...a) => run(tools.ffmpeg, ['-v', 'error', '-y', ...a]);

// Stand-ins for the models: each remembers what it was asked and writes a real, tiny file. "speaker" is a clip model that says the
// line itself and cannot act to a recording (its clip has a voice from 1.0 s to 2.2 s and is silent otherwise); every other clip
// model acts to the recording and returns it as the clip's sound.
function standIns({ refuse = null } = {}) {
  const asked = [];
  return { asked,
    // list prices of the stand-ins: a picture 5 cents, a second of clip 10 cents, a thousand characters spoken 4.5 cents; music has none
    modelFor: (role, named) => ({ name: named || `stand-in-${role === 'talk' ? 'clip' : role}`, door: 'none', id: 'x', known: { kind: role === 'talk' ? 'clip' : role, by: 'nobody', directed: true, voices: { female: { Ann: 'plain' }, male: { Bob: 'plain' } }, ...({ picture: { usd: .05 }, clip: { usd: .1 }, talk: { usd: .1 }, voice: { usd: .045 } }[role] || {}) } }),
    clipAbilities: async (r) => ({ seconds: { min: 1, max: 12, whole: true }, end: true, acts: r.name === 'speaker' ? false : 'keeps', speaks: r.name === 'speaker', sound: true }),
    makePicture: async (r, w, file) => { asked.push({ kind: 'picture', ...w }); if (refuse?.test(w.prompt)) throw new Error('the model refused'); ff('-f', 'lavfi', '-i', 'color=c=gray:s=180x320', '-frames:v', '1', '-q:v', '6', file); },
    // a voice that is told how long a line should last takes half as long again (so that being asked a second time is tested)
    makeVoice: async (r, w, file) => { asked.push({ kind: 'voice', ...w }); const told = /lasts about ([\d.]+) seconds/.exec(w.style || '');
      ff('-f', 'lavfi', '-t', String(told ? +told[1] * 1.5 : Math.max(.6, w.text.split(/\s+/).length * .3)), '-i', 'sine=frequency=220:sample_rate=48000', file); },
    makeClip: async (r, w, file) => { asked.push({ kind: 'clip', model: r.name, ...w, heard: w.voice ? secondsOf(w.voice) : null });
      ff('-f', 'lavfi', '-t', String(w.seconds), '-i', 'testsrc2=s=180x320:r=24', '-f', 'lavfi', '-t', String(w.seconds), '-i', 'sine=frequency=330:sample_rate=48000', ...(r.name === 'speaker' ? ['-af', "volume=0:enable='lt(t,1)+gt(t,2.2)'"] : []), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file); },
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
  // a film made with a key that is gone: everything that stands is still found; only making something new asks for the key
  const gone = { ...standIns(), modelFor: (role, named, env, strict = true) => { if (strict) throw new Error('that model needs a key that is not set'); return standIns().modelFor(role, named); } };
  const still = await runFlow(dir, flow, { use: gone }); assert.deepEqual([still.made, still.failed], [[], []]); assert.equal(still.ready.length, 8);
  flow.nodes.music.prompt = 'A slow cello.'; const partly = await runFlow(dir, flow, { use: gone });
  assert.deepEqual(partly.failed.map((f) => `${f.id}: ${f.error}`), ['music: that model needs a key that is not set', 'film: needs music, which was not made']); assert.equal(partly.ready.length, 6);
});

test('where a voice is heard in a sound is found, and a recorded line is laid onto where the actor spoke', () => {
  const dir = fresh('speech'), a = path.join(dir, 'a.wav');
  ff('-f', 'lavfi', '-t', '6', '-i', 'sine=frequency=400:sample_rate=48000', '-af', "volume=0:enable='lt(t,0.8)+between(t,1.9,2.6)+gt(t,4.4)'", a);      // two phrases: 0.8–1.9 and 2.6–4.4
  const spans = speechSpans(a); assert.equal(spans.length, 2); for (const [i, want] of [[0, [.8, 1.9]], [1, [2.6, 4.4]]]) for (const k of [0, 1]) assert.ok(Math.abs(spans[i][k] - want[k]) < .08, `${spans[i]} is about ${want}`);
  ff('-f', 'lavfi', '-t', '2', '-i', 'anullsrc=r=48000:cl=mono', a); assert.deepEqual(speechSpans(a), [], 'room tone is not a voice');
  // the line among other noises: the run of stretches whose length is nearest to the line's
  assert.deepEqual(spokenPart([[.1, .3], [1, 2.4], [2.7, 3.9], [5.5, 5.7]], 2.5), [[1, 2.4], [2.7, 3.9]]); assert.deepEqual(spokenPart([[.2, .5], [1, 3]], 2.1), [[1, 3]]); assert.deepEqual(spokenPart([], 2), []);
  // phrase onto phrase when both pause alike; each stretched to its place, but never more than sounds right
  assert.deepEqual(layLine([[1, 2], [3, 5]], [[0, 1.1], [1.5, 3.3]]), [{ from: 0, to: 1.1, at: 1, tempo: 1.1, lasts: 1 }, { from: 1.5, to: 3.3, at: 3, tempo: .9, lasts: 2 }]);
  assert.deepEqual(layLine([[1, 4]], [[0, 1], [1.4, 2.6]]), [{ from: 0, to: 2.6, at: 1, tempo: .8667, lasts: 3 }], 'a different number of phrases: the whole line onto the whole stretch');
  assert.deepEqual(layLine([[1, 2]], [[0, 2]]), [{ from: 0, to: 2, at: .68, tempo: 1.22, lasts: 1.639 }], 'twice too long for its place: sped up as far as sounds right, and centred');
  assert.deepEqual(layLine([], [[0, 1]]), []);
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
  assert.deepEqual(laid.map((p) => p.how), ['dub', 'plain', 'over']); assert.ok(laid[2].line[0] - laid[2].start - LEAD < .01, 'the heard line starts a breath into its shot');
  // the model spoke from 1.0 s to 2.2 s in a voice of its own: the person's recorded voice goes exactly there, the shot is cut
  // close around the line, and the subtitle sits on it
  const dub = laid[0], said = secondsOf(r.out.get('s1-line').file); assert.equal(dub.lay.length, 1); assert.ok(Math.abs(dub.lay[0].at - 1) < .08 && Math.abs(dub.from - (dub.lay[0].at - LEAD)) < .011, JSON.stringify(dub));
  assert.ok(dub.lay[0].tempo >= .84 && dub.lay[0].tempo <= 1.22 && Math.abs(dub.lay[0].lasts - said / dub.lay[0].tempo) < .08); assert.ok(Math.abs(dub.line[0] - LEAD) < .1 && dub.length < 3, 'cut close around the line');
  assert.match(spoken.prompt, /Lan says in Vietnamese/, 'and the model was told the words, so the lips move with them');
  // keeping the model's own voice is a choice on the node; the clip is not made again for it, only the cut
  flow.nodes.s1.ownVoice = true; const n = use.asked.length, own = await runFlow(dir, flow, { use });
  assert.deepEqual(own.made, ['film']); assert.equal(use.asked.length, n); assert.equal(JSON.parse(fs.readFileSync(own.out.get('film').file.replace(/\.mp4$/, '.json'), 'utf8')).parts[0].how, 'native');
  assert.ok(fs.statSync(r.out.get('s3-end').file).size > 200, 'a frame taken from a clip');
  fs.rmSync(path.join(dir, 'media', 'me.jpg')); assert.match(checkFlow(flow, dir).join('\n'), /lan-face: the file media\/me\.jpg is not there/);
});

test('a line recorded to picture: the clip is filmed first with the model speaking, then the line is recorded to last as long as the lips moved', async () => {
  const dir = fresh('fit'), flow = small(), use = standIns(), events = [];
  flow.nodes.s1.model = 'speaker'; flow.nodes['s1-line'].fit = '@s1';
  assert.deepEqual(checkFlow(flow), []); assert.deepEqual(needs(flow, 's1'), ['s1-frame']); assert.deepEqual(needs(flow, 's1-line'), ['s1'], 'the line now comes after its clip');
  const r = await runFlow(dir, flow, { use, on: (e) => events.push(`${e.type} ${e.id}`) }); assert.deepEqual(r.failed, []); assert.ok(events.indexOf('done s1') < events.indexOf('start s1-line'));
  const clip = use.asked.find((a) => a.kind === 'clip' && a.model === 'speaker'); assert.equal(clip.voice, null); assert.match(clip.prompt, /Lan says in Vietnamese \(quiet\): "Anh về rồi à\?"/);
  // the lips moved for 1.2 s. The line is first recorded as it comes; here that fits (four words, 1.2 s), so nobody is told to hurry
  const first = use.asked.filter((a) => a.kind === 'voice'); assert.equal(first.length, 1); assert.doesNotMatch(first[0].style, /lasts about/);
  const store = JSON.parse(fs.readFileSync(path.join(dir, '.songbe', 'flow', 'takes.json'), 'utf8')), line = Object.values(store.takes).flat().find((t) => t.info?.fit);
  assert.equal(line.info.takes, 1); assert.ok(Math.abs(line.info.lay[0].at - 1) < .08 && Math.abs(line.info.lay[0].lasts - 1.2) < .1, JSON.stringify(line.info));
  assert.ok(Math.abs(secondsOf(r.out.get('s1-line').file) - secondsOf(r.out.get('s1').file)) < .06, 'the recording is as long as the clip, the voice set where the lips moved');
  assert.deepEqual(speechSpans(r.out.get('s1-line').file).map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]), [[1, 2.2]]);
  const part = JSON.parse(fs.readFileSync(r.out.get('film').file.replace(/\.mp4$/, '.json'), 'utf8')).parts[0]; assert.equal(part.how, 'dub'); assert.equal(part.placed, true); assert.ok(Math.abs(part.line[0] - LEAD) < .1 && Math.abs(part.from - .7) < .1);
  // a longer line for the same lips: as it comes it takes 2.1 s, far too long for 1.2 s, so it is asked for again and told how
  // long to take (less than the place it goes, since it ran over); that comes within a seventh, which is still heard when
  // stretched, so it is asked for once more, and then it fits
  flow.nodes['s1-line'].text = 'Anh về rồi à? Em chờ anh.'; const more = standIns(), again = await runFlow(dir, flow, { use: more }); assert.deepEqual(again.failed, []);
  const told = more.asked.filter((a) => a.kind === 'voice').map((a) => +(/in one breath, with no pause inside the line\. From the first word to the last, the line lasts about ([\d.]+) seconds/.exec(a.style)?.[1] ?? 0));
  assert.equal(told.length, 3); assert.equal(told[0], 0); assert.ok(told[1] > .6 && told[1] < .75 && told[2] > told[1] && told[2] < 1, `told ${told}`);
  const fitted = JSON.parse(fs.readFileSync(path.join(dir, '.songbe', 'flow', 'takes.json'), 'utf8')), last = Object.values(fitted.takes).flat().filter((t) => t.info?.fit).at(-1); assert.equal(last.info.takes, 3); assert.ok(last.info.lay[0].tempo >= .9 && last.info.lay[0].tempo <= 1.12, 'near enough that the stretching is not heard'); assert.deepEqual(last.review, []);
  // a recording that still had to be stretched as far as sounds right is pointed at
  assert.deepEqual(reviewFit({ fit: true, lay: [{ from: 0, to: 1, at: 1, tempo: 1.05, lasts: .95 }] }), []); assert.deepEqual(reviewFit({ fit: true, lay: [{ from: 0, to: .2, at: .55, tempo: .84, lasts: .24 }, { from: 1.2, to: 2.1, at: 2.5, tempo: 1.02, lasts: .88 }] }), [], 'one word, slowed: nobody hears that');
  assert.match(inWords(reviewFit({ fit: true, lay: [{ from: 0, to: .2, at: .55, tempo: .9, lasts: .22 }, { from: 1.2, to: 2.3, at: 2.49, tempo: 1.22, lasts: .89 }] })), /^the recording was sped up as far as sounds right to fit the lips at 2\.5 s, and may still not sit on them; listen to it$/);
  // what cannot be: a line recorded to a clip whose model acts to a recording, or to a clip that is not its own
  flow.nodes.s1.model = 'actor'; assert.match((await runFlow(dir, flow, { use })).failed[0].error, /actor does not speak a line by itself, so the line cannot be recorded to its lips: take "fit" off @s1-line/);
  flow.nodes['s1-line'].fit = '@s2'; assert.match(checkFlow(flow).join('\n'), /s1-line\.fit: @s2 does not have this line as its "voice"/);
});

test('what a run would cost is said before anything is asked, and a run stops at its budget', async () => {
  const dir = fresh('budget'), flow = small(), use = standIns();
  // before anything exists: three pictures, a line, two clips (one as long as its line is guessed to take, one of two seconds), music without a price
  const before = await estimate(dir, flow, { use });
  assert.deepEqual(before.pieces.map((p) => `${p.id} ${p.kind} ${p.usd}`), ['lan-face picture 0.05', 'lan-sheet picture 0.05', 's1-frame picture 0.05', 's1-line voice 0.0006', 's1 clip 0.3', 's2 clip 0.2', 'music music null']);
  assert.deepEqual([before.usd, before.unpriced], [.65, 1]); assert.equal(costOf({ known: { usd: .15 } }, 6), .9); assert.equal(costOf({ known: {} }, 6), null);
  assert.equal((await estimate(dir, flow, { use, want: ['lan-sheet'] })).usd, .1, 'only what was named and what it works from');
  // a budget of 20 cents: the pictures and the line are made, the first clip would go over it and is held back with what needs it
  const tight = await runFlow(dir, flow, { use, budget: .2 });
  assert.equal(madeOf(tight), 'lan-face lan-sheet music s1-frame s1-line'); assert.equal(tight.spent, .15);
  assert.deepEqual(tight.failed.map((f) => f.id), ['s1', 's2', 'film']); assert.match(tight.failed[0].error, /held back: it would take this run to about \$0\.35, over its budget of \$0\.20 \(--budget=N raises it\)/);
  assert.equal(use.asked.filter((a) => a.kind === 'clip').length, 0, 'no clip model was asked');
  // what is left costs what the clips cost — now that the line is recorded its clip is known to the second (two, not the three
  // guessed) — and with room for it the run finishes; every take remembers its price
  const left = await estimate(dir, flow, { use }); assert.deepEqual(left.pieces.map((p) => `${p.id} ${p.units} ${p.usd}`), ['s1 2 0.2', 's2 2 0.2']); assert.equal(left.usd, .4);
  const rest = await runFlow(dir, flow, { use, budget: 1 }); assert.equal(madeOf(rest), 'film s1 s2'); assert.equal(rest.spent, .4);
  const kept = Object.values(JSON.parse(fs.readFileSync(path.join(dir, '.songbe', 'flow', 'takes.json'), 'utf8')).takes).flat(); assert.equal(+kept.reduce((t, k) => t + (k.usd || 0), 0).toFixed(2), .55);
  assert.deepEqual((await estimate(dir, flow, { use })).pieces, []); assert.equal((await estimate(dir, flow, { use, again: ['s2'] })).usd, .2, 'another take of something made is counted too');
  assert.match(checkFlow({ ...flow, budget: 'a lot' }).join(), /budget: what a run may spend, a number of dollars/); assert.equal(expand({ ...SERIES, budget: 12 }, {}).budget, 12);
});

test('a maker that answers that the money has run out is not asked again in that run, and everything another maker can do is still made', async () => {
  // three pictures that need nothing, asked one at a time at "google"; music at "fal"
  const flow = { format: 'tall', nodes: { a: { kind: 'picture', prompt: 'One.' }, b: { kind: 'picture', prompt: 'Two.' }, c: { kind: 'picture', prompt: 'Three.' }, tune: { kind: 'music', prompt: 'Sparse piano.' } } };
  const use = standIns(), named = use.modelFor, draw = use.makePicture; let asked = 0;
  use.modelFor = (role, name) => ({ ...named(role, name), door: role === 'music' ? 'fal' : 'google' });
  use.makePicture = async (r, w, file) => { asked++; if (asked === 1) throw new Error('Google answered 402: Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.'); return draw(r, w, file); };
  const r = await runFlow(fresh('broke'), flow, { use, limit: 1 });
  assert.equal(asked, 1, 'the second and the third picture were not asked for'); assert.deepEqual(r.made, ['tune']); assert.deepEqual(r.failed.map((f) => f.id), ['a', 'b', 'c']);
  assert.match(r.failed[0].error, /^Google answered 402: Your prepayment credits are depleted/); assert.match(r.failed[1].error, /^not asked: Google's API has already answered in this run that it will not be paid — Google answered 402: Your prepayment credits are depleted/);
  // a refusal that is about money is never tried again, whatever its number; one that is not still is
  let tries = 0; const busy = standIns(), paint = busy.makePicture; busy.makePicture = async (r, w, file) => { if (++tries < 3) throw new Error('Google answered 503: overloaded'); return paint(r, w, file); };
  const ok = await runFlow(fresh('busy'), { format: 'tall', nodes: { a: flow.nodes.a } }, { use: busy, pause: 0 }); assert.deepEqual([ok.made, tries], [['a'], 3]);
  for (const said of ['fal 403: User is locked. Reason: TOP_UP', 'Google answered 429: Your project has exceeded its monthly spending cap', 'fal 402: insufficient balance']) { let n = 0; const u = standIns(); u.makePicture = async () => { n++; throw new Error(said); };
    const x = await runFlow(fresh('no-' + said.length), { format: 'tall', nodes: { a: flow.nodes.a } }, { use: u, pause: 0 }); assert.equal(n, 1, said); assert.equal(x.failed[0].error, said); }
});

// ---- the review: what is odd about a take, found by looking at it ----
test('a take is looked at without asking any model: a clip that grows a colour, cuts, freezes, goes black or stays silent; a line that is not the line; a picture in another shape', () => {
  const dir = fresh('review'), at = (name) => path.join(dir, name), what = (found) => found.map((f) => f.what).join(' ');
  // a calm shot: a dark-blue room with a skin-coloured shape moving slowly across it
  const room = ['-f', 'lavfi', '-t', '4', '-i', 'color=c=0x24364a:s=180x320:r=24', '-f', 'lavfi', '-t', '4', '-i', 'color=c=0xb98a6a:s=60x80:r=24'], moving = "[0][1]overlay=x='40+12*t':y=100";
  const film = (name, graph, ...more) => { ff(...room, ...more, '-filter_complex', graph, '-map', '[o]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', at(name)); return at(name); };
  const calm = film('calm.mp4', `${moving}[o]`); assert.deepEqual(reviewClip(calm), []);
  ff('-i', calm, '-frames:v', '1', '-q:v', '2', at('calm.jpg')); assert.deepEqual(reviewClip(calm, { start: at('calm.jpg'), how: 'plain', asked: 4 }), [], 'and it begins on the picture it started from');
  // a yellow patch that is there from 1.0 s to 2.6 s — what a clip model did to a face in a real film
  const patch = reviewClip(film('patch.mp4', `${moving}[a];[a][2]overlay=x=30:y=40:enable='between(t,1,2.6)'[o]`, '-f', 'lavfi', '-t', '4', '-i', 'color=c=0xe2c200:s=60x70:r=24'), { start: at('calm.jpg') });
  assert.equal(what(patch), 'colour'); assert.ok(Math.abs(patch[0].at - 1) < .2 && Math.abs(patch[0].to - 2.6) < .25, JSON.stringify(patch)); assert.match(patch[0].says, /^a strong colour that the first frame does not have covers [\d.]+% of the picture from 1(\.\d)? s to 2\.\d s$/); assert.equal(grave(patch).length, 0, 'odd, not unusable');
  // a cut to something else at 2 s
  ff(...room, '-f', 'lavfi', '-t', '2', '-i', 'testsrc2=s=180x320:r=24', '-filter_complex', `${moving},trim=0:2,setpts=PTS-STARTPTS[a];[a][2]concat=n=2:v=1:a=0[o]`, '-map', '[o]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', at('jump.mp4'));
  const jump = reviewClip(at('jump.mp4')).find((f) => f.what === 'jump'); assert.ok(jump && Math.abs(jump.at - 2) < .15, JSON.stringify(reviewClip(at('jump.mp4'))));
  // a picture that never moves, and one that goes black for a second
  ff('-f', 'lavfi', '-t', '3', '-i', 'color=c=0x24364a:s=180x320:r=24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', at('still.mp4'));
  assert.deepEqual(reviewClip(at('still.mp4')).map((f) => [f.what, !!f.grave]), [['still', true]]);
  const dark = reviewClip(film('dark.mp4', `${moving},drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,2,3)'[o]`)).find((f) => f.what === 'dark'); assert.ok(dark && Math.abs(dark.at - 2) < .15 && Math.abs(dark.to - 3) < .2, JSON.stringify(dark));
  // it was to start from another picture; it is shorter than was asked for; the model was to say the line and nobody is heard
  ff('-f', 'lavfi', '-i', 'testsrc2=s=180x320', '-frames:v', '1', '-q:v', '2', at('other.jpg'));
  assert.equal(what(reviewClip(calm, { start: at('other.jpg') })), 'start'); assert.match(inWords(reviewClip(calm, { asked: 6 })), /^it lasts 4\.0 s, and 6 s were asked for$/);
  const line = 'Đêm nào anh cũng lẻn đi. Anh giấu em chuyện gì?';
  assert.deepEqual(reviewClip(calm, { how: 'native', spoke: [], text: line, language: 'Vietnamese' }).map((f) => [f.what, f.grave, f.says]), [['silent', true, 'nobody is heard saying the line']]);
  assert.match(inWords(reviewClip(calm, { how: 'native', spoke: [[1, 1.4]], text: line, language: 'Vietnamese' })), /^only 0\.4 s of voice is heard, and the line takes about 2\.\d s to say$/);
  assert.deepEqual(reviewClip(calm, { how: 'native', spoke: [[1, 3.2]], text: line, language: 'Vietnamese' }), []); assert.deepEqual(reviewClip(calm, { how: 'voice', spoke: [], text: line }), [], 'only a model that was to speak is listened to');
  // a recorded line: as long as the line takes, nothing at all, far more than the line, a part of it, a long pause inside
  const tone = (name, seconds, filter) => { ff('-f', 'lavfi', '-t', String(seconds), '-i', 'sine=frequency=400:sample_rate=48000', ...(filter ? ['-af', filter] : []), at(name)); return at(name); }, said = (file) => reviewVoice(file, { text: line, language: 'Vietnamese' });
  assert.deepEqual(said(tone('fine.wav', 2.8)), []);
  ff('-f', 'lavfi', '-t', '2', '-i', 'anullsrc=r=48000:cl=mono', at('none.wav')); assert.deepEqual(said(at('none.wav')).map((f) => [f.what, f.grave]), [['nothing', true]]);
  assert.match(inWords(said(tone('long.wav', 9))), /^the recording holds 9\.0 s of voice for a line that takes about 2\.\d s to say: more than the line was said$/); assert.equal(grave(said(at('long.wav'))).length, 1);
  assert.match(inWords(said(tone('part.wav', .9))), /part of the line is missing$/); assert.deepEqual(reviewVoice(tone('word.wav', .5), { text: 'Minh?', language: 'Vietnamese' }), [], 'a word is not held to a stopwatch');
  assert.deepEqual(said(tone('pause.wav', 5.2, "volume=0:enable='between(t,1.4,3.6)'")).map((f) => [f.what, !!f.grave]), [['pause', false]]);
  // a picture: the shape asked for, another shape, one flat colour, plain bars above and below
  const pic = (name, source, filter) => { ff('-f', 'lavfi', '-i', source, ...(filter ? ['-vf', filter] : []), '-frames:v', '1', '-q:v', '2', at(name)); return at(name); };
  assert.deepEqual(reviewPicture(pic('tall.jpg', 'testsrc2=s=180x320'), { aspect: '9:16' }), []); assert.match(inWords(reviewPicture(at('tall.jpg'), { aspect: '16:9' })), /^it came back 180×320, not the 16:9 that was asked for$/);
  assert.equal(what(reviewPicture(pic('flat.jpg', 'color=c=gray:s=180x320'), { aspect: '9:16' })), 'blank'); assert.match(inWords(reviewPicture(pic('bars.jpg', 'testsrc2=s=180x240', 'pad=180:320:0:40:black'), { aspect: '9:16' })), /^it has plain bars along its top and bottom edges$/);
  assert.deepEqual(reviewPicture(at('calm.jpg'), {}), [], 'a dark picture with a plain wall has no bars');
});

test('a run looks at what it makes: a take that cannot be used is asked for again, the better one stands, and nothing is built on a node that has none', async () => {
  // "mute-once" says the line itself and stays silent the first time it is asked; "mute" never says anything
  const models = () => { const use = standIns(), plain = use.makeClip, can = use.clipAbilities; let calls = 0;
    use.clipAbilities = async (r) => (/^mute/.test(r.name) ? { seconds: { min: 1, max: 12, whole: true }, end: true, acts: false, speaks: true, sound: true } : can(r));
    use.makeClip = async (r, w, file) => { if (!/^mute/.test(r.name)) return plain(r, w, file); use.asked.push({ kind: 'clip', model: r.name, ...w }); const quiet = r.name === 'mute' || ++calls === 1;
      ff('-f', 'lavfi', '-t', String(w.seconds), '-i', 'testsrc2=s=180x320:r=24', '-f', 'lavfi', '-t', String(w.seconds), '-i', 'sine=frequency=330:sample_rate=48000', '-af', quiet ? 'volume=0' : "volume=0:enable='lt(t,1)+gt(t,2.2)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file); };
    return use; };
  const clips = (use) => use.asked.filter((a) => a.kind === 'clip' && /^mute/.test(a.model)).length, takes = (dir) => Object.values(JSON.parse(fs.readFileSync(path.join(dir, '.songbe', 'flow', 'takes.json'), 'utf8')).takes).flat();
  const dir = fresh('retake'), flow = small(), use = models(), events = []; flow.nodes.s1.model = 'mute-once';
  const r = await runFlow(dir, flow, { use, on: (e) => events.push(`${e.type} ${e.id}${e.why ? ': ' + e.why : ''}`) });
  assert.deepEqual(r.failed, []); assert.equal(clips(use), 2, 'asked once more, by the run itself'); assert.ok(events.includes('again s1: nobody is heard saying the line'), events.join(' | ')); assert.equal(r.spent, +(.15 + .0006 + .3 * 2 + .2).toFixed(2), 'and the second take is counted');
  const s1 = (await look(dir, flow, { use })).find((x) => x.id === 's1'); assert.deepEqual([s1.state, s1.n, s1.takes], ['ready', 2, 2]);
  assert.deepEqual(takes(dir).filter((t) => t.bad).map((t) => [t.n, inWords(grave(t.review))]), [[1, 'nobody is heard saying the line']], 'the take that could not be used is kept, and marked');
  assert.equal(JSON.parse(fs.readFileSync(r.out.get('film').file.replace(/\.mp4$/, '.json'), 'utf8')).parts[0].how, 'dub', 'the film is cut from the take in which the line is said');
  // what is only odd is used, and pointed at: the stand-in pictures are one flat colour
  assert.deepEqual(r.flagged.filter((f) => f.id === 's1-frame').map((f) => inWords(f.review)), ['it is one flat colour']); assert.deepEqual((await look(dir, flow, { use })).find((x) => x.id === 'lan-face').review.map((f) => f.what), ['shape', 'blank'], 'the stand-in draws every picture tall, and the face was asked for as 3:4');

  // a model that never says the line: two takes, neither can be used, so the node is not made and the cut is not attempted
  const never = fresh('never'), mute = models(), heard = []; flow.nodes.s1.model = 'mute';
  const bad = await runFlow(never, flow, { use: mute, on: (e) => heard.push(e.type) });
  assert.equal(clips(mute), 2); assert.deepEqual(bad.failed.map((f) => f.id), ['s1', 'film']); assert.equal(bad.failed[0].error, '2 takes were made and none can be used: nobody is heard saying the line. Choose a take to use it as it is, or run again for another.'); assert.match(bad.failed[1].error, /needs s1/);
  const row = (await look(never, flow, { use: mute })).find((x) => x.id === 's1'); assert.equal(row.state, 'make'); assert.deepEqual(row.refused, [{ n: 1, why: 'nobody is heard saying the line' }, { n: 2, why: 'nobody is heard saying the line' }]);
  // a person may use such a take all the same: chosen, it stands, the cut is made from it, and no model is asked again
  openStore(never).pick('s1', row.key, 2); const asked = mute.asked.length, used = await runFlow(never, flow, { use: mute });
  assert.deepEqual([used.made, used.failed], [['film'], []]); assert.equal(mute.asked.length, asked); const chosen = (await look(never, flow, { use: mute })).find((x) => x.id === 's1'); assert.deepEqual([chosen.state, chosen.n, grave(chosen.review)[0].what], ['ready', 2, 'silent']);
  // "retakes" says how often a run may ask again by itself: not at all, or not when the budget has no room for it
  const none = models(); assert.match((await runFlow(fresh('once'), { ...flow, retakes: 0 }, { use: none })).failed[0].error, /^the take that was made cannot be used: nobody is heard saying the line/); assert.equal(clips(none), 1);
  const tight = models(), notes = [], t = await runFlow(fresh('tight'), flow, { use: tight, budget: .7, on: (e) => { if (e.type === 'note') notes.push(e.text); } });
  assert.equal(clips(tight), 1); assert.deepEqual(notes, ['s1: nobody is heard saying the line; another take would go over the budget of this run']); assert.deepEqual(t.failed.map((f) => f.id), ['s1', 'film']);
});

test('takes made before Songbe looked at them are looked at on request, and a clip that lost the recording it acted to gets it laid in', async () => {
  const dir = fresh('lookback'), flow = small(), use = standIns(), file = path.join(dir, '.songbe', 'flow', 'takes.json');
  await runFlow(dir, flow, { use });
  const old = JSON.parse(fs.readFileSync(file, 'utf8')); for (const t of Object.values(old.takes).flat()) delete t.review; fs.writeFileSync(file, JSON.stringify(old));      // a film from before
  assert.ok((await look(dir, flow, { use })).every((x) => !x.looked && !x.review)); const n = use.asked.length;
  const seen = await look(dir, flow, { use, review: true }); assert.equal(use.asked.length, n, 'no model is asked');
  assert.deepEqual(seen.filter((x) => x.looked).map((x) => x.id).sort(), ['lan-face', 'lan-sheet', 's1', 's1-frame', 's1-line', 's2']); assert.equal(seen.find((x) => x.id === 's1-frame').review[0].what, 'blank');
  assert.ok(seen.filter((x) => x.state !== 'words').every((x) => x.state === 'ready'), 'looking changes nothing that stands'); assert.equal((await look(dir, flow, { use })).filter((x) => x.looked).length, 6, 'and what was found is kept');
  // a model that keeps the recording it acts to, and this once came back without it
  const lost = fresh('lost'), forgetful = standIns(), plain = forgetful.makeClip;
  forgetful.makeClip = async (r, w, f) => { await plain(r, w, f); if (w.voice) { const quiet = f + '.q.mp4'; ff('-i', f, '-c:v', 'copy', '-af', 'volume=0', '-c:a', 'aac', quiet); fs.renameSync(quiet, f); } };
  const made = await runFlow(lost, flow, { use: forgetful }); assert.deepEqual(made.failed, []);
  assert.equal(Object.values(JSON.parse(fs.readFileSync(path.join(lost, '.songbe', 'flow', 'takes.json'), 'utf8')).takes).flat().find((t) => t.info?.how === 'voice').info.lost, true);
  const heard = speechSpans(made.out.get('film').file); assert.ok(heard.length && Math.abs(heard[0][0] - LEAD) < .15, `the line is in the film all the same: ${JSON.stringify(heard)}`);
});

test('lines by hand on the canvas: what dropping one card on another means, what is made from a card dropped on nothing, and how a line is cut', () => {
  // the page's own rules, run here as the page runs them, on the small canvas
  const flow = small(); flow.nodes.rain = { kind: 'picture', prompt: 'Rain on glass.' }; flow.nodes.last = { kind: 'picture', grab: '@s2' };
  const page = vm.createContext({ S: { flow }, list: (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]), bare: (r) => String(r || '').replace(/^@/, ''), structuredClone });
  const rules = vm.runInContext(fs.readFileSync(new URL('../studio/wires.js', import.meta.url), 'utf8') + '\n;({ linkWays, linkNew, unlinked, softEdges })', page), plain = (x) => JSON.parse(JSON.stringify(x ?? null));
  const says = (a, b) => plain(rules.linkWays(a, b).map((w) => w.says)), after = (a, b, which = 0) => { const n = structuredClone(flow.nodes[b]); rules.linkWays(a, b)[which].change(n); return plain(n); }, sound = (id, node) => checkFlow({ ...flow, nodes: { ...flow.nodes, [id]: node } });
  // a picture onto a clip: three things it can be there
  assert.deepEqual(says('rain', 's2'), ['Start on it instead of s1-frame', 'End on it', 'Hand it over as a reference']);
  assert.equal(after('rain', 's2', 0).frame, '@rain'); assert.equal(after('rain', 's2', 1).end, '@rain'); assert.deepEqual(after('rain', 's2', 2).refs, ['@rain']); for (const k of [0, 1, 2]) assert.deepEqual(sound('s2', after('rain', 's2', k)), []);
  assert.deepEqual(says('rain', 'lan-sheet'), ['Hand it over as a reference']); assert.deepEqual(says('s1-line', 's2'), ['It is the line of this clip']); assert.deepEqual(says('s1-line', 's1'), ['It is the line of this clip instead of s1-line']);
  // words are brought in by name; a person says a line; a clip goes into a cut, music under it
  assert.deepEqual(says('look', 's2'), ['Put its words into the prompt']); assert.equal(after('look', 's2').prompt, 'Wide, static. The room is empty. @look'); assert.deepEqual(says('lan', 'rain'), ['Bring them into the prompt']);
  assert.deepEqual(says('lan', 's1-line'), ['They say this line']); assert.deepEqual(says('s1', 's1-line'), ['Record the line to the lips of this clip, after it is filmed']); assert.deepEqual(says('s2', 's1-line'), [], 'only the clip that has this line');
  assert.deepEqual(says('rain', 'film'), []); assert.deepEqual(says('s1', 'film'), ['Add it as the last shot']); assert.deepEqual(after('s1', 'film').shots, ['@s1', { clip: '@s2', to: 1.5 }, '@s1']); assert.deepEqual(says('music', 'film'), ['Play it under the cut instead of music']);
  assert.deepEqual(says('s1', 'last'), ['Take the frame from this clip instead of s2']); assert.deepEqual(says('s1', 'rain'), [], 'a drawn picture is not a frame of a clip'); assert.deepEqual(says('s1-line', 'rain'), []); assert.deepEqual(says('rain', 'rain'), []);
  // dropped on nothing: something new, named after what it is made from
  const made = (a) => plain(rules.linkNew(a));
  assert.deepEqual(made('rain').map((m) => [m.says, m.nodes[0][0]]), [['A clip that starts on it', 'rain-clip'], ['Another picture made from it', 'rain-next']]); assert.deepEqual(made('rain')[0].nodes[0][1], { kind: 'clip', frame: '@rain', prompt: 'Describe what happens.' });
  const on = made('s2')[1]; assert.equal(on.says, 'The clip that carries on from it'); assert.deepEqual(on.nodes, [['s2-end', { kind: 'picture', grab: '@s2', at: 'end' }], ['s2-on', { kind: 'clip', frame: '@s2-end', prompt: 'Describe what happens next.' }]]);
  assert.deepEqual(checkFlow({ ...flow, nodes: { ...flow.nodes, ...Object.fromEntries(on.nodes) } }), []); flow.nodes['s2-end'] = on.nodes[0][1]; assert.equal(made('s2')[0].nodes[0][0], 's2-end2', 'a name that is free'); delete flow.nodes['s2-end'];
  assert.deepEqual(made('lan').map((m) => m.says), ['A picture of them', 'A line they say']); assert.deepEqual(made('s1-line')[0].nodes[0][1], { kind: 'clip', voice: '@s1-line', prompt: 'Describe what happens.' }); assert.deepEqual(made('music'), []);
  // a line that is cut: every way the one card uses the other is taken out — or nothing, when it only comes in through another card
  const cut = (a, b) => plain(rules.unlinked(a, b));
  assert.equal(cut('s1-frame', 's1').frame, undefined); assert.equal(cut('s1-line', 's1').voice, undefined); assert.equal(cut('music', 'film').music, undefined); assert.deepEqual(cut('s1', 'film').shots, [{ clip: '@s2', to: 1.5 }]);
  assert.equal(cut('lan-sheet', 's1-frame').prompt, 'is the sheet of @lan. Close-up of @lan at a table. @look'); assert.equal(cut('look', 'lan-face').prompt, 'Portrait of @lan.'); assert.equal(cut('s2', 'last').grab, undefined);
  assert.equal(cut('s1-line', 'film'), null, 'the cut has the line through its clip'); assert.equal(cut('rain', 's1'), null);
  // where notes and people are brought in: drawn for the chosen card only
  const soft = plain(rules.softEdges()).map((e) => e.join('→')); for (const e of ['look→lan-face', 'lan→lan-face', 'lan→s1-frame', 'look→s1-frame', 'lan→s1-line']) assert.ok(soft.includes(e), e); assert.ok(!soft.some((e) => e.startsWith('lan-sheet')), 'pictures have lines of their own');
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
  assert.deepEqual(Object.keys(n), ['style', 'look', 'keep', 'lan', 'lan-face', 'lan-sheet', 'minh', 'minh-face', 'minh-sheet', 'can-ho', 'can-ho-plate', 'e1-scene1', 'e1-s1-frame', 'e1-s1-line', 'e1-s1', 'e1-s2-frame', 'e1-s2', 'e1-s3-frame', 'e1-s3-line', 'e1-s3', 'e1-s4-frame', 'e1-s4', 'e1-music', 'e1']);
  assert.equal(n.look.text, '@style Cold blue moonlight, deep shadows.'); assert.match(n['lan-face'].prompt, /^@style Portrait of Lan: 26, slim, a black bob\. Chest-up.*Wearing a plain dark top\./); assert.doesNotMatch(n['lan-face'].prompt, /beige/, 'a face is who someone is, not what they wear'); assert.deepEqual(needs(flow, 'lan-face'), []);
  assert.match(n['lan-sheet'].prompt, /the person in @lan-face.*every view wears a beige blouse/);
  assert.deepEqual(needs(flow, 'e1-scene1').sort(), ['can-ho-plate', 'lan-sheet', 'minh-sheet']); assert.deepEqual(needs(flow, 'e1-s1-frame').sort(), ['e1-scene1', 'lan-sheet']);
  assert.match(n['e1-s1-frame'].prompt, /In the frame: Lan; Minh is outside the frame\. Lan's mouth is closed, about to speak\./);
  assert.deepEqual([n['e1-s1'].voice, n['e1-s1'].heard, n['e1-s3'].heard, n['e1-s2'].seconds], ['@e1-s1-line', undefined, true, 3], 'a line whose speaker is not in the frame is heard, not seen');
  const { of, ...grabbed } = n['e1-s4-frame']; assert.deepEqual(grabbed, { kind: 'picture', grab: '@e1-s3', at: 'end', group: 'e1', label: 'Shot 4: first frame (where shot 3 ends)' }); assert.match(of, /^[0-9a-f]{16}$/);
  assert.equal(n['e1-s1'].prompt, 'Close-up, static. Lan stares from the shadows. Sound: a ticking clock. @keep');
  // a clip is told the medium and to keep what its first frame shows — not the palette, which a model may paint onto a face
  assert.equal(n.keep.text, "@style The light and the colours stay as they are in the first frame, and so do everyone's face, hair and clothes."); assert.equal(expand({ ...SERIES, style: undefined }, {}).nodes.keep.text.startsWith('The light and the colours'), true);
  assert.match(checkSeries({ ...SERIES, cast: { keep: SERIES.cast.lan } }).join(), /cast\.keep: "keep" is a name the canvas uses itself/); assert.equal(expand({ ...SERIES, retakes: 2 }, {}).retakes, 2); assert.match(checkFlow({ ...flow, retakes: 9 }).join(), /retakes: how many more takes a run may ask for by itself/); assert.deepEqual(n.e1.shots, ['@e1-s1', '@e1-s2', '@e1-s3', '@e1-s4']); assert.equal(n.e1.notice, 'Nội dung tạo bằng AI');
  // a part of the work: the board is every picture that needs no clip
  assert.deepEqual(stageNodes(flow, 1, 'cast'), ['lan-face', 'lan-sheet', 'minh-face', 'minh-sheet', 'can-ho-plate']);
  assert.deepEqual(stageNodes(flow, 1, 'board').slice(5), ['e1-scene1', 'e1-s1-frame', 'e1-s2-frame', 'e1-s3-frame']); assert.ok(stageNodes(flow, 1, 'cut').includes('e1')); assert.throws(() => stageNodes(flow, 1, 'later'), /is not one of cast, board/);
  assert.match(boardHtml(flow, [], { title: 'T' }), /<b>Lan<\/b> · voice Kore[\s\S]*Episode 1: Hai giờ sáng[\s\S]*<b>Lan \(off screen\):<\/b> Minh\?/);
  // which comes first, the line or the clip, follows the model that films people speaking: one that acts to a recording gets the
  // line first; one that only speaks films first, and the line is recorded to its lips
  assert.equal(n['e1-s1-line'].fit, undefined); assert.equal(expand({ ...SERIES, models: { talk: 'hailuo-h3' } }, { 1: EPISODE }).nodes['e1-s1-line'].fit, undefined);
  const spoken = expand({ ...SERIES, models: { talk: 'veo-3.1-fast' } }, { 1: EPISODE }); assert.equal(spoken.nodes['e1-s1-line'].fit, '@e1-s1'); assert.equal(spoken.nodes['e1-s3-line'].fit, undefined, 'a voice that is only heard is not recorded to anyone\'s lips');
  assert.deepEqual(checkFlow(spoken), []); assert.deepEqual(needs(spoken, 'e1-s1-line'), ['e1-s1']); const one = structuredClone(EPISODE); one.scenes[0].shots[0].model = 'veo-3.1'; assert.equal(expand(SERIES, { 1: one }).nodes['e1-s1-line'].fit, '@e1-s1');
  // an episode may name its own models; they are written onto its shots, so the other episodes are left as they were
  const own = expand(SERIES, { 1: EPISODE, 2: { ...EPISODE, models: { clip: 'veo-3.1-lite', talk: 'veo-3.1-fast' } } }).nodes;
  assert.deepEqual([own['e2-s1'].model, own['e2-s2'].model, own['e2-s3'].model, own['e2-s1-line'].fit, own['e1-s1'].model, own['e1-s1-line'].fit], ['veo-3.1-fast', 'veo-3.1-lite', 'veo-3.1-lite', '@e2-s1', undefined, undefined]);
  assert.match(checkEpisode(SERIES, { ...EPISODE, models: 'veo' }).join(), /models: must be an object/);
});

test('the director rewrites only what is still as it wrote it: a node changed by hand is left alone, and said to be', () => {
  const dir = fresh('sync');
  const first = sync(dir, SERIES, { 1: EPISODE }); assert.equal(first.added.length, 24); assert.deepEqual(sync(dir, SERIES, { 1: EPISODE }).added.concat(sync(dir, SERIES, { 1: EPISODE }).updated), []);
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
  assert.deepEqual(sync(dir, renamed, { 1: changed }, { rewrite: true }).updated, ['lan-face']); assert.match(readFlow(dir).nodes['lan-face'].prompt, /^@style Portrait of Lan: 26, slim/);
  // a face from before faces were drawn without the clothes carries the mark an older Songbe gave it: the same facts, so its words stay
  const older = readFlow(dir), face = older.nodes['minh-face']; face.prompt = '@style Portrait of @minh. Chest-up.'; face.of = sha(['face', { id: 'minh', name: 'Minh', own: null, medium: true }]); face.as = sha(bare(face)); writeFlow(dir, older);
  assert.deepEqual(sync(dir, renamed, { 1: changed }).updated, []); assert.equal(readFlow(dir).nodes['minh-face'].prompt, '@style Portrait of @minh. Chest-up.');
  const taller = structuredClone(renamed); taller.cast.minh.wardrobe = 'a grey suit'; assert.deepEqual(sync(dir, taller, { 1: changed }).updated.sort(), ['minh', 'minh-sheet'], 'other clothes: the person and the sheet, never the face');
  assert.deepEqual(sync(dir, taller, { 1: changed }, { rewrite: true }).updated, ['minh-face']); assert.match(readFlow(dir).nodes['minh-face'].prompt, /^@style Portrait of Minh: 31, broad shoulders\./);
});

test('a cut a person changed still follows the script in what it is made of: a shot that is gone leaves it, a new one goes in where it belongs', () => {
  const dir = fresh('mend'); sync(dir, SERIES, { 1: EPISODE });
  // their own order, a trim, and a clip of their own at the end
  const flow = readFlow(dir); flow.nodes.rain = { kind: 'clip', prompt: 'Rain on the glass.' }; flow.nodes.e1.shots = ['@e1-s2', { clip: '@e1-s1', from: .2, to: 1.5 }, '@e1-s3', '@e1-s4', '@rain']; writeFlow(dir, flow);
  const next = structuredClone(EPISODE); next.scenes[0].shots.splice(3, 1); next.scenes[0].shots.splice(1, 0, { id: '1b', size: 'close', who: ['minh'], action: 'Minh blinks.' });      // shot 4 goes, a shot comes after shot 1
  const r = sync(dir, SERIES, { 1: next });
  assert.deepEqual(r.mended, ['e1']); assert.ok(r.kept.includes('e1')); assert.deepEqual(r.removed.sort(), ['e1-s4', 'e1-s4-frame']); assert.deepEqual(r.added.sort(), ['e1-s1b', 'e1-s1b-frame']);
  assert.deepEqual(readFlow(dir).nodes.e1.shots, ['@e1-s2', { clip: '@e1-s1', from: .2, to: 1.5 }, '@e1-s1b', '@e1-s3', '@rain'], 'after the shot it follows in the script; everything of theirs as it was');
  assert.deepEqual(checkFlow(readFlow(dir)), []); assert.deepEqual(sync(dir, SERIES, { 1: next }).mended, [], 'and it is left alone when nothing changed');
  // a shot they took out of their cut is not put back; a node of theirs that still works from a shot keeps that shot on the canvas
  const mine = readFlow(dir); mine.nodes.e1.shots = ['@e1-s2', '@e1-s3']; mine.nodes.still = { kind: 'picture', grab: '@e1-s3' }; writeFlow(dir, mine);
  const less = structuredClone(next); less.scenes[0].shots.splice(3, 1);      // shot 3 goes from the script
  const kept = sync(dir, SERIES, { 1: less }), now = readFlow(dir).nodes;
  assert.deepEqual(now.e1.shots, ['@e1-s2'], 'gone from the cut'); assert.ok(now['e1-s3'] && now['e1-s3-frame'] && kept.kept.includes('e1-s3'), 'but still there for the picture taken from it'); assert.ok(!kept.removed.includes('e1-s3')); assert.deepEqual(checkFlow(readFlow(dir)), []);
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

test('the script is changed from the canvas window: kept only when sound, and the canvas follows — exactly what works from the change is to be made again', async () => {
  const dir = fresh('script'), home = fresh('script-home'); writeJson(seriesFile(dir), SERIES); writeJson(episodeFile(dir, 1), EPISODE); sync(dir, SERIES, { 1: EPISODE });
  const s = await serve({ port: 0, film: dir, home }), origin = s.url.replace(/\/$/, '');
  try {
    const at = origin + (await fetch(s.url, { redirect: 'manual' })).headers.get('location').replace(/\/$/, ''), get = (p) => fetch(at + p).then((r) => r.json()), put = (p, body) => fetch(at + p, { method: 'PUT', headers: { 'X-Songbe': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
    const had = await get('/api/script'); assert.equal(had.series.title, 'Hai giờ sáng'); assert.deepEqual(Object.keys(had.episodes), ['1']); assert.ok(had.seconds[1] > 7 && had.seconds[1] < 17); assert.ok(had.sizes.includes('over shoulder')); assert.equal(had.voices.female.Kore, 'firm');
    assert.equal((await fetch(at + '/api/script?episode=1', { method: 'PUT', body: '{}' })).status, 403, 'a change needs the header a foreign page cannot send');
    // a line is changed, and a shot is given an empty camera and a line nobody wrote: both are left out of the file
    const ep = structuredClone(had.episodes[1]); ep.scenes[0].shots[0].line.text = 'Anh đi đâu vậy?'; ep.scenes[0].shots[3].camera = ''; ep.scenes[0].shots[3].line = { who: 'minh', text: ' ' };
    const one = await put('/api/script?episode=1', ep);
    assert.equal(one.saved, true); assert.deepEqual(one.changed.updated, ['e1-s1-line']); assert.deepEqual([one.changed.added, one.changed.removed, one.changed.kept], [[], [], []]); assert.ok(one.seconds[1] < had.seconds[1]);
    assert.equal(readEpisode(dir, 1).scenes[0].shots[0].line.text, 'Anh đi đâu vậy?'); assert.deepEqual(Object.keys(readEpisode(dir, 1).scenes[0].shots[3]), ['id', 'size', 'who', 'action', 'continues', 'seconds']); assert.equal(one.flow.nodes['e1-s1-line'].text, 'Anh đi đâu vậy?'); assert.ok(one.rows.find((x) => x.id === 'e1-s1-line'));
    // what is not sound is not kept, and the reason is said
    const stranger = structuredClone(ep); stranger.scenes[0].shots[1].who = ['tam'];
    const no = await put('/api/script?episode=1', stranger); assert.equal(no.saved, false); assert.match(no.bad[0], /scenes\[0\]\.shots\[1\]\.who: "tam" is not in the cast/); assert.deepEqual(readEpisode(dir, 1).scenes[0].shots[1].who, ['minh']);
    assert.match((await put('/api/script?episode=9', ep)).error, /The series plans no episode 9/); assert.match((await put('/api/script?episode=1', {})).error, /Nothing was sent/);
    // a new shot after shot 1, and shot 4 gone: their nodes come and go, and the cut follows
    const more = structuredClone(ep); more.scenes[0].shots.splice(1, 0, { id: '1b', size: 'insert', who: [], action: 'A key turns in the lock.', seconds: 2 }); more.scenes[0].shots.pop();
    const two = await put('/api/script?episode=1', more); assert.deepEqual([two.changed.added.sort(), two.changed.removed.sort(), two.changed.updated], [['e1-s1b', 'e1-s1b-frame'], ['e1-s4', 'e1-s4-frame'], ['e1']]); assert.deepEqual(readFlow(dir).nodes.e1.shots, ['@e1-s1', '@e1-s1b', '@e1-s2', '@e1-s3']);
    // the second episode is planned and has no script: one written by hand is taken like any other
    assert.deepEqual(written(dir), [1]); const hand = await put('/api/script?episode=2', { title: 'Cánh cửa', scenes: [{ where: 'can-ho', time: 'dawn', staging: 'Lan stands at the door on the right.', shots: [{ id: '1', size: 'wide', who: ['lan'], action: 'Lan opens the door.' }] }] });
    assert.equal(hand.saved, true); assert.deepEqual(written(dir), [1, 2]); assert.ok(readFlow(dir).nodes.e2 && readFlow(dir).nodes['e2-s1']); assert.deepEqual(hand.episodes.written, [1, 2]);
    // the series: what someone wears is changed — the person and their sheet are written again, the face is not
    const series = structuredClone(had.series); series.cast.lan.wardrobe = 'a red coat';
    const three = await put('/api/series', series); assert.equal(three.saved, true); assert.deepEqual(three.changed.updated.sort(), ['lan', 'lan-sheet']); assert.equal(readSeries(dir).cast.lan.wardrobe, 'a red coat');
    // A face an older Songbe drew was drawn with the clothes described. When only the clothes change, the face that stands is held —
    // the same person in other clothes — and let go of again when their looks change.
    const old = readFlow(dir); old.nodes['minh-face'] = { kind: 'picture', prompt: '@style Portrait of @minh.', aspect: '3:4', by: 'director', of: sha(['face', { id: 'minh', name: 'Minh', own: null, medium: true }]) }; old.nodes['minh-face'].as = sha((({ by, as, of, xy, ...rest }) => rest)(old.nodes['minh-face'])); writeFlow(dir, old);
    const drawn = standIns(), named = drawn.modelFor; drawn.modelFor = (role, name) => ({ ...named(role, name), name: name || 'nano-banana-2.1' });      // (under the name the app itself would ask, so that the app finds the takes)
    await runFlow(dir, readFlow(dir), { use: drawn, want: ['minh-face', 'lan-face'] }); const stood = (await get('/api/state')).rows.find((x) => x.id === 'minh-face'); assert.equal(stood.state, 'ready');
    const suit = structuredClone(series); suit.cast.minh.wardrobe = 'a grey suit'; suit.cast.lan.wardrobe = 'a green dress';
    const dressed = await put('/api/series', suit); assert.deepEqual(dressed.changed.held, ['minh-face'], 'only the face that would have been drawn again');
    assert.deepEqual(dressed.rows.filter((x) => /-face$/.test(x.id)).map((x) => `${x.id} ${x.state} ${x.n}`), ['lan-face ready 1', 'minh-face held 1']); assert.equal(dressed.rows.find((x) => x.id === 'minh-face').take, stood.take);
    const older = structuredClone(suit); older.cast.minh.look = '45, broad shoulders, grey at the temples'; const aged = await put('/api/series', older); assert.equal(aged.rows.find((x) => x.id === 'minh-face').state, 'make', 'other looks: the face follows again');
    series.cast = older.cast;
    // models by name, and nobody the scripts still need may leave
    assert.match((await put('/api/series', { ...series, models: { clip: 'sora-9' } })).bad[0], /models\.clip: no model is called "sora-9"/); assert.match((await put('/api/series', { ...series, models: { clip: 'gemini-tts' } })).bad[0], /models\.clip: gemini-tts makes a voice, not a clip/);
    const fewer = structuredClone(series); delete fewer.cast.minh; const left = await put('/api/series', fewer); assert.equal(left.saved, false); assert.match(left.bad.join('\n'), /episode 1: scenes\[0\]\.shots\[\d\]\.who: "minh" is not in the cast/); assert.ok(readSeries(dir).cast.minh);
    const veo = await put('/api/series', { ...series, models: { talk: 'veo-3.1-fast' }, retakes: 2, budget: 12 }); assert.equal(veo.saved, true); assert.deepEqual([veo.flow.models, veo.flow.retakes, veo.flow.budget], [{ talk: 'veo-3.1-fast' }, 2, 12]); assert.equal(veo.flow.nodes['e1-s1-line'].fit, '@e1-s1', 'a model that speaks films first: the line is now recorded to its lips');
    assert.match((await put('/api/series', { ...series, retakes: 7 })).bad[0], /retakes: how many more takes/); assert.match((await put('/api/series', { ...series, episodes: [{ summary: 'x' }] })).bad[0], /episodes\[0\]: every episode planned needs a title/);
  } finally { s.close(); }
});

test('in the app: a film is written from an idea, listed on the home screen, and its next episode written from the canvas', async () => {
  const home = fresh('app-home'), draft = { title: SERIES.title, logline: 'Một bí mật.', style: SERIES.style, look: SERIES.look, accent: SERIES.accent, cast: structuredClone(SERIES.cast), places: SERIES.places, episodes: SERIES.episodes };
  const model = scripted(draft, EPISODE, EPISODE), s = await serve({ port: 0, home, ask: model.ask }), origin = s.url.replace(/\/$/, '');
  const get = (p) => fetch(origin + p).then((r) => r.json()), send = (p, body) => fetch(origin + p, { method: 'POST', headers: { 'X-Songbe': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
  const until = async (ask, done) => { for (let i = 0; i < 100; i++) { const x = await ask(); if (done(x)) return x; await new Promise((r) => setTimeout(r, 40)); } throw new Error('it never finished'); };
  try {
    assert.deepEqual((await get('/api/home')).films, []);
    assert.match((await send('/api/films', { idea: 'Too short' })).error, /Say a little more about the story/);
    const made = await send('/api/films', { idea: 'Lan phát hiện chồng rời nhà lúc hai giờ sáng.', episodes: 2, seconds: 12, format: 'tall' }); assert.match(made.id, /^[0-9a-f]{16}$/);
    const job = await until(() => get('/api/filmwriting/' + made.id), (j) => j.done); assert.equal(job.error, null); assert.equal(job.step, 'canvas');
    // on disk: the series, the script of episode 1, and the canvas laid out from them — nothing drawn or filmed
    const film = (await get('/api/home')).films[0], dir = film.dir; assert.equal(path.dirname(dir), home); assert.equal(path.basename(dir), 'Lan phát hiện chồng rời');
    assert.deepEqual([film.title, film.planned, film.written, film.cut, film.poster, film.nodes], ['Hai giờ sáng', 2, 1, 0, null, 24]); assert.deepEqual(film.size, [1080, 1920]);
    assert.equal(readSeries(dir).seconds, 12); assert.equal(readEpisode(dir, 1).scenes.length, 1); assert.ok(readFlow(dir).nodes.e1);
    // the canvas says which episodes there are and what making a part of one would ask for
    const at = `/c/${made.id}`, st = await get(at + '/api/state'); assert.deepEqual([st.title, st.episodes.planned.map((e) => e.n), st.episodes.written, st.episodes.writing], ['Hai giờ sáng', [1, 2], [1], null]);
    const board = await get(at + '/api/plan?episode=1&upto=board'); assert.deepEqual(board.pieces.map((p) => p.id), ['lan-face', 'lan-sheet', 'minh-face', 'minh-sheet', 'can-ho-plate', 'e1-scene1', 'e1-s1-frame', 'e1-s2-frame', 'e1-s3-frame']);
    assert.equal(board.usd, .45); assert.equal(board.budget, 5); assert.ok((await get(at + '/api/plan?episode=1')).pieces.length > board.pieces.length);
    assert.match((await send(at + '/api/run', { episode: 7 })).error, /no episode 7 on this canvas/);
    // the next episode: written in the background, then on the canvas beside the first
    assert.deepEqual(await send(at + '/api/episode', {}), { started: true, n: 2 });
    const after = await until(() => get(at + '/api/state'), (x) => x.episodes.written.length === 2 && !x.episodes.writing); assert.equal(after.episodes.failed, null); assert.ok(after.flow.nodes.e2 && after.flow.nodes['e2-s1-line']);
    assert.match(model.asked[2].prompt, /THE STORY SO FAR\nEpisode 1: Hai giờ sáng/); assert.match((await send(at + '/api/episode', {})).error, /Every episode the series plans has its script/);
    assert.equal((await fetch(origin + at + '/poster')).status, 404, 'no picture yet to stand for the film');
  } finally { s.close(); }
});
