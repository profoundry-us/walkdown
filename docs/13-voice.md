# 13 — The voice

How prose written into a blueprint sounds: a rule's statement, because,
history and steps, a story's statement, and every word the machine files on a
thread. `docs/10-house-style.md` is how code is written; this is how the words
beside it are. ADR 0004 is where the statement's shape was decided and why;
this page is the voice that shape is written in, and `lib/voice.js` is the
part of it a door can run.

## Who it is for

Every field is written for a stranger: someone who has never seen this
blueprint reads the sentence alone and knows what it wants. Not the person who
wrote it, who already knows; not the person who will build it, who has the
steps. The stranger is product on a Tuesday, or the engineer who joins in a
year.

## What it sounds like

- **One idea per sentence.** Past forty words a sentence is carrying two.
  Split it. Short does not mean clipped: a sentence beats a label with a colon.
- **A dash is where a second thought got bolted on.** A pair of dashes around
  a short aside is punctuation; a dash that starts a second clause is a
  sentence that has not been given its own full stop. Give it one, move it to
  a step, or cut it.
- **Say what is true; do not hedge it.** "Perhaps", "probably", "it seems",
  "essentially" mean the writer has not decided. Decide, or say plainly what
  is not known.
- **Start with the thing.** "Note that", "it is worth saying", "to be clear"
  are throat-clearing. The sentence that follows was the sentence.
- **Plain words over house words.** "Where it came from", not "provenance";
  "whether it is still current", not "currency"; "how it is worked out", not
  "derivation". A glossary term is fine when the sentence still reads without
  knowing it. Code spans and thread ids are names and are never rewritten.
- **A rule speaks about the built thing, never as a person.** "The panel
  shows", not "I can see"; "the ledger holds", not "we keep". A thread is a
  conversation and may say I; a rule is a claim and may not.
- **The statement does not restate the steps.** If eight words in a row of
  the statement appear in a then-step, one of them is in the wrong field.
- **No exclamation marks.** The sentence carries the weight, or it does not.

## Where it is checked

- `walkdown lint` warns, category `voice`, on every rule field and step. A
  warning, never an error: a person decides whether the sentence stays.
- The thread doors refuse the machine's own words that fail it: a body filed
  `--as-agent --reply` or by the machine as author, and whatever `--added`
  puts beside a person's words. A person's words are theirs and are never
  gated. `--as-is` (API `as_is`) files the words unchanged, said out loud on
  the command, so the exception is visible in the shell history rather than
  silent.

The checks are habits, not judgment. A sentence can pass every one and still
be unclear, and a person still reads it; what the gate stops is the shape of
sentence that has failed a stranger every time it was tried.
