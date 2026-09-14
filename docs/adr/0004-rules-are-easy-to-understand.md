# ADR 0004 — Rules are easy to understand

- **Status:** accepted. Drafted by the agent on 2026-09-13 from a walk
  through the board with Topher. The reword pass was done in the same
  sitting.
- **Date:** 2026-09-13
- **Deciders:** Topher (product, eng)
- **Builds on:** the statement / because / history split (n-0286) and
  `walkdown hash --write --reword`, which keeps a verdict when only the
  words change.
- **Threads:** n-0286 (the split), n-0288 (the rule whose statement started
  this), n-0290 (the first rule written in the new shape)

## Context

A rule has three fields of prose:

1. `statement`: the claim. A verdict is recorded against it.
2. `because`: the reason the rule is worth having.
3. `history`: what happened that produced the rule.

Before n-0286, the statement carried all three. Rewording any part of it
put the rule back on the queue, so nobody reworded anything. The split and
`--reword` removed that cost. They did not remove the habit.

The habit showed up in the first rule written after the split.
`threads.conversation.written-in-markdown` had a 51-word statement. It
listed every element the renderer allowed, restated three of its own
then-steps, and ended with a phrase Topher could not parse:

> **Example (bad):** …and nothing else in it reaches the page.

The rewrite was sixteen words:

> A message is markdown, rendered from a short list of allowed elements;
> anything else in it is plain text.

Was this one rule or the whole board? The board was measured. Of 132 live
statements, the median was 31 words, the 90th percentile 54, and the
longest 85. Twenty-two were over 45 words. Seven `because` fields were over
35 words. All twenty-two were read aloud with Topher. Each had some mix of
six faults.

1. **The statement restated its own then-steps.** This was the biggest
   cause of length. A statement made its claim, then appended each step as
   a clause after a dash.
   **Example (bad):** …a query naming a story keeps every rule in it, a
   query naming a screen keeps every rule judged on it, a query naming one
   rule keeps that rule alone. *(Steps 3, 4 and 5 of the same rule.)*

2. **A concept stood where the reader wanted a thing.** Each time, Topher
   asked a one-word question: where? under what? which list? Each time, the
   fix was a concrete noun.
   **Example (bad):** the username records are written under
   **Example (good):** every record carries your username
   **Example (bad):** what was declared stays visible for the whole sitting
   **Example (good):** the session strip shows that answer for as long as
   the sitting runs

3. **House jargon.** A rule is read by product and design, and by whoever
   is deciding whether to adopt the tool. A word only this codebase uses
   stops them.
   **Example (bad):** read off the tree
   **Example (bad):** provenance, never currency
   **Example (bad):** a third ledger law

4. **A dash-clause was where the sentence went wrong.** The dash marks the
   point where a second thought was bolted on instead of given its own
   sentence or moved to a step.
   **Example (bad):** The counts say what they count and reconcile with the
   list - verified is a count of rules, the work owed to a person is named,
   each owed rule carries a mark so the total can be counted back, and the
   tab carries that total so it is legible from whichever tab is open.

5. **The statement defined its neighbour.** A sentence that would still be
   true if this rule were deleted belongs to some other rule.
   **Example (bad):** Whether a verdict counts is answered per cell, by the
   statement it was made against, the check that still claims it, and any
   sweep since. *(True, and `status.derived.*`'s claim, not
   `provenance-not-currency`'s.)*

6. **A long `because` was carrying something else.** Mechanism, the
   neighbour's reason, an analogy, or a general principle.
   **Example (bad):** …allocated against that directory's own listing
   *(mechanism)*
   **Example (bad):** …a file saying something the report will not do is a
   file that lies *(a reason for lint, not for this rule)*

None of this is a schema problem. The schema doc says what each field is
for. The template AGENTS.md says the statement is authoritative. The
formulate skill says a rule is a single verifiable statement. None of them
says what a good statement sounds like, or how to tell when one has gone
wrong.

## Decision

**A statement is written for a stranger.** Someone who has never seen this
blueprint reads the statement alone, with no steps, no because and no
history, and knows what the rule wants. Everything below follows from that
test.

### What a statement is

- **One or two sentences, present tense, saying what is true of the built
  thing.** The median on this board is 29 words. A statement past 45 words
  or past two sentences is almost always restating its steps.
- **The steps carry the detail.** If a sentence could be pasted into
  `then:`, it belongs there. Usually it is already there.
- **Name the thing, not the category.**
  **Example (bad):** a browser can write specification
  **Example (good):** a browser can write three kinds of record: a thread, a
  draft, a run
- **When something is shown, kept, read or recorded, say where.** The
  steps name the anchor. The statement names the place in plain words.
  **Example (good):** the session strip shows your full name
- **Plain words over house words.** A glossary term is fine when the
  sentence still reads without knowing it. "Registry" passed. "Closed list"
  and "currency" did not.
- **No dash-clauses.** Give the second thought its own sentence, move it to
  a step, or cut it.
- **One exception per sentence.**
  **Example (good):** …reads as stale, unless a person declared the
  rewording as words only.
  **Example (bad):** …renders as stale, never as passing, unless a person
  declared the rewording one of words and not of meaning, in which case the
  old wording still names the rule and the pass stands.
- **This rule's claim only.** What another rule requires is that rule's
  statement.

### What a `because` is

- **The reason the rule is worth having, in one breath.** The median on
  this board is 17 words. Past 35 it is usually carrying one of the three
  below.
- **Not the mechanism.** How the code does it is a code comment.
- **Not the neighbour's reason.** A rule about layout does not explain what
  git commits.
- **Not a general principle.** "A file that lies" justifies lint as a
  whole, not one rule lint enforces.
- **The stranger test applies here too.**
  **Example (bad):** a blueprint can be a third ledger law, read rather than
  looked at

### What a `history` is

- **What happened, with its date or count.** A past-tense sentence, a
  thread id, a number, an afternoon it cost. If a `because` has any of
  those, that part is history.
- **Optional.** The `origin:` thread usually carries it. Write one when the
  rule does not make sense at a glance without it.

### What the tooling does

- **Lint warns on the shape.** `statement-reads-as-a-paragraph` fires past
  45 words or three sentences. `because-carries-history` fires past 35
  words. Both are warnings. Length is a symptom, and a person decides.
- **Rewording is a `--reword`.** Every change in this ADR kept its old hash
  under `steps.reworded`, so no verdict went stale.
- **The guidance lives where agents read.** A "Writing a rule" section in
  the template AGENTS.md, a stranger-test step in `walkdown-formulate`, and
  the schema doc pointing here.
- **walkdown holds itself to it.** A rule on this board,
  `ownership.authoring.statement-reads-at-a-glance`, is verified by the lint
  test.

## What a rule looks like

Before and after, from the pass. Each "after" is the wording Topher
accepted. In two of them the first proposal was sent back, and those teach
the most.

### `locations.default.one-home-per-blueprint`

The longest on the board. The third sentence was three then-steps verbatim.

> **Before (85 words):** Every blueprint gets a numbered home of its own
> inside the `.walkdown` that answers for it - `.walkdown/blueprints/0002-name/`
> - and two blueprints never share one. No path walkdown resolves is keyed
> by a name somebody else could also choose, and which two config rows are
> one project is answered by where an entry is rooted, never by its id
> alone. Asking where things live allocates nothing; a home that already
> holds records keeps answering for its blueprint; moving one is a decision
> a person makes.

> **After (21):** Every blueprint has a numbered home of its own, and no
> path walkdown resolves is keyed by a name two projects could share.

### `ownership.writes.spec-never-implementation`

The category hid the thing. Topher read the first "after" as contradicting
itself: "can write specification" against "anywhere but there". Naming the
three kinds and then the three directories made it one thought.

> **Before (51):** Through the review server a browser can write
> specification and only specification - a thread, a draft, a run record. No
> request can create or modify features, prototypes, source or checks, and a
> write that lands anywhere but the resolved threads, drafts and runs
> directories is a breach, not a bug.

> **After (29):** The review server lets a browser write three kinds of
> record: a thread, a draft, a run. Anything it writes outside those three
> directories is a breach, not a bug.

### `panel.identity.default-actor`

"Written under" was sent back: under what? The fix names what carries the
username and where the name is shown.

> **Before (56):** The identity arrives filled in - the username records are
> written under, and the full name to show alongside it - so no attributed
> action ever asks who you are. The username is the machine's answer and is
> shown rather than typed; the full name is only ever displayed, and stays
> yours to change, from empty.

> **After (29):** The panel already knows who you are. Every record carries
> your username, the strip shows your full name beside it, and no action
> ever asks you to type either.

### `status.derived.stale-never-passes`

The first "after" split the exception into a second sentence, and Topher
read the two sentences as contradicting each other. The "unless" was never
the problem. The clauses stacked after it were.

> **Before (50):** A pass recorded against an older wording of the rule -
> its statement or its steps - renders as stale, never as passing, unless a
> person declared the rewording one of words and not of meaning, in which
> case the old wording still names the rule and the pass stands.

> **After (25):** A pass recorded against older wording of a rule reads as
> stale, unless a person declared the rewording as words only, with the
> meaning unchanged.

### `panel.delivery.stale-server-says-so`

Short is not the same as clear. This one was 24 words and unreadable.

> **Before (24):** A server left running while the code moves says so
> itself, and the panel wears that the same way it wears a stale copy of
> itself.

> **After (28):** A server still running on code that has since changed
> says so, and the panel shows that with the same badge it uses for a stale
> copy of itself.

## Consequences

- **Twenty-two statements and seven becauses were reworded on 2026-09-13.**
  The median statement went from 31 words to 29. The longest went from 85
  to 44. No cell on the board changed.
- **The number is a tripwire, not a target.** `stale-server-says-so` was 24
  words and unreadable. `which-project` is 37 and fine. Lint catches the
  shape. The stranger test catches the rest, and it needs a person.
- **Reading a rule aloud to someone is the review.** Every fault in the pass
  was found by a one-word question from Topher. The author could not have
  asked it, having written the sentence.
- **Nothing was deleted.** What left the statements was already in the
  steps, or was moved there.
- **Two rules may want splitting.** `panel.start.which-project` has fourteen
  then-steps. `locations.default.skills-are-yours-by-default` hides a
  second concern in a step. A split is a new id and a retirement, not a
  reword, and is left for its own decision.

## Rules affected

Reworded with `--reword`, hashes kept:
`locations.default.in-repo-on-request`,
`locations.default.skills-are-yours-by-default`,
`locations.default.one-home-per-blueprint`,
`locations.answer.declared-not-discovered`,
`locations.answer.registry-is-the-only-door`,
`locations.travel.provenance-not-currency`,
`locations.pointer.placed-where-agents-read`,
`ownership.writes.spec-never-implementation`,
`panel.start.choose-a-blueprint`, `panel.start.which-project`,
`panel.rules.takes-you-there`, `panel.rules.counts-legible`,
`panel.rules.search-the-list`, `panel.rules.grouped-by-screen`,
`panel.walkdown.who-signs-is-declared`, `panel.identity.default-actor`,
`panel.signoff.spec-pair-derived`, `panel.delivery.stale-server-says-so`,
`screens.ownership.routes-by-page`, `status.derived.stale-never-passes`,
`status.derived.verdict-belongs-to-a-place`,
`status.acceptance.signature-names-its-signer`,
`threads.conversation.composer-stays`,
`threads.conversation.written-in-markdown`.

`because` rewritten (not hashed): `delivery.install.clone-is-the-install`,
`embed.pin.anchored-target`, `locations.default.one-home-per-blueprint`,
`locations.default.records-follow-the-spec`,
`panel.delivery.stale-server-says-so`, `panel.rules.grouped-by-screen`,
`status.evidence.agent-assumed`,
`status.acceptance.signoff-defaults-to-eng`,
`threads.conversation.written-in-markdown`.
`screens.ownership.routes-by-page` gained a `because`.

Added: `ownership.authoring.statement-reads-at-a-glance`.

## Alternatives considered

- **Leave it to taste.** One author and one agent, with the schema doc
  open, wrote 22 paragraphs out of 132 statements. Every clause added feels
  like precision, so taste alone drifts long.
- **A hard word limit as a lint error.** Length is a symptom. An error
  would force rewording under time pressure, which is how paragraphs get
  written.
- **Shorten the steps to match.** The steps are what a check is built from
  and what a judge drives. They are meant to enumerate. The statement is
  what a person reads first. Different readers, different lengths.
- **Guidance in the schema doc only.** Nobody editing a rule reads the
  schema doc. The template AGENTS.md is read at the start of every session,
  and the formulate skill at the moment a rule is drafted.
- **Smarter lint.** Restatement of steps could be measured and may be
  worth doing later. Jargon and dashes are judgment. The cheap warning
  catches the shape they all arrive in.

## How it gets built

1. Lint warnings. Landed (133400f).
2. The reword pass. Landed with this ADR.
3. "Writing a rule" in the template AGENTS.md, mirrored to both blueprints.
   A stranger-test step in `walkdown-formulate`. The schema doc points here.
4. `ownership.authoring.statement-reads-at-a-glance`, verified by the lint
   test.
