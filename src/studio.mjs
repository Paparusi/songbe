// songbe studio — a local page for editing video.json with a live preview and a build button.
// Plain node:http on 127.0.0.1. The preview never calls a provider: it reuses cached voice and estimates the rest,
// so editing is free; only "Build" spends anything.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makePlan } from './plan.mjs';
import { pageHtml } from './render.mjs';
import { validate, TOP, SCENES, TEMPLATES } from './spec.mjs';
import { KIT, mkdir, exists, log } from './util.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const MEDIA = /\.(png|jpe?g|svg|webp|gif|mp4|mov|webm|wav|mp3)$/i;

// kit files keep their folder layout under /kit/ so that relative addresses inside them (fonts in the stylesheet) still resolve
const fileLink = (abs) => (abs.startsWith(KIT + path.sep) ? '/kit/' + path.relative(KIT, abs).split(path.sep).join('/') : '/file?p=' + encodeURIComponent(abs));
// the plan carries file:// addresses for the renderer; the browser gets the same files through /file
const forBrowser = (plan) => JSON.parse(JSON.stringify(plan).replace(/file:\/\/(\/[^"\\]*)/g, (_, p) => '/file?p=' + p.replace(/%2F/gi, '/')));

export async function studio(dir, wantPort = 4173) {
  const specFile = path.join(dir, 'video.json'), roots = [path.resolve(dir), KIT, path.join(ROOT, 'studio')];
  const inside = (p) => { const r = path.resolve(p); return roots.some((a) => r === a || r.startsWith(a + path.sep)); };
  const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  const body = (req) => new Promise((ok, no) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });

  async function state(spec) {
    const errors = validate(spec, dir);
    if (errors.length) return { errors, plan: null };
    try { return { errors: [], plan: forBrowser(await makePlan(dir, { offline: true })) }; } catch (e) { return { errors: [e.message], plan: null }; }
  }
  function serveFile(req, res, file) {
    if (!inside(file) || !exists(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'not found' });
    const size = fs.statSync(file).size, type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {   // video elements seek with range requests
      const a = range[1] ? +range[1] : 0, b = range[2] ? Math.min(+range[2], size - 1) : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Cache-Control': 'no-store' });
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }

  let job = null;   // one build at a time: { lines, done, code, watchers }
  function startBuild() {
    job = { lines: [], done: false, code: null, watchers: new Set() };
    const j = job, say = (ev, data) => { for (const w of j.watchers) w.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
    const proc = spawn(process.execPath, [path.join(ROOT, 'bin', 'songbe.mjs'), 'build', dir], { env: process.env });
    const feed = (d) => { for (const line of String(d).split('\n')) if (line.trim()) { j.lines.push(line); say('line', line); } };
    proc.stdout.on('data', feed); proc.stderr.on('data', feed);
    proc.on('close', (code) => { j.done = true; j.code = code; say('done', result(j)); for (const w of j.watchers) w.end(); });
  }
  function result(j) {
    const f = path.join(dir, 'out', 'check.json'); let check = null;
    if (j.code !== 1 && exists(f)) { check = JSON.parse(fs.readFileSync(f, 'utf8')); const v = '&v=' + Date.now(); check.video = fileLink(check.video) + v; check.sheet = fileLink(check.sheet) + v; }
    return { code: j.code, check };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x'), route = `${req.method} ${u.pathname}`;
      if (route === 'GET /') return serveFile(req, res, path.join(ROOT, 'studio', 'index.html'));
      if (route === 'GET /file') return serveFile(req, res, u.searchParams.get('p') || '');
      if (req.method === 'GET' && u.pathname.startsWith('/kit/')) return serveFile(req, res, path.join(KIT, decodeURIComponent(u.pathname.slice(5))));
      if (route === 'GET /api/state') {
        let spec, bad = null; try { spec = JSON.parse(fs.readFileSync(specFile, 'utf8')); } catch (e) { bad = 'video.json is not valid JSON: ' + e.message; spec = null; }
        return send(res, 200, { dir, name: path.basename(dir), spec, table: { TOP, SCENES }, templates: TEMPLATES, fonts: fileLink(path.join(KIT, 'fonts', 'fonts.css')),
          keys: { fal: !!process.env.FAL_KEY, groq: !!process.env.GROQ_API_KEY }, building: !!job && !job.done, ...(spec ? await state(spec) : { errors: [bad], plan: null }) });
      }
      if (route === 'PUT /api/spec') {
        let spec; try { spec = JSON.parse((await body(req)).toString('utf8')); } catch (e) { return send(res, 400, { errors: ['not valid JSON: ' + e.message], plan: null }); }
        const errors = validate(spec, dir);
        if (errors.length) return send(res, 200, { errors, plan: null, saved: false });      // keep the last good file on disk
        fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n');
        return send(res, 200, { ...(await state(spec)), saved: true });
      }
      if (route === 'GET /preview') {
        const spec = JSON.parse(fs.readFileSync(specFile, 'utf8')), s = await state(spec);
        if (!s.plan) return send(res, 200, `<body style="font:16px system-ui;color:#c33;padding:24px;background:#111">Fix the problems listed in the editor to see the preview.</body>`, MIME['.html']);
        return send(res, 200, pageHtml(s.plan, fileLink), MIME['.html']);
      }
      if (route === 'POST /api/upload') {
        const name = path.basename(u.searchParams.get('name') || '').replace(/[^\w.\-]+/g, '-');
        if (!MEDIA.test(name)) return send(res, 400, { error: 'only images, video and audio can be added' });
        fs.writeFileSync(path.join(mkdir(path.join(dir, 'media')), name), await body(req));
        return send(res, 200, { path: 'media/' + name });
      }
      if (route === 'POST /api/build') {
        if (job && !job.done) return send(res, 409, { error: 'a build is already running' });
        startBuild(); return send(res, 200, { started: true });
      }
      if (route === 'GET /api/build/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        if (!job) return res.end();
        for (const line of job.lines) res.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
        if (job.done) { res.write(`event: done\ndata: ${JSON.stringify(result(job))}\n\n`); return res.end(); }
        job.watchers.add(res); req.on('close', () => job.watchers.delete(res)); return;
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 500, { error: e.message }); }
  });

  const port = await new Promise((ok, no) => {
    let p = wantPort; server.on('error', (e) => (e.code === 'EADDRINUSE' && p < wantPort + 20 ? server.listen(++p, '127.0.0.1') : no(e)));
    server.on('listening', () => ok(p)); server.listen(p, '127.0.0.1');
  });
  log(`Songbe studio for ${dir}\n  open http://127.0.0.1:${port}\n  preview is free; "Build" uses your keys (FAL_KEY ${process.env.FAL_KEY ? 'set' : 'not set'})\n  Ctrl-C to stop`);
  return { server, port };
}
