// The cut: chosen clips in order → one film (mp4). Each clip is brought to the frame and trimmed to its part; its sound is what the
// part calls for (the clip's own, our recording of the line, or both); the lines become subtitles timed to the recordings; music
// goes under everything and gives way to speech; the whole is levelled like the other videos Songbe makes. Beside the film it
// writes the subtitles (.srt) and the timeline (.json: where each part starts and ends, and where its line is).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasSound, secondsOf } from './models.mjs';
import { LEAD, TAIL } from './series.mjs';
import { layLine, speechSpans, spokenPart } from './speech.mjs';
import { run, tools } from '../util.mjs';

const SR = 48000, FPS = 30, SPEECH = -21;      // dB the lines are brought to before the mix
const ff = (args, cwd) => { const r = spawnSync(tools.ffmpeg, ['-v', 'error', '-y', ...args], { encoding: 'utf8', cwd, windowsHide: true, maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error('ffmpeg failed: ' + String(r.stderr || r.error?.message).trim().split('\n').slice(-3).join(' | ')); };
const meanOf = (file) => parseFloat(run(tools.ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { stderr: true }).match(/mean_volume: ([-\d.]+)/)?.[1] ?? 'NaN');
const stamp = (t, sep = ',') => { const ms = Math.max(0, Math.round(t * 1000)); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
const assTime = (t) => { const cs = Math.max(0, Math.round(t * 100)); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const assText = (s) => String(s).replace(/[{}]/g, '').replace(/\s*\n\s*/g, '\\N').trim();

// Where every part falls: [{ id, start, end, from, length, pad, how, text, who, line: [start, end] | null, lay }]
// A clip in which the model spoke the line itself becomes a "dub" part when the line was also recorded in the person's own voice:
// `lay` says which piece of the recording goes where (times within the clip), and the part is cut close around the line.
export function timeline(parts) {
  let t = 0;
  return parts.map((p) => {
    const have = secondsOf(p.file), native = (p.info?.how || 'plain') === 'native';
    // the line was recorded to these lips (p.lay: it is already in place, in a recording as long as the clip), or it was recorded
    // beforehand and is now stretched onto where the model spoke
    const ready = native && p.voice && !p.ownVoice && p.lay?.length ? p.lay : null, mine = !ready && native && p.voice && !p.ownVoice ? speechSpans(p.voice) : [];
    const spoke = mine.length ? spokenPart(p.info?.spoke || [], mine.reduce((s, [a, b]) => s + b - a, 0)) : [];
    const lay = ready || (spoke.length ? layLine(spoke, mine) : null), how = lay ? 'dub' : native && p.voice && !p.ownVoice ? 'over' : p.info?.how || 'plain';      // the model stayed silent: the line is laid over
    const ends = lay ? lay.at(-1).at + lay.at(-1).lasts : 0;
    const from = Math.max(0, p.from ?? (lay ? lay[0].at - LEAD : 0)), to = Math.min(have + 2, p.to ?? (lay ? Math.max(ends + TAIL, from + (p.info?.length || 0)) : p.info?.length ? from + p.info.length : have)), length = +Math.max(.2, Math.min(to, lay ? have : to) - from).toFixed(3);
    const said = p.voice && !lay ? secondsOf(p.voice) : null, at = Math.max(0, LEAD - from);
    const line = !p.text ? null : lay ? [t + lay[0].at - from, Math.min(t + length, t + ends - from + .12)] : said !== null && how !== 'native' ? [t + at, Math.min(t + length, t + at + said + .15)] : [t + .2, t + length - .15];
    const row = { id: p.id, start: +t.toFixed(3), end: +(t + length).toFixed(3), from: +from.toFixed(3), length, pad: +Math.max(0, from + length - have).toFixed(3), how, text: p.text || null, who: p.who || null, line: line && line.map((x) => +x.toFixed(3)), ...(lay ? { lay, placed: !!ready } : {}) };
    t += length; return row;
  });
}

function subtitles(rows, { size: [w, h], title, notice, total }) {
  const tall = h > w, body = Math.round(w * (tall ? .05 : .034)), low = Math.round(h * (tall ? .17 : .07)), side = Math.round(w * .07);
  const style = (name, px, bold, align, l, r, v, outline, colour = '&H00FFFFFF') => `Style: ${name},Arial,${px},${colour},&H000000FF,&H00101010,&H80000000,${bold ? -1 : 0},0,0,0,100,100,0,0,1,${outline},0,${align},${l},${r},${v},1`;
  const events = [];
  if (title) events.push(`Dialogue: 1,${assTime(.25)},${assTime(Math.min(total, 3.2))},Title,,0,0,0,,{\\fad(350,450)}${assText(title)}`);
  if (notice) events.push(`Dialogue: 0,${assTime(0)},${assTime(total)},Notice,,0,0,0,,${assText(notice)}`);
  for (const r of rows) if (r.line) events.push(`Dialogue: 2,${assTime(r.line[0])},${assTime(r.line[1])},Line,,0,0,0,,${assText(r.text)}`);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`
    + [style('Line', body, true, 2, side, side, low, Math.max(2, Math.round(body * .09))), style('Title', Math.round(body * 1.7), true, 8, side, side, Math.round(h * (tall ? .16 : .1)), Math.max(3, Math.round(body * .12))),
      style('Notice', Math.round(body * .5), false, 9, side, Math.round(w * .03), Math.round(h * .025), 1, '&H50FFFFFF')].join('\n')
    + `\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`;
}

export function cut(file, { parts, music = null, title = null, notice = null, subtitles: subs = true, musicVolume = .22, size = [1080, 1920] }) {
  if (!parts?.length) throw new Error('a cut needs at least one clip');
  const work = file + '.work', [w, h] = size, rows = timeline(parts), total = rows.at(-1).end;
  fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  try {
    parts.forEach((p, i) => {
      const r = rows[i], n = String(i).padStart(3, '0'), own = hasSound(p.file), how = r.how;
      // the picture of this part: the frame's size, a steady frame rate, held on its last frame when the clip is a little short
      ff(['-ss', String(r.from), '-i', p.file, '-t', String(r.length), '-an', '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1,fps=${FPS}${r.pad > 0 ? `,tpad=stop_mode=clone:stop_duration=${r.pad + .1}` : ''},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-video_track_timescale', '15360', path.join(work, `v${n}.mp4`)]);
      // its sound. A clip that acted to our recording and kept it already holds the line; one that did not keep it, or in which the
      // voice is only heard, gets the recording laid in; a model that spoke the line itself is taken as it is.
      const dub = how === 'dub', lay = !dub && p.voice && how !== 'native' && !(how === 'voice' && p.info?.keeps && own), keepOwn = own && !(how === 'voice' && !p.info?.keeps);
      const inputs = [], chains = [], mix = [];
      // where the model spoke its sound is turned right down, and the rest of it — the room, a step, a door — stays
      const hush = dub ? r.lay.map((l) => `,volume=0.04:enable='between(t,${Math.max(0, l.at - r.from - .05).toFixed(3)},${(l.at - r.from + l.lasts + .08).toFixed(3)})'`).join('') : '';
      if (keepOwn) { inputs.push('-ss', String(r.from), '-t', String(r.length), '-i', p.file); chains.push(`[${mix.length}:a]aresample=${SR},aformat=channel_layouts=stereo,volume=${lay ? .55 : 1}${hush},apad=whole_dur=${r.length}[a${mix.length}]`); mix.push(`[a${mix.length}]`); }
      else { inputs.push('-f', 'lavfi', '-t', String(r.length), '-i', `anullsrc=r=${SR}:cl=stereo`); chains.push(`[${mix.length}:a]anull[a${mix.length}]`); mix.push(`[a${mix.length}]`); }
      if (lay) { const at = LEAD - r.from; inputs.push(...(at < 0 ? ['-ss', String(-at)] : []), '-i', p.voice);
        chains.push(`[${mix.length}:a]aresample=${SR},aformat=channel_layouts=stereo${at > 0 ? `,adelay=${Math.round(at * 1000)}:all=1` : ''},apad=whole_dur=${r.length}[a${mix.length}]`); mix.push(`[a${mix.length}]`); }
      // the person's own voice, phrase by phrase, each brought to the length of the place it goes
      if (dub && r.placed) { inputs.push('-ss', String(r.from), '-t', String(r.length), '-i', p.voice); chains.push(`[${mix.length}:a]aresample=${SR},aformat=channel_layouts=stereo,apad=whole_dur=${r.length}[a${mix.length}]`); mix.push(`[a${mix.length}]`); }
      else if (dub) for (const l of r.lay) { const at = Math.max(0, l.at - r.from); inputs.push('-ss', String(l.from), '-t', String(+(l.to - l.from).toFixed(3)), '-i', p.voice);
        chains.push(`[${mix.length}:a]aresample=${SR},atempo=${l.tempo},aformat=channel_layouts=stereo${at > 0 ? `,adelay=${Math.round(at * 1000)}:all=1` : ''},apad=whole_dur=${r.length}[a${mix.length}]`); mix.push(`[a${mix.length}]`); }
      const raw = path.join(work, `r${n}.wav`), out = path.join(work, `a${n}.wav`);
      ff([...inputs, '-filter_complex', `${chains.join(';')};${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=longest,atrim=duration=${r.length}[o]`, '-map', '[o]', '-t', String(r.length), '-ar', String(SR), '-ac', '2', raw]);
      // lines are brought to one level, so a voice does not jump between a shot that carries it and one it was laid into
      const mean = r.text ? meanOf(raw) : NaN, gain = Number.isFinite(mean) ? Math.max(-12, Math.min(12, SPEECH - mean)) : 0;
      ff(['-i', raw, '-af', `volume=${gain.toFixed(2)}dB,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, r.length - .03).toFixed(3)}:d=0.03`, '-t', String(r.length), '-ar', String(SR), '-ac', '2', out]);
    });
    const names = (kind, ext) => parts.map((_, i) => `file '${kind}${String(i).padStart(3, '0')}.${ext}'`).join('\n') + '\n';
    fs.writeFileSync(path.join(work, 'v.txt'), names('v', 'mp4')); fs.writeFileSync(path.join(work, 'a.txt'), names('a', 'wav'));
    ff(['-f', 'concat', '-safe', '0', '-i', 'v.txt', '-c', 'copy', 'picture.mp4'], work);
    ff(['-f', 'concat', '-safe', '0', '-i', 'a.txt', '-c', 'copy', 'sound.wav'], work);
    // music under everything, giving way while someone speaks
    const fadeOut = `afade=t=out:st=${Math.max(0, total - 1.2).toFixed(2)}:d=1.2`;
    if (music) {
      const len = secondsOf(music), loop = total > len - .3 ? `aloop=loop=-1:size=${Math.round((len - .2) * SR)},` : '';
      ff(['-i', 'sound.wav', '-i', music, '-filter_complex', `[0:a]asplit[s][k];[1:a]aresample=${SR},aformat=channel_layouts=stereo,${loop}atrim=0:${total},asetpts=PTS-STARTPTS,volume=${musicVolume},afade=t=in:d=0.6,${fadeOut}[m0];[m0][k]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=420[m];[s][m]amix=inputs=2:normalize=0:weights=1 1,loudnorm=I=-14:TP=-1.5:LRA=11[o]`,
        '-map', '[o]', '-t', String(total), '-ar', String(SR), '-ac', '2', 'mix.wav'], work);
    } else ff(['-i', 'sound.wav', '-af', `loudnorm=I=-14:TP=-1.5:LRA=11,${fadeOut}`, '-t', String(total), '-ar', String(SR), '-ac', '2', 'mix.wav'], work);
    const shown = subs || title || notice;
    if (shown) fs.writeFileSync(path.join(work, 'subs.ass'), subtitles(subs ? rows : rows.map((r) => ({ ...r, line: null })), { size, title, notice, total }));
    ff(['-i', 'picture.mp4', '-i', 'mix.wav', '-vf', `${shown ? 'ass=subs.ass,' : ''}fade=t=in:d=0.25,fade=t=out:st=${Math.max(0, total - .45).toFixed(2)}:d=0.45`, '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-t', String(total), '-movflags', '+faststart', 'film.mp4'], work);
    fs.copyFileSync(path.join(work, 'film.mp4'), file);
    const spoken = rows.filter((r) => r.line);
    fs.writeFileSync(file.replace(/\.mp4$/, '') + '.srt', spoken.map((r, i) => `${i + 1}\n${stamp(r.line[0])} --> ${stamp(r.line[1])}\n${r.text}\n`).join('\n'));
    fs.writeFileSync(file.replace(/\.mp4$/, '') + '.json', JSON.stringify({ seconds: total, size, parts: rows }, null, 1));
    return { seconds: total, parts: rows };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
