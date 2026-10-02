# Upgrading walkdown

Each section takes an install from one version to the next. What changed is in
[CHANGELOG.md](CHANGELOG.md); this file is only what you have to do about it.

## From 0.2.0 to 0.3.0

The skills stop being copies and become one link: the clone is now a Claude Code
plugin named `walkdown` ([ADR 0010](docs/adr/0010-the-clone-is-a-claude-code-plugin.md)).
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
