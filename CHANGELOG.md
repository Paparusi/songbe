# Changelog

What changed, newest first. Versions before 1.0 may change the shape of `video.json`; when one does, it says so here.

## 0.26
- **Licence keys.** A copy runs as a trial for 14 days from its first start. After that it still opens, plays and exports
  everything and lets it be changed, but makes nothing new until a key is entered (*Settings → Licence*, or
  `songbe licence <key>`). A key is a signed note the app checks by itself, offline; `tools/licence.mjs` issues them with the
  seller's private key, which is not in the repository. `songbe doctor` and the app's header say where a copy stands.

## 0.25
- **Films in the app.** The home screen lists your films beside your videos, each with the first frame of its first shot and how
  far it has come. *New film* takes a few sentences and writes the series and the shot table of its first episode, then opens the
  canvas. There the *Episodes* menu makes an episode up to a point (its pictures first) or writes the next one. *Open a folder*
  takes a film's folder; a film opened from the app joins the list.

## 0.24
- **What a run costs, before it runs.** `songbe flow plan` says what a run would ask of which model and about what that costs by
  list price; `songbe flow spent` what the takes made so far cost. A run may spend $5 unless `--budget=N` or `budget` in
  `series.json` says otherwise: over that it stops before anything is asked, and a run that reaches its budget holds back what
  is left. The canvas shows the figure on its Make button and wants a second click to go over.
- A provider that answers "too many at once" is given a proper pause (its limits count by the minute) and said to be; one that
  answers that the money has run out is not asked again.

## 0.23
- **Recorded to picture.** A clip model that speaks a line itself (Veo, Seedance, Wan…) films first, in a voice of its own; the
  line is then recorded in the person's own voice to last as long as the lips moved — as it comes naturally, and asked for again
  with a pace when that does not fit — set exactly where they moved, and the model's voice is turned down there. So a person
  keeps one voice whatever model films them, without a model that acts to a recording. The director wires it for such models
  (`fit` on the line); `ownVoice` on a clip keeps the model's voice.
- A line already recorded can also be stretched onto where a model spoke (when a clip is handed to a speaking model by hand).
- An episode's script may name its own models (`models`), written onto its shots only.
- A film made with a key that is no longer set can still be looked at, cut again and added to: only making something asks for
  the key of the model that makes it.

## 0.22
- **Songbe is proprietary from version 0.20 on.** `LICENSE` is now the Songbe Software Licence: all rights reserved, use needs a
  licence from the owner, what you make with it is yours. Versions 0.19.1 and earlier remain under Apache-2.0. `NOTICE` lists what
  it is distributed with; the documents of the open project are gone (`CONTRIBUTING.md` became `DEVELOPING.md`).

## 0.21
- **The canvas in a window.** `songbe flow open <dir>` shows `flow.json` as cards and lines: every picture, every clip that
  plays, every line of dialogue, and what each works from. A panel changes the chosen node — its words, where it starts, its
  model — and shows the prompt exactly as the model reads it, the result, and the takes to choose from. *Make it*, *Another
  take* and *Make what is missing* run in a process of their own with the cards following live; a node that fails says why.
  *+ Add* puts a node of any kind on the canvas; a change that would break the canvas is not saved, and the page says what is
  wrong with it.

## 0.20
- **Films and series.** `songbe film make <dir> "<idea>"` writes a series (its look, cast, places and episodes), the shot table
  of an episode, and makes the episode: a face and a reference sheet for everyone, a plate for every place, one wide picture per
  scene that fixes the light and where everyone is, a first frame for every shot drawn from it, every line recorded in its
  speaker's own voice, a clip per shot, music, and the cut with subtitles (`out/e1.mp4`, `.srt`). `--upto=board` stops before a
  clip is paid for and draws the whole episode as one picture. See [docs/film.md](docs/film.md).
- **The canvas.** Everything a film is made of is a node of `flow.json`: a note, a person, a place, a picture, a spoken line, a
  clip, music, a cut. `@name` in a prompt puts another node there — its words, or its file as a reference for the model. Each
  result is a take kept under a key of everything it was made from: a second run makes nothing, a changed line remakes exactly
  what works from it, and earlier takes can be chosen again or held (`songbe flow`, `run`, `retake`, `takes`, `pick`, `lock`).
- **Any model for any node.** Models are known by name (`songbe flow models`) or named by their door (`fal:<endpoint>`,
  `google:<model id>`); a series names one per kind of work and any node may name its own. A clip model that takes a recording
  acts to the line; one that speaks is told it; otherwise the voice is laid over.
- **Google's own API** (`GEMINI_API_KEY`): Nano Banana for pictures, Veo for clips, Gemini's voices, Lyria for music, and Gemini as
  the writer, asked directly. The writer (`songbe write` too) now uses Anthropic, Google or fal.ai, whichever key is set.

## 0.19.1
- The first public version, and the first with installers to download: Windows, macOS (Apple silicon) and Linux. The macOS
  app is new: built by the release workflow, opened from its disk image and checked there.
- The release workflow publishes only when every system's installer was installed and started, with checksums and notes
  (`app/notes.mjs`). The macOS app is signed and sent to Apple in a job of its own (`app/mac.mjs`) when the repository holds a
  Developer ID; in this version it is still unsigned, because Apple's first check of the account had not come back.
- The phone number in every example, starter and template is now `0123 456 789`, which no network can ring, and a plan says so
  while a video still shows it.
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
