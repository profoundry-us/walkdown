---
name: walkdown-sitting
description: Run a full agent sitting - judge EVERY rule whose verify list includes "agent" in one pass, optionally after declaring a sweep so that anything skipped is visible rather than quietly green. Use after a large refactor, before a release, or on a regular cadence of days - not after an ordinary change, where walkdown-judge on the affected rules is the right tool.
---

# A full agent sitting

Read `blueprint/AGENTS.md` first. This is `walkdown-judge` taken across the
whole blueprint at once, with a harness for the mechanical half and a sweep for
knowing what you missed.

**Use this when the whole board needs re-earning**: a refactor that moved a lot
of code, a release you are about to sign, or a cadence of every few days. For
one rule, or the handful a change touched, use `walkdown-judge` — declaring a
sweep for a small change puts eighty rules back on the queue and the sitting
gets abandoned half-done, which is worse than not having swept.

## Deciding to sweep

A sweep is a dated marker saying *from here, earn it again*. Every verdict older
than it reads as stale, so a rule nobody got back to is legible as unfinished
instead of passing. Nothing is deleted — the ledger is append-only and the
marker records who asked and why.

    node bin/walkdown.js sweep --tiers agent --why "the panel was split into sixteen modules"

**Ask the human before declaring one** unless they have already said to. It is
their call, it shows up in the report until the sitting finishes, and an
abandoned sweep is a report that reads alarming for weeks. If they have said to
sweep, do it *before* capturing anything, so `owed` lists the whole board.

## Procedure

1. **Scope.** `node tools/sitting.mjs owed` — the agent-tier rules whose cell is
   never, stale, failing or blocked, grouped by story, each with the screens its
   steps mention. It honours an open sweep. Read every one of those rules'
   `statement` and `steps` before looking at a picture; the statement is
   authoritative and the steps elaborate it.

2. **Serve.** `walkdown serve` for the blueprint, plus whatever the `local`
   target's `base_url` points at. Check both answer before capturing — a
   sitting captured against a dead server is an afternoon of grey rectangles.

   A sitting reaches rules that can only be judged by making the panel WRITE —
   filing, refusing, pinning. Serve a disposable copy for those, never the real
   blueprint:

       node tools/scratch.mjs new sitting-<date> --why "..."
       node bin/walkdown.js serve --dir .walkdown/tmp/sitting-<date>/blueprint

   The copy is for the app under judgment. Verdicts go in the real ledger.

3. **Capture.** `node tools/sitting.mjs capture` drives the panel through every
   state it knows and writes both surfaces to
   `blueprint/runs/evidence/<ts>/`. It reports page errors per state; **a page
   error is a finding, not noise** — say so in the run even if the screenshot
   looks right.

   The state list in `tools/sitting.mjs` is data. When a rule needs a state
   nobody has captured before, add it there rather than writing a throwaway
   script, and the next sitting gets it for free.

4. **Judge.** For each owed rule, read the statement against the evidence pair.
   Compare structure, hierarchy, spacing intent, and copy verbatim. Dynamic data
   differs legitimately; copy does not. Cite discrepancies precisely — which
   anchor, expected against actual.

   Two habits worth keeping:

   - **Measure, do not query.** "Is the element in the DOM" answers a different
     question from "can the reviewer see it". A pane held off-screen by a slide
     track is present and invisible, and a probe that only asks `querySelector`
     reports a passing rule as broken.
   - **Try to break the governance ones.** A rule saying the panel refuses
     something is judged by making it refuse, not by reading the code that
     refuses. Empty the identity and press Verify; then check the thread on
     disk is unchanged.

5. **Record.** Write the verdicts to a JSON file and
   `node tools/sitting.mjs record <file>`. Each result needs `rule`, `status`,
   `evidence` and a real `reasoning` — the harness refuses thin reasoning,
   missing evidence, an unknown rule or a bad status, because a pass with
   nothing said about it is what this ledger exists to prevent. Copy
   `statement_hash` from `walkdown hash` only where it reports `ok`.

6. **Fails spawn threads.** A failing rule gets a note anchored to the exact
   rule and element, citing the evidence, and its id goes in that result's
   `threads`.

7. **Close out.** `walkdown lint`, then `walkdown status`. If you swept, the
   report says how much of the sweep is done; **finish it or say plainly what
   you left**, with the count. Then report what passed, what failed and why, and
   what now awaits a human.

   Then take the scratch away: `node tools/scratch.mjs clean <label>`, and
   `list` to see what else is lying about. Six abandoned copies once sat there
   for weeks, 367MB of them, because each was made by an agent that filed its
   report and stopped — by the time anyone found them nobody could say which
   sitting had made which. Cleaning up is part of finishing. If you leave one
   standing, say so and say why; `clean --stale` will take it eventually, but
   only because somebody has to.

## Judgment

**Partial is fine; pretending is not.** If the sitting runs out of road, record
the rules you actually drove and leave the rest owed. A sweep makes that
honest — the unjudged ones stay visibly unjudged. Writing verdicts you did not
earn to make a report look finished corrupts the one thing the ledger is for,
and a `note` on the run saying what the scope was costs a sentence.

**Never write `verified` or `waived`,** and never turn a fail into a pass
without the fix actually shipping. You claim work; a person accepts it.
