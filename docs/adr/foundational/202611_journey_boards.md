# ADR 0018 — Journey boards

- **Status:** proposed 2026-11-10, a draft. Nothing here is accepted, and nothing is
    built. It was written to be checked against a real system first (see "Questions
    for a real system"). One real system has answered them, and the answers changed
    it; a second would still be worth having.
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
- **Checked against:** a real process on a real system on 2026-11-17, written as a
    board on paper by an agent that knows the system: one board of 13 to 16 cards,
    three personas with twelve users, four systems, and stories from two blueprints
    of one project. A script applied §4's layout, §5's
    marks (from main's `deriveStatus`) and §8's lint to it. What that changed is said
    where it applies, under "What the real-system trial changed".

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
| **Card** | One step of a process: one story, an outside service's step, or a hole where a story is missing (§4). Never several stories. |
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

All four are declared in the storyboard, beside `recipes:`, and once per project. A
project's blueprints share them (ADR 0011), because the people in a process do not
change with the blueprint a story is filed in. One blueprint declares them, and each
of its siblings names it in its own storyboard:

```yaml
# the storyboard.yml of another blueprint in the same project
personas_from: expenses   # its personas, users, systems and groups are these
```

A storyboard with `personas_from:` declares none of the four itself. The blueprint it
names is one of the same project's, by the name `--blueprint` takes, and declares
them itself. A user's `{fixtures.<key>}` is filled from the fixtures of the blueprint
whose screen signs in as that user, so each blueprint keeps its own values (ADR 0017
§3).

A project's homes can be partly committed and partly personal, so the blueprint named
may not be registered on the machine reading this one. Lint then warns that the
personas could not be read and names the blueprint, and refuses nothing that depends
on them. A screen's `as:` runs no sign-in there, and the App pane says why.

*What the real-system trial changed.* The trial's process took stories from two
blueprints of one project, and personas were each blueprint's own, so its managers
would have been declared twice. The trial copied one blueprint's feature into the
other to get by.

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
      - id: view-only-team                 # the first user is the persona's default
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

recipes:
  as_view_only_org_manager:
    - post: /dev/session
      fields: { user_id: "{fixtures.view_only_org_manager}" }
```

These are the expenses fixture's own routes and keys
(`checks/fixtures/expenses-app.mjs` and its blueprint in `checks/checkspace.mjs`):
its two users are view-only managers, and it has no manager who can approve.

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
  - { id: screening, title: Screening provider, of: Outside service, group: hidden,
      outside: true }
```

- **`outside: true`** says the system is another company's. What it does is nobody's
  here to verify, so no story is ever `by:` it. The platform's own jobs are not
  outside: a step of theirs with no story is a story nobody has written yet (§4).
- Personas and systems share one set of ids. A lane, an `as:` and a `by:` each name
  one, and an id that is both would make a lane ambiguous.

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
- This order is the Personas list's, and every board's unless the board gives its own
  (§4).

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
  - id: expense-team
    app:
      as: manager.view-only-team     # sign in as this user, then load the path
      path: /expenses/{fixtures.expense_submitted}
```

- **`app.as`** names a user as `<persona>.<user>`, or a persona alone. A persona alone
  means its first user, or nobody when it has none. The panel runs that user's setup,
  then the screen's own `setup`, then loads `path`. A failure in either stops as ADR
  0017 §2 describes, and the App pane says whose step it was.
- **The record is a fixture, never made by setup.** The expense above is one the
  app's seed task made, named by `{fixtures.expense_submitted}`. Setup signs in and
  reaches a state; it never creates a record (ADR 0017, "Not now"). A state no seed
  makes yet is the seed task's to add.
- **`as:` with a prose `setup`.** The user's steps run, and the prose is shown to the
  reviewer as it is today, never run. Prose tells no two screens apart, so such a
  screen's identity is its user's steps and its path.
- **Identity.** A screen's identity (ADR 0017 §4) covers the user's steps and its own.
  Two screens on one path signed in as different users are different screens. A
  screen with `as:` and a screen with the same steps written out are the same state,
  as a recipe and its steps are today. Main's `setupSignature` (`lib/setup.js`) reads
  only the screen's own `setup`, so today such screens still tie; it has to take the
  user's steps first.
- **Fixtures in a path or a query are URL-encoded.** A value filled into a `visit:`
  or an `app.path` is encoded as one path segment or one query value. An email in
  `?email={fixtures.manager_email}` needs it. A value filled into a `post` field is
  sent as it is, because the form encodes it. Main's `fill` encodes nothing, for any
  screen.
- **Nothing else changes.** A screen with no `as` behaves exactly as ADR 0017 built it.

*What the real-system trial changed.* An earlier draft's example made the record in
setup (`/dev/seed/expense`), which ADR 0017 rules out. Eight of the trial's screens
signed in by `as:` and then carried prose, which the draft left undefined. Its
sign-ins name accounts by email, which a query cannot carry unencoded. And
main's lint still called two screens that differ only by user a tie.

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
- **`by:`** names a system, for a story nobody is signed in for. Never an outside one
  (§2).
- **A story may have neither.** It is then on no board until it says.
- **`as:` is who acts, never who benefits.** A story's "As a…" sentence often names
  who it is for. Thirteen stories in this repository begin "As a team", and no user
  does what they describe: a system does. So `as:` is never read from the sentence.
- **A story is one card, whoever its rules involve**, unless a board splits it with
  `rules:` (§4). Its first persona decides its lane. A rule on a screen signed in as
  another persona is allowed: a specialist approves, and one rule says what the client
  then sees. The drawer says who is signed in on each rule as it is walked (§7). Lint
  warns once, so the author can decide whether that rule wants a story and a card of
  its own. A story `by:` a system is never warned about: every screen it has is signed
  in as someone else, because nobody signs in as a system. (The trial's alert story
  was checked on the managers' list, and an earlier draft warned on it every time.)
- **A rule never names a persona.** Its screens already say who is signed in, and some
  rules are about two actors at once (an agent may claim a fix; only a person may
  accept it).

### 4. The board file holds cards and their order, and nothing else

```yaml
# <home>/boards/contractor-onboarding.yml (some of its cards; the sketch has them all)
board: contractor-onboarding
title: Contractor onboarding
phases: [Request, Account, Contract, Screening, Benefits, Placement, Day one]
cards:
  - { story: requests.request-contractor, phase: Request }
  - { story: requests.review-request, phase: Request,
      after: [requests.request-contractor], returns_to: requests.request-contractor }
  - { story: paperwork.sign-contract, phase: Contract, after: [paperwork.pick-pack] }
  - { id: reissue-contract, title: Issue a new contract when the terms change,
      by: platform, phase: Contract, returns_to: paperwork.sign-contract,
      after: [{ card: paperwork.pick-pack, when: The terms change before signing }] }
  - { id: run-check, title: Run the background check, by: screening,
      phase: Screening, after: [screening.consent], takes: 2 to 5 days }
  - { story: screening.receive-result, phase: Screening, after: [run-check] }
  - id: adjudicate-clear
    story: screening.adjudicate
    as: onboarding-specialist.lead
    rules: [screening.adjudicate.reason-required, screening.adjudicate.report-kept]
    phase: Screening
    after:
      - card: screening.receive-result
        when: Flagged for a specialist who may clear it
  - id: adjudicate-view
    story: screening.adjudicate
    as: onboarding-specialist.trainee
    rules: [screening.adjudicate.view-only]
    phase: Screening
    after:
      - card: screening.receive-result
        when: Flagged for a specialist who may only view
  - story: benefits.choose-plan
    phase: Benefits
    after:
      - adjudicate-clear
      - { card: screening.receive-result, when: The result is clear }
  - story: dayone.first-day
    phase: Day one
    after_all: [placement.provision, benefits.enrol]
```

- **A card names a story**, and its title, persona, rules, pictures and status all come
  from that story. None is written again on the board. A card's id is its story's id. It takes
  an `id:` of its own only when the same story is on the board twice (signing a
  document, say).
- **One card is one story, never several.** Real stories are often divided by who may
  do a step rather than by step: a specialist who may clear a flagged check and one
  who may only view it. Each is its own card at that step, and the cards are
  alternatives: the arrows into them say `when:`, and they are drawn as one of these
  (below).
- **`blueprint:`** names a sibling blueprint in the same project when the story is
  there: `{ story: approvals.single, blueprint: approvals }`. The name is the one
  `--blueprint` takes. Without it, a story is the board's own blueprint's. Two
  blueprints may both have a story with one id, and the board then gives each card an
  `id:`, as for a story on it twice.
- **`rules:`** narrows a card to some of its story's rules, for a story on the board
  more than once. Each card then shows only those rules, and its mark and pictures
  are rolled up from them alone. A story that "sees the outcome" after two different
  decisions, or a step split by permission as above, is otherwise two cards with one
  mark and every picture twice. Its rules are named by id. One of the story's cards
  may leave `rules:` out, and it takes every rule the others do not name, so a rule
  added to the story later lands on that card without the board being edited. Where
  every card names its rules, every rule of the story belongs to at least one of
  them. This is the trial's proposal, and the one rule here that no second board has
  tried.
- **`as:` on a card** is needed only when its story lists several personas. It says
  which of them this step is. It may also name one user, `<persona>.<user>`, when the
  step is about that user and the persona has several. The card and the drawer then
  name the user, and the drawer starts on that user's rules.
- **An outside step is a card with no story, `by:` an outside system** (§2). An
  outside provider runs a background check for three days, and that is nobody's to
  verify. Such a card has an `id:`, a `title:` and a `by:`. It carries no rules and no
  mark, and exists so the hand-offs around it read truthfully. It is drawn with a
  plain edge and a muted face, marked "outside", with the system's name. The story on
  our side of that step (receiving the provider's result) is an ordinary story, `by:`
  our own system.
- **A hole is any other card with no story**: `as:` a persona, or `by:` one of our
  own systems. It is a step the process needs and nobody has written a
  story for. It reads "no story" and is drawn with a dashed edge in the colour of a
  warning. That is the one thing a board shows that the rules list cannot: a hole in
  the process.
- **`after`** lists the cards this one follows, and means after any one of them. An
  entry may be an object with `when:`, a short condition written on the arrow and at
  the top of the card. **`after_all`** lists cards that must all be done first: a join,
  where two stretches of work run side by side and the next step waits for both. A
  card has one or the other. A card with neither starts the process.
- **`phase`** is a named stretch of the process, drawn as a heading over its columns.
  Phases are drawn in the order `phases:` lists them.
- **`takes`** is free text for how long a step usually lasts. It is shown, never
  computed with. Reminders and deadlines inside a step are its rules, not cards.

*What the real-system trial changed.* Its outside steps and its one hole had the same
shape and were drawn alike. Only two of its five approval stories fitted as cards,
because the stories were divided by permission, and a card that held `stories: [...]`
was proposed and rejected: a card's mark, pictures and drawer would belong to no one
story. A story on its board twice brought every rule and picture to both cards. Its
payment step followed one of three approvals, and nothing said whether `after:` meant
any of them or all.

**Lanes are derived.** A card's lane is its story's persona (the first, where it lists
several and the card does not say), or the system its story or the card itself names
with `by:`. Lanes are drawn group by group, in the order the
storyboard lists the groups, and within a group in the order it lists personas and
then systems. A persona or system with no card on a board has no lane on it.

A line is drawn between one group and the next, and each group's title is its
heading. Nothing about the groups is walkdown's: the three lines of a service
blueprint (interaction, visibility, internal interaction) are simply what a blueprint
gets when it declares those four groups in that order.

**A board may order its own groups.** One process can have two kinds of customer, and
whichever group comes first, the line of visibility is wrong for the other:

```yaml
groups: [clients, workers, { id: staff, line: heavy }, hidden]   # this board's order
```

`groups:` lists every group with a lane on the board, by id. An entry may be an object
with `line: heavy`, which means what it means in the storyboard (§2): the line before
that group is the heavy one. Titles stay the storyboard's. A board with no `groups:`
uses the storyboard's order and line, and the Personas list always does.

**There are no coordinates.** A card's column is the longest chain of hand-offs that
leads to it, within its phase, through `after` and `after_all` alike; its row is its
lane. A board is a list of facts about order, so a diff of one reads as a change to the
process, and an agent can write one without placing anything. If derived layout proves
too crude for a real board, a card may later take an optional `col:`; it is not in
this draft.

- **Cards that derive to one cell are stacked** in that column, in the order the board
  lists them, and the lane grows to hold them. Where every hand-off into them has a
  `when:`, they are alternatives: a bracket holds them, headed "one of these", and
  each card shows its `when:` at its top.
- **A card nothing follows ends its branch**, and says "ends here". The last card of a
  process is one; so is a step where one branch stops (a person who may only view, a
  request withdrawn). A card with `returns_to` does not end.

Hand-offs form a graph with no cycles. A step that sends work back (a request
returned for edits) is written on the returning card as `returns_to: <card>`, drawn
as a dashed arrow, and ignored by layout.

The board file is not part of the spec hash. It arranges stories; it claims nothing
about the build. Editing a board never changes what a run says it was judged against.
Personas, users, systems, groups, `as:` and `by:` are in the storyboard and the feature
files, so they are.

### 5. A card's status is its story's, on one target

A card shows one of five marks, rolled up from its live rules (the story's, or its
`rules:`, or the rules its other cards leave) on the target being viewed. The first
that holds is the card's:

| Mark | When |
|---|---|
| failing | any rule's latest verdict is a fail |
| not built | none fail, and any rule is not built |
| waiting on you | every rule is built, none fail, and any rule waits on a person |
| waiting on an agent | every rule is built, none fail, nothing waits on a person, and any rule waits on the agent tier |
| passing | every rule is verified |

- **Built** means what `walkdown status` means by it (`deriveStatus` in
  `lib/status.js`): the ledger holds a pass, a fail or a stale pass for the rule from
  checks or the agent tier, or every tier of the rule is excused and a person's
  signature is its whole verdict. An approved wording is not a build.
- **Waiting on an agent** is a built rule the agent tier owes a look: never judged,
  stale since, or a claimed fix to judge again. `walkdown status` already holds such
  a rule out of every person's queue, so without this mark the card would read
  passing.

A card with no story has no mark. A hole reads "no story", and an outside step reads
only "outside". The board's top bar counts each mark and the holes, and the
target is chosen with the control ADR 0017 §5 added. The roll-up reuses the
computation behind `walkdown status`; it adds no new state.

*What the real-system trial changed.* An earlier draft checked "waiting on you" before
"not built". `deriveStatus` queues every unbuilt rule to its signers for the wording,
so the trial's new board, with no runs at all, read "waiting on you" on every card
and "not built" on none. It also had no mark for a story that is built and waits
only on an agent.

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
seeded with `pictures: true` under `runner.targets.<target>` in `spec.yml`, beside its
`base_url` and `fixtures`, and a board shows app pictures only from targets that say
so. walkdown cannot inspect a picture, so the rest is a rule for the
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

**A board can be read by people who will never run walkdown.** In the trial, most of
the people who read the process (the staff who run it day to day, and those who
answer customers about it) would never install walkdown, and needed the board from
the first day. So a board, with its drawer and its pictures on one target, can be
written out as one page that reads with no server. It is a copy, and says the date it
was made and its target. How it is made (a command, a button on the page) and where
it goes (a file, a hosted link) are open.

**Personas** lists every persona in the project (§2) under its group's title, groups
and personas both in the storyboard's order. Each entry shows:

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
its title, its mark and how many pictures it has. A card with no story has no picture,
and is drawn as a hole or as an outside step (§4).

**A card is sized for a real story's title.** It is wider than it is tall, and its
title reads in at most three lines at rest; a longer one is cut there and shown whole
on hover and in the drawer. Under the title is one line: its mark, how many rules it
has, and "ends here" where it ends. A second line says how long it `takes`, when it
says. A card reached by a `when:` shows the condition across its top.

*What the real-system trial changed.* The sketch sized cards for its own three-word
titles. A real story's title ran to fourteen words, wrapped two words to a line, and
one card did not fit the window at 200%.

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
  it. It is measured rather than computed, because a card's height changes with the
  detail it shows, and a stack of alternatives makes that change large.

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
2. The card's rules (the story's, its `rules:`, or those its other cards leave),
   walked in the order they are written, starting on the user the card names when it
   names one. The current rule shows its picture with its focus ringed (ADR 0016), or what the system did as text;
   then its statement and its mark; then who is signed in, when that is not the
   story's own persona's default user; then Back and Next, and every picture as a
   strip.
3. A control for which pictures are shown: the app on a target, or the design.
4. Every rule of the card as a list, each with its mark, and then any of the story's
   rules that are on its other cards. Choosing one opens it in Rules, on its screen.
5. The cards this one follows and the cards that follow it, each a link, with each
   arrow's `when:`; or that its branch ends here.

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
- a persona and a system with the same id (§2);
- a `group:` that names no group, once any group is declared;
- a `personas_from:` that names no blueprint of the same project, or one that takes
  its own from another, and a storyboard with `personas_from:` that declares personas,
  systems or groups of its own;
- a system with `users`;
- a story `by:` an outside system;
- a screen whose `as:` names no persona, or no user of that persona;
- a story whose `as:` names no persona or whose `by:` names no system, and a story
  with both;
- an evidence entry whose `screen` is not in the storyboard, or whose `surface` is
  neither `app` nor `design`.

**A user's setup is linted as a screen's is** (ADR 0017): its steps, its recipe, and
its fixtures on each target, with each warning naming the user rather than a screen.
A `wait_for` in a user's steps is checked against the anchors of the screens that sign
in as that user, and lint warns when none of them declares it. Main's lint reads none
of ADR 0018's keys yet, users' setup included.

Lint warns about a persona nothing names, a user whose fixture has no value on a
target, and a rule on a screen signed in as a persona its story does not name. That
last warning is never given for a story `by:` a system (§3).

Lint refuses a board that:

- names a story, card, phase, group or blueprint that does not exist;
- has a card with both `story:` and `title:`, or neither;
- has a card with no lane: its story names neither a persona nor a system, or the
  card has no story and no `as:` or `by:`;
- has a card for a story of several personas that does not say which, where more than
  one of them has a lane on the board;
- has a card whose `as:` names a user its persona does not have;
- has the same story twice without an `id:` on each;
- has a card with `rules:` naming a rule its story does not have, or with `rules:`
  for a story on the board once, or a story on it more than once with two cards that
  leave `rules:` out while another names some, or one whose cards all name their
  rules and leave a rule on none of them;
- has a card with both `after` and `after_all`;
- has `groups:` that leaves out a group with a lane on the board;
- has hand-offs that form a cycle;
- puts a retired story on a card: one whose every rule is retired.

*What the real-system trial changed.* An earlier draft listed a retired story here,
and nothing defined one. Persona and system ids could collide. And a user's `wait_for`
had no screen whose anchors it could be checked against.

## Not now

- **A board across projects.** A card names a story in its own blueprint, or in
  another blueprint of the same project with `blueprint:` (§4). A process whose
  actors' apps live in separate repositories cannot be one board yet.
- **Variants of one process.** A process that differs by country, by client or by
  contract type is, for now, one board per variant, or one board with `when:` on the
  arrows where the difference is small. The trial's process had about four.
- **Phases that run side by side.** Phases are one sequence. Two stretches of a
  process that start from one step and run in parallel (paying a worker and billing a
  client, say) are drawn one after the other, although the cards and their hand-offs
  say the truth. Drawing two phases side by side, as parallel bands, waits until a
  second board needs it.
- **A viewport per screen or user.** People do some steps on a phone, and nothing on
  a screen or a user says so, so their pictures are as wide as a desk. A `viewport:`
  on a screen or a user, with pictures taken at it, waits until labelled evidence is
  built.
- **Rules filtered by persona.** The rules list names a story's persona and does not
  yet filter by it.
- **A user's lane.** A board's lanes are personas. Splitting one into its users is
  left until a board needs it. A card may name its user (§4).
- **A goal per process.** What a persona is trying to get done on one board. The
  blurb says who they are across the system, and that is all for now.
- **The feelings, pain points and opportunities rows** of a customer journey map.
  Those are research findings. walkdown records what was built.
- **Metrics on a card** (how long a step really takes, where people drop out).
- **Editing a board in the page.** The file is written by a person or an agent, as
  feature files are.
- **A minimap.** Zoomed out, the board is its own.
- **Pictures taken on purpose.** A card shows evidence that already exists and falls
  back to the design. A step that photographs every screen for the board, by an agent
  or by the panel as a person walks, waits until real boards show how much is missing.
- **A check that walks a whole board.** See §5. In the trial, every existing test
  seeded its own state and none walked the whole process.
- **Marking a rule as off the main path**, so a walk can skip the side cases.
- **Anything that runs a process.** A board shows whether a process is built and
  passing. Moving real work from step to step is the product's own job.

## Questions for a real system

This draft was written against a made-up process. Before it is accepted, an agent
that knows a real, complicated system should try to write one of its processes as a
board, on paper, and answer these. A "no" or "it depends" on any of them is a gap.

**Answered once, on 2026-11-17**, by the trial under "Checked against". What changed
the draft is said where it applies. The rest held: `when:` on an arrow covered every
branch, `returns_to` covered work sent back, free-text `takes:` was enough for every
wait, and a step off our screens (an alert, a reminder, another company's document)
read well enough as a card with text or no picture. Every state the trial could not
reach from seeds needed the app's seed task extended, never a setup step. The
questions stay for the next real system.

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

- **The schema is additive.** `personas:` (with `users:`), `systems:` (with
  `outside:`), `groups:` and `personas_from:` in the storyboard; `as:` on a screen;
  `as:` or `by:` on a story; a `boards/` folder in the home; `pictures: true` on a
  target; and evidence entries that may say their `screen` and `surface`. A
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
  Two changes reach every screen, `as:` or not: `setupSignature` takes the user's
  steps into a screen's identity, and `fill` URL-encodes a fixture in a path or a
  query (§3).
- **It reaches into the runs ledger.** An evidence entry may be an object. Every
  reader of a run has to take both forms, and the ledger stays append-only: no old
  run is rewritten. Today each assumes a string:
  - `src/panel/rule-detail.js` hands a rule's files to the evidence modal, and
    `src/panel/evidence.js` calls `startsWith` on each, which throws on an object;
  - `lib/rules-move.js` copies a moved rule's evidence by matching `String(e)`
    against `runs/evidence/`, so an object entry is silently left behind;
  - `lib/run-record.js` merges a test's entries with `includes`, which never finds an
    object it already holds;
  - `lib/status.js` passes entries through, and the judge's prompt and lint learn the
    new form with it.
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
