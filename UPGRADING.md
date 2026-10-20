# Upgrading walkdown

Each section takes an install from one version to the next. What changed is in
[CHANGELOG.md](CHANGELOG.md); this file is only what you have to do about it.

## From 0.4.1 to 0.5.0

Designs move into a folder per screen
([ADR 0015](docs/adr/foundational/202610_design_versions_and_states.md)), and
lint refuses a few things it used to let pass.

### 1. Update the clone

```
git -C ~/.walkdown/walkdown fetch --tags
git -C ~/.walkdown/walkdown checkout v0.5.0
```

### 2. Move the designs

See what would move, then move it:

```
walkdown upgrade --dry-run
walkdown upgrade
```

For every blueprint at once, it:

- moves each accepted design, `<root>/screens/<screen>.html`, to
  `<root>/<screen>/YYYYMMDD.html`, dated by the file's first commit under its
  own name. A root named `prototype*` is renamed `designs*` on the way
  (`prototype/` becomes `designs/`, `prototype-cli/` becomes `designs-cli/`);
  any other root, such as `claude-design/`, stays where it is;
- moves each draft or proposal that an open design request names, in its words
  or by its `proposes:`, to the same folder as that request's proposed version
  (and points `proposes:` at it), and removes one no request names (git still
  has it);
- leaves a file git does not hold, and no screen names, where it is, and says
  so: commit it or delete it yourself;
- renames the storyboard's `prototype:` keys to `design:`, drops `proposal:`,
  and renames `spec.yml`'s `prototype.root` to `design.root`;
- turns each note in `as-built/redlines.json` into a closed redline thread on
  the screen its key names (a `cli/<screen>` key included), and removes the
  file. A note whose key matches no screen stays in it, so the file stays too;
- fills in `steps.excused` on any rule whose old hash excused a tier, so it does
  not read as stale.

Run again, it finds nothing to do. Old keys still load meanwhile, so nothing
breaks before you run it, and `walkdown lint` warns once on each blueprint still
on the old layout until you do. `walkdown upgrade --layout-only` does only the
ADR 0014 layout: it leaves the designs where they are, the redlines in
`as-built/redlines.json`, and `steps.excused` unwritten, if you need to put
that part off.

### 3. Run lint, and fix what it now refuses

```
walkdown lint
```

These are new errors, each with the fix in its message:

| Lint says | What to do |
|---|---|
| no rule names this screen | write the rules it must show, with `screens: [<id>]`, or retire the screen |
| a live rule names a retired screen | point the rule at the screen that replaced it, or retire the rule too |
| a rule names no screen and excuses no tier | name its screen with `screens: [<id>]`, or excuse the agent tier under `unverifiable:` and say why there is nothing to look at |
| a question is open on a rule while another rule was written from its answer | `walkdown threads set <q> --written-as <rule> --blueprint <bp>` |
| a design request proposes a version that is not there | put the version back where it names, or `walkdown threads set <id> --proposes <path> --blueprint <bp>` |

### 4. Refresh `AGENTS.md`

A blueprint made before 0.5.0 keeps its `AGENTS.md`. Copy
`lib/templates/AGENTS.md` from the clone over it, so agents learn that the
walkdown is the design review and that a screen's rules come with its design.

## From 0.4.0 to 0.4.1

No data moves and no command changes.

```
git -C ~/.walkdown/walkdown fetch --tags
git -C ~/.walkdown/walkdown checkout v0.4.1
```

A blueprint made before 0.4.1 keeps its `AGENTS.md`. To give it the new
"Design comes first" convention, copy `lib/templates/AGENTS.md` from the clone
over it.

## From 0.3.0 to 0.4.0

The command line became nouns and verbs
([ADR 0012](docs/adr/foundational/202610_cli_command_structure.md)), every write names
its blueprint, and walkdown's files moved
([ADR 0014](docs/adr/foundational/202610_file_layout_and_locations.md)). What you,
your scripts and your agents type changes, and `walkdown upgrade` moves the files once.

### 1. Update the clone

```
git -C ~/.walkdown/walkdown fetch --tags
git -C ~/.walkdown/walkdown checkout v0.4.0
```

The skills are a link to the clone, so they speak the new commands as soon as it
updates.

### 2. Change what you type

| Was | Now |
|---|---|
| `walkdown init` (in a project) | `walkdown blueprints new [<id>]` |
| `walkdown init --dir <root>` | `walkdown blueprints new --dir <root>` |
| `walkdown init --id <name>` | `walkdown blueprints new <name>` |
| `walkdown init --commit <none\|spec\|all> [--id <x>]` | `walkdown blueprints commit <none\|spec\|all> [--blueprint <x>]` |
| `walkdown import <path> …` | `walkdown blueprints import <path> …` |
| `walkdown blueprint forget <id>` | `walkdown blueprints forget <id>` |
| `walkdown move <kind> --to <path>` | `walkdown records move <kind> --to <path>` |
| `walkdown thread new …` | `walkdown threads new …` |
| `walkdown thread <id>` | `walkdown threads show <id>` |
| `walkdown thread <id> --reply <text>` | `walkdown threads reply <id> <text>` |
| `walkdown thread <id> --as-agent --said <t> --added <t>` | `walkdown threads reply <id> --as-agent --said <t> --added <t>` |
| `walkdown thread <id> --status <s> [--reply <text>]` | `walkdown threads set <id> --status <s> [--reply <text>]` |
| `walkdown thread <id> --verify \| --reopen \| --waive \| --option …` | `walkdown threads set <id> --verify \| …` |

You do not have to learn the table: an old form exits 2, changes nothing, and prints
the new one with your arguments in it, ready to copy.

`walkdown init` now sets up the machine only. Run it once on each machine; it is safe
to run again.

**Every write names its blueprint.** `threads new`, `set`, `reply` and `relabel`,
`records move`, `rules move` and `rename`, `sweep`, `judge`, `hash --write` and
`blueprints commit` need `--blueprint <id>`, even in a project with one blueprint and
even for a thread label only one blueprint holds. Without it they exit 2, list the
project's IDs and change nothing. Inside the project the blueprint's name is enough
(`--blueprint checkout`); elsewhere, its full ID. Reads (`status`, `lint`, `threads`,
`threads show`, `where`) and `walkdown run` need none. Add the flag to any script, alias,
`CLAUDE.md` line or agent memory that writes.

### 3. Move to the new layout

Files moved too ([ADR 0014](docs/adr/foundational/202610_file_layout_and_locations.md)).
Until they have, every command that loads a blueprint exits 2 and says an upgrade is due.
See what would move, then move it:

```
walkdown upgrade --dry-run
walkdown upgrade
```

Each project gets a two- or three-letter code, which every ID carries. It is derived
from the project's label (`am` for `acme_main`). To choose it instead, pass it to
the upgrade run inside that project: `walkdown upgrade --code ac`.

Run it from inside each project whose blueprints you keep in the repository. It flattens
each home, renames `config.yml` to `profile.yml`, renumbers the registry, gives every
thread a uuid, and replaces the pointer block in `CLAUDE.md` / `AGENTS.md`. It is safe to
run again. Commit what it changed in the repository; anyone else who pulls runs it once
on their own machine for what lives there.

Then, in place of the IDs you used to type:

| Was | Now |
|---|---|
| `--blueprint <old-id>` | still works, anywhere: the upgrade keeps the old ID on the row as `formerly:` (`acme_main` reaches `0001-am-acme-main`) |
| `--blueprint <name>` | works inside the project; elsewhere, use the full ID (`walkdown blueprints` lists them) |
| `walkdown blueprints add <path>` | `walkdown blueprints import <path>` |
| `walkdown blueprints rename <id> <new-id>` | `walkdown blueprints rename <id> <new-name> [--folder <folder>]` |

### 4. Refresh each blueprint's AGENTS.md

A blueprint's `AGENTS.md` names the commands agents use. Copy the shipped one over
yours if you have not edited it:

```
cp ~/.walkdown/walkdown/lib/templates/AGENTS.md <home>/AGENTS.md
```

`walkdown where spec` prints `<home>`.

## From 0.2.0 to 0.3.0

The skills stop being copies and become one link: the clone is now a Claude Code
plugin named `walkdown` ([ADR 0010](docs/adr/foundational/202610_claude_code_skill_packaging.md)).
No data moves.

### 1. Update the clone

```
git -C ~/.walkdown/walkdown fetch --tags
git -C ~/.walkdown/walkdown checkout v0.3.0
```

### 2. Swap the copies for the plugin

```
walkdown skills --into ~/.claude/skills --force
```

This makes `~/.claude/skills/walkdown`, a link to the clone, and removes the five
`walkdown-<name>` copies an earlier walkdown left there. A copy you edited is kept and
named; move what you changed into the clone (or somewhere of your own) and delete it,
or Claude Code lists that skill twice.

If you use `CLAUDE_CONFIG_DIR`, name that directory's `skills` folder instead.

### 3. Start a new Claude Code session

The skills are now `/walkdown:setup`, `/walkdown:formulate`, `/walkdown:judge`,
`/walkdown:incorporate` and `/walkdown:backlog`, with `/walkdown:lint` and
`/walkdown:status` beside them. `claude plugin list` shows `walkdown@skills-dir`.

From now on, updating the clone (step 1) is the whole upgrade for the skills.

### For agents other than Claude Code

Copies are unchanged: `walkdown skills --into <that agent's skills directory> --force`
refreshes them, still named `walkdown-<name>`.

## From 0.1.x to 0.2.0

No data moves. Run records, threads and the registry keep their formats, and nothing in
a blueprint has to be rewritten.

### 1. Update the clone

```
git -C ~/.walkdown/walkdown fetch --tags
git -C ~/.walkdown/walkdown checkout v0.2.0
```

Use the path you cloned to if it is not `~/.walkdown/walkdown`.

### 2. Refresh what walkdown installed in each project

```
walkdown init --dir <your-project> --force
```

This rewrites each blueprint's `AGENTS.md` and the walkdown skills it installed
(`walkdown-formulate`, `walkdown-judge` and `walkdown-setup` changed). Your `walkdown.yml`, storyboard,
features, threads and runs are kept as they are. `--force` overwrites any edits you made
to `AGENTS.md` or to the installed skills, so copy those out first if you made any.

If you installed the skills somewhere else with `walkdown skills --into <dir>`, run that
again with `--force`.

### 3. Restart the server and reload the extension

Stop any running `walkdown serve` and start it again. It no longer needs to run inside a
project or be given `--blueprint`: one server serves every blueprint registered on the
machine. Then reload the walkdown extension in `chrome://extensions`.

### 4. Check what now behaves differently

- **Design requests have their own queue.** A note with reason `request` is listed under
  DESIGN QUEUE in `walkdown status`, not in the agent's queue. A request that an agent
  marked `addressed` without anything being drawn now shows up as a request for a person
  to accept. Reopen it so design sees it:

  ```
  walkdown thread <id> --reopen --reason "Nothing was drawn yet."
  ```

- **New drift warnings.** Lint now warns about a screen with no design unless it has an
  open design request. If its only note is a question or feedback, file a request:

  ```
  walkdown thread new --screen <id> --body "<what needs drawing>"
  ```

  Or, if that note was really a request, set `reason: request` in its thread file.

- **`walkdown thread new` needs an anchor.** A call with neither `--rule` nor `--screen`
  exits with status 2. Scripts that filed unanchored notes need one of the two.

- **The agent closes its own notes.** An addressed note the agent wrote, other than a
  design request, leaves your queue. After the agent's next passing judgment of the rule,
  `walkdown status` lists it for the agent to settle.

- **Optional: say who designs.** A blueprint whose design is drawn by an agent can add
  this to `walkdown.yml`, so its design queue is addressed to the design agent:

  ```yaml
  design:
    by: agent
  ```

  Leaving it out means a person designs, which is how 0.1.x behaved.

- **Config from before the registry.** If a project's config still has a `projects:`
  row, re-running `walkdown init` (step 2) folds it into the registry and says so.
