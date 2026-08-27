# walkdown — agent conventions

This project's spec lives in `blueprint/`: features, stories, and **rules**
(acceptance criteria), plus the storyboard (screens), threads (questions &
notes), and the runs ledger. The blueprint is the single source of truth for
*what to build*. Read this before building, testing, or reviewing.

## Before you build

- `walkdown status --json` gives per-rule verification state, drift, and your
  work queue: `attention` items with `who: "agent"`.
- A rule's plain-language `statement` is authoritative; its `steps` elaborate
  it. If they disagree, the statement wins. After editing any statement, run
  `walkdown hash --write` so staleness detection keeps working.
- If a rule is ambiguous, do not guess. File a question thread anchored to the
  rule/screen/element (`POST /api/threads` via `walkdown serve`, or write the
  YAML) and say what you assumed if you proceed.

## Ownership boundaries

- **Never edit `prototype/`** — design owns it. If the spec needs a screen that
  design hasn't drawn: set `prototype: null` on the storyboard screen, put a
  sketch under `proposals/` if a picture helps, and file a design-request
  thread anchored to the screen. Lint enforces this routing.
- The PRD is product's surface. Rules you introduce get
  `origin: thread:<id>` (or `walkdown`) so the drift report stays honest.

## Building

- Carry anchors **verbatim** from prototype to implementation. The attribute is
  `embed.anchor_attribute` in `blueprint/walkdown.yml` (default
  `data-testid`). Every element the spec references keeps its anchor.
- Reference screens and anchors by id — never URLs, never CSS selectors.
- Rules don't require screens: headless rules (API, CLI, jobs, policies) get the
  full ledger without the UI layer. But not every test deserves a rule — a rule
  is a behavior product would recognize as a requirement. Keep checks a small,
  meaningful subset of the test suite.

## Checks

- Write tests in this project's own framework and house style. Tag each with
  its rule id — Playwright: `{ tag: '@rule:<id>' }`; RSpec: `rule: "<id>"`
  metadata. One rule per test. Select by anchor (`getByTestId`), never CSS
  paths.
- Run with `WALKDOWN_ACTOR=agent walkdown run [--target <t>] [--rule <id>]` —
  the reporter/formatter appends the run record automatically.
- `walkdown lint` before you finish: coverage, staleness, storyboard refs,
  thread hygiene.

## Threads

- Work your queue: `address` open notes; `incorporate` answered questions —
  fold the answer into the rule's statement/steps, then mark the thread.
- Mutate threads only through `walkdown thread <id> --actor agent
  --reply "..." --status <s>` — never raw YAML edits — so transitions stay
  validated.
- After fixing what a note asks: reply with what you changed and which run
  re-verified it, then `--status addressed`.
- You may **never** set `verified` or `waived`. Those are human judgments —
  you claim work; a person accepts it.

## Quick reference

    walkdown status [--json]        derived verification + queues + drift
    walkdown status <rule-id>       one rule in full
    walkdown status --retired       rules withdrawn from the report, and why
    walkdown status --retired       rules withdrawn from the report, and why
    walkdown lint                   validate everything
    walkdown hash --write           re-stamp statement hashes
    walkdown run [--target] [--rule]  run checks, record the run
    walkdown threads [--rule <id>]  active questions & notes
    walkdown thread <id> [...]      view / reply / transition
    walkdown serve                  panel + embed + pin/walkdown APIs

## Procedures

Multi-step rituals are encoded as Claude Code skills in `.claude/skills/`
(installed by `walkdown init`): **walkdown-judge** (agent walkdown — visual
judgment with evidence and a run record), **walkdown-incorporate** (fold
answered questions into the blueprint; address notes), **walkdown-formulate**
(turn a design/PRD into storyboard + rules + checks). Prefer them over
improvising the procedure.
