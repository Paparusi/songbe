// Linux: an entry in the applications menu for people who run Songbe from its folder. It starts `songbe app` with the Node that
// ran this command, and Songbe leaves again when its window is closed. (Windows has the installer; macOS is not covered yet.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, WIN, MAC, tools } from './util.mjs';

const share = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
export function launcher(add) {
  if (WIN || MAC) return 'A menu entry is made on Linux only. On Windows use the installer; elsewhere start it with: songbe app';
  const entry = path.join(share(), 'applications', 'songbe.desktop'), icons = path.join(share(), 'icons', 'hicolor'), icon = path.join(icons, '256x256', 'apps', 'songbe.png'), before = path.join(icons, 'scalable', 'apps', 'songbe.svg');      // `before`: where versions up to 0.18.0 put a drawing
  fs.rmSync(before, { force: true });
  if (!add) { for (const f of [entry, icon]) fs.rmSync(f, { force: true }); return 'removed Songbe from the applications menu'; }
  if (!tools.window) return 'No Chrome, Chromium or Edge with a window was found: the menu entry would have nothing to open. Install one, or use the address that `songbe app` prints.';
  fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.mkdirSync(path.dirname(icon), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'studio', 'logo.png'), icon);
  const q = (s) => '"' + s.replace(/(["\\`$])/g, '\\$1') + '"';
  fs.writeFileSync(entry, `[Desktop Entry]\nType=Application\nName=Songbe\nComment=Short ads from a description\nExec=${q(process.execPath)} ${q(path.join(ROOT, 'bin', 'songbe.mjs'))} app --exit-with-window\nIcon=songbe\nTerminal=false\nCategories=AudioVideo;Video;\nStartupWMClass=songbe\n`);
  return `added Songbe to the applications menu (${entry})`;
}
