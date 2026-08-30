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

## 1. Clone it

Ask where it should go. `~/.walkdown/walkdown` is a good default — one
directory to delete, beside the records walkdown keeps — but a person with a
`~/src` will usually want it there.

```
git clone https://github.com/profoundry-us/walkdown.git ~/.walkdown/walkdown
```

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

```
walkdown skills
```

This writes walkdown's skills into `~/.claude/skills`, where they work in every
project on this machine and add nothing to any repository. (`--project` puts
them in `./.claude/skills` instead, for a team that wants them from a clone.)

## 4. Now run the wizard you just installed

Invoke the **walkdown-setup** skill. It initialises this project — the spec,
the ledger and the pointer — starts the panel, and gives the person the
browser-extension steps. It knows steps 1 to 3 are already done.

Everything after that is `walkdown-formulate`: turning what this project
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
