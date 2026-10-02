# ADR 0013 — A project split into blueprints

- **Status:** accepted 2026-10-02 by Topher. Nothing is built; the rules it adds and
    rewords are drafted for his approval.
- **Date:** 2026-10-02
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0011 (several blueprints per project), ADR 0007 (as-built drawings),
    ADR 0009 (who draws the design).
- **Amends:** ADR 0011 §2, where `walkdown run` refused without `--blueprint`.
- **Comes before:** ADR 0012 (CLI command structure). Its new rules are drafted in the
    blueprint this ADR creates.

## Context

ADR 0011 made it possible to give a project a second blueprint, and its own rules held
when tested. Then a realistic project was built: two blueprints, `checkout` and
`search`, sharing one test suite with a test tagged for each. Every step a team takes
was run against it on 2026-10-02. Six things broke:

1. **A recorded test run records nothing.** The node reporter picks its blueprint by
   where the suite runs. With two standing there it prints "no blueprint found — run
   not recorded", and every rule stays unbuilt. The Playwright reporter and the RSpec
   formatter pick the same way.
2. **`walkdown run --blueprint checkout` records nothing either.** The node reporter
   never reads the `WALKDOWN_SPEC` that `run` passes it. Where a reporter does read it,
   as RSpec's does, the whole suite's results go to `checkout`, `search`'s included,
   and `search` never sees its own.
3. **Lint fails both blueprints.** Each lists the whole suite. A test tagged
   `search.basics.works` is, to `checkout`, "a check references this rule id, but no
   such rule exists". That is an error, so the Highball check that runs lint blocks
   every turn.
4. **Thread ids collide.** Each blueprint numbers its own threads, so both have an
   `n-0001`. `walkdown thread n-0001` rightly refuses to guess. But a rule whose history
   says "(n-0001)" no longer says which one it means, and lint's check that a rule's
   origin names a real thread reads only its own blueprint.
5. **`walkdown pointer` says "No blueprint here".** The paragraph it writes for agents
   names one spec, and with two there is no answer to give.
6. **The skills read `walkdown status --json` as one blueprint's answer.** With two, the
   answer is `{ "blueprints": [ … ] }` (ADR 0011). `/walkdown:judge`, `/walkdown:incorporate`
   and `AGENTS.md` do not say so.

Committing both blueprints with `--commit spec`, importing them on a second machine,
`status`, `where`, `threads`, `claims` and `judge --blueprint` all worked as ADR 0011
says.

Nothing moves rules between blueprints. A project that started with one blueprint and
grew a second concern, which is how every second blueprint will start, has to cut YAML
by hand and loses every verdict the moved rules earned.

Walkdown is such a project. Its one blueprint holds 175 rules for two different
surfaces:

- **The panel:** 108 rules with screens, judged by looking at the panel beside its
  design.
- **The command line and the records it keeps:** 63 rules without a screen. These are
  judged only by running commands and reading the output, so the agent tier has nothing
  to compare that output with.

Topher wants these split. The CLI rules then need something to show on the two sides of
the fade.

## Decision

**A project's blueprints share its test suite, its thread numbering and its pointer.
Rules move between blueprints with their history. Walkdown splits its own blueprint into
`panel` and `cli`, and the CLI's screens show its output as text.**

### 1. A result goes to the blueprint that holds its rule

The node reporter, the Playwright reporter and the RSpec formatter collect a recorded
run's results the way they do today. They then file each result in whichever of the
project's blueprints holds its rule: one run record per blueprint, sharing a `run_id`
and the run's metadata.

- A result whose rule no blueprint in the project holds is named in the reporter's
  output, and kept in no ledger.
- A project with one blueprint records exactly as before.
- `WALKDOWN_SPEC`, when `walkdown run` passes it, narrows the filing to that blueprint.
  Results for other blueprints' rules are named and set aside, never filed there.

`walkdown run` with no `--blueprint`, in a project with several, runs the suite once and
files as above. This amends ADR 0011 §2, which refused it. Running the suite is
something the project does, not something one blueprint does, and refusing it was the
guess it meant to avoid, moved one step along. If the blueprints declare different
runner commands, each distinct command runs once.

### 2. Lint reads the project, not only the blueprint

- A check tagged with a rule that a sibling blueprint holds is not a coverage error.
  A tag that no blueprint in the project holds still is.
- A rule's `origin` or history naming a thread is checked against every blueprint in the
  project.

### 3. Thread ids are unique within a project

A new thread's number is one more than the highest number in any of the project's
blueprints. Existing collisions stay as they are; nothing is renumbered. From the first
thread filed after this lands, an id names one thread in the project, and a rule citing
one is unambiguous.

### 4. The pointer names every blueprint

The paragraph `walkdown pointer` writes lists each blueprint in the project with its id
and where its spec is. It tells an agent that commands which write take `--blueprint`.

### 5. Rules move between blueprints with their history

```
walkdown rules move <rule|story|feature> --to <blueprint>
```

The rule's YAML moves into the same feature file in the destination, creating the file
if needed, with its statement, steps, hashes and acceptance unchanged. With it:

- **Threads** anchored to the moved rules move, keeping their ids, since §3 makes them
  unique within the project. Threads are a conversation, and a conversation has one place.
- **Run records** holding results for the moved rules are copied. Each copy keeps the
  original `run_id`, `created`, actor and metadata, and only the moved rules' results. It
  carries `copied_from: { blueprint, run, at }`.
  - The originals are not edited, since the ledger is append-only. Their results for
    rules the blueprint no longer holds are read by nothing, as with a retired rule.
- **Sweep markers** are copied whole, so a sweep that made a verdict stale still does.
- **Evidence** the copied records cite is copied, under the same logical keys.
- Every verdict a moved rule had, including signatures, reads the same in its new
  blueprint. Nothing is judged or signed again.

It refuses a destination outside the project, an id already used there, and a move with
an uncommitted rule change in either blueprint. It then says what moved: N rules, M
threads, K run records copied. ADR 0012 names this command's noun: `rules` joins
`blueprints`, `records` and `threads`.

### 6. Walkdown splits into `panel` and `cli`

Walkdown's 175 rules go where their checks run, which is ownership.evidence.same-surface
applied to blueprints:

- **`cli`** gets the rules about what a person meets at a terminal and what the records
  guarantee. That is all of `locations`, `delivery`, `status` and `ownership`, plus the
  headless stories of `threads`, `screens` and `time`. About 63 rules.
- **`panel`** keeps the rules with screens, the storyboard, `prototype/` and `as-built/`.
  About 112 rules.

The existing blueprint is `0001-walkdown`, and it becomes `panel`. Its id changes with
ADR 0012's `blueprints rename` when that lands; until then it keeps the id `walkdown`. A
story whose rules are split across the two surfaces is decided rule by rule, in the
move's dry run, for Topher to check.

Each blueprint gets its own `walkdown.yml`, `governance:` and storyboard. The repository's
tooling learns there are two:

- `tools/sitting.mjs` and `tools/scratch.mjs` take `--blueprint`.
- The Highball lint and agent-tier checks loop over both.
- CLAUDE.md names both.

### 7. The CLI's screens are its output, drawn as text

Each screen of `cli` is one moment at a terminal: a command, its fixture and its output.
Examples are `status-two-blueprints`, `writes-refused-among-several`, `init-another` and
`where-one-kind`.

- **Design (prototype side):** a page per screen showing the output as designed, as text
  in a terminal frame. Like the panel's prototype, it is the design and is never edited to
  match the build. A separate design agent draws it (ADR 0009, `design.by: agent`).
- **App (stand-in side):** `tools/cli-captures.mjs` runs each screen's command against its
  fixture in a scratch home and writes the real output into the same frame. That gives an
  as-built drawing (ADR 0007), served by walkdown's own server, which a screen's app side
  can already point at.
- **Steady output:** paths, dates, run ids and home numbers that differ on every run are
  replaced with fixed placeholders (`~/…/0002-b`, `2026-10-02T00-00-00Z`). The fade then
  shows what changed and nothing else.
- **Anchors:** a line or block in the output is an anchor, with the same `data-testid` on
  both sides. Examples are `cli.refusal`, `cli.status.section` and `cli.where.row`. The
  capture tool places them from patterns declared beside each screen. A rule can point at
  the exact line it is about, a pin can sit on it, and the agent tier compares text by
  anchor.

### 8. One description of a CLI scenario, used twice

The CLI already has a test suite: about forty `test/*.test.js` files spawn the binary
against scratch homes. Each builds its own fixture.

A scenario (fixture, command, expected exit code and expected lines) is written once in
`test/cli/scenarios/`. It is used twice:

- `test/cli.test.js` runs every scenario as a check, tagged with its rule.
- `tools/cli-captures.mjs` runs the same scenarios to draw the app side of each screen.

The picture a person judges and the check that records a pass then come from the same
run of the same command. New CLI rules, starting with ADR 0012's, are written as
scenarios. Existing tests move over when their rule is next touched, not in one sweep.

## Consequences

- New rules, for Topher's approval:
  - §1: results filed by rule, and `run` running the suite once.
  - §2: lint across the project.
  - §3: thread ids unique in a project.
  - §4: the pointer names every blueprint.
  - §5: `rules move`.
- One rewording, for Topher's approval: `locations.several.writes-name-one`, which listed
  `run`.
- The skills, `AGENTS.md` and docs/08 say how `--json` reads with several blueprints, and
  that writes take `--blueprint`.
- Walkdown's own split is done with `walkdown rules move`, as its first real use. The dry
  run goes to Topher before anything moves.
- Order of work:
  1. §1–§4, which unblock any project with several blueprints, Topher's work machine
     among them.
  2. §5.
  3. The split, §6.
  4. The CLI screens and scenarios, §7–§8.
  5. ADR 0012, built inside `cli`.
- It ships in 0.4.0 with ADRs 0011 and 0012.

## Decided on review

- **The CLI's design is drawn by a separate design agent** (`design.by: agent` in
  `cli`'s `walkdown.yml`), the same arrangement ADR 0009 made for the panel. Design
  requests on a CLI screen go to that agent's queue. The agent that builds the CLI
  never draws its own design, and Topher accepts the result when he walks the screen.
- **`rules move` ships** as a product command, not a tool for walkdown alone.

## Alternatives considered

- **One test suite per blueprint.** This was rejected. A project does not split its tests
  because it split its spec, and a test is often evidence for rules in both.
- **Copy every run record whole into the new blueprint.** This was rejected, because the
  new ledger would then hold verdicts for rules that are not its own. Filtered copies hold
  only what applies.
- **Move run records instead of copying them.** This was rejected because the ledger is
  append-only. Removing results from the original blueprint edits its history.
- **Renumber threads so every id is unique.** This was rejected, because rule histories,
  commit messages and run records already cite the old ids.
- **Golden-file tests of the CLI's whole output.** This was rejected. An exact match on
  every line fails on wording nobody cares about, while the fade shows a person what
  changed and lets them judge.
- **Keep walkdown one blueprint and give the CLI rules screens there.** This was
  rejected because a blueprint that is two products confuses its own report. Splitting
  also makes walkdown the first project to live with several blueprints, which is how the
  six faults above were found.
