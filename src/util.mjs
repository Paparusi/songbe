// Small shared helpers: running tools, hashing, locating ffmpeg / ffprobe / Chrome, reading .env files.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const KIT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'kit');

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 1 << 28, input: opts.input });
  if (r.error) throw new Error(`${path.basename(cmd)}: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${path.basename(cmd)} failed: ${String(r.stderr).trim().split('\n').slice(-4).join(' | ')}`);
  return opts.stderr ? String(r.stderr) : r.stdout;
}

export const sha = (x) => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 16);
export const mkdir = (d) => (fs.mkdirSync(d, { recursive: true }), d);
export const exists = (f) => fs.existsSync(f);

// KEY=value lines from <project>/.env become environment variables unless already set
export function loadDotEnv(dir) {
  const f = path.join(dir, '.env');
  if (!exists(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

const works = (bin, arg) => { try { return spawnSync(bin, [arg], { stdio: 'ignore' }).status === 0; } catch { return false; } };
function onPath(names) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) for (const n of names) { const f = path.join(dir, n); if (exists(f)) return f; }
  return null;
}
function find(label, envVar, names, extra, arg) {
  const tried = [process.env[envVar], onPath(names), ...extra].filter(Boolean);
  for (const c of tried) if (works(c, arg)) return c;
  throw new Error(`${label} not found. Install it or set ${envVar} to its path.`);
}
const glob1 = (dir, re) => { try { return fs.readdirSync(dir).filter((n) => re.test(n)).sort().reverse().map((n) => path.join(dir, n)); } catch { return []; } };

export const tools = {
  get ffmpeg() { return this._ff ??= find('ffmpeg', 'FW_FFMPEG', ['ffmpeg'], glob1(path.join(os.homedir(), '.local/bin'), /^ffmpeg/), '-version'); },
  get ffprobe() { return this._fp ??= find('ffprobe', 'FW_FFPROBE', ['ffprobe'], [], '-version'); },
  get chrome() {
    const pw = path.join(os.homedir(), '.cache/ms-playwright');
    const cached = [...glob1(pw, /^chromium_headless_shell-/).map((d) => path.join(d, 'chrome-headless-shell-linux64/chrome-headless-shell')),
      ...glob1(pw, /^chromium-\d/).map((d) => path.join(d, 'chrome-linux64/chrome')), ...glob1(pw, /^chromium-\d/).map((d) => path.join(d, 'chrome-linux/chrome'))];
    return this._ch ??= find('Chrome / Chromium', 'FW_CHROME', ['chrome-headless-shell', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
      [...cached, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'], '--version');
  },
};

export function duration(file) {
  return parseFloat(run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
}
export const log = (...a) => console.log(...a);
