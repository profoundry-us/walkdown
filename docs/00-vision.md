# 00 — Vision

## The problem

We have a good tool for designing (Claude Design → HTML prototypes) and a good tool for
building (Claude Code). What's missing is the layer between them: a durable, verifiable
statement of **what we're actually supposed to build**. Without it:

- Product and engineering drift out of alignment, and nobody notices until review.
- AI builder agents build *most* of the pieces and quietly miss the rest, because nothing
  enumerates "all the pieces."
- Verification is ad-hoc: screenshots, eyeballing, and tribal memory.

## The thesis

**The blueprint is the single source of truth for "what are we building," and everything
else is a projection of it.** Every design decision in this repo follows from keeping four
surfaces in sync with that hub:

1. **The PRD** (Notion) — an *input*. Extracted from on demand; never live-synced.
2. **The prototype** (Claude Design / Figma export) — an *input* and a *reference surface*
   for walkdowns.
3. **The built application** — verified against the blueprint, in dev and staging.
4. **The test suite** — the project's own integration tests, linked to blueprint rules by
   tags. Walkdown never owns tests; see [03-runner-contract.md](03-runner-contract.md).

## Principles

**Files are the source of truth; the web app is a lens.** The blueprint lives as YAML/JSON
files in the project repo. Agents interact with it via file tools and a CLI — no API, no
auth, no export step. The viewer is a local server (`walkdown serve`) rendering those same
files in the Claude Desktop browser pane, writing edits back to them. A hosted multi-user
layer is an explicit *later*, built on top of the file format, never a replacement for it.

**Criteria are the interface; tests are a pluggable implementation.** Rules are written in
the blueprint; checks are the team's own tests in the team's own framework, tagged with
rule IDs. Walkdown shells out to run them and ingests results. The builder agent writes
tests in the project's native dialect (RSpec workflow specs, Playwright TS, …) following
per-project instructions, so there is no shadow test suite to drift.

**Plain language is authoritative.** Each rule has a human statement (canonical) and
agent-facing technical steps (derived, regenerable, hash-stamped for staleness detection).
When they diverge, the statement wins.

**Status is derived, never stored.** Verification results live in an append-only run
ledger. A rule's status is a query ("latest run against staging", "latest walkdown"),
never a field someone forgets to update. See [05-runs-ledger.md](05-runs-ledger.md).

**Extraction is a merge, not an export.** Re-extracting from an updated PRD or prototype
proposes a diff against existing blueprint items (IDs are stable, assigned once). A human
approves the diff. This is what keeps feedback pins, checks, and run history attached
through spec evolution.

**Knowledge must land in the blueprint.** Questions (from agents or humans) and feedback
notes are first-class threads anchored to rules/screens/elements, but their lifecycle ends
at *incorporated* — the answer gets folded into the rule's statement or steps. The thread
remains as provenance; the rule is where the knowledge lives.

**Every projection has one owner.** Design owns the prototype, product owns the PRD,
engineering owns the app and its checks — and nobody writes into another's surface.
When the spec outruns a source, the gap is recorded (drift report), routed (a request
thread in the owner's queue), and optionally illustrated (a clearly-badged proposal) —
never silently patched by whoever noticed. This is what keeps the blueprint politically
viable: it coordinates the owners without overruling them.

**Stay inside Claude Code.** Every workflow — authoring, building, running checks,
reviewing feedback, performing a walkdown — must be possible without leaving Claude
Code/Desktop: file edits and CLI for agents, the browser pane for humans.

## The core loop

1. **Formulate.** `walkdown extract` reads the Notion PRD and the prototype, proposes
   blueprint features/stories/rules and a storyboard of screens. Human reviews the diff.
2. **Build.** The builder agent reads the blueprint, builds the app, carries anchor
   attributes (`data-testid` by default) from the prototype into the implementation, and
   writes checks in the project's own test framework tagged with rule IDs.
3. **Run.** `walkdown run --target local|staging` executes linked checks and appends a run
   record. CI can do the same.
4. **Walk down.** An agent walkdown pre-screens judgment rules (comparing app against
   prototype via the storyboard); then a human steps through rules in the viewer, with
   prototype and app deep-linked side by side and the embed pinning notes to real
   elements. Both sessions land as walkdowns in the same ledger; only the human's verdict
   satisfies a `human` verify requirement.
5. **Close the loop.** Agents consume notes and questions (anchored to exact elements),
   fix, re-run, and fold answers back into rules.

## v1 scope

- Blueprint schema + file layout ([02](02-blueprint-schema.md))
- CLI: `init`, `status`, `lint`, `run`, `serve`, `extract`
- Runner contract with JUnit ingestion + one native adapter (RSpec formatter)
  ([03](03-runner-contract.md))
- Embed script + anchor convention (test-id reuse); feedback/questions written to the local server
  ([04](04-embed-and-anchors.md))
- Viewer with rule list, derived status, storyboard navigation, side-by-side mode
- Run ledger with multi-target runs and human walkdowns ([05](05-runs-ledger.md))

## Explicit non-goals for v1

- **Hosted/multi-user backend.** The staging-to-localhost embed trick
  ([04](04-embed-and-anchors.md)) keeps even staging verification backend-free. A hosted
  receiver is the v2 trigger.
- **Bidirectional Notion/Figma sync.** Extract-and-diff only.
- **Screenshot-comparison workflows.** Element-level anchoring supersedes them.
- **Automated deep-state setup.** The storyboard schema reserves a `setup` field per
  screen, but v1 only guarantees deep-linking to URL-reachable screens.
- **Owning any test framework.** Ever.

## First milestone (before building any tooling)

Exercise the schema end-to-end **by hand** on one small feature:

1. Write one feature file and a storyboard manually.
2. Annotate a Claude Design prototype with anchor attributes (`data-testid`).
3. Have Claude Code build the feature and one tagged check (in RSpec or Playwright).
4. Record one run and one fake note thread as raw files.
5. Read it all back and ask: does the loop feel right in raw files?

If yes, the viewer and CLI are progressive enhancement on something already working.

## Release

- npm package: `walkdown` (verified available 2026-08-20), plus the `@profoundry` scope
  for adapters (e.g. `@profoundry/walkdown-rspec`).
- Domains: `walkdown.io`, `walkdown.dev`, `walkdown.build`, `walkdown.tools` (all verified
  available 2026-08-20; register before publicizing).
