# ADR 0014 — Where walkdown keeps its files

- **Status:** proposed 2026-10-05
- **Date:** 2026-10-05
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0003 (the registry is the only door), ADR 0011 (a project holds
    several blueprints), ADR 0012 (`blueprints` is a noun).
- **Supersedes:**
    - **ADR 0003**, in three places: its machine-wide registry ids ("a second checkout
      called `app` registers as `app-2`"), the repository's `.walkdown/config.yml`
      manifest, and the one-level `NNNN-<id>` home it reads.
    - **ADR 0011**'s "an `--id` already registered for a different project is refused".
    - **Allocated numbered homes** (docs/08, n-0124): walkdown no longer chooses or parses
      a home's folder name.

## Context

walkdown has three jobs to do for a person and a team:

1. **Trying it out.** A developer can try walkdown without committing anything to their
   repository.
2. **Committing.** A team can choose to commit its blueprints in its repository.
3. **Importing.** A developer can import a blueprint from an existing project, to work on
   it and have `walkdown serve` serve it.

Today's layout does all three, but with machinery that keeps breaking:

- **Homes are numbered folders** (`NNNN-<id>`), allocated under a lock. A home must be
  renumbered when it is committed, and about twenty places in the code parse the number.
- **The registry id must be unique on the whole machine.** A second project's `search` is
  refused by `blueprints new`, and registered as `<project>-search` by `blueprints import`.
  The repository's own instructions then name a blueprint that this machine calls
  something else.
- **One `.walkdown/.gitignore` is shared** by every committed blueprint, so one
  blueprint's commit choice can edit another's. This was the source of the shared
  `.gitignore` bugs.
- **The repository's `.walkdown/config.yml`** declares the committed blueprints a second
  time, beside the folders that already declare them.
- **A worktree resolves to the main checkout.** It reads the main checkout's spec, writes
  threads into the main checkout's tree, and stamps runs with the main checkout's commit.
  Agents work in worktrees all the time: Claude Code's, and Archon's.
- **Thread ids are a counter in one checkout.** Two branches, or two machines, can each
  file `n-0357`.

## Decision

### 1. The registry is personal, and it is the only list

`~/.walkdown/registry.yml` lists every blueprint this person chose to see, and how each is
configured on this machine. There is no registry in a repository. A blueprint walkdown has
not been told about is never served or written to, as ADR 0003 has it.

### 2. Every blueprint has a registry ID, and it stays on this machine

Each row has an ID of the form `NNNN-pc-description`, for example `0001-wd-walkdown`,
`0002-wd-cli` or `0003-ha-search`.

- **`NNNN`** is the registry's own counter, from `0000` to `9999`. It is never reused.
- **`pc`** is a two- or three-letter code for the project, unique on this machine (`wd`
  for walkdown, `ha` for hireart_main). When two projects would get the same code, the
  second is asked to choose another.
- **`description`** defaults to the home's folder name with any number or date prefix
  removed.

`--blueprint`, `?bp=` and every verb that takes a blueprint accept this ID. The ID is
written in the registry and nowhere else: not in a run record, a thread, AGENTS.md, the
pointer or any committed file. A teammate's ID for the same blueprint is different.
Committed text that needs to name a blueprint writes `--blueprint <id>`, and `walkdown
blueprints` lists yours.

Moving a checkout, or committing or un-committing a blueprint, changes the path in its row
and never its ID. Links and habits survive.

### 3. Projects are labels

A project is a label on a registry row, used for grouping and filtering ("only show me
this repo's blueprints"). It defaults to the git remote's repository name, falling back to
the directory name. Labels are unique on the machine by default. When a new blueprint joins
a project that already has blueprints, walkdown says so ("added to `hireart_main`, beside
`search` and `checkout`"), so a wrong project is noticed at once.

### 4. The team chooses the folder names; walkdown reads any of them

A blueprint's home is a folder holding a `spec.yml`. In a repository, homes live anywhere
under `.walkdown/blueprints/`, at any depth: `202610-search/`, `0002-search/`, or
`billing/api/0002-invoices/` for a pack. walkdown suggests `YYYYMM-name`, because a date
says how old a blueprint is and never has to be reallocated. It also accepts whatever the
team chose, and it never parses a number or date out of the name. The filesystem keeps
homes unique: two blueprints cannot be one folder. A home inside another home is refused.

A personal home lives at `~/.walkdown/projects/<project>/blueprints/<folder>/`, laid out
the same way.

### 5. A home is one flat folder

```
.walkdown/blueprints/0002-cli/        # or ~/.walkdown/projects/walkdown/blueprints/0002-cli/
  spec.yml         # the blueprint's settings: runner, targets, prototype root, authoring, design, governance
  storyboard.yml   # screens and their anchors
  features/        # stories and rules
  AGENTS.md        # agent conventions, copied from walkdown
  records.yml      # where this blueprint's runs, threads, evidence and drafts usually live
  .gitignore       # this blueprint's commit choice
  threads/  runs/  evidence/  drafts/
```

- **The spec hash** stamped on every run covers `spec.yml`, `storyboard.yml` and
  `features/`, by name. Today it covers everything under `blueprint/`, so refreshing the
  copied AGENTS.md changes what a run says it was judged against. A change to
  `records.yml`, `.gitignore`, AGENTS.md or any record now leaves it alone. Verdicts are
  unaffected either way: a verdict goes stale only when its own rule's statement hash
  changes.
- **`records.yml` informs and the registry decides.** The file says where records
  usually live, and a registry row may override any of it on this machine (`records
  move`).
- **Each home has its own `.gitignore`.** Committing the spec only, or everything, is one
  blueprint's choice and touches no other blueprint.

### 6. The files walkdown keeps, and their names

| File | What it holds | Changes from today |
|---|---|---|
| `~/.walkdown/profile.yml` | who you are | was `config.yml` |
| `~/.walkdown/registry.yml` | every blueprint you chose to see, its ID, and where its records live on this machine | IDs; project labels; no `<project>-` prefixes |
| `~/.walkdown/cache/claims.json` | which blueprint claims which page address | none |
| `~/.walkdown/projects/<project>/blueprints/…` | personal homes | was `~/.walkdown/blueprints/NNNN-<id>/` |
| `<home>/spec.yml` | the blueprint's settings | was `blueprint/walkdown.yml` |
| `<home>/storyboard.yml`, `features/`, `AGENTS.md` | the spec and the agent conventions | out of the `blueprint/` folder |
| `<home>/records.yml` | where records usually live | new; replaces the repository's `.walkdown/config.yml` |
| `<home>/.gitignore` | this blueprint's commit choice | was one `.walkdown/.gitignore` for all |
| `<home>/threads/`, `runs/`, `evidence/`, `drafts/` | the records | thread files are named by UUID (§9) |

No file in walkdown is called `config.yml` any more, so the three that were are never
mistaken for one another.

### 7. Nothing in the repository unless something is committed

A blueprint that lives only in `~/.walkdown` adds, edits and deletes nothing in the
repository: no pointer, no `.gitignore`, no AGENTS.md.

When the first blueprint is committed, walkdown writes the pointer, a fixed paragraph in
CLAUDE.md or whichever agent file the team names. It says that the repository's specs live
under `.walkdown/blueprints/`, that an agent reads the `AGENTS.md` in the blueprint it is
working on, and that `walkdown blueprints` lists their IDs. It lists no blueprints, so it
is written once and never edited again. `blueprints new`, `commit`, `rename` and `forget`
stop rewriting it. Un-committing the last committed blueprint removes the paragraph, as
today.

### 8. Import takes what it is pointed at

- **`walkdown blueprints import <path-to-a-home>`** registers that one blueprint.
- **`walkdown blueprints import <path-to-a-repository>`** finds every home under its
  `.walkdown/blueprints/`, at any depth, lists them, and asks which to import. With no
  terminal to ask, it prints the list and needs `--all` or `--only`.
- **The same home imported twice** is "already listed".

### 9. Threads carry a UUID, and `n-NNNN` is their label

Every thread gets a UUID when it is filed, and the UUID is its identity. Its file is named
by the UUID, so two branches that each file a note never produce the same file name, and
git never merges two threads into one conflict. `n-0357` stays as the label people read
and type. It is numbered from the threads present where the thread is filed.

Run records and replies written from now on refer to threads by UUID. Records already in
the ledger keep the labels they hold, and resolve through them (below). Nothing in the
ledger is edited.

Two threads in one blueprint can still end up with the same label, after a merge or a
teammate's push. When walkdown sees that, it says so. It offers to give the newer thread
the next free label, and does so only when the person agrees. A relabelled thread keeps
its old label as an alias. Commit messages and code comments that cite `n-0357`, which
walkdown cannot edit, still resolve: `threads show n-0357` names both threads and says
which one now holds the label.

### 10. A worktree is the same project, checked out somewhere else

A checkout belongs to a registered blueprint's project when either of these holds:

- **Its git common directory** (`git rev-parse --git-common-dir`) is the registered
  checkout's. This covers Claude Code's worktrees, and Archon's when made from your
  checkout.
- **Its `origin` remote** is the registered checkout's remote. This covers worktrees Archon
  makes from its own clone under `~/.archon/workspaces/<owner>/<repo>/`.

In a recognised worktree:

- **Committed parts come from the worktree.** The spec files and threads are read from the
  worktree, so the branch's rule edits count.
- **Git-ignored records stay shared.** Runs, evidence and drafts that the blueprint does
  not commit resolve to the registry's location, never inside the worktree. Archon copies
  only `.archon/` and its configured files into a new worktree, and deleting a worktree
  must not take a ledger with it.
- **Committed records follow the checkout.** If a blueprint commits its runs, they are
  written into the worktree and reach the main branch when it merges.
- **Runs are stamped** with the worktree's own commit and branch.
- **`serve` in a worktree** serves that branch's spec, and the panel names the branch it is
  showing.
- **A worktree is never registered as a project.** `blueprints new` and `import` inside one
  attach to the main project.

## Consequences

- **The doors are rewritten.**
  - `blueprints new` stops allocating numbers. It proposes `YYYYMM-name` and accepts any
    folder name.
  - `import` scans at any depth and asks.
  - `rename` changes the description in the ID and, when asked, the folder name. It never
    keeps or makes a number.
  - `commit` moves a home between `~/.walkdown/projects/<project>/blueprints/<folder>` and
    `<repo>/.walkdown/blueprints/<folder>`, and refuses when that folder already exists in
    the repository. Whoever commits a name first wins. Lint warns ahead of that when a
    personal blueprint shares its folder name with a committed one in the same project.
- **Resolution is rewritten.** Every lookup goes through the registry ID or, from inside a
  project, the description. The worktree rules in §10 decide which checkout a committed
  part is read from.
- **Machinery goes away:**
  - home-number allocation and its lock;
  - renumbering on commit;
  - the `<project>-<id>` import prefix;
  - the repository's `.walkdown/config.yml`;
  - the shared `.gitignore`;
  - every edit to the pointer after the first.
- **Migration** happens once, with `walkdown upgrade`, on the person's say-so:
  - `~/.walkdown/config.yml` becomes `profile.yml`.
  - Each home's `blueprint/` folder is flattened, and `walkdown.yml` becomes `spec.yml`.
  - Each home gets a `records.yml` and its own `.gitignore`.
  - Registry rows get IDs and project labels.
  - Personal homes move under `projects/<project>/blueprints/`.
  - Each thread gets a UUID, and its file is renamed to it.

  Existing folder names are kept. This repository's `0001-walkdown` and `0002-cli` are
  valid names. Every verdict stays current, because a verdict goes stale only when its
  rule's wording changes, and moving files changes no rule. Runs recorded after the
  upgrade carry a spec hash computed over the new file names.
- **Rules are reworded** in one batch for Topher's approval, starting with `locations.default`,
  `locations.answer`, `locations.several`, `locations.keeping` and the `commands.blueprints`
  rules. New rules cover registry IDs (§2), the flat home (§5), import (§8), thread UUIDs
  (§9) and worktrees (§10).
- **It ships in 0.4.0 with ADR 0012**, and UPGRADING gives the `walkdown upgrade` step.

## Alternatives considered

- **Keep allocated, numbered homes.** This was rejected. Numbers exist to stop folders
  colliding. A folder path cannot collide with itself, and the registry ID now does the
  other job a number did, telling blueprints apart.
- **Key blueprints by path alone.** This was rejected because a moved checkout would break
  every key under it. The registry ID survives a move.
- **A registry in each repository, merged into the personal one.** This was rejected. The
  registry is the person's choice of what to see. A committed blueprint already declares
  itself by its folder, and `records.yml` carries its defaults.
- **Refuse to run in a worktree.** This was rejected because agents record runs from
  worktrees. Refusing them would mean no recorded runs from the way most building now
  happens.
- **Ids unique within a project, with no registry ID** (this ADR's first draft). This was
  rejected. It still needed a qualified name outside a project. A registry ID is shorter,
  and it survives a renamed project or a moved checkout.
- **Thread ids allocated from a shared counter.** This was rejected. It fixes one machine
  but not a teammate's, and it still leaves label-named files to collide in git.
