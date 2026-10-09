#!/usr/bin/env node
// macOS: from the built Songbe.app to the disk image people download.
//   node app/mac.mjs      (after node app/build.mjs, which runs this once by itself)
// Without credentials it makes an unsigned image. With them it signs the app (hardened runtime), has Apple check it, attaches
// Apple's ticket, and does the same for the image, so that it opens on another Mac without a warning. Only Apple's own tools are
// used, and this step is separate from compiling on purpose: the signing identity is never in the environment while other
// people's build scripts run.
//
// Credentials, all from the environment:
//   APPLE_SIGNING_IDENTITY   "Developer ID Application: Name (TEAMID)", present in a keychain codesign can use
//   APPLE_API_KEY            the id of an App Store Connect API key        \
//   APPLE_API_ISSUER         the issuer id shown above the list of keys     > for Apple's check (notarization)
//   APPLE_API_KEY_PATH       the key's .p8 file                            /
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(APP), TAURI = path.join(APP, 'src-tauri');
const say = (...a) => console.log(...a);
function run(cmd, args, { quiet = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.filter((a) => !/\.p8$/.test(a)).join(' ')}\n${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').slice(-12).join('\n')}`);
  if (!quiet && r.stdout?.trim()) say(r.stdout.trim().split('\n').map((l) => '    ' + l).join('\n'));
  return r;
}

export function packageMac(env = process.env) {
  if (process.platform !== 'darwin') throw new Error('app/mac.mjs makes the macOS disk image and runs on macOS only');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, target = path.join(TAURI, 'target');
  const releases = [target, ...fs.readdirSync(target).map((d) => path.join(target, d))].map((d) => path.join(d, 'release')).filter((d) => fs.existsSync(path.join(d, 'bundle', 'macos', 'Songbe.app')))
    .sort((a, b) => fs.statSync(path.join(b, 'bundle', 'macos', 'Songbe.app')).mtimeMs - fs.statSync(path.join(a, 'bundle', 'macos', 'Songbe.app')).mtimeMs);
  if (!releases.length) throw new Error('no Songbe.app yet: run node app/build.mjs first');
  const release = releases[0], app = path.join(release, 'bundle', 'macos', 'Songbe.app'), arch = /x86_64/.test(release) ? 'x64' : /aarch64/.test(release) ? 'aarch64' : os.arch() === 'arm64' ? 'aarch64' : 'x64';
  const out = path.join(release, 'bundle', 'dmg'), dmg = path.join(out, `Songbe_${version}_${arch}.dmg`), work = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-mac-'));
  const identity = env.APPLE_SIGNING_IDENTITY || '', notary = env.APPLE_API_KEY && env.APPLE_API_ISSUER && env.APPLE_API_KEY_PATH
    ? ['--key', env.APPLE_API_KEY_PATH, '--key-id', env.APPLE_API_KEY, '--issuer', env.APPLE_API_ISSUER] : null;
  if (identity && !notary) throw new Error('a signing identity without the three APPLE_API_* values: a signed app that Apple has not checked is refused like an unsigned one');

  // Apple's check of one file: send it, wait for the verdict, and show Apple's own list of problems when it says no
  const checked = (file) => {
    const r = run('xcrun', ['notarytool', 'submit', file, ...notary, '--wait', '--output-format', 'json'], { quiet: true, allowFail: true });
    let verdict = {}; try { verdict = JSON.parse(r.stdout); } catch {}
    if (verdict.status !== 'Accepted') {
      const why = verdict.id ? run('xcrun', ['notarytool', 'log', verdict.id, ...notary], { quiet: true, allowFail: true }).stdout : r.stderr || r.stdout;
      throw new Error(`Apple did not accept ${path.basename(file)} (${verdict.status || 'no verdict'}):\n${String(why).trim().slice(0, 4000)}`);
    }
    say(`    Apple accepted ${path.basename(file)} (${verdict.id})`);
  };

  if (identity) {
    say('signing Songbe.app');
    const rights = path.join(TAURI, 'entitlements.plist'), sign = (file) => run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--entitlements', rights, '--sign', identity, file], { quiet: true });
    const inside = path.join(app, 'Contents', 'MacOS'), main = 'songbe';
    for (const f of fs.readdirSync(inside)) if (f !== main) sign(path.join(inside, f));      // what is nested first (the engine's runtime), then the app, which seals everything else
    sign(app);
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { quiet: true });
    const zip = path.join(work, 'Songbe.zip'); run('ditto', ['-c', '-k', '--keepParent', app, zip], { quiet: true });
    checked(zip); run('xcrun', ['stapler', 'staple', app], { quiet: true });
  }

  say(`making ${path.basename(dmg)}`);
  const stage = path.join(work, 'image'); fs.mkdirSync(stage); fs.mkdirSync(out, { recursive: true }); fs.rmSync(dmg, { force: true });
  run('ditto', [app, path.join(stage, 'Songbe.app')], { quiet: true }); fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
  run('hdiutil', ['create', '-volname', 'Songbe', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-fs', 'HFS+', dmg], { quiet: true });

  if (identity) {
    run('codesign', ['--force', '--timestamp', '--sign', identity, dmg], { quiet: true });
    checked(dmg); run('xcrun', ['stapler', 'staple', dmg], { quiet: true });
    // the questions another Mac will ask: is the app's seal whole, and does the system accept the app and the image as they are?
    run('xcrun', ['stapler', 'validate', dmg], { quiet: true });
    say(run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app], { quiet: true, allowFail: true }).stderr.trim().split('\n').map((l) => '    ' + l).join('\n'));
    const gate = run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg], { quiet: true, allowFail: true });
    say((gate.stderr || gate.stdout).trim().split('\n').map((l) => '    ' + l).join('\n'));
    if (gate.status !== 0) throw new Error('the system does not accept the signed image');
  }
  fs.writeFileSync(path.join(out, 'macos-signing.txt'), (identity ? 'notarized' : 'unsigned') + '\n');
  fs.rmSync(work, { recursive: true, force: true });
  say(`${identity ? 'signed and checked by Apple' : 'not signed (no APPLE_SIGNING_IDENTITY)'}: ${dmg} (${(fs.statSync(dmg).size / 1e6).toFixed(1)} MB)`);
  return dmg;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { packageMac(); } catch (e) { console.error('mac: ' + e.message); process.exit(1); }
}
