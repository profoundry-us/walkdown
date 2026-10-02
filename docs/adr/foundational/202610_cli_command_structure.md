# ADR 0012 — CLI command structure

- **Status:** proposed 2026-10-02. Nothing is built; the rules it rewords are drafted
    for Topher's approval first.
- **Date:** 2026-10-02
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0003 (the registry is the only door), ADR 0010 (the clone is a
    Claude Code plugin), ADR 0011 (a project holds several blueprints).
- **Supersedes:** ADR 0003's cut of the `blueprint <verb>` family to `forget`, and
    `walkdown init` as the command that makes a blueprint.

## Context

`walkdown help` lists nineteen commands, and they are shaped three ways. Some are verbs
(`init`, `import`, `move`, `run`), some are nouns that list (`blueprints`, `threads`),
and two are a noun and a verb (`blueprint forget`, `thread new`). Nothing in the list
says which commands act on what.

`init` is the worst of it. It does five jobs:

- It gets the machine ready: it links the skills and writes the person's identity.
- It makes a blueprint: it claims a numbered home, lays out the blueprint and registers it.
- It places the agent pointer in the repository.
- With `--commit`, it moves a whole home into the repository or back out.
- It folds an old `config.yml` row into the registry.

Since ADR 0011 it also takes `--id` and decides which of a project's blueprints it
means.

A rename was asked for on 2026-10-02, so that an id chosen badly by a person or an
agent can be put right. It would have been one more verb with nowhere obvious to go.

`move` relocates one kind of record, such as evidence, and leaves the blueprint where it
is. Read as `blueprints move`, a person expects the whole blueprint to move.

Two agents use walkdown today, and Topher runs both. A break documented in the
changelog costs nothing to switch; carrying old names would cost something every time
the help is read.

## Decision

**A command is a noun and then a verb, and the noun alone lists. `init` gets walkdown
ready on this machine, and nothing else. The old forms are removed, not aliased.**

### 1. `init` gets walkdown ready

`walkdown init` takes no project and makes no blueprint. It is safe to run at any time
and as often as you like:

- It creates `~/.walkdown/` and the registry if they are not there.
- It writes the person's identity to `~/.walkdown/config.yml` if none is there.
- It installs the skills for Claude Code by calling what `walkdown skills` does. It
  never installs them its own way, so there is one installer and one set of messages.
- It checks what walkdown needs: Node 20 or later, and git. It also says whether Claude
  Code's skills folder exists. It names what is missing and how to get it, exits 1 if
  anything is, and installs nothing itself.

### 2. `blueprints` acts on a blueprint

```
walkdown blueprints [list] [--stale]
walkdown blueprints new [<id>] [--dir <root>] [--commit none|spec|all]
walkdown blueprints import <path> [--all|--only <ids>] [--id <name>] [--ephemeral] [--why <reason>]
walkdown blueprints rename <id> <new-id>
walkdown blueprints commit <none|spec|all> [--blueprint <id>]
walkdown blueprints forget <id>
```

- **`new`** is today's `init` for one blueprint, including ADR 0011's rules. The id
  defaults to the project directory's name, and `--dir` defaults to where you stand.
  Run again with the same id, it changes nothing.
- **`commit`** is today's `init --commit`. It moves the whole home into the repository,
  or back out. A project with several blueprints needs `--blueprint`.
- **`rename`** changes a blueprint's id in three places: the registry, the name of its
  numbered folder (which keeps its number) and its `walkdown.yml`. A committed blueprint's
  entry in the repository's `.walkdown/config.yml` is renamed too. Its rules, threads
  and runs are left as they were. A new id that is taken, or is not an id, is refused.
- **`import`** and **`forget`** are today's commands, moved under the noun.

### 3. `records` relocates one kind of record

```
walkdown records move <kind> --to <path> [--blueprint <id>]
```

This is today's `move`. Runs, threads, evidence and drafts are the record kinds, and
docs/08 already calls them that. Putting them under their own noun leaves `blueprints`
for whole blueprints. It also leaves room for a later `records list`, which today is
part of `where`.

### 4. `threads` acts on a thread

```
walkdown threads [list] [--rule <id>] [--all]
walkdown threads new --rule <id> | --screen <id> --body <text> [--kind note|question] ...
walkdown threads show <id>
walkdown threads reply <id> <text> [--as-agent [--said <text>] [--added <text>]]
walkdown threads set <id> --status <s> | --verify | --reopen | --waive [--reason <text>] [--option ...]
```

Today's `thread <id> --reply <text> --status <s>` is one ask. It becomes `reply` and
`set`, one verb per kind of change.

The rule that a refused status change must refuse the whole ask still holds where it
lives now, in `mutateThread`. `set` takes `--reply` for the case where a reply and a
transition must land together or not at all, as when an agent marks a note addressed
and says what it did.

### 5. The rest stay top-level

The daily commands keep their names: `status`, `lint`, `hash`, `run`, `judge`,
`sweep`, `where`, `claims`, `serve`, `pointer` and `skills`. Each acts on the
blueprint(s) standing here, as ADR 0011 says. `skills` remains the way to install
copies for another agent, or into a repository with `--project`.

### 6. The help reads as the list of nouns

`walkdown help` groups the commands under what they act on: getting ready, blueprints,
records, threads, rules and verdicts, and the panel. `walkdown <noun> help` lists that
noun's verbs.

### Old form to new form

| Before                              | After                                    |
|-------------------------------------|------------------------------------------|
| `walkdown init` (in a project)      | `walkdown init`, then `walkdown blueprints new` |
| `walkdown init --id b`              | `walkdown blueprints new b`              |
| `walkdown init --commit spec`       | `walkdown blueprints commit spec`        |
| `walkdown import <path>`            | `walkdown blueprints import <path>`      |
| `walkdown blueprint forget <id>`    | `walkdown blueprints forget <id>`        |
| `walkdown blueprints`               | unchanged (`blueprints list`)            |
| `walkdown move <kind> --to <path>`  | `walkdown records move <kind> --to <path>` |
| `walkdown threads`                  | unchanged (`threads list`)               |
| `walkdown thread new …`             | `walkdown threads new …`                 |
| `walkdown thread <id>`              | `walkdown threads show <id>`             |
| `walkdown thread <id> --reply <t>`  | `walkdown threads reply <id> <t>`        |
| `walkdown thread <id> --status <s>` | `walkdown threads set <id> --status <s>` |

An old form is not kept. Run, it exits 2 and prints the new form, so a stale skill fails
loudly rather than quietly doing something else.

## Consequences

- It ships as 0.4.0 with ADR 0011. The changelog says what breaks, and UPGRADING gives
  the table above.
- The skills, the `AGENTS.md` template, the setup guide (README, `site/setup.md`, docs/09),
  docs/08 and the panel's own hints are rewritten to the new forms.
- Rules whose steps quote a command are reworded in one batch for Topher's approval,
  stamped with `hash --reword`, since the behaviour does not change. The rules for
  `init`, `rename`, `records move` and `threads reply`/`set` change more than their
  words and are drafted on their own.
- The release checklist's install steps become `walkdown init` and then `walkdown
  blueprints new`.

## Alternatives considered

- **Keep the old forms as aliases for one version.** This was rejected: only two agents
  use walkdown, both Topher's, and an alias is a second answer the help must explain.
- **Singular nouns (`blueprint new`).** This was rejected because the bare noun lists,
  and `walkdown blueprints` already lists.
- **`blueprints move <kind>` for records.** This was rejected because it reads as moving
  the blueprint.
- **`blueprints move <id> --to repo|personal` instead of `commit`.** This was rejected
  because the standard has three values, and `spec` and `all` differ only in what git is
  told, not in where the home stands.
- **`rules status`, `rules lint`, `rules hash`.** This was rejected because these are the
  commands typed most, and the noun buys nothing when there is only one thing they can be
  about.
