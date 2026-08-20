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
walkdown status [--dir <blueprint>] [--target <name>] [--json]
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
passing. `--json` is the agent-facing form.

`lint` validates the blueprint end to end: schema and duplicate IDs, storyboard
screen/anchor references (including anchors mentioned in steps), statement-hash staleness,
check coverage via the project's own `runner.list` command, stale check comments, thread
lifecycles (`answered`-but-not-incorporated, `waived` without `waived_by`), and run
records. Errors exit 1; warnings don't.

`hash` reports `statement_hash` status per rule; `--write` repairs missing/stale hashes
in place, preserving YAML formatting. Hashes are sha256 of the whitespace-normalized
statement, stored truncated (`sha256:` + 12 hex).

Run `npm test` for the suite. The [example](example/) is both the schema demo and the
integration fixture: `node bin/walkdown.js lint --dir example/blueprint`.

## Status

Design docs + first milestone (a hand-run of the schema in [example/](example/)) +
`lint`/`hash`/`status` tooling. Next slices: run-record emission (native
RSpec/Playwright formatters), `serve` (viewer + embed).
