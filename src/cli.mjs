// songbe — command line for Songbe.
import fs from 'node:fs';
import path from 'node:path';
import { makePlan } from './plan.mjs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { renderVideo, stills, writePage, lintLayout, poster } from './render.mjs';
import { makeAudio, mux } from './audio.mjs';
import { check } from './check.mjs';
import { tools, loadDotEnv, exists, log, mkdir, dataDir, projectsHome, ROOT, WIN } from './util.mjs';
import { validate, jsonSchema, STYLES, FORMATS } from './spec.mjs';

const HELP = `Songbe — short ads from a single video.json

  songbe app [--port=N]           the app: your projects, a visual editor with live preview, and a Build button
  songbe studio <dir> [--port=N]  the same editor, opened straight on one project (http://127.0.0.1:4173)

  songbe doctor                   check that ffmpeg, ffprobe and a browser are found and which keys are set
  songbe setup ffmpeg             Windows: fetch ffmpeg into Songbe's own folder (elsewhere: says which package to install)
  songbe write <dir> "<brief>"    draft video.json from a description of the ad, check the draft and fix what the checks find
                                  (--style= --format= --no-captions --footage --brief=FILE --force; needs a key, see below)
  songbe init <dir> [--from=ID]   start a project from the example, or from a starter of a pack (see: songbe pack list)
  songbe pack list|add DIR|remove ID   looks and starters from outside the core: what is installed, install a pack folder, remove one
  songbe validate <dir>           check video.json and list every problem, and every text longer than its place
  songbe schema                   print the JSON Schema of video.json
  songbe frames <dir> [t1,t2,…]   render a few stills to out/frames (default: two per scene) — review before a full build
  songbe lint <dir>               layout check only: content that leaves the frame, overlaps, or would be covered
  songbe build <dir> [--force]    voice → timeline → footage → picture → sound → out/video.mp4, then self-check
                                  frames and build accept --style=soft|bold and --format=tall|square|wide to try
                                  another look or frame without editing the spec; build --formats=tall,square,wide makes several;
                                  --captions / --no-captions turn the spoken-word captions on or off;
                                  --no-sync leaves cuts where the voice puts them instead of moving them onto the music's beat
  songbe check <dir>              re-run the self-check on out/video.mp4
  songbe preview <dir>            write the scene page and print its address (open it in a browser to scrub and play)
  songbe poster <dir>             one small still of the opening scene (.songbe/poster.jpg; --out=FILE --width=480)
  songbe footage <dir> --scene=N  generate the footage one scene asks for now, without building (uses FAL_KEY)

Keys are read from the environment, <dir>/.env, or the keys saved in the app: FAL_KEY (voice, music, generated footage, and
the writer), ANTHROPIC_API_KEY (optional: the writer then uses Claude directly), GROQ_API_KEY (optional transcript check).
Without keys the build still works: no voice, no music, plain backgrounds where footage would be generated.`;


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
    for (const [label, name] of [['ffmpeg', 'ffmpeg'], ['ffprobe', 'ffprobe'], ['browser', 'chrome']]) {
      try { log(`ok   ${label}: ${tools[name]}`); } catch (e) { log(`MISSING ${label}: ${e.message}`); process.exitCode = 1; }
    }
    if (target && !target.startsWith('--')) loadDotEnv(path.resolve(target));
    loadDotEnv(dataDir());
    for (const k of ['FAL_KEY', 'GROQ_API_KEY']) log(`${process.env[k] ? 'set  ' : 'unset'} ${k}`);
    log(`projects: ${projectsHome()}\ndata:     ${dataDir()}`);
    return log(`node ${process.version} on ${process.platform}`);
  }
  if (cmd === 'app') {
    const args = argv.slice(1), shell = args.includes('--shell'), p = args.find((x) => x.startsWith('--port='));
    const { serve } = await import('./studio.mjs'), s = await serve({ port: p ? +p.split('=')[1] : shell ? 0 : 4173 });
    if (shell) {      // started by the desktop app: say where the pages are, and leave when it does
      console.log('SONGBE_READY ' + JSON.stringify({ url: s.url + 'home', port: s.port }));
      const leave = () => { s.close(); process.exit(0); };
      process.stdin.on('end', leave).on('error', leave).resume();
      return;
    }
    log(`Songbe is running at ${s.url}\n  projects: ${s.home}\n  Ctrl-C to stop`);
    if (!args.includes('--no-open') && tools.window) {      // a window of its own, without tabs or an address bar
      const win = spawn(tools.window, [`--app=${s.url}`, `--user-data-dir=${path.join(mkdir(dataDir()), 'window')}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' });
      win.on('error', () => {}); win.unref();
    }
    return;
  }
  if (cmd === 'setup') {
    if (target !== 'ffmpeg') throw new Error('what should be set up? Try: songbe setup ffmpeg');
    const { installFfmpeg, ffmpegAdvice, FFMPEG_WINDOWS: pick } = await import('./setup.mjs');
    if (!WIN) return log(`On this system ffmpeg comes from the package manager:\n  ${ffmpegAdvice()}`);
    log(`ffmpeg ${pick.version} from ${pick.from} (${Math.round(pick.bytes / 1e6)} MB, ${pick.licence})`);
    let shown = -1;
    const r = await installFfmpeg((p) => { if (p.step === 'download') { const pc = Math.floor(p.done / p.total * 10) * 10; if (pc !== shown) { shown = pc; log(`  downloading… ${pc}%`); } } else if (p.step !== 'done') log(`  ${p.step}…`); });
    return log(`installed: ${r.ffmpeg}\n  ${r.version}`);
  }
  if (cmd === 'schema') return log(JSON.stringify(jsonSchema(), null, 2));
  if (cmd === 'pack') {
    const { listPacks, installPack, removePack, starterList } = await import('./packs.mjs');
    if (target === 'add') { const p = installPack(rest[0] || ''); return log(`installed ${p.name} ${p.version}: ${p.styles.length} look${p.styles.length === 1 ? '' : 's'}${p.styles.length ? ' (' + p.styles.map((x) => x.name).join(', ') + ')' : ''}, ${p.starters.length} starter${p.starters.length === 1 ? '' : 's'}`); }
    if (target === 'remove') { removePack(rest[0] || ''); return log(`removed ${rest[0]}`); }
    if (target && target !== 'list') throw new Error('songbe pack list | add <folder> | remove <id>');
    const packs = listPacks();
    for (const p of packs) log(`${p.id}  ${p.name} ${p.version}  [${p.where}]${p.licence ? '  ' + p.licence : ''}\n    looks: ${p.styles.map((x) => x.name).join(', ') || '—'}\n    starters: ${p.starters.map((x) => x.id).join(', ') || '—'}`);
    if (!packs.length) log('no packs found');
    return log(`starters to begin from (songbe init <dir> --from=ID): ${starterList().map((x) => x.id).join(', ')}`);
  }
  if (!target) throw new Error('which project directory?\n\n' + HELP);
  const dir = path.resolve(target);
  if (cmd === 'write') {
    const opt = (name) => rest.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3), from = opt('brief');
    const brief = from ? fs.readFileSync(path.resolve(from), 'utf8') : rest.filter((x) => !x.startsWith('--')).join(' ');
    loadDotEnv(dir); loadDotEnv(dataDir());
    const { writeSpec } = await import('./write.mjs');
    const r = await writeSpec(dir, brief, { style: opt('style'), format: opt('format') || 'tall', captions: !flags.has('--no-captions'), footage: flags.has('--footage'), force: flags.has('--force'),
      onStep: (s) => log(s.step === 'write' ? 'writing…' : s.step === 'check' ? '  checking the draft…' : `fixing ${s.found} thing${s.found === 1 ? '' : 's'} the checks found…`) });
    log(`wrote ${r.file}\n  ${r.spec.scenes.length} scenes (${r.spec.scenes.map((s) => s.type).join(', ')}), about ${Math.round(r.seconds ?? 0)} s, look "${r.spec.style}", ${r.rounds} pass${r.rounds === 1 ? '' : 'es'} with ${r.model || r.provider}`);
    if (r.note) log('  note: ' + r.note);
    for (const x of r.left) log('  · still to look at: ' + x);
    return log(`next: songbe frames ${target}   then   songbe build ${target}`);
  }
  if (cmd === 'init') {
    if (exists(path.join(dir, 'video.json'))) throw new Error(`${dir} already has a video.json`);
    const { starterDir } = await import('./packs.mjs'), id = rest.find((x) => x.startsWith('--from='))?.slice(7) || 'app-launch-en', from = starterDir(id);
    if (!from) throw new Error(`no starter is called "${id}" (see: songbe pack list)`);
    fs.cpSync(from, dir, { recursive: true, filter: (f) => !/[\\/](\.songbe|out|starter\.json|poster\.jpg)([\\/]|$)/.test(f.slice(from.length)) });
    return log(`created ${dir}\nnext: songbe frames ${target}   then   songbe build ${target}`);
  }
  if (!exists(path.join(dir, 'video.json'))) throw new Error(`no video.json in ${dir}`);
  loadDotEnv(dir); loadDotEnv(dataDir());      // the project's own keys first, then the ones saved on this computer
  if (cmd === 'studio') {
    const { studio } = await import('./studio.mjs'), p = rest.find((x) => x.startsWith('--port='));
    await studio(dir, p ? +p.split('=')[1] : 4173); return;
  }
  if (cmd === 'validate') {
    let spec; try { spec = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')); } catch (e) { throw new Error('video.json is not valid JSON: ' + e.message); }
    const errs = validate(spec, dir);
    if (!errs.length) {      // valid; say too where the words outgrow their place (the kit will shrink them, which rarely looks best)
      const { tooLong, tooLongNote } = await import('./fit.mjs'), long = tooLong(spec);
      return log('video.json is valid' + long.map((f) => '\n  · ' + tooLongNote(f)).join(''));
    }
    process.exitCode = 2; return log(`${errs.length} problem${errs.length > 1 ? 's' : ''}:\n  - ` + errs.join('\n  - '));
  }
  if (cmd === 'footage') {
    const n = +(rest.find((x) => x.startsWith('--scene='))?.slice(8) || 0);
    if (!Number.isInteger(n) || n < 1) throw new Error('which scene? --scene=1 is the first');
    const { generateFootage } = await import('./plan.mjs');
    const r = await generateFootage(dir, n - 1, { format: rest.find((x) => x.startsWith('--format='))?.slice(9), force: flags.has('--force') });
    return log(r.made.length ? `generated the ${r.made.join(' and the ')}: ${r.clip || r.still}` : `already there: ${r.clip || r.still}`);
  }
  if (cmd === 'poster') {
    const out = rest.find((x) => x.startsWith('--out='))?.slice(6), width = +(rest.find((x) => x.startsWith('--width='))?.slice(8) || 480);
    return log(await poster(dir, await makePlan(dir, { offline: true }), out ? path.resolve(out) : path.join(mkdir(path.join(dir, '.songbe')), 'poster.jpg'), width));
  }
  if (cmd === 'check') return report(await check(dir, JSON.parse(fs.readFileSync(path.join(dir, '.songbe', 'plan.json'), 'utf8'))));

  const style = rest.find((x) => x.startsWith('--style='))?.split('=')[1];          // try another look without editing the spec
  if (style && !STYLES.includes(style)) throw new Error(`unknown style "${style}" — choose one of: ${STYLES.join(', ')}`);
  const captions = flags.has('--captions') ? true : flags.has('--no-captions') ? false : undefined;   // override "captions" in the spec
  const sync = flags.has('--no-sync') ? false : undefined;                                            // leave cuts where the voice puts them
  // --format=wide builds another frame from the same spec (out/video-wide.mp4); --formats=tall,square,wide builds several
  const one = rest.find((x) => x.startsWith('--format='))?.split('=')[1], many = rest.find((x) => x.startsWith('--formats='))?.split('=')[1]?.split(',');
  for (const f of [one, ...(many || [])].filter(Boolean)) if (!FORMATS[f]) throw new Error(`unknown format "${f}" — choose from: ${Object.keys(FORMATS).join(', ')}`);
  if (cmd === 'build' && many) {
    let bad = false;
    for (const format of many) { log(`\n== ${format} ==`); const r = await buildOne(dir, { force: flags.has('--force'), style, format, captions, sync }); bad ||= !r.ok; }
    if (bad) process.exitCode = 2; return;
  }
  log('plan…'); const plan = await makePlan(dir, { force: flags.has('--force'), style, format: one, captions, sync });
  if (plan.beats) log(`  cuts on the beat: ${plan.beats.bpm} BPM`);
  log(`  ${plan.size.join('×')}, ${plan.duration} s, ${plan.scenes.length} scenes: ` + plan.scenes.map((s) => `${s.type} ${s.start}–${s.end}`).join(' | '));
  if (cmd === 'preview') return log('open: ' + pathToFileURL(writePage(dir, plan)).href);
  if (cmd === 'frames') {
    const arg = rest.find((x) => !x.startsWith('--'));
    const times = arg ? arg.split(',').map(Number) : plan.scenes.flatMap((s) => [s.start + (s.end - s.start) * .35, s.start + (s.end - s.start) * .85]);
    const { files, layout } = await stills(dir, plan, times.map((t) => Math.min(t, plan.duration - .04)));
    log(files.join('\n')); return findings(layout);
  }
  if (cmd === 'lint') {
    const layout = await lintLayout(dir, plan); findings(layout);
    if (!layout.length) log('layout: nothing leaves the frame, overlaps or would be covered');
    if (layout.some((f) => f.level === 'problem')) process.exitCode = 2;
    return;
  }
  if (cmd !== 'build') throw new Error(`unknown command "${cmd}"\n\n` + HELP);
  const r = await finish(dir, plan);
  if (!r.ok) process.exitCode = 2;
}

function findings(layout) {
  for (const f of layout) log(`${f.level === 'problem' ? '!' : '·'} scene ${f.scene} (${f.type}): ${f.message}`);
}

async function finish(dir, plan) {
  log('picture…'); await renderVideo(dir, plan);
  log('sound…'); const a = await makeAudio(dir, plan);
  log(`  voice lines: ${a.voice}, music: ${a.music ? 'yes' : 'no'}`);
  mux(dir, plan);
  const r = await check(dir, plan); report(r);
  return r;
}
async function buildOne(dir, opts) {
  log('plan…'); const plan = await makePlan(dir, opts);
  log(`  ${plan.size.join('×')}, ${plan.duration} s, ${plan.scenes.length} scenes`);
  return finish(dir, plan);
}
