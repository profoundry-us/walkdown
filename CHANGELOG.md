# Changelog

All notable changes to walkdown are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
walkdown is pre-1.0, so a minor version may still change the ledger, thread or
registry formats; [UPGRADING.md](UPGRADING.md) says what to do when one does.

## [Unreleased]

### Added

- A project can hold several blueprints
  ([ADR 0011](docs/adr/foundational/202610_several_blueprints_per_project.md),
  [#20](https://github.com/profoundry-us/walkdown/issues/20)).
  `walkdown init --id <name>` gives a project that has a blueprint another one, in its
  own numbered home, and says which blueprints the project already holds.
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

### Changed

- A new blueprint's `walkdown.yml` names no `runner.list`. Lint reads coverage from the
  rule tags in the files under `authoring.location`, which works for any framework and
  costs nothing. It used to run `npx playwright test --list`, over a second on every lint
  in a project without Playwright. A `list:` you named is still used.
- In a project with several blueprints, `status`, `lint`, `threads` and `where` with no
  `--blueprint` report on every one, a section each, and `--json` answers
  `{ "blueprints": [ … ] }`. A project with one blueprint prints what it did before.
- In a project with several blueprints, `hash`, `thread new`, `judge`, `sweep` and
  `move` refuse until `--blueprint` names one, and list the ids. A thread id only one of
  them holds needs no `--blueprint`. `walkdown run` with no `--blueprint` runs the
  project's suite once and files by rule; with one, it records only that blueprint's
  results.
- Lint accepts what names another blueprint's rule, thread or screen in the same
  project: a check tagged with its rule, a rule whose origin is its thread, a run
  result for its rule, and a thread on its screen.
- A new thread's id is unique across every blueprint in its project.
- The pointer paragraph lists every blueprint in the project, and says that commands
  which write need `--blueprint`. A blueprint kept outside the repository is named by id,
  never by a path on one machine. Moving one of several blueprints out of the repository
  rewrites the pointer instead of removing it.
- With several blueprints in a project, bare `walkdown init` reuses the one named for the
  project directory, and refuses if there is none; `--commit` needs `--id`.

### Fixed

- Commands no longer say "No blueprint here" where several blueprints are registered;
  they say which ones are.
- `walkdown init --commit all` no longer deletes a `.walkdown/.gitignore` that other
  blueprints in the same `.walkdown/` rely on, or one somebody edited; `--force` still
  does. Giving walkdown its second blueprint deleted walkdown's own.

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

[Unreleased]: https://github.com/profoundry-us/walkdown/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/profoundry-us/walkdown/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/profoundry-us/walkdown/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/profoundry-us/walkdown/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/profoundry-us/walkdown/releases/tag/v0.1.0
