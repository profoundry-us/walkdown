# ADR 0015 — Design versions and states

- **Status:** accepted 2026-10-09 by Topher; not yet built (0.5.0). Its
    panel and CLI screens are designed first.
- **Date:** 2026-10-09
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0007 (as-built drawings), ADR 0009 (design ownership and
  requests), ADR 0005 (thread closing permissions), "Design comes first" (0.4.1)
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

Every design is a prototype. A prototype of an interface is clickable: a page a
person can open in the panel and use, not a picture of one. A CLI prototype is
the exception: it is one moment at a terminal, drawn as a single page, and
nothing in it needs clicking. A candidate design, a designer's
drawing and the design of record are all prototypes. Each is in one of three
states:

| State | Meaning | How it gets there |
|---|---|---|
| **proposed** | A candidate design for a screen, not yet accepted | Anyone files it against the screen's design request: a designer, the design agent (ADR 0009), or engineering |
| **accepted** | The design of record; rules are judged against it | Only a person's acceptance of the request moves it here |
| **superseded** | An earlier accepted version, kept for history | A newer version of the same screen is accepted |

"Design" stays the name of the role, as in `design.by`, design request and the
design queue. "Proposal" and "draft" are retired as names for artifacts.

**The artifact is called a design wherever a person or a file meets it**: the
toolbar, the folder, the storyboard key (amended 2026-10-10, q-0575 and n-0581).
"Prototype" stays the word for what a design almost always is, a page you can
click, and the docs say so, but nothing on screen or on disk is named for it.

### 2. A design's state is in the record, never in its filename

Every version of a screen's design is one file in that screen's own folder
under the blueprint's designs folder, named for the day it was made:

```
designs/<screen>/YYYYMMDD.html
designs/<screen>/YYYYMMDD-v2.html    # a second version made the same day
```

A folder per screen keeps a long list browsable and puts every version of one
screen side by side. It is per screen, not per feature: a screen belongs to no
one feature, since rules from several can name it, and the storyboard does not
group screens (n-0581).

- The first version made on a day has no suffix. A second one that day is
  `-v2`, then `-v3`. The first is never renamed when a second arrives.
- The storyboard's `design:` (formerly `prototype:`) names the accepted version. That pointer is the
  only thing that makes a version accepted.
- The design request names the version it proposes. A request not yet accepted
  or closed that names a version is the only thing that makes it proposed.
- A version that is neither is superseded, and stays on disk as history.
- **A proposed version is edited in place.** Every revision while it is under
  review, whether sent back with changes or reworked by its designer, is an
  edit to the same file. A new version is never made for an edit. It is
  named for the day it was first proposed, so it is never renamed.
- **An accepted version is frozen.** Accepting moves the storyboard pointer, and
  from then on nothing edits that file. A change to an accepted design starts
  the next version, which is proposed until it is accepted in turn. So there
  is one version per accepted design, and an accepted design cannot drift from
  the version a person looked at.

The folder is `spec.yml`'s `design.root` (formerly `prototype.root`), with
`designs/` as the default.

### 2a. The upgrade leaves nothing behind

The `screens/` and `drafts/` subfolders and `proposals/` are retired, and
`walkdown upgrade` clears every one of them rather than leaving them lying
around:

- An accepted screen in `screens/` moves into `designs/<screen>/` as a dated
  version, and the storyboard is repointed at it. The storyboard's `prototype:`
  keys become `design:`, a null one included, and `spec.yml`'s `prototype.root`
  becomes `design.root`. A root the blueprint set itself keeps its value; only
  the key is renamed.
- A draft or proposal named by a design request not yet accepted or closed,
  whether open or addressed, moves in as that request's proposed version.
- A draft or proposal nothing names, accepted or pending, is removed. It stays
  in git history, and the upgrade lists every file it removed.
- A file git does not hold is never removed: with no history, removing it would
  lose it. The upgrade keeps it where it is, and its folder with it. It names the
  file and says to commit it or delete it yourself.
- The emptied folders are removed, and so is `as-built/redlines.json` once its
  notes are threads (section 4).
- `--dry-run` says all of it before anything moves.

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
- **Only a person files one.** A redline excuses a gap, and an agent that could
  file one could excuse any work it chose not to build. So the agent never
  files a redline, and walkdown refuses one carrying `--as-agent` or any other
  sign that a machine typed it, as it refuses a machine's `verified`. An agent
  that thinks a gap was left on purpose asks the person, with a question on the
  element. The person files the redline if they agree.
- **Filed closed:** a redline explains a gap and nothing waits on it, as with a
  decision.
- **Judges read them:** a judge comparing the two surfaces treats an accepted
  redline as an intended gap, not a fail, and names it in its reasoning.
- **Migration:** each note in `as-built/redlines.json` becomes a redline thread
  on its screen, filed closed in Topher's name, since he has read them all. The
  JSON file retires.
- **Filed from Pin Mode.** After choosing the spot, the pin form asks what kind
  of pin it is: note, question or redline, in one control. Tabs across the top
  of the form or a single dropdown are both candidates. That control replaces
  today's "question, not a note" checkbox. The form is a screen, so it is
  designed first: its prototype is drawn and accepted before any of this is
  built.

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
what shipped. That step is written into `RELEASING.md` at the repository root,
the release procedure in full, which
[09-delivery.md](../../09-delivery.md) points to.

### 6. The panel frames a proposed version as waiting on you

While a request proposes a version, the panel can put that version on the
design side of the fade without moving the storyboard pointer. It is framed the
way the stand-in and the as-built are, with a ring around the page and a corner
label. The ring is the panel's **warning yellow**, the colour it already uses
for "waiting on you", **dashed**, and the label reads **Proposed — yours to
accept**. A proposed version is a person's to act on, so it wears the colour
of a person's turn. The dashes keep it apart from the solid rings, which mean
"this is the build".

How a person moves between them:

- **The design side gets a version switch** whenever a screen has a proposed
  version: two segments, **Accepted** and **Proposed**, beside the surface's
  label in the toolbar. **Proposed is shown first** while one is pending,
  because it is what is up for judgment (Topher, 2026-10-10: a proposed design
  always takes priority). It sits in its yellow frame; choosing Accepted shows
  the design it would replace. The fade, the ghost
  and pins work against the App side exactly as they do for the accepted
  version, so a proposal can be compared with the build it would replace.
- **A screen with no accepted version yet** shows only Proposed, with no
  switch.
- **The choice is in the address** (ADR 0001 §9: the address carries the pick),
  so a link to a proposal opens on it.
- **Accepting happens in one place**, on the design request in the screen's
  conversation, as it does today. The frame's label links there. Sending it back
  with changes leaves the switch where it is, and the next look shows the same
  version, edited in place.

The switch and the frame are panel screens, so they are designed first, along
with the pin form.

### 7. Existing prototypes are dated by their history

The upgrade names each existing prototype for the day its file was first
committed. A file git has no history for takes the day of the upgrade.

### 8. A screen's rules come with its design, and approving them accepts it

Topher, 2026-10-09, walking the 0.5.0 designs: *approving all rules associated
with a new design IS the acceptance of the design*.

- **Every screen has rules, and they grow with its design.** Neither has to come
  first. Where the PRD or the prototype leaves how something works open, the
  rules and the design are worked out together, each answering the other: a
  design agent and a rules agent may go back and forth until they agree. What
  is fixed is that no screen reaches a person without the rules it must show,
  and lint names any screen no rule names.
- **The walkdown is the design review.** An unbuilt rule asks a person to
  approve its wording, and the walk opens its screen with the proposed version
  on the design side. Reading the rule beside its design is the review; there
  is no separate design walk.
- **Built rules are judged against the accepted design until a new one is
  accepted.** While a new version waits, a screen's built rules keep their
  verdicts. Accepting it makes them stale, so they are judged again against
  the new design (Topher, q-0580, 2026-10-10).
- **Approving every rule on a screen accepts its design.** Once a person has
  approved every rule naming a screen, that screen's pending design request is
  accepted in their name, and the proposed version becomes the accepted one.
  This is the same move as a signed pass verifying the notes on its rule
  (ADR 0005). Sending any of the rules back leaves the design pending, and an
  agent's verdict never accepts one.

## The typical flow

1. A screen is needed, so a design request is filed on it, and its rules and
   its proposed prototype are worked out together. The prototype is made by the
   person's designer if they gave one, and by the design agent if not. Where
   the sources leave it open, the rules and the design go back and forth until
   they agree.
2. The screen reaches the person only once it has both.
3. The person's walkdown steps through the rules, each opening the screen with
   the proposal beside it. Sending a rule back sends the design back too, and
   it is revised in the same file. Once every rule on the screen is approved,
   the design is accepted: the storyboard points at it and it is frozen.
4. The screen is built to it. Where the build cannot be framed, its as-built is
   captured.
5. The fade compares the prototype with the build. Where a person decides a
   gap stays, they pin a redline on it.
6. A later change proposes a new version. When it is accepted, the old one is
   superseded.

## Rejected

- **State in the filename** (`<screen>.proposed.html`). The record already holds
  the state, and a rename on acceptance is the copy this ADR removes.
- **Keeping the three folders and renaming them.** The folders were the problem,
  not their names.
- **Redlines staying in a file beside the as-built.** That cannot reach a live
  page, cannot point at an element, and gives a judge nothing to read.

## Consequences

- **A format change, for 0.5.0.** `walkdown upgrade` moves every blueprint's
  `screens/`, `drafts/` and `proposals/` into dated versions under
  `designs/<screen>/`, renames the storyboard's `prototype:` to `design:`,
  repoints the storyboard, and turns `as-built/redlines.json` into redline
  threads. Lint's design rules, the prototype contract in
  [06-prototype-contract.md](../../06-prototype-contract.md) and the schema in
  [02-blueprint-schema.md](../../02-blueprint-schema.md) change with it.
- **The `designer` agent** writes a dated version and names it on the request,
  instead of writing into `drafts/`, and edits that same file when it is sent
  back.
- **Three panel screens are designed before anything is built:** the pin form
  with its type control, the design side's version switch, and the proposed
  frame.
- **`RELEASING.md`** holds the release procedure, including bringing the guide
  up to date.
- **"Design comes first" is unchanged.** It now reads as: no rule on a screen is
  built until the screen has an accepted prototype.
- **`GUIDE.md` is written** as part of the 0.5.0 release, from what shipped.
- **Amended 2026-10-10 (q-0575, n-0581):** the artifact is called a design on
  screen and on disk: `designs/<screen>/YYYYMMDD.html`, a folder per screen,
  and the storyboard key `design:`. "Prototype" survives in the docs as what a
  design almost always is.
- **Settled in review (2026-10-09):** CLI prototypes are not clickable; a
  proposed version is framed in dashed warning yellow; it is edited in place
  until accepted; the upgrade clears every retired folder; only a person files a
  redline; migration dates come from git history.
- **Amended 2026-10-10:** a pending proposed version is shown first, ahead of
  the accepted one (Topher: a proposed design always takes priority, because
  it is what is being judged). §6 said Accepted was the default.
