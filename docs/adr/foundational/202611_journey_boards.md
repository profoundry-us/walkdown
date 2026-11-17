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
    a design (ADR 0009). It draws the Boards and Personas modes this ADR describes.
- **Checked against:** the four blueprints in this repository on 2026-11-16 (58
    stories, 243 rules, 529 agent runs). What that changed is said where it applies.

## Context

A blueprint says what is true of each piece: a feature holds stories, a story holds
rules, a rule names its screens. It does not say how the pieces follow one another.
Nothing in it answers "what happens between a client asking for a contractor and that
contractor's first day, and who does each part?".

In a system with several kinds of user that question is most of the difficulty.
Onboarding one contractor may pass through a client's hiring manager, the contractor,
an internal specialist, the platform's own jobs, and three outside services. Each of
those has stories in the blueprint already. What is missing is the order, the
hand-offs, and a way to see what each person is looking at when their turn comes. The
blueprint also has no name for those kinds of user. ADR 0017 gave each screen a way to
sign in as one, and nothing says that two screens are signed in as the same kind.

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

### 1. A board is stories the blueprint already has, in order

A **board** shows one process from its first step to its last: which stories happen,
in what order, and who does each. Its job is to answer two questions about that
process: is every piece built, and does every piece pass. A blueprint may hold many
boards.

A board adds order and nothing else. It holds no story, no rule, no screen, no
persona, no picture and no status of its own: each is read from where it already
lives. Deleting every board changes no rule, no verdict and no hash. A story on a
board is the same story the rules panel shows, and each links to the other. Rules
groups a blueprint's rules by screen, which answers "what must be true here?". A board
lines the same rules up by story, which answers "what happens next, and who does it?".

**walkdown brings no names of its own.** Every word a board shows about a process
comes from the blueprint's files: its personas, its systems, the groups they fall
into, its phases, its stories. walkdown supplies the drawing and the marks. It has no
built-in "customer", "staff" or "platform", because one company's process is a
patient, a clinician and a lab, and another's is a buyer, a seller and a courier.

| Term | Meaning |
|---|---|
| **Persona** | A kind of user of the system, declared once for the whole blueprint (§2). |
| **User** | One seeded account that plays a persona. A persona may have several (§2). |
| **System** | Something with a part in a process that nobody signs in as: the product's own jobs, another company's service (§2). |
| **Group** | A named set of personas and systems, declared once. A board draws a line between groups and heads each with its title (§2). |
| **Card** | One step of a process. Almost always one story. |
| **Hand-off** | An arrow from one card to the card that follows it. |
| **Lane** | One row of a board: a persona or a system. A lane is derived from its cards and is never declared (§4). |
| **Journey** | One persona's lane read in order: everything that persona does in the process. |

"Journey" names a reading of the board and is stored nowhere.

A **card** is not a **screen**, and the two are not merged. A screen is a place: one
page in one state. A card is a step: one story's place in a process. A story uses
several screens, a screen serves several stories, and some cards have no screen at
all. What ties them together is the rule, which belongs to one story and names its
screens. A board borrows the screens the storyboard already has and declares none.

**An earlier draft gave a story "beats"**: its moments in order, each on a screen, so
the drawer could walk it. They are gone. A story's rules are already a list in an
order, each with a statement, its screens and its focus (ADR 0016), and a beat held
nothing a rule does not. The drawer walks the rules.

### 2. Personas, users, systems and groups are declared once

All four are declared in the storyboard, beside `recipes:`.

**A persona is a kind of person who uses the system**: a contractor, a hiring manager,
a reviewer. It is a role in the system, never a demographic and never one person.
There is not one for every job title, nor one for every state a user can be in: in
this repository "a reviewer in pin mode" and "a reviewer opening walkdown for the
first time" are both the reviewer.

**A user is one seeded account that plays a persona.** A persona may have several,
because one kind of user often comes at several permission levels, and each signs in
its own way.

```yaml
# <home>/storyboard.yml
personas:
  - id: manager
    title: Manager
    of: Client company
    group: customers
    blurb: >-
      Runs a team and approves what it spends. Some may only look.
    uses: Expenses app
    users:
      - id: approver                       # the first user is the persona's default
        title: Manager who can approve
        setup:
          - visit: /dev/impersonate?id={fixtures.manager}
          - wait_for: nav.signed-in
      - id: view-only-team
        title: View-only team manager
        setup:
          - visit: /dev/impersonate?id={fixtures.view_only_team_manager}
          - wait_for: nav.signed-in
      - id: view-only-org
        title: View-only org manager
        setup: { recipe: as_view_only_org_manager }

  - id: visitor                            # nobody signs in: no users
    title: Visitor
    group: customers
    blurb: Anyone who reaches the public site.
```

- **`title`** and **`of`** are how the persona is named everywhere: on a board's lane,
  in the Personas list, on a story.
- **`blurb`** is one or two sentences on who they are. It follows ADR 0004's wording
  guidelines. It is about the system as a whole, never about one process.
- **`group`** names one of the blueprint's groups, below.
- **`uses`** names the app or surface they work in. It is shown, never computed with.
- **`users`** is optional. Each has an `id`, a `title` and a `setup`: ADR 0017's
  steps, or a recipe. `{fixtures.<key>}` says which real account that is on each
  target, exactly as ADR 0017 §3 describes. walkdown still never holds a credential.
- A persona with no `users` is one nobody signs in as: a visitor to a public page, a
  person at a terminal. It is still a persona, with a lane and an entry in Personas.

A board shows personas. The user appears only where a reader looks closer: in the
drawer and on a card's hover, as "signed in as View-only team manager".

*What the review changed.* An earlier draft put one sign-in on the persona and left
several users for later. The expenses fixture ADR 0017 was built on has one story
with rules for a view-only team manager and a view-only org manager, which that draft
could only call two personas. The example blueprint has no sign-in at all, and a CLI
screen is a moment at a terminal. So users are in from the start, and optional.

**Systems** are the parts of a process that are nobody's to sign in as. A system has a
lane and no users:

```yaml
systems:
  - { id: platform, title: Platform, of: "Jobs, rules, webhooks", group: hidden }
  - { id: screening, title: Screening provider, of: Outside service, group: hidden }
```

**Groups** say which personas and systems belong together, in the order they are
drawn. Every persona and system names one.

```yaml
groups:
  - { id: customers, title: Customers }
  - { id: staff, title: Staff }
  - { id: hidden, title: Out of sight, line: heavy }
```

- **`title`** is the heading a board puts over the group's lanes, and the heading the
  Personas list puts over its personas. The words are the blueprint's: these three
  are one company's, and walkdown ships none.
- **`line: heavy`** draws the line before this group more strongly than the others.
  A blueprint following the service blueprint convention puts it where the customer
  stops being able to see; another may not use it at all.
- A blueprint with no `groups:` draws its personas and systems as one unheaded set.

A persona is a user of the app under review. It has nothing to do with the roles a
verdict is signed as (`eng`, `product`), which belong to the people reviewing.

This is not the "viewers" list ADR 0017 dropped. Nothing switches a rule between
personas: a screen is signed in as one user, and a rule about a different kind of
user is still a different rule with its own screen. A persona and its users only give
those sign-ins names.

### 3. A screen says who is signed in; a story says who acts

```yaml
# <home>/storyboard.yml
screens:
  - id: expense-view-only-team
    app:
      as: manager.view-only-team     # sign in as this user first
      setup:                         # then whatever this screen needs
        - visit: /dev/seed/expense?state=submitted
      path: /expenses/{fixtures.expense_submitted}
```

- **`app.as`** names a user as `<persona>.<user>`, or a persona alone. A persona alone
  means its first user, or nobody when it has none. The panel runs that user's setup,
  then the screen's own `setup`, then loads `path`. A failure in either stops as ADR
  0017 §2 describes, and the App pane says whose step it was.
- **Identity.** A screen's identity (ADR 0017 §4) covers the user's steps and its own.
  Two screens on one path signed in as different users are different screens. A
  screen with `as:` and a screen with the same steps written out are the same state,
  as a recipe and its steps are today.
- **Nothing existing changes.** A screen with no `as` behaves exactly as ADR 0017
  built it.

A story says who acts in it:

```yaml
stories:
  - id: paperwork.sign-contract
    statement: As a contractor, I can read and sign my agreement online.
    as: contractor

  - id: account.change-password
    statement: As anyone with an account, I can change my password.
    as: [contractor, hiring-manager, onboarding-specialist]

  - id: screening.receive-result
    statement: As a team, we hear a check's result the moment the provider has it.
    by: platform
```

- **`as:`** is one persona, or a list of them where a story belongs to several alike:
  signing in, a profile, notifications.
- **`by:`** names a system, for a story nobody is signed in for.
- **A story may have neither.** It is then on no board until it says.
- **`as:` is who acts, never who benefits.** A story's "As a…" sentence often names
  who it is for. Thirteen stories in this repository begin "As a team", and no user
  does what they describe: a system does. So `as:` is never read from the sentence.
- **A story is one card, whoever its rules involve.** Its first persona decides its
  lane. A rule on a screen signed in as another persona is allowed: a specialist
  approves, and one rule says what the client then sees. The drawer says who is signed
  in on each rule as it is walked (§7). Lint warns once, so the author can decide
  whether that rule wants a story and a card of its own.
- **A rule never names a persona.** Its screens already say who is signed in, and some
  rules are about two actors at once (an agent may claim a fix; only a person may
  accept it).

### 4. The board file holds cards and their order, and nothing else

```yaml
# <home>/boards/contractor-onboarding.yml
board: contractor-onboarding
title: Contractor onboarding
phases: [Request, Account, Contract, Screening, Benefits, Placement, Day one]
cards:
  - { story: requests.request-contractor, phase: Request }
  - { story: requests.review-request, phase: Request, after: [requests.request-contractor] }
  - { story: paperwork.sign-contract, phase: Contract, after: [paperwork.pick-pack] }
  - { id: run-check, title: Run the background check, by: screening,
      phase: Screening, after: [screening.consent], takes: 2 to 5 days }
  - { story: screening.receive-result, phase: Screening, after: [run-check] }
  - story: screening.adjudicate
    phase: Screening
    after:
      - { card: screening.receive-result, when: The result is anything but clear }
  - story: benefits.choose-plan
    phase: Benefits
    after:
      - screening.adjudicate
      - { card: screening.receive-result, when: The result is clear }
```

- **A card names a story**, and its title, persona, rules, pictures and status all come
  from that story. None is written again on the board. A card's id is its story's id. It takes
  an `id:` of its own only when the same story is on the board twice (signing a
  document, say).
- **An outside step is a card with no story.** An outside provider runs a background
  check for three days, and that is nobody's to verify. Such a card has an `id:`, a
  `title:` and a `by:` naming the system that does it. It carries no rules and no
  status, and exists so the hand-offs around it read truthfully. The story on our side
  of that step (receiving the provider's result) is an ordinary story, `by:` our own
  system.
- **A step nobody has written a story for is a card with no story too**, naming who
  would do it with `as:` or `by:`. It reads "no story" on the board. That is the one
  thing a board shows that the rules list cannot: a hole in the process.
- **`as:` on a card** is needed only when its story lists several personas. It says
  which of them this step is.
- **`after`** lists the cards this one follows. An entry may be an object with
  `when:`, a short condition written on the arrow. A card with no `after` starts the
  process.
- **`phase`** is a named stretch of the process, drawn as a heading over its columns.
  Phases are drawn in the order `phases:` lists them.
- **`takes`** is free text for how long a step usually lasts. It is shown, never
  computed with.

**Lanes are derived.** A card's lane is its story's persona (the first, where it lists
several and the card does not say), or the system its story or the card itself names
with `by:`. Lanes are drawn group by group, in the order the
storyboard lists the groups, and within a group in the order it lists personas and
then systems. A persona or system with no card on a board has no lane on it.

A line is drawn between one group and the next, and each group's title is its
heading. Nothing about the groups is walkdown's: the three lines of a service
blueprint (interaction, visibility, internal interaction) are simply what a blueprint
gets when it declares those four groups in that order.

**There are no coordinates.** A card's column is the longest chain of hand-offs that
leads to it, within its phase; its row is its lane. A board is a list of facts about
order, so a diff of one reads as a change to the process, and an agent can write one
without placing anything. If derived layout proves too crude for a real board, a card
may later take an optional `col:`; it is not in this draft.

Hand-offs form a graph with no cycles. A step that sends work back (a request
returned for edits) is written on the returning card as `returns_to: <card>`, drawn
as a dashed arrow, and ignored by layout.

The board file is not part of the spec hash. It arranges stories; it claims nothing
about the build. Editing a board never changes what a run says it was judged against.
Personas, users, systems, groups, `as:` and `by:` are in the storyboard and the feature
files, so they are.

### 5. A card's status is its story's, on one target

A card shows one of the marks the rules list already uses, rolled up from the story's
live rules on the target being viewed:

| Mark | When |
|---|---|
| failing | any rule's latest verdict is a fail |
| waiting on you | none fail, and any rule waits on a person |
| not built | none of the above, and no rule has a recorded run |
| passing | every rule is verified |

A card with no story has no mark and reads "no story". The board's top bar counts each mark, and the
target is chosen with the control ADR 0017 §5 added. The roll-up reuses the
computation behind `walkdown status`; it adds no new state.

**What a board of passing cards does not prove.** Every story passing separately does
not show that they join up. Each check usually sets up its own starting state: the
check for "review the request" seeds a submitted request, and never uses the one the
check for "submit a request" made. If one step's real result differs from what the
next step's check assumes, both pass and the process is broken. A board says so
nowhere. If that bites on a real board, a board may later name one end-to-end check
that walks the whole of it, as an extra and never a requirement.

### 6. A card's pictures are its rules' evidence

A board keeps no pictures of its own. An earlier draft had "captures": screenshots
taken for the board, filed by a command and kept in a folder of their own. They are
gone. A blueprint already has two kinds of picture of a screen, and a card uses them.

**Evidence says what it pictures.** When an agent judges a rule it saves evidence, and
the run cites the files. Today that is a bare list of paths. In this repository's 529
agent runs, 12% of evidence file names contain a screen id, nothing records whether a
picture is of the app or of the design, and matching a picture to a screen is a guess.
So an evidence entry may now say what it shows:

```json
{
  "rule": "paperwork.sign-contract.own-language",
  "status": "pass",
  "evidence": [
    { "file": "runs/evidence/2026-11-16T10-02-11Z/contract-pt.png",
      "screen": "contract-review", "surface": "app" },
    { "file": "runs/evidence/2026-11-16T10-02-11Z/contract-design.png",
      "screen": "contract-review", "surface": "design" },
    "runs/evidence/2026-11-16T10-02-11Z/console.txt"
  ]
}
```

- **`screen`** is a storyboard id, and **`surface`** is `app` or `design`. The run
  already says which target it was judged on.
- A bare path is still accepted and means what it does today. Old runs are untouched.
- The judge's prompt asks for labelled entries, since the judge knows all three at
  the moment it saves the file.
- A file that moves may be cited too: a short recording of a rule being walked is
  evidence like any other, and plays where a still would be shown.

**What a card shows.** A story's rules, in the order they are written, each give the
card one picture: the latest `app` evidence for that rule on the target being viewed.

| A rule gives the card | When |
|---|---|
| its latest picture of the app | an agent has judged it on that target and labelled the evidence |
| its screen's accepted design, drawn small, marked "designed" | there is no such picture |
| a frame naming its screen | the screen has no design either |
| what the system did, as text | the rule has no screen, or its evidence is text (a terminal moment) |

Rules that would give the same picture give it once, so a card is not a run of
duplicates. A card's first picture is the one shown at rest.

**A card is a hover gallery.** Moving the pointer across a card's picture steps through
its pictures, one for each equal part of its width, with a bar along the bottom for
each. Moving off returns it to the first. Nothing is clicked, so a click still opens
the drawer and a drag still moves the board (§7). Nothing plays by itself: thirty
cards moving at once cannot be read.

**What must never be in a picture.** Evidence is a picture of whatever the app showed.
On a system holding personal data that is a real person's name, tax number or check
result unless the app was showing seeded records. That has been true of evidence all
along; a board puts those pictures in front of more people. A target says its data is
seeded with `pictures: true` in `spec.yml`, and a board shows app pictures only from
targets that say so. walkdown cannot inspect a picture, so the rest is a rule for the
people and agents judging, stated in the blueprint's `governance:` lines.

**Limits.** A picture exists only where an agent has judged, so a rule verified by
checks alone shows its design. Evidence follows the blueprint's choice about committing
records (ADR 0014), so a board served from a clone that left them out shows designs
throughout. If either turns out to be most of a real board, a step that takes pictures
on purpose earns its place back.

### 7. Three modes: Rules, Boards, Personas

walkdown's top bar chooses between three modes. **Rules** is the panel as it is today.
**Boards** and **Personas** are full pages served by `walkdown serve`. They frame no
app and need no extension: everything on them is a record or a picture. Someone who
has never run the app can read them.

**Personas** lists every persona in the blueprint under its group's title, groups and
personas both in the storyboard's order. Each entry shows:

1. Its title, who it belongs to (`of`), and its blurb.
2. What it uses.
3. Its users, each with its title, and for each target whether that user's fixture
   has a value there. A target with none is said plainly, because nothing signed in as
   that user can be walked or pictured there. A persona with no users says that
   nobody signs in.
4. How many stories are its own, with their marks.
5. The boards it appears on. Choosing one opens that board following this persona.

Systems are not personas and are not listed: nobody signs in as them.

**A board** draws lanes as rows and phases as column headings, with a line between
groups of lanes and each group's heading outside the board, centred on its lanes. A
persona's lane is headed by its title and `of`. A card with a picture shows it, with
its title, its mark and how many pictures it has. A card with none is smaller, with a
dashed edge.

One control floats over the canvas's top-left corner, where the board's own empty
corner sits at rest: **who to follow**. It stays there when the board is moved. It
reads "Everyone" until a persona is chosen. Following a persona:

- keeps their cards lit, keeps the cards they hand to and receive from readable, and
  dims the rest;
- marks each stretch where they wait, between two of their cards, with who they wait
  on and how long it `takes`;
- says in one line who is followed and how much of the board is theirs, with a link
  to their entry in Personas.

**The board is one object on a canvas.** Lane names and phase headings are part of it
and move and scale with it; nothing is pinned to the window's edge. The canvas reaches
well past the board on every edge, so a board can be moved almost out of the window in
any direction, and a small one is never trapped against a corner.

- **Pan** by dragging anywhere, cards included, or with two fingers. A drag that moved
  is never a click.
- **Zoom** is smooth and in both directions at once: by pinch, by the wheel, or by the
  board's own controls. What was under the pointer stays under it.
- **Fit** sets the largest zoom at which the whole board is in the window, and centres
  it.

**Time runs across or down, and the reader chooses.** Across is the service
blueprint as it is usually drawn: lanes are rows, and the process reads left to right.
Down turns it: lanes are columns headed by their personas, phases are bands down the
left, and the process is scrolled like a page. Across shows the whole shape in one
window. Down gives each card more of the window and keeps every lane's name in view
at the top. Which is the better default is open until both have been used on a real
board; the choice is kept in the browser, like the zoom.

A card and a lane name each show less as they get smaller and more as they get
larger, changing only where the detail could no longer be read:

| As it gets smaller | A card shows | A lane name shows |
|---|---|---|
| larger than life | everything, scaled | its avatar, title, `of`, what it uses, its blurb and its default user |
| at first | its pictures, title, mark and how many pictures | its avatar, title, `of` and what it uses |
| once the picture cannot be read | its title and mark, drawn at a readable size again | its avatar and title |
| once the words cannot be read | a block in its mark's colour | its avatar |

- A card that sheds its picture does not jump smaller. Its title is redrawn larger in
  the same space, and shrinks from there.
- **Hovering a card that has shed anything brings it back** in a small card beside
  it: its picture, persona, title, mark and how many rules it has. The small card is
  the gallery's scrubber: moving across it steps the picture beside it, with the same
  bars, and under each picture the statement of the rule it is evidence for. A reader
  sees every picture of a story without opening anything.
- A card never touches the lane names: the space between columns stops shrinking
  before it closes.
- Hand-offs are drawn at every zoom.
- Following a persona works at every zoom: far out, it is their whole journey and
  where they wait, in one window.
- Choosing a card at any zoom opens the drawer, which always shows the full picture,
  and brings the card into the window if it was outside.
- Where the board sits and how far it is zoomed are kept in the browser, per board.
  They are not in the board file, and they are not shared between people.

**The drawer** opens on the right when a card is chosen, and holds:

1. The persona, the story's title and id, and its mark.
2. The story's rules, walked in the order they are written. The current rule shows
   its picture with its focus ringed (ADR 0016), or what the system did as text; then
   its statement and its mark; then who is signed in, when that is not the story's
   own persona's default user; then Back and Next, and every picture as a strip.
3. A control for which pictures are shown: the app on a target, or the design.
4. Every rule of the story as a list, each with its mark. Choosing one opens it in
   Rules, on its screen.
5. The cards this one follows and the cards that follow it, each a link.

A walk in rule order shows side cases among the main path ("an expired link offers a
new one"), and several rules on one screen show it more than once with a different
thing ringed. Both are what a walkdown already does.

**Rules links back.** A story's heading in the rules list names its persona, a rule's
detail names the user its screen is signed in as, and a story that is on a board says
which, with the cards before and after it.

A board reads and never judges. No verdict is given from it, no thread is filed from
it, and no design is accepted on it. Those stay in the walk, where a person has the
build in front of them (ADR 0006, ADR 0015).

### 8. Lint

Lint refuses:

- a persona, user or system with no `title`;
- a `group:` that names no group, once any group is declared;
- a system with `users`, and a user `setup` ADR 0017's lint would refuse on a screen;
- a screen whose `as:` names no persona, or no user of that persona;
- a story whose `as:` names no persona or whose `by:` names no system, and a story
  with both;
- an evidence entry whose `screen` is not in the storyboard, or whose `surface` is
  neither `app` nor `design`.

Lint warns about a persona nothing names, a user whose fixture has no value on a
target, and a rule on a screen signed in as a persona its story does not name.

Lint refuses a board that:

- names a story, card or phase that does not exist;
- has a card with both `story:` and `title:`, or neither;
- has a card with no lane: its story names neither a persona nor a system, or the
  card has no story and no `as:` or `by:`;
- has a card for a story of several personas that does not say which, where more than
  one of them has a lane on the board;
- has the same story twice without an `id:` on each;
- has hand-offs that form a cycle;
- puts a retired story on a card.

## Not now

- **A board across projects.** A card names a story in its own blueprint, or in
  another blueprint of the same project as `<blueprint>:<story id>` (ADR 0011). A
  process whose actors' apps live in separate repositories cannot be one board yet.
  This is the limit most likely to matter first; see the questions below.
- **Variants of one process.** A process that differs by country, by client or by
  contract type is, for now, one board per variant, or one board with `when:` on the
  arrows where the difference is small.
- **Rules filtered by persona.** The rules list names a story's persona and does not
  yet filter by it.
- **Groups that differ by board.** Groups are declared once, with the personas, so
  the Personas list and every board agree. A board that wants its lanes in another
  order, or under other headings, is left until a real blueprint needs it.
- **A user's lane.** A board's lanes are personas. Splitting one into its users is
  left until a board needs it.
- **A goal per process.** What a persona is trying to get done on one board. The
  blurb says who they are across the system, and that is all for now.
- **The feelings, pain points and opportunities rows** of a customer journey map.
  Those are research findings. walkdown records what was built.
- **Metrics on a card** (how long a step really takes, where people drop out).
- **Editing a board in the page.** The file is written by a person or an agent, as
  feature files are.
- **A minimap.** Zoomed out, the board is its own.
- **A static export** of a board for someone with no walkdown. Likely wanted soon;
  left out until the page itself has been used.
- **Pictures taken on purpose.** A card shows evidence that already exists and falls
  back to the design. A step that photographs every screen for the board, by an agent
  or by the panel as a person walks, waits until real boards show how much is missing.
- **A check that walks a whole board.** See §5.
- **Marking a rule as off the main path**, so a walk can skip the side cases.
- **Anything that runs a process.** A board shows whether a process is built and
  passing. Moving real work from step to step is the product's own job.

## Questions for a real system

This draft was written against a made-up process. Before it is accepted, an agent
that knows a real, complicated system should try to write one of its processes as a
board, on paper, and answer these. A "no" or "it depends" on any of them is a gap.

**Stories and lanes**

1. Pick one real end-to-end process. How many cards is it? Does it fit one board, or
   does it need boards that link to each other?
2. Is every step one actor's? List any step where two actors act on the same screen
   at once, or where one screen is used by two kinds of user.
3. List the personas, the systems, and the groups you would put them in, in your own
   words. Does every lane belong to exactly one group? List any that fit none, or two
   (a client's own administrator, a partner company's staff, a recruiter acting for a
   contractor). Does one order of groups suit every board, or would two boards want
   them drawn differently?
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

**Screens and rules**

10. For three stories, read the rules in the order they are written. Is that the order
    things happen in? Does each land on one screen the storyboard could reach as one
    of the persona's users, with ADR 0017's setup (`visit`, `post`, `wait_for`)?
11. Which steps are not on any screen of ours: an email, an SMS, a PDF, a page on an
    outside service's site? What would a card show for those?
12. Which steps happen on a phone or in a native app, where the viewport or the
    picture differs?

**Where things live**

13. Which repositories and apps does the process cross? Would the stories sit in one
    blueprint, several blueprints of one project, or several projects?
14. Which existing tests or specs already walk parts of this process end to end?
    Where two stories' checks each seed their own state, would the process still hold
    if one used what the other made?

**Pictures and data**

15. Which targets have seeded data safe to photograph? What on these screens is
    personal or regulated (tax numbers, check results, health choices)?
16. Can each screen's state be reached from seeds alone, or do some states need an
    outside service to have answered first?
17. Who needs to read a board who cannot run walkdown, and what would they need: a
    link, a file, a page in another tool?

## Consequences

- **The schema is additive.** `personas:` (with `users:`), `systems:` and `groups:` in
  the storyboard; `as:` on a screen; `as:` or `by:` on a story; a `boards/` folder in
  the home; `pictures: true` on a target; and evidence entries that may say their
  `screen` and `surface`. A
  blueprint with none of them behaves exactly as before, and no upgrade step is
  needed. [02-blueprint-schema.md](../../02-blueprint-schema.md) and
  [05-runs-ledger.md](../../05-runs-ledger.md) gain the sections, and
  [01-glossary.md](../../01-glossary.md) gains persona, user, system, group, board,
  card, hand-off, lane and journey.
- **It can be built in three parts, each useful alone.** Personas and users first:
  they name the sign-ins ADR 0017 built, and the rules panel can show them with no
  board at all. Labelled evidence second: the rules panel gains a picture it can
  trust for each screen. Boards last, which then need little of their own.
- **It reaches back into screen setup.** `app.as` is an addition to what ADR 0017
  built and Topher walked. It gets rules of its own under `screens.setup`, and a
  design for how a rule's detail and the App pane name the user, before it is built.
- **It reaches into the runs ledger.** An evidence entry may be an object. Every
  reader of a run (the panel, `walkdown status`, lint, the judge's prompt) has to take
  both forms, and the ledger stays append-only: no old run is rewritten.
- **A board is cheap to throw away.** It holds only order, so a wrong one costs a file.
  The stories, personas and pictures it draws are the blueprint's and outlive it.
- **Design comes first.** The board, the drawer and the Personas list are screens of
  the `walkdown` blueprint. Each gets its rules and a design request before anything
  is built, and the sketch is not that design (ADR 0009, ADR 0015 §8).
- **A board can be wrong where a rule cannot.** A rule has a verdict. An arrow has
  none: nothing checks that the platform really hands off to the specialist, and
  stories that pass apart may not join (§5). A board is as true as the person who
  drew it.
- **Pictures are only as fresh as the last judging.** A screen restyled in code shows
  its old picture until an agent judges a rule on it again. A sweep of the agent tier
  refreshes every picture as a side effect, which is one more reason to hold one.
- **Existing stories need `as:` or `by:` before they can go on a board.** Nothing reads
  it from the "As a…" sentence. In this repository that is 58 stories to mark, most
  of them one persona's.
- **It needs a fixture with more than one persona.** The example blueprint's waitlist
  has two (an operator and a visitor) and no sign-in; the expenses fixture has one
  persona with three users. A board needs both in one app: two personas, a sign-in,
  and one hand-off between them.
