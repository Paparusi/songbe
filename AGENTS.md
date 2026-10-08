# Driving Songbe as an agent

Songbe has no interactive steps. A build is: write `video.json`, look at stills, build, read the report, fix, rebuild.

1. **Write the spec.** Start from an example (`songbe init <dir>`) and change the text; `songbe schema` prints the exact
   shape and `songbe validate <dir>` lists every problem. One idea per scene, one or two short
   sentences in `say`. Use only facts the person gave you: do not invent prices, salaries, phone numbers or benefits.
2. **Look before rendering.** `songbe frames <dir>` writes two stills per scene to `out/frames/` and runs the layout check
   (`songbe lint <dir>` runs the check alone). Fix every line that starts with `!`. Then open the stills: the check measures boxes,
   it cannot see text across a face.
3. **Build.** `songbe build <dir>`. Without `FAL_KEY` the result has no voice or music; say so when you report.
4. **Read `out/check.json` and `out/sheet.jpg`.** `problems` must be empty. If `heard` is present, compare it with `spoken`:
   a sentence that is missing or garbled means the voice clip needs different wording.
5. **Report honestly.** State the duration, whether there is sound, what was generated with AI, and anything you could not verify
   (you cannot listen to the audio; the loudness numbers and the transcript are your evidence).

Rules

- Scenes that show generated people or places must set `notice`.
- Never write keys into `video.json`; they belong in the environment, in `<dir>/.env`, or in the app's settings.
- If `songbe doctor` reports ffmpeg missing, tell the person how to get it (the message says how); do not download programs on your own.
- Generation costs money. Reuse the cache (do not pass `--force` without a reason) and change one thing at a time.
