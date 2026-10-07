# ADR 0014 — Where walkdown keeps its files

- **Status:** accepted 2026-10-05
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
`billing/api/0002-invoices/` for a pack. walkdown names a new home's folder after the
blueprint (`search/`); a date or number prefix is the team's to add with `--folder`. It
accepts whatever the team chose, and it never parses a number or date out of the name.
(Amended 2026-10-06, n-0355: this first said walkdown suggests `YYYYMM-name`, and Topher
found a prefix he had not chosen was one more thing to read past.) The filesystem keeps
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
  - `blueprints new` stops allocating numbers. It names the folder after the blueprint
    and accepts any folder name.
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

## Appendix: the rule drafts

These are drafted for Topher's approval, and none is built yet. Everything is in the `cli` blueprint unless it says otherwise. Each draft is marked with its kind:

- **words** means the wording changes but the behaviour does not, so it is stamped with `hash --reword` and keeps its verdicts.
- **meaning** means the rule now asks for something different, so its verdicts go stale and it is built and judged again.
- **new** is a rule that does not exist yet.
- **retire** means the rule is retired, and says what replaces it.

After the build, this appendix shrinks to a list of the ids, because the rules themselves are the record.

### Registry IDs and projects (§2, §3)

**`locations.registry.ids-stay-here`** (new)

> Every registered blueprint has an ID that this machine gave it, such as `0002-wd-cli`. No file
> walkdown writes outside `~/.walkdown/registry.yml` contains it.

- *Given:* a machine with two projects, `hireart_main` and `shop`, each with a blueprint whose folder
  is named `search`
- *When:* each is registered, a thread is filed and a run recorded in each, and the first is committed
- *Then:*
  - Each gets an ID made of four digits, its project's code and a description, such as
    `0003-ha-search` and `0004-sh-search`
  - `--blueprint` and `?bp=` accept the ID, and inside a project they also accept the description
    alone
  - The thread, the run record, the pointer and the committed home hold no ID
  - Committing, un-committing or moving the checkout changes the path on the row and keeps the ID
  - A number once given is never given again, even after its blueprint is forgotten
- *Because:* two people's machines can number the same blueprint differently without either
  repository being wrong.

**`locations.registry.projects-are-labels`** (new)

> A project is a label on registry rows, named after the repository unless the person names it. When
> a new blueprint joins a project that already has blueprints, walkdown says so.

- *Given:* a git project whose `origin` remote is `acme/shop`, one with no remote in a directory
  `notes`, and a second checkout whose label and code would both be taken
- *When:* a blueprint is made in each, then another in `shop`
- *Then:*
  - The first is labelled `shop`, from the remote, and the second `notes`, from the directory
  - The second blueprint in `shop` is reported as added to `shop`, beside the one already there
  - A label or code that is already taken is offered for the person to change, and nothing is
    registered until they do
  - With no terminal to ask, it is refused, and the refusal says how to choose a label and code
- *Because:* a blueprint filed under the wrong project should be noticed when it is made, not weeks
  later in a list.

### Homes (§4, §5, §6)

**`locations.default.one-home-per-blueprint`** (retire)

This is replaced by `locations.default.folder-names-are-yours` and `locations.registry.ids-stay-here`.
A number allocated once is no longer how homes are kept apart.

**`locations.default.folder-names-are-yours`** (new)

> A blueprint's home is any folder under `.walkdown/blueprints/` that holds a `spec.yml`, at any depth
> and with any name. walkdown never reads a number or a date out of the name.

- *Given:* a repository with homes at `.walkdown/blueprints/202610-search/`, `0002-search/` and
  `billing/api/invoices/`, and a fourth home inside `202610-search/`
- *When:* the repository is imported, and `walkdown blueprints new checkout` is run in it
- *Then:*
  - The three homes are found and offered, each under its own folder
  - The home inside another home is refused, and both folders are named
  - `blueprints new` suggests a folder named for this month, such as `202610-checkout`, and accepts
    any other name it is given
  - No folder is renumbered or renamed to suit walkdown
- *Because:* a team arranges its own repository, and two homes cannot be the same folder.

**`locations.default.records-follow-the-spec`** (meaning)

> A blueprint's home is one folder. The spec (`spec.yml`, `storyboard.yml`, `features/`), its
> `AGENTS.md`, `records.yml` and `.gitignore`, and the four kinds of record (`threads/`, `runs/`,
> `evidence/`, `drafts/`) sit side by side in it, with no folder between.

- *Given:* a blueprint in its home, kept in the repository, and another kept in
  `~/.walkdown/projects/shop/blueprints/`
- *When:* its location is asked for
- *Then:*
  - The spec and the four records resolve as siblings in one folder, laid out the same in both places
  - There is no `blueprint/` folder inside a home
  - No kind of record sits inside another
  - Moving the home moves all of it together and edits none of it
- The `because` is unchanged.
- The id no longer fits the statement. Once `commands.rules.rename` is built, rename it to
  `locations.default.home-is-one-folder`.

**`locations.travel.judged-against-a-spec`** (meaning)

> Every run records a content hash of the spec it was judged against: `spec.yml`, `storyboard.yml`
> and `features/`, and no other file. Recording a verdict never changes that hash.

The three existing steps stay, and these are added to *Then*:

- Editing `AGENTS.md`, `records.yml` or `.gitignore`, or adding any other file to the home, leaves
  the hash where it was

**`locations.default.records-yml-informs`** (new)

> A blueprint's `records.yml` says where its runs, threads, evidence and drafts usually live. The
> blueprint's row in this machine's registry may say otherwise.

- *Given:* a committed home whose `records.yml` sends evidence to `../evidence`, checked out on two
  machines, one of which has moved its evidence with `records move`
- *When:* each records a run with evidence
- *Then:*
  - The first files the evidence where `records.yml` says
  - The second files it where its registry row says, and `walkdown where` names the row as the reason
  - `records move` never edits `records.yml`
- *Because:* a team can agree where records usually go without one person's disk deciding it for
  everyone.

**`locations.default.nothing-in-the-tree`** (meaning)

> Until a person asks walkdown to keep a blueprint in the repository, walkdown adds, edits and
> deletes nothing there. The spec, threads, runs, evidence and drafts live in the person's own
> `~/.walkdown/projects/`.

- *Given:* a repository that has never seen walkdown, and no profile
- *When:* a blueprint is made, and a run, a thread and a draft are recorded
- *Then:*
  - The tree is byte for byte as it was: no `.walkdown/`, no pointer, no `AGENTS.md`, no
    `.gitignore`, nothing for git to see
  - Everything walkdown made sits in one home under `~/.walkdown/projects/<project>/blueprints/`
  - Deleting that one folder removes everything walkdown made for that blueprint
  - Asked what is tracked, walkdown answers nothing, and says why
- The `because` is unchanged.

**`locations.default.in-repo-on-request`** (meaning)

> A blueprint stays out of version control unless asked. Asking is one choice for the spec and its
> threads, and another for everything, made per blueprint and visible in that blueprint's own
> `.gitignore`.

- *Given:* a project with two blueprints, fresh or already set up
- *When:* the person commits one blueprint's spec, then everything, then nothing again
- *Then:*
  - The home sits under the repository's `.walkdown/blueprints/`, laid out as every home is
  - With the spec committed, the home's own `.gitignore` keeps runs, evidence and drafts out
  - With everything committed, the home has no `.gitignore`
  - The other blueprint's files are untouched by each change
  - Asked again with a different choice, the home's `.gitignore` is written or removed, or the home
    moves whole with no record edited
  - The command reports what is tracked now, in words, and how to change its mind later
  - What is tracked is asked of git, not read from the ignore file walkdown wrote. A root
    `.gitignore` hiding `.walkdown`, an ignore file somebody emptied, and a home that left with its
    files still in the index are each said outright, and lint errors where they disagree (n-0179,
    n-0180, n-0181)
- The `because` is unchanged.

### Finding and importing (§1, §8)

**`locations.answer.registry-is-the-only-door`** (meaning)

> walkdown reads only what the registry lists, and worktrees of the checkouts it lists. A
> `.walkdown` folder in any other checkout is not consulted.

The existing steps stay, and this is added to *Then*:

- A worktree of a registered checkout is read as that checkout's project (`locations.worktree.same-project`),
  and gets no row of its own

**`locations.answer.declared-not-discovered`** (meaning)

The statement is unchanged. Two steps in *Then* change:

- The unregistered one is not a project at all, however much it looks like one. Where its checkout
  holds a home, the answer names the folder and says `walkdown blueprints import`
- The registry is consulted, and the report says which row answered and how it got there

The second step loses its clause about a `blueprints:` list in `config.yml`, because no such file is
read any more (`locations.keeping.upgrade-moves-once`).

**`locations.answer.says-why`** (meaning)

> Every path walkdown reports says why it was chosen: a flag on the command line, this machine's
> registry, the blueprint's own `records.yml`, a worktree of a registered checkout, or the built-in
> default.

The steps are unchanged.

**`locations.answer.asking-writes-nothing`** (words)

In *Given*, "no personal config at all" becomes "no `~/.walkdown` at all".

**`commands.blueprints.import-takes-what-it-is-pointed-at`** (new)

> `walkdown blueprints import <path>` registers the blueprint whose folder the path names. Pointed
> at a repository, it lists every blueprint folder in it and asks which to register.

- *Given:* a repository with three committed homes, one of them already registered here
- *When:* it is imported by one home's path, then by the repository's path in a terminal, then by the
  repository's path with no terminal
- *Then:*
  - The home's path registers that blueprint alone, and says its ID and its project
  - The repository's path lists each home by its folder, marks the one already listed, and registers
    the ones chosen
  - With no terminal, it prints the list and registers nothing until `--all` or `--only <folder>` is
    given
  - A home already registered is reported as already listed, and its row is unchanged
  - A path holding no home says so and registers nothing
- *Because:* pointing at one blueprint should get that one, and pointing at a repository should not
  quietly register everything in it.

**`commands.blueprints.import-and-forget-moved`** (retire)

This is replaced by `commands.blueprints.import-takes-what-it-is-pointed-at` and
`commands.blueprints.forget-keeps-the-files`. Its *Given* named the repository's
`.walkdown/config.yml`, which is gone.

**`commands.blueprints.forget-keeps-the-files`** (new)

> `walkdown blueprints forget <id>` takes a blueprint off this machine's list and touches none of its
> files.

- *Given:* a committed blueprint and a personal one, each with runs and threads
- *When:* each is forgotten
- *Then:*
  - Neither is served or listed afterwards
  - Every file in both homes is as it was
  - The personal home's folder is named, with how to delete it, because nothing else will
- *Because:* forgetting is a choice about what this person sees, not about what exists.

### Making, committing and renaming (§4, §7)

**`commands.blueprints.new-makes-one`** (meaning)

> `walkdown blueprints new [<name>]` makes a blueprint for the project where it is run, named after
> the project's directory unless a name is given. Running it again changes nothing.

- *Given:* a git project `shop` with no blueprint, on a machine that has run `walkdown init`
- *When:* `walkdown blueprints new` is run, then again, then `walkdown blueprints new search`
- *Then:*
  - The first makes and registers `shop` in `~/.walkdown/projects/shop/blueprints/`, in a folder
    named for this month, and adds nothing to the repository
  - The second reports everything up to date
  - The third makes `search` beside `shop`, and says that commands which write now take
    `--blueprint`
  - `--commit spec|all` and `--dir` act as they did on `init`
- The `because` is unchanged.

**`locations.several.init-makes-another`** → **`locations.several.new-makes-another`** (meaning, renamed, n-0355)

> `walkdown blueprints new <name>` gives a project that already has a blueprint a second one, in a
> home of its own. Running the same command again changes nothing.

- *Given:* a project `shop` with the blueprint `search`, kept outside the repository, and a second
  project that also has a `search`
- *When:* `walkdown blueprints new checkout` is run in `shop`, then the same again, then with no name
- *Then:*
  - The first makes a home for `checkout` beside `search`'s, registers it with an ID, and says it
    joined `shop` beside `search`
  - The second reports everything up to date and creates nothing
  - With no name, it means the name it would give the project anyway, and reuses that blueprint. If
    none has that name, it refuses and names them
  - A name another project already uses is not refused, and gets an ID of its own
  - With several blueprints in the project, `blueprints commit` needs `--blueprint`, and without it
    refuses and names the choices
  - `walkdown serve` lists both, and `walkdown claims` reports both when both claim a page
- The `because` is unchanged.

Its `history` gets: the id changes because the rule is about `blueprints new`, not `init` (n-0355). Renaming a rule
while keeping its verdicts needs the verb below, so this one is built first.

**`commands.rules.rename`** (new)

> `walkdown rules rename <rule> <new-id>` gives a rule a new id and keeps every verdict it had.

- *Given:* a rule with checks, agent verdicts, a signature and an anchored thread
- *When:* it is renamed, then `walkdown status` and `walkdown lint` are run
- *Then:*
  - The rule carries its old id in a list of former ids, and its statement hash is unchanged
  - `walkdown status <new-id>` shows every verdict it had, from run records that were not edited
  - Its threads are anchored to the new id
  - A test still tagged with the old id counts for the rule, and lint warns with the new id to use
  - An id the blueprint already has, or a former id of another rule, is refused, and nothing changes
- *Because:* an id that misnames its rule should be put right without judging it all again.

**`commands.blueprints.commit-moves-the-home`** (meaning)

> `walkdown blueprints commit <none|spec|all>` moves a blueprint's home between
> `~/.walkdown/projects/<project>/blueprints/` and the repository's `.walkdown/blueprints/`, keeping
> its folder name and its ID.

- *Given:* a project with two blueprints kept outside the repository, and a committed folder that has
  the same name as one of them
- *When:* `walkdown blueprints commit spec` is run for the other one, then `walkdown blueprints commit
  none`, then `commit spec` for the one whose folder name is taken
- *Then:*
  - The home moves into `.walkdown/blueprints/` with its own `.gitignore`, then back out, records and
    all
  - The ID on its row is the same throughout
  - No other blueprint's files change
  - The one whose folder name is already committed is refused, naming the folder, and nothing moves
  - Lint warns about that clash before anyone tries to commit
- The `because` is unchanged.

**`commands.blueprints.rename`** (meaning)

> `walkdown blueprints rename <id> <new-name>` changes the name at the end of a blueprint's ID, such
> as `cli` in `0002-wd-cli`, and with `--folder` its folder too. Its rules, threads and runs stay as
> they were.

- *Given:* a project with blueprints `a` and `b`, with `b` committed in the repository
- *When:* `walkdown blueprints rename b search` is run, then the same with `--folder 202610-search`,
  then `rename a search`, then `rename a "Not An Id"`
- *Then:*
  - `b`'s ID now ends in `search`, keeping its number and its project code, and its folder is
    unchanged
  - With `--folder`, the folder is renamed, and that rename is the only change in the repository
  - Its rules, threads and run records are byte for byte what they were, and
    `walkdown status --blueprint search` reads as `b` did
  - Renaming `a` to a name the project already has, or to something that is not a name, is refused
    and changes nothing
- The `because` is unchanged.

The pointer step goes away, because the pointer no longer names blueprints.

### The pointer (§7)

**`locations.pointer.placed-where-agents-read`** (meaning)

> Committing a repository's first blueprint adds one paragraph, saying where the specs are, to the
> file that repository already keeps its agent instructions in. If several files could be that one,
> walkdown writes nothing and names them.

- *Given:* a repository whose first blueprint is being committed. A blueprint that is not committed
  gets no pointer, because nothing of walkdown's is in the tree.
- The *When* and *Then* steps are unchanged.

**`locations.pointer.owns-only-its-block`** (meaning)

> walkdown owns one fenced paragraph in the repository's agent-instruction file, and nothing else in
> that file. It writes the paragraph once, and removes it when the last blueprint is moved back out of
> the repository.

- *Given:* an agent-instruction file with a person's own words above and below a walkdown block
- *When:* a second blueprint is committed, one is renamed, and then every blueprint is un-committed
- *Then:*
  - The second commit and the rename leave the file byte for byte as it was
  - Un-committing the last blueprint removes the block and nothing else
  - Every line outside the markers is untouched throughout
- *Because:* a paragraph that never names a blueprint never goes stale, so there is nothing to keep
  up to date.

**`locations.pointer.names-every-blueprint`** (retire)

This is replaced by `locations.pointer.names-no-blueprint`.

**`locations.pointer.names-no-blueprint`** (new)

> The paragraph walkdown writes into the repository's agent-instruction file says that the specs live
> under `.walkdown/blueprints/`, that an agent reads the `AGENTS.md` in the blueprint it works on, and
> that `walkdown blueprints` lists their IDs. It names no blueprint.

- *Given:* a repository with blueprints `a` and `b` committed
- *When:* the pointer is read
- *Then:*
  - It says each of those three things
  - It holds no blueprint's name, folder or ID
  - It says that commands which write take `--blueprint <id>`, with `<id>` as written
- *Because:* a blueprint's ID differs from one machine to the next, so committed text can only say
  where to look.

### Threads (§9)

**`locations.several.thread-ids-unique`** (retire)

This is replaced by `locations.threads.uuid-is-the-identity` and `locations.threads.clashing-labels-ask`.

**`locations.threads.uuid-is-the-identity`** (new)

> Every thread gets a UUID when it is filed, and its file is named by it. Its label, such as
> `n-0357`, is the next number after the threads already present where it is filed.

- *Given:* two branches of one repository, each filing a note in blueprint `a`, whose threads run to
  `n-0005`, and blueprint `b` in the same project, whose threads run to `n-0002`
- *When:* each branch files its note, the branches are merged, and a question is filed in `b`
- *Then:*
  - Each branch's note is labelled `n-0006`, in a file named by its own UUID
  - The merge adds two files and gives git no conflict
  - `b`'s new question is `q-0007`, numbered across the project
  - A run record or reply written now names a thread by its UUID
  - Records already in the ledger are unchanged, and still find their threads by label
- *Because:* two people filing at once should get two threads, not one merge conflict.

**`locations.threads.clashing-labels-ask`** (new)

> When two threads in a blueprint share a label, walkdown says so, and relabels the newer one only
> when a person agrees. The old label stays as an alias.

- *Given:* a blueprint where a merge has left two threads labelled `n-0006`
- *When:* `walkdown threads` and `walkdown lint` are run, the person agrees to relabel, and
  `walkdown threads show n-0006` is run
- *Then:*
  - Both commands name the two threads and the label they share
  - Nothing is relabelled until the person agrees. With no terminal, the command that does it is named
  - Agreeing gives the newer thread the next free label, and keeps `n-0006` as its alias
  - `threads show n-0006` names both threads, and says which one holds the label now
  - No run record or reply is edited
- *Because:* a label in a commit message cannot be edited, so it has to keep finding its thread.

### Worktrees (§10)

**`locations.worktree.same-project`** (new)

> A worktree of a registered checkout belongs to that checkout's project. That is so when git says
> they share a repository, or when their `origin` remotes match.

- *Given:* a registered checkout of `shop`, a Claude Code worktree of it, an Archon worktree made from
  Archon's own clone under `~/.archon/workspaces/acme/shop/worktrees/`, and an unrelated clone
- *When:* `walkdown where` and `walkdown status` are run in each, and `walkdown blueprints new` in a
  worktree
- *Then:*
  - Both worktrees answer as `shop`'s blueprints, and `where` says which way each was matched
  - The unrelated clone is not a project
  - No worktree gets a registry row
  - `blueprints new` in a worktree adds the blueprint to `shop`, and the home is made in the
    registered checkout's place, not in the worktree
- *Because:* agents build in worktrees, and the records they make there belong to the project.

**`locations.worktree.branch-spec-shared-records`** (new)

> In a worktree, walkdown reads the spec and threads from the worktree. The runs, evidence and drafts
> that git ignores are written where the registry says they live.

- *Given:* the Claude Code worktree of `shop`, on a branch that rewords a rule
- *When:* `status` is run, a thread is filed, checks are recorded, the worktree is deleted, and the
  same is done for a blueprint that commits its runs
- *Then:*
  - `status` reads the reworded rule as the branch has it
  - The thread lands in the worktree's tree
  - The run lands in the registered checkout's runs, stamped with the worktree's commit and branch
  - Deleting the worktree loses no run, evidence or draft
  - A blueprint that commits its runs writes them into the worktree instead
  - `serve` started in the worktree serves the branch's spec
- *Because:* a branch's rule changes should count on that branch, and deleting a worktree must not
  take a ledger with it.

The panel naming the branch it shows (§10) belongs to the `walkdown` blueprint and needs a screen. It
gets a design request when this is approved, not a rule drafted here.

### Migration

**`locations.keeping.old-config-never-misfiles`** (retire)

This is replaced by `locations.keeping.upgrade-moves-once`. The layouts it guarded against are moved
by the upgrade, never read in place.

**`locations.keeping.upgrade-moves-once`** (new)

> `walkdown upgrade` moves walkdown's files from the old layout to the current one, once, when a
> person runs it. It keeps every folder name and every verdict.

- *Given:* a machine with `~/.walkdown/config.yml` and a personal home
  `~/.walkdown/blueprints/0003-shop/blueprint/`, and a repository with `.walkdown/config.yml`, a
  shared `.walkdown/.gitignore` and threads named `n-0001.yml`
- *When:* `walkdown status` is run, then `walkdown upgrade`, then `walkdown upgrade` again
- *Then:*
  - `status` says an upgrade is due, names `walkdown upgrade`, and changes nothing
  - `config.yml` becomes `profile.yml`
  - Each home's `blueprint/` folder is flattened, and `walkdown.yml` becomes `spec.yml`
  - Each home gets a `records.yml` and its own `.gitignore`, and the repository's
    `.walkdown/config.yml` and shared `.gitignore` are removed
  - The personal home moves to `~/.walkdown/projects/shop/blueprints/0003-shop/`, keeping its name
  - Registry rows get IDs and project labels
  - Each thread gets a UUID, and its file is renamed to it, keeping its label
  - `walkdown status` then shows every verdict it showed before
  - Run again, it reports nothing to do
- *Because:* a layout should change once, on purpose, and never be half-moved by whichever command
  happened to run first.

### Names of files only

These are all **words** rules, stamped with `hash --reword`:

- **`commands.init.this-machine-only`.** In *Then*, "an identity in its config.yml" becomes "an
  identity in `profile.yml`".
- **`ownership.design.declared-per-blueprint`.** "in its `walkdown.yml`" becomes "in its `spec.yml`".
- **`locations.several.reads-cover-all`.** "each under its id" and "headed by its id" become "its
  ID".
- **`panel.start.which-project`** (walkdown blueprint). "their personal config" becomes "their
  registry".

### Read and left alone

These rules were read and need no change:

- `commands.records.move`
- `locations.keeping.moving-is-a-decision`
- `locations.several.writes-name-one`, `lint-reads-the-project`, `results-filed-by-rule`,
  `rules-move` and `serve-shows-each-screen`
- `locations.answer.serve-starts-anywhere` and `adapters-file-where-walkdown-says`
- `locations.default.prototype-beside-the-spec`
- `locations.travel.evidence-by-key`
- `delivery.install.clone-is-the-install`
- `panel.start.choose-a-blueprint`

The adapter's "a committed spec is still found by looking up from the code" is checked during the
build, because homes can now sit at any depth.
