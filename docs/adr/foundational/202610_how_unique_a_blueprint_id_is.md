# ADR 0014 — How unique a blueprint id is

- **Status:** proposed 2026-10-05, with its rules below
- **Date:** 2026-10-05
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0003 (the registry is the only door), ADR 0011 (a project holds
    several blueprints), ADR 0012 (`blueprints` is a noun).
- **Supersedes:** ADR 0003's "a registry id is unique on the machine", and ADR 0011's
    "an `--id` already registered for a different project is refused".

## Context

A blueprint has two names. Its **home** is a numbered folder, `NNNN-<id>`. The number is
its identity, so two homes never collide. Name-keyed homes collided; that is why
`~/.walkdown/projects/{id}/` gave way to numbered homes on 2026-08-31 (n-0124). Its **id**
is the word a person types: `--blueprint search`, `walkdown blueprints rename search
find`, and the line the pointer writes into CLAUDE.md.

Today the id must be unique on the whole machine, and the doors enforce that in three
different ways:

- `blueprints new search`, in a project that has no `search`, is refused when some other
  project on the machine has one: "`search` is already registered for ~/shop — choose
  another id".
- `blueprints import` does not refuse. It quietly registers the second one as
  `<project>-search` (ADR 0003, step 3).
- `blueprints rename` refuses any id used anywhere on the machine. It also finds the row
  to rename by id across the machine, which is only right while ids are unique.

The readers already think per project. `registryPick` resolves `--blueprint search` to
the `search` whose project contains where you stand, and refuses when it cannot tell. The
server's `?bp=` takes the blueprint's key, its spec path, when two rows share an id
(n-0173). So the rule is enforced at the doors and not needed anywhere behind them.

Uniqueness across the machine costs most where it matters most. A committed blueprint's
id is the team's: it is in the repository's `.walkdown/config.yml`, in its CLAUDE.md
pointer, and in every AGENTS.md instruction that says `--blueprint search`. Topher keeps
several projects, and two of them can each have a `search`. Today the second one is
`shop-search` on his machine and `search` on everyone else's. Instructions committed to
the repository are then wrong on exactly one machine, and nothing says so.

## Decision

### 1. An id is unique within its project, not on the machine

Two projects may each have a blueprint called `search`. Within one project, ids stay
unique, as ADR 0011 has it. Homes stay numbered (§4), so nothing on disk changes.

### 2. A command finds an id from where it is run

`--blueprint <id>`, and every verb that takes an id (`rename`, `forget`, `commit`),
resolves the id among the blueprints of the project that contains the working directory.
This is what `registryPick` already does for reads; the doors that write now do the same.

Run outside every project, an id only one project uses still resolves to it, as today.
An id two projects use is refused. The refusal names each project's directory and asks
you to run the command from inside the one you mean. walkdown never guesses between them.

### 3. The doors stop enforcing uniqueness on the machine

- **`blueprints new <id>`** refuses only an id its own project already uses for another
  blueprint. Another project's `search` is no reason to refuse.
- **`blueprints import`** registers each blueprint under the id its project declares. It
  no longer prefixes the project's name, because the declared id is what the team types.
  The same home imported twice is still "already listed".
- **`blueprints rename`** finds the row in the project where it is run, and refuses a new
  id only when that project already uses it.
- **`blueprints forget <id>`** takes one row out: the one the id resolves to by §2. Today
  `forgetFromRegistry` drops every row with that id, which would take another project's
  blueprint with it.

### 4. Homes stay numbered; no `projects/` folder

The numbered home answers the collision n-0124 found, and going back to a folder keyed
by name would bring that collision back. A project's blueprints are grouped by the
registry's `project:` field, not by a folder. `walkdown blueprints` shows each row's
project beside its id, so two `search` rows in the list can be told apart.

### 5. Where no project is in play, the key names a blueprint

The panel's chooser and `?bp=` already name a blueprint by its key, its spec path, when
ids repeat, and they keep doing so. The chooser shows the project beside an id that
repeats. Nothing new is invented for addresses.

## The rules

Topher approves each wording before anything is built.

**New: `locations.several.ids-per-project`** (cli blueprint, `locations.several`)

> statement: "A blueprint's id names one blueprint within its project, so two projects
> may each have a blueprint with the same id, and a command finds that project's
> blueprint from the project where it is run."
>
> because: "A committed blueprint's id is the team's, written into the repository's
> config and its agent instructions, so it has to name the same blueprint on every
> machine."
>
> history: "Until ADR 0014 an id was unique on the machine. A second project's `search`
> was refused by `blueprints new`, and registered as `<project>-search` by `blueprints
> import`, so the repository's instructions named a blueprint that machine called
> something else."
>
> given: "Projects `shop` and `cafe`, each with a blueprint `search`, both registered on
> one machine"
>
> when: "`walkdown status --blueprint search` is run in each project, then outside both;
> `cafe` is imported on a machine that already has `shop`'s `search`; `walkdown
> blueprints` is run"
>
> then:
> - "In `shop` it reports `shop`'s `search`, and in `cafe` it reports `cafe`'s"
> - "Outside both it refuses, naming both project directories and saying to run it from
>   the one you mean"
> - "The import registers `cafe`'s blueprint as `search`, the id its project declares"
> - "`walkdown blueprints` shows each `search` beside its project"
> - "Neither home's folder is renamed or renumbered"

**Reworded: `locations.several.init-makes-another`**, one `then` step:

> was: "An id already registered for a different project is refused, not given a suffix"
>
> now: "An id another project uses is accepted for this project; an id this project
> already uses for another blueprint is refused outright, never renamed with a suffix"

**Reworded: `commands.blueprints.rename`**, the `given` and one `then` step added:

> given was: "A project with blueprints `a` and `b`, b committed in the repository"
>
> given now: "A project with blueprints `a` and `b`, b committed in the repository, and
> another project on the machine with a blueprint `search`"
>
> then, added: "The other project's `search` is not touched, and does not stop `b` being
> renamed `search`"

The existing step "Renaming a to an id the project already has, or to something that is
not an id, is refused and changes nothing" already says "the project", and stays as it
is.

**Reworded: `commands.blueprints.import-and-forget-moved`**, one `then` step added:

> "With another project's blueprint of the same id registered on the machine, `blueprints
> import` keeps the id the repository declares, and `blueprints forget` removes only this
> project's entry from the registry"

## Consequences

- **The doors change:** the duplicate-id checks in `bin/commands/blueprints-new.js` and
  `blueprints-rename.js` are scoped to the project. `import` stops prefixing the project's
  name. `forgetFromRegistry` takes one row, chosen as §2 chooses.
- **Rows are matched by project:** every lookup of a registry row by id alone is
  replaced by `registryPick`, which already scopes by project.
- **Nothing to migrate:** rows imported as `<project>-<id>` keep that id. `walkdown
  blueprints rename shop-search search`, run inside the project, puts one back.
- **Messages and docs follow:** docs/08's "the registry's is the handle" paragraph and
  ADR 0003's step 3 note are updated, and the `blueprints` listing gains a project
  column.
- **The release is unchanged:** this ships with ADR 0012 in 0.4.0, and UPGRADING gains a
  line for anyone with a prefixed id.

## Alternatives considered

- **Keep ids unique on the machine (today).** This was rejected. It makes a team's
  committed id wrong on any machine that met another project's blueprint of that name
  first.
- **Go back to `~/.walkdown/projects/<project>/blueprints/<id>`.** This was rejected. It
  keys folders by name again, and two checkouts of one project, or two directories both
  called `app`, would share a folder. The numbered home exists to stop exactly that, and
  the problem was never the folder.
- **Qualified ids (`shop/search`) everywhere.** This was rejected for now. A project has
  no name of its own, only a directory, and directory names repeat (`app`, `web`).
  Inventing a project id is a bigger decision than this one needs. Standing in the
  project already says which one you mean, and the key covers addresses.
- **Suffix or prefix on collision, as `import` does today.** This was rejected because an
  id a machine quietly changed is one no instruction in the repository can name.
