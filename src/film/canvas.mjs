// The canvas window: what the page at /c/<id>/ asks of the server. It shows flow.json as it is — every node a card, every "works
// from" a line — lets any node be changed, added or removed, and has the missing ones made. Making happens in a process of its own
// (`songbe flow run … --events`), so the pages stay responsive, a run can be stopped, and the keys are found the way the command
// line finds them.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { STAGES, stageNodes, sync } from './director.mjs';
import { ID, KINDS, checkFlow, estimate, look, needs, openStore, readFlow, writeFlow } from './flow.mjs';
import { KNOWN, PREFER } from './models.mjs';
import { hasEpisode, readEpisode, readSeries, written } from './series.mjs';
import { writeEpisode } from './writer.mjs';
import { FORMATS } from '../spec.mjs';
import { ROOT, WIN, exists, killTree } from '../util.mjs';

const PAGES = path.join(ROOT, 'studio');
const made = (n) => !!KINDS[n?.kind]?.ext;
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// a picture that stands for a film on the home screen: the first frame of its first shot, else any picture it has made
function posterOf(dir) {
  const store = readJson(path.join(dir, '.songbe', 'flow', 'takes.json')); if (!store) return null;
  const fileOf = (id) => { const p = store.picks?.[id], t = p && (store.takes?.[p.key] || []).find((x) => x.n === p.n), f = t && path.join(dir, '.songbe', 'flow', t.file); return f && /\.jpg$/.test(f) && exists(f) ? f : null; };
  return fileOf('e1-s1-frame') || Object.keys(store.picks || {}).map(fileOf).find(Boolean) || null;
}
// what the home screen shows of a film
export function filmCard(id, dir, home) {
  const series = readJson(path.join(dir, 'series.json')), flow = readJson(path.join(dir, 'flow.json')), out = path.join(dir, 'out'), poster = posterOf(dir);
  const cuts = exists(out) ? fs.readdirSync(out).filter((f) => /^e\d+\.mp4$/.test(f)) : [];
  return { id, name: path.basename(dir), dir, title: series?.title || null, elsewhere: path.resolve(path.dirname(dir)) !== path.resolve(home), size: FORMATS[series?.format || flow?.format] || FORMATS.tall,
    planned: Array.isArray(series?.episodes) ? series.episodes.length : 0, written: written(dir).length, cut: cuts.length, nodes: Object.keys(flow?.nodes || {}).length,
    edited: fs.statSync(path.join(dir, 'flow.json')).mtimeMs, poster: poster ? `/c/${id}/poster?v=${Math.round(fs.statSync(poster).mtimeMs)}` : null };
}

// `h` is what the server lends: { send, json, serveFile, keysFor, version }
export function canvasRoutes(h) {
  const runs = new Map();      // project id → { proc, done, events, watchers, stopped }
  const scripts = new Map();   // project id → { n, done, error }: the next episode being written
  const route = async function (req, res, u, id, dir, rest) {
    const prefix = `/c/${id}`, what = `${req.method} ${rest}`, run = runs.get(id), busy = !!run && !run.done;
    const link = (file) => (file ? `${prefix}/file?p=${encodeURIComponent(file)}&v=${Math.round(fs.statSync(file).mtimeMs)}` : null);
    const state = async (flow = readFlow(dir)) => {
      const bad = checkFlow(flow, dir); let rows = [];
      if (!bad.length) try { rows = await look(dir, flow, { env: process.env }); } catch (e) { bad.push(e.message); }
      const store = openStore(dir);
      const series = readJson(path.join(dir, 'series.json')), title = series?.title || null, job = scripts.get(id);
      // the episodes: which are planned, which have a script, and whether one is being written now
      const episodes = { planned: Array.isArray(series?.episodes) ? series.episodes.map((e, i) => ({ n: i + 1, title: e.title || null })) : [], written: written(dir), writing: job && !job.done ? job.n : null, failed: job?.done && job.error ? job.error : null, stages: STAGES };
      return { id, dir, name: path.basename(dir), title, episodes, version: h.version, flow, bad, running: busy, keys: h.keysFor(dir), licence: h.standing?.() || null,
        rows: rows.map(({ file, ...r }) => ({ ...r, url: file && exists(file) ? link(file) : null, held: store.locked(r.id) })),
        edges: bad.length ? [] : Object.keys(flow.nodes).flatMap((to) => needs(flow, to).map((from) => [from, to])),
        models: { known: Object.fromEntries(Object.entries(KNOWN).map(([name, m]) => [name, { kind: m.kind, by: m.by, acts: !!m.acts, speaks: !!m.speaks, voices: m.voices || null }])), prefer: PREFER }, kinds: KINDS };
    };
    const change = async (edit) => {      // one change to flow.json: kept only when the canvas is still sound with it
      const flow = readFlow(dir), next = structuredClone(flow), said = edit(next);
      if (typeof said === 'string') return h.send(res, 400, { error: said });
      const bad = checkFlow(next, dir);
      if (bad.length) return h.send(res, 200, { saved: false, bad });
      writeFlow(dir, next); return h.send(res, 200, { saved: true, ...(await state(next)) });
    };

    if (what === 'GET /') return h.serveFile(req, res, path.join(PAGES, 'canvas.html'), [PAGES]);
    if (what === 'GET /file') return h.serveFile(req, res, u.searchParams.get('p') || '', [dir]);
    if (what === 'GET /poster') return h.serveFile(req, res, posterOf(dir) || '', [dir]);
    // the nodes a request means: those it names, or a part of an episode (everything up to its board, its lines, its clips, its cut)
    const meant = (flow, q) => (q.episode ? (flow.nodes[`e${+q.episode}`] ? stageNodes(flow, +q.episode, q.upto || 'cut') : []) : Array.isArray(q.want) ? q.want.filter((x) => flow.nodes[x] && made(flow.nodes[x])) : []);
    if (what === 'POST /api/episode') {      // write the script of the next episode and lay it out on the canvas (nothing is drawn or filmed)
      if (h.mayNot?.(res)) return;
      if (scripts.get(id) && !scripts.get(id).done) return h.send(res, 409, { error: 'An episode is already being written.' });
      let series; try { series = readSeries(dir); } catch (e) { return h.send(res, 400, { error: 'This canvas has no series.json to write episodes from.' }); }
      const n = (series.episodes || []).map((_, i) => i + 1).find((k) => !hasEpisode(dir, k));
      if (!n) return h.send(res, 400, { error: 'Every episode the series plans has its script.' });
      const job = { n, done: false, error: null }; scripts.set(id, job);
      writeEpisode(dir, series, n, { ask: h.ask, env: h.keyEnv() }).then(() => sync(dir, series, Object.fromEntries(written(dir).map((k) => [k, readEpisode(dir, k)])))).catch((e) => { job.error = e.message; }).finally(() => { job.done = true; });
      return h.send(res, 200, { started: true, n });
    }
    if (what === 'GET /api/state') return h.send(res, 200, await state());
    if (what === 'GET /api/plan') {      // what making these nodes (everything, when none is named) would ask for, and about what it costs
      const flow = readFlow(dir), names = (v) => String(u.searchParams.get(v) || '').split(',').filter((x) => flow.nodes[x]), again = names('again');
      try { const want = u.searchParams.get('episode') ? meant(flow, { episode: u.searchParams.get('episode'), upto: u.searchParams.get('upto') || 'cut' }) : names('want');
        return h.send(res, 200, { ...(await estimate(dir, flow, { want: want.length || again.length ? [...want, ...again] : null, again, env: process.env })), budget: flow.budget ?? 5 }); }
      catch (e) { return h.send(res, 200, { pieces: [], usd: 0, unpriced: 0, budget: flow.budget ?? 5, error: e.message }); }
    }
    if (what === 'GET /api/takes') {      // every take a node has for what it is asked for now
      const node = u.searchParams.get('id'), row = (await look(dir, readFlow(dir), { env: process.env })).find((r) => r.id === node);
      if (!row?.take || row.state === 'own') return h.send(res, 200, { takes: [] });
      const key = row.take.slice(0, row.take.lastIndexOf('-'));
      return h.send(res, 200, { takes: openStore(dir).all(key).map((t) => ({ n: t.n, by: t.by, at: t.at, took: t.took, url: link(t.file), current: t.n === row.n })) });
    }
    if (what === 'PUT /api/node') {
      const node = u.searchParams.get('id') || '', value = await h.json(req);
      if (!ID.test(node) || node.length > 48) return h.send(res, 400, { error: 'A node\'s name is lower-case letters, digits and dashes, like "lan-sheet".' });
      if (!value || typeof value !== 'object' || Array.isArray(value)) return h.send(res, 400, { error: 'A node is an object.' });
      return change((flow) => {
        const had = flow.nodes[node], next = { ...value };
        for (const k of ['by', 'as', 'of']) if (had?.[k] !== undefined) next[k] = had[k]; else delete next[k];      // the director's marks are not the page's to set
        flow.nodes[node] = next;
      });
    }
    if (what === 'POST /api/delete') {
      const node = (await h.json(req)).id;
      return change((flow) => {
        if (!flow.nodes[node]) return 'There is no such node.';
        const named = new RegExp(`@${node}(?![a-z0-9-])`), users = Object.keys(flow.nodes).filter((x) => x !== node && named.test(JSON.stringify(flow.nodes[x])));      // in a prompt, a note, or a field that names it
        if (users.length) return `${users.slice(0, 6).join(', ')}${users.length > 6 ? '…' : ''} ${users.length > 1 ? 'work' : 'works'} from it. Change ${users.length > 1 ? 'those' : 'that one'} first.`;
        delete flow.nodes[node];
      });
    }
    if (what === 'POST /api/place') {      // where cards sit: { name: [x, y] }
      const at = await h.json(req), flow = readFlow(dir);
      for (const [node, xy] of Object.entries(at || {})) if (flow.nodes[node] && Array.isArray(xy) && xy.length === 2 && xy.every(Number.isFinite)) flow.nodes[node].xy = xy.map(Math.round);
      writeFlow(dir, flow); return h.send(res, 200, { ok: true });
    }
    if (what === 'POST /api/pick' || what === 'POST /api/hold') {
      const q = await h.json(req), row = (await look(dir, readFlow(dir), { env: process.env })).find((r) => r.id === q.id), store = openStore(dir);
      if (what.endsWith('hold') && q.on === false) { store.release(q.id); return h.send(res, 200, await state()); }
      if (!row?.take || row.state === 'own') return h.send(res, 400, { error: 'That node has no take yet.' });
      const key = row.take.slice(0, row.take.lastIndexOf('-'));
      try { if (what.endsWith('pick')) store.pick(q.id, key, +q.n); else store.hold(q.id, key, row.n); } catch (e) { return h.send(res, 400, { error: e.message }); }
      return h.send(res, 200, await state());
    }
    if (what === 'POST /api/run') {
      if (h.mayNot?.(res)) return;
      if (busy) return h.send(res, 409, { error: 'Something is already being made.' });
      const q = await h.json(req), flow = readFlow(dir), names = (list) => (Array.isArray(list) ? list.filter((x) => flow.nodes[x] && made(flow.nodes[x])) : []), again = names(q.again);
      let want; try { want = meant(flow, q); } catch (e) { return h.send(res, 400, { error: e.message }); }
      if (q.episode && !flow.nodes[`e${+q.episode}`]) return h.send(res, 400, { error: `There is no episode ${q.episode} on this canvas.` });
      const j = { done: false, stopped: false, events: [], watchers: new Set(), code: null }; runs.set(id, j);
      const say = (e) => { j.events.push(e); for (const w of j.watchers) w.write(`data: ${JSON.stringify(e)}\n\n`); };
      const feed = (d) => { for (const line of String(d).split(/\r?\n/)) { if (line.startsWith('@@')) { try { say(JSON.parse(line.slice(2))); } catch {} } else if (line.trim() && !/^\s*[…✓!]/.test(line)) say({ type: 'line', text: line.trim().slice(0, 400) }); } };
      j.proc = spawn(process.execPath, [path.join(ROOT, 'bin', 'songbe.mjs'), 'flow', 'run', dir, ...[...new Set([...want, ...again])], ...(again.length ? ['--again=' + again.join(',')] : []), ...(Number.isFinite(+q.budget) && q.budget !== undefined && q.budget !== null ? ['--budget=' + +q.budget] : []), '--events'], { env: process.env, windowsHide: true, detached: !WIN });
      j.proc.stdout.on('data', feed); j.proc.stderr.on('data', feed);
      j.proc.on('error', (e) => say({ type: 'line', text: 'could not start: ' + e.message }));
      j.proc.on('close', (code) => { j.done = true; j.code = code; say({ type: 'end', code, stopped: j.stopped }); for (const w of j.watchers) w.end(); });
      return h.send(res, 200, { started: true });
    }
    if (what === 'POST /api/stop') { if (busy) { run.stopped = true; killTree(run.proc); } return h.send(res, 200, { stopped: true }); }
    if (what === 'GET /api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      if (!run) return res.end();
      for (const e of run.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (run.done) return res.end();
      run.watchers.add(res); req.on('close', () => run.watchers.delete(res)); return;
    }
    h.send(res, 404, { error: 'not found' });
  };
  // nothing started from a canvas may outlive the server
  return Object.assign(route, { close: () => { for (const j of runs.values()) if (!j.done) { j.stopped = true; killTree(j.proc); } } });
}
