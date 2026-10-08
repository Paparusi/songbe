// plan → picture. Writes the scene page, drives headless Chrome over the DevTools protocol (no browser library needed),
// asks the page for each frame and pipes the screenshots straight into ffmpeg. Two samples per frame give real motion blur.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT, tools, mkdir, log } from './util.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The scene page. `link` turns an absolute path into an address the page can load (file:// for rendering, /file?p= in the studio).
export function pageHtml(plan, link) {
  const k = (f) => link(path.join(KIT, f));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${plan.brand?.name || 'Songbe'}</title>
<link rel="stylesheet" href="${k('fonts/fonts.css')}"><link rel="stylesheet" href="${k('base.css')}"></head>
<body><div id="stage"></div><script src="${k('runtime.js')}"></script><script src="${k('scenes.js')}"></script>
<script>window.ready = SB.mount(${JSON.stringify(plan).replace(/</g, '\\u003c')}).then((n) => { if (!location.hash.includes('render')) SB.preview(); return n; });</script>
</body></html>`;
}

export function writePage(dir, plan) {
  const file = path.join(mkdir(path.join(dir, '.songbe')), 'index.html');
  fs.writeFileSync(file, pageHtml(plan, (f) => pathToFileURL(f).href));
  return file;
}

// Minimal DevTools-protocol session against a private headless Chrome.
async function openPage(pageFile, [w, h]) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-chrome-'));
  const chrome = spawn(tools.chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 100 && !ws; i++) {
    try {
      const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      ws = tabs.find((x) => x.type === 'page')?.webSocketDebuggerUrl;
    } catch {}
    if (!ws) await sleep(100);
  }
  if (!ws) { chrome.kill('SIGKILL'); throw new Error('could not connect to Chrome'); }
  const sock = new WebSocket(ws), waiting = new Map(); let id = 0;
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  await new Promise((r) => (sock.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('page error: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 400));
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(pageFile).href + '#render' });
  for (let i = 0; i < 150; i++) { if (await evaluate('typeof window.ready !== "undefined"').catch(() => false)) break; await sleep(100); }
  const fonts = await evaluate('window.ready');
  const shot = async (t, quality = 93) => {
    await evaluate(`SB.draw(${t}).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    return Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality })).result.data, 'base64');
  };
  const close = () => { try { sock.close(); } catch {} chrome.kill('SIGKILL'); fs.rmSync(profile, { recursive: true, force: true }); };
  return { evaluate, shot, close, fonts };
}

// A few stills for review before committing to a full render.
export async function stills(dir, plan, times) {
  const page = await openPage(writePage(dir, plan), plan.size), out = mkdir(path.join(dir, 'out', 'frames'));
  try {
    const files = [];
    for (const t of times) { const f = path.join(out, `t${t.toFixed(2)}.jpg`); fs.writeFileSync(f, await page.shot(t, 90)); files.push(f); }
    return files;
  } finally { page.close(); }
}

export async function renderVideo(dir, plan) {
  const work = path.join(dir, '.songbe'), page = await openPage(writePage(dir, plan), plan.size);
  try {
    fs.writeFileSync(path.join(work, 'cues.json'), await page.evaluate('JSON.stringify(SB.cues)'));
    const { fps } = plan, frames = Math.round(plan.duration * fps), blur = plan.motionBlur, out = path.join(work, 'picture.mp4');
    const filter = blur ? ['-vf', `tmix=frames=2:weights='1 1',select='mod(n\\,2)',setpts=N/(${fps}*TB)`] : [];
    const ff = spawn(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(blur ? fps * 2 : fps), '-c:v', 'mjpeg', '-i', '-', ...filter,
      '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited with ' + c)))));
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      for (const sub of blur ? [0, 0.25] : [0]) {          // second sample a quarter-frame later = 180° shutter
        const buf = await page.shot((f + sub) / fps);
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      }
      if (f % (fps * 5) === 0) log(`  frame ${f}/${frames} · ${Math.round((Date.now() - t0) / 1000)}s`);
    }
    ff.stdin.end(); await done;
    return out;
  } finally { page.close(); }
}
