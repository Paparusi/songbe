# Films and series

Songbe makes a series from an idea: it writes the bible and the scripts, gives every person a face and a voice, draws every shot,
records every line, films every clip, and cuts the episodes. Everything it makes sits on one canvas, `flow.json`, where each
picture, line, clip and cut is a node of its own — so anything can be changed, rewired, handed to another model or made again
without touching the rest.

```sh
songbe film make my-series "Lan finds out that her husband leaves the house at two every night…"
```

That one command writes `series.json`, the script of episode 1, fills the canvas and makes `out/e1.mp4`. The steps can also be
taken one at a time, which is how a series is usually made, because the cheap steps are worth looking at before the dear ones:

```sh
songbe film new my-series "<idea>" --episodes=6 --seconds=60     # the bible: look, cast, places, episodes
songbe film script my-series                                     # the shot table of the next episode
songbe film run my-series --upto=board                           # faces, plates, scene pictures, every first frame
#   … look at out/e1-board.jpg, change what is wrong in episodes/01.json or in flow.json …
songbe film run my-series                                        # the lines, the clips, the music, the cut
```

Keys: `GEMINI_API_KEY` reaches Google's own API (the writer, pictures, clips, voices, music); `FAL_KEY` reaches the models of
other makers through fal.ai. With both, each model is asked at its maker when that is possible.

## How a series stays the same from shot to shot and from episode to episode

- **Faces.** Every person gets a portrait and from it a reference sheet (the face from three sides, the whole figure from the
  front and the back, in their one outfit). Every picture a person appears in is drawn with that sheet handed to the model.
- **Scenes.** Every scene gets one wide picture that fixes the place, the light and where everyone is. Every shot's first frame is
  drawn from that picture and the sheets of the people in the frame; the clip starts from that frame.
- **Voices.** Every person has one voice, and every line is recorded in it with the delivery the script asks for. A clip model
  that can act to a recording is handed the line first and performs to it. A model that can only speak a line itself films first,
  in a voice of its own choosing; the line is then **recorded to picture** the way a film is dubbed — to last as long as the lips
  moved, set exactly where they moved — and the model's voice is turned down there. Either way the voice in the film is the
  person's own, in every shot and every episode. A voice that is only heard is laid over a shot in which nobody speaks.
- **The look.** One note describes the medium and one the light and colours; every picture and clip prompt carries them.

## The files

| File | What it is | Who writes it |
|---|---|---|
| `series.json` | the bible: title, language, format, style, look, cast (with voices), places, the episodes planned, the models | `songbe film new`, then you |
| `episodes/01.json` | the script of an episode: scenes, and in each its shots | `songbe film script`, then you |
| `flow.json` | the canvas: every node | `songbe film expand` / `run` from the two above, and you |
| `.songbe/flow/` | every take ever made, and which one each node stands on | Songbe |
| `out/e1.mp4`, `.srt`, `e1-board.jpg`, `.html` | the episode, its subtitles, its board | Songbe |

A shot in a script:

```json
{ "id": "5", "size": "over shoulder", "camera": "static", "who": ["minh", "lan"],
  "action": "Lan stands with her arms crossed, looking at Minh's back.",
  "line": { "who": "lan", "text": "Đêm nào anh cũng lẻn đi. Anh giấu em chuyện gì?", "how": "firm, holding back tears" },
  "sound": "room tone", "model": "veo-3.1-fast" }
```

An episode's script may name its own models at the top — `"models": { "clip": "veo-3.1-lite", "talk": "veo-3.1-fast" }` — for
its shots nobody speaks in and those somebody does; they are written onto that episode's shots, so other episodes stay as made.

`size` is one of `wide`, `full`, `medium`, `two shot`, `over shoulder`, `close`, `extreme close`, `insert`. A shot has at most one
line, said by one person. When the speaker is in `who` they are seen saying it; when only the listener is, the voice is heard from
off screen. `seconds` sets the length of a shot nobody speaks in (a shot with a line lasts as long as the line). `continues: true`
starts a shot on the last frame of the one before. `model` hands this one shot to another clip model.

## The canvas

`flow.json` is `{ "format", "language", "models", "nodes": { "<name>": { "kind": … } } }`. A node says what it is made from.
**`@name` in a prompt puts another node there**: a note's words, a person's or a place's description (in full the first time), or
— for a picture, a clip or a recording — the file itself, handed to the model as a reference and called "image 1", "image 2" in
the order of mention. Write `@@` for a plain @.

| Kind | Says | Result |
|---|---|---|
| `text` | `text` | none: words to be mentioned elsewhere |
| `person` | `name`, `look`, `wardrobe`, `manner`, `voice: { voice, model, style, speed }` | none |
| `place` | `name`, `look` | none |
| `picture` | `prompt` (and `refs`, `aspect`, `model`, `options`) — or `file`, a picture of your own — or `grab: "@clip"`, `at: 2.5 \| "end"`, one frame of a clip | jpg |
| `voice` | `text`, `who: "@person"`, `how` (and `voice`, `model`, `style`, `speed`); `fit: "@clip"` records it to the lips of that clip, after the clip is filmed — or `file` | wav |
| `clip` | `prompt`, `frame: "@picture"`, `end: "@picture"`, `voice: "@voice"`, `heard: true` (the speaker is not seen), `ownVoice: true` (keep the model's voice), `refs`, `seconds`, `model`, `resolution`, `sound`, `options` — or `file` | mp4 |
| `music` | `prompt` (and `model`) — or `file` | mp3 |
| `cut` | `shots: ["@clip", { "clip": "@clip", "from": 0.4, "to": 3.1 }]`, `music: "@music"`, `title`, `notice`, `subtitles`, `musicVolume` | mp4, srt |

Any node may carry `label`, `group` and `note`. Nothing else is special: "an episode" is a cut and the nodes it works from.

```sh
songbe flow open my-series                 # the canvas in a window: cards and lines, a panel to change a node, Make
songbe flow my-series                      # what stands for every node: made, to make, waiting
songbe flow run my-series e1               # make what e1 works from and is missing or out of date
songbe flow retake my-series e1-s5         # another take of one clip; songbe flow takes / pick choose between takes
songbe flow lock my-series lan-sheet       # hold a take whatever changes around it
songbe flow board my-series                # one picture of the whole canvas
songbe flow models                         # the models known by name
```

**The window** (`songbe flow open`) shows every node as a card — a picture, a clip that plays, a line of dialogue — with a line
to each node it works from. Drag the background to move and scroll to zoom; drag a card by its top to place it. Choosing a card
opens its panel: its words, the nodes it starts from, its model, the prompt exactly as the model reads it, the result, its takes.
Changes are saved as you type, and only when the canvas is still sound with them. *Make it* makes one node, *Another take* asks
again, *Make what is missing* runs everything that is out of date, and a node that failed says why. *+ Add* puts a new node of
any kind on the canvas.

Every result is a **take**, kept under a key made from everything it was made from — the words, the model, and the takes of the
nodes it works from. So running again costs nothing, and changing one thing leaves exactly the nodes that work from it to be made
again. Going back to an earlier take brings back everything that was made from it.

The director (`songbe film expand`, and every `film run`) writes a node again only when what it was written from changed —
the shot's action, the person's outfit — and only if the node is still as the director wrote it. A node you changed by hand is
left alone, and the command says so; a node you added is never touched. A film already made is therefore not disturbed by a
newer Songbe that words its prompts differently; `songbe film expand --rewrite` asks for the newer wording on purpose.

## Models

A model is named by a short name (`songbe flow models` lists them) or, for anything else, by its door: `fal:<endpoint>` for any
endpoint on fal.ai, `google:<model id>` for any model of Google's API. The series names one per kind of work in `models`
(`picture`, `clip`, `talk` — a clip in which someone seen speaks —, `voice`, `music`); any node may name its own in `model`.

What a clip model can do decides how a line reaches the screen: one that takes a recording (an input called `target_audio_url`,
`audio_url` or `driving_audio_url`) acts to it; one known to speak (`veo-3.1`, `seedance-2.5`, `wan-3.0`, …) is told the line,
and the person's own voice is recorded to its lips afterwards (the director sets `fit` on such a line; `ownVoice` on the clip
keeps the model's voice instead); for any other the recording is laid over the shot. For endpoints named by their door this is
read from fal's description of them.

## What it cannot do yet

- In the canvas window a node is wired to another by writing `@name` or choosing it in a list; lines cannot be dragged yet.
  Films are opened with `songbe flow open`; the app's home screen does not list them yet.
- One line per shot, one speaker per shot. Two people talking over each other is not written.
- Reference pictures for clips go to fal.ai endpoints only; Google's Veo is asked with a first frame (and a last one).
- A clip is taken from its start; `from` and `to` in a cut choose the part to keep by hand.
- A line recorded to picture is fitted in time to where the lips moved, phrase by phrase; the lips themselves are not redrawn
  (no lip-sync model is run), so a model that paces a line very differently from the recording can still look a little off.
