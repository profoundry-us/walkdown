# ADR 0004 — A rule is read by a stranger

- **Status:** accepted — drafted by the agent on 2026-09-13 from a walk
  through the board with Topher the same day; accepted by Topher, the
  reword pass done in the same sitting
- **Date:** 2026-09-13
- **Deciders:** Topher (product, eng)
- **Builds on:** the statement / because / history split (n-0286, 2026-09-13)
  and the reword mechanism (`walkdown hash --write --reword`,
  `status.derived.stale-never-passes`), which made rewording a rule cheap
  enough to do twenty-two times in an afternoon
- **Threads:** n-0286 (the split), n-0288 (markdown in threads — the rule
  whose statement started this), n-0290 (timezones — the rule written
  straight into the new shape)

## Context

A rule has three fields of prose: the `statement`, which is the claim and
the thing a verdict is recorded against; `because`, the reason the rule is
worth having; and `history`, what happened that produced it. The split
landed this morning (n-0286). Before it, the statement carried all three,
and rewording any of them put the rule back on the queue, so nobody
reworded anything. The split, and the `--reword` flag that keeps a verdict
across a change of words, removed the cost. What they did not remove was
the habit.

The habit showed up in the first rule written after the split.
`threads.conversation.written-in-markdown` had a 51-word statement that
listed every element the renderer allowed, restated three of its own
then-steps, and closed with "and nothing else in it reaches the page" — a
phrase Topher could not parse and asked to have taken out. It was gesturing
at sanitisation without saying so. The rewrite was sixteen words:

> A message is markdown, rendered from a short list of allowed elements;
> anything else in it is plain text.

That one sentence was the afternoon's whole lesson, and the question was
whether it was one rule or the board. So the board was measured. 132 live
statements; the median was 31 words, the 90th percentile 54, the longest
85. Twenty-two were over 45 words and three ran to three sentences. Seven
`because` fields were over 35 words. Every one of the twenty-two was read
aloud with Topher, and every one had the same faults in some mix:

1. **The statement restated its own then-steps.** The single biggest cause
   of length. A statement would make its claim and then, after a dash,
   append each step as a clause: "- a query naming a story keeps every rule
   in it, a query naming a screen keeps every rule judged on it, a query
   naming one rule keeps that rule alone". Those are steps 3, 4 and 5 of the
   same rule.
2. **A concept stood where the reader wanted a thing.** "read off the tree",
   "written under", "stays visible", "the list it summarises", "provenance",
   "specification". Each time Topher's question was the same — *where?
   under what? which list?* — and each time the fix was the concrete noun:
   *visible in the files themselves*, *every record carries your username*,
   *the session strip*, *the badges on the rules*, *which commit it saw*, *a
   thread, a draft, a run*.
3. **House jargon.** "closed list", "provenance, never currency", "read off
   the ledger", "a third ledger law". Fine in a code comment; a rule is read
   by product and design, and by whoever is deciding whether to adopt the
   tool.
4. **A dash-clause was where the sentence went wrong.** Almost without
   exception. The dash marks the point where a second thought was bolted on
   instead of given its own sentence or moved to a step.
5. **The statement defined its neighbour.** "Whether a verdict counts is
   answered per cell, by the statement it was made against, the check that
   still claims it, and any sweep since" — true, and `status.derived.*`'s
   claim, not `provenance-not-currency`'s. A sentence that would still be
   true with this rule deleted is not this rule's.
6. **A long `because` was carrying something else.** Mechanism ("allocated
   against that directory's own listing"), the neighbour's reason (what git
   commits, in a rule about layout), an analogy, or a general principle ("a
   file that lies") that justifies lint as a whole rather than this rule.

None of this is a schema problem. `docs/02-blueprint-schema.md` says what
each field is for, `lib/templates/AGENTS.md` says the statement is
authoritative, and the formulate skill says a rule is a single verifiable
statement. What none of them said is how a statement *sounds* when it is
right, or how to tell when it has gone wrong. The one line that came
closest — "if a statement needs 'and', it's usually two rules" — was in the
skill for writing new rules, not the guidance for editing old ones, and the
old ones are where the paragraphs were.

## Decision

**A rule's statement is the goal in one breath, written to be read by a
stranger.** The test is literal: someone who has never seen this blueprint
reads the statement alone, with no steps, no because and no history, and
knows what the rule wants. Everything below follows from that test.

### What a statement is

- **One or two sentences, present tense, saying what is true of the built
  thing.** The median on this board is now 29 words. Past 45, or past two
  sentences, it has started doing something else.
- **The steps carry the detail.** If a sentence in the statement could be
  pasted into `then:`, that is where it belongs — and usually it is already
  there. The statement does not enumerate the cases the steps enumerate.
- **Name the thing, not the category.** "Three kinds of record: a thread, a
  draft, a run" — not "specification". "Which commit it saw" — not
  "provenance". The concrete noun is what a first-pass reader keeps.
- **When a sentence says something is shown, kept, read or recorded, say
  where.** The session strip. The badge on the rule. The files themselves.
  Every record. The steps name the anchor; the statement names the place in
  plain words.
- **Plain words over house words.** A term the glossary defines is fine when
  the sentence still reads without knowing it. "Registry" passed; "closed
  list" and "currency" did not.
- **No dash-clauses.** A dash is where a second thought was bolted on. Give
  it a sentence, or move it to a step, or cut it. (Hyphens inside a word are
  not dashes; a colon introducing a short list is fine.)
- **One exception per sentence, stated plainly.** "…reads as stale, unless a
  person declared the rewording as words only" is fine. The original had the
  unless, then an "in which case", then a dash-clause — three exceptions
  stacked on one claim.
- **This rule's claim, and only this rule's.** What some other rule
  requires is that rule's statement. If the sentence would still be true
  with this rule deleted, it is not this rule's.

### What a `because` is

- **The reason the rule is worth having, timeless, in one breath.** The
  median on this board is 17 words. Past 35 it is usually carrying
  something else.
- **Not the mechanism.** How the code achieves it is a code comment.
- **Not the neighbour's reason.** A rule about layout does not explain what
  git commits.
- **Not a general principle.** "A file that lies" justifies lint; it does not
  justify one rule that lint enforces.
- **The stranger test applies here too.** "A blueprint can be a third
  ledger law - read rather than looked at" was a because only its author
  could decode.

### What a `history` is

- **What happened, with its date or count.** A past-tense sentence, a
  thread id, a number ("664 messages"), an afternoon it cost. If a `because`
  has any of those in it, that part is history.
- **Optional.** The `origin:` thread usually carries it. A sentence here is
  for when the rule does not make sense at a glance without one.

### What the tooling does about it

- **Lint warns on the shape.** `statement-reads-as-a-paragraph` fires past
  45 words or three sentences; `because-carries-history` past 35 words.
  Both sit beside `statement-carries-why`. They are warnings, because
  length is a symptom and a person decides; the message says what the field
  is for rather than what number it crossed.
- **Rewording is a `--reword`.** Every change in this ADR was made with
  `walkdown hash --write --reword "<why>"`, so the old hash stays on the
  rule and no verdict went stale. That mechanism is what made a pass over
  the whole board affordable, and it is the answer to "won't this stale
  everything": no, and it never should.
- **The guidance lives where agents read.** A "Writing a rule" section in
  `lib/templates/AGENTS.md` (shipped to every blueprint by `init`; the
  Highball check keeps the in-repo copies matching), a step in
  `walkdown-formulate` that applies the stranger test after drafting, and
  the schema doc pointing here.
- **walkdown holds itself to it.** A rule on this board,
  `ownership.authoring.statement-reads-at-a-glance`, verified by the lint,
  so a paragraph written next month shows up as owed.

## What a rule looks like

Before and after, from the pass. Each was read with Topher; the "after" is
the wording he accepted, and in several the first proposal was sent back.

**`locations.default.one-home-per-blueprint`** — the longest on the board.

> *Before (85 words):* Every blueprint gets a numbered home of its own inside
> the `.walkdown` that answers for it - `.walkdown/blueprints/0002-name/` -
> and two blueprints never share one. No path walkdown resolves is keyed by
> a name somebody else could also choose, and which two config rows are one
> project is answered by where an entry is rooted, never by its id alone.
> Asking where things live allocates nothing; a home that already holds
> records keeps answering for its blueprint; moving one is a decision a
> person makes.
>
> *After (21):* Every blueprint has a numbered home of its own, and no path
> walkdown resolves is keyed by a name two projects could share.

The third sentence was three then-steps verbatim. The `because` was
mechanism ("allocated against that directory's own listing") and became
*A name two projects can both have is not an address; a number allocated
once is.*

**`ownership.writes.spec-never-implementation`** — the category hiding the
thing.

> *Before (51):* Through the review server a browser can write specification
> and only specification - a thread, a draft, a run record. No request can
> create or modify features, prototypes, source or checks, and a write that
> lands anywhere but the resolved threads, drafts and runs directories is a
> breach, not a bug.
>
> *After (29):* The review server lets a browser write three kinds of record:
> a thread, a draft, a run. Anything it writes outside those three
> directories is a breach, not a bug.

Topher read a contradiction in the first draft of the after: "can write
specification" against "anywhere but there". Naming the three kinds and
then the three directories made it one thought.

**`panel.identity.default-actor`** — the concept where the reader wanted
the thing.

> *Before (56):* The identity arrives filled in - the username records are
> written under, and the full name to show alongside it - so no attributed
> action ever asks who you are. The username is the machine's answer and is
> shown rather than typed; the full name is only ever displayed, and stays
> yours to change, from empty.
>
> *After (29):* The panel already knows who you are. Every record carries
> your username, the strip shows your full name beside it, and no action
> ever asks you to type either.

"Written under" — under what? — was sent back once. The fix was to say what
carries the name and where it is shown.

**`status.derived.stale-never-passes`** — the stacked exception.

> *Before (50):* A pass recorded against an older wording of the rule - its
> statement or its steps - renders as stale, never as passing, unless a
> person declared the rewording one of words and not of meaning, in which
> case the old wording still names the rule and the pass stands.
>
> *After (25):* A pass recorded against older wording of a rule reads as
> stale, unless a person declared the rewording as words only, with the
> meaning unchanged.

The first proposal split the unless into a second sentence and Topher read
it as contradicting the first ("never as passing" then "keeps the pass").
The unless was never the problem; the two clauses piled after it were.

**`panel.delivery.stale-server-says-so`** — the sentence only its author
could read.

> *Before (24):* A server left running while the code moves says so itself,
> and the panel wears that the same way it wears a stale copy of itself.
>
> *After (28):* A server still running on code that has since changed says
> so, and the panel shows that with the same badge it uses for a stale copy
> of itself.

Short was not the same as clear. "Wears that the same way it wears" is not
how anyone talks; and its `because` said the server "answers with
yesterday's rules", which Topher could not connect to anything.

## Consequences

- **Twenty-two statements and seven becauses were reworded on
  2026-09-13.** Median statement length went from 31 words to 29; the
  longest from 85 to 44. Every reword kept its hash under `steps.reworded`
  with the same why, so `walkdown status` reads exactly as it did before —
  no cell changed.
- **The number is a tripwire, not a target.** 45 words is where this
  board's paragraphs started; a 40-word statement can still be a paragraph
  and a 20-word one can still be unreadable (`stale-server-says-so` was
  24). Lint catches the shape; the stranger test catches the rest, and it
  needs a person.
- **Reading a rule aloud with someone is the review.** Every fault in the
  pass was found by Topher asking a one-word question — *where? under what?
  which?* — that the author could not have asked, having written it. The
  formulate step says to read the statement alone; it does not replace
  reading it to somebody.
- **Steps got longer, not shorter.** Nothing was deleted from the board;
  what left the statements was already in the steps or belonged there. A
  reader who wants the enumerated cases still has them, one click down.
- **Two rules may want splitting.** `panel.start.which-project` has fourteen
  then-steps under a 37-word statement — the modal's behaviour and what it
  offers are probably two rules. `locations.default.skills-are-yours-by-
  default` hid a second concern ("a harness the project lacks is not
  shipped") that is a step for now. Splitting is a new id and a retirement,
  not a reword, and is left for its own decision.
- **`created_at` and the like are untouched.** This is about prose fields
  only.

## Rules affected

Reworded (statement), all with `--reword`, hashes kept:
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

Rewritten (`because`, unhashed): `delivery.install.clone-is-the-install`,
`embed.pin.anchored-target`, `locations.default.one-home-per-blueprint`,
`locations.default.records-follow-the-spec`,
`panel.delivery.stale-server-says-so`, `panel.rules.grouped-by-screen`,
`status.evidence.agent-assumed`,
`status.acceptance.signoff-defaults-to-eng`,
`threads.conversation.written-in-markdown` (split into because and history).
`screens.ownership.routes-by-page` gained a `because` it had lacked.

Added: `ownership.authoring.statement-reads-at-a-glance`.

## Alternatives considered

- **Leave it to taste.** The board had 132 statements written by one author
  and one agent with the schema doc open, and 22 were paragraphs. Taste
  without a tripwire drifts toward the exhaustive, because every clause
  added feels like precision.
- **A hard word limit as a lint error.** Rejected: length is a symptom.
  `stale-server-says-so` was 24 words and unreadable; `which-project` is
  37 and fine. An error would force rewording under time pressure, which is
  how paragraphs get written in the first place.
- **Rewrite the steps to match, or drop steps the statement covers.** The
  steps are what a check is built from and what a judge drives; they are
  meant to enumerate. The statement is what a person reads first. Different
  readers, different lengths.
- **Put the guidance in the schema doc only.** Where nobody editing a rule
  looks. The template AGENTS.md is read at the start of every session, and
  the formulate skill at the moment a rule is drafted; the schema doc points
  at this ADR for the reasoning.
- **Make the lint smarter — detect step restatement, jargon, dashes.**
  Restatement could be measured (n-gram overlap between statement and
  steps) and may be worth doing later. Jargon and dashes are judgment. The
  cheap warning catches the shape that all of them arrive in, and a person
  reading the flagged rule finds the rest in under a minute.

## How it gets built

1. Lint warnings — landed (133400f).
2. The reword pass — landed in the same sitting, with this ADR.
3. "Writing a rule" in `lib/templates/AGENTS.md`, mirrored to both
   blueprints' copies; a step in `walkdown-formulate`; the schema doc's
   "Rules about rules" pointing here.
4. `ownership.authoring.statement-reads-at-a-glance`, verified by the lint
   test.
