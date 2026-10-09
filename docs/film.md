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
  The portrait is drawn from what someone looks like and never from what they wear, so other clothes mean a new sheet from
  the same face: the same person.
- **Scenes.** Every scene gets one wide picture that fixes the place, the light and where everyone is. Every shot's first frame is
  drawn from that picture and the sheets of the people in the frame; the clip starts from that frame.
- **Voices.** Every person has one voice, and every line is recorded in it with the delivery the script asks for. A clip model
  that can act to a recording is handed the line first and performs to it. A model that can only speak a line itself films first,
  in a voice of its own choosing; the line is then **recorded to picture** the way a film is dubbed — to last as long as the lips
  moved, set exactly where they moved — and the model's voice is turned down there. Either way the voice in the film is the
  person's own, in every shot and every episode. A voice that is only heard is laid over a shot in which nobody speaks.
- **The look.** One note describes the medium and one the light and colours; every picture prompt carries them. A clip starts
  from a picture that already has the look, so it is told the medium and to keep what its first frame shows — told the palette
  again, a clip model has been seen to paint one of its colours onto a face.

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
songbe flow plan my-series e2              # what making e2 would ask of which model, and about what it costs
songbe flow spent my-series                # what the takes made so far cost by list price, day by day
songbe flow retake my-series e1-s5         # another take of one clip; songbe flow takes / pick choose between takes
songbe flow review my-series               # look at the takes that stand and say what is odd about them (no model is asked)
songbe flow lock my-series lan-sheet       # hold a take whatever changes around it
songbe flow board my-series                # one picture of the whole canvas
songbe flow models                         # the models known by name
```

**In the app** the home screen lists your films beside your videos. *New film* takes a few sentences, writes the series and the
shot table of its first episode, and opens the canvas with everything laid out and nothing made yet. On the canvas the
*Episodes* menu makes one episode up to a point — its pictures first, to look at before any clip is paid for — and writes the
next episode when the one before is done. *Open a folder* takes a film's folder too.

**The script, in the app.** *Script* opens the series and the shots of every episode beside the canvas. The *Series* tab holds
the look, the model for each kind of work, the cast with their looks, clothes and voices, the places, and the episodes planned
(add more as the story grows). Each *Episode* tab holds its scenes and shots — size, camera, who is in the frame, what is
seen, the line and who says it, the sound, a model of its own — with the first frame of each shot beside it, and whether its
clip is made. Shots are added, moved and removed without renaming the others (a shot added after 3 is 3b). What is typed is
saved a moment later, only when the series and every script are still sound with it — the drawer says what is not — and the
canvas follows: exactly the cards that work from what changed are to be made again, and putting back what was there brings
back what was made from it. An episode that is planned and not written is written by the writer from there, or by hand.

**The window** (`songbe flow open`, or a film's card in the app) shows every node as a card — a picture, a clip that plays, a line of dialogue — with a line
to each node it works from. Drag the background to move and scroll to zoom; drag a card by its top to place it. Choosing a card
opens its panel: its words, the nodes it starts from, its model, the prompt exactly as the model reads it, the result, its takes.
Changes are saved as you type, and only when the canvas is still sound with them. *Make it* makes one node, *Another take* asks
again, *Make what is missing* runs everything that is out of date, and a node that failed says why. *+ Add* puts a new node of
any kind on the canvas.

**Lines by hand.** Drag from the dot on a card's right edge onto another card to use it there: a picture as the frame a clip
starts or ends on, or as a reference; a recorded line as what a clip says; a note, a person or a place into a prompt; a person
as who says a line; a clip into a cut, music under it. When it could be more than one of these, the page asks which. Dropped on
an empty place, the line makes something new from the card — the clip that starts on a picture, the clip that carries on from
a clip's last frame, a picture from a note, a line a person says. Click a line to cut it. Each is one change to one node, kept
only when the canvas is still sound with it (two cards cannot work from each other). Lines to notes, people and places are
many, so they are drawn for the chosen card only.

**Money.** Clips are paid by the second, so a run says before it starts what it will ask of which model and about what that
costs by list price, and it may spend $5 unless `--budget=N` or `"budget"` in `series.json` says otherwise: a run that would
spend more stops before anything is asked, and one that reaches its budget on the way holds back what is left and says so. The
canvas shows the same figure on its Make button and wants a second click to go over. The prices are list prices read in
October 2026, there for the estimate; the maker's invoice decides.

**Looking at what it made.** A run looks at every take as soon as it is made: the take is decoded small and measured — no
model is asked, and it costs nothing. A take that **cannot be used** is asked for again by the run itself (once, unless
`--retakes=N` or `"retakes"` in `series.json` says otherwise, 0 to 3; each counts against the budget) and the better take
stands: a clip in which the model was to say the line and nobody is heard, a clip whose picture never moves, a recording with
no voice in it, with far more than the line, or with only a part of it. When no take can be used the node counts as not made
and nothing is built on it; its takes are kept, and choosing one (`songbe flow pick`, or its button in the panel) uses it as
it is. What is only **odd** is used and pointed at — a mark on the card, a line in the panel (click it and the clip jumps to
that moment), a tag on the board, a line in `songbe flow`: a strong colour that appears in a clip and is not in its first
frame, a jump as if cut to another shot, a stretch of black, a clip that does not begin on its picture or is shorter than
asked, a long pause inside a line, a picture in another shape, with plain bars, or of one flat colour.
Takes made before Songbe did this are looked at once when the film is opened in the app, or by `songbe flow review`.

Every result is a **take**, kept under a key made from everything it was made from — the words, the model, and the takes of the
nodes it works from. So running again costs nothing, and changing one thing leaves exactly the nodes that work from it to be made
again. Going back to an earlier take brings back everything that was made from it.

The director (`songbe film expand`, and every `film run`) writes a node again only when what it was written from changed —
the shot's action, the person's outfit — and only if the node is still as the director wrote it. A node you changed by hand is
left alone, and the command says so; a node you added is never touched. A cut is the exception that follows the script even
after you changed it: your order, your trims and the clips you added stay, a shot the script loses leaves the cut, and a new
shot goes in after the one it follows. A film already made is therefore not disturbed by a
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

## Who writes

The series and the scripts are written by a text model on your own account. With a key: Claude (`ANTHROPIC_API_KEY`), Gemini
(`GEMINI_API_KEY`), OpenAI (`OPENAI_API_KEY`), Grok (`XAI_API_KEY`), or fal.ai's (`FAL_KEY`). Without one: **your ChatGPT plan**
— *Continue with ChatGPT* in the app's settings, or `songbe account signin chatgpt` — after which what Songbe writes counts
against your Plus or Pro plan; you manage Songbe's share in ChatGPT's settings and sign out the same way you signed in.
`songbe account` says who would write; the first that is set up does, unless you choose one (`songbe account writer xai`, or
*Use for writing* in the settings).

A plan covers writing only. Pictures, clips, voices and music are separate work, paid by use with the keys above.

Claude subscriptions and Grok subscriptions cannot be used this way: Anthropic does not permit other products to offer
Claude.ai sign-in or to run on a person's Pro or Max plan, and xAI publishes no way for other apps to. Both work with an API key.

## What it cannot do yet

- One line per shot, one speaker per shot. Two people talking over each other is not written.
- Reference pictures for clips go to fal.ai endpoints only; Google's Veo is asked with a first frame (and a last one).
- A clip is taken from its start; `from` and `to` in a cut choose the part to keep by hand.
- A line recorded to picture is fitted in time to where the lips moved, phrase by phrase; the lips themselves are not redrawn
  (no lip-sync model is run), so a model that paces a line very differently from the recording can still look a little off.
- The review measures; it does not understand. It finds a colour that was not there, a cut, a freeze, a silence — not a face
  that is no longer the person's, a hand with six fingers, or the wrong person speaking. Those are still for your eyes.
