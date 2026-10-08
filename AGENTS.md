# Driving Framewright as an agent

Framewright has no interactive steps. A build is: write `video.json`, look at stills, build, read the report, fix, rebuild.

1. **Write the spec.** Copy `examples/recruitment-vi/video.json` and change the text. One idea per scene, one or two short
   sentences in `say`. Use only facts the person gave you: do not invent prices, salaries, phone numbers or benefits.
2. **Look before rendering.** `fw frames <dir>` writes two stills per scene to `out/frames/`. Open them and check for clipped
   text, text over faces, and anything outside the safe area (keep important content between y = 190 and y = 1500).
3. **Build.** `fw build <dir>`. Without `FAL_KEY` the result has no voice or music; say so when you report.
4. **Read `out/check.json` and `out/sheet.jpg`.** `problems` must be empty. If `heard` is present, compare it with `spoken`:
   a sentence that is missing or garbled means the voice clip needs different wording.
5. **Report honestly.** State the duration, whether there is sound, what was generated with AI, and anything you could not verify
   (you cannot listen to the audio; the loudness numbers and the transcript are your evidence).

Rules

- Scenes that show generated people or places must set `notice`.
- Never write keys into `video.json`; they belong in the environment or `<dir>/.env`.
- Generation costs money. Reuse the cache (do not pass `--force` without a reason) and change one thing at a time.
