# Songbe

> Early version (0.5): six scene types, two looks, three frames (9:16, 1:1, 16:9), a local studio. Tested on Linux / WSL only.
>
> Songbe is named after the Sông Bé, a river in southern Vietnam.

Short vertical ads from a single `video.json`. Songbe turns a script and a few scene descriptions into a finished MP4 —
voice-over, footage, motion graphics, music, sound effects — and then checks its own output. It is a command-line tool with no
interactive steps, so an AI coding agent can drive it from start to finish.

```
songbe build examples/app-launch-en       →  examples/app-launch-en/out/video.mp4  (+ sheet.jpg, check.json)
```

Two examples are included: `examples/app-launch-en` (an app launch, English, graphics only) and
`examples/recruitment-vi` (a recruitment ad, Vietnamese, with footage).

## Why

- **One file in, one video out.** The spec is plain JSON you can diff, review and regenerate.
- **Deterministic picture.** Scenes are HTML/CSS; every frame is a pure function of time, rendered by headless Chrome with real motion blur (two samples per frame).
- **Sound follows picture.** Effects are synthesised from the cue list the animation itself reports, music ducks under the voice, the mix is normalised to −14 LUFS.
- **The timeline follows the voice.** Each scene opens just before its line is spoken; change a sentence and everything re-times itself.
- **Bring your own keys — or none.** With `FAL_KEY` you get voice, music and generated footage. Without it the build still completes (no voice or music, plain backgrounds).
- **No npm dependencies.** Node 22+, ffmpeg and a Chrome/Chromium binary. Chrome is driven directly over the DevTools protocol.
- **Self-check.** Every build writes a contact sheet (two frames per scene) and a report: duration, loudness, missing audio, and — with `GROQ_API_KEY` — a transcript of what is actually audible.

## Quick start

```bash
node bin/songbe.mjs doctor                        # are ffmpeg, ffprobe and Chrome found? which keys are set?
node bin/songbe.mjs frames examples/recruitment-vi # a few stills in out/frames — look before you render
node bin/songbe.mjs build  examples/recruitment-vi # full build
node bin/songbe.mjs preview examples/recruitment-vi # prints a file:// address: scrub and play in any browser
node bin/songbe.mjs init my-ad                     # start your own project from the example
node bin/songbe.mjs validate my-ad                 # every problem in video.json, with suggestions for typos
node bin/songbe.mjs schema                         # JSON Schema of video.json
```

Keys go in the environment or in `<project>/.env` (git-ignored): `FAL_KEY`, optionally `GROQ_API_KEY`.
Tool paths can be overridden with `SONGBE_FFMPEG`, `SONGBE_FFPROBE`, `SONGBE_CHROME`.

## The spec

```jsonc
{
  "size": [1080, 1920], "fps": 30,
  "brand": { "name": "…", "ink": "#0A1B31", "primary": "#004DFC", "accent": "#4FE0D6", "paper": "#F2F6FC", "muted": "#51627A",
             "logo": { "mark": "media/mark.png", "word": "media/wordmark-white.png" } },
  "voice": { "voice": "Casual_Guy", "language": "Vietnamese", "speed": 1.08, "emotion": "happy" },   // or false
  "music": { "prompt": "warm optimistic pop instrumental…" },                                        // or { "file": "media/track.mp3" }
  "scenes": [ … ]
}
```

Every scene has a `type`, and usually a `say` (one sentence or a list of sentences) that sets how long it lasts.
In text fields `[[words]]` puts them on a highlight plate and `**words**` colours them with the accent.

| Type | What it shows | Fields |
| --- | --- | --- |
| `footage` | Full-bleed footage or image with a headline on top | `media`, `mediaOffset`, `label`, `labelStyle: "pill"`, `pin`, `title`, `sub`, `chip` |
| `card` | Light page: headline, a media card and a stat card | `label`, `title`, `media`, `caption`, `stat { badge, heading, sub }` |
| `list` | Headline and rows that arrive one by one | `tone`, `label`, `title`, `items[] { text, sub, icon }` |
| `phone` | Headline over a phone showing app screens, with callouts | `tone`, `label`, `title`, `screens`, `callouts[] { text, side, y }` |
| `chat` | Dark page: headline, a short chat, a contact card, brand footer | `label`, `title`, `messages[] { from, text }`, `contact { kicker, button, number[], sub }`, `footer { name, line }` |
| `end` | Logo, name, tagline and a call to action | `tone`, `name`, `tagline`, `cta`, `badges[]`, `url` |

Every scene also accepts `say`, `duration` (when it has nothing to say) and `notice`.
The table above is a summary; `songbe schema` prints the exact shape and `songbe validate` checks a project against it.

`media` is a path to a video or image, or `{ "generate": { "image": "prompt", "motion": "prompt" } }` to create footage with the configured provider.
Set `notice` (for example "Illustration generated with AI") on scenes that use generated people or places.

## Frames

One spec, several frames. `"format"` is `tall` (1080×1920, the default), `square` (1080×1080) or `wide` (1920×1080);
`"size": [w, h]` sets anything else.

```bash
node bin/songbe.mjs build my-ad --format=wide                 # out/video-wide.mp4, same voice and music
node bin/songbe.mjs build my-ad --formats=tall,square,wide    # all three, one after another
```

Every scene is designed once, for the tall frame, as a few blocks (heading, media, rows, phone…). For the other frames the blocks are
moved and scaled as wholes: in a wide frame the heading goes left and the rest right; in a square one the same stack is tightened.
Footage is cropped to cover the frame, leaning upward in a square; a portrait clip in a wide frame is not cropped but shown whole at
the side, over a blurred copy of itself. Voice, music and timing are identical across frames, so extra frames cost nothing to generate.

## Looks

`"style"` at the top of the spec picks the look; the brand colours stay yours.

| Style | What it looks like |
| --- | --- |
| `soft` (default) | Rounded cards, soft shadows and glows, lines that rise from behind a mask, a slanted colour sweep at each cut |
| `bold` | Condensed capitals (Anton), flat colour fields, square corners with ink outlines and hard shadows, headlines on ink blocks over footage, a flat band dropping through each cut |

Try a look without touching the spec: `songbe frames my-ad --style=bold`, `songbe build my-ad --style=bold`.

A style is a style sheet of token overrides (`kit/styles/<name>.css`) plus a few numbers in `kit/runtime.js` (headline scale and
leading, how lines arrive, how cuts are covered). Scenes set geometry only, so a new look does not touch scene code.

## How a build runs

1. **Plan** — one voice clip per sentence, silence trimmed; scenes are laid on a timeline that follows the speech; footage is cut into frames.
2. **Picture** — the scene page is written to `.songbe/index.html`; Chrome draws each frame and the screenshots are piped into ffmpeg.
3. **Sound** — voice on the timeline, music with sidechain ducking, synthesised effects on the animation's cues, loudness normalised.
4. **Check** — `out/sheet.jpg` and `out/check.json`. The command exits non-zero if the audio is missing or the duration is off.

Generated assets are cached in `.songbe/cache` by a hash of their inputs: editing one sentence regenerates one voice clip, nothing else.

## Studio

```bash
node bin/songbe.mjs studio my-ad        # then open http://127.0.0.1:4173
```

A local page for people who would rather not edit JSON: scenes and their fields on the left, the video on the right, updating as
you type. The preview is free — it reuses voice clips that already exist and estimates the timing of new sentences — and the
**Build video** button runs the full build and shows the result with its self-check. Images and clips can be uploaded into the
project's `media/` folder from the form. The server listens on 127.0.0.1 only and serves nothing outside the project and the kit.

## Using it from an AI agent

`AGENTS.md` describes the loop for any coding agent. For Claude Code there is a ready-made skill: copy `skill/` to
`~/.claude/skills/songbe/` and ask for a video; the agent writes the spec, checks stills, builds and reads the report.

## Limits today

- Six scene types and two looks. Scene types live in `kit/scenes.js`, looks in `kit/styles/`.
- One provider (fal.ai) for voice, images, image-to-video and music.
- Frames other than the three named ones use the nearest layout family and have not been tuned.
- The studio edits fields and reorders scenes; there is no free-form canvas or keyframe timeline.

## License

Apache-2.0. The bundled fonts are Be Vietnam Pro and Anton (both SIL OFL 1.1). See `NOTICE`.
