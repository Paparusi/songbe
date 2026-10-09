# Driving Songbe as an agent

Songbe has no interactive steps. A build is: write `video.json`, look at stills, build, read the report, fix, rebuild.

1. **Write the spec.** Start from an example (`songbe init <dir>`) and change the text; `songbe schema` prints the exact
   shape and `songbe validate <dir>` lists every problem, and every text longer than its place (`kit/fit.json` has the limits).
   `songbe write <dir> "<brief>"` drafts the whole file from a description when a key is set; treat it as a first draft and check it. One idea per scene, one or two short
   sentences in `say`. Use only facts the person gave you: do not invent prices, salaries, phone numbers or benefits.
2. **Look before rendering.** `songbe frames <dir>` writes two stills per scene to `out/frames/` and runs the layout check
   (`songbe lint <dir>` runs the check alone). Fix every line that starts with `!`. Then open the stills: the check measures boxes,
   it cannot see text across a face.
3. **Build.** `songbe build <dir>`. Without `FAL_KEY` the result has no voice or music; say so when you report.
4. **Read `out/check.json` and `out/sheet.jpg`.** `problems` must be empty. If `heard` is present, compare it with `spoken`:
   a sentence that is missing or garbled means the voice clip needs different wording.
5. **Report honestly.** State the duration, whether there is sound, what was generated with AI, and anything you could not verify
   (you cannot listen to the audio; the loudness numbers and the transcript are your evidence).

## Films and series

`songbe film help` lists the commands and [docs/film.md](docs/film.md) the files. A series is made in steps, cheapest first:

1. `songbe film new <dir> "<idea>"` writes `series.json`; `songbe film script <dir>` writes `episodes/NN.json`. Read both and
   correct them before anything is drawn: the look, each person's `look` and `wardrobe`, each scene's `staging`, each shot.
2. `songbe film run <dir> --upto=board`, then open `out/eN-board.jpg`. Check that everyone looks like their reference sheet, that
   each first frame shows what its shot says, and that nobody's clothes change between shots. Fix the script, or the node in
   `flow.json`, and run again: only what you changed is made again.
3. `songbe film run <dir>` makes the lines, the clips, the music and the cut. `songbe flow <dir>` says what stands for every node.
   Songbe measures every take it makes and asks again by itself for one that cannot be used; what it found odd is printed as
   `look:` lines (a colour that was not in the first frame, a jump, a silence — with the second it happens at). Read them, and
   look at those moments first. `songbe flow review <dir>` does the same for takes made earlier, and costs nothing.
4. For one bad clip: `songbe flow retake <dir> e1-s5`, or change that node (`prompt`, `model`, `seconds`) and `songbe flow run
   <dir> e1`. Choose between takes with `songbe flow takes` and `pick`.
5. Report what you could not judge: you cannot watch motion or hear a voice, and the review only measures. Transcribe `out/eN.mp4` when a key for that is set,
   compare with the lines, and say which shots you looked at as stills only.

Clips are the dear part (seconds of video); pictures and lines are cheap. Never `retake` a whole episode to fix one shot.

Rules

- Scenes that show generated people or places must set `notice`.
- Never write keys into `video.json`; they belong in the environment, in `<dir>/.env`, or in the app's settings.
- If `songbe doctor` reports ffmpeg missing, tell the person how to get it (the message says how); do not download programs on your own.
- Generation costs money. Reuse the cache (do not pass `--force` without a reason) and change one thing at a time.
- A model's own settings go in `imageOptions`, `videoOptions` or `options`, by that model's names: `songbe model <endpoint> --json`
  says which exist. Do not guess them; a wrong name stops the build.
