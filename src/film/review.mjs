// The review: what is wrong with a take, found by looking at it and listening to it. No model is asked and no key is needed — a
// take is decoded small and measured.
//
// A clip model now and then paints a colour of its own onto a face, cuts to another angle halfway, freezes, goes black, or stays
// silent where it was to speak; a voice model drops half a line or says more than the line; a picture comes back in another
// shape. Each of these can be measured, so a run looks at every take it makes, and what it finds is kept with the take:
//   grave      the take cannot be used as it is (nobody says the line, the recording is not the line, the picture never moves).
//              The run asks for another take by itself, and a node whose takes are all like that counts as not made.
//   to look at everything else. The take is used, and the canvas, the board and the command line point at it.
// A finding is { what, says, grave?, at?, to? } — `says` in words a person can act on, `at` and `to` in seconds.
import { secondsOf } from './models.mjs';
import { speechSeconds } from './series.mjs';
import { speechSpans } from './speech.mjs';
import { run, tools } from '../util.mjs';

const SIDE = 48, N = SIDE * SIDE, FPS = 12;      // a take is looked at 48 by 48, a clip twelve times a second
// the frames of a clip (or the one frame of a picture), small, as RGB
function small(file, fps = null) {
  const raw = run(tools.ffmpeg, ['-v', 'error', '-i', file, '-an', ...(fps ? [] : ['-frames:v', '1']), '-vf', `${fps ? `fps=${fps},` : ''}scale=${SIDE}:${SIDE}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { binary: true }), out = [];
  for (let o = 0; o + N * 3 <= raw.length; o += N * 3) out.push(raw.subarray(o, o + N * 3));
  return out;
}
const sizeOf = (file) => run(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).trim().split(/[,\n]/).slice(0, 2).map(Number);
const lum = (f, i) => .299 * f[i] + .587 * f[i + 1] + .114 * f[i + 2];
const blue = (f, i) => 128 - .168736 * f[i] - .331264 * f[i + 1] + .5 * f[i + 2], red = (f, i) => 128 + .5 * f[i] - .418688 * f[i + 1] - .081312 * f[i + 2];
const brightness = (f) => { let s = 0; for (let i = 0; i < f.length; i += 3) s += lum(f, i); return s / N; };
const apart = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 3) s += Math.abs(lum(a, i) - lum(b, i)); return s / N; };      // how far two frames are from each other, 0 to 255
const middle = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);
// the stretches of at least `least` values in a row for which `is` holds: [[first, last], …]
function stretches(values, is, least) {
  const out = []; let from = -1;
  values.forEach((v, i) => { const on = is(v); if (on && from < 0) from = i; if ((!on || i === values.length - 1) && from >= 0) { const last = on ? i : i - 1; if (last - from + 1 >= least) out.push([from, last]); from = -1; } });
  return out;
}

// ---- colours ----
// The colours of a picture, as which cells of the colour plane hold some of it. A strong colour of a later frame that falls in
// none of those cells, nor within two cells of one, is a colour the clip did not start with. (Measured on the clips of a real
// film: light that changes and people who come closer stay at nothing; a patch painted onto a face stood at two per cent.)
const CELL = 12, CELLS = Math.ceil(256 / CELL), STRONG = 34, SOME = .004, NEAR = 2, PATCH = .012;
function palette(frames) {
  const h = new Float32Array(CELLS * CELLS);
  for (const f of frames) for (let i = 0; i < f.length; i += 3) if (lum(f, i) >= 24) h[Math.floor(blue(f, i) / CELL) * CELLS + Math.floor(red(f, i) / CELL)] += 1 / N;
  return h;
}
function known(h, a, b) { let s = 0; for (let x = Math.max(0, a - NEAR); x <= Math.min(CELLS - 1, a + NEAR); x++) for (let y = Math.max(0, b - NEAR); y <= Math.min(CELLS - 1, b + NEAR); y++) s += h[x * CELLS + y]; return s >= SOME; }
// how much of a frame is a strong colour the palette does not have
function strange(f, h) {
  let n = 0;
  for (let i = 0; i < f.length; i += 3) { const u = blue(f, i), v = red(f, i); if (lum(f, i) >= 40 && Math.hypot(u - 128, v - 128) >= STRONG && !known(h, Math.floor(u / CELL), Math.floor(v / CELL))) n++; }
  return n / N;
}

// ---- a clip ----
// `start`: the picture it was to begin on · `how`: how its line reaches the screen ('native': the model was to say it) ·
// `spoke`: where a voice was heard in it · `text`, `language`: the line · `asked`: the seconds asked for
export function reviewClip(file, { start = null, how = null, spoke = null, text = null, language = null, asked = null } = {}) {
  const found = [], secs = (i) => +(i / FPS).toFixed(1);
  if (how === 'native' && spoke && text) {      // the model was to say the line itself
    const heard = spoke.reduce((t, [a, b]) => t + b - a, 0), takes = speechSeconds(text, language || 'English');
    if (!spoke.length) found.push({ what: 'silent', grave: true, says: 'nobody is heard saying the line' });
    else if (takes >= 1 && heard < takes * .35) found.push({ what: 'silent', grave: true, says: `only ${heard.toFixed(1)} s of voice is heard, and the line takes about ${takes.toFixed(1)} s to say` });
  }
  const frames = small(file, FPS);
  if (frames.length < 4) return found;
  const moves = frames.slice(1).map((f, i) => apart(f, frames[i]));
  if (Math.max(...moves) < .06) found.push({ what: 'still', grave: true, says: 'the picture does not move' });
  // a cut inside the clip: one step far larger than the steps around it, with calm on both sides
  for (let i = 1; i < moves.length - 1; i++) {
    const around = middle(moves.slice(Math.max(0, i - 6), i).concat(moves.slice(i + 1, i + 7)));
    if (moves[i] >= 28 && moves[i] >= 4 * Math.max(around, .5) && moves[i - 1] < moves[i] / 2.5 && moves[i + 1] < moves[i] / 2.5) { found.push({ what: 'jump', at: secs(i + 1), says: `the picture jumps at ${secs(i + 1)} s, as if cut to another shot` }); break; }
  }
  const first = start ? small(start)[0] : null, bright = frames.map(brightness);
  if (Math.max(brightness(first || frames[0]), bright[0]) >= 18) for (const [a, b] of stretches(bright, (v) => v < 7, Math.round(FPS * .4)).slice(0, 1)) found.push({ what: 'dark', at: secs(a), to: secs(b + 1), says: `the picture goes black from ${secs(a)} s to ${secs(b + 1)} s` });
  const h = palette(first ? [first, frames[0]] : [frames[0]]), odd = frames.map((f) => strange(f, h));
  for (const [a, b] of stretches(odd, (v) => v >= PATCH, Math.round(FPS * .5)).slice(0, 1)) found.push({ what: 'colour', at: secs(a), to: secs(b + 1), says: `a strong colour that the first frame does not have covers ${(Math.max(...odd.slice(a, b + 1)) * 100).toFixed(1).replace(/\.0$/, '')}% of the picture from ${secs(a)} s to ${secs(b + 1)} s` });
  if (first) { const [pw, ph] = sizeOf(start), [cw, ch] = sizeOf(file);      // only when both have one shape: a model crops a picture of another shape its own way
    if (Math.abs(Math.log((pw / ph) / (cw / ch))) < .03 && apart(first, frames[0]) > 30) found.push({ what: 'start', says: 'it does not begin on the picture it was to start from' }); }
  const lasts = secondsOf(file);
  if (asked && lasts < asked - .6) found.push({ what: 'short', says: `it lasts ${lasts.toFixed(1)} s, and ${asked} s were asked for` });
  return found;
}

// ---- a recorded line ----
export function reviewVoice(file, { text, language = null } = {}) {
  const spans = speechSpans(file), said = spans.reduce((t, [a, b]) => t + b - a, 0), takes = speechSeconds(text, language || 'English'), found = [];
  if (!spans.length) return [{ what: 'nothing', grave: true, says: 'no voice is heard in the recording' }];
  if (said > takes * 2.3 + .6) found.push({ what: 'long', grave: true, says: `the recording holds ${said.toFixed(1)} s of voice for a line that takes about ${takes.toFixed(1)} s to say: more than the line was said` });
  else if (takes >= .7 && said < takes * .4) found.push({ what: 'cut', grave: true, says: `the recording holds ${said.toFixed(1)} s of voice for a line that takes about ${takes.toFixed(1)} s to say: part of the line is missing` });
  const pause = Math.max(0, ...spans.slice(1).map((s, i) => s[0] - spans[i][1]));
  if (pause > 1.8) found.push({ what: 'pause', says: `there is a pause of ${pause.toFixed(1)} s inside the line` });
  return found;
}

// ---- a picture ----
const ratioOf = (aspect) => { const [a, b] = String(aspect).split(':').map(Number); return a > 0 && b > 0 ? a / b : null; };
export function reviewPicture(file, { aspect = null } = {}) {
  const found = [], [w, h] = sizeOf(file), want = aspect ? ratioOf(aspect) : null, f = small(file)[0];
  if (want && w && h && Math.abs(Math.log((w / h) / want)) > .04) found.push({ what: 'shape', says: `it came back ${w}×${h}, not the ${aspect} that was asked for` });
  if (!f) return found;
  const row = (y) => Array.from({ length: SIDE }, (_, x) => lum(f, (y * SIDE + x) * 3)), col = (x) => Array.from({ length: SIDE }, (_, y) => lum(f, (y * SIDE + x) * 3));
  const tone = (line) => { const m = line.reduce((a, b) => a + b, 0) / line.length, s = Math.sqrt(line.reduce((a, b) => a + (b - m) ** 2, 0) / line.length); return { m, s }; };
  const all = tone(Array.from({ length: N }, (_, i) => lum(f, i * 3)));
  if (all.s < 2.5) { found.push({ what: 'blank', says: 'it is one flat colour' }); return found; }
  // a bar: rows of flat black or white from the edge inwards, ending where the picture begins along most of the row at once
  // (a plain wall behind someone is flat too, but it ends where the person begins and goes on beside them)
  const bar = (line) => { const t0 = tone(line(0)); if (t0.s >= 2.5 || (t0.m > 20 && t0.m < 238)) return 0; let k = 1; for (; k < SIDE / 2; k++) { const t = tone(line(k)); if (t.s >= 2.5 || Math.abs(t.m - t0.m) >= 6) break; }
    return k >= 3 && line(k).filter((v) => Math.abs(v - t0.m) > 10).length >= SIDE / 2 ? k : 0; };
  const sides = [[bar(row), bar((y) => row(SIDE - 1 - y)), 'top and bottom'], [bar(col), bar((x) => col(SIDE - 1 - x)), 'left and right']].filter(([a, b]) => a && b).map((x) => x[2]);
  if (sides.length) found.push({ what: 'bars', says: `it has plain bars along its ${sides.join(' and its ')} edges` });
  return found;
}

export const grave = (review) => (review || []).filter((f) => f.grave);
// a review in one line, the grave findings first
export const inWords = (review) => [...grave(review), ...(review || []).filter((f) => !f.grave)].map((f) => f.says).join('; ');
