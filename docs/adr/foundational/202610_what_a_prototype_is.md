# ADR 0015 — What a prototype is

- **Status:** proposed 2026-10-09
- **Date:** 2026-10-09
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0007 (screens that cannot be framed), ADR 0009 (who draws
  the design), ADR 0005 (who closes a thread), "Design comes first" (0.4.1)
- **Settles:** ADR 0009's open question of where drafts live and what they are
  called
- **Threads:** none filed; decided in conversation.

## Context

A screen's design has three names today, and each one lives in its own folder:

| Name | Folder | Made by | Authority |
|---|---|---|---|
| proposal | `proposals/` | engineering, often | none: a sketch beside a request |
| draft | `prototype/drafts/`, `prototype-cli/drafts/` | the design agent | none until a person accepts it |
| prototype | `prototype/screens/`, `prototype-cli/screens/` | a designer, or an accepted draft | the design of record |

They are one artifact at three points in its life. The folders sort by who made
it, but that is already on the record: the design request thread says who drew
it, and the acceptance on it says who took it. A reader has to learn three words
for one idea. Acceptance is a file copy from one folder to another, and on
2026-10-09 a copy went stale: five CLI designs were copied from captures that no
longer matched the build, and only a byte comparison caught it.

Topher's framing: *all "design" artifacts should be a prototype in the sense
that they are clickable and you can play with them.*

Two other ideas near design need to be stated plainly, because they were
described loosely in the same conversation:

- **As-built** exists only where the panel cannot frame the build: walkdown's
  own panel, every CLI screen, and someday a native app (ADR 0007). A web app
  that can be framed has no as-built; its App side is the live page.
- **Redlines**, where the build left the design on purpose, exist only as prose
  in `as-built/redlines.json`, drawn as one note per as-built page. They are not
  tied to an element, cannot be put on a live page, and are not threads.

## Decision

### 1. There is one design artifact: the prototype

Every design is a prototype. A prototype is clickable: a page a person can open
in the panel and use, not a picture of one. A candidate design, a designer's
drawing and the design of record are all prototypes. Each is in one of three
states:

| State | Meaning | How it gets there |
|---|---|---|
| **proposed** | A candidate design for a screen, not yet accepted | Anyone files it against the screen's design request: a designer, the design agent (ADR 0009), or engineering |
| **accepted** | The design of record; rules are judged against it | Only a person's acceptance of the request moves it here |
| **superseded** | An earlier accepted version, kept for history | A newer version of the same screen is accepted |

"Design" stays the name of the role, as in `design.by`, design request and the
design queue. "Proposal" and "draft" are retired as names for artifacts.

### 2. A prototype's state is in the record, never in its filename

Every version of a screen's prototype is one file in the blueprint's prototypes
folder, named for the screen and the day it was made:

```
prototypes/<screen>-YYYYMMDD.html
prototypes/<screen>-YYYYMMDD-v2.html    # a second version made the same day
```

- The first version made on a day has no suffix. A second one that day is
  `-v2`, then `-v3`.
- The storyboard's `prototype:` names the accepted version. That pointer is the
  only thing that makes a version accepted.
- The design request names the version it proposes. A request with a proposed
  version is the only thing that makes a version proposed.
- A version that is neither is superseded, or abandoned, and stays on disk as
  history.
- Accepting moves the storyboard pointer. No file is renamed, copied or edited,
  so an accepted design cannot drift from the version a person looked at.

The folder is `spec.yml`'s `prototype.root`, with `prototypes/` as the default.
The `screens/` and `drafts/` subfolders and `proposals/` are retired.

### 3. As-built is only for a build that cannot be framed

As ADR 0007 says, and now stated in the guide as well: a project keeps an
as-built drawing only for a screen whose build the panel cannot frame. It is a
stand-in for the build, never a design and never a step every project takes.
Nothing in this ADR changes how as-built is captured or served.

### 4. A redline is a pinned note, on any surface

A redline says that the build leaves the design at this element, on purpose,
and why. It becomes a thread reason beside `decision`:

- **Anchored like a pin:** to a screen and an element, on either side of the
  fade, on a live page or an as-built page alike. The fade draws it where the
  gap is.
- **Who closes it:** a redline a person files is filed closed, as a decision
  is: it explains a gap and nothing waits on it. A redline the agent files waits
  for a person's acceptance, as a finding's fix does. Otherwise an agent could
  excuse any gap it left by writing it down.
- **Judges read them:** a judge comparing the two surfaces treats an accepted
  redline as an intended gap, not a fail, and names it in its reasoning.
- **Migration:** each note in `as-built/redlines.json` becomes a redline thread
  on its screen, filed closed, since Topher has read them all. The JSON file
  retires.

### 5. The guide says how things are done now, and is brought up to date before each release

One document, `GUIDE.md` at the repository root, says how to build with a
blueprint as walkdown is today. It covers the flow from a design request to a
signed rule:

1. design requests and prototypes, and their states;
2. rules and steps;
3. building, checks and the agent tier;
4. the walkdown and signatures;
5. as-built where it is needed, and redlines.

ADRs say why something was decided; the guide says what to do. It is what
agents are pointed to, instead of the changelog.

The guide is updated before a release, not when an ADR is accepted. That way
what was actually built can be checked first, and any fixes made. If the build
taught us something, the ADR is updated, and only then is the guide written from
what shipped. The release procedure in [09-delivery.md](../../09-delivery.md)
gains that step.

## The typical flow

1. A screen is needed, so a design request is filed on it.
2. A proposed prototype is made for it, by the person's designer if they gave
   one and by the design agent if not.
3. A person opens it in the panel, uses it, and accepts the request or sends it
   back. Accepted, the storyboard points at it.
4. The screen is built to it. Where the build cannot be framed, its as-built is
   captured.
5. The fade compares the prototype with the build, and redlines mark the gaps
   left on purpose.
6. A later change proposes a new version. When it is accepted, the old one is
   superseded.

## Rejected

- **State in the filename** (`<screen>.proposed.html`). The record already holds
  the state, and a rename on acceptance is the copy this ADR removes.
- **Keeping the three folders and renaming them.** The folders were the problem,
  not their names.
- **Redlines staying in a file beside the as-built.** That cannot reach a live
  page, cannot point at an element, and gives a judge nothing to read.

## Open questions

- **What makes a CLI prototype clickable.** A CLI screen is one moment at a
  terminal. "Clickable" there could mean linked moments: a command, its output,
  and the next command a person would type, each a link to the next screen.
  That is a real change to how CLI screens are drawn, and wants its own
  decision. Until then a CLI prototype is a single terminal page, as today.
- **Where the panel shows a proposed version.** The panel needs a way to put a
  pending version on the design side of the fade without moving the storyboard
  pointer, probably from the open request. That is ADR 0009's draft surface, and
  its shape is decided when it is built.
- **How dates are chosen during migration.** Each existing prototype needs a
  date for its filename: the day it was first committed, or the day of the
  upgrade.

## Consequences

- **A format change, for 0.5.0.** `walkdown upgrade` moves every blueprint's
  `screens/`, `drafts/` and `proposals/` into one dated prototypes folder,
  repoints the storyboard, and turns `as-built/redlines.json` into redline
  threads. Lint's design rules, the prototype contract in
  [06-prototype-contract.md](../../06-prototype-contract.md) and the schema in
  [02-blueprint-schema.md](../../02-blueprint-schema.md) change with it.
- **The `designer` agent** writes a dated version and names it on the request,
  instead of writing into `drafts/`.
- **"Design comes first" is unchanged.** It now reads as: no rule on a screen is
  built until the screen has an accepted prototype.
- **`GUIDE.md` is written** as part of the 0.5.0 release, from what shipped.
