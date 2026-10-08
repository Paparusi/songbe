// songbe — command line for Songbe.
import fs from 'node:fs';
import path from 'node:path';
import { makePlan } from './plan.mjs';
import { renderVideo, stills, writePage } from './render.mjs';
import { makeAudio, mux } from './audio.mjs';
import { check } from './check.mjs';
import { tools, loadDotEnv, exists, log } from './util.mjs';
import { validate, jsonSchema } from './spec.mjs';

const HELP = `Songbe — short ads from a single video.json

  songbe doctor                   check that ffmpeg, ffprobe and Chrome are found and which keys are set
  songbe init <dir>               start a project from the example
  songbe validate <dir>           check video.json and list every problem
  songbe schema                   print the JSON Schema of video.json
  songbe frames <dir> [t1,t2,…]   render a few stills to out/frames (default: two per scene) — review before a full build
  songbe build <dir> [--force]    voice → timeline → footage → picture → sound → out/video.mp4, then self-check
  songbe check <dir>              re-run the self-check on out/video.mp4
  songbe preview <dir>            write the scene page and print its address (open it in a browser to scrub and play)
  songbe studio <dir> [--port=N]  edit in the browser with a live preview and a Build button (http://127.0.0.1:4173)

Keys are read from the environment or <dir>/.env: FAL_KEY (voice, music, generated footage), GROQ_API_KEY (optional transcript check).
Without keys the build still works: no voice, no music, plain backgrounds where footage would be generated.`;

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function report(r) {
  log(`\n${r.ok ? 'OK' : 'PROBLEMS'}  ${r.video}`);
  log(`  ${r.duration.toFixed(2)} s · ${r.picture} · ${r.audio || 'NO AUDIO'} · ${r.sizeMB} MB` + (r.loudness ? ` · mean ${r.loudness.mean} dB, peak ${r.loudness.peak} dB` : ''));
  for (const p of r.problems) log('  ! ' + p);
  for (const n of r.notes || []) log('  note: ' + n);
  if (r.heard) log('  heard: ' + r.heard);
  log('  sheet: ' + r.sheet);
}

export async function main(argv) {
  const [cmd, target, ...rest] = argv, flags = new Set(rest.filter((x) => x.startsWith('--')));
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return log(HELP);
  if (cmd === 'doctor') {
    for (const [label, name] of [['ffmpeg', 'ffmpeg'], ['ffprobe', 'ffprobe'], ['Chrome', 'chrome']]) {
      try { log(`ok   ${label}: ${tools[name]}`); } catch (e) { log(`MISSING ${label}: ${e.message}`); process.exitCode = 1; }
    }
    if (target) loadDotEnv(path.resolve(target));
    for (const k of ['FAL_KEY', 'GROQ_API_KEY']) log(`${process.env[k] ? 'set  ' : 'unset'} ${k}`);
    return log(`node ${process.version}`);
  }
  if (cmd === 'schema') return log(JSON.stringify(jsonSchema(), null, 2));
  if (!target) throw new Error('which project directory?\n\n' + HELP);
  const dir = path.resolve(target);
  if (cmd === 'init') {
    if (exists(path.join(dir, 'video.json'))) throw new Error(`${dir} already has a video.json`);
    fs.cpSync(path.join(ROOT, 'examples', 'app-launch-en'), dir, { recursive: true, filter: (f) => !/[\\/](\.songbe|out)([\\/]|$)/.test(f) });
    return log(`created ${dir}\nnext: songbe frames ${target}   then   songbe build ${target}`);
  }
  if (!exists(path.join(dir, 'video.json'))) throw new Error(`no video.json in ${dir}`);
  loadDotEnv(dir);
  if (cmd === 'studio') {
    const { studio } = await import('./studio.mjs'), p = rest.find((x) => x.startsWith('--port='));
    await studio(dir, p ? +p.split('=')[1] : 4173); return;
  }
  if (cmd === 'validate') {
    let spec; try { spec = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')); } catch (e) { throw new Error('video.json is not valid JSON: ' + e.message); }
    const errs = validate(spec, dir);
    if (!errs.length) return log('video.json is valid');
    process.exitCode = 2; return log(`${errs.length} problem${errs.length > 1 ? 's' : ''}:\n  - ` + errs.join('\n  - '));
  }
  if (cmd === 'check') return report(await check(dir, JSON.parse(fs.readFileSync(path.join(dir, '.songbe', 'plan.json'), 'utf8'))));

  log('plan…'); const plan = await makePlan(dir, { force: flags.has('--force') });
  log(`  ${plan.duration} s, ${plan.scenes.length} scenes: ` + plan.scenes.map((s) => `${s.type} ${s.start}–${s.end}`).join(' | '));
  if (cmd === 'preview') return log('open: file://' + writePage(dir, plan));
  if (cmd === 'frames') {
    const arg = rest.find((x) => !x.startsWith('--'));
    const times = arg ? arg.split(',').map(Number) : plan.scenes.flatMap((s) => [s.start + (s.end - s.start) * .35, s.start + (s.end - s.start) * .85]);
    const files = await stills(dir, plan, times.map((t) => Math.min(t, plan.duration - .04)));
    return log(files.join('\n'));
  }
  if (cmd !== 'build') throw new Error(`unknown command "${cmd}"\n\n` + HELP);
  log('picture…'); await renderVideo(dir, plan);
  log('sound…'); const a = await makeAudio(dir, plan);
  log(`  voice lines: ${a.voice}, music: ${a.music ? 'yes' : 'no'}`);
  mux(dir, plan);
  const r = await check(dir, plan); report(r);
  if (!r.ok) process.exitCode = 2;
}
