# The desktop app

A native window around the Songbe engine. Everything a person sees is served by the engine itself (`src/studio.mjs`, the pages in
`studio/`), the same pages `songbe app` opens in a browser. The shell (`src-tauri/src/main.rs`, about 150 lines of Rust) does three
things: it starts the engine, it goes to the address the engine prints, and it stops the engine when the window closes.

```
songbe.exe            the shell: one window, WebView2
node.exe              the engine's runtime, an unmodified Node.js
core/                 the engine: bin, src, kit, studio, examples (exactly the files the repository tracks)
licenses/             licences of what is shipped alongside
```

## Building

Needs Node 22 or newer, Rust, and the Tauri command line (`cargo install tauri-cli`). On Windows use the MSVC toolchain
(`set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc` when the default is GNU) with the Visual Studio C++ build tools installed.

```bash
node app/build.mjs               # the installer: Songbe_<version>_x64-setup.exe
node app/build.mjs --no-bundle   # only the program, runnable in place
# both print where the result is: app/src-tauri/target/<system>/release/…
```

`build.mjs` stages the core (tracked files only, so no project caches or renders can slip in), copies the Node that runs the
script next to it as the engine's runtime together with Node's licence, and runs `cargo tauri build`. The first build downloads the
Tauri crates listed in `Cargo.lock`, and the bundler fetches NSIS, the tool that makes the installer.

The version comes from the repository's `package.json`. The installer installs for the current user, without administrator rights.
It is not code-signed, so Windows SmartScreen asks before running it; signing needs a certificate and is not set up.

## Where things live

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Projects | `Videos\Songbe` | `~/Movies/Songbe` | `~/Videos/Songbe` |
| Data: saved keys, fetched ffmpeg, recent projects, `app.log` | `%LOCALAPPDATA%\app.songbe.studio` | `~/Library/Application Support/app.songbe.studio` | `~/.local/share/app.songbe.studio` |

The command line uses the same two places, so keys saved in the app work for `songbe build`, and the other way round.
`SONGBE_HOME` and `SONGBE_DATA` move them.

## How the two halves talk

The shell runs `node core/bin/songbe.mjs app --shell`. The engine picks a free port on 127.0.0.1 and prints one line,
`SONGBE_READY {"url": "…"}`; the shell navigates there. The engine's standard input stays open for as long as the app runs: when it
closes — the window was closed, or the shell died — the engine stops any build it started and exits. Whatever else the engine
prints goes to `app.log` in the data folder.

The window refuses to navigate anywhere but the engine and its own opening page; links to the outside (getting a key) are opened by
the engine in the system's browser, from a fixed list.

For automated checks of a built app, `SONGBE_DEVTOOLS_PORT=9333` exposes the window to a DevTools client (Windows only).

## The icon

`app/icon.png` (1024×1024, from `studio/icon.svg`) is a placeholder. To replace it: put a new 1024×1024 PNG there, run
`cargo tauri icon icon.png` in `app/`, and keep `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` and `icon.png`
in `src-tauri/icons/`.
