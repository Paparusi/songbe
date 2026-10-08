// Getting ffmpeg for people who do not have it.
// macOS and Linux have a package manager one line away, so there Songbe only says which line. Windows has none by default, so
// Songbe can fetch the build that ffmpeg.org itself points Windows users to (gyan.dev, published on GitHub), check it against the
// checksum pinned below, and keep ffmpeg.exe and ffprobe.exe in its own data folder. Nothing is fetched unless the person asks
// for it: `songbe setup ffmpeg`, or the button in the app.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, ffmpegAdvice, managed, mkdir, run, tools, WIN } from './util.mjs';

export { ffmpegAdvice };

// One exact file. Moving to a newer ffmpeg means changing all four values together, after building the examples with it.
export const FFMPEG_WINDOWS = {
  version: '9.0.2', bytes: 114768076, sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
  from: 'gyan.dev, the Windows build that ffmpeg.org links to', licence: 'GPL version 3',
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

// Downloads, verifies and installs. `report({ step, done, total })` is called as it goes: step is download | check | unpack | done.
export async function installFfmpeg(report = () => {}) {
  if (!WIN) throw new Error(`On this system ffmpeg comes from the package manager:  ${ffmpegAdvice()}`);
  const pick = FFMPEG_WINDOWS, tmp = mkdir(path.join(dataDir(), 'tmp-ffmpeg')), zip = path.join(tmp, 'ffmpeg.zip'), dir = path.join(tmp, 'unpacked');
  try {
    report({ step: 'download', done: 0, total: pick.bytes });
    const res = await fetch(pick.url);
    if (!res.ok || !res.body) throw new Error(`the download did not start (the server answered ${res.status})`);
    const hash = crypto.createHash('sha256'), file = fs.createWriteStream(zip); let done = 0, told = 0;
    for await (const chunk of res.body) {
      hash.update(chunk); done += chunk.length;
      if (!file.write(chunk)) await new Promise((r) => file.once('drain', r));
      if (done - told > 1 << 20) { told = done; report({ step: 'download', done, total: pick.bytes }); }
    }
    await new Promise((ok, no) => file.end((e) => (e ? no(e) : ok())));
    report({ step: 'check', done, total: pick.bytes });
    const got = hash.digest('hex');
    if (got !== pick.sha256) throw new Error(`the downloaded file is not the expected one (checksum ${got.slice(0, 12)}… instead of ${pick.sha256.slice(0, 12)}…) and was deleted`);

    report({ step: 'unpack' });
    fs.rmSync(dir, { recursive: true, force: true }); mkdir(dir);
    run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir]);      // the tar that ships with Windows reads zip files
    const files = walk(dir), bin = mkdir(path.join(dataDir(), 'bin'));
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      const f = files.find((x) => path.basename(x).toLowerCase() === name);
      if (!f) throw new Error(`${name} is missing from the archive`);
      fs.copyFileSync(f, path.join(bin, name));
    }
    const licence = files.find((x) => /^licen[cs]e/i.test(path.basename(x)));      // the programs travel with their licence
    if (licence) fs.copyFileSync(licence, path.join(bin, 'ffmpeg-LICENSE.txt'));
    fs.writeFileSync(path.join(bin, 'ffmpeg-README.txt'), `ffmpeg ${pick.version} (essentials build) from ${pick.from}.\nLicence: ${pick.licence}. Source code and build details: https://www.gyan.dev/ffmpeg/builds/\nFetched from ${pick.url}\nSHA-256 ${pick.sha256}\n`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });      // the archive and what was unpacked from it
  }
  tools.reset();
  const version = run(managed('ffmpeg'), ['-version']).split('\n')[0].trim();
  run(managed('ffprobe'), ['-version']);
  report({ step: 'done', version });
  return { ffmpeg: managed('ffmpeg'), ffprobe: managed('ffprobe'), version };
}
