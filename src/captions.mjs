// Captions: which words to show, when, and on which line. Pure functions apart from pausesIn(), which listens to a voice clip.
import { run, tools } from './util.mjs';

// In a "say" line, {spoken|shown} gives two forms of the same words: the first is read aloud, the second appears in captions
// ("{Vi Síp hai|VSIP 2}", "{zero nine hundred|0900}").
export const ALT = /\{([^|{}]*)\|([^{}]*)\}/g;
export const spokenOf = (raw) => raw.replace(ALT, '$1');
export const shownOf = (raw) => raw.replace(ALT, '$2');

// Pauses inside a voice clip, as [from, to] in seconds from its start (the clip itself is already trimmed of silence at both ends).
export function pausesIn(file) {
  try {
    const err = run(tools.ffmpeg, ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-34dB:d=0.16', '-f', 'null', '-'], { stderr: true });
    const a = [...err.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]), b = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
    return a.map((x, i) => [x, b[i] ?? x]).filter(([x, y]) => x > .05 && y > x);
  } catch { return []; }
}

// Words of one sentence with times, without speech recognition. The voice pauses at commas and full stops, and those pauses can be
// heard in the clip: when there are as many pauses as punctuation marks, each stretch of speech between two pauses is matched to its
// words and the time is shared out by word length inside it. Otherwise the whole sentence is shared out by word length, with a
// little extra after punctuation.
export function timedWords(raw, start, end, pauses = []) {
  const segs = []; let at = 0, m; ALT.lastIndex = 0;
  while ((m = ALT.exec(raw))) { if (m.index > at) segs.push({ speak: raw.slice(at, m.index) }); segs.push({ speak: m[1], show: m[2] }); at = ALT.lastIndex; }
  if (at < raw.length) segs.push({ speak: raw.slice(at) });
  const letters = (x) => x.replace(/[^\p{L}\p{N}]/gu, '').length, stop = (x) => /[,;:.!?…]$/.test(x), weigh = (x) => letters(x) + 1.5;
  const units = [];                                       // { text, w, stops: pauses the voice makes after this word }
  for (const sg of segs) {
    const spoken = sg.speak.split(/\s+/).filter(Boolean);
    if (sg.show !== undefined) {                          // the shown words share the time of the spoken ones
      const total = spoken.reduce((a, x) => a + weigh(x), 0) || 1, inner = spoken.slice(0, -1).filter(stop).length;
      const shown = sg.show.split(/\s+/).filter(Boolean), size = shown.reduce((a, x) => a + x.length + 1, 0) || 1;
      shown.forEach((x, i) => units.push({ text: x, w: total * (x.length + 1) / size, stops: 0, inner: i === 0 ? inner : 0, last: i === shown.length - 1 && stop(spoken[spoken.length - 1] || '') }));
    } else for (const x of spoken) {
      if (!letters(x) && units.length) { const u = units[units.length - 1]; u.text += x; u.last = true; }      // stray punctuation joins the word before it
      else units.push({ text: x, w: weigh(x), last: stop(x) });
    }
  }
  if (!units.length) return [];
  const a = start + .02, span = Math.max(.1, end - start - .04), out = (u, t0, t1) => ({ text: u.text, t0: +t0.toFixed(3), t1: +t1.toFixed(3) });
  // stretches of words between the voice's pauses; a {spoken|shown} group may hide pauses of its own (a phone number read in groups)
  const groups = [[]]; let need = 0;
  units.forEach((u, i) => { groups[groups.length - 1].push(u); need += u.inner || 0; if (u.last && i < units.length - 1) { groups.push([]); need++; } });
  const hidden = units.some((u) => u.inner);
  pauses = pauses.filter(([, to]) => to < end - start - .15);        // the quiet tail of the clip is not a pause between words
  if (need > 0 && pauses.length >= need && !hidden) {
    const cut = [...pauses].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, need).sort((p, q) => p[0] - q[0]);
    const edges = [0, ...cut.flat(), end - start];     // speech runs edges[0]–[1], [2]–[3], …
    return groups.flatMap((g, k) => {
      const t0 = start + edges[2 * k], t1 = start + edges[2 * k + 1], sum = g.reduce((x, u) => x + u.w, 0) || 1; let acc = 0;
      return g.map((u) => { const from = t0 + (t1 - t0) * acc / sum; acc += u.w; return out(u, from, t0 + (t1 - t0) * acc / sum); });
    });
  }
  const w = units.map((u, i) => u.w + (u.last && i < units.length - 1 ? 2.8 : 0)), sum = w.reduce((x, y) => x + y, 0) || 1; let acc = 0;
  return units.map((u, i) => { const from = a + span * acc / sum; acc += w[i]; return out(u, from, a + span * (acc - (w[i] - u.w)) / sum); });
}
// Group timed words into short lines. Clauses (text up to a comma or full stop) stay together when they fit; short neighbours are
// joined; a clause that is too long is split into lines of even length rather than filled greedily, so no word is left alone.
export function captionLines(words, limit) {
  const size = (l) => l.reduce((a, w) => a + w.text.length + 1, -1);
  const clauses = []; let cur = [];
  for (const w of words) { cur.push(w); if (/[,;:.!?…]$/.test(w.text)) { clauses.push(cur); cur = []; } }
  if (cur.length) clauses.push(cur);
  const joined = [];
  for (const c of clauses) { const last = joined[joined.length - 1]; if (last && size(last) + 1 + size(c) <= limit) last.push(...c); else joined.push([...c]); }
  const lines = [];
  for (const c of joined) {
    if (size(c) <= limit * 1.3) { lines.push(c); continue; }           // slightly long is fine: the page shrinks the type to fit
    const n = Math.ceil(size(c) / limit), target = size(c) / n; let part = [], len = 0;
    for (const w of c) {
      if (part.length && lines.length < Infinity && len + 1 + w.text.length / 2 > target && part.length) { lines.push(part); part = []; len = 0; }
      part.push(w); len += (len ? 1 : 0) + w.text.length;
    }
    if (part.length) lines.push(part);
  }
  return lines.map((l) => ({ start: l[0].t0, end: l[l.length - 1].t1, words: l }));
}
