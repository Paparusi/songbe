#!/usr/bin/env node
// Builds the desktop app.
//   node app/build.mjs               installer for this computer's system
//   node app/build.mjs --no-bundle   only the program, no installer (the paths of what was made are printed at the end)
// It stages the engine — the tracked files of the core, plus the Node that runs this script — and then runs the Tauri bundler.
// Needs: Node 22 or newer, Rust, and the Tauri command (cargo install tauri-cli). On Windows build with the MSVC toolchain.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(APP), TAURI = path.join(APP, 'src-tauri');
const say = (...a) => console.log(...a);
const out = (cmd, args, cwd = ROOT) => { const r = spawnSync(cmd, args, { encoding: 'utf8', cwd }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${(r.stderr || r.error?.message || '').trim()}`); return r.stdout; };
if (+process.versions.node.split('.')[0] < 22) throw new Error(`the engine needs Node 22 or newer; this is ${process.version}`);

// ---- the core: exactly what the repository tracks, never a project's caches or renders ----
const PARTS = ['bin', 'src', 'kit', 'studio', 'examples', 'package.json', 'LICENSE', 'NOTICE'], SKIP = new Set(['.songbe', 'out', 'node_modules', '.git']);
function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs).filter((n) => !SKIP.has(n)).flatMap((n) => walk(path.join(rel, n)));
}
let files; try { files = out('git', ['ls-files', '-z', '--', ...PARTS]).split('\0').filter(Boolean); } catch { files = null; }
if (!files?.length) files = PARTS.flatMap(walk);
const core = path.join(TAURI, 'resources', 'core');
fs.rmSync(path.join(TAURI, 'resources'), { recursive: true, force: true });
for (const f of files) { const to = path.join(core, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), to); }
say(`core: ${files.length} files`);

// ---- the engine's runtime: this Node, named the way the bundler looks for side programs ----
const host = /host: (\S+)/.exec(out('rustc', ['-vV']))?.[1];
if (!host) throw new Error('rustc did not say which system it builds for');
if (process.platform === 'win32' && host.endsWith('-gnu')) say('note: the default Rust toolchain is GNU; if linking fails, set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc');
const bins = path.join(TAURI, 'binaries'); fs.rmSync(bins, { recursive: true, force: true }); fs.mkdirSync(bins, { recursive: true });
fs.copyFileSync(process.execPath, path.join(bins, `node-${host}${process.platform === 'win32' ? '.exe' : ''}`));
say(`engine: Node ${process.version} for ${host}`);

// ---- licences of what is shipped alongside: Node's must travel with its program ----
const lic = path.join(TAURI, 'resources', 'licenses'); fs.mkdirSync(lic, { recursive: true });
const near = [path.join(path.dirname(process.execPath), 'LICENSE'), path.join(path.dirname(process.execPath), '..', 'LICENSE')].find((f) => fs.existsSync(f));
let text = near ? fs.readFileSync(near, 'utf8') : null;
if (!text) {
  const r = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!r.ok) throw new Error(`could not get the licence of Node ${process.version} (${r.status}); put it at ${path.join(path.dirname(process.execPath), 'LICENSE')}`);
  text = await r.text();
}
if (!/Node\.js is licensed for use as follows/.test(text)) throw new Error('that does not look like the Node.js licence');
fs.writeFileSync(path.join(lic, 'NODE-LICENSE.txt'), text);
fs.writeFileSync(path.join(lic, 'README.txt'), `Songbe is licensed under the Apache License 2.0 (see core/LICENSE and core/NOTICE).\n\nThis folder holds the licences of programs shipped next to it:\n  NODE-LICENSE.txt   Node.js ${process.version}, the runtime of the Songbe engine (node${process.platform === 'win32' ? '.exe' : ''})\n\nffmpeg is not part of this package. When you ask Songbe to fetch it, it is downloaded from its publisher under its own licence (GPL).\n`);

// ---- the bundler ----
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, crate = /^version = "([^"]+)"/m.exec(fs.readFileSync(path.join(TAURI, 'Cargo.toml'), 'utf8'))[1];
if (pkg !== crate) say(`note: package.json says ${pkg} but app/src-tauri/Cargo.toml says ${crate}`);
// The target is named outright: left to itself the bundler assumes the system its own program was compiled for, which need not be
// the toolchain in use (a GNU-built cargo-tauri next to an MSVC build), and then looks for the runtime under the wrong name.
const rest = process.argv.slice(2), args = ['tauri', 'build', ...(rest.includes('--target') ? [] : ['--target', host]), ...rest];
say('cargo ' + args.join(' '));
const r = spawnSync('cargo', args, { cwd: APP, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
const made = path.join(TAURI, 'target', host, 'release'), bundles = path.join(made, 'bundle');
say('program: ' + path.join(made, 'songbe' + (process.platform === 'win32' ? '.exe' : '')));
if (fs.existsSync(bundles)) for (const kind of fs.readdirSync(bundles)) for (const f of fs.readdirSync(path.join(bundles, kind))) if (/\.(exe|msi|dmg|AppImage|deb|rpm)$/.test(f)) say('installer: ' + path.join(bundles, kind, f));
