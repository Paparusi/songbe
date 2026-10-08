---
name: songbe
description: Make a short ad video (15–30 s; vertical 9:16, square or wide 16:9) from a brief with the Songbe CLI. Writes video.json, renders stills for review, builds the MP4 with voice, music and sound effects, then reads the self-check. Use when the user asks for an ad, promo, recruitment, product or app-launch video.
---

# Making a video with Songbe

Songbe turns one `video.json` into a finished MP4. You write the spec; the tool does voice, footage, motion graphics, music,
effects and a self-check. Nothing is interactive.

Run the CLI as `node <songbe repo>/bin/songbe.mjs <command>` (or `songbe <command>` if it is on the PATH).

## Workflow

1. `songbe doctor` — confirm ffmpeg, ffprobe and Chrome are found and see which keys are set.
   Without `FAL_KEY` there is no voice, music or generated footage; tell the user before you build.
2. `songbe init <dir>` then edit `<dir>/video.json`. `songbe schema` prints the full JSON Schema.
   (`songbe write <dir> "<brief>"` can draft the file from a description; you still own every word in it.)
3. `songbe validate <dir>` — fix every problem it lists, and shorten the texts it says are longer than their place.
4. `songbe frames <dir>` — two stills per scene in `<dir>/out/frames/`, plus the layout check: lines starting with `!` are problems
   (something leaves the frame, overlaps, or would be covered by captions) and must be fixed, usually by using fewer words; lines
   starting with `·` are notes. **Open the stills and look** as well: the check measures boxes, it cannot see text across a face.
5. `songbe build <dir>` — writes `out/video.mp4`, `out/sheet.jpg`, `out/check.json`.
6. Read `out/check.json`: `problems` must be empty (layout, black frames, flashes, missing sound); read the `notes`; compare `heard`
   with `spoken`. Look at `out/sheet.jpg`.
7. Report: duration, whether there is sound, which scenes use AI imagery, what you could not verify.

## Choosing scenes

Four to five scenes, one idea each, 15–25 seconds in total. A scene lasts as long as its `say`.

| Use | Scene | Notes |
| --- | --- | --- |
| Hook over real or generated footage | `footage` | `title` of 2 short lines; `[[word]]` highlights it. Set `notice` when the footage is AI-generated. |
| A claim backed by a picture and one number | `card` | `media` is the proof shot; `stat.badge` is 2–4 characters ("0đ", "24h", "4.8"). |
| Three benefits | `list` | 3 rows is best, 5 at most. `icon`: check, star, bolt, heart, shield, drop, clock, bell, sun, pin, or `number`. |
| An app or website in use | `phone` | `screens` are portrait screenshots (about 9:19.5), required. 1–2 `callouts`, each up to 22 characters. |
| How to get in touch | `chat` | `contact.number` is a list of digit groups, read aloud by the last sentence of `say`. |
| A promotion with a price | `offer` | `price` is the one big figure ("-30%", "99k"); `was` is struck out; `terms` says until when; optional `code`. Only real offers. |
| Pictures of the product or place | `photos` | One to four `photos[] { src, caption }`. |
| A customer's words | `quote` | `quote`, `name`, `role`, `stars`. Only words a real customer said: never write a testimonial yourself. |
| Sign-off | `end` | Logo, `tagline`, `cta`, optional `badges` and `url`. |

## Writing rules

- Few words on screen. Sentence case, not capitals. A small `label`, a strong `title`, at most one supporting line.
  A headline line holds about 14 characters (12 in the `bold` look), three lines at most; `kit/fit.json` lists every place.
- One or two short sentences per scene in `say`. Where the pronunciation differs from the spelling, give both as `{spoken|shown}`:
  `{Vi Síp hai|VSIP 2}`, `{zero nine hundred|0900}`. The first is read aloud, the second appears in captions.
- Turn on `"captions": true` for anything meant for a feed: most people watch with the sound off.
- Pick the look with `"style"`: `soft` (rounded, friendly: apps, services), `bold` (condensed capitals, flat colour: promotions, recruitment, retail)
  or `classic` (serif headlines, quiet colour: cafés, beauty, property, education). `songbe pack list` shows any others that are installed.
  Compare both cheaply with `songbe frames <dir> --style=bold` before deciding.
- The frame is `"format"`: `tall` (TikTok, Reels, Shorts), `square` (feeds) or `wide` (YouTube, screens). Write the spec once and
  build the others with `songbe build <dir> --formats=tall,square,wide`; the voice and music are reused, so they cost nothing more.
- Brand colours go in `brand`: `ink` (dark), `primary`, `accent` (bright), `paper` (light background), `muted` (secondary text).
- Use only facts the user gave you. Never invent prices, salaries, phone numbers, addresses or benefits; ask instead.
- Do not put another company's logo in the video unless the user says they may use it.

## Timing

You do not set times. A scene lasts as long as its `say`, and each cut is moved onto a beat of the music, so the length changes by a
few tenths of a second when the music is first generated. Report the duration from `out/check.json`, not from your own estimate.

## Cost and cache

Voice, music and generated footage cost money on the user's own key. Everything generated is cached in `<dir>/.songbe/cache`
by a hash of its inputs: changing one sentence regenerates one voice clip. Do not pass `--force` without a reason, and make
layout changes with `songbe frames` (free) rather than full builds.

## When something is off

- A sentence missing or garbled in `heard` → reword that sentence in `say` and rebuild; only that clip is regenerated.
- Text too long for a line → shorten it; the kit shrinks type to fit but small type is a sign of too many words.
- `no audio stream` or `duration differs` in `problems` → rerun the build and report the error text if it repeats.
