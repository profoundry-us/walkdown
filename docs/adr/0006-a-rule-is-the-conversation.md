# ADR 0006 — A rule is the conversation

- **Status:** accepted 2026-09-18 by Topher; built the same day, to be
    felt before it is refined. Drafted by the agent after a conversation
    that began with "what is the difference between Active and Awaiting
    you?" and ended on a design canvas of the panel's four screens.
- **Date:** 2026-09-18
- **Deciders:** Topher (product, eng, design)
- **Builds on:** ADR 0005 (a thread closes where it was asked), the
    lifecycle in `lib/vocab.js`, the attention list (`status.attention.*`),
    the sign-off tier (`status.acceptance.*`).
- **Supersedes:** ADR 0005 §3's "a request is verified from its own
    screen" and §6's per-thread verify item for requests on a live rule;
    the `detail.threads` cards, `detail.pass-verifies` block and "Verify
    all" button on the rule detail.

## Context

ADR 0005 gave every note a reason and closed a judge's finding and a
person's feedback on the rule's next signed pass. Four days later the
board read: 88 live threads, 36 of them "awaiting you", and Topher pressed
Done on two of them from the wrong tab because they said *Your move* and
showed a Done button, while the walk was about to close them for him.
Asked to lay out every kind of conversation walkdown carries, the answer
was nine rows:

| on the rule | as a thread |
|---|---|
| rule wording (approve / send back) | question |
| verdict (pass / fail) | feedback · finding · observation · request |
| skip / block | decision |

Read by what they ask, the nine are four:

1. **Is this the right rule?** — the wording, a question on the rule, a
    request. Three mechanics for one act, and the rule already has the
    buttons for it.
2. **Something is wrong with the build.** — a fail's why, feedback, a
    finding. All three already close on the person's signed pass.
3. **Agent scratch.** — an observation. 26 of the 88, none of them
    anyone's.
4. **A record.** — a decision. The one that is actually history.

And the faults, in Topher's words: *a rule could fail and need a new
thread that is completely unrelated to a previous thread — on the other
hand, multiple threads about a single rule might point us to the fact
that the rule should be split.* *Isn't an open question on a rule the same
concept as approving a design on a rule? Have we separated two things that
should be the same?* *The 19 open questions are really proposed rules that
need approval — which we already have.*

## Decision

**A rule the walk can reach is the unit of conversation.** Everything said
about it is one stream under it; the rule's verdict is what that stream
waits on; the Threads tab keeps only what has no rule to walk.

### 1. One conversation per rule

The rule detail draws every thread ever filed on the rule as one stream,
oldest first, each thread's opening message tagged with its id, what it is
and its status. Under the stream, one box and one row: Waive alone at the
far left when a note is live, the person's name, Reply, and during a
walkdown the verdict pair last. Words typed there go into the live note as
a reply, or open one when nothing is live. A fail's why does the same and
puts the note back to open, so the agent is owed it again; it never files
a second thread beside the first. Two live notes on one rule is the smell
Topher named — a rule that wants splitting — and nothing hides it.

The thread's own screen stays, reached from the tag: it is still where a
pin's sketch and a question's Answer live.

### 2. The pass ends the conversation

A person's signed pass on a rule verifies **every** note still open or
addressed on it that was said before the pass — feedback, finding,
observation, request alike — under the signer's name, with the run. ADR
0005 closed only the addressed finding and feedback, and left a rule just
passed still carrying live notes its person was queued to press Done on.
The pass is the look; nothing on the rule outlives it. A decision was
never open, so nothing happens to it. A note spoken to after the pass is
not what the person looked at, and stays.

### 3. Nothing on a walkable rule waits as a thread

In the attention list, a thread on a rule the walk can reach never stands
on its own: addressed notes are one `verify` item per rule, naming their
threads; open questions one `answer` item per rule. Neither carries a
`thread`, so the walk lists the rule once and the Threads tab — which
lists what `thread` names — leaves it to the walk. Only a thread on no
rule, or on a retired one, is its own item, and only a person's feedback
or request makes a verify item there.

The composer on such a note offers a person Reply and Waive, whatever its
status. Done is the rule's pass; Reopen is the rule's fail. The turn line
says so.

### 4. The walk is the queue, and it opens the Rules tab

The rules list opens with an *Awaiting you* group: every rule owing you
something, in the order Continue walks them, above the rules grouped by
screen. Each row's owed column says which ask in a word — `asks`
(a question to answer), `fixed` (a claimed fix to judge), `sign` (a
wording), `walk` (a build). The group is the list the badge counts and the
list Continue steps through, by construction.

The Threads tab keeps its three filters. *Awaiting you* and *Active* list
only what the walk cannot reach; *All* lists everything, rule
conversations and ended threads included.

### 5. Waive is "never mind", everywhere you judge

On a rule's composer, Waive waives the live note with a reason, under the
same gate as waiving from the thread's screen: a named person, and words.
On a proposed rule it will mean "this should not be a rule"; on a clean
rule with nothing said, it is the skip. Neither of those two is built yet.

## Consequences

- On 2026-09-18 the Threads badge went from 36 to 15 — the 15 being
    threads on retired rules and on screens with no rule — and the Rules
    badge to 39, with every one of the 39 saying which ask it is.
- `lib/vocab.js`: `closesOnVerdict` is every note but a decision.
    `lib/threads.js`: `closeByVerdict` closes open notes too.
    `lib/status.js`: verify and answer items grouped per walkable rule.
    The panel: `detail.conversation`, `detail.stream`, `detail.turn`, the
    one `detail.feedback` box and `detail.verdict` row; `panel.awaiting-you`
    on the list; `onWalkableRule`, `askOf`, `sayOnRule`, `waiveOnRule`.
- Rules changed as claims, stamped fresh:
    `threads.lifecycle.closes-where-it-was-asked`,
    `threads.conversation.says-whose-move`,
    `status.attention.blocked-queues`,
    `panel.walkdown.pass-verifies-feedback`,
    `panel.walkdown.note-with-any-verdict`,
    `panel.walkdown.verdicts-at-hand`, `panel.rules.talk-without-a-sitting`,
    `panel.threads.own-view`, `panel.threads.claim-never-accept`. New:
    `panel.rules.awaiting-you-first`, `panel.rules.one-conversation`.
- The law holds: no agent writes `verified` or `waived`. §2 is the
    derivation reading a verdict a person signed.
- `panel.walkdown.verdicts-at-hand` no longer claims the verdict is
    visible without scrolling: it sits after the conversation, and a long
    conversation is a scroll. That is the first thing to feel.

## What this does not decide

- **Questions as proposed wording.** Topher's reading is that a question
    on a rule *is* the sign-off act: the agent should edit or draft the
    rule and the person approve or send it back, with the `question` kind
    kept only for what no rule edit can express. Not built: the 19 open
    questions still answer in place from the thread's screen, reached from
    the tag. The next step is a sitting through them, each becoming a
    drafted rule, an edit to one, an incorporated decision, or a waive.
- **A proposed rule's Waive** ("not a rule") and **a clean rule's Waive**
    (the skip): §5 names them; neither has a door yet.
- Whether the 13 threads on retired rules re-anchor to their successors
    (q-0252's re-anchor door) or are waived.
- Whether identical `via: verdict` replies on several threads closed by
    one pass should collapse to one line in the rule's stream.

## Alternatives considered

- **Keep threads as the unit, fix the turn line.** Make the composer's
    "Your move" agree with the attention queue for addressed findings.
    Honest but small: the person still reads one exchange in three places,
    and the Threads tab stays the longer copy of the walk. Rejected.
- **Fail reopens the last thread.** Proposed by the agent, rejected by
    Topher: a fail can be about something new. Answered instead by one
    conversation per rule, where a new subject is a new message and two
    subjects that will not share a stream are a rule to split.
- **A fifth Walk tab.** Drawn first on the canvas; it was the Rules tab
    with a group at the top, and got the name back.
