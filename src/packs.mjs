// Packs: starters and looks that live outside the core. A pack is a folder with a pack.json; it may hold
//   starters/<name>/   a project to start from: video.json, media/, starter.json { name, about, order }, poster.jpg
//   styles/<name>.css  a look, with <name>.json beside it for what a style sheet cannot say (headline scale, how lines arrive…)
//   fit.json           how much text fits where in its looks (made by `node tools/fit.mjs --pack=<pack>`)
// Packs are found in three places: packs/ in Songbe itself (bundled), <data folder>/packs (installed on this computer), and the
// folders named in SONGBE_PACKS (for someone building one). A pack carries its own licence, apart from Songbe's, whatever
// is plugged into it. A look is a style sheet and a few numbers — no pack runs code.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, dataDir, exists } from './util.mjs';

export const BUILTIN_STYLES = ['soft', 'bold'];
const NAME = /^[a-z][a-z0-9-]{1,23}$/, REVEALS = ['rise', 'wipe'], WIPES = ['slab', 'curtain', 'veil'];
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } };

export const installedPacksDir = () => path.join(dataDir(), 'packs');
// the numbers of a look, checked: anything missing or odd falls back to the default look's
export function styleParams(given) {
  const g = given && typeof given === 'object' ? given : {}, t = g.title && typeof g.title === 'object' ? g.title : {}, num = (v, lo, hi, d) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
  return { title: { scale: num(t.scale, .6, 1.8, 1), lead: num(t.lead, 0, 2, 0), ...(t.boxLead ? { boxLead: num(t.boxLead, 0, 2, 0) } : {}) }, reveal: REVEALS.includes(g.reveal) ? g.reveal : 'rise', wipe: WIPES.includes(g.wipe) ? g.wipe : 'slab' };
}

function readPack(dir, where) {
  const meta = readJson(path.join(dir, 'pack.json'));
  if (!meta || typeof meta !== 'object') return null;
  const id = path.basename(dir), styles = [], starters = [];
  if (exists(path.join(dir, 'styles'))) for (const f of fs.readdirSync(path.join(dir, 'styles')).sort()) {
    const name = f.endsWith('.css') ? f.slice(0, -4) : null;
    if (!name || !NAME.test(name) || BUILTIN_STYLES.includes(name)) continue;
    const about = readJson(path.join(dir, 'styles', name + '.json')) || {};
    styles.push({ name, pack: id, css: path.join(dir, 'styles', f), params: styleParams(about), about: typeof about.about === 'string' ? about.about : '' });
  }
  for (const n of dirs(path.join(dir, 'starters'))) {
    const d = path.join(dir, 'starters', n); if (!exists(path.join(d, 'video.json'))) continue;
    const about = readJson(path.join(d, 'starter.json')) || {};
    starters.push({ id: `${id}/${n}`, dir: d, pack: id, name: about.name || n, about: about.about || '', order: typeof about.order === 'number' ? about.order : 50 });
  }
  return { id, dir, where, name: String(meta.name || id), version: String(meta.version || ''), about: String(meta.about || ''), licence: String(meta.licence || meta.license || ''), styles, starters, fit: readJson(path.join(dir, 'fit.json'))?.limits || null };
}

// every pack that can be found; a pack met twice (same folder name) counts once, the first place winning
export function listPacks() {
  const roots = [[path.join(ROOT, 'packs'), 'bundled'], [installedPacksDir(), 'installed'], ...(process.env.SONGBE_PACKS || '').split(path.delimiter).filter(Boolean).map((d) => [path.resolve(d), 'linked'])], seen = new Map();
  for (const [root, where] of roots) for (const n of dirs(root)) { if (seen.has(n)) continue; const p = readPack(path.join(root, n), where); if (p) seen.set(n, p); }
  // a folder in SONGBE_PACKS may itself be a pack
  for (const [root, where] of roots) if (where === 'linked' && exists(path.join(root, 'pack.json')) && !seen.has(path.basename(root))) { const p = readPack(root, where); if (p) seen.set(p.id, p); }
  return [...seen.values()];
}
// looks that come from packs, by name (the first pack to claim a name keeps it)
export function packStyles() { const out = new Map(); for (const p of listPacks()) for (const s of p.styles) if (!out.has(s.name)) out.set(s.name, s); return out; }
export const styleNames = () => [...BUILTIN_STYLES, ...packStyles().keys()];

// what a new video can start from: Songbe's own examples, then every pack's starters
export function starterList() {
  const own = dirs(path.join(ROOT, 'examples')).filter((n) => exists(path.join(ROOT, 'examples', n, 'video.json'))).map((n) => { const about = readJson(path.join(ROOT, 'examples', n, 'starter.json')) || {};
    return { id: n, dir: path.join(ROOT, 'examples', n), pack: null, name: about.name || n, about: about.about || '', order: typeof about.order === 'number' ? about.order : 50 }; });
  return [...own, ...listPacks().flatMap((p) => p.starters)].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
export const starterDir = (id) => starterList().find((s) => s.id === id)?.dir || null;

// Put a pack folder among the installed ones. Returns the pack as read from its new place.
export function installPack(from) {
  const src = path.resolve(from), meta = readPack(src, 'installed');
  if (!meta) throw new Error(`${src} is not a pack: it has no pack.json`);
  if (!NAME.test(meta.id)) throw new Error(`a pack's folder name must be lower-case letters, digits and dashes: "${meta.id}"`);
  if (!meta.styles.length && !meta.starters.length) throw new Error('that pack has neither looks nor starters');
  const to = path.join(installedPacksDir(), meta.id);
  if (to === src) return meta;
  fs.rmSync(to, { recursive: true, force: true }); fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(src, to, { recursive: true, filter: (f) => !/[\\/](\.git|\.songbe|out|node_modules)([\\/]|$)/.test(f) });
  return readPack(to, 'installed');
}
export function removePack(id) {
  const dir = path.join(installedPacksDir(), id);
  if (!NAME.test(id) || !exists(path.join(dir, 'pack.json'))) throw new Error(`no installed pack is called "${id}" (bundled and linked packs are not removed this way)`);
  fs.rmSync(dir, { recursive: true, force: true });
}
