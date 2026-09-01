# 08 — Where things live

## Principle: the project declares *what*, the machine declares *where*

A blueprint says what the project must be true of. A person's machine says where that
project's files sit on this disk and who is sitting at it. Those are different kinds of
fact and they belong in different files:

- **`blueprint/walkdown.yml`** — committed, shared, and about the project. What the
  runner is, which targets exist, where the prototype root is *relative to the blueprint*.
- **`~/.walkdown/config.yml`** — personal, per-machine, and about this checkout. Where
  each project's pieces live on this disk, which ports this machine serves on, and who
  you are.

The personal config may never change what a rule *means* or what counts as evidence. It
changes locations and identity, nothing else. Break that and `walkdown status` starts
meaning two different things on two laptops, which is the one failure this whole scheme
has to avoid.

## Default: walkdown writes nothing into your repository

Every path walkdown *writes* defaults to `~/.walkdown`. A project can opt any of them
back into its repository, and for a mature project it should (see below) — but nothing
lands in a working tree because a tool decided it should.

The reason is not tidiness. In this repository, before this change:

| | size | files |
|---|---|---|
| `blueprint/runs/evidence/` | **97 MB** | 626 |
| `blueprint/runs/*.json` | 676 KB | 88 |
| `blueprint/threads/` | 544 KB | 121 |
| `blueprint/features/` — *the spec* | 128 KB | 6 |

The repository was 102 MB, of which **95% was screenshots walkdown took of itself**. A
tool that costs a project a hundred megabytes before it has proved its worth is a tool
that gets removed. Defaulting out means adopting walkdown is free and reversible: delete
`~/.walkdown` and your repository is exactly as it was.

## The two homes

**`~/.walkdown/` — personal.** Per machine, per person, never synced, safe to delete. Any
walkdown state here can be regenerated or is only yours: evidence, drafts, your identity,
which ports this machine uses.

**The repository — shared.** Reviewed in pull requests, versioned alongside the code it
describes, and the same for everyone who clones it. Anything here is a claim the team
makes together.

The question for each artifact is therefore not "is it big?" but **"would a second person
need to see this?"**

### One home per blueprint

Inside the personal home, each blueprint's records live in a directory of their own —
`~/.walkdown/blueprints/<name>/` — **named by the config entry that owns them**. The entry
carries its own `evidence:` and `drafts:` paths, written once when the project is listed,
so the config is the whole record of where a blueprint's records are.

There used to be a second file for this: `blueprints/index.yml`, an allocator handing out
numbered directories, consulted on every resolve and kept in step with the config by hand
and by `walkdown migrate`. It existed because walkdown could not assume a blueprint had
been written down, and because a *person* maintained the config and should not have to do
allocation bookkeeping. Neither premise survives — every blueprint is declared (n-0133)
and `init` writes the declaration — so the entry simply carries its home, and the index is
no longer read.

What the numbers were *for* still has to hold, because a name-keyed home collides exactly
where the default-out design matters most: thirty monorepo packs all named by their
repository's basename, and two blueprints inside one pack (thread n-0124). That is settled
when the entry is written rather than on every resolve. `rememberProject` asks whether
*this spec* is listed — not whether the name is taken — so listing a second `app` writes a
second entry under `app-2` with a home of its own, and listing the same blueprint twice is
a no-op.

Two rules keep it honest. **Asking writes nothing** — `walkdown where` on a blueprint
nobody has listed derives a home from its id and leaves the disk alone; there is nothing
left to allocate, so answering cannot write. **An existing ledger is a fact** — a legacy
`projects/<id>/` home keeps answering, marked as legacy, and `walkdown migrate` writes its
address into the config rather than moving it. Migration moves nothing at all now: a home
no entry claims is reported and left standing, and the index file is left for its owner to
delete.

## What each artifact is, and where it starts

| Artifact | Default | Opt into repo | Why |
|---|---|---|---|
| Evidence (screenshots) | `~/.walkdown` | discouraged | Binary, unreviewable in a diff, and 95% of the weight. Nobody has ever read one in a pull request. |
| Run records | **follows the spec** | **encouraged** | Small and append-only. Beside the spec they become the team's shared board. |
| Threads | **follows the spec** | **encouraged** | Human conversation and the reasons behind decisions — the same argument as the spec. |
| Spec (features, storyboard) | `~/.walkdown` | **strongly encouraged** | Versioned beside the code is the whole premise: a spec that drifts from its build is the problem walkdown exists to solve. |
| Drafts (a sitting in progress) | `~/.walkdown` | never | Half-finished judgment belonging to one person at one moment. |
| Prototype | wherever it is | — | Design owns it and may keep it in another repository entirely. |
| Identity and roles | `~/.walkdown` | never | About a person, not a project. |
| This machine's target URLs | `~/.walkdown` | never | The blueprint declares the address the project means; the machine declares the port it happens to be serving on. |

## Opting in, and why you eventually should

A blueprint kept outside the repository still works completely — but it gives up three
things, and they are the three the tool was built for:

1. **Review.** A change to a rule is a change to what the team agreed to build. In the
   repository it arrives as a diff somebody approves. Outside it, it arrives silently.
2. **Atomicity.** "This commit changes the rule and the code that satisfies it" is a
   sentence you can only write when both are in one commit.
3. **History.** `git blame` on a statement answers *when did we decide this, and why*.

So the recommended end state for a project that has decided to keep walkdown is: **spec
and threads in the repository, runs in the repository, evidence outside it.** That is the
shape this project itself uses — walkdown's own blueprint is committed, and it is the
worked example of the configuration below.

The default is out because adoption should be free, not because staying out is better.

## `~/.walkdown/config.yml`

```yaml
identity:
  username: topher          # what records are written under, forever
  name: Topher Fangio       # what the UI shows; recorded nowhere
  roles: [eng, product]     # the roles this person may sign for

defaults:
  # {id} is the project id below. These are where a project's pieces go
  # unless the project names somewhere else.
  spec:     ~/.walkdown/projects/{id}/blueprint
  runs:     ~/.walkdown/projects/{id}/runs
  threads:  ~/.walkdown/projects/{id}/threads
  evidence: ~/.walkdown/projects/{id}/evidence
  drafts:   ~/.walkdown/projects/{id}/drafts

projects:
  - id: walkdown
    # Which working trees this project answers for. `walkdown` run from
    # anywhere inside one of these resolves to this project.
    roots: [~/Development/profoundry/walkdown]
    # This project keeps its spec, threads and runs in the repository —
    # the recommended shape. Evidence stays out.
    spec:    ~/Development/profoundry/walkdown/blueprint
    threads: ~/Development/profoundry/walkdown/blueprint/threads
    runs:    ~/Development/profoundry/walkdown/blueprint/runs
    targets:
      local: { base_url: http://localhost:4700 }   # this machine's port, not the team's
```

Resolution order for any path, first hit wins:

1. an explicit flag (`--dir`, and per-kind overrides)
2. the matching `projects[]` entry
3. **a directory the blueprint already has** — `blueprint/runs`, `blueprint/threads`,
   `blueprint/drafts`, `blueprint/runs/evidence`
4. `defaults`, with `{id}` substituted
5. the built-in default — **beside the spec** for runs and threads,
   `~/.walkdown/projects/{id}/…` for evidence and drafts

Rule 3 is the one that keeps an upgrade from being a data loss, and it deliberately
outranks `defaults`: a blanket default is a *preference*, and an existing ledger is a
*fact*. A preference must never silently point past one — moving a ledger is a decision
somebody makes, not something a config file does on their behalf.

The test in rule 3 is **exists**, not "holds records". `drafts` is created empty but for a
`.gitignore` and the writers still write there, so a resolver that required records would
name a location nothing uses — and a `walkdown where` that is confidently wrong is worse
than no `walkdown where` at all.

For the spec itself, rule 3 is instead the existing upward search for
`blueprint/walkdown.yml`: an in-repo blueprint keeps working with no personal config at
all, which is what makes this backwards compatible.

A project is matched by walking up from the working directory until a `roots` entry
matches — the **most specific** one, when several do.

### More than one blueprint in a repository

A repository can hold several. This one holds two: `blueprint/` (walkdown) and
`example/blueprint/` (walkdown-example), and they are separate projects with separate ids,
separate ledgers and separate conversations.

**The nearest blueprint wins.** A blueprint found in the tree beats a configured entry when
it sits deeper than the root that entry matched on — otherwise an entry rooted at the whole
repository answers for every sibling inside it, and standing in `example/` reports the
outer project's spec, runs and threads. An entry still wins where the tree has nothing to
offer, which is exactly the case a spec kept outside the repository is about.

To pin a sibling's locations, give it its own entry with a narrower `roots`. Two entries,
one rooted at the repository and one at a subdirectory, resolve to the subdirectory's when
you are inside it.

### Runs and threads follow the spec

They are the same *kind* of thing the spec is: claims a team makes together, worth
reviewing, worth `git blame`. A spec in a repository with its conversations outside would
let a second person clone a project and find no record of why anything was decided —
and the argument for keeping them out was never about size. Runs and threads are 716 KB
here against evidence's 97 MB; evidence was **135× everything else put together.**

Following the spec also makes opting in **one decision instead of four**. Move the spec
into the repository and its ledger and conversations come with it; evidence and drafts do
not, because neither is a claim and neither belongs in a diff.

### Where this stands

`walkdown where` prints the resolver's answer for every path, with the reason each was
chosen, and writes nothing. `walkdown where <kind>` prints one path alone, for scripts.

**Evidence is fully wired.** It is written to the resolved root, and served from it — and
because a run record's `runs/evidence/…` is a *logical key* rather than a filesystem path,
moving evidence needs no run record edited, which the append-only law would have forbidden
anyway. The server tries the configured root first and the blueprint second, so records
written before any of this still find their screenshots.

This repository has done it: 97 MB and 626 screenshots now live under
`~/.walkdown/projects/walkdown/evidence`, and the spec, threads and runs stayed put. Note
what that does *not* do — git history still holds every blob, so `.git` does not shrink.
It stops growing, which is the part worth having; shrinking it means rewriting history,
which is destructive and nobody's decision but the owner's.

**Everything is wired.** `loadBlueprint` reads runs and threads from the resolved
locations, and `run-record.js` and `draft.js` write to them — so every reader and writer
in the project agrees with `walkdown where` by construction rather than by coincidence.
Finding a blueprint is a question about where things are, so it is `locations.js` that
answers it — and since walkdown stopped searching the tree, the answer is a lookup in the
config rather than a walk (n-0133).

`walkdown move <kind> --to <path>` relocates one kind and records the choice. It moves
files and never edits one; a destination that already holds records is refused rather than
merged, because two ledgers in one directory would be an edit of both however the files
got there.

`walkdown init` puts the spec **outside the repository** unless given `--in-repo`, and
says out loud which it did. It no longer scaffolds `runs/`, `threads/` or `drafts/` — every
writer creates its own directory on demand, and a tree full of `.gitkeep` files is a
project carrying walkdown's furniture before it has decided to keep the tool.

Both test suites pin `WALKDOWN_HOME` at a scratch directory. Locations resolve from a
personal config, and a suite that read the developer's own would pass or fail depending on
whose laptop ran it.

### Project ids

The id is the key for everything above, so it has to be stable across time and
meaningless to no one. In order of preference:

1. `project:` from the blueprint's own `walkdown.yml` — already exists and is already
   the project's name for itself.
2. Failing that, the basename of the root, slugified.
3. On collision, the id gains a short suffix from the root path's hash, and the config
   records it explicitly so it never moves again.

Ids are written into `config.yml` on first use rather than derived fresh each time. A
derived id that quietly changes when a directory is renamed would orphan a project's
whole ledger.

## Identifying a spec: a content hash, not a git sha

Runs currently carry `git_sha` and `blueprint_sha`, and both are set to the same thing:
the repository's HEAD. That conflates two questions, and outside a repository it answers
neither.

- **`git_sha`** — *what code was running?* Keep it, when there is a repository. Omit it
  when there is not.
- **`spec_hash`** — *which version of the spec was this run made against?* This should be
  a hash of the spec's own content, and it should be that whether or not the spec lives in
  a repository.

A content hash is a small amount of work, because the machinery already exists.
`lib/hash.js` is thirty lines and already canonicalizes text before hashing so that
re-wrapped YAML and folded scalars hash identically. A spec hash is the same idea one
level up:

- take the blueprint's own files — `walkdown.yml`, `storyboard.yml`, `features/*.yml`
- sort by path relative to the blueprint root, so directory order cannot change the answer
- feed each as `<relative path>\n<canonicalized content>\n` into one sha256
- store it truncated, in the same `sha256:…` form rules already use

Runs, threads, drafts and evidence are **not** part of it. They are what the spec produces,
not the spec.

This is worth doing even for projects that keep everything in the repository, because
`blueprint_sha` is wrong today in a way nobody has noticed: it changes on every commit,
including commits that do not touch the blueprint. It can tell you *when* a run happened
but not *what it was judged against*, which is the only thing it was ever for. Per-rule
`statement_hash` is unaffected — that answers a narrower question (has this rule's wording
moved?) and keeps answering it.

### The code's sha, when the spec has moved away from it

`git_sha` is computed by shelling out to `git rev-parse` in a directory, so it does not
care where the blueprint lives — only which directory it is asked about. That is what
`roots:` is for: it names the working trees a project answers for, so the sha describes
**the code under test** while `spec_hash` describes the spec, wherever that sits.

A dirty tree is the common case, not the edge one: most runs happen mid-edit. Today such a
run records `abc123-dirty`, which means "some unknown superset of `abc123`" — you cannot
check it out, and you cannot tell two dirty runs apart. So runs also carry:

```
tree_hash: sha256 of `git diff HEAD`, when the tree is dirty
```

Three lines, no new failure modes, and it answers the question people actually ask — *were
these two runs against identical code?* — rather than the rarer *can I reconstruct exactly
what ran?* (`git stash create` would answer that one, by minting a real commit object for
the dirty tree without touching HEAD or the index, but it writes objects that then need a
retention policy, for a case that comes up seldom.)

**There is no post-commit hook, and there will not be one.** The hook people reach for
would go back and re-stamp earlier runs with the commit that eventually contained them —
which is editing the ledger, and `status.derived.latest-wins` says no run file is ever
edited or deleted. A hook could legally *append* a record sealing "runs X to Y became
`abc123`", but that is bookkeeping nobody reads. Hooks are also per-clone and silently
absent when they fail, which this project has already been bitten by once.

## Currency: what makes a verdict stop counting

`git_sha` and `tree_hash` are **provenance, not currency**. They answer *where do I go and
look?* They must never be what decides whether a verdict still counts, because most commits
do not touch the code any particular rule depends on — drive staleness from a repository
sha and every commit invalidates every rule at once, and a board that is entirely stale is
a board nobody reads.

Currency is decided per cell, and each cell has its own conditions:

| Cell | Stops counting when |
|---|---|
| A checks verdict | the statement moves, or the check that produced it moves |
| An agent verdict | the statement moves, or a sweep names the tier |
| A role's signature | the statement moves |

The statement half exists today. The sweep exists. The check half is the roadmap's
*staleness in both directions*: have the run record carry the hash of the check that
produced the verdict, the way it already carries `statement_hash`.

Note what is **not** in that table: a code change invalidates nothing by itself. If a
change breaks something a check can see, the check fails the next time it runs. If it
breaks something no check can see, no hash was ever going to notice — which is what the
agent tier and sweeps are for.

### What a green check licenses, and what it does not

It is tempting to read the table above as: *if the check still passes, the code cannot have
broken the rule, so the signature stands.* That is right to exactly the extent the check
covers the rule, and walkdown deliberately never assumes it does. A check covers **what it
asserts**; a statement is almost always broader — anything phrased as *reads as*, *stands
out*, *is legible*, or *is not mistaken for* has a part no assertion reaches.

This project has a worked example. `panel.rules.tiers-at-a-glance` carried a check that
asserted every tier mark and every signature slot against the ledger's own answer. It
passed continuously while a stale signature was being drawn as a slightly smaller version
of a current one — unreadable in the only situation that matters, a slot with no neighbour
to compare against. The check could not see it, because both shapes were structurally
distinct and the defect was that they differed only in degree. A person looking at the
board found it. The check that now guards it had to be written to assert something a DOM
comparison *can* see — that no two states differ only in size — and even that is a proxy.

So: a green check means the asserted part still holds. It is not a claim about the rest,
which is why `ownership.evidence.same-surface` refuses a check the right to claim a rule
whose behaviour it does not exercise, and why the cheapest tier is described there as the
one most able to lie. It is also why the agent tier is assumed on every rule rather than
opted into — see [00-vision.md](00-vision.md) on the ladder. The tiers exist *because* a
check does not cover a statement.

The safety valve is the one that needs no machinery: **a person can fail any rule at any
time.** The ledger is append-only and latest-wins, so somebody who notices a rule is broken
records a fail and the board says so from that moment. No staleness rule has to predict it,
and none of the hashing above is trying to.

## Signing for more than one role

Acceptance is per role, and one person may hold several. The common shape today is an
engineer running the walkdown with the product person beside them, talking through each
rule and signing for both at once; on a single-person project the same person is simply
both. Both are recorded honestly: the run carries the roles its signer was acting in, and
`identity.roles` above is the list of roles this person may claim.

The boundary is that a person claims only roles they actually hold. Recording product's
signature when product was not there and did not agree is exactly the lie the role model
exists to prevent — it is not made honest by being convenient.

## Migration

Existing projects keep working untouched: an in-repo `blueprint/` is still found by the
directory search, with or without a personal config. For a project that wants to move:

- `walkdown where` prints every resolved path and which rule resolved it
- `walkdown move <what> --to <where>` relocates one kind of artifact and rewrites the
  config, leaving the ledger's contents alone — a run record is never edited, and moving
  the file it lives in is not editing it

Evidence paths inside existing run records are relative to the blueprint root, so moving
evidence needs a rewrite of those paths or a resolver that tries the configured evidence
root first. The resolver is the better answer: it leaves the append-only ledger genuinely
untouched.

## The one thing walkdown still writes into your repository

Everything above moves records out of the tree. One thing stays in it and must: the
**pointer** — a short paragraph in whichever file this project's AI agents read, saying
that a spec exists and where it is.

It has to be in the repository because that is the only place an agent looks. And it
matters more now than it used to, not less: with the spec outside the tree by default,
the pointer is frequently the *only* trace of walkdown a cloned project has. An agent
that never finds it builds against nothing.

But *which* file is not walkdown's to decide. Different tools read different names
(`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`), a monorepo
wants it beside the pack it describes rather than at the root, and most projects
walkdown arrives in already have one of these files with a person's own words in it.

So walkdown treats it as a location like any other — found, not assumed:

- **The block is fenced** between `<!-- walkdown:begin -->` and `<!-- walkdown:end -->`.
  walkdown reads and rewrites what is between them and touches no other line, so a file
  full of somebody's conventions stays theirs. Rewriting rather than skipping is what
  lets a **moved spec correct its own pointer**: `walkdown pointer` after a `move` and
  the paragraph names the new place. A block that still says `blueprint/` after the spec
  left is worse than no block, because an agent believes it.
- **`walkdown init` places it only when there is no question.** No agent file at all, so
  nothing to disturb: it writes `CLAUDE.md`. Exactly one, so the project has already
  answered: it uses that one. Several: it names them and writes nothing, because picking
  wrong puts the sentence where nobody reads it and writing to all of them is noise.
- **`walkdown pointer`** prints the block for anyone to paste, and `--into <file>` places
  it idempotently anywhere — including a file walkdown has never heard of.

In a monorepo, point `init` at the pack: `walkdown init --dir packs/billing` puts the
pointer beside the code it describes. Root-level discovery deliberately does not go
hunting through subdirectories for a home — a search that guesses which of thirty packs
a spec was about will guess wrong.

## What the setup wizard reads

The wizard is a later document, but it exists to write exactly this file. It should ask
five things and nothing else:

1. Who are you, and which roles may you sign for?
2. Where is this project's spec, or shall I make one?
3. Keep the spec and its conversations in the repository? *(recommend yes, explain why)*
4. **Which file do this project's agents read?** — offered as the files actually found in
   the tree, plus "somewhere else" and "nowhere, I will paste it myself". This is the one
   question walkdown genuinely cannot default its way out of, and it is the natural
   question for the agent running the wizard to answer *for* the person: it is standing
   in the repository, it can see which files exist and which are actually loaded, and it
   knows which one it read to get here.
5. Which ports does this machine serve on?

Everything else has a defensible default, and a wizard that asks about a defensible
default is a wizard people cancel.
