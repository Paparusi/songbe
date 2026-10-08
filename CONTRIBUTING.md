# Contributing to Songbe

Thank you for looking. This file says how the project is put together and what a change needs before it is merged.

## Running it

Songbe needs Node 22 or newer, ffmpeg and a Chromium-family browser (Chrome, Chromium or Edge). It has no npm dependencies, so
there is nothing to install:

```bash
node bin/songbe.mjs doctor      # what was found
npm test                        # the whole suite, about half a minute
node bin/songbe.mjs app         # the app, served from your checkout
```

The tests never call a provider and need no key. The drawing tests need the browser and ffmpeg and are skipped without them.

## How it is laid out

| | |
| --- | --- |
| `src/` | the engine: `spec` (the shape of video.json), `plan` (voice, timeline, footage), `render` (the browser draws frames), `audio`, `check`, `write` (the writer), `studio` (the app's server), `packs`, `fit`, `setup` |
| `kit/` | what is drawn: `runtime.js` (time, looks, the layout check), `scenes.js` (the scene types), `base.css` and `styles/` (the looks), `fit.json` (measured) |
| `studio/` | the app's two pages: `home.html`, `editor.html` |
| `packs/` | bundled packs; `docs/packs.md` describes the format |
| `app/` | the desktop shell (Tauri): it starts the engine and shows its pages, nothing more |
| `examples/` | projects that double as starters and as test material |
| `tools/fit.mjs` | measures how much text fits where |

## Rules that keep it small

- **No dependencies** in the engine. Node's standard library, ffmpeg and the browser do the work.
- **One table for the spec.** `src/spec.mjs` describes every field once; the validator, the JSON Schema and the editor's form are
  derived from it. A new field goes there and nowhere else.
- **Scenes set geometry, looks set appearance.** A scene never names a colour, a corner radius or a font; a look never moves anything.
- **Every frame is a function of time.** `draw(t)` must give the same pixels whatever was drawn before it. No timers, no CSS
  transitions, no `will-change`.
- **A scene is designed once, for the tall frame, as a few blocks**; the square and wide frames move and scale whole blocks.
- **Nothing is fetched unasked**, and nothing a pack ships is executed.
- **A spec may come from anywhere.** Text from it reaches the page escaped; files are served only from the project and the kit.

## What a change needs

1. `npm test` passes.
2. If you touched the kit or a look: `node tools/fit.mjs --check` (and `--pack=<id> --check` for a pack) still matches, or the
   table is measured again and the new numbers are part of the change. If the pictures of the bundled examples change, say so and why.
3. A new scene type comes with: its entry in `SCENES` and `TEMPLATES`, layouts for all three frames, a turn through every look,
   its fields in `tools/fit.mjs` and `src/fit.mjs`, and a line in the README's table.
4. A new look is better made as a pack (`docs/packs.md`); `packs/classic` is the model.
5. Comments say why, in plain words. Code and documentation are in English.
6. Examples and starters carry only invented facts (`0900 000 000`, `example.com`).

## Reporting a problem

Open an issue with the `video.json` (remove anything private), the command you ran, and `out/check.json` if a build finished.
For anything that touches safety, read `SECURITY.md` first.

By contributing you agree that your contribution is licensed under the Apache License 2.0, like the rest of the project.
