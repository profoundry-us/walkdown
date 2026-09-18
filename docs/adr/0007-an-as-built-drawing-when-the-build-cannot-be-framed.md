# ADR 0007 — An as-built drawing, when the build cannot be framed

- **Status:** accepted 2026-09-18 by Topher; built the same day for walkdown's
    own blueprint.
- **Date:** 2026-09-18
- **Deciders:** Topher (product, eng)
- **Builds on:** the stand-in app (`screens.surfaces.stand-in-app`,
    [06-prototype-contract.md](../06-prototype-contract.md)), proposals as
    shop drawings ([02-blueprint-schema.md](../02-blueprint-schema.md)),
    "never edit `prototype/`" (`AGENTS.md`), ADR 0001 §9 (the address carries
    the pick, the browser stores nothing).
- **Threads:** none filed; decided in conversation.

## Context

walkdown's App surface is a page: the storyboard names an `app.path` under a
target's `base_url`, the panel frames it, and the fade slides the design over
it. Some builds are not pages. walkdown's own panel is the plainest case —
the running build *is* the panel you are holding, and it cannot frame itself
without recursing into the same server and the same ledger. A native iPhone
or Android app is the next case, and walkdown has no way to frame one yet.

For its own screens walkdown has used a **stand-in** since 2026-08: `walkdown
serve` takes the screen's design, swaps the theme, injects a ring and a corner
label, and serves it back at `/stand-in/<id>` as the app. That made the
comparison machinery usable — fade, ghost, pins on the app side — and it was
never evidence. It also meant both sides of the slider were the same drawing.
Moving the fade showed the design in two colours.

By 2026-09-18 the built panel had left its design well behind: one
conversation per rule (ADR 0006), the tabs and the screen picker, the desk,
the coloured asks. `prototype/screens/thread-panel.html` still drew the old
composer. Two things wanted to be true at once: the design should stay as it
was drawn, so what we started with is still visible; and the App side should
show what was actually built, so the slider means something. The stand-in
could give neither, because it had no file of its own to change.

Topher's framing: *keep the prototype as-is so we can see what we started with
and how it differs from what was built; but I need the "stand-in" to be an
updated prototype matching the app that we've actually built.* And on scope:
*I don't want walkdown to enforce this too much … other users may want
something similar, especially if they have an iPhone or Android app that
they can't easily show inside of walkdown.*

## Decision

**A project whose build cannot be framed may keep an as-built drawing of it,
and walkdown serves that drawing as the app.**

### 1. `as-built/` is a folder walkdown serves, and nothing more

`walkdown serve` serves `<code root>/as-built/` at `/as-built/`, the way it
serves `proposals/`: a static folder, nothing configured, nothing rewritten.
A storyboard screen names a page in it as its `app.path`:

```yaml
  - id: review
    prototype: /screens/review.html
    app: { path: /as-built/review.html }
```

The folder is flat on purpose. A screen is matched to a location by path
suffix (`lib/screen-match.js`), and the prototype wins a tie — so an as-built
at `/as-built/screens/review.html` was reported as the prototype
`/screens/review.html` it ends with, and the picker took the frame to the
design. `/as-built/review.html` ends with nothing the prototype declares.

That is the whole of walkdown's involvement. It does not require the folder,
lint does not look inside it, no rule says how it is made or how often. An
as-built page is an HTML page carrying the screen's anchors — the prototype
contract, no more — and what it says about itself is its own business
(`screens.surfaces.as-built-drawing`).

### 2. The name is the construction trade's

walkdown already calls a builder's sketch a *proposal* — "the shop drawing
the contractor submits, never a change to the architect's plans." The drawing
revised after construction to show what was actually put up is an **as-built**
drawing, and the marks on it are **redlines**. The three surfaces then read
as one vocabulary:

| | owner | what it is | evidence? |
|---|---|---|---|
| `prototype/` | design | the design, as drawn | no |
| `proposals/` | engineering | a sketch, before design draws it | no |
| `as-built/` | engineering | a drawing of what shipped | no |

`prototype/` stays design's and is never edited; `as-built/` is engineering's
and may be edited freely. The deadlock in "an agent may not touch the
drawing" (`docs/07-roadmap.md`, problem 6) does not apply to it, because it
is not the design.

### 3. It is a drawing, and it says so

An as-built page is still a drawing. When the panel frames one and a person
passes a rule against it, the verdict is about a drawing of the build — the
same thing a verdict against the stand-in meant, and a line every as-built
page should carry so nobody later reads a pass on this blueprint as build
evidence. The stand-in's rule already said this of itself; the as-built keeps
the sentence and drops the injection: ring, label and theme are written into
the file, because the file is the thing somebody keeps.

### 4. For walkdown's own blueprint

walkdown's nine screens moved from `/stand-in/<id>` to
`/as-built/<id>.html` on 2026-09-18. Each page is the panel's own
markup, captured from the running build and then kept by hand, in a fourth
theme — `redline`, the blueprint's drafting look with the ink turned red —
with a ring, a corner label and a *Redlines* note saying where the build left
the design. The two retired screens (`docked`, `unclaimed-page`) are as-built
as a box saying nothing was built there and why, which is the truthful
drawing of a withdrawal.

The stand-in feature stays in walkdown for projects that want it: a screen
with no build at all still has nothing truer than its design to show.

## Consequences

- The slider on walkdown's own screens now shows the distance between what
  was designed and what was built, which is what it is for. Nobody has to
  read the old composer in the prototype as an embarrassment.
- An as-built page goes stale the way any drawing does, and walkdown does not
  say so. That is deliberate: how closely a project keeps its as-built to its
  build, and whether it bothers on every change, is the project's call. For
  walkdown itself the habit is a recapture when a screen changes shape, not
  on every commit.
- A verdict against an as-built page is a verdict about the drawing. Rules
  verified by checks are unaffected; only the meaning of a human pass on a
  screen that cannot be framed is at stake, and it means what it meant before.
- The `checks/` and `tools/` that drove `/stand-in/` for this blueprint now
  drive `/as-built/`; the checkspace and scratch copies link the
  folder beside `prototype/`.
- One more theme in `walkdown.css` (`redline`), scanned from
  `as-built/*.html` so a hand edit to a page never lands on a class
  that does nothing.

## What this does not decide

- **Framing a native app.** An as-built drawing is what walkdown offers a
  mobile app today; a real device or simulator surface is a separate
  decision, and if one arrives, the as-built stays useful as the drawing of
  record.
- **Capturing as-builts for other projects.** The capture-and-clean pass that
  makes walkdown's pages is `tools/as-built.mjs`, a tool of this repository
  and not a feature of walkdown. Whether it becomes `walkdown as-built
  capture` waits on somebody wanting it.
- **Whether an as-built should be judged at all.** A project may decide its
  human verdicts on such screens are only about the drawing and route the
  rest through checks; nothing here forces either.

## Alternatives considered

- **Edit the prototype forward.** Rejected: the design is what we started
  with, and the ownership rule is absolute for good reasons (roadmap, problem
  6).
- **Frame the real panel as the app.** Rejected for now: the inner panel talks
  to the same server and writes to the same ledger, which is the governance
  problem this blueprint already documents for scratch copies.
- **A configured `as_built.root` like `prototype.root`.** Rejected as more
  support than the decision wants; `proposals/` is a fixed folder at the code
  root and this is the same kind of thing.
- **A rule that the as-built moves with every panel change.** Rejected by
  Topher: walkdown should not enforce how or how often a project keeps its
  drawing.
