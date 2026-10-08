# 08 — Where things live

## Principle: the project declares *what*, the machine declares *where*

A blueprint says what the project must be true of. A config says where that project's
files sit and who is sitting at it. Those are different kinds of fact and they belong in
different files:

- **`<home>/spec.yml`** — shared wherever the blueprint is committed, and about the
  blueprint. What the runner is, which targets exist, where the prototype root is
  *relative to the blueprint*. It was `blueprint/walkdown.yml` until ADR 0014.
- **`<home>/records.yml`** — beside it: where this blueprint's runs, threads, evidence and
  drafts *usually* live, relative to the home. It informs; a registry row may say
  otherwise on one machine, and that is never written back here.
- **`~/.walkdown/registry.yml`** — personal, per-machine, written only by walkdown: the
  **registry**. Every blueprint this person chose to see, each row carrying its registry ID,
  its `project:` label and `code:`, the `checkout:` it belongs to, its `home:` on this
  disk, and how it arrived. The one file a reader consults (ADR 0003), and the only list
  there is.
- **`~/.walkdown/profile.yml`** — personal: who you are, your timezone, and any
  `defaults:`. It registers nothing. It was `~/.walkdown/config.yml` until ADR 0014.

Until ADR 0014 there was a fourth: **`<repo>/.walkdown/config.yml`**, the manifest, which
declared a repository's committed blueprints a second time beside the folders that already
declared them. It is gone, and with it the last file in walkdown called `config.yml`, so
no two of walkdown's files share a name any more. A committed home declares itself
by holding a `spec.yml`.

A config may never change what a rule *means* or what counts as evidence. It changes
locations and identity, nothing else. Break that and `walkdown status` starts meaning two
different things on two laptops, which is the one failure this whole scheme has to avoid.

## A home

Every blueprint lives in a **home**: one flat folder holding the spec, the files beside
it, and the four kinds of record it produces, as siblings with no folder between (ADR
0014) —

```
blueprints/202610-acme/
├── spec.yml       the spec — with storyboard.yml and features/
├── storyboard.yml
├── features/
├── AGENTS.md      the agent conventions, copied from walkdown
├── records.yml    where its records usually live
├── .gitignore     this blueprint's commit choice, when only its spec is committed
├── threads/       the conversation about it
├── runs/          what a machine or a sitting said about a build
├── evidence/      the screenshots those runs point at
└── drafts/        one person's half-finished sitting
```

One layout, wherever the home sits. That is what lets a home move between
`~/.walkdown/projects/` and the repository's `.walkdown/blueprints/` as a single
directory, with no record rewritten — and it is what lets the home's own three-line
`.gitignore` say which siblings git gets, touching no other blueprint. Until ADR 0014 the
spec sat one folder down, in `blueprint/`, with `walkdown.yml` where `spec.yml` is now;
`walkdown upgrade` flattens a home laid out that way. Thread files in `threads/` are named
by each thread's UUID, with its `n-NNNN` label inside, so two branches filing at once add two
files and never one conflict ([02-blueprint-schema.md](02-blueprint-schema.md)).

**The team names the folder, and walkdown reads any name.** A home is any folder under
`.walkdown/blueprints/` that holds a `spec.yml`, at any depth — `202610-search/`,
`0002-search/`, `billing/api/invoices/` for a pack. `blueprints new` names the folder after
the blueprint (`search`) and takes any other name given with `--folder`: a numbering, by
date or by count, is the team's to choose, never walkdown's (n-0355). walkdown never reads a number or a date
out of the name. The filesystem keeps homes apart: two blueprints cannot be one folder. A
home inside another home is refused, with both folders named.

Until ADR 0014 the number was walkdown's: allocated against the listing of the
`blueprints/` directory the home was made in, the listing being the record, with the name
after the dash only so `ls` read well. Nothing walkdown resolves is keyed by a name two
blueprints could share — that derivation, in each of six costumes, was the ancestor of every
collision this module has had (n-0124 through n-0160). Why numbering worked there when the
deleted registry's numbering did not is n-0155: an allocator only works when every
claimant can see the others' claims, and two committed configs in two repositories cannot
see each other, while a hand-written one never passes through an allocator at all. It
still had to be renumbered on every commit, and about twenty places parsed it. A folder
path cannot collide with itself, and telling blueprints apart is now the registry ID's job
(below), so the allocator and its lock are gone.

## The three arrangements, and where the home sits

These three, and the move of the default home back to `~/.walkdown`, are recorded as
n-0163 — which supersedes n-0154 (why the files lived beside the code) and n-0157 (why two
commit standards rather than one flag). Both of those describe an arrangement walkdown no
longer has; they are kept because the ledger is append-only and the reasoning is still
worth reading against this one.

**Nothing committed — the default.** The home is
`~/.walkdown/projects/<project>/blueprints/<name>/` (it was
`~/.walkdown/blueprints/NNNN-name/` until ADR 0014). The repository gets *nothing*: no
`.walkdown/`, no ignore rule, no `AGENTS.md`, not even a pointer. Trying walkdown alters no
tree, and abandoning it is deleting one directory in your own home. The row that named it
stays in your registry and `walkdown blueprints` shows the home gone; its registry number
is never given again (n-0170).

```
walkdown blueprints new
```

**The spec committed.** The home is `<repo>/.walkdown/blueprints/<folder>/`, keeping the
folder name it had, and inside it the home's own `.gitignore` holds three lines:

```
runs/
evidence/
drafts/
```

The spec and its threads are git's; what a machine or one person produced is not. That
file is itself committed — the standard is something a clone receives — and it is this
blueprint's alone. Until ADR 0014 one `<repo>/.walkdown/.gitignore` spoke for every
committed blueprint, with `blueprints/*/` before each line and the manifest beside it, so
one blueprint's choice could edit another's; `walkdown upgrade` splits it into a file per
home.

```
walkdown blueprints commit spec --blueprint checkout
```

**Another blueprint in the same project.** A project can hold several, each in its own
home (ADR 0011). A name says the one this run is about (`walkdown blueprints new billing`);
it gets a home of its own and a registry ID, walkdown says which blueprints it joined, and
running the same command again changes nothing. With no name, `blueprints new` means the name
it would give the project anyway — the directory's — and with several, refuses if none has
it. A name another project already uses is not refused, and gets an ID of its own: until
ADR 0014 it was refused by `new` and prefixed by `import`.

```
walkdown blueprints new billing
```

Rules move between them with `walkdown rules move <rule|story|feature>... --blueprint <from> --to <id>`:
their threads move, and the run records, sweeps and evidence behind their verdicts are
copied, so nothing is judged or signed again. `--dry-run` first. The destination's
targets must point where the verdicts were recorded, or the move refuses.

With several, `status`, `lint`, `threads` and `where` report on every one, a section each,
and `--json` answers `{ "blueprints": [ … ] }`. Everything that writes refuses until
`--blueprint <id>` says which, with one blueprint or several and wherever it is run from:
a write never takes its blueprint from the folder it stands in, nor from a thread label
only one of them holds (locations.several.writes-name-one).

**Everything committed.** The same home, and no `.gitignore` at all. Runs and evidence
arrive in pull requests, which is a thing a team can genuinely want and should not have
to assemble by hand — a negation chain in git is easy to write wrong, and a wrong one
silently commits nothing or everything.

```
walkdown blueprints commit all --blueprint checkout
```

Nothing records which arrangement a project chose. **The tree is the answer**: a home
under `~/.walkdown` is nobody's diff; a home under the repository's `.walkdown` is git's
except for what its own `.gitignore` keeps out; no `.gitignore` in the home means all of
it. `walkdown where` reports it on a `tracked` row by looking. There used to be a flag
that wrote ignore rules once and could not be asked to write them again, so changing your
mind printed success and changed nothing (n-0158).

### Changing your mind

The same command, again. Between `spec` and `all` it writes or deletes the home's one
file. Between `none` and either of the others it **moves the home whole** — spec, threads,
runs, evidence, drafts, one directory — between `~/.walkdown/projects/<project>/blueprints/`
and the repository's `.walkdown/blueprints/`, keeping its folder name, and re-points the
registry row at the new home; the row's ID never changes. Until ADR 0014 it claimed a fresh
number in the receiving `blueprints/` and the repository's manifest gained or lost a row;
now a folder name already committed in the repository is refused, naming the folder, and
nothing moves — whoever commits a name first wins, and lint warns ahead of the clash. The
first blueprint to arrive writes the pointer; the last to leave takes it back out of
`CLAUDE.md` (only the fenced block, or the file if the block was all there was) and the
skills back out of `.claude/skills/` — walkdown's own unedited copies; one you edited is
kept and named (n-0166).

The registry row is written **into**, never beside. A row that already names the project
— a port override, evidence moved elsewhere on this disk — is re-pointed when the home
moves and keeps what it had; it does not get a `repo-2` twin, and nothing it said is
dropped on the way in or out (n-0171, n-0173). Writers ask the same question the picker
asks: same home, and a checkout canon-equal to this one.

The command refuses before it moves anything when a move could not be written down: a
registry that does not parse stops it with the file named, because a home
moved and then not registered is the split n-0172 saw.

walkdown never touches the git index. An ignore file rules only what git has not met, so a
run committed under `all` stays tracked after `--commit spec` writes the file. The command
asks git, every time, and says what is still tracked and that `git rm --cached` is yours
to run (n-0164).

**What is tracked is git's answer, never the ignore file's.** The file walkdown writes is
a promise; git holds the fact, and the two part company in ways no reading of the file can
see: a root `.gitignore` that hides `.walkdown/` entirely, a rule that does not reach a
blueprint standing elsewhere in the tree, an ignore file somebody emptied, a home that
left the repository with its files still in the index. So `walkdown where` and `blueprints new`
ask git about the spec and each record kind at the paths the resolver actually answered
with — tracked, ignored by which file and line, or neither — and print that as the
`tracked` row, beside what the tree promised. Leaving the repository says how many files
git now holds as deletions rather than "nothing was added" (n-0179, n-0180, n-0181).

Where the promise and the fact disagree, **`walkdown lint` errors**, because a project
that is not set up the way it says is the one thing this tool exists to make loud: a rule
hiding the spec or its threads from git (a clone gets no blueprint); a record kind kept
out by some file other than the home's own `.gitignore`, or kept out at all when there is
no such file; an ignore file present that keeps nothing out; a rule in it that git does not
apply to this home's records. Records committed before the rule was written are a
warning, with the `git rm --cached` that clears it — a known, transitional state rather
than a misconfiguration.

## The registry is the only door

**`~/.walkdown/`** — personal. Per machine, per person, never synced. `registry.yml`,
the list of every blueprint this person chose to see; `profile.yml` with your identity;
`projects/<project>/blueprints/` with the homes of blueprints that commit nothing;
`cache/` for what walkdown can rebuild (the claims index).

**`<repo>/.walkdown/blueprints/`** — the repository's, and there may be several: a
monorepo pack can carry its own. It holds committed homes and nothing else: no
`config.yml`, no shared `.gitignore`, both gone since ADR 0014. Its homes declare what the
checkout holds, and *a declaration registers nothing*. A fresh clone that holds a home is
not a project on this machine until somebody runs `walkdown blueprints import .` in it.

**A reader consults the registry and nothing else.** No `.walkdown` is found by walking
up from where you stand; no path is resolved on read. Standing somewhere picks among the
registered rows by containment — the rows whose `checkout` contains the working
directory, the deepest winning where a pack is registered inside its repository, a
question (answered with `--blueprint`) when several rows share one project — asked by
the commands that write; the ones that only read answer for every row. A scratch
copy is never picked by standing somewhere. Naming a blueprint outright, with
`--blueprint <id>`, picks its row — by its registry ID anywhere, or by the bare name inside
its project. Nothing about the tree between the rows is consulted:
a pack carrying its own `.walkdown` is its own row, and a checkout nobody registered is
nothing — however much it looks like a project from the outside, and however many links
point into it. That last is what n-0275 found the walk could not promise: a symlink
outside a pack walked through the boundary on the read side while the writer refused the
same path. There is no read-side path left for a spelling to fool.

**A worktree is the same project, checked out somewhere else** (ADR 0014 §10). A checkout
belongs to a registered blueprint's project when git says they share a repository (the
same `git rev-parse --git-common-dir`, which covers Claude Code's worktrees) or when their
`origin` remotes match (which covers Archon's, made from its own clone). It gets no row of
its own; `blueprints new` and `import` inside one attach to the main project. In it, the
committed parts come from the worktree — the spec and threads are the branch's, so a
branch's rule edits count on that branch — while runs, evidence and drafts the blueprint
does not commit resolve where the registry says, so deleting a worktree never takes a
ledger with it. A blueprint that commits its runs writes them into the worktree, and they
reach the main branch when it merges. Runs are stamped with the worktree's own commit and
branch, and `walkdown where` says which way the worktree was matched.

The one moment a path is looked at is the add. `walkdown blueprints import` canonicalises what it is
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

The page also writes back what it is showing: the moment a blueprint is picked its key
goes into `?bp=`, and the moment the frame moves the page in it goes after `#`, both by
`history.replaceState` — so a reload of that tab comes back to the same board on the same
page. That is the whole of it: nothing is stored in the browser (ADR 0001 §9 still holds),
a fresh address with no `?bp=` asks as before, and inside somebody else's application the
panel never touches that page's address. A `?bp=` naming a blueprint the server has since
forgotten is dropped and the chooser asks; the server serves the page for any `?bp=` and
refuses only the API.

Identity is never taken from a committed file; it is in `profile.yml`. A committed file
naming a person would be wrong on every machine but one.

## Every blueprint is registered

There is no `--dir`, and no reader searches the tree for a `spec.yml` (or, before ADR 0014,
a `walkdown.yml`). A blueprint walkdown answers for is one somebody registered on this
machine. Three hands write the registry, and each row says which:

- **`walkdown blueprints new`** registers what it makes — a home in
  `~/.walkdown/projects/<project>/` by default, or in the repository's
  `.walkdown/blueprints/` with `--commit` — and says which project it joined, beside which
  blueprints, so a wrong project is noticed at once.
- **`walkdown blueprints import <path>`** takes what it is pointed at. A home's path
  registers that one blueprint, and says its ID and project. A repository's path lists
  every home under its `.walkdown/blueprints/`, at any depth, marks any already listed, and
  asks which to register; with no terminal to ask, it prints the list and registers nothing
  until `--all` or `--only <folders>` says which. With `--ephemeral --why` it registers a
  throwaway copy standing anywhere, reachable by name and never by standing somewhere.
  This is the one add; `blueprint add`, and then `blueprints add`, are gone.
- **`walkdown records move`** and **`walkdown blueprints commit`** re-point a row when one
  kind of record or a whole home moves.

`walkdown blueprints forget <id>` takes a row out and touches no records. `walkdown
blueprints` lists every row, and names any home standing under a `blueprints/` directory
that no row claims — reported, never adopted, because which checkout a stranded home
belonged to is exactly the guess the registry exists to stop.

**A copy means a copy.** An ephemeral row's records follow its home, so listing a pack's
live blueprint as "a throwaway copy" gave the pack's ledger a second name, and a root
server's pin landed in it. A project's own home is refused with the place to
copy it to (`<that>/.walkdown/tmp/<label>/`, say); a path no project owns is what the
flag is for (q-0176).

**Every row has a registry ID, and it stays on this machine** (ADR 0014 §2). It reads
`NNNN-<code>-<name>` — `0001-wd-walkdown`, `0002-wd-cli`, `0003-am-search`:

- **`NNNN`** is the registry's own counter, never reused, even after its blueprint is
  forgotten.
- **`<code>`** is two or three letters for the project, unique on this machine (`wd` for
  walkdown). A second project that would get the same code, or the same `project:` label,
  is asked to choose another, and nothing is registered until it does; with no terminal it
  is refused with how to choose (`--project`, `--code`).
- **`<name>`** defaults to the home's folder name with any number or date prefix removed,
  and `walkdown blueprints rename <id> <new-name>` changes it, keeping the number and the
  code; `--folder` renames the folder too.

`--blueprint`, `?bp=` and every verb that takes a blueprint accept the ID, and inside a
project the bare name (`walkdown`, `cli`) works anywhere the ID does. The ID is written in
the registry and nowhere else — not in a run record, a thread, AGENTS.md, the pointer or
any committed file — so a teammate's ID for the same blueprint can differ without either
repository being wrong. Moving a checkout, or committing or un-committing a blueprint,
changes the path on the row and never the ID. Until ADR 0014 the id was a bare name
unique on the machine: a second checkout called `app` registered as `app-2`, a second
project's `search` was refused by `new` and became `<project>-search` on `import`, and a
repository's own instructions could name a blueprint this machine called something else.

**A project is a label on the rows** (ADR 0014 §3), named after the repository's `origin`
remote, or the directory where there is none, unless the person names it. It groups and
filters; it never decides where anything is.

A blueprint nobody registered is not a project. `walkdown where` says nothing registered
contains this directory — naming any home it can see in the checkout, and the `walkdown
blueprints import` that would register it — and every command refuses the same way. That is not a gap; a path
reached without a row needed a home derived from a name, which is where the collisions
came from (n-0133, q-0138, n-0156).

## The files

```yaml
# ~/.walkdown/registry.yml — written by walkdown, read by every command.
next: 3                                              # the counter; a number is never given twice
blueprints:
  - id: 0001-ac-acme                                 # this machine's name for it, written nowhere else
    project: acme                                    # the label, from the origin remote
    code: ac
    checkout: ~/src/acme                             # the repository this row is about
    home: ~/src/acme/.walkdown/blueprints/202609-acme   # canonical, spelled with ~ for reading
    registered: { by: import, at: 2026-09-11T14:02:11Z }
    evidence: ~/scratch/acme-evidence                # a `records move` on this machine
    targets:
      local: { base_url: http://localhost:4700 }     # this machine's port, not the team's
  - id: 0002-ac-sitting
    project: acme
    code: ac
    checkout: null                                   # a copy: reached by name only
    home: ~/src/acme/.walkdown/tmp/sitting-0911
    registered: { by: import, at: 2026-09-11T15:40:00Z }
    ephemeral: { why: judging panel.start.* against a scratch ledger }
```

```yaml
# ~/.walkdown/profile.yml — yours (it was config.yml). Registers nothing.
identity:
  username: topher          # what records are written under, forever
  name: Topher Fangio       # what the UI shows; recorded nowhere
  roles: [eng, product]     # the roles this person may sign for
  timezone: America/Chicago # the zone times are READ in; records carry UTC
```

```yaml
# <home>/records.yml — the blueprint's own. Says where its records usually live; informs, never decides.
runs: runs/
threads: threads/
evidence: evidence/
drafts: drafts/
```

The home implies every record path: the spec and the four record directories are
siblings in it, `records.yml` says so in a file a team can change, and a row carries a
per-kind path only where `walkdown records move` put one somewhere else on this machine —
never by editing `records.yml`. Until ADR 0014 a repository's `.walkdown/config.yml`
manifest stood where `records.yml` does, listing its blueprints by id and numbered home;
`walkdown upgrade` removes it. A `blueprints:` list in the personal file — the shape from
before the registry — is not read, and neither is `projects:`, the name it had before
that. Each row is named on the report as set aside, with the `walkdown blueprints import`
that registers it.

Resolution order for any record kind, first hit wins:

1. an explicit flag (per-kind overrides)
2. the row's own key for that kind — a move this machine made
3. the blueprint's own `records.yml`
4. the profile's `defaults`, with `{id}` substituted by the ID's name
5. the home's layout — `<home>/<kind>`

In a worktree the same order holds, read against the branch's copy of the home for what
the blueprint commits and against the registered home for what git ignores.

Until ADR 0014 one more rule applied: a default that would land in walkdown's own
`blueprints/` directory but outside the home the row registered was set aside, because
that was the layout from before numbered homes
(`~/.walkdown/blueprints/{id}/runs` beside `0001-{id}/`). `walkdown upgrade` moves that
layout now, and no command reads it in place. A default aimed anywhere else, such as
evidence on another disk, applies as written.

### Where this stands

`walkdown where` prints the resolver's answer for every path with the reason each was
chosen, which row answered and how it arrived, and what git sees — and writes nothing. `walkdown
where <kind>` prints one path alone, for scripts. It has no write mode at all: there used
to be a `--fix` (and a `walkdown migrate` before it) that folded the homes an older layout
had left behind into the config, and with that layout gone there is nothing left to fold.

`walkdown records move <kind> --to <path> --blueprint <id>` relocates one kind and records the choice on the row
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

This repository's own blueprints are the worked example: `.walkdown/blueprints/0001-walkdown/`
and `0002-cli/`, each with the spec, threads and runs committed and its own hand-edited
`.gitignore` that keeps out evidence and drafts but not runs - the ledger is the point of
this repository. (Until ADR 0014 one `.walkdown/.gitignore` said this for both.)
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

- take the blueprint's own files, by name — `spec.yml`, `storyboard.yml`, `features/*.yml`
  (until ADR 0014, `walkdown.yml` and everything else under `blueprint/`)
- sort by path relative to the home, so directory order cannot change the answer
- feed each as `<relative path>\n<canonicalized content>\n` into one sha256
- store it truncated, in the same `sha256:…` form rules already use

Runs, threads, drafts and evidence are **not** part of it. They are what the spec produces,
not the spec. Neither are `AGENTS.md`, `records.yml` or `.gitignore`: when the hash covered
everything under `blueprint/`, refreshing the copied AGENTS.md changed what a run said it
was judged against.

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
flat home around its `spec.yml`. There is no second shape and no compatibility path: a bare
`<dir>/blueprint` keeping its runs and threads inside itself was how blueprints looked
before homes, a numbered home with the spec in `blueprint/walkdown.yml` was how they looked
before ADR 0014, and the resolver answers for neither — an undeclared path resolves to no spec and a sentence saying how
to declare one, and `walkdown lint` errors when a declared entry names no home or leaves a
record kind pointing nowhere. That is the alarm for a config that does not match what the
tools write: an agent reading it can put the tree right.

`walkdown records move <kind> --to <where> --blueprint <id>` relocates one kind and records it on the registry
row, leaving every record's contents alone and `records.yml` as it was. It is the only thing
that moves records, and a person asks for it.

**An old layout is moved once, by `walkdown upgrade`, when a person runs it.** Every other
command that finds one — a `~/.walkdown/config.yml`, a home with a `blueprint/` folder, a
repository's `.walkdown/config.yml` or shared `.gitignore`, a personal home under
`~/.walkdown/blueprints/`, a thread named by its label — says "An upgrade is due", names
`walkdown upgrade`, and stops having changed nothing, rather than reading half of an old
layout and writing into the new one. The upgrade turns `config.yml` into `profile.yml`,
flattens each home's `blueprint/` folder with `walkdown.yml` becoming `spec.yml`, gives each
home a `records.yml` and, when committed, its own `.gitignore` in place of the shared one,
removes the repository's `.walkdown/config.yml`, moves personal homes under
`projects/<project>/blueprints/`, gives registry rows IDs and project labels, and gives each
thread a UUID, renaming its file to it and keeping its label. Folder names are kept — this
repository's `0001-walkdown` and `0002-cli` are valid names as they stand — and every verdict
stays current, because moving files changes no rule's wording. `--dry-run` says what it
would do; run again, it reports nothing to do.

## The pointer

A short paragraph in whichever file this project's AI agents read, saying that the
repository's specs live under `.walkdown/blueprints/`, that an agent reads the `AGENTS.md`
in the blueprint it is working on, and that `walkdown blueprints` lists their IDs, which
commands that write take as `--blueprint <id>`. It is written when the first blueprint is
committed and not otherwise — with nothing committed, the pointer would be the one thing
walkdown put in the tree, and it would carry a home-directory path into shared history
(n-0161). `walkdown pointer --into CLAUDE.md` places one on request.

**It is fixed text, and names no blueprint** (ADR 0014 §7). A blueprint's ID differs from
one machine to the next, so committed text can only say where to look. Until ADR 0014 the
pointer listed every blueprint and `blueprints new`, `commit`, `rename` and `forget` each
rewrote it; now it is written once and never edited again, and only taking the last
committed blueprint out of the repository removes it.

*Which* file is not walkdown's to decide. Different tools read different names
(`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`), a monorepo
wants it beside the pack it describes, and most projects walkdown arrives in already have
one of these files with a person's own words in it. So:

- **The block is fenced** between `<!-- walkdown:begin -->` and `<!-- walkdown:end -->`.
  walkdown reads what is between them and touches no other line. When the block named
  paths and blueprints, rewriting rather than skipping was what let a **moved spec correct
  its own pointer**; with nothing in it that can go stale, it is written once, and the
  last blueprint leaving the repository takes the block back out, and the file with it if
  the block was all it held.
- **`walkdown blueprints new` places it only when there is no question.** No agent file, so nothing
  to disturb: it writes `CLAUDE.md`. Exactly one: it uses that one. Several: it names them
  and writes nothing.
- **`walkdown pointer`** prints the block, and `--into <file>` places it idempotently
  anywhere. It carries no path and no blueprint, so it reads the same in every repository.

In a monorepo, point `init` at the pack: `walkdown blueprints new --dir packs/billing --commit spec`
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
