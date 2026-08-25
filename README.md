# walkdown

**Verify that what you built is what you designed.**

walkdown is the integration layer between design prototypes (Claude Design, Figma) and
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
- The **panel** renders it beside the page under review, and the **embed** lets humans
  and agents pin feedback and questions to real elements on real screens.

Both audiences work in the same place: agents read and write blueprint files with
ordinary file tools inside Claude Code; humans review in the browser, with walkdown's
panel riding beside the running app and rendering those same files.

## Documentation

| Doc | Contents |
|---|---|
| [00-vision.md](docs/00-vision.md) | Problem, thesis, principles, v1 scope and non-goals |
| [01-glossary.md](docs/01-glossary.md) | The vocabulary — every term, one meaning |
| [02-blueprint-schema.md](docs/02-blueprint-schema.md) | Entities, file layout, IDs, dual representation |
| [03-runner-contract.md](docs/03-runner-contract.md) | How any test framework plugs in (linkage, execution, results) |
| [04-embed-and-anchors.md](docs/04-embed-and-anchors.md) | The anchor convention (test-id reuse), embed script, the docked and framed panel layouts |
| [05-runs-ledger.md](docs/05-runs-ledger.md) | Verification runs, walkdowns, derived status |

## CLI

The first tooling slice — the two commands the hand-run milestone showed matter most:

```
walkdown init [--dir <project-root>]
walkdown run [--target <name>] [--rule <id>]
walkdown status [<rule-id>] [--dir <blueprint>] [--target <name>] [--json]
walkdown lint [--dir <blueprint>] [--no-checks] [--json]
walkdown hash [--dir <blueprint>] [--write]
walkdown threads [--rule <id>] [--all] [--json]
walkdown thread <id> [--json]
```

`init` scaffolds `blueprint/` in a project — config and storyboard templates, a
feature template, and **`blueprint/AGENTS.md`**: the conventions any AI agent working
in the repo follows (read the blueprint first, carry anchors, tag checks with rule
ids, work the agent queue, claim-never-accept, never touch `prototype/`), with a
pointer added to CLAUDE.md. It also installs three **Claude Code skills** into
`.claude/skills/` (skip-if-exists, so customized copies survive re-runs):
`walkdown-judge` (the agent-walkdown ritual — evidence screenshots, judgment,
run record, fail threads), `walkdown-incorporate` (fold answered questions into
the blueprint; address notes), and `walkdown-formulate` (turn a design/PRD into
storyboard + rules + checks). AGENTS.md carries the knowledge; skills carry the
procedures. `run` executes the project's checks through the runner
contract — `run_all`, or `run_for_rule` with `--rule` — injecting the target's env
and `WALKDOWN_TARGET`, and confirms which run record the reporter appended.

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

## walkdown serve — the panel and its APIs

`walkdown serve` starts the local server (default port 4700, `127.0.0.1` only):

- **The panel** — served as `/panel.js` (with `/embed.js` and `/walkdown.css` beside
  it). A script tag docks it into a dev page you control; the browser extension
  ([extension/](extension/)) loads the same files and frames any other page inside
  walkdown's own document. The prototype is mounted at `/prototype/`, and picking a
  rule takes the surface under review to that rule's screen via the storyboard.
- **The stand-in app** — for screens with no running page to point at (the thing being
  built is chrome, or is not built yet), an app path of `/stand-in/<screen-id>` serves
  that screen's own design back as the app — different theme, ringed edge, corner label
  — so fading, ghosting and pinning on the app surface all work. It is not evidence:
  what it shows is the design.
- **Pin mode** — with the embed snippet in a page (`<script
  src="http://localhost:4700/embed.js" data-walkdown data-bp="example/blueprint">`),
  clicking a real element pins a note or question to its anchor; the thread lands in
  `blueprint/threads/` with rule, screen, element, and author attached. **Escape** leaves
  pin mode (closing an open form first), as does clicking the badge again. Standalone
  pages (opened without the panel) resolve their screen from the URL and post to the
  same server — including HTTPS staging pages, via the Private-Network-Access preflight.
  `data-bp` names the project when one server hosts sibling blueprints; omit it and pins
  file against whichever blueprint `walkdown serve` started in.
- **Human walkdowns** — Start walkdown (your name arrives from git identity), judge
  rules, Finish: the session is appended to `blueprint/runs/` as a hash-stamped
  `kind: walkdown` record, satisfying `human` verify requirements. A feedback box rides
  above the verdict buttons — anything written is filed as a note thread on the rule
  and linked into the run result, and a **fail is refused until it has a why** (the
  note, or a pin dropped during the session; failing arms pin mode so the note lands
  where the problem is). Rules with no build evidence show **Approve / Refine** instead
  of Pass / Fail — sign-off on the spec, recorded as `approved`/`refining`, never
  counted as verification. Each verdict is written to `blueprint/drafts/` the moment it
  is given, so an unfinished sitting survives a reload or a closed browser and shows up
  in `walkdown status` as in progress; the ledger still gains exactly one record, at
  Finish, which deletes the draft. Drafts are working state — the directory ignores its
  own contents.
- **Threads read as conversations** — a thread is one stream of messages (the opening
  note is simply the first), with initials, times, consecutive messages grouped under
  one name, a line marking what arrived since you last looked, and a standing composer
  where **Enter** sends and the reply appears before the server answers. Append-only by
  design: no editing, no deleting, and no reactions standing in for a verdict.
- **Thread lifecycle** — clicking a pin or a thread opens it: body, replies, and the
  actions its state allows (Reply / Mark addressed / ✓ Verify / Reopen / Waive; Answer
  and Mark incorporated for questions). Transitions are validated server-side; `verified`
  and `waived` require a named human — agents claim work (`addressed`), never accept it.
  The same mutations are available from the terminal:
  `walkdown thread n-0002 --actor agent --reply "fixed in run …" --status addressed`,
  then `walkdown thread n-0002 --verify` as yourself.

## Styling — Tailwind CSS + daisyUI

Every surface walkdown draws (the panel, the embed's pins and ghost, the prototype
wireframes, the example app) is styled with **Tailwind CSS 4 + daisyUI 5**, built ahead of time
into a single `lib/viewer/walkdown.css` that is committed and shipped in the package.
Installing walkdown still runs no build and pulls no CSS toolchain: `tailwindcss` and
`daisyui` are **devDependencies**, and `yaml` remains the only runtime dependency.

```bash
npm run build:css     # rebuild lib/viewer/walkdown.css from styles/walkdown.css
npm run watch:css     # …and keep rebuilding while you work on the UI
```

`build:css` also drops a copy at `example/app/walkdown.css`: the example is meant to
behave like a real application, and a real application ships its own stylesheet rather
than fetching one from a dev tool. Prototype screens do borrow walkdown's copy over
`http://localhost:4700/walkdown.css`, right beside the `embed.js` tag they already
depend on.

Two themes ship in that stylesheet. `light` is the default and dresses the panel and
example apps. **`wireframe`** dresses the prototype screens — a mockup wears
`<html data-theme="wireframe">` so it reads as a drawing rather than as a build, which
is exactly the distinction a walkdown is judging. Any element can pin either theme with
`data-theme`, so a prototype can be previewed in the real skin without editing it.

The docked panel is the one surface that needed care: it is injected into somebody
else's running application, where Tailwind's preflight would restyle *their* buttons
and their stylesheet would restyle ours. So the panel renders inside a **shadow root**
with the stylesheet scoped to it. The single exception is the sheet's `@property`
rules, which the CSS Properties API only registers at document level; the panel copies
just those into the host page, where they declare custom-property types and paint
nothing. `embed.js` keeps its own dozen lines of scoped CSS — pin markers are
positioned against host elements and have no business carrying a design system.

## walkdown's own blueprint

walkdown is specified with itself: [blueprint/](blueprint/) holds the tool's own
rules (starting with thread-lifecycle governance), verified by the repo's node:test
suite — tests tagged by name (`... @rule:<id>`), recorded by the **node:test
reporter** (`walkdown/node-reporter`, the third emitter alongside Playwright and
RSpec). `walkdown run` here runs the tool's checks through its own runner contract.
`docs/` remains the design (why); `blueprint/` is the verifiable what.

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
(panel, embed, pins, human walkdowns). The v1 scope from
[00-vision.md](docs/00-vision.md) is complete except `extract` (PRD/prototype →
blueprint merge). Publishing (npm `walkdown` + `@profoundry` scope, RubyGems
`walkdown-rspec`) is the next step before sharing.

