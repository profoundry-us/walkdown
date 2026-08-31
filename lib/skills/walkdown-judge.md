---
name: walkdown-judge
description: Perform an agent walkdown - judge walkdown rules whose verify list includes "agent" against the running app, driving your own browser, then record a hash-stamped walkdown run and spawn note threads for failures. Use when asked to judge, visually verify, run an agent walkdown, or when status shows agent-verify rules pending or stale.
---

# Agent walkdown

Conventions live in `blueprint/AGENTS.md` — read it first. This skill is the
judgment procedure only. You are producing evidence a human can trust; you are
never producing their acceptance (`agent` verdicts satisfy only the `agent`
verify requirement).

## Procedure

1. **Scope.** `walkdown status --json`: collect rules whose `verify` includes
   `agent` and whose agent cell is `never`, `stale`, or worth re-judging after
   a change.

2. **Assemble each rule's prompt.** `walkdown judge <rule-id>` prints
   everything the judging needs to start: the statement, the steps, any
   screen's setup, both surfaces' addresses resolved through the target, the
   anchors the steps name, where evidence goes, the run-record shape, and the
   governance — the built-in lines plus whatever the project's own
   `governance:` list in `walkdown.yml` adds. Read the whole prompt before
   driving; the statement is authoritative and the steps elaborate it.
   `--target <name>` picks another configured target's addresses.

3. **Serve both surfaces.** Start `walkdown serve` (background) — it hosts the
   prototype at `/prototype/...` and proposals at `/proposals/...`. Make sure
   the target's `base_url` answers too.

   The target you judge against — a dev server, a review app, staging — exists
   to absorb what judging does to it; that is what those environments are for.
   Anything more a project needs you to know is in its governance lines, which
   the prompt carries. Follow them.

4. **Earn the verdict.** Decide for yourself how — navigate, look, and try to
   break it, driving your own browser. Two habits worth keeping:

   - **Measure, do not query.** "Is the element in the DOM" answers a
     different question from "can the reviewer see it". A pane held off-screen
     by a slide track is present and invisible.
   - **Try to break the governance ones.** A rule saying the app refuses
     something is judged by making it refuse, not by reading the code that
     refuses.

   Capture evidence as you go: for every screen the rule touches, both
   surfaces at the same viewport. Save under
   `$(walkdown where evidence)/<ISO-timestamp>/` as `proto-<screen>.png` /
   `app-<screen>.png` — ask, never assume, because evidence does not
   necessarily live in the repository (docs/08-locations.md).

   **Record the paths as `runs/evidence/<ISO-timestamp>/<file>` whatever the
   answer was.** That is a logical key, not a filesystem path: a run says which
   evidence it left, never which disk somebody filed it on, and the server
   resolves the key per machine. Writing an absolute path into a run record
   would pin the ledger to your laptop. If a screen has only a proposal (no
   `prototype:`), you may compare against it but say so in your reasoning — a
   proposal is not design authority.

5. **Judge each rule.** Read the evidence against the statement and steps.
   Compare structure, hierarchy, spacing intent, and copy verbatim. Dynamic
   data (user emails, dates) is expected to differ; copy is not. Cite
   discrepancies precisely: which anchor/element, expected vs actual. A page
   error is a finding, not noise — say so in the run even if the screenshot
   looks right.

6. **Record the run.** Append `blueprint/runs/<ts>-<target>-NN.json`
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
     `evidence` (the `runs/evidence/…` keys from step 4, never absolute paths),
     and `reasoning` — one honest paragraph.

7. **Fails spawn threads.** For each failing rule, create a note anchored to
   the exact rule/screen/element (POST `/api/threads` while serve runs, or
   write the YAML), citing the evidence pair. Put the thread id in that
   result's `threads` array.

8. **Close out.** `walkdown lint` (the record must validate), then
   `walkdown status` — confirm the AGENT column updated. Report what passed,
   what failed and why, and what now awaits a human. If the project's
   governance had you stand anything up — a copy, a fixture, a seeded
   account — take it down before you report; cleaning up is part of finishing,
   not a courtesy, and say plainly if you are leaving something behind and why.

Never write `human` verdicts, never set threads to `verified`/`waived`, and
never "re-judge" a fail into a pass without the underlying change actually
shipping — the ledger is append-only history, not a scoreboard.
