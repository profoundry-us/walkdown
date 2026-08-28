# 00 — Vision

## The problem

We have a good tool for designing (Claude Design → HTML prototypes) and a good tool for
building (Claude Code). What's missing is the layer between them: a durable, verifiable
statement of **what we're actually supposed to build**. Without it:

- Product and engineering drift out of alignment, and nobody notices until review.
- AI builder agents build *most* of the pieces and quietly miss the rest, because nothing
  enumerates "all the pieces."
- Verification is ad-hoc: screenshots, eyeballing, and tribal memory.

## The problems

Those three bullets are the symptom. Underneath them are nine problems a team actually
has. Every feature in this repo exists to serve one of them, and they are written as
problems rather than as features so the list survives the tool changing shape.

1. **Remembering what we agreed to build.** A developer is handed a PRD and a prototype,
   both usually vague, and then builds for weeks. What was agreed and what is left lives
   in memory and in a ticketing system detached from the code — so nothing can answer
   "does the application have the features we asked for, and do they work?"
2. **Noticing when the PRD or the prototype moves.** Sources change mid-build. Without a
   record of what changed, the spec and the sources part company quietly.
3. **Giving an agent something deterministic to build against.** Agents work well from an
   enumerated set of well-formed criteria and badly from a Notion page and a screenshot.
4. **Remembering why a decision was made.** Months later, "why doesn't this match the
   prototype?" has an answer that lives only in whoever was in the room.
5. **Seeing how closely the build matches the design.** Comparison wants the two surfaces
   in the same place at the same viewport, with feedback that lands on an element rather
   than in a document.
6. **Letting design record changes and have them made.** A designer pairing with someone
   should be able to record what should change and hand it off — before any application
   exists.
7. **A QA pass at the end that is more than eyeballing.** Every rule checked, by the
   cheapest tier that can honestly check it, with a person accepting the result.
8. **Feeding the work-tracking the team already has.** Tickets and technical design
   documents are downstream artifacts; they should be derivable rather than re-typed.
9. **Saying what is in this phase and what is not.** A blueprint covering a year is not a
   plan for a quarter.

### The tiers are a ladder, and each rung buys the next one's attention

Problem 7 says "the cheapest tier that can honestly check it", which is half of it. The
other half is why anyone would run three tiers instead of one: **each tier exists to earn
the right to spend the next tier's attention.**

- **Checks** run constantly and cost nothing per run. They answer one question — *did we
  break something we already knew about?* — and they answer it in seconds.
- **The agent walkdown** is QA, and it is what earns a person's time. Nobody should open
  a board where ten of fifteen rules are failing; a developer wants a mostly-green agent
  pass first, and an agent that finds otherwise should go back and work until it is close.
  Crucially the agent is a stranger to the app, using what a person would use: it reads
  the rule, opens the application, and tries. **If it gets confused, that is the finding.**
  A QA pass whose failures only ever mean "the script broke" is not QA.
- **A person** accepts the result. That is the scarcest thing in the process, which is the
  whole reason the first two rungs exist.

The ladder is also why the agent tier must not become a second check suite. Checks walk
the DOM by anchors, deterministically, because that is what catches regressions. An agent
that did the same thing would cost more and learn less. It gets the rule in plain language
and a browser, and it does not save a script to replay next time — a memorised path is not
a walkthrough, and a stranger who already knows the way cannot tell you the way is hard to
find.

Which of these are solved, half-solved, or deliberately left alone is a moving target and
lives in [07-roadmap.md](07-roadmap.md) — kept out of this document on purpose, because a
status that goes stale inside a vision document is what stops the vision from being read.

## The thesis

**The blueprint is the single source of truth for "what are we building," and everything
else is a projection of it.** Every design decision in this repo follows from keeping four
surfaces in sync with that hub:

1. **The PRD** (Notion) — an *input*. Extracted from on demand; never live-synced.
2. **The prototype** (Claude Design / Figma export) — an *input* and a *reference surface*
   for walkdowns.
3. **The built application** — verified against the blueprint, in dev and staging.
4. **The test suite** — the project's own integration tests, linked to blueprint rules by
   tags. walkdown never owns tests; see [03-runner-contract.md](03-runner-contract.md).

## Principles

**Files are the source of truth; the web app is a lens.** The blueprint lives as YAML/JSON
files in the project repo. Agents interact with it via file tools and a CLI — no API, no
auth, no export step. The panel is served by a local server (`walkdown serve`) and renders
those same files in the browser beside the page under review, writing edits back to them.
A hosted multi-user layer is an explicit *later*, built on top of the file format, never a
replacement for it.

**Criteria are the interface; tests are a pluggable implementation.** Rules are written in
the blueprint; checks are the team's own tests in the team's own framework, tagged with
rule IDs. walkdown shells out to run them and ingests results. The builder agent writes
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

**Meet the work where it runs.** Agents author, build, and run checks from file edits
and the CLI — that half never needed a UI. Humans review in **the browser, beside the
running application**, and walkdown **frames the page inside its own document** — because
only a frame boundary is real isolation. The app's modals lay out against the frame
instead of covering walkdown, the `inert` a native `<dialog>` imposes stops at the
frame's edge, and the extension strips the frame-refusal headers (session-scoped, per
reviewed tab) so even pages that forbid framing render.

There was a second layout, docked into the application's own document and delivered by a
script tag. It cost one line and no install, which is a real advantage — and it was
withdrawn anyway, because everything the frame boundary gives you it had to fight for:
climbing into the browser's top layer to stay above the app's modals, resetting the
inheritable CSS the host bled into our shell, insetting somebody else's body and putting
it back. One layout is not a compromise here; it is the one that does not have to
defend itself.

This principle used to read "stay inside Claude Code", and an earlier viewer honoured it
by framing prototype and app side by side inside one local page. What retired it was the
layout, not the frame: two half-width panes shortchange both surfaces, and a page that
could be neither framed nor injected into was out of reach entirely. The extension
resolves both — and nothing about it is a move away from Claude. The panel is a web page
like any other, and the browser pane renders it (Chromium, verified). If Claude gains
extension support, the same extension loads there and the two stories become one again.
The tool's own surfaces stay web pages precisely so that stays possible.

## The core loop

1. **Formulate.** `walkdown extract` reads the Notion PRD and the prototype, proposes
   blueprint features/stories/rules and a storyboard of screens. Human reviews the diff.
2. **Build.** The builder agent reads the blueprint, builds the app, carries anchor
   attributes (`data-testid` by default) from the prototype into the implementation, and
   writes checks in the project's own test framework tagged with rule IDs.
3. **Run.** `walkdown run --target local|staging` executes linked checks and appends a run
   record. CI can do the same.
4. **Walk down.** An agent walkdown pre-screens judgment rules (comparing app against
   prototype via the storyboard); then a human steps through rules in the panel beside
   the live app, fading the prototype ghost over it to compare, with the embed pinning
   notes to real elements. Both sessions land as walkdowns in the same ledger; only the
   human's verdict satisfies a `human` verify requirement.
5. **Close the loop.** Agents consume notes and questions (anchored to exact elements),
   fix, re-run, and fold answers back into rules.

## v1 scope

- Blueprint schema + file layout ([02](02-blueprint-schema.md))
- CLI: `init`, `status`, `lint`, `run`, `serve`, `extract`
- Runner contract with JUnit ingestion + one native adapter (RSpec formatter)
  ([03](03-runner-contract.md))
- Embed script + anchor convention (test-id reuse); feedback/questions written to the local server
  ([04](04-embed-and-anchors.md))
- **The panel**: walkdown's chrome around the running app, wearing its own skin so it is
  never mistaken for the thing under review. The app lies as a sheet on walkdown's desk,
  framed so it keeps a real viewport of its own; the prototype ghosts over it on demand
  rather than taking half the window.
- Run ledger with multi-target runs and human walkdowns ([05](05-runs-ledger.md))

## Delivery

| Surface | How walkdown gets there |
|---|---|
| Any page at all | The browser extension: it frames the page inside walkdown's own document. The one supported way to get the panel. |
| Prototype screens | The design tool emits the embed tag in every export, so a design page is pinnable on its own. |
| Your own dev app | The embed tag, gated on env, when you want pins anchored to your own elements inside the frame. |
| Production | Never. |

**One panel delivery, as of 2026-08-26.** A second one docked the panel *into* the
application's document — one script tag, no install for the reviewer. It was withdrawn
because the two layouts were not equal: framed, the app cannot paint over the tool, its
modals lay out against the frame rather than the window, and `inert` stops at the frame's
edge. Docked spent eleven rules and the most defensive code in the project on surviving
inside somebody else's document, and the reviewers who would have benefited never
arrived. The embed still travels by script tag; only the panel's second layout is gone.

The extension removes the *injection* barrier, not the *anchor* barrier: on a page that
carries no anchors, pins fall back to coordinates and feedback still lands, but element
-precise anchoring always needs the application to carry the anchors.

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

If yes, the panel and CLI are progressive enhancement on something already working.

## Release

- npm package: `walkdown` (verified available 2026-08-20), plus the `@profoundry` scope
  for adapters (e.g. `@profoundry/walkdown-rspec`).
- Domains: `walkdown.io`, `walkdown.dev`, `walkdown.build`, `walkdown.tools` (all verified
  available 2026-08-20; register before publicizing).
