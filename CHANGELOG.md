# Changelog

What changed, newest first. Versions before 1.0 may change the shape of `video.json`; when one does, it says so here.

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
