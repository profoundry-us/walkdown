# 02 — Blueprint schema

## File layout

```
blueprint/
  walkdown.yml          # project config (see 03-runner-contract.md)
  storyboard.yml        # screen registry
  features/             # edit-in-place documents (human/agent authored)
    checkout.yml
    onboarding.yml
  runs/                 # append-only ledger (machine appended; see 05-runs-ledger.md)
    2026-08-20T14-12-03Z-staging.json
  threads/              # append-mostly notes & questions
    q-0042.yml
    n-0017.yml
```

Design rationale:

- **Small files per feature** minimize merge conflicts and keep PR diffs legible.
- **Edit-in-place documents** (`features/`, `storyboard.yml`) are YAML — human-friendly,
  comment-capable. **Machine-appended records** (`runs/`) are JSON — one new file per run,
  so a run never conflicts with anything.
- A generated rollup (`.walkdown/blueprint.lock.json`, git-ignored) can serve consumers
  that want the whole picture in one read; it is always derivable and never authored.

## Entities

```
Feature 1─* Story 1─* Rule *─* Screen (via storyboard IDs)
                        │
                        ├── Checks   (pointers into the project's own test suite)
                        ├── Threads  (notes & questions anchored to it)
                        └── Results  (per-rule entries inside run records)
```

## Feature file

```yaml
# blueprint/features/checkout.yml
feature: checkout
title: Guest checkout
source:
  prd: https://notion.so/acme/Guest-Checkout-PRD-abc123      # provenance, not sync
  prototype: claude-design/checkout-v2
stories:
  - id: checkout.guest
    title: Guest completes a purchase
    statement: As a guest, I can buy without creating an account.
    rules:
      - id: checkout.guest.email-required
        statement: A guest must provide a valid email before payment is attempted.
        verify: [checks]           # required evidence: checks | agent | human (all listed required)
        screens: [checkout-payment]
        environments: [local, staging]   # where this rule is verifiable (default: all)
        steps:
          statement_hash: "sha256:9b2f…"   # of `statement` at generation time
          given:
            - A cart containing one item, with no signed-in user
          when:
            - Visit screen `checkout-payment`
            - Leave anchor `checkout.email` blank
            - Click anchor `checkout.submit`
          then:
            - An error is visible at anchor `checkout.email-error`
            - No payment request is issued

      - id: checkout.guest.visual-summary
        statement: The order summary matches the prototype's layout and hierarchy.
        verify: [agent, human]     # not scriptable; agent pre-screens, human confirms
        screens: [checkout-payment]
```

### Rules about rules

- **`origin`** records where a rule came from: `prd`, `prototype`, `thread:<id>`
  (incorporated from a question or note), or `walkdown`. Any origin other than the
  source documents means the spec is *ahead of its sources* — surfaced in the drift
  report (`walkdown status`), never silently.

- **IDs are dot-path slugs** (`feature.story.rule-slug`), assigned once, **never
  regenerated**. Rewording a statement keeps the ID. Splitting a rule creates new IDs and
  retires the old one (`superseded_by:`) rather than reusing it. Everything downstream —
  checks, threads, run results — keys off these IDs.
- **The statement is canonical.** Steps are derived (usually agent-written) and carry
  `statement_hash`. `walkdown lint` flags a rule whose hash no longer matches its
  statement: the steps are stale and must be regenerated or re-approved.
- **`verify`** lists the evidence required to establish "done" — every listed type must
  have a passing latest result. Three evidence types:
  - `checks` — deterministic tests in the project's own suite
    ([03-runner-contract.md](03-runner-contract.md)).
  - `agent` — AI judgment: an agent performs a walkdown session against this rule,
    comparing app to prototype via the storyboard and anchors, and records a verdict with
    evidence (screenshots, reasoning). Cheap and repeatable, but nondeterministic — it is
    a screening tier, and it never satisfies a `human` requirement.
  - `human` — a person's verdict from a walkdown session. Authoritative for judgment
    rules; only a human run can satisfy it.

  Default is `[checks]`. This is honest about the fact that visual fidelity, copy tone,
  and feel are not Playwright-testable — such rules declare `[agent]`, `[human]`, or
  `[agent, human]` (agent pre-screens so humans only walk what already looks right).
- **`environments`** scopes where checks are expected to pass — a check written against
  seeded local fixtures may legitimately not run against staging's real data. A failure
  outside a rule's environments is reported as `skipped`, not `fail`.
- Steps reference **screens and anchors by ID only** — never URLs, never CSS selectors.
  This is what makes them portable across prototype and app, and what makes generated
  checks resilient.
- **The screen progression is derived from the steps, never declared twice.** `screens:`
  is an unordered set used for linting and coverage; the steps mention screens in
  traversal order, and tooling reads that progression directly. The panel renders the
  flow (`waitlist-join → waitlist-confirm`) and deep-links to the **last** screen the
  steps mention — where the flow ends is where the outcome is observable (a
  "visitor sees a confirmation" rule ends on the confirmation screen; a "visitor
  *remains* on the form" rule ends on the form — both correct with no authoring
  convention). Rules without steps fall back to the first listed screen.

### Headless rules

Rules don't require screens. A rule with no `screens` is a **headless rule** — an API
behavior, CLI contract, background job, or policy. For these, walkdown is deliberately
"BDD with a ledger": the statement stays authoritative and product-readable, coverage
lint still finds untested requirements, runs still track per-target history and
staleness, and threads anchor at the rule level. The storyboard, anchors, and embed are
the *UI extension* of that core, not the core itself; one blueprint freely mixes both
kinds. `verify: [human]` remains meaningful headless (a person exercising a staging API
is a walkdown), as does `agent` (judging output quality is judgment work).

The guardrail: **not every test deserves to be a rule.** A rule is a behavior product
would recognize as a requirement ("repeated joins are rate limited" — yes; "the YAML
loader tolerates aliases" — that's just a test). Checks should stay a small, meaningful
subset of the project's test suite; a blueprint that mirrors the whole suite has
stopped being a spec.

## Storyboard

```yaml
# blueprint/storyboard.yml
screens:
  - id: checkout-payment
    title: Payment step
    prototype: /screens/checkout-payment.html    # relative to prototype root
    app:
      path: /checkout/payment                    # relative to target base_url
      setup: cart_with_item      # OPTIONAL fixture/recipe name; v1 may leave empty
    anchors:                     # optional: declared anchors for lint & the panel
      - checkout.email
      - checkout.email-error
      - checkout.submit
  - id: checkout-confirm
    title: Order confirmation
    prototype: /screens/checkout-confirm.html
    app: { path: /checkout/confirmation }
```

- Screens may be **states**, not just pages (a modal, wizard step 3). The `setup` field
  says "how to get the app into this state". v1 only guarantees deep-linking to
  URL-reachable screens and does not *execute* `setup` — but the panel shows it with any
  rule whose screen carries one, above the steps, so a walk that can only reach the page
  tells the reviewer the rest. Write it for a person to read.
- Two screens that are states of one page share that page's `app.path`, and a query does
  not tell them apart (`screens.identity.query-is-not-identity`). Matching skips a tie, so
  the second screen can only be reached by picking it by hand; lint warns and names which
  one loses. A `setup` is what makes that spelling honest rather than merely tolerated.
- The storyboard is the *only* place per-surface URLs live. When a route changes, one line
  changes.
- **Each surface has one owner, and nobody writes into another's.** Design owns
  `prototype/`; product owns the PRD; engineering owns the app and checks. When the spec
  gets ahead of a source — a rule incorporated from a thread needs a screen design
  doesn't have — the screen is declared with **`prototype: null`** (spec'd, not yet
  designed) and a **design-request thread** is filed, anchored to that screen. Builders
  may sketch a **`proposal:`** (an HTML file under `proposals/`, shown by the panel
  with a "proposed — not from design" badge) as a communication artifact — the shop
  drawing the contractor submits, never a change to the architect's plans. When design
  ships the real screen, `prototype:` gets its path, the proposal is superseded, and the
  request thread is incorporated. Lint flags an undesigned screen with no open request
  (a proposal alone is not a request); `walkdown status` reports all drift — undesigned
  screens and thread-born rules — until the sources catch up.

## Threads

```yaml
# blueprint/threads/q-0042.yml
id: q-0042
kind: question                 # question | note
author: agent                  # agent | <person>
created: 2026-08-20T14:03:00Z
anchor:
  rule: checkout.guest.email-required
  screen: checkout-payment
  element: checkout.email      # anchor ID; optional
status: open                   # questions: open | answered | incorporated | waived
                               # notes:     open | addressed | verified | waived
body: >
  Should email validation fire on blur, or only on submit? The prototype shows an inline
  error but doesn't indicate when it appears.
replies:
  - author: topher
    created: 2026-08-20T15:11:00Z
    body: On submit only. Blur validation felt naggy in user testing.
```

- A question is **not done when answered**. It is done when **incorporated** — the answer
  folded into the rule's statement or steps (here: a new `then` line about submit-time
  validation). The thread stays as provenance. `walkdown lint` lists threads stuck at
  `answered`.
- Notes (human feedback pins from the embed) use the same shape with lifecycle
  `open → addressed → verified`, and may carry `position` (click coordinates relative to
  the anchored element) and a screenshot path as evidence.
- **`waived`** is the terminal "reviewed and deliberately not acting on this" state for
  both kinds — the construction term for a punch-list item accepted as-is. Waiving is a
  decision, not neglect: it requires `waived_by: <person>` and a reply stating the reason
  (agents may *propose* a waive but never set it). Waived threads stop rendering as pins
  and stop counting against lint, but remain as provenance.
- **Transitions are validated, and mutation goes through one path** (the `walkdown
  thread` CLI, the serve API, and the panel all use it): notes move
  `open → addressed → verified | reopen | waived`, questions
  `open → answered → incorporated | reopen | waived`. Reopening (back to `open`) and
  waiving require a reason, recorded as a reply. The governance rule that keeps the
  ledger trustworthy: **agents may set `addressed`, `answered`, and `incorporated` —
  the states that mean work was done. Only a named human may set `verified` or
  `waived` — the states that mean a person judged it.** An agent can claim, never
  self-accept.

## Extraction is a merge

`walkdown extract` (from Notion PRD / prototype) never overwrites feature files. It:

1. Parses sources into candidate features/stories/rules/screens.
2. Matches candidates against existing items **by ID first, then by statement similarity**.
3. Emits a proposed diff (new items with fresh IDs, changed statements, orphaned items
   flagged — never auto-deleted).
4. A human approves the diff; only then are files written.

This is the mechanism that lets the PRD evolve without severing checks, threads, and run
history from the rules they attach to.
