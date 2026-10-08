# The desktop app

A native window around the Songbe engine. Everything a person sees is served by the engine itself (`src/studio.mjs`, the pages in
`studio/`), the same pages `songbe app` opens in a browser. The shell (`src-tauri/src/main.rs`, about 150 lines of Rust) does three
things: it starts the engine, it goes to the address the engine prints, and it stops the engine when the window closes.

```
songbe                the shell: one window (WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS)
songbe-engine         the engine's runtime: an unmodified Node.js under a name of its own, so no package claims `node`
core/                 the engine: bin, src, kit, studio, examples, packs (exactly the files the repository tracks)
licenses/             licences of what is shipped alongside
```

| | Where the four land |
| --- | --- |
| Windows (setup program) | `%LOCALAPPDATA%\Songbe\` — `songbe.exe`, `songbe-engine.exe`, `core\`, `licenses\` |
| Linux (`.deb`) | `/usr/bin/songbe`, `/usr/bin/songbe-engine`, `/usr/lib/Songbe/core`, `/usr/lib/Songbe/licenses`; the package brings ffmpeg with it |
| Linux (AppImage) | the same layout inside the one file |
| macOS (disk image) | inside `Songbe.app`: `Contents/MacOS/` and `Contents/Resources/` |

On Linux and macOS the installed program is the command line too: anything after its name goes to the engine, so after installing
the `.deb`, `songbe build my-ad` and `songbe doctor` work in a terminal and `songbe` alone opens the window. (Not on Windows,
where a program with a window has no console to print to.)

## Building

Needs Node 22 or newer, Rust, and the Tauri command line (`cargo install tauri-cli`). On Windows use the MSVC toolchain
(`set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc` when the default is GNU) with the Visual Studio C++ build tools installed.

On Linux the window needs WebKitGTK's development files: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
libxdo-dev patchelf` (Debian and Ubuntu names).

```bash
node app/build.mjs               # the installer for this system: a setup program (Windows), an AppImage and a .deb (Linux), a disk image (macOS)
node app/build.mjs --no-bundle   # only the program, runnable in place
node app/smoke.mjs               # start what was built and check it (see below)
# build.mjs prints where the result is: app/src-tauri/target/<system>/release/…
```

`build.mjs` stages the core (tracked files only, so no project caches or renders can slip in), copies the Node that runs the
script next to it as the engine's runtime together with Node's licence, and runs `cargo tauri build`. The first build downloads the
Tauri crates listed in `Cargo.lock`, and on Windows the bundler fetches NSIS, the tool that makes the installer.

The version comes from the repository's `package.json`. On Windows the installer installs for the current user, without
administrator rights. Nothing is code-signed: Windows SmartScreen asks before running the installer, and macOS will refuse an
unsigned app that was downloaded until the person allows it in System Settings. Signing needs certificates and is not set up.

## Checking a built app

`node app/smoke.mjs [program]` starts the app and finds out what a person would: that the engine comes up and is the version the
repository says, that every starter turns into a project whose scenes can be drawn, that the window really loaded the home page
and ran it (the engine is asked to list its requests, `SONGBE_TRACE=1`), and that ending the window's program stops the engine.
Without an argument it takes the program built in place; give it `/usr/bin/songbe`, an `.AppImage` or a `.app`'s
`Contents/MacOS/songbe` to check an installed copy. It needs a screen (on a server: `xvfb-run -a`). The release workflow installs
each package on the runner and runs this before attaching it.

What has been checked so far:

| | Built | Started and checked |
| --- | --- | --- |
| Windows 11 | on Windows 11 | `smoke.mjs`, and by hand: install, a full build of a video, uninstall |
| Linux, AppImage and `.deb` | by the release workflow (Ubuntu 22.04) | the AppImage of 0.17 on Ubuntu 24.04 under WSL: engine up, home page in the window; the `.deb` not yet |
| macOS | not yet | not yet: the workflow is written and has never run (its minutes cost ten times the others while the repository is private) |

If the window stays blank on Linux, that is WebKitGTK and the graphics driver disagreeing; `WEBKIT_DISABLE_DMABUF_RENDERER=1 songbe`
is the usual way round it.

## Where things live

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Projects | `Videos\Songbe` | `~/Movies/Songbe` | `~/Videos/Songbe` |
| Data: saved keys, fetched ffmpeg, recent projects, `app.log` | `%LOCALAPPDATA%\app.songbe.studio` | `~/Library/Application Support/app.songbe.studio` | `~/.local/share/app.songbe.studio` |

The command line uses the same two places, so keys saved in the app work for `songbe build`, and the other way round.
`SONGBE_HOME` and `SONGBE_DATA` move them.

## How the two halves talk

The shell runs `songbe-engine core/bin/songbe.mjs app --shell`. The engine picks a free port on 127.0.0.1 and prints one line,
`SONGBE_READY {"url": "…"}`; the shell navigates there. The engine's standard input stays open for as long as the app runs: when it
closes — the window was closed, or the shell died — the engine stops any build it started and exits. Whatever else the engine
prints goes to `app.log` in the data folder.

The window refuses to navigate anywhere but the engine and its own opening page; links to the outside (getting a key) are opened by
the engine in the system's browser, from a fixed list.

For looking inside the window of a built app, `SONGBE_DEVTOOLS_PORT=9333` exposes it to a DevTools client (Windows only).

## The icon

`app/icon.png` (1024×1024, from `studio/icon.svg`) is a placeholder. To replace it: put a new 1024×1024 PNG there, run
`cargo tauri icon icon.png` in `app/`, and keep `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` and `icon.png`
in `src-tauri/icons/`.
