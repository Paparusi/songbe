#!/usr/bin/env node
// The notes of a release: what changed in this version (its section of CHANGELOG.md) and how to get each installer running.
//   node app/notes.mjs [folder with the installers]     prints Markdown
// The folder is looked at for what is really there, and for macos-signing.txt, in which the macOS build says whether its app
// was signed and checked by Apple.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const log = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
// the section of this version, or of its line ("0.19" for 0.19.0) when the changelog names only that
const section = (name) => { const m = new RegExp(`^## ${name.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## )`, 'm').exec(log + '\n## '); return m ? m[1].trim() : null; };
const changes = section(version) ?? section(version.replace(/\.0$/, '')) ?? '';

const dir = process.argv[2], files = dir && fs.existsSync(dir) ? fs.readdirSync(dir) : [], has = (re) => files.find((f) => re.test(f));
const signing = files.includes('macos-signing.txt') ? fs.readFileSync(path.join(dir, 'macos-signing.txt'), 'utf8').trim() : 'unsigned';
const win = has(/setup\.exe$/i), dmg = has(/\.dmg$/i), deb = has(/\.deb$/i), img = has(/\.AppImage$/i);
const lines = [];
if (win) lines.push(`- **Windows** — \`${win}\`. It is not code-signed, so Windows shows "Windows protected your PC": choose *More info*, then *Run anyway*. It installs for you alone, without administrator rights.`);
if (dmg) lines.push(signing === 'notarized'
  ? `- **macOS (Apple silicon)** — \`${dmg}\`, signed and checked by Apple. Open it and drag Songbe to Applications. ffmpeg comes from \`brew install ffmpeg\`.`
  : `- **macOS (Apple silicon)** — \`${dmg}\`. It is not signed yet, so macOS refuses it at first: open it once, then allow it under *System Settings → Privacy & Security → Open Anyway*. ffmpeg comes from \`brew install ffmpeg\`.`);
if (deb) lines.push(`- **Debian and Ubuntu** — \`sudo apt install ./${deb}\`. It brings ffmpeg, and puts \`songbe\` on the path: the app, and the command line as well.`);
if (img) lines.push(`- **Other Linux** — \`${img}\`: make it executable and run it. It needs ffmpeg from your package manager.`);
lines.push('- **No installer** — clone the repository and run `node bin/songbe.mjs app`. Node 22 or newer, ffmpeg, and Chrome, Chromium or Edge.');

console.log(`${changes}\n\n### Getting it\n\n${lines.join('\n')}\n\nEvery installer was installed and started on a clean machine by the release workflow before it was attached.${files.includes('SHA256SUMS.txt') ? ' `SHA256SUMS.txt` lists their checksums.' : ''}`);
