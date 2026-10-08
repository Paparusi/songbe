# Packs

A pack adds looks and starters to Songbe without touching Songbe. It is a folder:

```
my-pack/
  pack.json                     { "name": "…", "version": "1.0.0", "about": "…", "licence": "…" }
  styles/
    night.css                   a look: token overrides and rules, all scoped to [data-style="night"]
    night.json                  what a style sheet cannot say (see below); optional
    fonts/…                     whatever the style sheet refers to, by relative address
  starters/
    opening/                    a project to start from
      video.json
      media/…
      starter.json              { "name": "Grand opening", "about": "one line for the picker", "order": 20 }
      poster.jpg                made with: songbe poster <that folder> --out=<that folder>/poster.jpg --width=540
  fit.json                      how much text fits where in its looks; made with: node tools/fit.mjs --pack=my-pack
```

The folder's name is the pack's id: lower-case letters, digits and dashes. A look's name follows the same rule and is what people
write in `"style"`; it cannot be `soft` or `bold`, which belong to the kit.

## Where packs are found

1. `packs/` inside Songbe — bundled (the `classic` look lives there, as a working example of everything on this page).
2. `<data folder>/packs/` — installed on this computer. `songbe pack add <folder>` copies a pack there, `songbe pack remove <id>`
   removes that copy, `songbe pack list` shows what is found. In the app: Settings → Packs → Open.
3. Every folder named in `SONGBE_PACKS` (separated like `PATH`) — for building a pack without installing it over and over.

When two packs have the same folder name, the first place wins; when two looks have the same name, the first pack wins.

## A look

A look is a style sheet. Scenes set geometry and leave colours, corners, shadows and type to classes and to the tokens declared in
`kit/base.css`; a look overrides tokens and adds rules, every selector starting with `[data-style="<name>"]`. Read
`kit/styles/bold.css` and `packs/classic/styles/classic.css` side by side: between them they show nearly everything a look can do.

`<name>.json` holds the few things that are not CSS:

```json
{ "about": "one line: what this look suits",
  "title": { "scale": 1, "lead": 1.2, "boxLead": 1.38 },
  "reveal": "rise",
  "wipe": "veil" }
```

- `title.scale` multiplies headline sizes; `title.lead` is the distance between headline lines as a multiple of the type size
  (0 keeps each scene's own); `boxLead` replaces it where lines sit on their own plates.
- `reveal`: how a line arrives — `rise` (from behind a mask) or `wipe` (uncovered from the left).
- `wipe`: what covers a cut — `slab` (a slanted sweep of colour), `curtain` (a flat band dropping through), `veil` (the frame dips
  through one flat colour).

Anything missing or out of range falls back to the default look's value.

Bundle the fonts a look uses and refer to them relatively: a font fetched from the network at render time makes the picture depend
on the network. Check the licence of every font; the bundled ones are under the SIL Open Font License.

Then measure it and check it:

```bash
SONGBE_PACKS=/path/to/packs node tools/fit.mjs --pack=my-pack     # writes my-pack/fit.json
node bin/songbe.mjs lint examples/recruitment-vi --style=night    # and --format=square, --format=wide
```

## A starter

Any Songbe project. `starter.json` gives it a name, a line of description and its place in the list; `poster.jpg` is what the picker
shows. A starter may use a look from the same pack or from the kit. Keep facts in a starter obviously made up (`0900 000 000`,
`example.com`): people publish what they forget to change.

## What a pack cannot do

A pack is style sheets, numbers, media and JSON. Nothing in it is executed: there are no scene types or scripts in packs. Treat a
pack from a stranger like a document from a stranger all the same — a style sheet can still ask for an address on the network.

## Licence

Songbe is Apache-2.0 and stays so whatever is plugged into it. A pack is a separate work with its own licence, stated in `pack.json`;
it may be free or sold. Nothing in Songbe checks or enforces that.
