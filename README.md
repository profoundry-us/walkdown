# Walkdown

**Verify that what you built is what you designed.**

Walkdown is the integration layer between design prototypes (Claude Design, Figma) and
AI-built applications (Claude Code). It extracts a product's intent into a **blueprint** —
a versioned, file-based specification of features, stories, and rules — then tracks whether
the built application actually satisfies that intent, through the project's *own* test suite
and through judgment-based verification sessions called **walkdowns** — performed by AI
agents as a screening tier, and by humans as the final word.

The name comes from engineering practice: a *walkdown* is when engineers physically walk a
job site to verify that construction matches the drawings.

## The thesis

The blueprint is the hub. Everything else is a projection of it:

- The **PRD** (Notion) and **prototype** (Claude Design / Figma) are *inputs* — extracted
  from, never synced to.
- The **built app** is verified *against* it.
- The **test suite** (the project's own — RSpec workflow specs, Playwright, anything) is
  linked *to* it via lightweight tags.
- The **viewer** renders it, and the **embed** lets humans and agents pin feedback and
  questions to real elements on real screens.

Both audiences work in the same place: agents read and write blueprint files with ordinary
file tools inside Claude Code; humans use a local web viewer (in the Claude Desktop browser
pane) that renders those same files.

## Documentation

| Doc | Contents |
|---|---|
| [00-vision.md](docs/00-vision.md) | Problem, thesis, principles, v1 scope and non-goals |
| [01-glossary.md](docs/01-glossary.md) | The vocabulary — every term, one meaning |
| [02-blueprint-schema.md](docs/02-blueprint-schema.md) | Entities, file layout, IDs, dual representation |
| [03-runner-contract.md](docs/03-runner-contract.md) | How any test framework plugs in (linkage, execution, results) |
| [04-embed-and-anchors.md](docs/04-embed-and-anchors.md) | The anchor convention (test-id reuse), embed script, side-by-side viewer |
| [05-runs-ledger.md](docs/05-runs-ledger.md) | Verification runs, walkdowns, derived status |

## CLI

The first tooling slice — the two commands the hand-run milestone showed matter most:

```
walkdown status [<rule-id>] [--dir <blueprint>] [--target <name>] [--json]
walkdown lint [--dir <blueprint>] [--no-checks] [--json]
walkdown hash [--dir <blueprint>] [--write]
walkdown threads [--rule <id>] [--all] [--json]
walkdown thread <id> [--json]
```

`threads` lists active questions and notes (newest first, with anchors and a body
preview); `--all` includes resolved ones. `thread <id>` shows one in full — anchor,
body, and replies. The status table shows at most two thread refs per rule and
truncates with `+N`; `threads --rule <id>` is the full list.

`status` renders the derived per-rule verification table straight from the runs ledger:
latest checks per target, latest agent and human walkdown verdicts, open threads, and a
per-rule verdict (verified / pending / failing — exit 1 on any failure). A pass recorded
against an older statement (per-result `statement_hash`) renders as `~ stale`, never as
passing. The table is followed by an active-threads digest (truncated bodies, capped at
six). With a rule id (`walkdown status waitlist.join.visual-match`), shows that rule in
full: statement, each evidence source's latest result with run provenance and evidence
paths, and every thread anchored to it. `--json` is the agent-facing form.

`lint` validates the blueprint end to end: schema and duplicate IDs, storyboard
screen/anchor references (including anchors mentioned in steps), statement-hash staleness,
check coverage via the project's own `runner.list` command, stale check comments, thread
lifecycles (`answered`-but-not-incorporated, `waived` without `waived_by`), and run
records. Errors exit 1; warnings don't.

`hash` reports `statement_hash` status per rule; `--write` repairs missing/stale hashes
in place, preserving YAML formatting. Hashes are sha256 of the whitespace-normalized
statement, stored truncated (`sha256:` + 12 hex).

## walkdown serve — the viewer

`walkdown serve` starts the local server (default port 4700, `127.0.0.1` only):

- **Viewer** at `/` — the status board, rule detail, and prototype/app **side by side**
  (the prototype is mounted at `/prototype/`; the app iframe points at the local
  target's `base_url`). Clicking a rule navigates both surfaces via the storyboard.
- **Pin mode** — with the embed snippet in a page (`<script
  src="http://localhost:4700/embed.js" data-walkdown>`), clicking a real element pins a
  note or question to its anchor; the thread lands in `blueprint/threads/` with rule,
  screen, element, and author attached. Standalone pages (opened outside the viewer)
  resolve their screen from the URL and post to the same server — including HTTPS
  staging pages, via the Private-Network-Access preflight.
- **Human walkdowns** — enter your name, Start walkdown, judge rules Pass/Fail, Finish:
  the session is appended to `blueprint/runs/` as a hash-stamped `kind: walkdown`
  record, satisfying `human` verify requirements.

## Playwright reporter

The write side of the loop: add `['walkdown/reporter']` to a project's Playwright
`reporter` array and every `npx playwright test` run appends a run record to
`blueprint/runs/` — per-rule results aggregated from `@rule:` tags, current
`statement_hash` stamped (so future staleness is detectable), failure screenshots as
evidence, and git provenance (`<sha>-dirty` on an unclean tree). `WALKDOWN_TARGET` and
`WALKDOWN_ACTOR` set the target/actor (defaults: `local`, and `ci` under CI or the OS
username otherwise). The reporter never fails a test run.

Run `npm test` for the suite. The [example](example/) is both the schema demo and the
integration fixture: `node bin/walkdown.js lint --dir example/blueprint`.

## Status

Design docs + first milestone (a hand-run of the schema in [example/](example/)) +
`lint`/`hash`/`status`/`threads` tooling + run-record emitters for both ecosystems:
the Playwright reporter (`walkdown/reporter`) and the RSpec formatter
([adapters/rspec/](adapters/rspec/), with its own fixture suite) + `walkdown serve`
(viewer, embed, pins, human walkdowns). The v1 scope from
[00-vision.md](docs/00-vision.md) is complete except `extract` (PRD/prototype →
blueprint merge). Publishing (npm `walkdown` + `@profoundry` scope, RubyGems
`walkdown-rspec`) is the next step before sharing.
