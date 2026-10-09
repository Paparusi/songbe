#!/usr/bin/env node
// Starts a built Songbe app and finds out whether it works, the way a person would: the engine comes up, it is the version this
// repository says, the window loads the home page from it, a video can be started from every starter, and closing the app leaves
// nothing running.
//   node app/smoke.mjs             the program built in place (app/src-tauri/target/<system>/release/songbe)
//   node app/smoke.mjs <program>   another one: an installed copy (/usr/bin/songbe), an .AppImage, a .app's Contents/MacOS/songbe
// It needs a screen; on a Linux server run it under xvfb-run. Videos go to a throwaway folder. On Linux so does the app's data;
// on Windows and macOS the data folder is the real one (only its log is read), so close Songbe first if it is open.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(APP), WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const ID = 'app.songbe.studio', version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(ms, test) { for (const end = Date.now() + ms; ;) { const v = await test(); if (v || Date.now() > end) return v || null; await sleep(250); } }

function built() {
  const name = WIN ? 'songbe.exe' : 'songbe', target = path.join(APP, 'src-tauri', 'target');
  return [target, ...(fs.existsSync(target) ? fs.readdirSync(target).map((d) => path.join(target, d)) : [])].map((d) => path.join(d, 'release', name))
    .filter((f) => fs.existsSync(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

const given = process.argv[2], program = given ? path.resolve(given) : built();
if (!program || !fs.existsSync(program)) { console.error(given ? `no program at ${program}` : 'nothing built yet: run node app/build.mjs first, or name the program to start'); process.exit(2); }
const packed = /\.AppImage$/i.test(program), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-smoke-'));
const env = { ...process.env, SONGBE_TRACE: '1', SONGBE_HOME: path.join(tmp, 'videos') };
delete env.SONGBE_DATA;
if (!WIN && !MAC) env.XDG_DATA_HOME = path.join(tmp, 'data');
if (packed) env.APPIMAGE_EXTRACT_AND_RUN = '1';      // no FUSE needed
const data = WIN ? path.join(process.env.LOCALAPPDATA, ID) : MAC ? path.join(os.homedir(), 'Library', 'Application Support', ID) : path.join(env.XDG_DATA_HOME, ID);
const logFile = path.join(data, 'app.log'), before = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
const fresh = () => { try { const b = fs.readFileSync(logFile); return b.subarray(b.length >= before ? before : 0).toString('utf8'); } catch { return ''; } };

let bad = 0;
const ok = (pass, what, more = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${more ? ' — ' + more : ''}`); if (!pass) bad++; return pass; };
console.log(`Songbe ${version}: ${program}`);

// From a terminal the installed program is the command line too (not on Windows, where it has no console)
if (!WIN) {
  const r = spawnSync(program, ['--version'], { env, encoding: 'utf8', timeout: 60_000 });
  ok(r.status === 0 && r.stdout.trim() === version, 'as a command it answers with its version', r.status === 0 ? r.stdout.trim() : (r.stderr || r.error?.message || 'exit ' + r.status).trim().split('\n')[0]);
}

const proc = spawn(program, [], { env, stdio: 'ignore', detached: !WIN });
let ended = null; proc.on('exit', (code, signal) => { ended = { code, signal }; }).on('error', (e) => { ended = { code: e.message }; });
const stop = (signal) => { try { if (WIN) spawnSync('taskkill', ['/PID', String(proc.pid), '/F'], { stdio: 'ignore' }); else process.kill(packed || signal === 'SIGKILL' ? -proc.pid : proc.pid, signal); } catch {} };
const call = (url, more = {}) => fetch(url, { ...more, signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'songbe-smoke', 'X-Songbe': '1', ...(more.body ? { 'Content-Type': 'application/json' } : {}) } });

try {
  const ready = await until(90_000, () => /engine ready at (http:\/\/127\.0\.0\.1:\d+)\//.exec(fresh()) || ended);
  if (!ok(Array.isArray(ready), 'the engine came up', Array.isArray(ready) ? ready[1] : ended
    ? `the program ended first (${ended.code ?? ended.signal}); is Songbe already open? A second copy only brings the first one forward` : 'nothing after 90 seconds')) throw new Error('no engine');
  const at = ready[1], home = await (await call(at + '/api/home')).json();
  ok(home.version === version, 'it is this version', home.version === version ? version : `it says ${home.version}, the repository says ${version}`);
  ok(home.shell === 'tauri', 'it knows it runs inside the app');
  ok(home.packs?.length >= 1 && home.starters?.length >= 2, 'its looks and starters are there', `${home.starters?.length} starters, packs: ${(home.packs || []).map((p) => p.id).join(', ') || 'none'}`);
  console.log(`      tools on this computer: ffmpeg ${home.tools?.ffmpeg ? 'found' : 'MISSING'}, browser ${home.tools?.browser ? 'found' : 'MISSING'} (a build needs both; this check does not)`);

  // every starter becomes a project whose page of scenes can be opened
  for (const st of home.starters || []) {
    const made = await (await call(at + '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'smoke ' + st.id.replace(/[^a-z0-9]+/gi, ' '), starter: st.id }) })).json();
    const state = made.id ? await (await call(`${at}/p/${made.id}/api/state`)).json() : null, page = made.id ? await call(`${at}/p/${made.id}/preview`) : null;
    const poster = st.poster ? await call(at + st.poster) : null;
    // a starter with clips cannot be laid out where there is no ffmpeg: the app saying so is the right answer on such a computer
    const untooled = !home.tools?.ffmpeg && !!state?.spec && state.errors?.length > 0 && state.errors.every((e) => /ffmpeg/i.test(e));
    ok((!!state?.plan && !state.errors?.length || untooled) && page?.ok && (!poster || poster.ok), `starter "${st.name}" opens`,
      state?.spec ? `${state.spec.scenes.length} scenes${untooled ? ', not laid out: it has clips and this computer has no ffmpeg' : state.errors?.length ? ', problems: ' + state.errors.join('; ') : ''}${poster && !poster.ok ? ', its picture is missing' : ''}` : made.error || 'no project');
  }

  const seen = await until(45_000, () => fresh().split('\n').find((l) => l.startsWith('GET /api/home · ') && !l.includes('songbe-smoke')));
  ok(!!seen, 'the window loaded the home page and ran it', seen ? seen.split(' · ')[1].trim() : 'no request from the window in 45 seconds');

  stop('SIGTERM');      // only the window's program: the engine has to notice and leave by itself
  const gone = await until(15_000, async () => { try { await call(at + '/api/home'); return false; } catch { return true; } });
  ok(!!gone, 'closing the app stops the engine');
} catch (e) {
  if (e.message !== 'no engine') ok(false, 'the check itself', e.message);
  const tail = fresh().trim().split('\n').slice(-15).join('\n');
  if (tail) console.log('--- the end of the app\'s log\n' + tail);
} finally {
  stop('SIGKILL');
  await sleep(300);
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
}
console.log(bad ? `\n${bad} problem${bad === 1 ? '' : 's'}` : '\nall good');
process.exit(bad ? 1 : 0);
