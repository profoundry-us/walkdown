# 08 — Where things live

## Principle: the project declares *what*, the machine declares *where*

A blueprint says what the project must be true of. A config says where that project's
files sit and who is sitting at it. Those are different kinds of fact and they belong in
different files:

- **`blueprint/walkdown.yml`** — committed, shared, and about the blueprint. What the
  runner is, which targets exist, where the prototype root is *relative to the blueprint*.
- **`<repo>/.walkdown/config.yml`** — committed, shared: the **manifest**. Which
  blueprints this repository declares and where their homes sit *relative to the
  repository*. Read by `walkdown import` when somebody registers the checkout, and by
  nothing else.
- **`~/.walkdown/registry.yml`** — personal, per-machine, written only by walkdown: the
  **registry**. Every blueprint this machine knows about, each row saying where its home
  is on this disk, which project it came from, and how it arrived. The one file a reader
  consults (ADR 0003).
- **`~/.walkdown/config.yml`** — personal: who you are, and any `defaults:`. It registers
  nothing.

A config may never change what a rule *means* or what counts as evidence. It changes
locations and identity, nothing else. Break that and `walkdown status` starts meaning two
different things on two laptops, which is the one failure this whole scheme has to avoid.

## A home

Every blueprint lives in a **home**: one numbered directory holding the spec and the four
kinds of record it produces, as siblings —

```
blueprints/0001-acme/
├── blueprint/     the spec — walkdown.yml, storyboard.yml, features/
├── threads/       the conversation about it
├── runs/          what a machine or a sitting said about a build
├── evidence/      the screenshots those runs point at
└── drafts/        one person's half-finished sitting
```

One layout, wherever the home sits. That is what lets a home move between the two
`.walkdown` directories below as a single directory, with no record rewritten — and it
is what lets a three-line `.gitignore` say which siblings git gets.

The number is allocated against the listing of the `blueprints/` directory the home is
made in, and the listing *is* the record: there is nothing to keep in step. The name after
the dash is only so `ls` reads well. Nothing walkdown resolves is keyed by a name two
blueprints could share — that derivation, in each of six costumes, was the ancestor of every
collision this module has had (n-0124 through n-0160). Why numbering works here when the
deleted registry's numbering did not is n-0155: an allocator only works when every
claimant can see the others' claims, and two committed configs in two repositories cannot
see each other, while a hand-written one never passes through an allocator at all.

## The three arrangements, and where the home sits

These three, and the move of the default home back to `~/.walkdown`, are recorded as
n-0163 — which supersedes n-0154 (why the files lived beside the code) and n-0157 (why two
commit standards rather than one flag). Both of those describe an arrangement walkdown no
longer has; they are kept because the ledger is append-only and the reasoning is still
worth reading against this one.

**Nothing committed — the default.** The home is `~/.walkdown/blueprints/NNNN-name/`. The
repository gets *nothing*: no `.walkdown/`, no ignore rule, not even a pointer. Trying
walkdown alters no tree, and abandoning it is deleting one directory in your own home.
The entry that named it stays in your config and `walkdown blueprints` shows the home gone;
its number is never handed to the next same-named repository (n-0170).

```
walkdown init
```

**The spec committed.** The home is `<repo>/.walkdown/blueprints/NNNN-name/`, and beside
it `<repo>/.walkdown/.gitignore` holds three lines:

```
blueprints/*/runs/
blueprints/*/evidence/
blueprints/*/drafts/
```

The spec and its threads are git's; what a machine or one person produced is not. That
file, and `config.yml` next to it, are themselves committed — the standard is something a
clone receives.

```
walkdown init --commit spec
```

**Everything committed.** The same home, and no `.gitignore` at all. Runs and evidence
arrive in pull requests, which is a thing a team can genuinely want and should not have
to assemble by hand — a negation chain in git is easy to write wrong, and a wrong one
silently commits nothing or everything.

```
walkdown init --commit all
```

Nothing records which arrangement a project chose. **The tree is the answer**: a home
under `~/.walkdown` is nobody's diff; a home under the repository's `.walkdown` is git's
except for what the `.gitignore` beside it keeps out; no `.gitignore` there means all of
it. `walkdown where` reports it on a `tracked` row by looking. There used to be a flag
that wrote ignore rules once and could not be asked to write them again, so changing your
mind printed success and changed nothing (n-0158).

### Changing your mind

The same command, again. Between `spec` and `all` it writes or deletes the one file.
Between `none` and either of the others it **moves the home whole** — spec, threads,
runs, evidence, drafts, one directory — claims a fresh number in the receiving
`blueprints/`, and rewrites what says where it is: the registry row is re-pointed at the
new home, and the repository's manifest gains or loses its row. Leaving the repository
also takes the pointer back out of `CLAUDE.md` (only the fenced block, or the file if the
block was all there was) and the skills back out of `.claude/skills/` — walkdown's own
unedited copies; one you edited is kept and named (n-0166).

The registry row is written **into**, never beside. A row that already names the project
— a port override, evidence moved elsewhere on this disk — is re-pointed when the home
moves and keeps what it had; it does not get a `repo-2` twin, and nothing it said is
dropped on the way in or out (n-0171, n-0173). Writers ask the same question the picker
asks: same id, and a project canon-equal to the checkout's.

The command refuses before it moves anything when a move could not be written down: a
registry or manifest that does not parse stops it with the file named, because a home
moved and then not registered is the split n-0172 saw.

walkdown never touches the git index. An ignore file rules only what git has not met, so a
run committed under `all` stays tracked after `--commit spec` writes the file. The command
asks git, every time, and says what is still tracked and that `git rm --cached` is yours
to run (n-0164).

**What is tracked is git's answer, never the ignore file's.** The file walkdown writes is
a promise; git holds the fact, and the two part company in ways no reading of the file can
see: a root `.gitignore` that hides `.walkdown/` entirely, a rule that does not reach a
blueprint standing elsewhere in the tree, an ignore file somebody emptied, a home that
left the repository with its files still in the index. So `walkdown where` and `init`
ask git about the spec and each record kind at the paths the resolver actually answered
with — tracked, ignored by which file and line, or neither — and print that as the
`tracked` row, beside what the tree promised. Leaving the repository says how many files
git now holds as deletions rather than "nothing was added" (n-0179, n-0180, n-0181).

Where the promise and the fact disagree, **`walkdown lint` errors**, because a project
that is not set up the way it says is the one thing this tool exists to make loud: a rule
hiding the spec or its threads from git (a clone gets no blueprint); a record kind kept
out by some file other than `.walkdown/.gitignore`, or kept out at all when there is no
such file; an ignore file present that keeps nothing out; a rule in it that git does not
apply to this home's records. Records committed before the rule was written are a
warning, with the `git rm --cached` that clears it — a known, transitional state rather
than a misconfiguration.

## The registry is the only door

**`~/.walkdown/`** — personal. Per machine, per person, never synced. `registry.yml`,
the list of every blueprint this machine knows about; `config.yml` with your identity;
`blueprints/` with the homes of blueprints that commit nothing; `cache/` for what walkdown
can rebuild (the claims index).

**`<repo>/.walkdown/`** — the repository's, and there may be several: a monorepo pack can
carry its own. Committed or ignored as the arrangement above says. Its `config.yml` is a
manifest: it declares what the checkout holds, and *a manifest registers nothing*. A
fresh clone that declares a blueprint is not a project on this machine until somebody
runs `walkdown import .` in it.

**A reader consults the registry and nothing else.** No `.walkdown` is found by walking
up from where you stand; no path is resolved on read. Standing somewhere picks among the
registered rows by containment — the rows whose `project` contains the working
directory, the deepest winning where a pack is registered inside its repository, a
question (answered with `--blueprint`) when several rows share one project. A scratch
copy is never picked by standing somewhere. Naming a blueprint outright, with
`--blueprint <id>`, picks its row. Nothing about the tree between the rows is consulted:
a pack carrying its own `.walkdown` is its own row, and a checkout nobody registered is
nothing — however much it looks like a project from the outside, and however many links
point into it. That last is what n-0275 found the walk could not promise: a symlink
outside a pack walked through the boundary on the read side while the writer refused the
same path. There is no read-side path left for a spelling to fool.

The one moment a path is looked at is the add. `walkdown import` canonicalises what it is
handed — through a link, through `/var` where the process knows `/private/var` — and
writes the real path once; a second import of the same home, under any spelling, says it
is already listed. A row in the registry that nothing wrote (no `registered:`) is set
aside and named on the report with the command that registers it.

A server offers what the registry holds — every blueprint this machine knows about,
wherever the server was started — and names, as the folder it is serving, the registered
project containing its working directory. The server and the panel tell blueprints apart
by **where the spec is**, never by id: each blueprint the server offers carries a `key`,
the canonical spec directory; `?bp=` accepts a key, or an id when exactly one blueprint
answers to it, and refuses a bare id two answer to with the candidates named rather than
picking one (n-0173). The same page opens what the rest of its address names:
`?rule=<id>` lands on that rule's detail and `?thread=<id>` on that thread over its rule,
with or without a page to review in the fragment — the address an id beside a pin, or in
a run record pasted anywhere, links out to (n-0297). `GET /api/blueprint` answers with the
`key` it resolved, so a page that never said which blueprint it belongs to can still name
it when it links out.

Identity is never taken from a manifest. A committed file naming a person would be wrong
on every machine but one.

## Every blueprint is registered

There is no `--dir`, and walkdown does not search the tree for `walkdown.yml`. A
blueprint walkdown answers for is one somebody registered on this machine. Three hands
write the registry, and each row says which:

- **`walkdown init`** registers what it makes — a home in `~/.walkdown` by default, or in
  the repository's `.walkdown` with `--commit`, where it also writes the manifest row for
  every other machine. Run in a checkout whose manifest the registry has not met, it
  registers what the manifest declares rather than setting the project up a second time.
- **`walkdown import <project>`** registers what a checkout's manifest declares — one
  blueprint without asking, several with a question (`--all`, `--only`). `walkdown import
  <home>` registers one bare home: a numbered directory under some project's
  `.walkdown/blueprints/`, or, with `--ephemeral --why`, a throwaway copy standing
  anywhere, reachable by name and never by standing somewhere. This is the one add;
  `blueprint add` is gone.
- **`walkdown move`** re-points a row when a home or one kind of record moves.

`walkdown blueprint forget <id>` takes a row out and touches no records. `walkdown
blueprints` lists every row, and names any home standing under a `blueprints/` directory
that no row claims — reported, never adopted, because which checkout a stranded home
belonged to is exactly the guess the registry exists to stop.

**A copy means a copy.** An ephemeral row's records follow its home, so listing a pack's
live blueprint as "a throwaway copy" gave the pack's ledger a second name, and a root
server's pin landed in it. A project's own numbered home is refused with the place to
copy it to (`<that>/.walkdown/tmp/<label>/`, say); a path no project owns is what the
flag is for (q-0176).

Ids are unique within the registry — they are the handle `--blueprint` takes. A second
checkout called `app` registers as `app-2`; the manifest's id and the registry's can
differ, and the registry's is the one this machine answers to.

A blueprint nobody registered is not a project. `walkdown where` says nothing registered
contains this directory — naming the manifest it can see, and the `walkdown import` that
would register it — and every command refuses the same way. That is not a gap; a path
reached without a row needed a home derived from a name, which is where the collisions
came from (n-0133, q-0138, n-0156).

## The files

```yaml
# ~/.walkdown/registry.yml — written by walkdown, read by every command.
blueprints:
  - id: acme
    project: ~/src/acme                              # the checkout this row is about
    home: ~/src/acme/.walkdown/blueprints/0001-acme  # canonical, spelled with ~ for reading
    registered: { by: import, at: 2026-09-11T14:02:11Z }
    evidence: ~/.walkdown/blueprints/0001-acme/evidence   # a `walkdown move` on this machine
    targets:
      local: { base_url: http://localhost:4700 }     # this machine's port, not the team's
  - id: acme-sitting
    project: null                                    # a copy: reached by name only
    home: ~/src/acme/.walkdown/tmp/sitting-0911
    registered: { by: import, at: 2026-09-11T15:40:00Z }
    ephemeral: { why: judging panel.start.* against a scratch ledger }
```

```yaml
# ~/.walkdown/config.yml — yours. Registers nothing.
identity:
  username: topher          # what records are written under, forever
  name: Topher Fangio       # what the UI shows; recorded nowhere
  roles: [eng, product]     # the roles this person may sign for
  timezone: America/Chicago # the zone times are READ in; records carry UTC
```

```yaml
# <repo>/.walkdown/config.yml — the manifest. Read by `walkdown import`, and by nothing else.
blueprints:
  - id: acme
    home: 0001-acme
```

The home implies every record path: `blueprint/` and the four record directories are its
siblings, and a row carries a per-kind path only where `walkdown move` put one outside
the home. A `blueprints:` list in the personal `config.yml` — the shape from before the
registry — is not read; each row is named on the report as set aside, and the first
registry row written about the same checkout folds its machine-local keys in and takes it
out.

Resolution order for any record kind, first hit wins:

1. an explicit flag (per-kind overrides)
2. the row's own key for that kind — a move this machine made
3. `defaults`, with `{id}` substituted
4. the home's layout — `<home>/<kind>`

### Where this stands

`walkdown where` prints the resolver's answer for every path with the reason each was
chosen, which row answered and how it arrived, and what git sees — and writes nothing. `walkdown
where <kind>` prints one path alone, for scripts. It has no write mode at all: there used
to be a `--fix` (and a `walkdown migrate` before it) that folded the homes an older layout
had left behind into the config, and with that layout gone there is nothing left to fold.

`walkdown move <kind> --to <path>` relocates one kind and records the choice on the row
that resolved — never one found by name (n-0153). A destination that already holds
records is refused rather than merged, because two ledgers in one directory would be an
edit of both. A directory nothing registered contains has no row to remember a move in,
and is refused.

Every reader and writer resolves through the same function, so they agree with `walkdown
where` by construction. Both test suites pin `WALKDOWN_HOME` and `WALKDOWN_SKILLS_DIR` at
scratch directories under `tmp/` — one per test file, since the registry lives in the
home and parallel suites sharing one would race — so a suite cannot read or write whoever
ran it, and every fixture it reaches is a row it registered. The Highball hooks lint from
a home of their own too (`tmp/hook-home`, imported first), so a fresh clone's first hook
does not fail on an unregistered checkout.

**Evidence travels by key.** A run record names `runs/evidence/…` as a logical key rather
than a filesystem path, and the server resolves it per machine — so moving evidence needs
no run record edited, which the append-only law would have forbidden anyway.

This repository's own blueprint is the worked example: `.walkdown/blueprints/0001-walkdown/`
with the spec, threads and runs committed and a hand-edited `.walkdown/.gitignore` that
keeps out evidence and drafts but not runs - the ledger is the point of this repository.
The registry row on this machine says only where evidence sits on this disk. `walkdown
where` reports it as the spec standard and names the file that decides.

## Identifying a spec: a content hash, not a git sha

Runs used to carry `git_sha` and `blueprint_sha`, both set to the same thing: the
repository's HEAD. That conflated two questions, and outside a repository it answered
neither. They are now two fields answering one question each:

- **`git_sha`** — *what code was running?* Present when there is a repository, omitted
  when there is not.
- **`spec_hash`** — *which version of the spec was this run made against?* A hash of the
  spec's own content, whether or not the spec lives in a repository.

`blueprint_sha` is retired. Records written before the change still carry it and are
still read; nothing rewrites them, because the ledger is append-only.

The content hash was a small amount of work, because the machinery already existed.
`lib/hash.js` is thirty lines and already canonicalizes text before hashing so that
re-wrapped YAML and folded scalars hash identically. The spec hash is the same idea one
level up:

- take the blueprint's own files — `walkdown.yml`, `storyboard.yml`, `features/*.yml`
- sort by path relative to the blueprint root, so directory order cannot change the answer
- feed each as `<relative path>\n<canonicalized content>\n` into one sha256
- store it truncated, in the same `sha256:…` form rules already use

Runs, threads, drafts and evidence are **not** part of it. They are what the spec produces,
not the spec.

It was worth doing even for blueprints that keep everything in the repository, because
`blueprint_sha` was wrong in a way nobody had noticed: it changed on every commit,
including commits that did not touch the blueprint. It could tell you *when* a run
happened but not *what it was judged against*, which is the only thing it was ever for.
Per-rule `statement_hash` was unaffected — it answers a narrower question (has this
rule's wording moved?) and goes on answering it.

### The code's sha, when the spec has moved away from it

`git_sha` is computed by shelling out to `git rev-parse` in a directory, so it does not
care where the blueprint lives — only which directory it is asked about. That is what
`roots:` is for: it names the working trees a project answers for, so the sha describes
**the code under test** while `spec_hash` describes the spec, wherever that sits.

A dirty tree is the common case, not the edge one: most runs happen mid-edit. Such a run
records `abc123-dirty` on its own, which means "some unknown superset of `abc123`" — you
cannot check it out, and you cannot tell two dirty runs apart. So runs also carry:

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

## One layout, and only one

Every blueprint walkdown answers for is declared, and every declared blueprint lives in a
home. There is no second shape and no compatibility path: a bare `<dir>/blueprint` keeping
its runs and threads inside itself was how blueprints looked before homes, and the resolver
does not answer for it — an undeclared path resolves to no spec and a sentence saying how
to declare one, and `walkdown lint` errors when a declared entry names no home or leaves a
record kind pointing nowhere. That is the alarm for a config that does not match what the
tools write: an agent reading it can put the tree right.

`walkdown move <kind> --to <where>` relocates one kind and rewrites the config, leaving
every record's contents alone. It is the only thing that moves records, and a person asks
for it.

## The pointer

A short paragraph in whichever file this project's AI agents read, saying that a spec
exists and where it is. It is written when the spec is committed and not otherwise —
with nothing committed, the pointer would be the one thing walkdown put in the tree, and
it would carry a home-directory path into shared history (n-0161). `walkdown pointer
--into CLAUDE.md` places one on request.

*Which* file is not walkdown's to decide. Different tools read different names
(`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`), a monorepo
wants it beside the pack it describes, and most projects walkdown arrives in already have
one of these files with a person's own words in it. So:

- **The block is fenced** between `<!-- walkdown:begin -->` and `<!-- walkdown:end -->`.
  walkdown reads and rewrites what is between them and touches no other line. Rewriting
  rather than skipping is what lets a **moved spec correct its own pointer**; leaving the
  repository takes the block back out, and the file with it if the block was all it held.
- **`walkdown init` places it only when there is no question.** No agent file, so nothing
  to disturb: it writes `CLAUDE.md`. Exactly one: it uses that one. Several: it names them
  and writes nothing.
- **`walkdown pointer`** prints the block, and `--into <file>` places it idempotently
  anywhere. The path is relative whenever the spec is inside the repository.

In a monorepo, point `init` at the pack: `walkdown init --dir packs/billing --commit spec`
gives that pack its own `.walkdown`, which is then the only one that answers from inside
it, and puts the pointer beside the code it describes.

## What the setup wizard reads

The wizard is a later document, but it exists to write exactly this file. It should ask
five things and nothing else:

1. Who are you, and which roles may you sign for?
2. Where is this project's spec, or shall I make one?
3. Commit the spec and its threads, everything, or nothing? *(recommend the spec, explain why)*
4. **Which file do this project's agents read?** — offered as the files actually found in
   the tree, plus "somewhere else" and "nowhere, I will paste it myself". This is the one
   question walkdown genuinely cannot default its way out of, and it is the natural
   question for the agent running the wizard to answer *for* the person: it is standing
   in the repository, it can see which files exist and which are actually loaded, and it
   knows which one it read to get here.
5. Which ports does this machine serve on?

Everything else has a defensible default, and a wizard that asks about a defensible
default is a wizard people cancel.
