# 05 — Runs ledger

## Principle: status is derived, never stored

No pass/fail field ever lives on a rule. Verification results are **append-only run
records**; a rule's status is a *query* over the ledger. This absorbs every truth we care
about — agent-run checks, CI runs, human walkdowns, per-environment differences — without
a status enum that lies.

Four independent truths per rule, each answered by a ledger query:

1. **Built?** — the builder agent's claim (latest build-time run touching the rule).
2. **Checked?** — latest automated run per target.
3. **Judged?** — latest *agent* walkdown covering the rule.
4. **Walked down?** — latest *human* walkdown covering the rule.

They disagree constantly, and the disagreements are the signal: *"check passes but the
human rejected it"* means the check is wrong — its own workflow, visible only because the
truths are stored separately.

## Run record

One JSON file per run in `blueprint/runs/`, named `<timestamp>-<target>-<seq>.json`.
Append-only: a run is never edited, and new runs never conflict in git.

```json
{
  "run_id": "2026-08-20T14-12-03Z-staging-01",
  "created": "2026-08-20T14:12:03Z",
  "actor": "agent",
  "kind": "checks",
  "target": "staging",
  "base_url": "https://staging.acme.com",
  "git_sha": "abc1234",
  "blueprint_sha": "def5678",
  "results": [
    {
      "rule": "checkout.guest.email-required",
      "status": "pass",
      "statement_hash": "sha256:9b2f01c4e7aa",
      "duration_ms": 4210,
      "checks": ["spec/workflows/checkout_spec.rb[1:2]"],
      "evidence": ["runs/evidence/2026-08-20T14-12-03Z/email-required.png"]
    },
    {
      "rule": "checkout.guest.saved-cards",
      "status": "skipped",
      "reason": "environment: rule not applicable to staging"
    }
  ]
}
```

Fields of note:

- **`actor`**: `agent` | `ci` | `<person>`. **`kind`**: `checks` (automated) | `walkdown`
  (human session).
- **`target`** + **`base_url`**: which system was verified. This is what makes "multiple
  verification runs against different URLs" a first-class concept rather than a web-app
  feature.
- **`git_sha`** and **`blueprint_sha`**: what code and what version of the spec were
  verified — provenance for humans digging into a run. An unclean working tree records
  `<sha>-dirty`; formatters omit the fields entirely outside a git repo.
- **`statement_hash`** per result: the hash of the rule statement *as it was when
  verified* (formatters emit it automatically). This is what powers staleness: a pass
  whose recorded hash no longer matches the rule's current statement is displayed as
  *stale*, not *passing*. Results without it are taken at face value.
- **`status`** per rule: `pass | fail | skipped | blocked`, plus two that only walkdown
  sessions record — `approved | refining`, the **sign-off** verdicts for rules with no
  build evidence yet (see below). Failures carry the failure message; evidence paths
  (screenshots, traces) live under `runs/evidence/` (git-ignored or LFS, per project
  taste).

## walkdown sessions (judgment runs)

walkdown sessions come in two flavors, producing the same record shape:

- **Human** (`actor: <person>`): stepping through rules in the panel. The only evidence
  that satisfies a `human` verify requirement.
- **Agent** (`actor: agent`): an AI agent runs the same ritual headlessly — navigates
  both surfaces via the storyboard, compares app against prototype per rule (screenshots,
  anchor presence, statement/steps), and records verdicts with evidence and reasoning.
  Satisfies only an `agent` verify requirement; used to pre-screen judgment rules so
  humans only walk what already looks right. An agent "fail" should spawn a question or
  note thread explaining what looked wrong.

```json
{
  "run_id": "2026-08-20T16-40-11Z-staging-02",
  "actor": "topher",
  "kind": "walkdown",
  "target": "staging",
  "git_sha": "abc1234",
  "results": [
    { "rule": "checkout.guest.email-required", "status": "pass" },
    { "rule": "checkout.guest.visual-summary", "status": "fail",
      "threads": ["n-0018"] }
  ]
}
```

- The panel drives the session: it walks the rule list, takes the surface under review
  to each rule's screen ([04-embed-and-anchors.md](04-embed-and-anchors.md)), and
  records verdicts — a pass advances to the next rule owing one, a fail stays put so a
  note can be pinned where it failed.
- **Every verdict can carry a why, and a fail must.** A feedback box rides above the
  verdict buttons; anything written is filed as a note thread on the rule and linked
  into the run result's `threads`, along with any pins dropped on the rule during the
  session. A fail is refused until it has one or the other — a fail with no why is work
  nobody can act on.
- **Unbuilt rules are signed off, not judged.** A rule the ledger holds no build
  verdict for (no pass or fail from checks or judgment) offers **Approve / Refine**
  instead of Pass / Fail — a verdict on the *spec*, not the build. Approve records
  `approved`, hash-stamped like a pass so it goes stale when the statement is reworded;
  Refine requires the feedback text (that text *is* the refinement) and records
  `refining` with the thread linked. Neither counts as build evidence, neither
  satisfies any verify requirement, and the rule stays in the human queue for a real
  walkdown once built.
- A human "fail" usually spawns a **note thread** at the offending element; the run result
  links to it, so the agent fixing the note can see exactly which walkdown rejected what.
- Partial sessions are fine — un-visited rules simply don't appear in `results`.
- A rule is **verified** only when every evidence type in its `verify` list has a passing,
  non-stale latest result: `checks` from automated runs, `agent` from agent walkdowns,
  `human` from human walkdowns. Higher tiers never substitute downward or upward — an
  agent pass neither satisfies `human` nor replaces a failing check.

## Derived status (`walkdown status`)

```
RULE                              LOCAL      STAGING    AGENT      HUMAN      THREADS
checkout.guest.email-required     ✓ pass     ✓ pass     —          ✓ topher   —
checkout.guest.saved-cards        ✓ pass     – skipped  —          ✗ topher   n-0018 open
checkout.guest.visual-summary     (judged)   (judged)   ✓ agent    ✓ topher   —
onboarding.invite.resend          ✗ fail     never run  ✗ agent    never      q-0042 answered*
```

Columns map to evidence types: LOCAL/STAGING are `checks` per target; AGENT and HUMAN are
the latest agent and human walkdown verdicts. A rule renders as fully verified only when
every type in its `verify` list shows a current pass.

Query semantics:

- Each cell = **latest relevant run** for that (rule, target/kind).
- Staleness beats recency: a pass against outdated rule content or an older `git_sha`
  than the current branch renders as `~ stale`, prompting a re-run.
- `*` marks threads stuck at `answered` (knowledge not yet incorporated —
  see [02-blueprint-schema.md](02-blueprint-schema.md)).
- `--json` output is the agent-facing form; the human-facing table and the panel's
  counts are renderings of the same query.

## Retention

The ledger grows forever by design; files are tiny. If a project cares,
`walkdown compact` can archive runs older than N days into a single summary file —
derived-status queries only ever need the latest few runs per (rule, target) anyway.
