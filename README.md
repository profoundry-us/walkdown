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

## Status

Pre-implementation. These docs are the design. The first milestone is a manual end-to-end
exercise of the schema on one small feature before any tooling is built
(see [00-vision.md](docs/00-vision.md), "First milestone").
