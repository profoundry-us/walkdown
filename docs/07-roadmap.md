# 07 — Roadmap

**Snapshot of 2026-08-26.** Everything here is perishable by design. The nine problems in
[00-vision.md](00-vision.md) barely change; which of them are solved changes constantly,
and mixing the two is what turns a vision document into something nobody opens. When this
file disagrees with the code, the code is right and this file is out of date.

## Where the nine stand

| # | Problem | State | What carries it today |
|---|---|---|---|
| 1 | Remembering what we agreed to build | **partial** | Blueprint files; the `walkdown-formulate` skill; `lint`. No `extract`. |
| 2 | Noticing when the PRD or prototype moves | **weakest** | Threads, `origin`, statement hashing. Nothing watches either source. |
| 3 | A deterministic spec for agents | **solid** | `status --json`, `AGENTS.md`, the three skills, the attention queues. |
| 4 | Why a decision was made | **partial** | Threads + `origin: thread:<id>` + the runs ledger. No way to say a source was superseded on purpose. |
| 5 | How closely the build matches the design | **solid** | The panel: fade dial, ghosted design, viewport presets, element-anchored pins, stand-in app. |
| 6 | Design records changes, an agent makes them | **blocked** | Half works (screen-anchored threads, `proposals/`, lint routing). The other half is forbidden — see below. |
| 7 | A QA pass that is more than eyeballing | **solid** | `verify: [checks, agent, human]`, `walkdown-judge`, an agent may never write `verified`. |
| 8 | Feeding tickets and design docs | **not ours** | An agent reads the spec and drafts them. No feature. |
| 9 | Phases and quarters | **planned** | Separate blueprints, which the server and panel already support. |

## Decisions already taken

- **Tickets are an agent's job, not a feature (8).** Ask an agent to read the spec and the
  technical design docs and propose the tickets. This works because the spec is plain text
  in the repo — no API, no auth, no export — so every downstream artifact is a projection
  an agent can produce on demand and re-produce when the spec moves. A spec behind an API
  would need an integration per artifact; a spec in files needs a prompt.
- **We do not detect work no rule asked for.** Coverage runs one way on purpose. "Does
  this rule have a check?" has a right answer; "does this check have a rule?" answers *no*
  for most tests in any mature suite, and a report that fires on thousands of legitimate
  tests is one nobody reads.
- **Screenshot comparison stays a non-goal**, as [00-vision.md](00-vision.md) already says.
  Element anchoring survives a redesign; a pixel diff does not.
- **The blueprint says *what*, never *how*.** Technical design documents are generated
  *from* it, never stored *in* it — a rule that specified the implementation could not be
  verified against a different implementation of the same behaviour.

## Candidates, roughly in order of what they cost us

### `extract` — the biggest hole in the tool

"Extraction is a merge, not an export" is a founding principle and no part of it is
implemented. Nothing reads the PRD; nothing notices a redrawn prototype. Drift only names
screens with *no* design, never one that quietly changed. Formulation happens through a
skill and a conversation, which works once — but there is no second run to diff against
the first, which is the whole point of the principle.

This is what problem 2 is waiting on, and problem 1's remaining half.

### The designer's queue, and who may edit `prototype/`

Problem 6 and the open half of [issue #2](https://github.com/profoundry-us/walkdown/issues/2)
are one problem. An open note routes unconditionally to the agent queue, including a
design request an agent must not act on — and `AGENTS.md` says *never edit prototype/*, so
an agent cannot make the change a designer just recorded.

Two questions, and the second is the real one: where does a design request queue, and does
the ownership rule become conditional on who is staffing design — a person, an agent, or a
person working with one? "Never" is easier to obey than "unless you are the design agent".

### Milestones as a first-class thing

Problem 9. Separate blueprints carry it today and that is a supported topology, not a
hack — the server discovers siblings, the panel switches between them, `claims` routes a
page to the right one. What it costs is a view across phases and rules that need to move
between them.

Open question worth deciding first: **should the roadmap live in the spec rather than in
this file?** A milestone that owns stories — "these belong to Q3", "this milestone has no
deadline" — would make phase membership derived and queryable like everything else, and
would make this document a projection of the blueprint instead of a hand-maintained page.
That is a larger idea than a `milestone:` field and wants thinking through.

### Staleness in both directions

Today a reworded rule invalidates its recorded verdicts automatically, and the panel draws
the stale ones. What nothing catches is the reverse: a test edited after the fact, still
carrying a green verdict earned by the version before the edit.

`lint` has a scanner for half of this already — it reads the files under
`authoring.location` for a rule tag with a statement hash beside it and warns when the
hash has moved. It is wired and pointed at `checks/` and `test/`, and **not one check in
this repo carries the hash**, so it has never fired.

The version that needs no discipline: have the run record carry the hash of the check that
produced the verdict, the way it already carries `statement_hash`. A result already names
its check files. Then a verdict is current only when *both* the statement and the check are
unchanged, staleness stays derived rather than stored, and nobody has to remember to update
a field. Hashing granularity is the open question — whole file is coarse, per-test needs
language knowledge, and the per-framework adapters are where that knowledge already lives.

### Documentation that raises its hand

User documentation is another projection of the spec and rots the same way a test does. A
doc page citing the rule ids and statement hashes it was written against is exactly the
shape the existing scanner reads, so the same one convention would keep tests and docs
honest together. Cheap, once the convention above exists.

### A name for "the build won"

Problem 4's missing half. When we knowingly leave the PRD or the prototype behind, a rule
should be able to point at the thread where that was decided — one field, one hop to the
conversation, and it clears the drift report at the same time. `superseded_by` is the
natural name and is already taken for a rule retired by a split ([02](02-blueprint-schema.md)),
so this needs its own.

Not urgent: nobody has hit it yet. Worth building the day someone does, when the shape will
be obvious rather than guessed.

### Rules for behaviour with no screen

Headless rules already cover API behaviour, jobs, and policies. What has no vocabulary is a
*sequence* across systems — the user does X, a flag is set through the API, an email goes
out three days later. Rules can name a flow across screens; they cannot name a flow across
services. Worth thinking about before it is needed rather than after.
