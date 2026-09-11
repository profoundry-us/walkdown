# ADR 0003 — The registry is the only door

- **Status:** proposed — drafted by the agent on 2026-09-11 from Topher's
  framing on n-0275; nothing below is built until he accepts it
- **Date:** 2026-09-11
- **Deciders:** Topher (product, eng)
- **Supersedes:** the "standing in a checkout" half of
  [docs/08-locations.md](../08-locations.md) ("The two `.walkdown`
  directories, and which one answers", "How the two configs merge"), and the
  rule `locations.answer.one-walkdown-answers`
- **Builds on:** [ADR 0001](0001-projects-blueprints-and-routing.md) §3–§5,
  which made the registry the server's only source and left the CLI with a
  second one
- **Threads:** n-0275 (the symlink that walked through the boundary),
  n-0188, q-0168, q-0176, n-0213, q-0182

## Context

A blueprint becomes known to walkdown in one of two ways today.

1. **The registry.** Today the `blueprints:` list in `~/.walkdown/config.yml`,
   one file per machine, with `claims.json` derived from it. `walkdown import` writes a row for each
   blueprint a named directory declares; `walkdown init` writes a row for the
   home it creates; `blueprint add --ephemeral` writes a row for a scratch
   copy. Since ADR 0001 §3 the server answers from this file and from nothing
   else: it offers every project the machine has been told about, whatever
   directory it was started in.

2. **Standing in a checkout.** The CLI walks up from the working directory to
   the nearest `.walkdown`, reads the committed `config.yml` inside it
   directly, and merges personal rows onto it by id and roots. This is how
   `walkdown status` answers in a checkout nobody imported, and how a
   personal row carrying only `roots:` and a port means anything.

The second door is the only place walkdown *discovers* a path rather than
being *told* one, and everything that makes discovery safe hangs off it:
`walkdownRoot()` and its stop-at-the-repository and never-the-personal-home
guards; the crossing guard that refuses a row reaching under somebody else's
`.walkdown`, on both the committed and the personal side; the rule that a
personal row overrides a committed one only when it is *about that checkout*;
the set-aside of relative paths, `~name`, blank values and `home:` on
overrides; the carve-out for a `.walkdown` holding homes but no config. Each
of those is a thread — n-0156, n-0159, n-0160, n-0167, n-0170, n-0173,
n-0174, n-0175, n-0177, n-0188, n-0213, q-0168, q-0176 — and each was a real
defect in the merge, found after it had listed, served or written to the
wrong ledger.

n-0275 is the latest. A symlink created outside a monorepo pack, pointing at
the pack's blueprint, walks straight through the crossing guard on the read
side: `walkdownRoot()` resolves the path as a string, so the upward walk from
the link never passes through the pack's own `.walkdown`. A hand-written
personal row naming that link is read, resolved, served as a second door to
the pack's ledger, and written to — while `walkdown blueprint add` refuses
the byte-identical path, because the writer canonicalises first. The
contradiction n-0188 named is back: the same question answered two ways in
one breath.

The instance is a one-line fix (`canon(start)` in the walk). The class is
not. Every reader that consults a path it did not register has to decide
whose that path is, and a filesystem offers more spellings of a place than
any guard will enumerate.

Topher's framing, 2026-09-11: *every walkdown we know about should be in our
registry — personal ones, scratch copies, all of them. Then we consult the
registry every time and stop worrying about walkdown paths. The only time to
worry about a path is when someone is asking to add one.*

This ADR is that, written down.

## Decision

### 1. A reader consults the registry, and nothing else

Every command that needs a blueprint — `status`, `run`, `lint`, `judge`,
`thread`, `threads`, `where`, `hash`, `sweep`, `serve`, `claims`, the API
behind the panel — answers from the rows in the registry (§7). No
command walks the working tree, reads a `.walkdown/config.yml` it did not
register, or merges two files. The server already works this way (ADR 0001
§3); the CLI joins it.

`walkdownRoot()` and the crossing guard have no callers on the read side and
are deleted. The merge (`about()`, `repoRooted`, the per-key provenance
marks, the set-asides on override rows) has nothing to merge and is deleted.
`locations.answer.one-walkdown-answers` and its eleven THENs go with it; what
they protected against cannot happen when nothing is read from where you
stand.

### 2. A committed `.walkdown/config.yml` is a manifest

It stays committed, and it stays the way a project tells the world what it
declares: its blueprints, their homes, their specs, their targets. What
changes is who reads it. `walkdown import <dir>` reads it — as it already
does (`bin/commands/import.js` `declaredIn`) — and writes a registry row per
blueprint the person chooses. Nothing else opens it.

The consequence is the point of ADR 0001 §4 said again: a clone of a
repository that uses walkdown shows you nothing until you import it. That
was already true of the server. It becomes true of the CLI.

### 3. A path is handled once, at add time, canonically — and there is one add

Two commands write a row: `init`, which creates a home and registers it, and
`import`, which registers what already exists. `blueprint add` retires into
`import`.

Today they differ by what they read. `import <dir>` reads a *project's*
manifest and offers the blueprints it declares; `blueprint add <path>`
registers a single *home* by path — a clone, a copy, a scratch copy with
`--ephemeral`. Two commands for "tell walkdown about this directory" is two
add-time doors with two sets of refusals to keep in agreement, which is the
shape of every locations defect so far. So `import` takes both:

- `walkdown import <dir>` where `<dir>/.walkdown/config.yml` exists: the
  manifest case, as now — shown what it declares, say which.
- `walkdown import <home>` where `<home>/blueprint/walkdown.yml` exists and
  no manifest declares it: the bare-home case — one row, `project: null`
  unless `--project <dir>` says otherwise.
- `walkdown import <home> --ephemeral --why "..."`: a scratch copy, marked,
  never picked by standing somewhere.

Each takes a path, canonicalises it (`realpathSync`, via `canon()`),
refuses what it should refuse — a directory declaring nothing, a home that
is not home-shaped, a home already registered under another spelling — and
writes the canonical path. That is the only moment walkdown asks whose a
path is. A symlink resolves to its real place there, is compared against the
rows already held, and is either the same blueprint (already registered, say
so) or a new one. After that, every reader holds real paths and compares
real paths.

### 4. The working directory picks among registered rows, and only among them

Without `--blueprint`, a command needs a default. It is the row whose
project directory contains the working directory — `within(cwd, row.project)`,
canonically, against rows already in hand. This is the one path comparison
that survives on the read side, and it is named here so nobody later
mistakes it for discovery: it never opens a directory, it never finds
anything not already registered, and it never walks up.

- Exactly one row contains `cwd`: that one answers, and `where` says so.
- Several contain it (a project holding several blueprints, or a scratch
  copy registered inside its original): the command asks, with the
  candidates named, exactly as `?bp=` refuses a bare id two blueprints
  answer to (n-0173). `--blueprint` settles it.
- None contains it: the command says what it found, if anything, and how to
  add it — *"this directory declares `checkout` in `.walkdown/config.yml`;
  `walkdown import .` to use it"*, or *"nothing here declares a blueprint;
  `walkdown init` starts one"*. That is a path question, and it is an
  add-time prompt, which is where the decision says path questions live.

`project:` on a registry row is therefore the directory the blueprint came
from, singular, set by the adding command. `roots:` — a list of places a row
is "about" — goes with the merge it served. A personal home kept out of any
repository has `project: null` and is reached by name.

### 5. Every row says how it arrived

Every row carries `registered: { by: import | init, at }`, and a scratch
copy carries `ephemeral: { why }` beside it. A row without `registered:` was
hand-written, and per q-0182 walkdown does not support hand-written rows: it
is not read, and `where` names it as set aside with that reason. This
replaces the crossing guard's role of telling a tool-written row from a
hand-written one by where its spec sits.

### 6. One row per blueprint, no overrides

A personal row carrying only `id` and `roots:` and a port — the
pure-override shape, which meant something merged onto a committed entry —
has nothing to merge onto and is retired. Machine-local facts (the port,
where evidence goes on this disk) are fields on the registered row, written
by `walkdown move` or by `import`'s flags. The row is the whole answer.

### 7. Where the registry lives: `~/.walkdown/registry.yml`

It is a per-machine index of what this machine wants to see while walkdown
is running, and it deserves its own file rather than a list inside the
personal config. `~/.walkdown/` becomes:

    ~/.walkdown/
      config.yml      who is sitting here, and this machine's defaults - a
                      person's file, edited by hand
      registry.yml    every blueprint this machine knows about - walkdown's
                      file, written by import and init, never by hand, and
                      NOT a cache: after this ADR it is the only record of
                      what this machine knows
      cache/          derived from the above, rebuilt on demand, deletable
        claims.json   the address index, rebuilt by import and serve
      blueprints/     the homes of blueprints kept out of any repository
      backups/        as now

Three kinds of file, told apart by directory and header rather than by
knowing which is which: `config.yml` is yours; `registry.yml` is walkdown's
state, and a row in it without `registered:` is by definition not
walkdown's; anything under `cache/` is walkdown's *scratch*, and `rm -rf
~/.walkdown/cache` loses nothing. The registry deliberately does not live
under `cache/` - it is the one file whose loss means re-importing every
project, and a directory named cache says the opposite.

YAML for the registry because a person will open it to check "what does this
machine know about", and everything else walkdown writes for people is YAML;
`claims.json` stays JSON because nobody reads it.

The `blueprints:` list in `config.yml` is read for one release for migration
messages only — *"`walkdown` is listed in config.yml, which no longer
registers anything; `walkdown import ~/Development/profoundry/walkdown`
registers it"* — and then not at all.

## What the files look like

Two `.walkdown` directories, two jobs. The repository's is a **manifest**:
what this project declares, committed, read by `import`. The personal one
holds the **registry**: what this machine knows, never committed, read by
everything.

### A repository's `.walkdown/`, as `init` leaves it

    acme-shop/
      .walkdown/
        config.yml                       the manifest
        .gitignore                       which of a home's parts git keeps
        blueprints/
          0001-checkout/                 a home: one blueprint, its records
            blueprint/                   the spec - walkdown.yml, storyboard, features/
            threads/
            runs/
            evidence/                    gitignored by default
            drafts/                      gitignored

```yaml
# acme-shop/.walkdown/config.yml — the manifest.
#
# What this project declares, and nothing about any machine. Read by
# `walkdown import` when somebody registers this checkout, and by nothing
# else. Paths are relative to the repository, because this file is read on
# machines whose layouts have nothing in common.
blueprints:
  - id: checkout
    home: .walkdown/blueprints/0001-checkout
  - id: admin
    home: .walkdown/blueprints/0002-admin
```

No `roots:` — the project is the directory this file sits in. No per-kind
paths — a home is home-shaped (`locations.default.one-home-per-blueprint`),
so `home:` says where all of them are. No ports, no evidence overrides, no
identity: those are facts about a machine.

### The personal `~/.walkdown/`

```yaml
# ~/.walkdown/config.yml — who is sitting here, and this machine's defaults.
# Yours: edit it. It registers nothing.
identity:
  username: topher
  name: Topher Fangio
  roles: [eng, product]
defaults:
  evidence: ~/.walkdown/evidence          # optional; where evidence goes unless a row says
```

```yaml
# ~/.walkdown/registry.yml — every blueprint this machine knows about.
#
# walkdown's file. Written by `walkdown import` and `walkdown init`; a row
# written by hand carries no `registered:` and is not read. Paths are real
# paths, canonicalised when the row was written, spelled with ~ for reading.
built: 2026-09-11T18:02:11Z
blueprints:

  # A checkout, imported. `project` is what the working directory is compared
  # against; `home` is where the spec and the records are.
  - id: walkdown
    project: ~/Development/profoundry/walkdown
    home: ~/Development/profoundry/walkdown/.walkdown/blueprints/0001-walkdown
    registered: { by: import, at: 2026-09-11T18:02:11Z }
    # Machine-local facts live on the row, not in an override of it.
    evidence: ~/.walkdown/blueprints/0001-walkdown/evidence   # 97MB of screenshots, kept out of the tree
    targets:
      local: { base_url: http://localhost:4700 }              # this machine's port

  # Another project's two blueprints, imported together. Same project, two
  # rows: standing in acme-shop matches both, so a command without
  # --blueprint asks which.
  - id: checkout
    project: ~/work/acme-shop
    home: ~/work/acme-shop/.walkdown/blueprints/0001-checkout
    registered: { by: import, at: 2026-09-11T18:05:40Z }
  - id: admin
    project: ~/work/acme-shop
    home: ~/work/acme-shop/.walkdown/blueprints/0002-admin
    registered: { by: import, at: 2026-09-11T18:05:40Z }

  # A blueprint kept out of any repository: `init` made the home under
  # ~/.walkdown and registered it. No project, so no directory picks it -
  # it is reached by name.
  - id: notes
    project: null
    home: ~/.walkdown/blueprints/0002-notes
    registered: { by: init, at: 2026-09-08T09:12:00Z }

  # A scratch copy a judging agent works against. Registered like anything
  # else - an unregistered copy is exactly the ghost the registry abolishes -
  # and marked, so `blueprints --stale` and `scratch clean` can find it.
  - id: sitting-0911
    project: ~/Development/profoundry/walkdown
    home: ~/Development/profoundry/walkdown/.walkdown/tmp/sitting-0911
    registered: { by: import, at: 2026-09-11T13:10:02Z }
    ephemeral: { why: "judging the panel rules after the modal rework" }
```

What a reader does with this: `walkdown status` in `~/Development/profoundry/walkdown`
finds two rows whose `project` contains it — `walkdown` and `sitting-0911` —
and asks; `--blueprint walkdown` settles it. In `~/work/acme-shop/packages/admin`
it finds `checkout` and `admin` and asks. In `~/work/other-clone` it finds
nothing, sees a manifest, and says `walkdown import .`. `serve` offers all
five, grouped by project, exactly as ADR 0001 §3 says.

## Consequences

### Good

- The class of n-0275 goes, not the instance. There is no read-side code
  that could be fooled by a spelling, because there is no read-side code that
  resolves a spelling.
- `lib/locations.js` loses the merge, the crossing guard, the override
  set-asides and the walk — the greater part of its 1300 lines, and the part
  thirteen threads were about. What remains is: read the registry, canonicalise
  at add time, pick by containment, report why.
- The CLI and the server answer from one source. Today a server started in a
  checkout and a `walkdown status` run in the same checkout can disagree
  about what exists; after this they cannot.
- The committed file has one reader and one job. A person editing it is
  editing a manifest for `import`, not a live config with merge semantics
  they have to hold in their head.
- "Every walkdown we know about is in one file" is a sentence a person can
  check by opening the file.

### Bad, and accepted

- **A fresh clone does nothing until imported.** A teammate clones a repo
  and runs `walkdown status`; it tells them to `walkdown import .` and stops.
  One step, prompted, once per checkout. The server has worked this way since
  ADR 0001 and nobody has asked for it back.
- **CI and hooks need a registry.** This repository's own Highball hooks run
  `walkdown lint` by standing here. In a hook or a CI job the registry is the
  machine's, so a job that starts clean needs `WALKDOWN_HOME=<tmp>` and
  `walkdown import . --all` before anything else. The example blueprint's
  checks and this repository's `.highball/checks.yml` are updated as part of
  the build, not left to be discovered.
- **Existing personal files migrate by hand, once.** A pure-override row
  (Topher's own `~/.walkdown/config.yml` holds exactly one, `walkdown` with
  `roots:`, an evidence path and a port, and no spec) stops meaning anything.
  `walkdown import .` in the checkout writes the full row to `registry.yml`;
  the evidence path and the port move onto it with `walkdown move` or by
  hand once, and `where` names the old row as set aside and says why. No automatic migration — the file is a person's, and rewriting it
  unasked is the kind of thing ADR 0001 §9 deleted.
- **The n-0213 carve-out goes.** A monorepo pack that holds homes but no
  `config.yml`, kept personally by a hand-written row, was read; it will not
  be. The way in is to declare it (`init` inside the pack) and import it. Same tools, one more step, no inference.
- **Tests churn.** Every locations and CLI test that builds a `.walkdown` and
  stands in it gains an import step or a registry fixture. The nine
  `walkdownRoot()` call sites and their tests are deleted rather than
  rewritten.

### Deferred, deliberately

- **Whether `import` should be implicit inside a checkout that declares
  exactly one blueprint.** It would remove the one-step cost in the common
  case. It would also be inference — walkdown adopting a directory because
  you stood in it — which is the thing the registry exists to refuse. Not
  now; revisit if the prompt turns out to be the thing people trip on.
- **Sync of the registry across machines.** The file is per machine on
  purpose (paths are per machine). Nothing here changes that.

## Rules affected

- `locations.answer.one-walkdown-answers` — **retired.** Its statement is
  about which of two files answers; there is one file. The half that
  survives — no inference, nothing merely lying nearby is a project — is
  already `locations.answer.declared-not-discovered`, reworded to say
  *registered* where it says *written down in the `.walkdown` that answers
  for where you are standing*.
- `locations.answer.declared-not-discovered` — reworded as above; its
  third THEN ("the shared config and the personal one are both consulted")
  becomes "the registry is consulted, and the report says which row
  answered and how it arrived".
- `locations.answer.says-why` — holds; the reasons a path can be chosen for
  lose "this repository's config" and gain "registered by import / init on
  <date>".
- `locations.default.in-repo-on-request` — holds; `init --commit` still
  writes the manifest into the repository, and registers the row.
- `locations.keeping.*`, `locations.travel.*`, `locations.pointer.*` — hold.
- `screens.ownership.routes-by-page` and the ADR 0001 panel rules — hold;
  the server was already registry-only.
- A new rule under `locations.answer`: **the registry is the only door** —
  a reader never opens a `.walkdown` it did not register, a path is
  canonicalised once at add time, and the working directory picks among
  registered rows and finds nothing else. Its checks are n-0275's fixture
  turned around: the link, the hand-written row, and the assertion that
  `where`, `status`, `thread new` and `serve` all say *set aside, not
  registered* — and that `import` through the link registers the real path
  once.

## Alternatives considered

- **Fix the instance.** `walkdownRoot()` walks from `canon(start)`; the
  personal-home guard compares canonically. One line, and n-0275 closes.
  Rejected because the guard has been patched thirteen times for thirteen
  spellings of "whose directory is this", and a filesystem has more.
- **Decide by provenance, keep the second door.** Refuse any personal row
  without `imported:`/`ephemeral:`/under-the-personal-home, and keep reading
  the committed file where you stand. Closes the hole without the walk.
  Rejected as a half-measure: it still leaves two sources to merge, and the
  merge is where n-0160/0167/0175 lived. It is §5 of this decision without
  §1, and §1 is what makes §5 sufficient.
- **Make the committed file the registry, per repository.** Readers open
  the nearest one; there is no personal file. Rejected: it is door 2 alone,
  which still walks, still crosses packs, and puts machine-local facts
  (ports, evidence paths) in a committed file — the mistake
  docs/08-locations.md opens by refusing.

## How it gets built

In this order, each step leaving the tree green:

1. **The registry file, and rows say how they arrived.** `registry.yml`
   is introduced and `claims.json` moves under `cache/`; `import` and `init` write to it with `registered:`;
   `blueprint add` becomes an alias of `import` and is removed from the
   usage; `where` reports the file and the provenance. `config.yml`'s
   `blueprints:` list is still read this step. Nothing is refused yet.
2. **The default is picked by containment.** `resolveLocations` chooses
   among registry rows by `within(cwd, row.project)`, asks when several,
   prompts to import when none. The old walk still runs beside it and the
   two answers are compared in the suite; any disagreement is a finding
   before it is a change.
3. **The walk goes.** `walkdownRoot()`, the crossing guard, the merge and
   the override set-asides are deleted with their tests. `.highball/checks.yml`
   and the example blueprint's checks gain their registry setup in the same
   commit.
4. **Hand-written rows are set aside** (§5) and named on the report.
5. **The rules:** retire, reword, add, as listed. Statement hashes
   rewritten, acceptance requeued. docs/08-locations.md rewritten around one
   file.
6. **n-0275** is replied to at step 3 — the code it is about no longer
   exists — and its evidence fixture becomes the new rule's check.

Nothing in this list is started until the status line above reads
*accepted*.
