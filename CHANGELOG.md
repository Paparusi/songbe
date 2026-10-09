# Changelog

What changed, newest first. Versions before 1.0 may change the shape of `video.json`; when one does, it says so here.

## 0.19.1
- The first public version. The phone number in every example, starter and template is now `0123 456 789`, which no network can
  ring, and a plan says so while a video still shows it.
- The recruitment example sets its AI notice on every scene with a generated picture and fits its own places.
- The logo is under the same licence as the rest (README, NOTICE).

## 0.19
- **Start from a picture of your own.** `generate.from` names a photo of yours: with a description, a model that takes pictures
  makes a new one from it — the same product in another place — and with only `motion` your photo itself is set in motion.
  Phone photos are turned upright; a photo replaced under the same name is noticed. In the editor it is a box with *Upload*.
- **A model's own settings.** `imageOptions`, `videoOptions`, and `options` for the music and the voice, by the model's own names.
  `songbe model <endpoint>` lists what a model takes, and the editor shows the same as a form. A wrong name stops the build
  before anything is paid for.
- A picture model that offers 1K, 2K and 4K is no longer asked for the largest without being told to.
- `generate` no longer accepts fields it does not know (a mistyped `imagemodel` used to be ignored in silence).
- Notes about footage say which scene they mean. A photo with a turn in its EXIF is measured the way it is shown.

## 0.18.1
- **The logo.** Songbe has its mark: in the app's header and opening page, as the icon of the window and the installers, in the
  Windows setup wizard, in the Linux menu entry, and at the top of the README. The placeholder is gone.
- The app's opening page no longer shows an empty box under "Starting…".
- The release workflow's Linux half has run: the `.deb` installs with `apt` and both packages pass `app/smoke.mjs` on the runner.

## 0.18
- The voice can be any text-to-speech model on fal.ai (`voice.model`), not only the default.
- **Linux packages.** The engine's runtime is now called `songbe-engine` on every system, so the `.deb` no longer claims
  `/usr/bin/node`; the `.deb` brings ffmpeg with it. On Linux and macOS the installed program is also the command line:
  `songbe build my-ad`, `songbe --version`.
- `app/smoke.mjs` starts a built app and checks it: the engine, its version, every starter, the window loading its page, nothing
  left running afterwards. The release workflow installs each package and runs this before attaching it.
- `songbe --version`. `SONGBE_TRACE=1` prints one line per request the app's pages make.
- The workflows use current action versions and keep the Tauri command between runs, which took the Linux release run from
  nineteen minutes to ten.

## 0.17
- The editor: click words in the preview to edit the field they come from; undo and redo.
- The test and release workflows can be started by hand for one system at a time.

## 0.16
- **Any model on fal.ai** for pictures, clips and music (`imageModel`, `videoModel`, the music's `model`): requests are shaped
  from fal's own description of each model. The clip model no longer follows the picture model by accident.

## 0.15
- `songbe app` runs once per computer: a second start opens a window on the one already running. On Linux,
  `songbe app --add-launcher` puts Songbe in the applications menu, and it leaves when its window is closed.
- The editor builds all three frames in one go and switches between the results.
- Release and test workflows for Windows, Linux and macOS (they stay idle while the repository is private).
- Contributing guide, security notes, this changelog, a comparison with ArtCraft, third-party notices in the installer.

## 0.14
- The editor rewrites one scene on request and can undo it; where footage is described, **Generate now** makes it at once
  (`songbe footage <dir> --scene=N`). Projects can be renamed and copied.

## 0.13
- Three more scene types: `offer` (a promotion), `photos` (pictures in cards), `quote` (a customer's words). A third example, `sale-vi`.

## 0.12
- **Packs**: looks and starters from outside the core (`docs/packs.md`), with `songbe pack list | add | remove`.
- A third look, `classic`, bundled as a pack. A new way to cover a cut: `veil`.

## 0.11
- The chat scene takes long messages; a phone without screenshots draws an app outline; every one-line text shrinks rather than overflows.
- The layout check measures the words themselves: cut off, off the frame, against the edge, into one another.

## 0.10
- **The writer**: `songbe write <dir> "<brief>"` and *Write it for me* in the app. Drafts are checked — shape, fit, layout,
  numbers that are not in the brief, readable colours — and corrected in up to three passes.
- `kit/fit.json`: how much text fits every place, measured (`tools/fit.mjs`). `songbe validate` lists texts longer than their place.

## 0.9
- **The app**: a home screen for projects, an editor per project, keys and tools in Settings; `songbe app`.
- Runs on Windows; `songbe setup ffmpeg` fetches ffmpeg there on request. A Windows installer (`node app/build.mjs`).

## 0.8
- Cuts move onto the beat of the music. Any frame size: scenes are laid out in design units.

## 0.7
- The layout check (`songbe lint`), whole-video checks after a build, and a test suite. Frames are drawn without cached layers.

## 0.6
- Captions that follow the voice, with `{spoken|shown}` where the two differ.

## 0.5
- Square and wide frames from the same spec.

## 0.4
- Looks: a style system and a second look, `bold`.

## 0.3
- `songbe studio`: edit in the browser with a live preview and a Build button.

## 0.2
- `list`, `phone` and `end` scenes; spec validation and JSON Schema; an English example; a skill for AI agents.

## 0.1
- One `video.json` to a finished vertical ad: voice, footage, motion graphics, music, sound effects, a self-check.
