# ADR 0010 — Claude Code skill packaging

- **Status:** accepted 2026-10-01 by Topher. Not yet built; the rules it changes are
    drafted for Topher's approval first.
- **Date:** 2026-10-01
- **Deciders:** Topher (product, eng)
- **Builds on:** "the clone is the install" (`delivery.install.clone-is-the-install`,
    [docs/09](../../09-delivery.md)), skills are yours by default (n-0239,
    `locations.default.skills-are-yours-by-default`), and n-0197, where an installer
    wrote through a link into walkdown's own source.
- **Supersedes:** how skills reach Claude Code. Copies into other agents' directories,
    and into a repository on request, are unchanged.

## Context

walkdown ships five skills: setup, formulate, judge, incorporate and backlog. Today
`walkdown init` and `walkdown skills` copy each one into `~/.claude/skills/walkdown-<name>/`.
That has three costs.

1. **The copies go stale.** A copy is a snapshot of the clone on the day it was made.
   Upgrading the clone changes nothing until someone runs `walkdown init --force`, and
   nothing says that is due. The 0.1.x to 0.2.0 upgrade guide needed a step for it.
2. **Refreshing them destroys edits.** `--force` overwrites a copy whether or not its
   person changed it. On 2026-10-01, rehearsing the 0.2.0 upgrade overwrote four of
   Topher's own copies.
3. **They are not namespaced.** They appear as `/walkdown-judge`, five loose names among
   everything else in the folder, rather than as one tool's skills.

Topher's other skill sets do not work this way. `topher-skills` is a Claude Code
plugin: a `.claude-plugin/plugin.json`, skills under `skills/<name>/SKILL.md`, and one
symlink from `~/.claude/skills/topher` to the repository. Its skills appear as
`/topher:status`, and editing the repository changes them at once.

### What was tested (2026-10-01, Claude Code 2.1.220)

A local clone of walkdown was given that shape: a `plugin.json` named `walkdown`, the
five skills at `skills/<name>/SKILL.md` without their prefix, and a `commands/lint.md`.

- Linked into a skills folder, it loaded as `walkdown@skills-dir`, with the version from
  `plugin.json`. `claude plugin validate` passed.
- Loaded into a session, its skills were `walkdown:judge`, `walkdown:setup` and
  `walkdown:lint`. The existing `topher@skills-dir`, also a link, showed as
  `topher:status`, so a linked repository is namespaced exactly as an installed plugin is.
- It took the five skills and the one command and nothing else. The repository's own
  `.claude/` folder (the Highball hooks, the `rule-wording-judge` agent, and the copies
  including `walkdown-sitting`) did not leak in.
- With the old loose copies still present, the session listed both `walkdown-judge` and
  `walkdown:judge`.
- Its standing cost is about 460 tokens a session; each skill costs about 1,000 to 2,000
  when it runs.
- The validator warns that the repository's `CLAUDE.md` is not loaded as plugin context.
  That is correct: it is this repository's own development guide.

## Decision

**The clone is a Claude Code plugin named `walkdown`, and Claude Code gets walkdown's
skills through one link to the clone, never through copies.**

### 1. The repository root is the plugin

`.claude-plugin/plugin.json` names it `walkdown` and carries the version, which moves
with every release beside `package.json`. `.claude-plugin/marketplace.json` lists the
root as its one plugin, so the repository is also its own marketplace.

### 2. The skills move and lose their prefix

The five skills move from `lib/skills/walkdown-<name>.md` to `skills/<name>/SKILL.md`,
and each `name:` drops `walkdown-`. They are invoked as `/walkdown:setup`,
`/walkdown:formulate`, `/walkdown:judge`, `/walkdown:incorporate` and
`/walkdown:backlog`. Everything that reads the skills reads them there.

`walkdown-sitting` stays in this repository's `.claude/skills/`. It drives a harness
only this repository has, and the test showed that folder does not reach the plugin.

### 3. Two commands, as thin wrappers

`commands/lint.md` and `commands/status.md` give `/walkdown:lint` and `/walkdown:status`.
Each runs the CLI and reports what it said. The CLI stays the one implementation. More
wrappers are added only when someone reaches for one.

### 4. Installing for Claude Code is one link

```
ln -s ~/.walkdown/walkdown ~/.claude/skills/walkdown
```

`walkdown init` and `walkdown skills` make this link instead of copying, and say so.
Upgrading the clone upgrades the skills. There is no refresh step and nothing to
overwrite. An edit made through the link is an edit to the clone, and `git status` in
the clone shows it.

The installer never writes through a link. It recognises its own link as up to date,
and it reports any other link as someone else's and leaves it alone. That is the fix
n-0197 needed, made general.

The old copies have to go, or Claude Code lists every skill twice. The installer names
any `walkdown-<name>` copies it finds in Claude Code's folder. It removes them only with
`--force`, and only when they match a version it shipped; it reports an edited copy and
keeps it.

### 5. Copies remain where a link cannot work

- **Other agents.** `walkdown skills --into <dir>` for an agent other than Claude Code
  still writes copies, named `walkdown-<name>` because nothing namespaces them there.
- **A repository, on request.** `walkdown skills --project` still commits copies. A link
  to one person's `~/.walkdown` means nothing in a teammate's clone.

### 6. This repository follows its own install

Its five project copies in `.claude/skills/` are removed. Working on walkdown, the
plugin comes from the link like anywhere else. `.claude/skills/` keeps
`walkdown-sitting` alone, and the `skills-copied` Highball check shrinks to that one
copy or retires.

## Consequences

- Rules to reword, each for Topher's approval before it is built:
  - `locations.default.skills-are-yours-by-default`: "install into your own skills
    directory" becomes a link for Claude Code and a copy for anything else; "a copy the
    person has edited is kept" still holds for copies.
  - New rules for the plugin's shape (its name, its skills, its two commands) and for
    the installer never writing through a link.
- `delivery.install.clone-is-the-install` is unchanged. A link adds no registry, build
  step or network.
- Docs that change: README, `site/setup.md` (and its copy in walkdown-site, deployed),
  the setup skill, [docs/09](../../09-delivery.md), and the release steps, which gain
  `plugin.json`'s version.
- It ships as 0.3.0. [UPGRADING.md](../../../UPGRADING.md) gains a section: check out the
  tag, then run `walkdown skills --force`, which removes the five old copies and makes
  the link.
- `claude plugin validate` keeps one warning about `CLAUDE.md`, accepted.

## What this does not decide

- **Plugins for other agents.** Codex, Cursor and others have their own formats or none.
  They keep copies until one of them is worth a decision of its own.
- **A public marketplace listing.** The repository is its own marketplace, which is
  enough for `claude plugin marketplace add profoundry-us/walkdown`. Listing it anywhere
  else waits.
- **More command wrappers.** Two to start.

## Alternatives considered

- **Install from the marketplace by default.** Rejected as the default, kept as a
  supported route. A marketplace install is a cached copy that needs `claude plugin
  update`, which brings back the staleness this ADR removes. The clone has to be on the
  machine anyway for the CLI and the browser extension, so a link to it costs nothing.
- **One link per skill.** Rejected. It fixes staleness but not naming, and it means five
  links to make and five to remove.
- **Keep copying.** Rejected. It is the staleness and the overwritten edits above.
- **A plugin in a subfolder, such as `plugin/`.** Rejected. It avoids the `CLAUDE.md`
  warning, but splits walkdown's skills from the clone they describe, and the link would
  point somewhere other than the install.
