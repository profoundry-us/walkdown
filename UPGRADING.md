# Upgrading walkdown

Each section takes an install from one version to the next. What changed is in
[CHANGELOG.md](CHANGELOG.md); this file is only what you have to do about it.

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
