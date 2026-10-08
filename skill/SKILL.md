---
name: songbe
description: Make a short vertical ad video (9:16, 15–30 s) from a brief with the Songbe CLI. Writes video.json, renders stills for review, builds the MP4 with voice, music and sound effects, then reads the self-check. Use when the user asks for an ad, promo, recruitment, product or app-launch video.
---

# Making a video with Songbe

Songbe turns one `video.json` into a finished MP4. You write the spec; the tool does voice, footage, motion graphics, music,
effects and a self-check. Nothing is interactive.

Run the CLI as `node <songbe repo>/bin/songbe.mjs <command>` (or `songbe <command>` if it is on the PATH).

## Workflow

1. `songbe doctor` — confirm ffmpeg, ffprobe and Chrome are found and see which keys are set.
   Without `FAL_KEY` there is no voice, music or generated footage; tell the user before you build.
2. `songbe init <dir>` then edit `<dir>/video.json`. `songbe schema` prints the full JSON Schema.
3. `songbe validate <dir>` — fix every problem it lists.
4. `songbe frames <dir>` — two stills per scene in `<dir>/out/frames/`. **Open them and look** before spending on a build:
   clipped or overlapping text, text across a face, anything important below y = 1500 (the app's caption area).
5. `songbe build <dir>` — writes `out/video.mp4`, `out/sheet.jpg`, `out/check.json`.
6. Read `out/check.json`: `problems` must be empty; compare `heard` with `spoken`. Look at `out/sheet.jpg`.
7. Report: duration, whether there is sound, which scenes use AI imagery, what you could not verify.

## Choosing scenes

Four to five scenes, one idea each, 15–25 seconds in total. A scene lasts as long as its `say`.

| Use | Scene | Notes |
| --- | --- | --- |
| Hook over real or generated footage | `footage` | `title` of 2 short lines; `[[word]]` highlights it. Set `notice` when the footage is AI-generated. |
| A claim backed by a picture and one number | `card` | `media` is the proof shot; `stat.badge` is 2–4 characters ("0đ", "24h", "4.8"). |
| Three benefits | `list` | 3 rows is best, 5 at most. `icon`: check, star, bolt, heart, shield, drop, clock, bell, sun, pin, or `number`. |
| An app or website in use | `phone` | `screens` are portrait screenshots (about 9:19.5). 1–2 `callouts`, each under 22 characters. |
| How to get in touch | `chat` | `contact.number` is a list of digit groups, read aloud by the last sentence of `say`. |
| Sign-off | `end` | Logo, `tagline`, `cta`, optional `badges` and `url`. |

## Writing rules

- Few words on screen. Sentence case, not capitals. A small `label`, a strong `title`, at most one supporting line.
- One or two short sentences per scene in `say`. Spell numbers and odd names the way they should be pronounced
  ("Vi Síp hai" rather than "VSIP 2") and keep the proper spelling in the on-screen text.
- Pick the look with `"style"`: `soft` (rounded, friendly: apps, services) or `bold` (condensed capitals, flat colour: promotions, recruitment, retail).
  Compare both cheaply with `songbe frames <dir> --style=bold` before deciding.
- Brand colours go in `brand`: `ink` (dark), `primary`, `accent` (bright), `paper` (light background), `muted` (secondary text).
- Use only facts the user gave you. Never invent prices, salaries, phone numbers, addresses or benefits; ask instead.
- Do not put another company's logo in the video unless the user says they may use it.

## Cost and cache

Voice, music and generated footage cost money on the user's own key. Everything generated is cached in `<dir>/.songbe/cache`
by a hash of its inputs: changing one sentence regenerates one voice clip. Do not pass `--force` without a reason, and make
layout changes with `songbe frames` (free) rather than full builds.

## When something is off

- A sentence missing or garbled in `heard` → reword that sentence in `say` and rebuild; only that clip is regenerated.
- Text too long for a line → shorten it; the kit shrinks type to fit but small type is a sign of too many words.
- `no audio stream` or `duration differs` in `problems` → rerun the build and report the error text if it repeats.
