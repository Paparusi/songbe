# Contributing to Songbe

Thank you for wanting to make it better. A few things before you start.

## What gets in

- **A fault you can show.** Say what you did, what came out, and what should have. For a film: the node, the model, what the
  take looks or sounds like. A picture or a few seconds of the clip says more than a paragraph.
- **A change that was measured.** Songbe's wording for the models and its checks come from takes that went wrong and were
  counted before and after. "It looks better to me" on one take is a start, not a result; `CHANGELOG.md` shows the kind of
  evidence a change is expected to carry.
- **Small, whole changes.** One thing at a time, with its test (`npm test` must pass: Node 22 or later, ffmpeg on the path) and
  its line in `CHANGELOG.md`. `DEVELOPING.md` describes how the code is put together and how it is written.

No keys, no accounts and no private material in anything you send: a project's `.env`, a take made from someone's face, a
client's footage.

## The terms

Songbe is published under the GNU Affero General Public License, version 3 (`LICENSE`). By sending a change you say that you
wrote it, or have the right to send it, and that it may be distributed under that licence as part of Songbe.

You also let the project's owner (named in `NOTICE`) license your change under other terms alongside the AGPL — for someone
who needs Songbe without the AGPL's conditions. Your change stays available to everyone under the AGPL whatever else happens.
If you cannot agree to that, say so in the pull request before it is merged.

## Being decent

Write to people the way you would talk to them across a table. Criticise the take, not the person who made it.
