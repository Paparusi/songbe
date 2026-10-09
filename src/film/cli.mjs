// songbe film … and songbe flow …: the command line of the film side of Songbe.
import fs from 'node:fs';
import path from 'node:path';
import { board } from './board.mjs';
import { STAGES, stageNodes, sync } from './director.mjs';
import { checkFlow, look, openStore, readFlow, runFlow } from './flow.mjs';
import { KNOWN, PREFER, modelFor } from './models.mjs';
import { hasEpisode, readEpisode, readSeries, seriesFile, written } from './series.mjs';
import { scriptSeconds, writeEpisode, writeSeries } from './writer.mjs';
import { dataDir, exists, loadDotEnv, log, mkdir } from '../util.mjs';

export const HELP = `Songbe film — a series from an idea: the script, the cast with their faces and voices, every shot, every episode

  songbe film make <dir> "<idea>"     everything at once: the series, the script of episode 1, and the episode itself
  songbe film new <dir> "<idea>"      write the series: its look, cast, places and episodes (series.json)
                                      (--episodes=3 --seconds=60 --format=tall|wide --language=Vietnamese --force)
  songbe film script <dir>            write the shot table of the next episode (episodes/NN.json; --episode=N, --all, --force)
  songbe film run <dir>               make an episode (--episode=N, the first by default): faces and plates, the scene pictures and
                                      first frames, the lines in each person's voice, the clips, the music and the cut → out/eN.mp4
                                      --upto=cast|board|voice|clips stops early: "board" shows every shot before a clip is paid for
  songbe film expand <dir>            bring the canvas (flow.json) up to series.json and the scripts, without making anything
                                      (--rewrite words afresh every node you have not changed, after an update of Songbe)

Songbe flow — the canvas itself: every picture, line, clip and cut is a node that can be changed, rewired or made again

  songbe flow <dir>                   what stands for every node: made, to make, waiting, yours (--json)
  songbe flow run <dir> [node…]       make what is missing or out of date (those nodes and what they work from; all when none named)
  songbe flow retake <dir> <node…>    another take of these nodes; what works from them follows on the next run
  songbe flow takes <dir> <node>      the takes a node has; songbe flow pick <dir> <node> <n> chooses one
  songbe flow lock|unlock <dir> <node>   hold a node's chosen take whatever changes around it
  songbe flow board <dir>             one page and one picture of the whole canvas (out/board.html, out/board.jpg)
  songbe flow models                  the models known by name; any other is named fal:<endpoint> or google:<model id>

flow.json is yours to edit: a node says what it is made from, and "@name" in a prompt puts another node there — a note's words,
a person's description, or a picture handed to the model as a reference. Keys: GEMINI_API_KEY (Google's own API: pictures, clips,
voices, music, the writer) and FAL_KEY (models of other makers, through fal.ai).`;

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function progress() {
  return (e) => {
    if (e.type === 'start') log(`  … ${e.id.padEnd(22)} ${e.kind.padEnd(8)} ${e.by}`);
    else if (e.type === 'done') log(`  ✓ ${e.id.padEnd(22)} ${e.took} s`);
    else if (e.type === 'failed') log(`  ! ${e.id.padEnd(22)} ${e.error.split('\n')[0].slice(0, 220)}`);
  };
}
// the finished cuts copied to where people look for them: out/<node>.mp4 with its subtitles
function publish(dir, flow, result) {
  const files = [];
  for (const [id, n] of Object.entries(flow.nodes)) if (n.kind === 'cut' && result.out.has(id)) {
    const from = result.out.get(id).file, to = path.join(mkdir(path.join(dir, 'out')), `${id}.mp4`); fs.copyFileSync(from, to); files.push(to);
    const srt = from.replace(/\.mp4$/, '.srt'); if (exists(srt)) fs.copyFileSync(srt, to.replace(/\.mp4$/, '.srt'));
  }
  return files;
}
function summary(result) {
  log(`\n${plural(result.made.length, 'piece')} made, ${result.ready.length} already there${result.failed.length ? `, ${result.failed.length} NOT made` : ''}`);
  for (const f of result.failed) log(`  ! ${f.id}: ${f.error.split('\n')[0].slice(0, 300)}`);
}

export async function main(cmd, args) {
  const flags = args.filter((a) => a.startsWith('--')), words = args.filter((a) => !a.startsWith('--')), opt = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3), has = (name) => flags.includes('--' + name);
  const keys = (dir) => { if (dir) loadDotEnv(dir); loadDotEnv(dataDir()); };
  const onStep = (what) => (s) => log(s.step === 'write' ? `writing the ${what}…` : `  fixing ${plural(s.found, 'thing')} the checks found…`);

  if (cmd === 'film') {
    const [sub, target, ...rest] = words;
    if (!sub || sub === 'help') return log(HELP);
    if (!target) throw new Error('which project directory?\n\n' + HELP);
    const dir = path.resolve(target); keys(dir);
    const newSeries = async () => {
      const r = await writeSeries(dir, opt('idea') ? fs.readFileSync(path.resolve(opt('idea')), 'utf8') : rest.join(' '), { episodes: +(opt('episodes') || 3), seconds: +(opt('seconds') || 60), format: opt('format') || 'tall', language: opt('language'), force: has('force'), onStep: onStep('series') });
      const s = r.series;
      log(`wrote ${r.file}  (${r.model || r.provider}, ${plural(r.rounds, 'pass', 'passes')})\n  "${s.title}" — ${s.logline || ''}`);
      for (const c of Object.values(s.cast)) log(`  cast   ${c.name}${c.role ? ` (${c.role})` : ''}${c.voice?.voice ? ` · voice ${c.voice.voice}` : ''}`);
      for (const p of Object.values(s.places)) log(`  place  ${p.name}`);
      s.episodes.forEach((e, i) => log(`  ep ${i + 1}   ${e.title}`));
      return s;
    };
    const script = async (series, n) => {
      const r = await writeEpisode(dir, series, n, { force: has('force'), onStep: onStep(`script of episode ${n}`) }), shots = r.episode.scenes.flatMap((sc) => sc.shots);
      log(`wrote ${r.file}  (${r.model || r.provider}, ${plural(r.rounds, 'pass', 'passes')})\n  "${r.episode.title}": ${plural(r.episode.scenes.length, 'scene')}, ${plural(shots.length, 'shot')}, ${shots.filter((x) => x.line).length} with a line, about ${Math.round(r.seconds)} s`);
      return r.episode;
    };
    const scriptsOf = () => Object.fromEntries(written(dir).map((n) => [n, readEpisode(dir, n)]));
    const expand = (series) => { const r = sync(dir, series, scriptsOf(), { rewrite: has('rewrite') }), did = [r.added.length && `${r.added.length} added`, r.updated.length && `${r.updated.length} rewritten`, r.removed.length && `${r.removed.length} removed`].filter(Boolean);
      log(`canvas: ${Object.keys(r.flow.nodes).length} nodes${did.length ? ` (${did.join(', ')})` : ', nothing to change'}`);
      if (r.kept.length) log(`  left as you changed them: ${r.kept.join(', ')}`);
      return r.flow; };
    const run = async (series, n) => {
      if (!hasEpisode(dir, n)) await script(series, n);
      const flow = expand(series), stage = opt('upto') || 'cut';
      log(`episode ${n}, up to "${stage}":`);
      const result = await runFlow(dir, flow, { want: stageNodes(flow, n, stage), limit: +(opt('limit') || 4), on: progress() }); summary(result);
      const b = await board(dir, flow, await look(dir, flow), { name: `e${n}-board`, title: `${series.title} — episode ${n}`, cuts: [`e${n}`] });
      log(`board: ${b.jpg}`); for (const f of publish(dir, flow, result)) if (path.basename(f) === `e${n}.mp4`) log(`film:  ${f}`);
      if (result.failed.length) process.exitCode = 2;
    };
    if (sub === 'new') { await newSeries(); return log(`next: songbe film script ${target}   then   songbe film run ${target} --upto=board`); }
    if (sub === 'make') { const series = exists(seriesFile(dir)) && !has('force') ? readSeries(dir) : await newSeries(); return run(series, +(opt('episode') || 1)); }
    const series = readSeries(dir);
    if (sub === 'script') {
      const all = (series.episodes || []).map((_, i) => i + 1), todo = opt('episode') ? [+opt('episode')] : has('all') ? all.filter((n) => has('force') || !hasEpisode(dir, n)) : [all.find((n) => !hasEpisode(dir, n)) ?? null].filter(Boolean);
      if (!todo.length) return log('every episode has its script (use --episode=N --force to write one again)');
      for (const n of todo) await script(series, n);
      return log(`next: songbe film run ${target} --episode=${todo[0]} --upto=board`);
    }
    if (sub === 'expand') { expand(series); return; }
    if (sub === 'run') return run(series, +(opt('episode') || written(dir)[0] || 1));
    throw new Error(`unknown: songbe film ${sub}\n\n` + HELP);
  }

  // ---- songbe flow ----
  const known = ['run', 'retake', 'takes', 'pick', 'lock', 'unlock', 'board', 'models', 'status', 'help'], sub = known.includes(words[0]) ? words[0] : 'status', rest = known.includes(words[0]) ? words.slice(1) : words;
  if (sub === 'help') return log(HELP);
  if (sub === 'models') {
    keys(null);
    for (const kind of ['picture', 'clip', 'voice', 'music']) { log(`${kind}:`); for (const [name, m] of Object.entries(KNOWN)) if (m.kind === kind) log(`  ${name.padEnd(20)} ${m.by.padEnd(10)} ${[m.google && 'Google\'s API', m.fal && 'fal.ai'].filter(Boolean).join(' or ')}${m.acts ? ' · acts to a recording' : ''}${m.speaks ? ' · speaks the line itself' : ''}`); }
    const chosen = (role) => { try { return modelFor(role).name; } catch { return 'none (no key)'; } };
    return log(`used when nothing is named: ${Object.keys(PREFER).map((role) => `${role} → ${chosen(role)}`).join(', ')}`);
  }
  const [target, ...names] = rest;
  if (!target) throw new Error('which project directory?\n\n' + HELP);
  const dir = path.resolve(target); keys(dir);
  const flow = readFlow(dir), bad = checkFlow(flow, dir);
  if (!Object.keys(flow.nodes).length) throw new Error(`there is no flow.json in ${dir} yet (songbe film new … writes one from an idea)`);
  for (const id of names) if (sub !== 'pick' && !flow.nodes[id]) throw new Error(`there is no node called "${id}"`);
  if (sub === 'status') {
    if (bad.length) { process.exitCode = 2; return log(`${plural(bad.length, 'problem')}:\n  - ` + bad.join('\n  - ')); }
    const rows = await look(dir, flow);
    if (has('json')) return log(JSON.stringify(rows.map(({ file, ...r }) => ({ ...r, ...(file ? { file: path.relative(dir, file) } : {}) })), null, 1));
    for (const r of rows) if (r.state !== 'words') log(`${({ ready: '✓', held: '✓', own: '·', make: '○', wait: '·', stuck: '!' })[r.state]} ${r.id.padEnd(22)} ${r.kind.padEnd(8)} ${r.state === 'ready' ? `take ${r.n}${r.takes > 1 ? ` of ${r.takes}` : ''} · ${r.by}` : r.state === 'held' ? `take ${r.n}, held` : r.state === 'own' ? 'your file' : r.state === 'make' ? `to make${r.by ? ' with ' + r.by : ''}` : r.why}`);
    const count = (s) => rows.filter((r) => r.state === s).length;
    return log(`\n${count('ready') + count('held')} made · ${count('make')} to make · ${count('wait')} waiting on those${count('stuck') ? ` · ${count('stuck')} stuck` : ''}`);
  }
  if (sub === 'run' || sub === 'retake') {
    if (sub === 'retake' && !names.length) throw new Error('another take of which node?');
    const result = await runFlow(dir, flow, { want: names.length ? names : null, again: sub === 'retake' ? names : (opt('again') || '').split(',').filter(Boolean), limit: +(opt('limit') || 4), on: progress() });
    summary(result); for (const f of publish(dir, flow, result)) log(`film:  ${f}`);
    if (sub === 'retake') for (const id of names) if (result.out.has(id)) log(`${id}: ${result.out.get(id).file}`);
    if (result.failed.length) process.exitCode = 2; return;
  }
  if (sub === 'board') { const b = await board(dir, flow, await look(dir, flow), { title: path.basename(dir) }); return log(`${b.html}\n${b.jpg}`); }
  const [id] = names, store = openStore(dir);
  if (!id) throw new Error('which node?');
  if (sub === 'unlock') { store.release(id); return log(`${id}: follows what it is made from again`); }
  const mine = (await look(dir, flow)).find((r) => r.id === id);
  if (!mine?.take || mine.state === 'own') throw new Error(`${id} has no take${mine?.state === 'make' ? ' yet' : ''}`);
  const key = mine.take.slice(0, mine.take.lastIndexOf('-'));
  if (sub === 'lock') { store.hold(id, key, mine.n); return log(`${id}: take ${mine.n} is held, whatever changes around it`); }
  if (sub === 'takes') return log(store.all(key).map((t) => `${t.n === mine.n ? '→' : ' '} take ${t.n}  ${t.by}  ${t.at.slice(0, 16).replace('T', ' ')}  ${t.file}`).join('\n'));
  if (sub === 'pick') { const n = +names[1]; if (!Number.isInteger(n)) throw new Error(`which take? songbe flow takes ${target} ${id} lists them`); store.pick(id, key, n); return log(`${id}: take ${n} is the one in use; what works from it follows on the next run`); }
}
