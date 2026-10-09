// Where someone speaks in a sound, and how a recorded line is laid onto the place where an actor's lips moved.
//
// A clip model that speaks a line itself gives a fine performance in a voice of its own choosing — a different one every time.
// To keep a person's voice the same from shot to shot, the model's voice is taken out where it spoke and the line as recorded in
// that person's own voice is put there instead, stretched a little to last as long, phrase by phrase when both pause alike.
// Nothing here needs a key: speech is found by how loud the band of the voice is.
import { run, tools } from '../util.mjs';

const RATE = 16000, FRAME = .02;      // the sound is looked at 16,000 times a second, in steps of a fiftieth of a second
// [[start, end], …] in seconds: the stretches of `file` in which a voice is heard. Pauses shorter than `gap` join their neighbours;
// anything shorter than a seventh of a second is not speech.
export function speechSpans(file, { gap = .22 } = {}) {
  const raw = run(tools.ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-af', 'highpass=f=250,lowpass=f=3600', '-f', 's16le', '-'], { binary: true });
  const x = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1), n = Math.floor(RATE * FRAME), loud = [];
  for (let s = 0; s + n <= x.length; s += n) { let e = 0; for (let i = 0; i < n; i++) e += x[s + i] * x[s + i]; loud.push(Math.sqrt(e / n)); }
  if (!loud.length) return [];
  const sorted = [...loud].sort((a, b) => a - b), top = sorted[Math.floor(sorted.length * .95)], floor = sorted[Math.floor(sorted.length * .1)];
  if (top < 120) return [];                                                   // nothing but room tone
  const line = Math.max(Math.min(floor * 3, top * .5), top * .14), spans = [];      // well above the quiet of this sound, well below its voice
  let from = -1;
  loud.forEach((v, i) => { if (v >= line && from < 0) from = i; if ((v < line || i === loud.length - 1) && from >= 0) { spans.push([from * FRAME, (v < line ? i : i + 1) * FRAME]); from = -1; } });
  const joined = [];
  for (const s of spans) { const last = joined.at(-1); if (last && s[0] - last[1] < gap) last[1] = s[1]; else joined.push([...s]); }
  return joined.filter(([a, b]) => b - a >= .14).map(([a, b]) => [+Math.max(0, a - .02).toFixed(2), +(b + .02).toFixed(2)]);
}

// Of everything that sounded like a voice in a clip, the run of stretches that is most likely the line: the one whose length is
// nearest to how long the line takes to say. (A door, a step or a sigh before or after the line is left out this way.)
export function spokenPart(spans, seconds) {
  let best = [], off = Infinity;
  for (let i = 0; i < spans.length; i++) for (let j = i; j < spans.length; j++) {
    const part = spans.slice(i, j + 1), lasts = part.reduce((t, [a, b]) => t + b - a, 0), d = Math.abs(lasts - seconds) + (part.at(-1)[1] - part[0][0] - lasts) * .15;      // a little against long pauses inside
    if (d < off) { off = d; best = part; }
  }
  return best;
}

const SLOW = .84, FAST = 1.22;      // how far a recording may be stretched before it sounds wrong
// Lays a recorded line onto where the actor spoke. `spoke` and `said` are the stretches of speech in the clip and in the recording.
// → [{ from, to (in the recording), at (in the clip), tempo }]: phrase onto phrase when both have the same number of them, the
// whole line onto the whole stretch otherwise. A phrase that would need more stretching than sounds right keeps the nearest speed
// that does and is centred on its place.
export function layLine(spoke, said) {
  if (!spoke.length || !said.length) return [];
  const pairs = spoke.length === said.length && spoke.length <= 5 ? spoke.map((s, i) => [s, said[i]]) : [[[spoke[0][0], spoke.at(-1)[1]], [said[0][0], said.at(-1)[1]]]];
  return pairs.map(([[a, b], [c, d]]) => { const want = (d - c) / (b - a), tempo = Math.min(FAST, Math.max(SLOW, want)), takes = (d - c) / tempo;
    return { from: +c.toFixed(3), to: +d.toFixed(3), at: +Math.max(0, a + (b - a - takes) / 2).toFixed(3), tempo: +tempo.toFixed(4), lasts: +takes.toFixed(3) }; });
}
