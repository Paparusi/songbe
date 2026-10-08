// Self-check after a build: is there sound, how loud, how long, and what does each scene look like?
// Writes out/sheet.jpg (two frames per scene) and out/check.json so a person or an agent can review without playing the file.
import fs from 'node:fs';
import path from 'node:path';
import { run, mkdir, tools, exists } from './util.mjs';

export async function check(dir, plan) {
  const out = path.join(dir, 'out'), video = path.join(out, 'video.mp4'), problems = [];
  if (!exists(video)) throw new Error('nothing to check: out/video.mp4 is missing');
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

  // two frames per scene (35 % and 85 % through) tiled into one sheet
  const tmp = mkdir(path.join(dir, '.fw', 'sheet')); for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f));
  const times = plan.scenes.flatMap((s) => [s.start + (s.end - s.start) * .35, s.start + (s.end - s.start) * .85]).map((t) => Math.min(t, dur - .05));
  times.forEach((t, i) => run(tools.ffmpeg, ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=360:-1', '-q:v', '3', path.join(tmp, `${String(i).padStart(3, '0')}.jpg`)]));
  const cols = Math.min(times.length, 6), sheet = path.join(out, 'sheet.jpg');
  run(tools.ffmpeg, ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, '%03d.jpg'), '-vf', `tile=${cols}x${Math.ceil(times.length / cols)}:padding=8:color=white`, '-frames:v', '1', '-q:v', '3', sheet]);

  // optional: transcribe the mix and report what is actually audible (needs GROQ_API_KEY)
  let heard = null;
  const spoken = plan.scenes.flatMap((s) => s.say).filter((s) => s.file).map((s) => s.text);
  if (a && spoken.length && process.env.GROQ_API_KEY) {
    try {
      const mp3 = path.join(dir, '.fw', 'check.mp3');
      run(tools.ffmpeg, ['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3]);
      const body = new FormData();
      body.append('file', new Blob([fs.readFileSync(mp3)]), 'check.mp3'); body.append('model', 'whisper-large-v3');
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body });
      heard = (await r.json()).text?.trim() || null;
    } catch (e) { heard = null; }
  }

  const report = { ok: problems.length === 0, problems, duration: dur, sizeMB: +(info.format.size / 1048576).toFixed(1), picture: v && `${v.width}x${v.height} ${v.codec_name}`,
    audio: a ? `${a.codec_name} ${a.sample_rate} Hz ${a.channels}ch` : null, loudness: loud, scenes: plan.scenes.map((s) => ({ type: s.type, start: s.start, end: s.end })),
    spoken, heard, notes: plan.notes, sheet, video };
  fs.writeFileSync(path.join(out, 'check.json'), JSON.stringify(report, null, 1));
  return report;
}
