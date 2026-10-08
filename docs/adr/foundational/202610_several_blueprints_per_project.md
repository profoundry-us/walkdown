# ADR 0011 — Several blueprints per project

- **Status:** accepted 2026-10-02 (Topher), with its three rules in
    `locations.several`.
- **Date:** 2026-10-02
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0001 (one page may be claimed by several blueprints, and the
    person chooses), ADR 0003 (the registry is the only door), n-0145 (running `init`
    twice never makes a second home).
- **Threads:** [issue #20](https://github.com/profoundry-us/walkdown/issues/20).
- **Amended by:** ADR 0012, where `init` makes no blueprint: `walkdown blueprints new
    <name>` replaces `init --id` (§1), and `walkdown blueprints commit <standard>
    --blueprint <id>` replaces `init --commit`. ADR 0013 §2, where `walkdown run` runs
    every blueprint's runner instead of refusing. ADR 0014, where homes are kept under
    `~/.walkdown/projects/<project>/blueprints/` and every write names its blueprint,
    even in a project with one. The decisions below stand; the commands they name are
    the old ones.

## Context

A project's blueprint lives in a numbered home in `~/.walkdown/blueprints/` unless it is
committed. The registry and its readers already allow several rows for one project:
`registryPick` expects them, `--blueprint <id>` chooses between them, and the panel and
`walkdown claims` already handle a page claimed by more than one.

Nothing can create the second row. On 2026-10-02, a project on Topher's work machine
(`acme_main`) had a blueprint for one feature set, and an unrelated feature wanted
its own, kept out of the repository like the first. Every route was closed:

- `walkdown init --dir <root>` finds the row rooted there and reuses its home. That is
  n-0145's guarantee: running `init` twice never makes a second home.
- `walkdown import` takes a bare home only from inside a repository, or as `--ephemeral`
  with no project at all.
- A hand-written registry row has no `registered:` and is ignored.

Only `--commit spec` was left, which puts the blueprint in the repository.

And once a second row exists, every bare command in the project fails. It says "No
blueprint here. Nothing registered … contains this directory", which is false: two
are registered. Only `walkdown where` names the choice. The first blueprint's bare
`walkdown status` stops working the moment a second one exists, and so does every skill
that calls it.

## Decision

**A project may hold several blueprints, each in its own home, made with
`walkdown init --id <name>`. A command that only reads covers all of them; a command
that writes, or acts on one, is told which.**

### 1. `init --id` makes another blueprint

`init` is idempotent on the project **and** the id, not the project alone.

- `walkdown init --dir <root> --id <name>`, where no row rooted at `<root>` has that id,
  claims the next numbered home (`NNNN-<name>`) and registers it, with the same claim,
  lock and scaffold as a first blueprint. It says this is another blueprint for the
  project, and lists the ones already there by id, so a mistyped id is noticed at once.
- The same command again finds that row and reports everything up to date. n-0145's
  guarantee holds: the same command twice never makes a second home.
- An `--id` already registered for a different project is refused, never suffixed.
  Naming an id is asking for that id.
- **With no `--id`, init means the id it would give the project anyway**: the project
  directory's name, as today. One blueprint, and that is the one it reuses, as now.
  With several, it reuses the one with that id. If none has it, it refuses and names
  them, because choosing one would be a guess.
- `init --commit <standard>` moves one home. With several in the project it needs
  `--id` to say which, and refuses with the choices otherwise.

### 2. Reads cover every blueprint; writes name one

With no `--blueprint`, standing in a project with several:

- **`status`, `lint`, `threads` and `where` report on every blueprint registered for the
  project**, one section each, headed by its id, in the order they were registered. With
  `--json` the answer is `{ "blueprints": [ … ] }`, each entry the single-blueprint
  answer plus its `id`.
- **Everything that writes or acts on one blueprint refuses** and names the choices:
  `run`, `hash --write`, `thread new`, a change to a thread, `judge`, `sweep` and `move`.
  Nothing is guessed. A thread id that only one of the project's blueprints holds
  resolves on its own, since there is nothing to guess.
- The refusal says what is true: several blueprints are registered here, these are their
  ids, and `--blueprint <id>` says which. "No blueprint here" is kept for when there
  really is none.

A project with one blueprint behaves, and prints, exactly as before.

### 3. Serving and claiming are unchanged

`walkdown serve` already lists every registered blueprint, and `walkdown claims --url`
already reports every blueprint that claims a page (ADR 0001). The second blueprint is
one more row to both.

## Consequences

- Three rules in `locations.several`: `init-makes-another`, `reads-cover-all` and
  `writes-name-one`.
- `skills/setup` and `skills/formulate` say how to start another blueprint in a project
  that has one, and that writes take `--blueprint` once there are several. The template
  `AGENTS.md` quick reference says the same.
- [docs/08](../../08-locations.md) gains the second-blueprint path.
- It ships as 0.4.0: new functionality, and a changed `--json` shape for projects with
  several blueprints, which could not exist before. Single-blueprint output is
  unchanged.

## Alternatives considered

- **A new verb, `walkdown blueprint new <id>`.** It leaves `init`'s meaning alone, but
  duplicates most of `init` and brings back a `blueprint <verb>` family ADR 0003 cut to
  `forget`.
- **`walkdown import <home> --project <dir>`.** The smallest change, but the person lays
  out and numbers the home by hand, bringing back the collisions numbered homes exist to
  prevent, and it weakens ADR 0003 §3: where a home stands says what it is.
- **A default or primary blueprint per project.** The least friction, but it is the kind
  of guess walkdown refuses everywhere else, and a forgotten default files threads under
  the wrong blueprint.
- **Bare `init` with several homes reuses the oldest.** Rejected for the same reason: it
  is a guess. The default id is not, because it is the id `init` would have chosen.
