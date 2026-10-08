// The pages people make videos with, served to this computer only: a home screen that lists projects (`songbe app`, and the
// desktop app around it) and an editor per project with a live preview and a Build button (`songbe studio <dir>` opens straight
// into one). Plain node:http on 127.0.0.1.
// Previews never call a provider: they reuse cached voice and estimate the rest, so editing is free; only "Build" spends anything.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { makePlan } from './plan.mjs';
import { pageHtml } from './render.mjs';
import { FFMPEG_WINDOWS, ffmpegAdvice, installFfmpeg } from './setup.mjs';
import { validate, TOP, SCENES, TEMPLATES, FORMATS } from './spec.mjs';
import { KIT, ROOT, WIN, dataDir, exists, killTree, log, mkdir, openOutside, projectsHome, readDotEnv, sha, tools } from './util.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const MEDIA = /\.(png|jpe?g|svg|webp|gif|mp4|mov|webm|wav|mp3)$/i;
const PAGES = path.join(ROOT, 'studio'), STARTERS = path.join(ROOT, 'examples');
const KEYS = { FAL_KEY: 'fal', GROQ_API_KEY: 'groq' };
// the only places outside this computer the app ever sends a person to
const LINKS = { fal: 'https://fal.ai/dashboard/keys', groq: 'https://console.groq.com/keys', ffmpeg: 'https://ffmpeg.org/download.html' };
const NOT_COPIED = /[\\/](\.songbe|out|starter\.json|poster\.jpg)([\\/]|$)/;      // what a new project does not take from its starter
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const within = (file, roots) => { const r = path.resolve(file); return roots.some((a) => r === a || r.startsWith(a + path.sep)); };
export const idOf = (dir) => sha(WIN ? path.resolve(dir).toLowerCase() : path.resolve(dir));

// A folder name that every system accepts, from whatever the person typed.
export function tidyName(name) {
  const s = String(name ?? '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+/, '').slice(0, 60).replace(/[. ]+$/, '');      // no leading dot (hidden), no trailing dot or space (Windows drops them)
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? '_' + s : s;
}

// Requests are only taken from this computer's own pages. A site in the person's browser can reach 127.0.0.1 too, so:
// the Host must be this address (a name that merely resolves here is refused), a foreign Origin is refused, and anything
// that changes something must carry a header that a plain form or image tag cannot set.
export function trusted(req) {
  const host = req.headers.host || '', origin = req.headers.origin;
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  if (origin && origin !== 'http://' + host) return false;
  return ['GET', 'HEAD'].includes(req.method) || req.headers['x-songbe'] === '1';
}

// The plan carries file:// addresses for the renderer; a page served over http gets the same files through `link`.
export const forBrowser = (plan, link) => JSON.parse(JSON.stringify(plan), (k, v) => (typeof v === 'string' && v.startsWith('file://') ? link(fileURLToPath(v)) : v));

export async function serve({ port: wantPort = 4173, project = null, home = projectsHome() } = {}) {
  const pinned = project ? path.resolve(project) : null;      // `songbe studio <dir>`: this project is the front door
  const registry = path.join(dataDir(), 'projects.json');
  const jobs = new Map(), posters = { queue: [], now: null, failed: new Map() };
  let setup = { running: false, step: null, done: 0, total: 0, error: null, version: null }, toolsSeen = null, toolsAt = 0;

  const send = (res, code, body, type = 'application/json; charset=utf-8', more = {}) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...more }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  const body = (req) => new Promise((ok, no) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
  const json = async (req) => { try { return JSON.parse((await body(req)).toString('utf8') || '{}'); } catch { return {}; } };

  function serveFile(req, res, file, roots) {
    if (!file || !within(file, roots) || path.basename(file).startsWith('.env') || !exists(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'not found' });
    const size = fs.statSync(file).size, type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {   // video elements seek with range requests
      const a = range[1] ? +range[1] : 0, b = range[2] ? Math.min(+range[2], size - 1) : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Cache-Control': 'no-store' });
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }

  // ---- what is installed, and which keys a build would find ----
  function toolState() {
    if (toolsSeen && Date.now() - toolsAt < 3000) return toolsSeen;
    const get = (n) => { try { return tools[n]; } catch { return null; } };
    const t = { ffmpeg: get('ffmpeg'), ffprobe: get('ffprobe'), browser: get('chrome') };
    toolsAt = Date.now(); return toolsSeen = { ...t, ready: !!(t.ffmpeg && t.ffprobe && t.browser) };
  }
  function keysFor(dir) {
    const saved = readDotEnv(path.join(dataDir(), '.env')), own = dir ? readDotEnv(path.join(dir, '.env')) : {}, out = {};
    for (const [k, short] of Object.entries(KEYS)) { out[short] = !!(process.env[k] || own[k] || saved[k]); out[short + 'From'] = process.env[k] ? 'environment' : own[k] ? 'project' : saved[k] ? 'saved' : null; }
    return out;
  }
  function saveKeys(input) {
    const file = path.join(mkdir(dataDir()), '.env'), now = readDotEnv(file);
    for (const k of Object.keys(KEYS)) {
      if (!(k in input)) continue;
      const v = String(input[k] ?? '').trim();
      if (v && !/^[\x21-\x7e]{8,400}$/.test(v)) throw new Error(`That does not look like a key (${k}).`);
      if (v) now[k] = v; else delete now[k];
    }
    fs.writeFileSync(file, Object.entries(now).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
  }

  // ---- projects: every folder with a video.json in the home folder, plus the ones opened from elsewhere ----
  const recent = () => (readJson(registry)?.recent || []).filter((d) => typeof d === 'string');
  function remember(dir, keep = true) {
    const rest = recent().filter((d) => idOf(d) !== idOf(dir));
    fs.writeFileSync(path.join(mkdir(dataDir()), 'projects.json'), JSON.stringify({ recent: (keep ? [path.resolve(dir), ...rest] : rest).slice(0, 60) }, null, 1));
  }
  function folders() {
    const dirs = new Map(), add = (d) => { if (exists(path.join(d, 'video.json'))) dirs.set(idOf(d), path.resolve(d)); };
    if (exists(home)) for (const n of fs.readdirSync(home)) add(path.join(home, n));
    recent().forEach(add); if (pinned) add(pinned);
    return dirs;
  }
  // asked for on every request of a project (a preview loads thirty frames a second), so the answer is remembered while it holds
  const known = new Map();
  const dirOf = (id) => {
    const had = known.get(id);
    if (had && exists(path.join(had, 'video.json'))) return had;
    const dir = folders().get(id) || null;
    if (dir) known.set(id, dir); else known.delete(id);
    return dir;
  };
  function card(id, dir) {
    const file = path.join(dir, 'video.json'), spec = readJson(file), out = path.join(dir, 'out');
    const videos = exists(out) ? fs.readdirSync(out).filter((f) => /^video.*\.mp4$/.test(f)) : [];
    return { id, name: path.basename(dir), dir, elsewhere: path.resolve(path.dirname(dir)) !== path.resolve(home), broken: !spec || typeof spec !== 'object',
      brand: spec?.brand?.name || null, colours: { ink: spec?.brand?.ink, primary: spec?.brand?.primary, accent: spec?.brand?.accent },
      size: (Array.isArray(spec?.size) && spec.size.length === 2 && spec.size) || FORMATS[spec?.format] || FORMATS.tall, scenes: Array.isArray(spec?.scenes) ? spec.scenes.length : 0,
      edited: fs.statSync(file).mtimeMs, built: videos.length ? Math.max(...videos.map((f) => fs.statSync(path.join(out, f)).mtimeMs)) : null,
      building: !!jobs.get(id) && !jobs.get(id).done, poster: posterFor(id, dir) };
  }
  function starters() {
    const list = fs.readdirSync(STARTERS).filter((n) => exists(path.join(STARTERS, n, 'video.json'))).map((n) => {
      const about = readJson(path.join(STARTERS, n, 'starter.json')) || {}, spec = readJson(path.join(STARTERS, n, 'video.json'));
      return { id: n, name: about.name || n, about: about.about || '', order: about.order ?? 50, size: spec?.size || FORMATS[spec?.format] || FORMATS.tall,
        poster: exists(path.join(STARTERS, n, 'poster.jpg')) ? `/starter/${n}/poster.jpg` : null, colours: { ink: spec?.brand?.ink, primary: spec?.brand?.primary, accent: spec?.brand?.accent } };
    }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return [...list, { id: 'blank', name: 'Blank', about: 'Three plain scenes to write over.', size: FORMATS.tall, poster: null, colours: {} }];
  }
  function create({ name, starter }) {
    const clean = tidyName(name);
    if (!clean) throw new Error('Give the video a name.');
    if (starter !== 'blank' && (!/^[\w-]+$/.test(starter || '') || !exists(path.join(STARTERS, starter, 'video.json')))) throw new Error('Pick something to start from.');
    mkdir(home);
    let dir = path.join(home, clean); for (let n = 2; exists(dir); n++) dir = path.join(home, `${clean} ${n}`);
    if (starter === 'blank') {
      fs.writeFileSync(path.join(mkdir(dir), 'video.json'), JSON.stringify({ format: 'tall', brand: { name: clean }, scenes: [TEMPLATES.footage, TEMPLATES.list, TEMPLATES.end] }, null, 2) + '\n');
    } else fs.cpSync(path.join(STARTERS, starter), dir, { recursive: true, filter: (f) => !NOT_COPIED.test(f) });
    return idOf(dir);
  }
  function adopt(given) {      // a folder made elsewhere (by hand, by an agent, by `songbe init`)
    let dir = path.resolve(String(given ?? '').trim().replace(/^"(.*)"$/, '$1'));
    if (path.basename(dir).toLowerCase() === 'video.json') dir = path.dirname(dir);
    if (!exists(path.join(dir, 'video.json'))) throw new Error('There is no video.json in that folder.');
    remember(dir); return idOf(dir);
  }

  // ---- posters: one small still per project, drawn in a separate process so the pages stay responsive ----
  function posterFor(id, dir) {
    const file = path.join(dir, '.songbe', 'poster.jpg'), edited = fs.statSync(path.join(dir, 'video.json')).mtimeMs;
    const have = exists(file) ? fs.statSync(file).mtimeMs : 0, url = have ? `/p/${id}/poster?v=${Math.round(have)}` : null;
    if (have >= edited) return { state: 'ready', url };
    if (posters.failed.get(id) === edited || !toolState().ready) return { state: have ? 'ready' : 'none', url };
    if (posters.now !== id && !posters.queue.includes(id)) posters.queue.push(id);
    setImmediate(drawPosters);
    return { state: 'pending', url };
  }
  function drawPosters() {
    if (posters.now || !posters.queue.length) return;
    const id = posters.queue.shift(), dir = dirOf(id);
    if (!dir || (jobs.get(id) && !jobs.get(id).done)) return setImmediate(drawPosters);      // not while it is being built
    posters.now = id;
    const edited = fs.statSync(path.join(dir, 'video.json')).mtimeMs;
    const proc = posters.proc = spawn(process.execPath, [path.join(ROOT, 'bin', 'songbe.mjs'), 'poster', dir], { stdio: 'ignore', windowsHide: true, detached: !WIN });
    const limit = setTimeout(() => killTree(proc), 90000);
    proc.on('close', (code) => { clearTimeout(limit); if (code !== 0) posters.failed.set(id, edited); posters.now = posters.proc = null; drawPosters(); });
    proc.on('error', () => { clearTimeout(limit); posters.failed.set(id, edited); posters.now = posters.proc = null; });
  }

  // ---- one project: the editor's routes, all under /p/<id>/ ----
  async function projectRoute(req, res, u, id, dir, rest) {
    const prefix = `/p/${id}`, specFile = path.join(dir, 'video.json'), roots = [dir, KIT, PAGES], route = `${req.method} ${rest}`;
    // kit files keep their folder layout under /kit/ so that relative addresses inside them (fonts in the stylesheet) still resolve
    const link = (abs) => (within(abs, [KIT]) ? '/kit/' + path.relative(KIT, abs).split(path.sep).join('/') : `${prefix}/file?p=${encodeURIComponent(abs)}`);
    const state = async (spec) => {
      const errors = validate(spec, dir);
      if (errors.length) return { errors, plan: null };
      try { return { errors: [], plan: forBrowser(await makePlan(dir, { offline: true }), link) }; } catch (e) { return { errors: [e.message], plan: null }; }
    };
    const result = (j) => {
      const check = j.code !== 1 && !j.stopped ? readJson(path.join(dir, 'out', 'check.json')) : null, v = '&v=' + Date.now();
      if (check) { check.video = link(check.video) + v; check.sheet = link(check.sheet) + v; }
      return { code: j.code, stopped: j.stopped, check };
    };
    const job = jobs.get(id);

    if (route === 'GET /') return serveFile(req, res, path.join(PAGES, 'editor.html'), [PAGES]);
    if (route === 'GET /file') return serveFile(req, res, u.searchParams.get('p') || '', roots);
    if (route === 'GET /poster') return serveFile(req, res, path.join(dir, '.songbe', 'poster.jpg'), roots);
    if (route === 'GET /api/state') {
      const spec = readJson(specFile);
      return send(res, 200, { id, dir, name: path.basename(dir), version: VERSION, spec, table: { TOP, SCENES }, templates: TEMPLATES, keys: keysFor(dir), tools: toolState(),
        building: !!job && !job.done, ...(spec ? await state(spec) : { errors: ['video.json is not valid JSON. Fix it in a text editor, or start again from a copy.'], plan: null }) });
    }
    if (route === 'PUT /api/spec') {
      let spec; try { spec = JSON.parse((await body(req)).toString('utf8')); } catch (e) { return send(res, 400, { errors: ['not valid JSON: ' + e.message], plan: null }); }
      const errors = validate(spec, dir);
      if (errors.length) return send(res, 200, { errors, plan: null, saved: false });      // keep the last good file on disk
      fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n');
      return send(res, 200, { ...(await state(spec)), saved: true });
    }
    if (route === 'GET /preview') {
      const spec = readJson(specFile), s = spec ? await state(spec) : { plan: null };
      if (!s.plan) return send(res, 200, '<body style="font:16px system-ui;color:#c33;padding:24px;background:#111">Fix the problems listed in the editor to see the preview.</body>', MIME['.html']);
      return send(res, 200, pageHtml(s.plan, link), MIME['.html']);
    }
    if (route === 'POST /api/upload') {
      const name = path.basename(u.searchParams.get('name') || '').normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '-');
      if (!MEDIA.test(name)) return send(res, 400, { error: 'Only images, video and audio can be added.' });
      const to = path.join(mkdir(path.join(dir, 'media')), name), part = to + '.part';
      try { await pipeline(req, fs.createWriteStream(part)); fs.renameSync(part, to); } catch (e) { fs.rmSync(part, { force: true }); return send(res, 500, { error: 'The file could not be saved: ' + e.message }); }
      return send(res, 200, { path: 'media/' + name });
    }
    if (route === 'POST /api/build') {
      if (job && !job.done) return send(res, 409, { error: 'A build is already running.' });
      const j = { lines: [], done: false, code: null, stopped: false, watchers: new Set() }; jobs.set(id, j);
      const say = (ev, data) => { for (const w of j.watchers) w.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
      const feed = (d) => { for (const line of String(d).split(/\r?\n/)) if (line.trim()) { j.lines.push(line); say('line', line); } };
      j.proc = spawn(process.execPath, [path.join(ROOT, 'bin', 'songbe.mjs'), 'build', dir], { env: process.env, windowsHide: true, detached: !WIN });
      j.proc.stdout.on('data', feed); j.proc.stderr.on('data', feed);
      j.proc.on('error', (e) => feed('could not start the build: ' + e.message));
      j.proc.on('close', (code) => { j.done = true; j.code = code; say('done', result(j)); for (const w of j.watchers) w.end(); });
      return send(res, 200, { started: true });
    }
    if (route === 'POST /api/build/stop') {
      if (job && !job.done) { job.stopped = true; killTree(job.proc); }
      return send(res, 200, { stopped: true });
    }
    if (route === 'GET /api/build/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      if (!job) return res.end();
      for (const line of job.lines) res.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
      if (job.done) { res.write(`event: done\ndata: ${JSON.stringify(result(job))}\n\n`); return res.end(); }
      job.watchers.add(res); req.on('close', () => job.watchers.delete(res)); return;
    }
    if (route === 'POST /api/reveal') {      // show the project, or its finished video, in the system's file manager
      const video = path.join(dir, 'out', 'video.mp4'), what = (await json(req)).what;
      openOutside(what === 'video' && exists(video) ? video : dir, { select: what === 'video' && exists(video) });
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'not found' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!trusted(req)) return send(res, 403, { error: 'This address only answers the Songbe pages on this computer.' });
      const u = new URL(req.url, 'http://x'), route = `${req.method} ${u.pathname}`, m = /^\/p\/([0-9a-f]{16})(\/.*)?$/.exec(u.pathname);
      if (m) {
        const dir = dirOf(m[1]);
        if (!dir) return send(res, 404, '<body style="font:16px system-ui;color:#ddd;padding:24px;background:#111">This project is no longer where it was. <a style="color:#4FE0D6" href="/home">Back to your videos</a></body>', MIME['.html']);
        if (!m[2]) return send(res, 302, '', 'text/plain', { Location: `/p/${m[1]}/` });
        if (m[2] === '/' && req.method === 'GET' && !pinned) remember(dir);      // opening a project moves it to the top of the list
        return await projectRoute(req, res, u, m[1], dir, m[2]);
      }
      if (route === 'GET /') return send(res, 302, '', 'text/plain', { Location: pinned ? `/p/${idOf(pinned)}/` : '/home' });
      if (route === 'GET /home') return serveFile(req, res, path.join(PAGES, 'home.html'), [PAGES]);
      if (req.method === 'GET' && u.pathname.startsWith('/kit/')) return serveFile(req, res, path.join(KIT, decodeURIComponent(u.pathname.slice(5))), [KIT]);
      if (req.method === 'GET' && u.pathname.startsWith('/studio/')) return serveFile(req, res, path.join(PAGES, decodeURIComponent(u.pathname.slice(8))), [PAGES]);
      const st = /^\/starter\/([\w-]+)\/poster\.jpg$/.exec(u.pathname);
      if (req.method === 'GET' && st) return serveFile(req, res, path.join(STARTERS, st[1], 'poster.jpg'), [STARTERS]);

      if (route === 'GET /api/home') {
        return send(res, 200, { version: VERSION, home, data: dataDir(), shell: process.env.SONGBE_SHELL || null, pinned: pinned ? idOf(pinned) : null,
          projects: [...folders()].map(([id, dir]) => card(id, dir)).sort((a, b) => b.edited - a.edited), starters: starters(), tools: toolState(), keys: keysFor(null),
          setup: { ...setup, canFetch: WIN, advice: ffmpegAdvice(), pick: { version: FFMPEG_WINDOWS.version, megabytes: Math.round(FFMPEG_WINDOWS.bytes / 1e6), from: FFMPEG_WINDOWS.from, licence: FFMPEG_WINDOWS.licence } } });
      }
      if (route === 'POST /api/projects') { try { return send(res, 200, { id: create(await json(req)) }); } catch (e) { return send(res, 400, { error: e.message }); } }
      if (route === 'POST /api/projects/open') { try { return send(res, 200, { id: adopt((await json(req)).dir) }); } catch (e) { return send(res, 400, { error: e.message }); } }
      if (route === 'POST /api/projects/forget') { const id = (await json(req)).id, dir = dirOf(id); if (dir) { remember(dir, false); known.delete(id); } return send(res, 200, { ok: true }); }      // only leaves the list; the folder stays
      if (route === 'PUT /api/keys') { try { saveKeys(await json(req)); return send(res, 200, keysFor(null)); } catch (e) { return send(res, 400, { error: e.message }); } }
      if (route === 'POST /api/open') {
        const what = (await json(req)).what;
        if (LINKS[what]) openOutside(LINKS[what]); else if (what === 'home') openOutside(mkdir(home)); else if (what === 'data') openOutside(mkdir(dataDir())); else return send(res, 400, { error: 'unknown place' });
        return send(res, 200, { ok: true });
      }
      if (route === 'POST /api/setup/ffmpeg') {
        if (setup.running) return send(res, 409, { error: 'Already fetching.' });
        setup = { running: true, step: 'download', done: 0, total: FFMPEG_WINDOWS.bytes, error: null, version: null };
        installFfmpeg((p) => Object.assign(setup, p)).then((r) => { setup.version = r.version; }).catch((e) => { setup.error = e.message; }).finally(() => { setup.running = false; toolsAt = 0; });
        return send(res, 200, { started: true });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { if (!res.headersSent) send(res, 500, { error: e.message }); else res.end(); }
  });

  const port = await new Promise((ok, no) => {
    let p = wantPort; server.on('error', (e) => (e.code === 'EADDRINUSE' && p && p < wantPort + 20 ? server.listen(++p, '127.0.0.1') : no(e)));
    server.on('listening', () => ok(server.address().port)); server.listen(p, '127.0.0.1');
  });
  // Leaving: nothing this server started may outlive it (a build left running would keep the browser, ffmpeg and the engine's own files busy).
  const close = () => {
    posters.queue.length = 0; if (posters.proc) killTree(posters.proc);
    for (const j of jobs.values()) if (!j.done) { j.stopped = true; killTree(j.proc); }
    server.close(); server.closeAllConnections?.();
  };
  return { server, port, url: `http://127.0.0.1:${port}/`, home, close };
}

// `songbe studio <dir>`: the editor for one project
export async function studio(dir, wantPort = 4173) {
  const s = await serve({ port: wantPort, project: dir });
  log(`Songbe studio for ${dir}\n  open ${s.url}\n  preview is free; "Build" uses your keys\n  Ctrl-C to stop`);
  return s;
}
