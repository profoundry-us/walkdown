---
name: walkdown-backlog
description: Work the whole open backlog unattended - survey every open thread and failing rule, plan the order, and run it out through sub-agents, committing each wave locally. Use when asked to work through all open feedback, fix the failing rules, clear the backlog, or to keep going overnight without questions.
---

# Working the backlog unattended

Conventions live in the blueprint's `AGENTS.md` (`walkdown where spec` names the directory) — read it first. This skill is the
orchestration procedure: how to get a night's worth of the backlog done with
sub-agents while nobody is awake to answer a question.

You are the orchestrator. You do not do the work; you decide the order, hold
the constraints, and check the result. Sub-agents exist so the backlog does not
have to fit in one context window — so never read a large source file yourself
when an agent can read it and report.

**Nobody is available.** Do not ask a question and wait. Where you would have
asked, take the path you would have recommended, do it, and say plainly in the
final report that you decided it and how to reverse it.

## Procedure

1. **Survey before planning.** `walkdown status`, `walkdown lint`, and the full
   list of open threads with their bodies. Sort the work into: notes asking for
   a code change, notes saying a rule is worded wrong, notes saying a rule
   should not be a rule, rules failing only on a human verdict, and tiers
   reading `never` or `stale`. These want different treatment and different
   agents.

2. **Plan by file, not by topic.** The order that matters is which files each
   piece of work touches. Group work into lanes that are *file-disjoint* and
   run those in parallel; anything sharing a hot file runs one agent at a time,
   in sequence. Thread YAML is one file per thread, so replies never collide.
   Spec-only rewording is almost always a lane of its own, and can run beside
   the first code lane.

3. **Brief each agent with the standing constraints.** Every prompt carries:
   run the CLI from the working tree, never `npx`; never set a thread to
   `verified` or `waived`; mutate threads only through `walkdown thread`; never
   edit `prototype/`; do not commit or push; which files this agent owns and
   which belong to another agent right now. Add the traps this repo has already
   paid for — read the last few entries of the log this skill keeps and pass
   on whatever bit someone recently. Finish every prompt with the gates the
   agent must leave green.

4. **Gates, every wave, no exceptions.** The build, the unit suite, the browser
   checks in their record-nothing mode, and `walkdown lint` at **0 errors and 0
   warnings**. Verify these yourself after the agent reports — an agent
   reporting green is evidence, not proof.

5. **Commit each wave.** When a wave's gates pass, commit it locally: one
   commit per coherent wave, or a few smaller ones if the wave did unrelated
   things. Write the message the way this repo writes them — say what changed
   and why it was wrong, not which files moved. **Never push.** The point of
   committing is that a person waking up can read the work in pieces and revert
   one piece without losing the rest. Commit the run records a wave produced in
   that same wave, and never in a commit *before* the rule they judge exists.

6. **Watch for the wave that widens.** An agent that starts touching files
   outside its lane is about to collide with the next one. Check the working
   tree between waves rather than trusting the plan.

7. **Evidence last.** Sub-agents run the browser suite in its record-nothing
   mode, so a night of fixes leaves the ledger untouched and the panel still
   showing the old story. Close with a wave that takes a run of record and an
   agent walkdown (the `walkdown-judge` skill) over every tier now reading
   `never` or `stale`. Fixing the build without refreshing the ledger is half
   a night's work.

8. **Keep a log as you go**, in a scratch file outside the repo — one section
   per wave: what was dispatched, what came back, what it cost, what it found
   that nobody asked about. Write it when the wave lands, not at the end.

9. **Report as a table.** Thread id, what changed, and the state it left the
   rule in. Then, separately and unmissably: the decisions you took on the
   person's behalf and how to undo each, anything an agent found that nobody
   filed, and the final counts.

## Judgment

- **A fail with a reason beats a generous pass.** If a rule does not hold, the
  useful outcome is a written failure and a filed note, not a green cell.
- **Do not close a note just because the person said it was fine.** If they
  wrote "working as intended" and it is not, say so and leave it open.
- **Prefer rewording a rule to rebuilding a control that was removed on
  purpose.** Read the thread that removed it before deciding.
- **A bug an agent finds in passing is worth more than the note it was sent to
  fix.** File it or fix it, but never let it end up only in a transcript.
