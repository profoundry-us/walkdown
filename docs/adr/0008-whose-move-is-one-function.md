# ADR 0008 — Whose move a rule is, decided in one place

- **Status:** proposed 2026-09-20, for Topher's review. Nothing built.
- **Date:** 2026-09-20
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0005 (threads close where they were asked), ADR 0006 (a
    rule is the conversation), `status.attention.blocked-queues`,
    `status.derived.*`, the sweep rules.
- **Threads:** asked in conversation on 2026-09-20 after the fifth derivation
    bug in three days; none filed.

## Context

walkdown never stores a rule's status. It is a fold over the ledger — runs,
threads, sweeps, rewordings — recomputed on every read, so nothing derived
can drift from what the files say. That part is right and this ADR keeps it.

What has gone wrong, repeatedly, is the *composition*: the answer to "whose
move is this rule, and what for" is assembled from acceptance per role, tier
cells, thread kind × reason × status, whether a thread was spoken to before
the person's latest pass, whether the rule is walkable, sweeps, a claimed
fix nobody re-judged, and an answered question nobody folded in. That
assembly is imperative code in one 600-line function (`deriveStatus`), and it
is re-derived, differently, in at least five other places:

| where | what it decides |
|---|---|
| `lib/status.js`, the attention loop | who each rule and thread is queued to |
| `lib/vocab.js` `closesOnVerdict`, `waitsOnPerson`, `whoseMove` | which threads a pass ends; which wait on a person; whose move a thread is |
| `lib/threads.js` `closeByVerdict` | which threads a signed pass actually closes |
| `src/panel/rule-detail.js` `ruleTurn` | the sentence above the composer |
| `src/panel/vocab.js` `askOf`, `needsYou`, `turnLine` | the owed badge, the queue, the thread screen's line |

The last week, in order:

1. A question answered on a rule left the rule in the person's queue with
   Pass/Fail offered — `incorporate` was queued to the agent and `judge` to
   the person, and nothing said one blocks the other (2026-09-18).
2. A rule read "asks 3 questions" while asking none — the person's own
   thoughts filed as a question, and two prose questions with the fork in
   their third paragraph (2026-09-19).
3. Twenty-one of the agent's own observations, marked `addressed` rather than
   `settled` before the passes that would have closed them, queued fifteen
   already-passed rules back to the person as "fix claimed" — while the turn
   line on the same screen said an observation "never comes back to you"
   (2026-09-20).
4. The pass-advance always opened the *first* owed rule, so a rule stepped
   past was the one every later pass returned to (q-0237).
5. Rules passed on 2026-09-16 still carried notes addressed before that pass,
   because pass-ends-the-conversation landed after it.

None of these was a thread moving to an illegal status. The thread lifecycle
(`FLOWS`, `whoseMove`) is already a small, tabular state machine and has held.
Every bug was a hand-written predicate missing one cell, found by Topher
walking into it.

### Why not a statechart for the rule

Topher asked whether a statechart system would help. For the *thread* it
already is one, and it works. For the *rule* it is the wrong shape: a rule
has no state to transition — it has a history to fold. The events that hurt
are temporal, not transitional: a reply that predates a pass; a rewording
that makes an old verdict stale after the fact; a sweep that is a floor under
every verdict before it. A statechart answers "what may happen next from
here"; the question here is "given everything that has happened, in whatever
order, who is it on?" Modelling that as transitions means storing per-rule
state to transition from, which is exactly the drift the derived design
forbids.

## Decision (proposed)

**One pure function answers whose move a rule is, and every surface reads
it.** Everything below is drafted from the code as it stands on 2026-09-20,
so the table can be argued with before anything moves.

### 1. `situate()` — the one definition

```
situate(rule, { acceptance, cells, threads, latestPass, walkable })
  -> { waitsOn: 'human' | 'agent' | null,
       why:     'judge' | 'verify' | 'answer'            // a person's
              | 'fold-in' | 'settle' | 'address'          // the agent's
              | 'rejudge' | 'cover' | 'fix',
       role?:   the signing role, for 'judge'
       threads: the thread ids the ask names,
       held?:   what suppressed a lower-precedence ask, if anything }
```

Pure: no I/O, no `S`, no clock beyond the timestamps handed in. The attention
list becomes a projection of it (one item per situated rule, plus the
rule-less threads); `ruleTurn`, `askOf`, `needsYou` and `turnLine` *consume*
it. The turn text and the queue then cannot disagree, because there is one
answer for them to draw.

### 2. The thread half, as a decision table

For a thread on a rule the walk can reach. *Task reasons* are `feedback`,
`request` and `finding`; a note with no reason reads as `feedback`.

| kind | reason | status | queued to | as | a signed pass ends it? |
|---|---|---|---|---|---|
| note | task | `open` | agent | `address` | yes, if said before the pass |
| note | `observation` | `open` | agent | `address` | yes |
| note | task | `addressed` | **person** | `verify` (one item per rule, naming the threads) | yes |
| note | `observation` | `addressed` | agent | `settle` | yes |
| note | `decision` | `recorded` | nobody | — | never |
| note | any | `settled` `verified` `waived` | nobody | — | — |
| question | — | `open` | **person** | `answer` (one item per rule) | no |
| question | — | `answered` | agent | `fold-in` — and it **holds** every person's item on the rule | no |
| question | — | `incorporated` `waived` | nobody | — | — |

For a thread on no rule, or on a retired one, the thread stands on its own
(ADR 0005): an addressed `feedback`/`request` waits on the person's own
Done; an addressed `finding`/`observation` waits on nobody; an open question
waits on the person; an open note and an answered question on the agent.

Rows marked **person** are the only rows that may put a rule in a person's
queue. Today's code reaches the same table except that it was written as
`continue`s in two loops, and row 4 did not exist until 2026-09-20.

### 3. The rule half, per signing role

| acceptance | built? | queued to | as |
|---|---|---|---|
| `none` | no | person | `judge` (a wording to sign) |
| `none` | yes | person | `judge` (a build to walk) |
| `approved` | no | nobody | — (the wording is accepted; nothing to judge yet) |
| `approved` | yes | person | `judge` |
| `sent-back`, no fix since | nobody | — (the agent owes the fix, via the thread) |
| `sent-back`, fix claimed and re-judged | person | `judge`, `after` the fix thread |
| `stale` (reworded since) | person | `judge` |
| `signed` | nobody | — |

Independent of role: a rule that demands `checks` while no check claims it
queues the agent to `cover`; a rule whose newest pass predates a claimed fix
queues the agent to `rejudge`.

### 4. Precedence — what holds what

Applied in this order; the first that applies wins, and `held` records it:

1. A rule holding an **answered question** is the agent's to fold in and is
   queued to no person, not to judge, not to verify.
2. A **sent-back** rule with no fix since waits on the fix, not its signer.
3. An **approved** wording waits on the build, not its signer.
4. An **observation** never waits on a person, whatever its status.
5. Otherwise, a person's items stand beside the agent's: a rule can owe a
   walk to the person and a `cover` to the agent at once, and both are true.

Rules 1–4 are today's `continue`s, written down.

### 5. The tests that enumerate rather than sample

- **Coverage of the table.** Generate every (kind, reason, status,
  said-before-pass, walkable) the vocabulary allows and assert `situate`
  answers each one on purpose — no combination falls through to a default.
- **Invariants, one line each, from the ADRs:**
  - a thread is never in both queues;
  - an observation never waits on a person;
  - a rule holding an answered question owes nobody;
  - if a person is asked to look, the look ends what they looked at
    (`verify` ⇒ `closesOnVerdict`);
  - the panel's turn party equals the situation's `waitsOn`.
- **Regression oracle.** This blueprint's own attention list, before and
  after the extraction, byte-identical — the recorded runs and threads are
  the fixture.

Any one of the invariants would have caught bugs 1, 3 and 5 before Topher
did.

## Consequences

- `lib/status.js` loses its attention loop and the acceptance predicate's
  `continue`s to `lib/situation.js` (~150 lines); the attention list is a
  projection. The panel drops three re-derivations and reads one record.
- `closeByVerdict` reads the same table's "ends it?" column instead of its
  own `closesOnVerdict`, so a person is never queued for a look that the look
  would not end.
- The table is the spec: `status.attention.blocked-queues` restates it in
  its steps, and the rows are what a reviewer argues with.
- Cost: a day or two, and it is the kind of extraction that must not happen
  under a walkdown in progress. The risk is in the fold, not the table.

## What this does not decide

- Whether `acceptance` itself (the per-role state machine of §3) moves into
  the same module. It is the next candidate; this ADR takes the thread half
  and the precedence first, because that is where five bugs were.
- The thread lifecycle. `FLOWS` stays where it is and stays a table.
- Any change to what is recorded. Nothing derived is stored; that is the
  point.

## Alternatives considered

- **A statechart library (xstate or similar) per rule.** Rejected: see
  *Why not a statechart for the rule*. It would need stored state and would
  model the wrong question.
- **Store the situation on the rule** and update it on every write. Rejected:
  it is the drift-from-truth the ledger design exists to prevent, and every
  write path would have to agree — the disagreement this ADR is about, moved
  to write time.
- **Keep fixing cells as they are found.** Rejected by the week: five in
  three days, each found by the person the queue lied to.
