# 08 — Where things live

## Principle: the project declares *what*, the machine declares *where*

A blueprint says what the project must be true of. A config says where that project's
files sit and who is sitting at it. Those are different kinds of fact and they belong in
different files:

- **`blueprint/walkdown.yml`** — committed, shared, and about the project. What the
  runner is, which targets exist, where the prototype root is *relative to the blueprint*.
- **`~/.walkdown/config.yml`** — personal, per-machine. Which projects this person has,
  where each one's home is on this disk, which ports this machine serves on, and who you
  are.
- **`<repo>/.walkdown/config.yml`** — committed, shared. Which blueprints this repository
  has and where they sit *relative to the repository*, so a clone is a working project
  with nothing else to run. Same schema as the personal file; it just cannot name a path
  outside the repository.

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
projects could share — that derivation, in each of six costumes, was the ancestor of every
collision this module has had (n-0124 through n-0160).

## The three arrangements, and where the home sits

**Nothing committed — the default.** The home is `~/.walkdown/blueprints/NNNN-name/`. The
repository gets *nothing*: no `.walkdown/`, no ignore rule, not even a pointer. Trying
walkdown alters no tree, and abandoning it is deleting one directory in your own home.

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
`blueprints/`, and rewrites the declarations to match: the repository's config gains or
loses the entry, the personal one loses or gains it. Leaving the repository also takes the
pointer back out of `CLAUDE.md` (only the fenced block, or the file if the block was all
there was).

walkdown never touches the git index. A file already committed stays tracked until you
`git rm --cached` it, and the command says so.

## The two `.walkdown` directories, and which one answers

**`~/.walkdown/`** — personal. Per machine, per person, never synced. `config.yml` with
your identity and your list of projects; `blueprints/` with the homes of projects that
commit nothing.

**`<repo>/.walkdown/`** — the repository's, and there may be several: a monorepo pack can
carry its own. Committed or ignored as the arrangement above says.

**Exactly one repository `.walkdown` answers for where you are standing** — the nearest
one at or above the working directory — and it is merged with the personal one and with
nothing else. The walk stops at the first `.walkdown` it finds, or at the top of the
repository, and it never mistakes `~/.walkdown` for a project's. A pack with its own
`.walkdown` therefore never sees the root's list and the root never sees the pack's; a
monorepo is several projects that happen to share a checkout, and a tool that pooled them
would let one pack's board list, serve and write to another pack's ledger (n-0156,
n-0159). A server offers what the `.walkdown` *where it was started* declares, wherever
the blueprint it happens to serve sits.

### How the two configs merge

The repository's entries say which blueprints exist; a personal entry may override any key
of one of them — where evidence goes on this disk, which port is yours. Entries merge key
by key, and each key remembers which file supplied it, so `walkdown where` can say "this
repository's config" for the spec and "this machine's config" for the evidence on the same
report (n-0144). Whether a file declared an entry *at all* is a separate fact carried
beside those marks, so restating every key personally does not erase the repository's row
(n-0151).

A personal entry overrides a repository's only when it is **about that checkout**: it
shares the id, and either has one of its `roots` inside the repository or has no blueprint
of its own (the pure-override shape — `id` and `evidence:` and nothing else). A personal
entry with the same id rooted somewhere else is a different project that happens to share
the name; here it is shadowed by the repository's and `walkdown projects` says so, and it
is reachable from its own checkout exactly as before. An entry with no roots but a `spec`
of its own — an ephemeral copy — is never an override of anything (n-0160).

Identity is never taken from the repository. A committed file naming a person would be
wrong on every machine but one.

## Every blueprint is written down

There is no `--dir`, and walkdown does not search the tree for `walkdown.yml`. A
blueprint walkdown answers for is one somebody declared: `init` writes the entry for what
it makes, `walkdown project add <path>` writes one for a blueprint that arrived — a clone,
a copy, somebody else's checkout — and `--ephemeral` marks a throwaway copy, reachable by
name, never by standing somewhere, and only ever in your own config. `walkdown project
forget <id>` takes an entry off the list and touches no records.

A blueprint nobody listed is not a project. `walkdown where` says nothing declares this
directory rather than naming a path, and every command refuses the same way. That is not
a gap; a path reached without an entry needed a home derived from a name, which is where
the collisions came from (n-0133, q-0138, n-0156).

Selection is by standing somewhere — the entry whose `roots` contain the working
directory, the most specific when several do — or by `--project <id>`. Where two entries
share an id, `--project` prefers the one rooted where you are, then the repository's.

## `config.yml`

The same schema in both files. Relative paths in the repository's resolve against the
repository; paths in the personal one are written as `~/…`.

```yaml
# ~/.walkdown/config.yml
identity:
  username: topher          # what records are written under, forever
  name: Topher Fangio       # what the UI shows; recorded nowhere
  roles: [eng, product]     # the roles this person may sign for

projects:
  - id: acme
    roots: [~/src/acme]                              # which working trees answer as this project
    spec:     ~/.walkdown/blueprints/0001-acme/blueprint
    threads:  ~/.walkdown/blueprints/0001-acme/threads
    runs:     ~/.walkdown/blueprints/0001-acme/runs
    evidence: ~/.walkdown/blueprints/0001-acme/evidence
    drafts:   ~/.walkdown/blueprints/0001-acme/drafts
    home: 0001-acme                                  # the numbered directory, by name
    targets:
      local: { base_url: http://localhost:4700 }     # this machine's port, not the team's
```

```yaml
# <repo>/.walkdown/config.yml
projects:
  - id: acme
    roots: [.]
    spec:     .walkdown/blueprints/0001-acme/blueprint
    threads:  .walkdown/blueprints/0001-acme/threads
    runs:     .walkdown/blueprints/0001-acme/runs
    evidence: .walkdown/blueprints/0001-acme/evidence
    drafts:   .walkdown/blueprints/0001-acme/drafts
    home: 0001-acme
```

Every path is written out even though the home implies them: the config is the one place
that says where things are, and a person reading it should not need to know the layout.

Resolution order for any record kind, first hit wins:

1. an explicit flag (per-kind overrides)
2. the matching `projects[]` entry's own key
3. **a directory the blueprint already has inside it** — `blueprint/runs`,
   `blueprint/threads`, `blueprint/drafts`, `blueprint/runs/evidence` — the shape every
   blueprint had before homes, kept answering so an upgrade is never a data loss
4. `defaults`, with `{id}` substituted (only when the entry allocated an id)
5. the home's layout — `<home>/<kind>` — or, for a blueprint a reader holds by path with no
   entry at all, inside the spec directory

Rule 3 deliberately outranks `defaults`: a blanket default is a *preference*, an existing
ledger is a *fact*, and a preference must never silently point past one. Moving a ledger is
a decision somebody makes with `walkdown move`, not something a config does on their
behalf. The test is **exists**, not "holds records".

### Where this stands

`walkdown where` prints the resolver's answer for every path with the reason each was
chosen, which `.walkdown` answered, and what git sees — and writes nothing. `walkdown
where <kind>` prints one path alone, for scripts. `--fix` is the one thing it does that is
not asking: it writes the addresses of homes an older layout left behind into the config,
moving none of them. It was `walkdown migrate`, and the old spelling still works.

`walkdown move <kind> --to <path>` relocates one kind and records the choice against the
entry that resolved — never one found by name (n-0153). A destination that already holds
records is refused rather than merged, because two ledgers in one directory would be an
edit of both. A directory nothing declares has no entry to remember a move in, and is
refused.

Every reader and writer resolves through the same function, so they agree with `walkdown
where` by construction. Both test suites pin `WALKDOWN_HOME` and `WALKDOWN_SKILLS_DIR` at
scratch directories under `tmp/`, so a suite cannot read or write whoever ran it; this
repository's own `.walkdown/` holds only its config, like anybody else's.

**Evidence travels by key.** A run record names `runs/evidence/…` as a logical key rather
than a filesystem path, and the server resolves it per machine — so moving evidence needs
no run record edited, which the append-only law would have forbidden anyway.

This repository's own blueprint is the worked example: `.walkdown/blueprints/0001-walkdown/`
with the spec, threads and runs committed and a hand-edited `.walkdown/.gitignore` that
keeps out evidence and drafts but not runs - the ledger is the point of this repository.
The personal config overrides only where evidence sits on this disk. `walkdown where`
reports it as the spec standard and names the file that decides.

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

Existing projects keep working untouched: a blueprint declared by path, wherever it sits,
keeps its runs and threads where they are (rule 3 above), and `walkdown where --fix` folds
the homes an older layout left behind into the config without moving one. `walkdown move
<kind> --to <where>` relocates one kind and rewrites the config, leaving every record's
contents alone.

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
