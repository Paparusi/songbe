// Self-check after a build: is there sound, how loud, how long, and what does each scene look like?
// Writes out/sheet.jpg (two frames per scene) and out/check.json so a person or an agent can review without playing the file.
import fs from 'node:fs';
import path from 'node:path';
import { run, mkdir, tools, exists } from './util.mjs';

export async function check(dir, plan) {
  const out = path.join(dir, 'out'), tag = plan.tag || '', video = path.join(out, `video${tag}.mp4`), problems = [];
  if (!exists(video)) throw new Error(`nothing to check: out/video${tag}.mp4 is missing`);
  const info = JSON.parse(run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels', '-of', 'json', video]));
  const v = info.streams.find((s) => s.codec_type === 'video'), a = info.streams.find((s) => s.codec_type === 'audio');
  const dur = parseFloat(info.format.duration);
  if (!a) problems.push('no audio stream');
  if (Math.abs(dur - plan.duration) > 0.15) problems.push(`duration ${dur.toFixed(2)}s differs from the plan (${plan.duration}s)`);
  let loud = null;
  if (a) {
    const err = run(tools.ffmpeg, ['-hide_banner', '-i', video, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { stderr: true });
    loud = { mean: parseFloat(err.match(/mean_volume: ([-\d.]+)/)?.[1]), peak: parseFloat(err.match(/max_volume: ([-\d.]+)/)?.[1]) };
    if (loud.mean < -40) problems.push(`audio is nearly silent (mean ${loud.mean} dB)`);
  }

  // watch the whole picture once: black frames, single-frame flashes and long stills are things a contact sheet cannot show
  const notes = [...(plan.notes || [])], nearCut = (t) => plan.cuts.some((c) => t > c - .45 && t < c + .5);
  const seenLog = run(tools.ffmpeg, ['-hide_banner', '-i', video, '-an', '-vf', "blackdetect=d=0.1:pix_th=0.03,freezedetect=n=0.003:d=2.5,select='gt(scene,0.45)',showinfo", '-f', 'null', '-'], { stderr: true });
  for (const m of seenLog.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) if (!nearCut(+m[1])) problems.push(`black frames from ${(+m[1]).toFixed(2)} s to ${(+m[2]).toFixed(2)} s`);
  const jumps = [...seenLog.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]).filter((t) => !nearCut(t));
  // an abrupt change is a flash when the picture is the same just before and just after it, and a cut otherwise
  const tiny = (t) => run(tools.ffmpeg, ['-v', 'error', '-ss', Math.max(0, t).toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=64:-2,format=gray', '-f', 'rawvideo', '-'], { binary: true });
  const alike = (a, b) => { const n = Math.min(a.length, b.length); let sum = 0; for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]); return n > 0 && sum / n < 8; };
  for (const t of jumps) {
    if (alike(tiny(t - .12), tiny(t + .12))) problems.push(`a flash at ${t.toFixed(2)} s: the picture jumps and comes straight back`);
    else notes.push(`the picture changes abruptly at ${t.toFixed(2)} s (a cut inside the footage?)`);
  }
  const stills = [...seenLog.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]), lengths = [...seenLog.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => +m[1]);
  stills.forEach((t, i) => notes.push(`the picture does not move for ${(lengths[i] ?? dur - t).toFixed(1)} s from ${t.toFixed(2)} s`));
  if (loud && loud.peak > -0.3) notes.push(`the sound peaks at ${loud.peak} dB, close to clipping`);
  // what the layout check found while the picture was being drawn
  const layoutFile = path.join(dir, '.songbe', 'layout.json'), layout = exists(layoutFile) ? JSON.parse(fs.readFileSync(layoutFile, 'utf8')) : [];
  for (const f of layout) (f.level === 'problem' ? problems : notes).push(`scene ${f.scene} (${f.type}): ${f.message}`);

  // two frames per scene (35 % and 85 % through) tiled into one sheet
  const tmp = mkdir(path.join(dir, '.songbe', 'sheet')); for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f));
  const times = plan.scenes.flatMap((s) => [s.start + (s.end - s.start) * .35, s.start + (s.end - s.start) * .85]).map((t) => Math.min(t, dur - .05));
  const wide = plan.size[0] > plan.size[1];
  times.forEach((t, i) => run(tools.ffmpeg, ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', `scale=${wide ? 640 : 360}:-1`, '-q:v', '3', path.join(tmp, `${String(i).padStart(3, '0')}.jpg`)]));
  const cols = Math.min(times.length, wide ? 3 : 6), sheet = path.join(out, `sheet${tag}.jpg`);
  run(tools.ffmpeg, ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, '%03d.jpg'), '-vf', `tile=${cols}x${Math.ceil(times.length / cols)}:padding=8:color=white`, '-frames:v', '1', '-q:v', '3', sheet]);

  // optional: transcribe the mix and report what is actually audible (needs GROQ_API_KEY)
  let heard = null;
  const spoken = plan.scenes.flatMap((s) => s.say).filter((s) => s.file).map((s) => s.text);
  if (a && spoken.length && process.env.GROQ_API_KEY) {
    try {
      const mp3 = path.join(dir, '.songbe', 'check.mp3');
      run(tools.ffmpeg, ['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3]);
      const body = new FormData();
      body.append('file', new Blob([fs.readFileSync(mp3)]), 'check.mp3'); body.append('model', 'whisper-large-v3');
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body });
      heard = (await r.json()).text?.trim() || null;
    } catch (e) { heard = null; }
  }

  const report = { ok: problems.length === 0, problems, frame: plan.size.join('x'), duration: dur, sizeMB: +(info.format.size / 1048576).toFixed(1), picture: v && `${v.width}x${v.height} ${v.codec_name}`,
    audio: a ? `${a.codec_name} ${a.sample_rate} Hz ${a.channels}ch` : null, loudness: loud, scenes: plan.scenes.map((s) => ({ type: s.type, start: s.start, end: s.end })),
    spoken, heard, notes, sheet, video };
  fs.writeFileSync(path.join(out, `check${tag}.json`), JSON.stringify(report, null, 1));
  return report;
}
