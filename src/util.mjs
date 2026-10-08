// Small shared helpers: running tools, hashing, locating ffmpeg / ffprobe / a browser, reading .env files, and the few places
// where Windows, macOS and Linux differ.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KIT = path.join(ROOT, 'kit');
export const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const exe = (name) => (WIN ? name + '.exe' : name);
// Where Songbe keeps what belongs to the computer rather than to a project: keys, a fetched ffmpeg, the list of recent projects.
// The folder is named like the desktop app's identifier so that the app and the command line share it.
export const APP_ID = 'app.songbe.studio';
export const dataDir = () => (process.env.SONGBE_DATA ? path.resolve(process.env.SONGBE_DATA)
  : WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), APP_ID)
  : MAC ? path.join(os.homedir(), 'Library', 'Application Support', APP_ID) : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), APP_ID));

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 1 << 28, input: opts.input, windowsHide: true });
  if (r.error) throw new Error(`${path.basename(cmd)}: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${path.basename(cmd)} failed: ${String(r.stderr).trim().split('\n').slice(-4).join(' | ')}`);
  return opts.stderr ? String(r.stderr) : r.stdout;
}

export const sha = (x) => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 16);
export const mkdir = (d) => (fs.mkdirSync(d, { recursive: true }), d);
export const exists = (f) => fs.existsSync(f);

// KEY=value lines of an .env file
export function readDotEnv(file) {
  const found = {};
  if (!exists(file)) return found;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) found[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return found;
}
// …become environment variables unless already set. Called for the project first and then for the data folder,
// so the order of authority is: the real environment, the project's .env, the keys saved on this computer.
export function loadDotEnv(dir) {
  for (const [k, v] of Object.entries(readDotEnv(path.join(dir, '.env')))) if (process.env[k] === undefined) process.env[k] = v;
}

const works = (bin, arg) => { try { return spawnSync(bin, [arg], { stdio: 'ignore', windowsHide: true }).status === 0; } catch { return false; } };
function onPath(names) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) for (const n of names) { const f = path.join(dir, exe(n)); if (exists(f)) return f; }
  return null;
}
// what to tell someone whose ffmpeg is missing
export const ffmpegAdvice = () => (WIN ? 'songbe setup ffmpeg' : MAC ? 'brew install ffmpeg' : 'sudo apt install ffmpeg');
// first candidate that runs (or, when `run` is false, merely exists: a desktop browser must not be started just to ask its version)
function find(label, envVar, names, extra, arg, run = true) {
  const tried = [process.env[envVar], onPath(names), ...extra].filter(Boolean);
  for (const c of tried) if (run ? works(c, arg) : exists(c)) return c;
  throw new Error(/^ff/.test(label) ? `${label} not found. Get it with "${ffmpegAdvice()}"${WIN || MAC ? '' : " (or your system's package manager)"}, or set ${envVar} to its path.`
    : `${label} not found. Install it or set ${envVar} to its path.`);
}
const glob1 = (dir, re) => { try { return fs.readdirSync(dir).filter((n) => re.test(n)).sort().reverse().map((n) => path.join(dir, n)); } catch { return []; } };
export const managed = (name) => path.join(dataDir(), 'bin', exe(name));          // what `songbe setup ffmpeg` installs
const pf = (...parts) => [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean).map((base) => path.join(base, ...parts));
// desktop browsers by their usual homes; any Chromium will do, and every Windows has Edge
const BROWSERS = WIN ? [...pf('Microsoft', 'Edge', 'Application', 'msedge.exe'), ...pf('Google', 'Chrome', 'Application', 'chrome.exe')]
  : MAC ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'] : [];

export const tools = {
  get ffmpeg() { return this._ff ??= find('ffmpeg', 'SONGBE_FFMPEG', ['ffmpeg'], [managed('ffmpeg'), ...glob1(path.join(os.homedir(), '.local/bin'), /^ffmpeg/)], '-version'); },
  get ffprobe() { return this._fp ??= find('ffprobe', 'SONGBE_FFPROBE', ['ffprobe'], [managed('ffprobe')], '-version'); },
  // the browser that draws the frames
  get chrome() {
    if (this._ch) return this._ch;
    if (WIN || MAC) { try { return this._ch = find('Chrome or Edge', 'SONGBE_CHROME', [], BROWSERS, '', false); } catch (e) { if (WIN) throw e; } }
    const pw = path.join(os.homedir(), '.cache/ms-playwright');
    const cached = [...glob1(pw, /^chromium_headless_shell-/).map((d) => path.join(d, 'chrome-headless-shell-linux64/chrome-headless-shell')),
      ...glob1(pw, /^chromium-\d/).map((d) => path.join(d, 'chrome-linux64/chrome')), ...glob1(pw, /^chromium-\d/).map((d) => path.join(d, 'chrome-linux/chrome'))];
    return this._ch = find('Chrome / Chromium', 'SONGBE_CHROME', ['chrome-headless-shell', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'], cached, '--version');
  },
  // a browser that can show a window (for `songbe app`); null when only a headless one is around
  get window() {
    for (const c of [process.env.SONGBE_CHROME, ...BROWSERS, onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'])].filter(Boolean)) if (exists(c) && !/headless/.test(c)) return c;
    return null;
  },
  reset() { this._ff = this._fp = this._ch = undefined; },      // look again, after something was installed
};

export function duration(file) {
  return parseFloat(run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
}
export const log = (...a) => console.log(...a);

// Where new projects go: the system's video folder. (Not Documents: Windows often syncs that to the cloud file by file,
// and a project keeps thousands of small frame files next to it.)
export function projectsHome() {
  if (process.env.SONGBE_HOME) return path.resolve(process.env.SONGBE_HOME);
  let base = null;
  if (WIN) {
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'My Video'], { encoding: 'utf8', windowsHide: true });
    const m = /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(r.stdout || '');
    if (m) base = m[1].trim().replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? '');
  } else if (!MAC) {
    const r = spawnSync('xdg-user-dir', ['VIDEOS'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() && path.resolve(r.stdout.trim()) !== os.homedir()) base = r.stdout.trim();
  }
  if (!base || !exists(base)) base = [path.join(os.homedir(), MAC ? 'Movies' : 'Videos')].find(exists) || os.homedir();
  return path.join(base, 'Songbe');
}

// Hand a folder, a file (shown selected in its folder) or a web address to the system's own file manager or browser.
export function openOutside(target, { select = false } = {}) {
  const go = (cmd, args, more = {}) => { const p = spawn(cmd, args, { detached: true, stdio: 'ignore', ...more }); p.on('error', () => {}); p.unref(); };
  if (WIN) return go('explorer.exe', [select ? `/select,"${target}"` : `"${target}"`], { windowsVerbatimArguments: true });
  if (MAC) return go('open', select ? ['-R', target] : [target]);
  return go('xdg-open', [select ? path.dirname(target) : target]);
}

// Stop a program together with everything it started (a build runs a browser and ffmpeg).
export function killTree(proc) {
  if (!proc?.pid) return;
  if (WIN) spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} } }
}
