# Changelog

All notable changes to walkdown are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
walkdown is pre-1.0, so a minor version may still change the ledger, thread or
registry formats; [UPGRADING.md](UPGRADING.md) says what to do when one does.

## [Unreleased]

## [0.4.1] - 2026-10-09

Nothing to do from 0.4.0 but check out the tag; see
[UPGRADING.md](UPGRADING.md#from-040-to-041).

### Changed

- Design comes first. The conventions every blueprint carries (`AGENTS.md`) say
  no rule on a screen is built until a person has accepted its design. A
  designer draws it where there is one; otherwise a separate design agent drafts
  it, never the agent building the app. `/walkdown:formulate` stops at a screen
  with no accepted design instead of building ahead of it.
- `/walkdown:setup` checks the version of an existing install, and walks an
  older one up through `UPGRADING.md` before setting up the project.

## [0.4.0] - 2026-10-09

Upgrading from 0.3.0: see [UPGRADING.md](UPGRADING.md#from-030-to-040). The command
line became nouns and verbs, every write names its blueprint, and `walkdown upgrade`
moves walkdown's files once.

### Added

- `walkdown upgrade` moves an install laid out before
  [ADR 0014](docs/adr/foundational/202610_where_walkdown_keeps_its_files.md) to the new
  layout, once. `--dry-run` says what it would move. Until it has run, every command that
  loads a blueprint exits 2, says an upgrade is due and changes nothing. `--code <pc>`
  gives the project it is run in that code, instead of the one derived from its label.
- `walkdown blueprints rename <id> <new-name> [--folder <folder>]` changes the name in a
  blueprint's ID, keeping its number and code. `--folder` renames the home folder too.
  Rules, threads and runs are untouched.
- `walkdown records list` says where each kind of record is kept.
- A refused `walkdown threads set` says that nothing changed and that its reply did not
  land.
- A project can hold several blueprints
  ([ADR 0011](docs/adr/foundational/202610_several_blueprints_per_project.md),
  [#20](https://github.com/profoundry-us/walkdown/issues/20)).
  `walkdown blueprints new <name>` gives a project that has a blueprint another one, in its
  own home, and says which blueprints the project already holds.
- In a project with several blueprints, a recorded test run files each result in the
  blueprint that holds its rule: one record per blueprint, sharing a run id. A tag no
  blueprint holds is named and recorded nowhere. This holds for the node:test and
  Playwright reporters and the RSpec formatter
  ([ADR 0013](docs/adr/foundational/202610_a_project_split_into_blueprints.md)).
- `walkdown rules move <rule|story|feature>... --to <blueprint>` moves rules to another
  blueprint of the same project, with their threads, and copies the run records,
  sweeps and evidence behind their verdicts, so every verdict and signature reads the
  same there. The source's records are never edited. `--dry-run` says what would move.
  It refuses a destination outside the project, a rule the destination already has,
  uncommitted feature changes, and a destination whose targets would leave a copied
  verdict reading as never.

- `walkdown blueprints new` makes live only the test runner the project declares:
  Playwright in `package.json`, RSpec in the `Gemfile`, or `node --test` as the test
  script. The other blocks stay in `spec.yml`, commented, and it says which runner it
  chose. A project that declares none gets no `run_all`; `walkdown run` there exits 2,
  runs nothing, and names the `spec.yml` to fill in.
- A signed rule comes back to its signer when the agent fixes a finding on it that the
  signer replied on, once the fix is judged. Their signature stands meanwhile.

### Changed

- Where walkdown keeps its files
  ([ADR 0014](docs/adr/foundational/202610_where_walkdown_keeps_its_files.md)).
  `walkdown upgrade` makes every move below:
  - A blueprint's home is one folder: `spec.yml` (was `blueprint/walkdown.yml`),
    `storyboard.yml`, `features/`, `AGENTS.md`, `records.yml`, its own `.gitignore`,
    `threads/`, `runs/`, `evidence/` and `drafts/`. There is no `blueprint/` folder inside it.
  - `~/.walkdown/config.yml` is `~/.walkdown/profile.yml`. A repository's
    `.walkdown/config.yml` and `.walkdown/.gitignore` are gone.
  - Registry IDs are `NNNN-<code>-<name>`, numbered on this machine (`0001-wd-walkdown`).
    Each row names its project by a short label and code, and its checkout by path.
    Inside a project, a blueprint's bare name works wherever its ID does; outside it, a
    bare name is refused with the ID that reaches it. An ID from before the upgrade, kept on
    its row as `formerly:`, still works (`acme_main` became `0001-am-acme-main`). A
    personal home lives at `~/.walkdown/projects/<label>/blueprints/`.
  - A thread is stored as `threads/<uuid>.yml`. Its `n-NNNN` is a label, which two
    branches can give out twice, and its uuid is what identifies it. Attachments are named
    after the uuid.
  - `walkdown blueprints import <path>` takes what it is pointed at: one blueprint's
    folder registers that one, and a repository lists its blueprints and asks which. With
    no terminal it needs `--all` or `--only <folders>`. `walkdown blueprints add` is gone.
  - The pointer `blueprints new` writes into `CLAUDE.md` / `AGENTS.md` is fixed text
    that names no blueprint.
- The command line is nouns and verbs
  ([ADR 0012](docs/adr/foundational/202610_cli_command_structure.md)). A noun alone lists,
  and `walkdown <noun> help` lists its verbs. `walkdown help` groups every command under
  what it acts on. A retired form exits 2 and prints the form that replaced it, with its
  arguments carried over; nothing runs. [UPGRADING.md](UPGRADING.md) has the full table.

  | Was | Now |
  |---|---|
  | `walkdown init` (in a project) | `walkdown blueprints new [<id>]` |
  | `walkdown init --id <name>` | `walkdown blueprints new <name>` |
  | `walkdown init --commit <s>` | `walkdown blueprints commit <s>` |
  | `walkdown import <path>` | `walkdown blueprints import <path>` |
  | `walkdown blueprint forget <id>` | `walkdown blueprints forget <id>` |
  | `walkdown move <kind> --to <path>` | `walkdown records move <kind> --to <path>` |
  | `walkdown thread new …` | `walkdown threads new …` |
  | `walkdown thread <id>` | `walkdown threads show <id>` |
  | `walkdown thread <id> --reply <text>` | `walkdown threads reply <id> <text>` |
  | `walkdown thread <id> --status <s> [--reply <text>]` | `walkdown threads set <id> --status <s> [--reply <text>]` |

- `walkdown init` gets this machine ready and makes no blueprint: it creates
  `~/.walkdown` and its registry, records who you are, installs the skills the way
  `walkdown skills` does, and names anything walkdown needs that is missing (Node 20 or
  later, git), exiting 1 if so. It writes nothing in a project and is safe to run again.

- A new blueprint's `spec.yml` names no `runner.list`. Lint reads coverage from the
  rule tags in the files under `authoring.location`, which works for any framework and
  costs nothing. It used to run `npx playwright test --list`, over a second on every lint
  in a project without Playwright. A `list:` you named is still used.
- In a project with several blueprints, `status`, `lint`, `threads` and `where` with no
  `--blueprint` report on every one, a section each, and `--json` answers
  `{ "blueprints": [ … ] }`. A project with one blueprint prints what it did before.
- **Breaking:** every command that writes into a blueprint needs `--blueprint <id>`,
  with one blueprint or several and wherever it is run: `threads new`, `set`, `reply` and
  `relabel`, `records move`, `rules move` and `rename`, `sweep`, `judge`, `hash --write`
  and `blueprints commit`. Without it the command exits 2, lists the project's IDs and
  changes nothing. A write never takes its blueprint from the folder it is run in, from a
  project's only blueprint, or from a thread label only one blueprint holds. Reads
  (`status`, `lint`, `threads`, `threads show`, `where`) need none. `walkdown run` with no
  `--blueprint` runs the project's suite once and files by rule; with one, it records only
  that blueprint's results.
- `walkdown blueprints new` names a new home's folder after the blueprint (`search`). A
  date or number prefix is yours to choose with `--folder 202610-search`.
- `walkdown blueprints new` run in a folder inside a registered checkout adds the
  blueprint to that checkout's project: at a terminal it asks first, and without one it
  says so. `--project <label>` makes a project of its own instead. A subfolder named like
  the project's own blueprint is refused and offered a name of its own.
- `walkdown where` puts every reason in brackets, under the path it explains. Asked for
  one kind with no answer, it prints nothing on stdout and the reason on stderr.
  `walkdown where prototype` and `where proposals` answer like the other kinds.
- A refusal for a folder walkdown has no blueprint for gives the reason first, then what
  to do, a line each. In a repository of its own inside a registered checkout, it says
  so.
- A rule a signer sent back returns to their queue once a fix is claimed and judged,
  however the agent closed the note that carried it.
- Lint accepts what names another blueprint's rule, thread or screen in the same
  project: a check tagged with its rule, a rule whose origin is its thread, a run
  result for its rule, and a thread on its screen.
- A new thread's id is unique across every blueprint in its project.

### Fixed

- Every reporter records a run under the same person. The RSpec formatter reads
  `~/.walkdown/profile.yml` (it read only `config.yml`, so after `walkdown upgrade` every
  RSpec run was recorded under the OS login), then git, then the account it runs as, as
  the CLI does. The node:test and Playwright reporters ask git from the code, where a
  repository's own identity is, not from a home kept in `~/.walkdown`.
- `walkdown blueprints commit` finds its blueprint wherever it is run; it worked only at
  the checkout's root. Standing inside a home kept in `~/.walkdown` answers as that
  home's project.
- `walkdown blueprints import <path>` refuses a home inside another home, as the scan of a
  repository already did.
- When `walkdown blueprints new` refuses a taken project label or code, it says what
  happened in plain words, and the command it suggests works as printed, keeping the
  `--project` you gave. A code that is no code is refused before anything is made.
- Commands no longer say "No blueprint here" where several blueprints are registered;
  they say which ones are.
- `walkdown init --commit all` no longer deletes a `.walkdown/.gitignore` that other
  blueprints in the same `.walkdown/` rely on, or one somebody edited; `--force` still
  does. Giving walkdown its second blueprint deleted walkdown's own.
- A forgotten blueprint kept in `~/.walkdown` can be taken back:
  `walkdown blueprints import <its folder>`, run inside its project, lists it again under a
  new number. `walkdown blueprints new` with its name says so, instead of calling the
  folder no blueprint.
- `walkdown claims --url` uses the panel's own matcher, so a screen declared by its query
  (`/orders?tab=returns`) is the answer there too. The two had disagreed.
- A built rule that no check claims is queued only to the agent, to write the check. It
  is no longer also queued to a person to walk down. An unbuilt rule's item for a person
  says it is about approving the wording.
- `walkdown threads new`, `threads show` and `threads` say why each thread exists. A
  request reads as a design request.
- `walkdown threads show <id>` in a project with several blueprints says the thread is in
  none of them, when none holds it, instead of asking you to choose a blueprint.
- `walkdown serve` started in a project with several blueprints names them, instead of
  saying it started outside a registered project.
- `walkdown sweep` refused without `--why` exits 2, as other refusals do, and says
  nothing was changed.
- `walkdown blueprints import` counts the blueprints on this machine. It used to read as a
  count of what it had imported.
- `walkdown skills` says the plugin is not installed where the name `walkdown` in Claude
  Code's skills folder is a link somebody else made, instead of describing copies.
- After a checkout moves, `walkdown blueprints import` reports every blueprint that
  moved with it, keeps all of their IDs (including ones never registered), and
  registers the move before any new folder. A checkout that is still in place is not
  treated as moved, even at a commit from before its blueprints. Neither is one taken
  over by a different repository with the same layout or an origin of the same name:
  each blueprint registered from now on records its repository's first commit and its
  origin.
- `walkdown blueprints import --only` with a folder that is already listed says so and
  imports the rest. It used to refuse and import nothing.
- `walkdown serve` and its API name the blueprints to choose from. They no longer say the
  server was started outside a project.
- `walkdown status` queues each rule to one party at a time:
  - A rule awaiting the agent's judgment is held from people, whether it has never been
    judged, is stale, has a fix to re-judge, or has failed.
  - A failed rule with nothing open on it is queued for the agent to judge again.
  - A fixed fail is re-judged.
  - A rule that no check claims asks a person only to approve its wording.
- A finding or observation is refused when it carries a person's words (`said`,
  `added`). Those are feedback.
- `walkdown claims --url` checks a screen's query keys whether or not they repeat. An
  address that matches a screen only after its query is dropped says it has no screen
  of its own.

- `walkdown run` never has `npx` download a test runner. A command that starts with
  `npx <tool>`, where no `node_modules/.bin/<tool>` is installed, is refused by name with
  the install command to run. Nothing runs.
- A sweep covers only the rules that stood in its blueprint when it was declared, so a
  rule moved in later is not swept by an older sweep. A sweep copied by `rules move`
  covers only the rules it came with, and copied in two batches it reads as one sweep.
- The agent's own note, fixed and judged since, is listed in `walkdown status` as the
  agent's to close, not as yours. Words written while settling a note no longer count
  as a new fix, so they no longer send the rule back to be judged.
- `walkdown blueprints import` knows a checkout's `.git` by its birth time as well as its
  inode, so a drive that reuses an inode gives no one a deleted project's IDs. A
  re-cloned checkout's rows learn its new `.git`. Where nothing can tell a checkout from
  another repository, `--project <label>` says which it is.
- The DOMPurify and Phosphor licence notices ship in `vendor/` beside the code they
  cover.

## [0.3.0] - 2026-10-02

Upgrading from 0.2.0: see [UPGRADING.md](UPGRADING.md#from-020-to-030). Two changes
break what worked before: the skills are renamed (`/walkdown-judge` is now
`/walkdown:judge`, and so on for every skill), and `walkdown init` links them for
Claude Code instead of copying them.

### Added

- The clone is a Claude Code plugin named `walkdown`
  ([ADR 0010](docs/adr/foundational/202610_claude_code_skill_packaging.md)). Its skills are
  `/walkdown:setup`, `/walkdown:formulate`, `/walkdown:judge`, `/walkdown:incorporate`
  and `/walkdown:backlog`, and the repository is its own marketplace.
- `/walkdown:lint` and `/walkdown:status`, which run the clone's CLI and report what it
  said.
- `lib/released-skills.json`, the hash of every skill copy walkdown has released,
  written by `tools/released-skills.mjs` at release time.
- This changelog, and [UPGRADING.md](UPGRADING.md) with the steps between versions.

### Changed

- `walkdown init` and `walkdown skills` install for Claude Code as one link,
  `~/.claude/skills/walkdown`, to the clone, instead of five copies. Updating the clone
  updates the skills.
- With `--force`, installing for Claude Code removes the `walkdown-<name>` copies an
  earlier version left, when they match a released version, and keeps any that were
  edited. Without it, they are named as duplicates.
- **Breaking:** in Claude Code the skills are `/walkdown:<name>`, no longer
  `/walkdown-<name>`. Copies for other agents keep the `walkdown-<name>` names.
- The skills moved from `lib/skills/walkdown-<name>.md` to `skills/<name>/SKILL.md`.

### Fixed

- The skills installer never writes through a link, and leaves alone any link it did
  not make.
- Running walkdown's own test suite no longer installs skills into the developer's
  `~/.claude/skills`.

## [0.2.0] - 2026-10-01

Upgrading from 0.1.x: see [UPGRADING.md](UPGRADING.md#from-01x-to-020).

### Added

- `design.by` in `walkdown.yml` says who draws a blueprint's design: `person` (the
  default) or `agent`. Lint reports any other value as an error
  ([ADR 0009](docs/adr/foundational/202609_who_draws_the_design.md)).
- A **design queue** in `walkdown status`, listed before the agent's. Its heading says
  whether it is for the designer or for the design agent.
- `walkdown thread new --screen <id>` files a design request on the screen when no
  `--reason` is given.
- `walkdown where` lists the `prototype` and `proposals` folders and says where each
  was found.
- `walkdown serve` runs from any directory and serves every blueprint registered on the
  machine. It picks a blueprint from the address or asks, and finds a blueprint
  registered after it started without a restart
  ([#19](https://github.com/profoundry-us/walkdown/issues/19)).
- The agent's passing verdict on a rule settles the addressed notes the agent wrote on
  it, and the judge prompt tells an agent to settle them.
- CI runs the unit tests and the Playwright checks on every push to `main`.

### Changed

- A note with reason `request` is queued for design, never for the agent building the
  app ([#2](https://github.com/profoundry-us/walkdown/issues/2)).
- Lint's warning about a screen with no design is cleared only by an open design
  request. A question or feedback note on the screen no longer clears it, and neither
  does a request that has ended.
- `walkdown thread new` refuses a thread with neither `--rule` nor `--screen`.
- A note the agent wrote, other than a design request, is never put to a person to
  verify. It is judged again after its fix, then settled by the agent. A person's queue
  lists only their own notes and design requests, and counts the two apart
  ("1 note of yours answered, 1 design request drawn").
- The panel's surface buttons are named for what each side shows (Design or Proposal;
  App, As-built or Stand-in) and are disabled when that side has nothing to show.
- A `proposals/` folder is looked for beside the spec first, then in the code root, as
  the prototype is.
- A relative `prototype.root` is looked for beside the spec first, then in the code root
  ([#17](https://github.com/profoundry-us/walkdown/issues/17)).
- `walkdown run` passes `WALKDOWN_SPEC` and `WALKDOWN_RUNS` to the suite, and the RSpec
  formatter records there instead of walking up from the working directory
  ([#16](https://github.com/profoundry-us/walkdown/issues/16)).
- `walkdown init` folds a `projects:` row from before the registry into the registry
  row and says so ([#18](https://github.com/profoundry-us/walkdown/issues/18)).
- The status report's drift line names each design request's status rather than
  calling every one "open".
- `package-lock.json` is committed, so a development install gets exactly what it pins.

### Fixed

- A screen whose app path is a whole URL, such as a stand-in on walkdown's own server,
  is framed where it points instead of appended to the target's address
  ([#15](https://github.com/profoundry-us/walkdown/issues/15)).
- Lint reads an anchor declared without a dot as an anchor, not an unknown screen
  ([#6](https://github.com/profoundry-us/walkdown/issues/6)).
- Picking a screen that is the same page at another `#fragment` no longer leaves
  "Loading…" over it.
- Finishing a walkdown while a skip was still loading no longer brings the finished
  sitting back.
- A sitting dropped because the server answered for another blueprint stays dropped in
  this browser.
- The example's design pages load walkdown from whichever port serves them.

## [0.1.1] - 2026-09-23

### Changed

- The install instructions clone the tagged version and name the skills directory an
  agent must pass. Git's warning that an annotated tag "is not a commit" is noted as
  expected. No behaviour changed.

## [0.1.0] - 2026-09-23

### Added

- The first tagged version: the blueprint format (rules, stories, storyboard, threads),
  the runs ledger with its checks, agent and human tiers, and the `walkdown` CLI
  (`init`, `skills`, `where`, `pointer`, `run`, `status`, `lint`, `hash`, `judge`,
  `sweep`, `threads`, `thread`, `serve`).
- The review panel, served by `walkdown serve` and framed by the browser extension, with
  the design-and-app fade, pins, threads and signed walkdowns.
- Agent skills for setting walkdown up, formulating rules, judging them alone or in a
  full sitting, incorporating answers and working the backlog, and reporters for
  `node:test`, Playwright and RSpec.

[Unreleased]: https://github.com/profoundry-us/walkdown/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/profoundry-us/walkdown/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/profoundry-us/walkdown/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/profoundry-us/walkdown/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/profoundry-us/walkdown/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/profoundry-us/walkdown/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/profoundry-us/walkdown/releases/tag/v0.1.0
