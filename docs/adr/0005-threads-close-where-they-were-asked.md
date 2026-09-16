# ADR 0005 — A thread closes where it was asked

- **Status:** accepted 2026-09-14 by Topher; not yet built. Drafted by
    the agent the same day, after the 2026-08-31 sweep finished and Topher
    asked why 185 threads were waiting on him. §7 (Verify on the pin
    popover) was added at his request before acceptance.
- **Date:** 2026-09-14
- **Deciders:** Topher (product, eng)
- **Builds on:** the thread lifecycle (`lib/vocab.js` FLOWS), "you claim
    work; a person accepts it" (`AGENTS.md`, `threads.lifecycle.claim-never-accept`),
    `acts-for-a-person` (n-0139), and the attention list
    (`status.attention.blocked-queues`).
- **Threads:** n-0127 (verified_by never recorded), n-0139 (via: agent),
    n-0286 / n-0287 / n-0289 (decisions recorded as notes, now queued as work)

## Context

Every thread in walkdown is one of two kinds, and each kind has one road out:

    note:      open → addressed → verified | waived
    question:  open → answered  → incorporated | waived

Only `verified`, `waived` and `incorporated` are terminal, and only a named
person may write the first two. That is the law this repo was built on: an
agent claims, a person accepts. It is right, and it is also why the board
looks the way it does on 2026-09-14:

| status                | count |
|-----------------------|------:|
| note / addressed      |   185 |
| note / verified       |    47 |
| note / open           |    22 |
| question / open       |    19 |
| question / incorporated | 11  |
| note / waived         |     7 |
| question / waived     |     1 |

185 threads sit at `addressed`, every one an item in Topher's verify queue.
The median has waited 12 days; the oldest 23. In the same period 47 were
verified, ten of them with `verified_by` recorded — the rest predate n-0127.
The queue grows by roughly a sitting's worth of fails a week and shrinks by
a handful. It is not being worked, and the reason is not laziness. Read the
185 by who is actually in them:

- **105 have nothing human in them at all.** An agent judge failed a rule
    and filed the note; an agent fixed it and replied; a re-judge passed.
    The person being asked to verify has never seen the thread and has
    nothing to add to a pass they can already read in the rule's cell.
- **71 were opened by a person, and the person has not been back.** Topher
    typed a why into the feedback box during a walkdown, an agent fixed it,
    and the thread waits for Topher to come back to a rule he has since
    passed in a later sitting.
- **9 have a human reply after the fix.** These are the conversations the
    lifecycle was designed for, and they are five percent of the queue.

Four faults are tangled together here.

1. **One lifecycle serves five different things.**

    A note is used for: a person's feedback during a walkdown; a judge's
    fail (112 of the 185 are cited by a run result); an agent's observation
    made while doing something else (n-0112, n-0115, n-0118: "two checks
    only pass when a server happens to be on 4700"); a design request; and
    a recorded decision (n-0287: "not a rule, recorded here so the question
    is not reopened"). All five must be `addressed` by an agent and
    `verified` by a person, so a decision Topher dictated on Saturday was
    queued to an agent on Sunday and, once marked addressed, queued back to
    Topher to accept his own decision and to an agent to re-judge the rule
    it sat on. Three such re-judge items appeared on the board this
    afternoon from three threads nobody had done any work on.

2. **The acceptance already exists, somewhere else.**

    For a judge-found fail the person's acceptance is the rule's own
    signature: `status.acceptance.verdict-needs-every-role` says a rule
    passes when every tier passes and every role has signed. When Topher
    passes the rule in a sitting after the fix, he has looked at the thing
    the note was about and said it is right. The thread does not know that
    happened. So the same look is demanded twice, once as a verdict and
    once as a verify, and the second is the one nobody gives.

3. **The queue has no surface a person would work from.**

    `walkdown status` prints six active threads and "+216 more". The
    attention list in `--json` is 185 rows keyed by thread id. The rule
    detail has a "Verify all N" button (`rule-detail.js`), which is the
    right gesture on the wrong occasion: you find it by opening a rule you
    are not otherwise looking at. Nothing puts the item in front of the
    person at the moment they are already looking at the rule, which is
    the walkdown.

4. **A machine's finding is filed under a person's name.**

    Of the 185, 90 are authored `topher` with `via: agent`. That mark was
    meant for n-0139's case: Topher dictates, the agent types. It is now
    also how a judge session files what *it* found, because the session
    runs under the person's identity. The thread then reads as Topher's
    feedback awaiting Topher's acceptance, and the count of "notes people
    wrote" is unknowable. (Only 36 of 292 threads are authored `agent`.)

None of this needs the law changed. An agent still never writes `verified`
or `waived`. What changes is *which* acceptance a thread waits for, and
whether a person's existing look can count as it.

## Decision

**A thread closes where it was asked.** The thing that opened it is the
thing whose acceptance closes it; a person is asked once, at the moment
they are already looking.

### 1. Threads say why they exist

A note carries a `reason`, set when it is filed and never changed:

| reason       | filed by                       | what closes it                                |
|--------------|--------------------------------|-----------------------------------------------|
| `feedback`   | a person, during a walkdown or on a rule | that person's next verdict on the rule (§3), or an explicit verify |
| `finding`    | a judge, on a fail             | a later pass on the rule by a tier a person signs (§2) |
| `observation`| an agent, in passing           | an agent marking it addressed, with the change named (§2) |
| `request`    | anyone, to design              | a person, as today                            |
| `decision`   | a person (or an agent typing one) | nothing — terminal on filing, like `incorporated` |

The reason is derived where it can be (a note created by a run result is a
`finding`; one created from the walkdown feedback box is `feedback`; one
created with `--as-agent` outside a run is an `observation`) and asked for
where it cannot (the CLI and the composer). Existing threads are classified
once by the same rules; see Migration.

Questions keep their lifecycle unchanged. A question is a person asking
and a person incorporating, and the 19 open ones are real.

### 2. A judge's finding is closed by the verdict, not by a verify

A `finding` on rule R moves from `addressed` to `verified` **when the
status derivation sees a pass on R, recorded after the fix was claimed, by
a tier the rule asks for, and R's roles are signed.** The verify is written
by the derivation on the person's behalf and stamped
`verified_by: <role signer>` and `via: verdict <run id>`; it is not a thing
an agent wrote.

An `observation` closes when an agent marks it `addressed` and the reply
names the change (`says-what-it-did`); it never enters a person's queue.
If the agent's change turns out to matter to a person, that shows up as a
judge fail or a person's feedback — a new thread with a reason that will
reach them.

This is the whole of the 105: they close on the next human pass of their
rule, and the human pass is a look Topher was going to give anyway.

### 3. A person's feedback is closed by their own next look

When a person records a verdict on rule R during a walkdown, the session
shows them the `feedback` threads on R that are `addressed` — their own
earlier words and the agent's reply, under the verdict buttons, before
they press anything. **Pass** on the rule verifies those threads under
their name in the same gesture, with the run id as the reason. **Fail**
leaves them addressed and the new feedback is a reply on the thread the
person is replying to, not a fresh note, unless they say it is about
something else.

A person can still verify or waive a thread from its own screen, as
today. What goes away is the expectation that they will go looking.

### 4. A decision is a record, not a task

`decision` is terminal on filing. It appears in the rule's history and in
`walkdown threads --all`, and in no queue. n-0286, n-0287 and n-0289 are
this; so is most of what the ledger currently calls "addressed by
agent, replied by topher via agent".

A `decision` that later needs work is not reopened; a `feedback` or
`observation` is filed citing it.

### 5. A judge signs its own findings

A note filed by a judge run is authored `agent`, with the run id in the
record, never `<person> via agent`. `via: agent` returns to meaning only
what n-0139 meant: this person said it, a machine typed it. The prompt
`walkdown judge` assembles says so, and `POST /api/threads` from a session
whose actor is a run's agent refuses to author as anyone else.

### 6. The queue is the walkdown

The `human: verify` attention item is kept for `feedback` and `request`
threads only, and it is counted per rule, not per thread — "3 rules carry
feedback of yours that was answered" — because the gesture that clears it
is a verdict on the rule. `walkdown status` prints that count in the
summary line and lists the rules. The threads tab keeps its list; it is
not the queue.

*2026-09-16:* per rule only where a verdict on the rule is what clears it.
A `request` is verified from its own screen (§3 — a pass leaves it alone),
and a note on a retired rule has no rule to walk; both were being grouped
under the rule, which kept the rule in the walk queue after every pass with
nothing there to do. They are per-thread items now, in the threads tab
where Verify is. And a rule nothing verifies but a signature — every
evidence tier excused — takes that signature as its verdict: it reads as
built and signed, so the pass that closes its feedback is one a person can
actually give (`one-switch` sat pending with two unclosable notes).

### 7. The pin popover offers Verify

The embed's standalone popover is read-and-reply today; lifecycle actions
were kept to the panel and the CLI, where a transition is validated with an
actor (`src/embed/index.js`, "standalone thread popover"). The pin is where
a person is already looking at the thing a thread is about, so it gets
**Verify** on its action row, under the same law as everywhere else:

- Shown only when the embed knows a named person — the identity the panel
    records under, not a guess — and only on a thread at `addressed` whose
    reason a person closes (`feedback`, `request`, or a `finding` the person
    chooses to close early). Absent otherwise, not disabled.
- Verify asks for nothing more; it records `verified_by` and a reply
    naming the pin it was pressed from. Waive stays off the popover: it
    needs a reason, and the popover's reply box "carries no instructions of
    its own" (`embed.threads.actions-in-context`). The panel and CLI keep
    it.
- The server validates the transition exactly as for the panel
    (`threads.lifecycle.claim-never-accept`); the popover is one more door,
    not a shortcut past one.

## Consequences

- The verify queue on 2026-09-14 becomes: 71 `feedback` threads over some
    smaller number of rules, cleared by Topher's next sittings without a
    separate pass; 105 `finding`/`observation` threads that close as their
    rules are re-passed, most on the first sitting; 9 conversations that
    stay open until someone replies. The 185 do not have to be read one by
    one by anyone.
- The law holds: no agent writes `verified` or `waived`. §2's automatic
    verify is the derivation reading a verdict a person signed; the person
    is named on it.
- "Verify all N" on the rule detail stays for the person who wants it.
- A finding can be closed by a pass the person gave without reading the
    finding. That is accepted on purpose: the finding was about the rule,
    the person judged the rule, and the thread remains readable in the
    rule's history. If the finding was about something the rule does not
    say, it was filed on the wrong rule, and that is what §5's authorship
    and n-0293-style notes-without-fails are for.
- Two new fields on a note (`reason`, and `via: verdict <run>` on a
    verify), one new terminal status path (`decision` → filed and done),
    and a change to `lib/status.js` (findings close on pass; verify items
    counted per rule). The panel's walkdown session gains one block under
    the verdict buttons. `walkdown judge`'s prompt and `writes.js` gain the
    authorship rule.
- The embed gains one action and the identity check behind it;
    `embed.threads.actions-in-context` gains a then-step for Verify's
    presence and absence.
- Rules to write or rework: `threads.lifecycle.*` gains "a note says why
    it exists" and "a finding closes on the verdict"; `status.attention.*`
    changes what a verify item is; `panel.walkdown.*` gains the feedback
    block; `acts-for-a-person` gains the judge-authorship clause. Each is
    a claim change, stamped fresh, not reworded.

## Migration

One pass, run once, recorded as a run with `kind: migration`:

1. Classify every note by the rules in §1. Cited by a run result →
    `finding`. Created by the walkdown feedback box or by a person with no
    `via` → `feedback`. Authored `agent` or `via: agent` and not cited by a
    run → `observation`, unless its body opens with "Decision" or the
    thread is cited as a rule's `origin:` and has no fix in it → `decision`.
    Anchored to a screen with no rule → `request`. The pass writes the
    reason and nothing else; a person may reclassify from the thread's
    screen.
2. Apply §2 to the classified findings against the ledger as it stands.
    Any finding whose rule has been passed by a signed human walkdown
    since the fix closes now, `via: verdict <run>`, named for the signer.
3. Leave the rest where they are. The next sitting works them.

Nothing is deleted or rewritten; every thread keeps its body, its replies
and its ids. Rules whose `origin:` cites a thread are unaffected by that
thread's status.

## What this does not decide

- Whether the 19 open questions need a different surface than they have.
    They are the one queue that is honestly a person's, and 19 is workable.
- Whether the pin popover should also offer Waive. §7 says no, because of
    the reason; a reason box on the popover is a small change if it turns
    out to be wanted.
- The rethink of `via` for the panel's own writes when a person and an
    agent share a browser. n-0139's mark still means what it meant.

## Alternatives considered

- **A bulk-verify screen.** Cheaper to build, and it is what "Verify all
    N" already is. It treats the symptom: the person still has to go
    somewhere to accept things they did not ask for. Rejected.
- **Drop verify altogether; addressed is terminal.** Removes the person
    from the loop on their own feedback, which is the one place the loop is
    worth having. Rejected.
- **Findings never become threads; a fail is only a cell.** Loses the
    place where the judge says what it saw and the fixer says what it
    changed, which is the most-read text in the repository. Rejected.
