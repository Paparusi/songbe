// The canvas window: what the page at /c/<id>/ asks of the server. It shows flow.json as it is — every node a card, every "works
// from" a line — lets any node be changed, added or removed, and has the missing ones made. Making happens in a process of its own
// (`songbe flow run … --events`), so the pages stay responsive, a run can be stopped, and the keys are found the way the command
// line finds them.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ID, KINDS, checkFlow, look, needs, openStore, readFlow, writeFlow } from './flow.mjs';
import { KNOWN, PREFER } from './models.mjs';
import { ROOT, WIN, exists, killTree } from '../util.mjs';

const PAGES = path.join(ROOT, 'studio');
const made = (n) => !!KINDS[n?.kind]?.ext;

// `h` is what the server lends: { send, json, serveFile, keysFor, version }
export function canvasRoutes(h) {
  const runs = new Map();      // project id → { proc, done, events, watchers, stopped }
  const route = async function (req, res, u, id, dir, rest) {
    const prefix = `/c/${id}`, what = `${req.method} ${rest}`, run = runs.get(id), busy = !!run && !run.done;
    const link = (file) => (file ? `${prefix}/file?p=${encodeURIComponent(file)}&v=${Math.round(fs.statSync(file).mtimeMs)}` : null);
    const state = async (flow = readFlow(dir)) => {
      const bad = checkFlow(flow, dir); let rows = [];
      if (!bad.length) try { rows = await look(dir, flow, { env: process.env }); } catch (e) { bad.push(e.message); }
      const store = openStore(dir);
      let title = null; try { title = JSON.parse(fs.readFileSync(path.join(dir, 'series.json'), 'utf8')).title || null; } catch {}
      return { id, dir, name: path.basename(dir), title, version: h.version, flow, bad, running: busy, keys: h.keysFor(dir),
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
    if (what === 'GET /api/state') return h.send(res, 200, await state());
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
      if (busy) return h.send(res, 409, { error: 'Something is already being made.' });
      const q = await h.json(req), flow = readFlow(dir), names = (list) => (Array.isArray(list) ? list.filter((x) => flow.nodes[x] && made(flow.nodes[x])) : []), want = names(q.want), again = names(q.again);
      const j = { done: false, stopped: false, events: [], watchers: new Set(), code: null }; runs.set(id, j);
      const say = (e) => { j.events.push(e); for (const w of j.watchers) w.write(`data: ${JSON.stringify(e)}\n\n`); };
      const feed = (d) => { for (const line of String(d).split(/\r?\n/)) { if (line.startsWith('@@')) { try { say(JSON.parse(line.slice(2))); } catch {} } else if (line.trim() && !/^\s*[…✓!]/.test(line)) say({ type: 'line', text: line.trim().slice(0, 400) }); } };
      j.proc = spawn(process.execPath, [path.join(ROOT, 'bin', 'songbe.mjs'), 'flow', 'run', dir, ...[...new Set([...want, ...again])], ...(again.length ? ['--again=' + again.join(',')] : []), '--events'], { env: process.env, windowsHide: true, detached: !WIN });
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
