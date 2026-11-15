# ADR 0018 — Journey boards

- **Status:** proposed 2026-11-10, a draft. Nothing here is accepted, and nothing is
    built. It is written to be checked against a real system first (see "Questions
    for a real system"); the answers are expected to change it.
- **Date:** 2026-11-10
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0006 (rule conversation threads), ADR 0009 (design ownership and
    requests), ADR 0011 (multiple blueprints per project), ADR 0014 (file layout and
    locations), ADR 0015 (design versions and states), ADR 0016 (rule focus), ADR 0017
    (screen setup), [02-blueprint-schema.md](../../02-blueprint-schema.md)
- **Sketch:** `sketches/workflow-board/index.html`. A sketch with made-up data, never
    a design (ADR 0009). Open it in a browser to see what this ADR describes.

## Context

A blueprint says what is true of each piece: a feature holds stories, a story holds
rules, a rule names its screens. It does not say how the pieces follow one another.
Nothing in it answers "what happens between a client asking for a contractor and that
contractor's first day, and who does each part?".

In a system with several kinds of user that question is most of the difficulty.
Onboarding one contractor may pass through a client's hiring manager, the contractor,
an internal specialist, the platform's own jobs, and three outside services. Each of
those has stories in the blueprint already. What is missing is the order, the
hand-offs, and a way to see what each person is looking at when their turn comes.

The established drawing for this is the **service blueprint**: time runs left to
right, each actor has a lane, and three lines separate what the customer does, what
staff do in front of them, what happens out of sight, and what outside parties do.
Teams draw these on whiteboards, where they go stale, because nothing ties a box to
the thing that was built. The dedicated tools (story maps in backlog tools, journey
managers) link a box to a ticket, never to whether the behaviour holds.

walkdown already has what a whiteboard lacks: every story has rules with verdicts,
and every screen has a design and a way to reach its state in the app (ADR 0017). A
board drawn from those is a service blueprint that knows what passes.

One constraint on words. The glossary keeps `workflow` out of walkdown's vocabulary,
because it collides with a test type at the day job. This ADR does not use it. The
sketch's folder name predates that and is the only place it appears.

## Decision

### 1. A board is one end-to-end process, drawn in lanes

A **board** shows one process from its first step to its last: every actor's part in
it, in order. A blueprint may hold many boards. A board is a third kind of
edit-in-place document, beside the features and the storyboard.

A board is made of four things:

| Term | Meaning |
|---|---|
| **Lane** | One actor in the process: a kind of person, the platform itself, or an outside service. |
| **Card** | One step of the process, in one lane. Almost always one story. |
| **Hand-off** | An arrow from one card to the card that follows it, in any lane. |
| **Journey** | One lane read left to right: everything that one actor does. |

"Journey" names a reading of the board and is stored nowhere. Following one person
through the process is choosing their lane.

### 2. A card is a story; an outside step is a card with no story

A card names a story by id. Its title, its rules and its status all come from that
story, and are never written again on the board.

Some steps are nobody's to verify: an outside provider runs a background check for
three days. Those are cards with a `title:` and no `story:`. They carry no rules and
no status, and exist so the hand-offs around them read truthfully. The story on our
side of that step (receiving the provider's result) is an ordinary headless story.

A story sits in one lane on a board. A story whose steps are taken by two different
actors is two stories, for the reason ADR 0017 gave for dropping "viewers": a
different kind of user means a different rule, with its own screen.

The same story may appear on more than one board, and more than once on one board
(signing a document, say). That is why a card has an id of its own.

### 3. A story gains beats: its steps, in order, each on one screen

A rule's steps say how to check one claim. They are not the story told in order, and
a story with five rules has no single sequence to read off them. So a story gains
**beats**: the ordered moments a person passes through, each naming the screen they
are on.

```yaml
# <home>/features/paperwork.yml
stories:
  - id: paperwork.sign-contract
    title: Sign the contract
    statement: As a contractor, I can read and sign my agreement online.
    beats:
      - id: read
        say: Reads the agreement, in their own language.
        screen: contract-review
      - id: sign
        say: Signs at the bottom.
        screen: contract-review
        focus: contract.signature
      - id: confirmed
        say: Gets confirmation and a copy to download.
        screen: contract-signed
    rules:
      - id: paperwork.sign-contract.own-language
        statement: The contract is shown in the contractor's language.
        screens: [contract-review]
```

- **`id`** is a slug, unique within the story and never reused, so that a capture
  (§6) survives the beats being reordered.
- **`say`** is one sentence, present tense, with the lane's actor as its unspoken
  subject. It follows ADR 0004's wording guidelines.
- **`screen`** is a storyboard id. A screen is a path and its setup (ADR 0017 §4), so
  it already says who is signed in and which record is open. A beat adds nothing to
  that; a state the storyboard cannot reach is a new screen, never a beat option.
- **`focus`** is an anchor on that screen (ADR 0016): what the person acts on. The
  board rings it.

A beat with no `screen` is a **headless beat**: something the system does that nobody
sees. It carries `say` and may carry `does:`, a few literal lines (an event, a
request, a job) shown in monospace. A headless story's beats are all headless.

Beats are not hashed into any rule. Rewording a `say`, or reordering beats, never
makes a verdict stale. They sit in the feature file, so they do change the spec hash
a run is stamped with; that is true of any edit to a feature file today.

### 4. The board file holds lanes, cards and hand-offs, and no coordinates

```yaml
# <home>/boards/contractor-onboarding.yml
board: contractor-onboarding
title: Contractor onboarding
lanes:
  - { id: client,  title: Hiring manager,        of: Client company,  side: customer }
  - { id: worker,  title: Contractor,            of: Joining from abroad, side: customer }
  - { id: ops,     title: Onboarding specialist, of: Our staff,       side: staff }
  - { id: sys,     title: Platform,              of: Jobs, rules, webhooks, side: system }
  - { id: outside, title: Outside services,      of: Checks, e-sign, benefits, side: outside }
phases: [Request, Account, Contract, Screening, Benefits, Placement, Day one]
cards:
  - { id: request,  story: requests.request-contractor, lane: client, phase: Request }
  - { id: review,   story: requests.review-request,     lane: ops,    phase: Request, after: [request] }
  - { id: sign,     story: paperwork.sign-contract,     lane: worker, phase: Contract, after: [pack] }
  - { id: run-check, title: Run the background check,   lane: outside, phase: Screening,
      after: [consent], takes: 2 to 5 days }
  - { id: result,   story: screening.receive-result,    lane: sys, phase: Screening, after: [run-check] }
  - id: adjudicate
    story: screening.adjudicate
    lane: ops
    phase: Screening
    after:
      - { card: result, when: The result is anything but clear }
  - id: plan
    story: benefits.choose-plan
    lane: worker
    phase: Benefits
    after:
      - adjudicate
      - { card: result, when: The result is clear }
```

- **`side`** is one of `customer`, `staff`, `system`, `outside`. The three lines of a
  service blueprint are drawn from it and are never declared: the line of interaction
  between `customer` and `staff`, the line of visibility between `staff` and `system`,
  the line of internal interaction between `system` and `outside`. Lanes are drawn in
  the order listed; lint refuses an order that mixes sides.
- **`after`** lists the cards this one follows. An entry may be an object with
  `when:`, a short condition written on the arrow. A card with no `after` starts the
  process.
- **`phase`** is a named stretch of the process, drawn as a heading over its columns.
  Phases are drawn in the order `phases:` lists them.
- **`takes`** is free text for how long a step usually lasts. It is shown, never
  computed with.
- **There are no coordinates.** A card's column is the longest chain of hand-offs
  that leads to it, within its phase; its row is its lane. A board is a list of facts
  about order, so a diff of one reads as a change to the process, and an agent can
  write one without placing anything. If derived layout proves too crude for a real
  board, a card may later take an optional `col:`; it is not in this draft.

Hand-offs form a graph with no cycles. A step that sends work back (a request
returned for edits) is written on the returning card as `returns_to: <card>`, drawn
as a dashed arrow, and ignored by layout.

The board file is not part of the spec hash. It arranges stories; it claims nothing
about the build. Editing a board never changes what a run says it was judged against.

### 5. A card's status is its story's, on one target

A card shows one of the marks the rules list already uses, rolled up from the story's
live rules on the target being viewed:

| Mark | When |
|---|---|
| failing | any rule's latest verdict is a fail |
| waiting on you | none fail, and any rule waits on a person |
| not built | none of the above, and no rule has a recorded run |
| passing | every rule is verified |

A card with no story has no mark. The board's top bar counts each mark, and the
target is chosen with the control ADR 0017 §5 added. The roll-up reuses the
computation behind `walkdown status`; it adds no new state.

### 6. A capture is a picture of one beat, kept as a record

A **capture** is a screenshot of one beat's screen, on one surface. It is what a card
shows and what the drawer steps through. A card's picture is the capture of its
story's first beat that has a screen.

A capture is a picture, never evidence. It satisfies no tier, changes no status, and
no verdict cites it. Its job is to let a person see what an actor sees.

```
<records>/captures/<story id>/<beat id>.<surface>.png
<records>/captures/<story id>/<beat id>.<surface>.json
```

`<surface>` is `design` or the name of a target (`local`, `staging`). The JSON beside
each picture says what it is a picture of:

```json
{
  "story": "paperwork.sign-contract",
  "beat": "sign",
  "surface": "staging",
  "screen": "contract-review",
  "focus": "contract.signature",
  "focus_box": [212, 608, 440, 104],
  "viewport": [1280, 800],
  "beat_hash": "sha256:41c0…",
  "design": "/contract-review/20261104.html",
  "commit": "9f3e2ab",
  "at": "2026-11-10T16:20:00Z",
  "by": "agent"
}
```

- **One capture per beat and surface; a new one replaces the old.** Captures are not
  a ledger. What a screen looked like last month is a question for git, where the
  blueprint commits its records, or for nobody.
- **Captures are records, so they live where the blueprint's records live** (ADR
  0014) and follow its commit choice. They are git-ignored unless the blueprint
  commits everything.
- **`focus_box`** is where the focus anchor was in the picture, so the board can ring
  it without the page.
- **A capture is stale** when its `beat_hash` (over the beat's `screen` and `focus`)
  no longer matches, or, for a design capture, when the screen's accepted design
  version has moved on. A stale capture is still shown, marked stale. Nothing tries
  to guess staleness from commits: every commit would stale every picture.
- **What a card shows when a capture is missing.** A target capture where there is
  one; else the design capture, in a dashed frame labelled "designed, not built";
  else an empty frame naming the screen. A headless card shows no picture.

**Who takes them.** walkdown records captures and owns no browser, as with judging.
An agent walks a story's beats with its own browser, running each screen's setup
(ADR 0017), and hands each picture over:

```bash
walkdown captures set paperwork.sign-contract sign --blueprint onboarding \
  --target staging --file /tmp/sign.png --focus-box 212,608,440,104
walkdown captures owed --blueprint onboarding --target staging   # missing or stale
```

A skill (`walkdown:capture`) assembles the prompt for a story or a whole board, as
`walkdown:judge` does for rules. Command names are provisional until ADR 0012's
structure is applied to them.

**What must never be in one.** A capture is a picture of whatever the app showed. On
a system holding personal data that is a real person's name, tax number or check
result unless the app was showing seeded records. Captures are taken only on targets
whose data is seeded, never on production. A target says so with `captures: true` in
`spec.yml`; `captures set` refuses any other target. walkdown cannot inspect a
picture, so this is a rule for the people and agents taking them, stated in the
blueprint's `governance:` lines.

### 7. The board is its own page; the drawer walks one story

Boards are a second mode of walkdown, beside the rules panel, chosen from the top
bar. A board is a full page served by `walkdown serve`. It frames no app and needs no
extension: everything on it is a record or a picture. Someone who has never run the
app can read it.

**The board** draws lanes as rows and phases as column headings, with the three lines
between sides. A card with a screen shows its picture, its title, its mark and how
many beats it has. A headless card is smaller, with a dashed edge and no picture.
Choosing a lane's name dims every other lane, which is that actor's journey.

**The drawer** opens on the right when a card is chosen, and holds:

1. The lane, the story's title and id, and its mark.
2. The current beat: its capture with the focus ringed, or for a headless beat its
   `does:` lines; then its `say`; then Back and Next, and every beat as a strip of
   small pictures.
3. A control for which surface the pictures are from: the design, or a target.
4. The story's rules, each with its mark. Choosing a rule opens it in the rules
   panel, on its screen.
5. The cards this one follows and the cards that follow it, each a link.

The board reads and never judges. No verdict is given from it, no thread is filed
from it, and no design is accepted on it. Those stay in the walk, where a person has
the build in front of them (ADR 0006, ADR 0015).

### 8. Lint

Lint refuses a board that:

- names a story, lane, card or phase that does not exist;
- has a card with both `story:` and `title:`, or neither;
- has hand-offs that form a cycle, or lanes that mix sides;
- puts a retired story on a card.

Lint refuses a beat that names an unknown or retired screen, or a `focus` its screen
does not declare. Lint warns about a story on a board that has no beats, and about a
beat with a screen and no current capture on any target.

## Not now

- **A board across projects.** A card names a story in its own blueprint, or in
  another blueprint of the same project as `<blueprint>:<story id>` (ADR 0011). A
  process whose actors' apps live in separate repositories cannot be one board yet.
  This is the limit most likely to matter first; see the questions below.
- **Variants of one process.** A process that differs by country, by client or by
  contract type is, for now, one board per variant, or one board with `when:` on the
  arrows where the difference is small.
- **The feelings, pain points and opportunities rows** of a customer journey map.
  Those are research findings. walkdown records what was built.
- **Metrics on a card** (how long a step really takes, where people drop out).
- **Editing a board in the page.** The file is written by a person or an agent, as
  feature files are.
- **A static export** of a board for someone with no walkdown. Likely wanted soon;
  left out until the page itself has been used.
- **Captures taken by the panel** as a person walks. The extension could do it; an
  agent taking them is enough to start.
- **Capture history.** One picture per beat and surface.

## Questions for a real system

This draft was written against a made-up process. Before it is accepted, an agent
that knows a real, complicated system should try to write one of its processes as a
board, on paper, and answer these. A "no" or "it depends" on any of them is a gap.

**Stories and lanes**

1. Pick one real end-to-end process. How many cards is it? Does it fit one board, or
   does it need boards that link to each other?
2. Is every step one actor's? List any step where two actors act on the same screen
   at once, or where one screen is used by two kinds of user.
3. Do the four sides (`customer`, `staff`, `system`, `outside`) cover every actor?
   List any that fit none, or two (a client's own administrator, a partner company's
   staff, a recruiter acting for a contractor).
4. Which steps belong to outside services, and for each: is there a story on our side
   that receives its result?

**Order**

5. Where does the process branch? Can each branch be written as `when:` on an arrow,
   or do branches differ so much they are separate boards?
6. Where does work go backwards (returned, rejected, expired, retried)? Does
   `returns_to` describe it?
7. Which steps wait on time or on a person outside the system (days for a check, a
   signature that never comes)? Is free-text `takes:` enough, or do deadlines and
   reminders need to be cards?
8. Which steps happen in parallel, and does anything wait for all of them?
9. Does the process vary by country, client or contract type? How many variants are
   there, and how much do they share?

**Screens and beats**

10. For three stories, write the beats. Does each beat land on one screen the
    storyboard could reach with ADR 0017's setup (`visit`, `post`, `wait_for`)?
11. Which steps are not on any screen of ours: an email, an SMS, a PDF, a page on an
    outside service's site? How should a beat show those?
12. Which steps happen on a phone or in a native app, where the viewport or the
    capture differs?

**Where things live**

13. Which repositories and apps does the process cross? Would the stories sit in one
    blueprint, several blueprints of one project, or several projects?
14. Which existing tests or specs already walk parts of this process end to end?
    Could they take the captures as they run?

**Captures and data**

15. Which targets have seeded data safe to photograph? What on these screens is
    personal or regulated (tax numbers, check results, health choices)?
16. Can each screen's state be reached from seeds alone, or do some states need an
    outside service to have answered first?
17. Who needs to read a board who cannot run walkdown, and what would they need: a
    link, a file, a page in another tool?

## Consequences

- **The schema is additive.** `beats:` on a story, a `boards/` folder in the home, a
  `captures/` folder in the records, and `captures: true` on a target. A blueprint
  with none of them behaves exactly as before, and no upgrade step is needed.
  [02-blueprint-schema.md](../../02-blueprint-schema.md) gains the three sections, and
  [01-glossary.md](../../01-glossary.md) gains board, lane, card, hand-off, journey,
  beat and capture.
- **Design comes first.** The board and the drawer are screens of the `walkdown`
  blueprint. Each gets its rules and a design request before anything is built, and
  the sketch is not that design (ADR 0009, ADR 0015 §8). The `cli` blueprint gains
  the capture commands as headless stories, and their screens as scenarios.
- **A board can be wrong where a rule cannot.** A rule has a verdict. An arrow has
  none: nothing checks that the platform really hands off to the specialist. A board
  is as true as the person who drew it, and says so nowhere. Whether a hand-off
  should be able to cite a rule is left open until a real board shows how often it
  matters.
- **Pictures go stale quietly.** A capture is stale only when its beat or its design
  changes. A screen restyled in code shows its old picture until somebody retakes it.
  `captures owed` covers the missing and the stale, and a sweep of every capture is
  an agent's task on a cadence, as the sitting is for the agent tier.
- **Captures are large.** A board of twenty stories, three beats each, on two
  surfaces is over a hundred pictures. A blueprint that commits its records commits
  those. Size, format and whether they belong in git at all are untested.
- **It needs a fixture with more than one kind of user.** The example blueprint's
  waitlist has one. ADR 0017 already called for a small app with sign-in; a board
  needs that app to have two roles and one hand-off between them.
