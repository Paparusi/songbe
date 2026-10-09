# Changelog

What changed, newest first. Versions before 1.0 may change the shape of `video.json`; when one does, it says so here.

## 0.36
- **The same person through a clip.** A clip model sees its first frame and nothing else of the people in it: what that
  picture does not show, the clip makes up. Seen twice on one film, and both mended in what the models are told:
  - someone lying down was drawn with the hair out of sight behind the head, and the clip gave her a short crop as she sat
    up — on two takes of the picture. A scene picture and a first frame with people in them are now told that hair is as
    long as on the reference sheet in every pose, and is seen spread beside the head of someone lying down;
  - a man seen small and from behind in a wide frame turned round with another face and a white shirt for his green one, and
    the woman beside him had her hair up. A shot that is not close (`wide`, `full`, `medium`, `two shot`, `over shoulder`)
    now tells the clip model in words how its people are known from afar — their figure (age, build, hair: `figure`, a new
    phrase on each person, written by the writer and shown in the script drawer) and what they wear — after everything else
    it is told. Filmed again, he kept his shirt and she her hair, and she still did what the shot directs her to do. The
    face is left out: told the whole look, with "a prominent mole", two clips painted a black coin on her cheek.
  Clips and pictures already on a canvas keep their words; `songbe film expand --rewrite=<node>` asks for the new ones.
- **A recorded line is listened to.** A line was recorded so breathily that three hearings of it gave three other sentences,
  and it was found only after a clip had been acted to it. When there is a key for a model that hears (Google's), each take
  of a line is now listened to once: a line of three words or more of which almost nothing is heard is recorded again by the
  run itself, a doubtful one is pointed at with what was heard, and what was heard is kept with the take. Tried on that
  line: the take that could not be understood was heard as three other words and refused, the one recorded after it was heard
  right. `"listen": false` in `series.json` turns it off.
- **The lips of someone who speaks are looked at.** A clip acted to a recording came back with the voice and a mouth shut
  through a five-second line, and nothing measured could tell. With a key for a model that sees, a few frames taken at the
  loudest moments of the line are shown to it, and it counts those in which the speaker's lips are parted: none, and the
  clip is filmed again by the run itself. Tried on that clip: 0 of 6 for the take with the shut mouth, 3 of 6 for the take
  filmed after it, 3 of 3 for two other speaking clips.
- The review also finds a clip that leaves its first frame at once (the model frames the shot anew from its second frame).
- **The last episode ends the story.** The writer was told to end every episode on an open question, the last one too — and
  a three-episode film ended on a look, with nothing paid off. It is now told that the last episode is different: what the
  series set up is paid off on screen, we see what became of the person we followed, and it closes on an image that is final.
- **A filmed shot is made longer or shorter without being filmed again.** How long a shot is kept was fixed when its clip
  was filmed, so a new `seconds` did nothing until the clip was made again — and the last shot of an episode, a face held
  after a one-word line, was cut after a second. The cut now keeps what the clip says now: within the seconds the model made
  (five, for a three-second shot by a model that makes five), a shot is lengthened or shortened by the cut alone.
- Tried against the models: the second episode of that film — fifteen clips by MiniMax H3, six lines, five sounds set at
  their seconds. Thirteen clips stood as filmed; one was filmed again for its people (above), one for a line that could not
  be understood as first recorded.
  And the third: fifteen clips, six lines. Two clips were filmed again for the mole (above). One clip cut to a closer
  framing nine frames in; the review pointed at the jump, and the cut starts that shot after it (`{ "clip": "@e3-s14",
  "from": 0.4 }`). Google's prepaid credit ran out before the episode's music was made: nothing more was asked of Google in
  that run, and the episode was cut with the first episode's theme.

## 0.35
- **Acting.** An episode came out stiff: its picture moved half as much as that of the film before it, on the same clip
  model. Three things in what the model was told, all changed:
  - a clip was told that "everyone's face stays as in the first frame" — it is now told who everyone stays, and that the
    acting is alive (people blink and breathe, their eyes move, what they feel shows and changes);
  - a first frame was drawn as the action already done (eyes open, hand raised), which left the clip nothing to do — it is
    now drawn as the instant before;
  - a shot said what happens and not how it is played — a script's shot has `acting` (the feeling, and how face and body
    show it), the writer writes it, the script drawer shows it, and it goes to the clip model.
  Tried on three shots of that episode: the picture moves two to two and a half times as much, and each face goes somewhere.
  Films already made keep their words; `songbe film expand --rewrite=keep,<frames>` asks for the new ones.
- The writer is told not to ask for stiff or motionless acting, and to keep a still camera for the few shots meant to be still.

## 0.34
- **A shot of a thing alone stays empty.** The clip model walked an arm through an insert of a wall; a shot with nobody in it
  is now told that nobody is in the frame and nobody enters it. Shots already on a canvas keep their words.
- `songbe film expand --rewrite=e1-s10,e2-s3` words afresh only the nodes that are named.
- Tried against the models: the first episode of a new film, start to finish — fourteen clips by MiniMax H3 acting to lines
  recorded first, three knocks set at their seconds, music. Thirteen clips stood as filmed; one was filmed again.

## 0.33
- **Sounds.** A new kind of node: a sound made from a few words (a knock, a door, rain) or a recording of your own. A clip
  names the sounds heard in it and the second each begins; the cut sets them there, over the clip's own sound, and no clip is
  filmed again when a sound changes. The sounds a story turns on belong to the series (`"sounds"` in `series.json`, `"hear"`
  on a shot): each is made once and is the same every time, like a face. On the canvas a sound is a card that is dragged
  onto a clip; in the script drawer the series lists its sounds and a shot says which it hears and when. Made through fal.ai
  (ElevenLabs' sound effects, Stable Audio, or any text-to-audio endpoint).
- A clip may hear only the first seconds of a sound (`to`): a sound model asked for one knock gave one, then five, then two.
- A recorded line is judged by its voice alone: a line full of pauses ("Ai... ai đang ở đó?") no longer looks cut short.

## 0.32
- **A maker that says the money has run out is not asked again in that run.** Credit used up, a spending cap reached, an
  account locked: the piece that met the refusal says so, every other piece of that maker says it was not asked, and what
  another maker can do is still made. (Before, each piece went and collected the same refusal.)
- **A scene's hour is its own.** The picture of a place is drawn by day; a scene set there at midnight kept the bright window.
  The scene is now told that the walls, furniture and layout are kept while the hour and the light are this moment's. Tried
  on two night scenes of a real film: the windows went dark in fifteen of sixteen pictures, and the last on a second take.
- Tried against the models: a new film from an idea — the series, three scripts, the cast and the first two boards. Portraits
  drawn without the clothes and sheets drawn from them in the outfit keep one face (three people, 43 pictures); nothing the
  review points at.

## 0.31
- **A line recorded to picture comes closer to the lips before it is stretched.** Stretching is heard: sped up by a fifth, a
  whispered line was no longer made out. The line is now asked for again until every phrase is within about a tenth of the
  place it goes — judged phrase by phrase, a single word aside — and told how long each phrase takes; a recording that still
  had to be stretched as far as sounds right is pointed at.
- Tried against the models (Veo 3.1 fast, at Google): a clip told to keep what its first frame shows, without the palette,
  came back without the yellow patch the same shot had before — one take, so a sign and not a proof.

## 0.30
- **Lines by hand on the canvas.** Drag from the dot on a card's right edge onto another card to use it there — a picture as
  the frame a clip starts or ends on or as a reference, a line as what a clip says, a note, a person or a place into a prompt,
  a clip into a cut, music under it — and the page asks which when it could be more than one. Dropped on an empty place, the
  line makes something new from the card: the clip that starts on a picture, the clip that carries on from a clip's last
  frame, a line a person says. Click a line to cut it. Where a note, a person or a place is brought in is drawn, dotted, for
  the chosen card.

## 0.29
- **The script, changed in the app.** *Script* in the canvas window opens the series and the shots of every episode beside the
  canvas: the look, the models, the cast with their looks, clothes and voices, the places, the episodes planned — and for each
  episode its scenes and shots, with the first frame of each shot beside it. Shots are added, moved and removed; an episode
  that is planned and not written is written by the writer from there, or by hand. What is typed is saved a moment later,
  only when the series and every script are sound with it, and the canvas follows: exactly what works from the change is to
  be made again, and putting back what was there brings back what was made from it.
- **A cut you changed still follows the script.** Your order, trims and added clips stay; a shot the script loses leaves the
  cut, and a new shot goes in after the one it follows. Nothing that stays is left working from a node that goes.
- **A face is who someone is, not what they wear.** The director draws a portrait from the person's looks alone, so giving
  someone other clothes draws their sheet again from the same face instead of drawing a new person. A film made before this
  keeps its words; when only the clothes change there, the app holds the face that stands.
- `seconds`, `budget`, `retakes` and the episodes planned are checked in `series.json`, and the models it names must exist.

## 0.28
- **Songbe looks at what it makes.** Every take is measured the moment it is made — decoded small, no model asked, no cost.
  A take that cannot be used (the model was to say the line and nobody is heard; the picture never moves; the recording holds
  no voice, far more than the line, or a part of it) is asked for again by the run itself — once, or `--retakes=N` /
  `"retakes"` in `series.json` — and the better take stands; a node none of whose takes can be used counts as not made, so
  nothing is built on it, and a person may still choose one of them. What is only odd is used and pointed at on the card, in
  the panel, on the board and in `songbe flow`: a strong colour a clip did not start with, a jump as if cut to another shot, a
  stretch of black, a clip that does not begin on its picture, a long pause in a line, a picture in another shape or with
  bars. `songbe flow review` looks at the takes of a film made before this. (Measured on a real film: of sixty takes it
  pointed at one, a clip in which the model painted a yellow patch onto a face — and at nothing else.)
- **A clip is no longer told the palette.** The director ends a clip's prompt with a new note, `keep` — the medium, and that
  light, colours, faces and clothes stay as the first frame shows them — instead of the look with its named colours, which is
  what that yellow patch came from. Clips already on a canvas keep their words; `songbe film expand --rewrite` asks for the new.
- A clip model that keeps the recording it acts to, and comes back without it, no longer leaves the line out of the film: the
  cut lays the recording in.

## 0.27
- **Continue with ChatGPT.** A person can sign in with their ChatGPT account and have Songbe write on their Plus or Pro plan
  instead of an API key — OpenAI's published flow for apps on the person's own computer: a loopback sign-in with PKCE, tokens
  in a file only they can read, renewed by themselves, the grant taken back on sign-out. It covers writing only. (OpenAI offers
  this to open-source projects and to apps people run for themselves; a paid app must be accepted first.)
- **OpenAI and Grok as writers**, each with your own API key (`OPENAI_API_KEY`, `XAI_API_KEY`), beside Claude, Gemini and fal.ai.
- **Who writes can be chosen**: *Use for writing* in the settings, `songbe account writer <name>`, or `SONGBE_WRITER`.
  `songbe account` says who would write and why.

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
