# Set up walkdown

*This page is written to be read by an AI coding agent. If you are a person:
hand your agent the sentence "visit https://walkdown.dev/setup and set walkdown
up for this project", and it will do what follows. Nothing here is magic — you
can also just run the four commands yourself.*

---

**Agent: you are being asked to install a tool this machine may not have, in a
repository that belongs to somebody else.** Read all of it before running
anything, and ask before writing anything into the repository.

walkdown is not on a package registry yet, and does not need to be. It runs
from a clone.

**Already installed?** If `walkdown where` answers, or a clone already exists,
do not clone again. See which version it is on with
`git -C <clone> describe --tags`. If that is older than `v0.4.0`, open the
clone's `UPGRADING.md` and follow each section from its version up to 0.4.0,
in order: it lists the exact commands and what each one changes. Most of them
start with:

```
git -C <clone> fetch --tags
git -C <clone> checkout v0.4.0
```

Then go to step 4. A clone already on `v0.4.0` needs nothing; go to step 4.

## 1. Clone it

Ask where it should go. `~/.walkdown/walkdown` is a good default — one
directory to delete, beside the records walkdown keeps — but a person with a
`~/src` will usually want it there.

```
git clone --branch v0.4.0 https://github.com/profoundry-us/walkdown.git ~/.walkdown/walkdown
```

That is the latest tagged version, the one to use unless the person asks for
something else. Tags are the stable copies; `main` moves daily. To follow `main`
instead, leave `--branch v0.4.0` off. `git -C ~/.walkdown/walkdown tag` lists
the versions a clone knows about.
Git may warn that `refs/tags/v0.4.0` "is not a commit". That is how it
announces an annotated tag; the clone is fine.

## 2. There is no step 2

**Do not run `npm install`.** walkdown has no runtime dependencies: the panel
bundle, the stylesheet and its one library (`vendor/yaml.js`) are all
committed. The clone is the install, which is deliberate — an organisation that
restricts which packages may be installed has nothing to approve here.

Check it runs, and offer to put it on their PATH:

```
node ~/.walkdown/walkdown/bin/walkdown.js --help
ln -s ~/.walkdown/walkdown/bin/walkdown.js ~/.local/bin/walkdown   # if that is on PATH
```

## 3. Install the procedures

The clone is also a Claude Code plugin named `walkdown`. Install it as one link:

```
walkdown skills --into ~/.claude/skills
```

Name the directory: with no terminal to ask, a bare `walkdown skills` writes
nothing. Into `~/.claude/skills` this makes one link, `~/.claude/skills/walkdown`,
pointing at the clone, so Claude Code lists walkdown's skills as
`/walkdown:setup`, `/walkdown:judge` and the rest in every project, and updating
the clone updates them. Nothing is added to any repository.

For an agent other than Claude Code, name its skills directory instead and you
get copies, named `walkdown-setup` and so on. (`--project` commits copies to
`./.claude/skills`, for a team that wants them from a clone.)

## 4. Now run the wizard you just installed

Invoke **`/walkdown:setup`**. Claude Code may not list a plugin linked during a
session until the next one; if it is not listed yet, read
`~/.walkdown/walkdown/skills/setup/SKILL.md` and follow it. It initialises this
project — the spec, the ledger and the pointer — starts the panel, and gives
the person the browser-extension steps. It knows steps 1 to 3 are already done.

Everything after that is `/walkdown:formulate`: turning what this project
already means to build into rules somebody can sign.

---

## What you just installed, in one paragraph

walkdown holds a project's **blueprint** — features, stories, and *rules*: one
plain-language acceptance criterion each. Rules are verified by tiers (a check
suite, an agent walkdown, a person's own judgment), and every verdict is an
append-only **run record**, so a rule's status is always derived from history
rather than a field somebody forgot to update. By default none of it is written
into the repository: the spec and its records live in `~/.walkdown`, and the
only file added to the tree is a pointer telling the next agent where to look.
A project that wants the spec committed says so once.

The design is in `docs/` in the clone — start with `docs/00-vision.md`, and
`docs/08-locations.md` for where everything lives and why.
