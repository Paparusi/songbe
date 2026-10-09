# Working on Songbe

How the code is put together, and what a change needs before it goes in. Songbe is proprietary (see `LICENSE`); this file is for
the people who work on it.

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
| `src/film/` | films and series: `series` and `writer` (the bible and the scripts), `director` (fills the canvas), `flow` (the canvas, takes, the run), `models` (which model, through which door), `cut`, `board`, `canvas` (the window's server) |
| `studio/` | the app's pages: `home.html`, `editor.html`, `canvas.html` |
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
6. Examples and starters carry only invented facts, and nothing that could reach a real person: the phone number is `0123 456 789`
   (no Vietnamese number starts with 01, and the plan reminds people to replace it), addresses end in `example.com`.

## Selling: licence keys

Songbe is sold as the right to use the app, with a key (`src/licence.mjs`).

- A copy without a key is a **trial** for 14 days from its first start. After that it still opens every project, plays and
  exports what was made and lets everything be changed, but **makes nothing new** (building a video, generating footage, the
  writer, making any node of a film) until a key is entered: *Settings → Licence* in the app, or `songbe licence <key>`.
- A key is a signed note — who it is for, the plan, until when — that the app checks by itself, offline:
  `SB1.<note>.<signature>`. The public key is in `src/licence.mjs`; the private key is the seller's and is **never** in this
  repository. Issue a key with

  ```bash
  SONGBE_LICENCE_PRIVATE=/path/to/songbe_licence_private.pem node tools/licence.mjs issue --to="Nguyen Van A" --email=a@b.c --days=365
  ```

  and keep a list of what you issue (the id is printed): a key cannot be taken back, it can only run out.
- What it is not: a key is not tied to a computer, so it also works on its owner's second machine and can be passed on; and the
  engine is JavaScript a determined person can read and change. It keeps honest people honest. For activation limits and
  taking a key back, a payment service that issues keys and counts activations is the next step (Dodo Payments' licence keys
  have public activate / validate / deactivate endpoints a desktop app may call); the app must then also check that a key
  belongs to *its* product, which needs that product's id.
- Whoever changes the key pair makes every key issued so far worthless. Don't.
