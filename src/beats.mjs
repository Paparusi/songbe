// Where the beats of a piece of music fall, found from the sound alone. No library and no service: the track is decoded by ffmpeg,
// its onsets are measured (spectral flux), the tempo is the lag at which the onsets best repeat, and the phase is where a grid of that
// tempo collects the most onset energy. Good for music with a steady pulse, which is what ads use; a track without one is reported
// as such (low confidence) and left alone.
import fs from 'node:fs';
import path from 'node:path';
import { run, sha, tools } from './util.mjs';

const SR = 22050, N = 1024, HOP = 256, FPS = SR / HOP;      // analysis rate: about 86 frames a second

function fft(re, im) {                                       // in place, length a power of two
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// How strongly something new starts in each analysis frame: over the whole spectrum, and in the bass alone (below about 200 Hz),
// where kick drums live. Both are returned with their slow-moving average removed.
export function onsets(samples) {
  const frames = Math.max(0, Math.floor((samples.length - N) / HOP)), full = new Float64Array(frames), low = new Float64Array(frames);
  const win = Float64Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1))), LOW = Math.round(200 / (SR / N));
  let prev = new Float64Array(N / 2); const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = samples[f * HOP + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float64Array(N / 2);
    for (let b = 0; b < N / 2; b++) {
      mag[b] = Math.log1p(100 * Math.hypot(re[b], im[b]));
      if (f && mag[b] > prev[b]) { full[f] += mag[b] - prev[b]; if (b <= LOW) low[f] += mag[b] - prev[b]; }      // the first frame has nothing before it: not an onset
    }
    prev = mag;
  }
  const stand = (env) => {                                    // keep what stands out from half a second either side
    const out = new Float64Array(frames), half = Math.round(FPS / 2); let sum = 0;
    for (let i = 0; i < Math.min(frames, half); i++) sum += env[i];
    for (let i = 0; i < frames; i++) {
      if (i + half < frames) sum += env[i + half]; if (i - half - 1 >= 0) sum -= env[i - half - 1];
      out[i] = Math.max(0, env[i] - sum / (Math.min(frames - 1, i + half) - Math.max(0, i - half) + 1));
    }
    return out;
  };
  return { full: stand(full), low: stand(low) };
}

// tempo, phase and confidence from the onset envelopes
export function grid({ full, low }) {
  const mean = (e) => e.reduce((a, b) => a + b, 0) / (e.length || 1) || 1, mf = mean(full), ml = mean(low);
  const pick = (e, x) => { const i = Math.floor(x), k = x - i; return i < 0 || i + 1 >= e.length ? 0 : e[i] * (1 - k) + e[i + 1] * k; };
  // how much onset energy a grid of this period (in frames) and phase collects, against the average
  const gather = (e, m, period, o) => { let s = 0, n = 0; for (let x = o; x < e.length - 1; x += period) { s += pick(e, x); n++; } return n ? s / n / m : 0; };
  const comb = (period) => { let best = -1, phase = 0; for (let o = 0; o < period; o++) { const v = gather(full, mf, period, o); if (v > best) { best = v; phase = o; } } return [best, phase]; };
  // coarse search over 70–180 beats a minute, favouring the middle of the range a little so that half and double tempo lose ties
  let top = { score: -1 };
  for (let bpm = 70; bpm <= 180; bpm += .5) {
    const [score] = comb(FPS * 60 / bpm), prior = Math.exp(-.5 * (Math.log2(bpm / 115) / .9) ** 2);
    if (score * prior > top.score) top = { score: score * prior, bpm };
  }
  // fine search around the winner: a tenth of a percent matters over thirty seconds
  let fine = { score: -1 };
  for (let k = -40; k <= 40; k++) { const bpm = top.bpm * (1 + k * .0005), period = FPS * 60 / bpm, [score] = comb(period); if (score > fine.score) fine = { score, bpm, period }; }
  // the phase: where the grid collects the most, counting the bass twice — the beat is where the kick is, not where the hi-hat is
  let phase = 0, best = -1;
  for (let o = 0; o < fine.period; o += .1) { const v = gather(full, mf, fine.period, o) + 2 * gather(low, ml, fine.period, o); if (v > best) { best = v; phase = o; } }
  const bass = gather(low, ml, fine.period, phase), offbeat = gather(low, ml, fine.period, (phase + fine.period / 2) % fine.period);
  return { bpm: +fine.bpm.toFixed(2), period: fine.period / FPS, first: (phase + N / 2 / HOP) / FPS, confidence: +fine.score.toFixed(2), bass: +(bass / (offbeat || 1e-9)).toFixed(1) };
}

// { bpm, period, first, confidence, length } for a music file; cached beside it in dir
export function beatsOf(file, cacheDir) {
  const st = fs.statSync(file), memo = path.join(cacheDir, `beats-${sha(['v2', file, st.size, st.mtimeMs])}.json`);
  if (fs.existsSync(memo)) return JSON.parse(fs.readFileSync(memo, 'utf8'));
  const raw = run(tools.ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { binary: true });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const found = { ...grid(onsets(samples)), length: +(samples.length / SR).toFixed(2) };
  fs.writeFileSync(memo, JSON.stringify(found));
  return found;
}

// Move each cut onto a beat. cuts: the times the voice suggests; lead: how much earlier than suggested a cut may fall without clipping
// the previous line. Returns for each cut { at, delay }: where it lands, and how much everything from that scene on is pushed back.
export function snapCuts(cuts, { period, first }, lead = .15) {
  let pushed = 0; const out = [];
  for (const natural of cuts) {
    const want = natural + pushed, k = Math.ceil((want - lead - first) / period - 1e-9), beat = first + Math.max(0, k) * period, d = beat - want;
    if (d > 0) pushed += d;
    out.push({ at: +beat.toFixed(3), delay: +pushed.toFixed(3) });
  }
  return out;
}
