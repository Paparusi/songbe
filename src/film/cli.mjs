// songbe film … and songbe flow …: the command line of the film side of Songbe.
import fs from 'node:fs';
import path from 'node:path';
import { board } from './board.mjs';
import { STAGES, stageNodes, sync } from './director.mjs';
import { checkFlow, estimate, look, openStore, readFlow, runFlow } from './flow.mjs';
import { KNOWN, PREFER, modelFor } from './models.mjs';
import { inWords } from './review.mjs';
import { hasEpisode, readEpisode, readSeries, seriesFile, written } from './series.mjs';
import { scriptSeconds, writeEpisode, writeSeries } from './writer.mjs';
import { mayMake } from '../licence.mjs';
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
  songbe flow plan <dir> [node…]      what a run would ask of which model and about what it costs, before anything is asked
  songbe flow spent <dir>             what the takes made so far cost by list price, day by day
  songbe flow retake <dir> <node…>    another take of these nodes; what works from them follows on the next run
  songbe flow review <dir> [node…]    look at the takes that stand and say what is odd about them; no model is asked (--again: afresh)
  songbe flow takes <dir> <node>      the takes a node has; songbe flow pick <dir> <node> <n> chooses one
  songbe flow lock|unlock <dir> <node>   hold a node's chosen take whatever changes around it
  songbe flow open <dir>              the canvas in a window: every node a card, changed and made from there (--port=N)
  songbe flow board <dir>             one page and one picture of the whole canvas (out/board.html, out/board.jpg)
  songbe flow models                  the models known by name; any other is named fal:<endpoint> or google:<model id>

A run may spend $5 by list price unless --budget=N (or "budget" in series.json) says otherwise; one that would spend more
stops before it starts and says what it would ask for. A run looks at every take it makes: one that cannot be used (nobody
says the line, the recording is not the line) is asked for once more by itself — --retakes=N, 0 to 3, or "retakes" in
series.json — and one that is only odd is used and pointed at.

flow.json is yours to edit: a node says what it is made from, and "@name" in a prompt puts another node there — a note's words,
a person's description, or a picture handed to the model as a reference. Keys: GEMINI_API_KEY (Google's own API: pictures, clips,
voices, music, the writer) and FAL_KEY (models of other makers, through fal.ai).`;

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const BUDGET = 5;      // what one run may ask models for, in dollars by list price, unless the series or the command says otherwise
const money = (usd) => '$' + (+usd).toFixed(2);
// what a run would ask for, model by model
function planLines(plan) {
  const by = new Map(), unit = { picture: ['picture'], voice: ['line'], clip: ['clip'], music: ['track'] };
  for (const p of plan.pieces) { const k = `${p.model || '?'} ${p.kind}`, g = by.get(k) || { model: p.model || 'a model that cannot be reached', kind: p.kind, n: 0, seconds: 0, usd: 0, priced: true }; g.n++; if (p.kind === 'clip') g.seconds += p.units || 0; if (p.usd === null) g.priced = false; else g.usd += p.usd; by.set(k, g); }
  return [...by.values()].map((g) => `  ${g.model.padEnd(18)} ${`${plural(g.n, ...unit[g.kind])}${g.kind === 'clip' ? `, ${Math.round(g.seconds)} s` : ''}`.padEnd(20)} ${g.priced ? 'about ' + money(g.usd) : 'no list price known'}`);
}
const planTotal = (plan) => `about ${money(plan.usd)} by list prices${plan.unpriced ? ` (${plural(plan.unpriced, 'piece')} not counted)` : ''}`;
// Before a run: say what it will ask for, and refuse one that goes over the budget unless the command names a budget itself.
async function allowed(dir, flow, { want, again, budget }, quiet = false) {
  const plan = await estimate(dir, flow, { want, again }), cap = budget ?? flow.budget ?? BUDGET;
  if (!plan.pieces.length) return cap;
  if (!quiet) log(`this run asks models for ${plural(plan.pieces.length, 'piece')}, ${planTotal(plan)}`);
  if (plan.usd > cap && budget === undefined) throw new Error(`that is more than a run may spend (${money(cap)}):\n${planLines(plan).join('\n')}\nSay --budget=${Math.ceil(plan.usd * 1.15)} to allow it, or make less at once (--upto=board, or name the nodes).`);
  return cap;
}
// `--events`: one line of JSON per thing that happens, for a program that is watching (the canvas window)
const forMachines = (e) => console.log('@@' + JSON.stringify({ type: e.type, id: e.id, kind: e.kind, by: e.by, took: e.took, n: e.n, error: e.error, seconds: e.seconds, why: e.why, usd: e.usd, text: e.text, review: e.review?.map((f) => f.says) }));
function progress(machine = false) {
  if (machine) return forMachines;
  return (e) => {
    if (e.type === 'start') log(`  … ${e.id.padEnd(22)} ${e.kind.padEnd(8)} ${e.by}`);
    else if (e.type === 'done') { log(`  ✓ ${e.id.padEnd(22)} ${e.took} s`); for (const f of e.review || []) log(`      look: ${f.says}`); }
    else if (e.type === 'again') log(`  ↻ ${e.id.padEnd(22)} ${e.why}: another take`);
    else if (e.type === 'note') log(`  · ${e.text}`);
    else if (e.type === 'failed') log(`  ! ${e.id.padEnd(22)} ${e.error.split('\n')[0].slice(0, 220)}`);
    else if (e.type === 'wait') log(`  · ${e.id.padEnd(22)} ${e.why}: trying again in ${e.seconds} s`);
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
  if (result.flagged?.length) log(`to look at (songbe flow retake makes another take):\n` + result.flagged.map((f) => `  · ${f.id}: ${inWords(f.review)}`).join('\n'));
}

export async function main(cmd, args) {
  const flags = args.filter((a) => a.startsWith('--')), words = args.filter((a) => !a.startsWith('--')), opt = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3), has = (name) => flags.includes('--' + name);
  const keys = (dir) => { if (dir) loadDotEnv(dir); loadDotEnv(dataDir()); };
  const retakes = opt('retakes') === undefined ? null : +opt('retakes');      // further takes a run may ask for by itself; the canvas says when the command does not
  const onStep = (what) => (s) => log(s.step === 'write' ? `writing the ${what}…` : `  fixing ${plural(s.found, 'thing')} the checks found…`);

  if (cmd === 'film') {
    const [sub, target, ...rest] = words;
    if (!sub || sub === 'help') return log(HELP);
    if (!target) throw new Error('which project directory?\n\n' + HELP);
    const dir = path.resolve(target); keys(dir);
    if (['new', 'make', 'script', 'run'].includes(sub)) mayMake();      // making needs a licence or a running trial
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
      const want = stageNodes(flow, n, stage), budget = await allowed(dir, flow, { want, again: [], budget: opt('budget') === undefined ? undefined : +opt('budget') });
      const result = await runFlow(dir, flow, { want, limit: +(opt('limit') || 4), budget, retakes, on: progress() }); summary(result);
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
  const known = ['run', 'retake', 'review', 'plan', 'spent', 'takes', 'pick', 'lock', 'unlock', 'board', 'open', 'models', 'status', 'help'], sub = known.includes(words[0]) ? words[0] : 'status', rest = known.includes(words[0]) ? words.slice(1) : words;
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
  if (sub === 'open') {      // the canvas in a window: every node a card, changed and made from there
    const { serve } = await import('../studio.mjs'), s = await serve({ port: +(opt('port') || 4173), film: dir });
    log(`the canvas of ${dir}\n  open ${s.url}\n  looking is free; "Make" uses your keys\n  Ctrl-C to stop`);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { s.close(); process.exit(0); });
    return;
  }
  for (const id of names) if (sub !== 'pick' && !flow.nodes[id]) throw new Error(`there is no node called "${id}"`);
  if (sub === 'status') {
    if (bad.length) { process.exitCode = 2; return log(`${plural(bad.length, 'problem')}:\n  - ` + bad.join('\n  - ')); }
    const rows = await look(dir, flow);
    if (has('json')) return log(JSON.stringify(rows.map(({ file, ...r }) => ({ ...r, ...(file ? { file: path.relative(dir, file) } : {}) })), null, 1));
    for (const r of rows) if (r.state !== 'words') { log(`${({ ready: '✓', held: '✓', own: '·', make: '○', wait: '·', stuck: '!' })[r.state]} ${r.id.padEnd(22)} ${r.kind.padEnd(8)} ${r.state === 'ready' ? `take ${r.n}${r.takes > 1 ? ` of ${r.takes}` : ''} · ${r.by}` : r.state === 'held' ? `take ${r.n}, held` : r.state === 'own' ? 'your file' : r.state === 'make' ? `to make${r.by ? ' with ' + r.by : ''}` : r.why}`);
      for (const f of r.review || []) log(`    look: ${f.says}`);
      if (r.refused) log(`    ${plural(r.refused.length, 'take')} made and not used: ${r.refused.at(-1).why} (songbe flow pick ${target} ${r.id} ${r.refused.at(-1).n} uses it as it is)`); }
    const count = (s) => rows.filter((r) => r.state === s).length, odd = rows.filter((r) => r.review).length;
    return log(`\n${count('ready') + count('held')} made · ${count('make')} to make · ${count('wait')} waiting on those${count('stuck') ? ` · ${count('stuck')} stuck` : ''}${odd ? ` · ${odd} to look at` : ''}`);
  }
  if (sub === 'review') {      // look at what stands and say what is odd about it; no model is asked, and what is found is kept with the takes
    if (bad.length) throw new Error(`flow.json has ${plural(bad.length, 'problem')}:\n  - ` + bad.join('\n  - '));
    const seen = (await look(dir, flow, { review: has('again') ? 'all' : true })).filter((r) => (!names.length || names.includes(r.id)) && r.looked), odd = seen.filter((r) => r.review);
    if (has('json')) return log(JSON.stringify(odd.map((r) => ({ id: r.id, kind: r.kind, take: r.n, review: r.review })), null, 1));
    for (const r of odd) for (const f of r.review) log(`${f.grave ? '!' : '·'} ${r.id.padEnd(22)} ${r.kind.padEnd(8)} take ${r.n}: ${f.says}`);
    return log(`${odd.length ? '\n' : ''}${plural(seen.length, 'take')} looked at: ${odd.length ? `${odd.length} ${odd.length === 1 ? 'has' : 'have'} something to look at (songbe flow retake ${target} <node> makes another take)` : 'nothing stands out'}`);
  }
  if (sub === 'plan') {      // what a run would ask of which model, and about what it costs, before anything is asked
    const plan = await estimate(dir, flow, { want: names.length ? names : null, again: (opt('again') || '').split(',').filter(Boolean) });
    if (has('json')) return log(JSON.stringify(plan, null, 1));
    if (!plan.pieces.length) return log('nothing would be asked of any model: everything named is made');
    return log(`a run would ask for\n${planLines(plan).join('\n')}\n${planTotal(plan)} — a run may spend ${money(opt('budget') ?? flow.budget ?? BUDGET)} unless --budget says otherwise\n(list prices as read in October 2026; the maker's invoice decides)`);
  }
  if (sub === 'spent') {      // what the takes made so far cost by list price, day by day
    const store = JSON.parse(fs.readFileSync(path.join(dir, '.songbe', 'flow', 'takes.json'), 'utf8')), days = new Map(); let unknown = 0;
    for (const t of Object.values(store.takes || {}).flat()) { if (t.by === 'here') continue; if (t.usd === undefined) { unknown++; continue; } const d = String(t.at).slice(0, 10), g = days.get(d) || new Map(); g.set(t.by, (g.get(t.by) || 0) + t.usd); days.set(d, g); }
    for (const [d, g] of [...days].sort()) log(`${d}  ${money([...g.values()].reduce((a, b) => a + b, 0))}   ${[...g].map(([by, usd]) => `${by.split(' (')[0]} ${money(usd)}`).join(' · ')}`);
    return log(`${days.size ? '' : 'no take with a known price yet; '}${unknown ? `${plural(unknown, 'take')} made before prices were kept, or by a model without a list price, ${unknown === 1 ? 'is' : 'are'} not counted` : 'every take is counted'}`);
  }
  if (sub === 'run' || sub === 'retake') {
    mayMake();
    if (sub === 'retake' && !names.length) throw new Error('another take of which node?');
    const want = names.length ? names : null, again = sub === 'retake' ? names : (opt('again') || '').split(',').filter(Boolean);
    const budget = await allowed(dir, flow, { want, again, budget: opt('budget') === undefined ? undefined : +opt('budget') }, has('events'));
    const result = await runFlow(dir, flow, { want, again, limit: +(opt('limit') || 4), budget, retakes, on: progress(has('events')) });
    if (has('events')) { publish(dir, flow, result); if (result.failed.length) process.exitCode = 2; return; }
    summary(result); for (const f of publish(dir, flow, result)) log(`film:  ${f}`);
    if (sub === 'retake') for (const id of names) if (result.out.has(id)) log(`${id}: ${result.out.get(id).file}`);
    if (result.failed.length) process.exitCode = 2; return;
  }
  if (sub === 'board') { const b = await board(dir, flow, await look(dir, flow), { title: path.basename(dir) }); return log(`${b.html}\n${b.jpg}`); }
  const [id] = names, store = openStore(dir);
  if (!id) throw new Error('which node?');
  if (sub === 'unlock') { store.release(id); return log(`${id}: follows what it is made from again`); }
  const mine = (await look(dir, flow)).find((r) => r.id === id), key = mine?.key, all = key && mine.state !== 'own' ? store.all(key) : [];
  if (!all.length) throw new Error(`${id} has no take${mine?.state === 'make' ? ' yet' : ''}`);
  if (sub === 'lock') { if (!mine.take) throw new Error(`no take of ${id} stands: songbe flow pick ${target} ${id} <n> chooses one first`); store.hold(id, key, mine.n); return log(`${id}: take ${mine.n} is held, whatever changes around it`); }
  if (sub === 'takes') return log(all.map((t) => `${mine.take && t.n === mine.n ? '→' : ' '} take ${t.n}  ${t.by}  ${t.at.slice(0, 16).replace('T', ' ')}  ${t.file}${t.review?.length ? `\n      ${t.bad ? 'not used' : 'look'}: ${inWords(t.review)}` : ''}`).join('\n'));
  if (sub === 'pick') { const n = +names[1]; if (!Number.isInteger(n)) throw new Error(`which take? songbe flow takes ${target} ${id} lists them`); store.pick(id, key, n); return log(`${id}: take ${n} is the one in use; what works from it follows on the next run`); }
}
