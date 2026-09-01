---
name: walkdown-sitting
description: Run a full agent sitting - judge EVERY rule whose verify list includes "agent" in one pass, optionally after declaring a sweep so that anything skipped is visible rather than quietly green. Use after a large refactor, before a release, or on a regular cadence of days - not after an ordinary change, where walkdown-judge on the affected rules is the right tool.
---

# A full agent sitting

Read `blueprint/AGENTS.md` first. This is `walkdown-judge` taken across the
whole blueprint at once, with a sweep for knowing what you missed.

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

    walkdown sweep --tiers agent --why "the panel was split into sixteen modules"

**Ask the human before declaring one** unless they have already said to. It is
their call, it shows up in the report until the sitting finishes, and an
abandoned sweep is a report that reads alarming for weeks. If they have said to
sweep, do it *before* judging anything, so the whole board is owed from the
start.

## Procedure

1. **Scope.** `walkdown status --json`: every rule whose `verify` includes
   `agent` and whose agent cell is never, stale, failing or blocked. Status
   honours an open sweep — under one, the whole tier is owed until re-earned.

2. **Serve.** `walkdown serve` for the blueprint, plus whatever the target's
   `base_url` points at. Check both answer before starting — a sitting run
   against a dead server is an afternoon of judging grey rectangles.

   The target you judge against — a dev server, a review app, staging — exists
   to absorb what judging does to it. Anything more this project needs you to
   know is in its `governance:` lines in `walkdown.yml`, and every judge
   prompt carries them. Follow them.

3. **Judge, one rule at a time.** For each owed rule, `walkdown judge
   <rule-id>` assembles the prompt — statement, steps, setup, both surfaces'
   addresses, anchors, evidence key, record shape, governance — and the rest
   is yours: drive your own browser, look, and try to break it. Read the
   statement before anything else; it is authoritative and the steps
   elaborate it.

   Two habits worth keeping:

   - **Measure, do not query.** "Is the element in the DOM" answers a
     different question from "can the reviewer see it". A pane held off-screen
     by a slide track is present and invisible, and a probe that only asks
     `querySelector` reports a passing rule as broken.
   - **Try to break the governance ones.** A rule saying the app refuses
     something is judged by making it refuse, not by reading the code that
     refuses. Empty the identity and press Verify; then check the thread on
     disk is unchanged.

   A page error is a finding, not noise — say so in the run even if the
   screen looks right. Save evidence under the prompt's logical key and cite
   it by that key, never a filesystem path.

4. **Record.** Append the verdicts as one run record (the shape each judge
   prompt prints). Each result needs `rule`, `status`, `evidence` and a real
   `reasoning` — a pass with nothing said about it is what this ledger exists
   to prevent. Copy `statement_hash` from `walkdown hash` only where it
   reports `ok`. A `note` on the run saying the sitting's scope costs a
   sentence and is worth it.

5. **Fails spawn threads.** A failing rule gets a note anchored to the exact
   rule and element, citing the evidence (`walkdown thread new --kind note
   --rule <id> --body <text> --as-agent`), and its id goes in that
   result's `threads`.

6. **Close out.** `walkdown lint`, then `walkdown status`. If you swept, the
   report says how much of the sweep is done; **finish it or say plainly what
   you left**, with the count. Then report what passed, what failed and why,
   and what now awaits a human. If governance had you stand anything up — a
   copy, a fixture, seeded data — take it down before you report, and say so
   if you are leaving something behind and why. Cleaning up is part of
   finishing: six abandoned scratch copies once sat unnoticed for weeks,
   367MB of them, because each was made by an agent that filed its report and
   stopped.

## Judgment

**Partial is fine; pretending is not.** If the sitting runs out of road, record
the rules you actually drove and leave the rest owed. A sweep makes that
honest — the unjudged ones stay visibly unjudged. Writing verdicts you did not
earn to make a report look finished corrupts the one thing the ledger is for,
and a `note` on the run saying what the scope was costs a sentence.

**Never write `verified` or `waived`,** and never turn a fail into a pass
without the fix actually shipping. You claim work; a person accepts it.
