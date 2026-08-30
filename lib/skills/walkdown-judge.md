---
name: walkdown-judge
description: Perform an agent walkdown - visually judge walkdown rules whose verify list includes "agent" by comparing the built app against the prototype screen by screen, then record a hash-stamped walkdown run and spawn note threads for failures. Use when asked to judge, visually verify, run an agent walkdown, or when status shows agent-verify rules pending or stale.
---

# Agent walkdown

Conventions live in `blueprint/AGENTS.md` — read it first. This skill is the
judgment procedure only. You are producing evidence a human can trust; you are
never producing their acceptance (`agent` verdicts satisfy only the `agent`
verify requirement).

## Procedure

1. **Scope.** `walkdown status --json`: collect rules whose `verify` includes
   `agent` and whose agent cell is `never`, `stale`, or worth re-judging after
   a change. Read each rule's `statement`, `steps`, and `screens`.

2. **Serve both surfaces.** Start `walkdown serve` (background) — it hosts the
   prototype at `/prototype/...` and proposals at `/proposals/...`. Start the
   app's own dev server (the `local` target's `base_url` in
   `blueprint/walkdown.yml`).

3. **Capture evidence.** For every screen the rule touches (its derived flow —
   the screens its steps mention — plus any others it lists), screenshot both
   surfaces at the same viewport, e.g.
   `npx playwright screenshot --viewport-size=800,620 <url> <out>.png`.
   Resolve URLs through the storyboard only. Save under
   `blueprint/runs/evidence/<ISO-timestamp>/` as `proto-<screen>.png` /
   `app-<screen>.png`. If a screen has only a proposal (no `prototype:`), you
   may compare against it but say so in your reasoning — a proposal is not
   design authority.

4. **Judge each rule.** Read the screenshot pairs side by side against the
   statement and steps. Compare structure, hierarchy, spacing intent, and copy
   verbatim. Dynamic data (user emails, dates) is expected to differ; copy is
   not. Cite discrepancies precisely: which anchor/element, expected vs actual.

5. **Record the run.** Append `blueprint/runs/<ts>-<target>-NN.json`
   (`ts` = ISO with dashes; `NN` = 01 unless the id collides):
   - `kind: "walkdown"`, `actor: "agent"`, `target`, `base_url`, `created`
   - `git_sha`: `git rev-parse --short HEAD` of the repository holding the CODE,
     with a `-dirty` suffix when the tree is unclean; omit it where there is no
     repository. On a dirty tree add `tree_hash`, a sha256 of `git diff HEAD`,
     so two runs mid-edit can be told apart
   - `spec_hash`: `specHash(<blueprint dir>)` from `lib/hash.js` — what the run
     was judged against, and unlike the old `blueprint_sha` it does not move on
     commits that never touched the blueprint
   - per rule: `status` (`pass`/`fail`), `statement_hash` (copy
     `steps.statement_hash` **only after** `walkdown hash` reports it `ok`),
     `evidence` (the screenshot paths), and `reasoning` — one honest paragraph.

6. **Fails spawn threads.** For each failing rule, create a note anchored to
   the exact rule/screen/element (POST `/api/threads` while serve runs, or
   write the YAML), citing the evidence pair. Put the thread id in that
   result's `threads` array.

7. **Close out.** `walkdown lint` (the record must validate), then
   `walkdown status` — confirm the AGENT column updated. Report what passed,
   what failed and why, and what now awaits a human.

Never write `human` verdicts, never set threads to `verified`/`waived`, and
never "re-judge" a fail into a pass without the underlying change actually
shipping — the ledger is append-only history, not a scoreboard.
