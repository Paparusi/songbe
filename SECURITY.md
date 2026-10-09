# Security

## What Songbe trusts and what it does not

- **A project is data, not code.** `video.json` and everything in a pack are read, never executed. Text from a spec is escaped
  before it reaches the page that draws the frames, and the test suite feeds every text field hostile markup to keep it that way.
- **The app's server answers this computer only.** It listens on 127.0.0.1, requires the `Host` to be that address (so a name that
  merely resolves there is refused), refuses a foreign `Origin`, and requires a header that forms and image tags cannot set on
  every request that changes something. It serves files only from the project, the kit and installed packs, never an `.env`.
- **Keys stay local.** Saved keys live in the data folder in a file only the user can read; they are sent to the provider they
  belong to and are never returned to the page. Keys are never written into `video.json`.
- **Nothing is downloaded unasked.** On Windows ffmpeg can be fetched at the person's request; it is one exact file, checked
  against a SHA-256 pinned in `src/setup.mjs`.
- **The browser that draws frames** is started with a throwaway profile. On Linux it runs without the browser's own sandbox,
  because containers and WSL cannot provide one; it only ever loads the page Songbe wrote and the project's media.

What this means in practice: building a video from a `video.json` someone sent you is meant to be safe. Installing a pack from a
stranger is like opening a document from a stranger — it cannot run code, but a style sheet can ask for an address on the network.

## Reporting a vulnerability

Tell the people you have Songbe from, privately, with what you did and what happened. Please do not publish it before it is fixed.
