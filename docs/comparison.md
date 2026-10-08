# Songbe and ArtCraft

People ask how Songbe relates to [ArtCraft](https://github.com/storytold/artcraft), so here it is plainly. The facts about ArtCraft
are from its README and licence as of October 2026; check them there, they move fast.

**They are different tools.** ArtCraft is a studio for *making images and video with AI models*: compose in 2D, stage a scene in
3D, pose characters, pick from dozens of models, generate. Songbe is a workshop for *finishing an ad*: from a description or a
`video.json` to an MP4 with voice-over, motion graphics, captions, music and sound effects, checked before it is handed over.
A picture or clip made in ArtCraft is a fine thing to put into a Songbe scene.

| | ArtCraft | Songbe |
| --- | --- | --- |
| What you get at the end | Generated images and clips | A finished short ad: voice, graphics, captions, music, effects |
| How you work | A visual canvas: 2D layers, 3D staging, posing, camera | A description, a form with live preview, or a JSON file; scenes from a kit |
| AI models | A catalogue of about sixty (image, video, sound, 3D, worlds), through its own services and other providers, each with its own controls | Any picture, picture-to-clip or music model in fal.ai's catalogue, filled in from fal's description of it (four defaults); one voice model; a writer for the script. No 3D, no per-model controls |
| Runs without an account or key | The app, yes; generating needs a provider | Yes, and still builds: motion graphics and sound effects, no voice or music |
| Driven by a script or an AI agent | Not its purpose | Its first purpose: every step is a command, the input is one file |
| Checks its own output | — | Layout before drawing; black frames, flashes, sound, length and a transcript after |
| Licence | "Fair source", work in progress: free to use; not for resale or for building a competing product | Apache-2.0 |
| Extending it | In its monorepo, under that licence | Packs: looks and starters as folders with their own licence, no code |
| Installers | Windows and macOS; Linux from source | Windows; Linux and macOS from source (`songbe app`), installers prepared but not yet released |
| Written in | Rust and TypeScript (Tauri) | JavaScript without dependencies; a small Rust shell for the window (Tauri) |
| Maturity | An established project with a large community | Young: started in October 2026 |

Where ArtCraft is clearly ahead: control over generation (3D staging, posing, per-model tools), kinds of generation Songbe
does not do at all (3D meshes, worlds), its community, and a macOS build. Where Songbe is ahead: a licence with no conditions on use, running from one file with no interactive step, producing the
whole ad rather than its footage, and refusing to hand over work its own checks object to.
