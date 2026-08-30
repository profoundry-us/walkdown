---
name: walkdown-setup
description: Set walkdown up for a project from nothing - clone it, install it without a package registry, put the skills where the agent will find them, initialise the project's spec outside the repository, start the panel, and hand the person the browser-extension steps. Use when asked to set up, install, or add walkdown to a project, or when walkdown.dev sends you here.
---

# Set walkdown up for this project

You are installing a tool the person does not have yet, in a repository that is
not yours. Two things follow from that, and they govern everything below:

- **Ask before writing anything into their repository.** walkdown's whole
  posture is that adopting it costs a project nothing (`docs/08-locations.md`).
  The default puts the spec, the records and the skills outside the tree; a
  person who wants it committed says so.
- **Do not guess at their setup.** Where to clone, which file their agents
  read, whether they want the spec in git - each is one short question with a
  recommended answer, and each is cheap to ask compared to being wrong.

## 0. What is already true

    node --version                 # 20 or newer
    git --version
    walkdown where 2>/dev/null     # already installed and pointed somewhere?

If `walkdown where` answers, walkdown is installed - skip to step 3 and set up
this project rather than the tool. If the project already has a blueprint,
there is nothing to set up: say so and stop.

## 1. Clone it

Ask where. Recommend `~/.walkdown/walkdown` - it is one directory to delete and
it sits beside the records walkdown keeps - but a person with a `~/src` will
usually want it there.

    git clone https://github.com/profoundry-us/walkdown.git <where>

**Do not run `npm install`.** walkdown has no runtime dependencies - the panel
bundle, the stylesheet and its one library (`vendor/yaml.js`) are committed, so
the clone is the install. If the person's organisation restricts which packages
may be installed, there is nothing here to approve, and that is worth saying
out loud because it is usually the thing they were braced for.

Then check it runs, and offer to put it on their PATH:

    node <where>/bin/walkdown.js --help
    ln -s <where>/bin/walkdown.js ~/.local/bin/walkdown    # only if that is on PATH

Everywhere below, `walkdown` means whichever of those two forms works.

## 2. Install the skills

    walkdown skills

This writes the procedures - formulate, judge, incorporate, backlog, and this
one - into the person's own `~/.claude/skills`, where they work in every
project and add nothing to any repository. `walkdown skills --project` commits
them to this repository instead, which is right for a team that wants everyone
to have them from a clone.

## 3. Set the project up

    walkdown init --dir <project-root>

By default the spec, its runs and its threads land in `~/.walkdown`, and the
repository gets exactly one file: the pointer that tells an agent a spec
exists. Ask whether they would rather commit it (`--in-repo`) - the honest
recommendation is yes for a team and no for an evaluation, and it can be
changed later with `walkdown move`.

Then place the pointer deliberately. If the project has several agent files
(`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`), init writes none
of them and says so - ask which one their agents actually read, and:

    walkdown pointer --dir <project-root> --into <that file>

Finally, tell them where everything went, in one line each: `walkdown where`.

## 4. Serve it

    walkdown serve --dir "$(walkdown where spec --dir <project-root>)"

Run it in the background and report the URL (`http://localhost:4700` unless
taken). This is the panel: the rules, the threads, and the side-by-side review.

## 5. The browser extension, which only they can install

The extension is loaded unpacked from the clone; it is not in any store yet.
You cannot do this part - `chrome://extensions` is browser chrome, not a page -
so print the steps and let them:

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. **Load unpacked**, and choose `<where>/extension`.
3. Visit the app under review and click the walkdown toolbar icon.

`<where>/extension/README.md` has the longer version, including why an
extension exists at all when there is already a script tag.

## 6. Their first feature

Setup ends with an empty blueprint, which is not yet worth anything. Say what
they have, then offer the next step honestly: **walkdown-formulate** turns a
design, a PRD or a conversation into the first screens and rules. Do not invent
their product's rules to fill the file - a blueprint full of guessed
requirements is worse than an empty one, because somebody has to read it before
they can disagree with it.

## Report

Say what was written and where, in this order: the clone, the skills, the
spec, the pointer, and the server's URL. Name anything the person still has to
do themselves - the extension, and their first feature. If a step was skipped
because something was already set up, say that too; a setup that quietly did
nothing looks identical to one that quietly did the wrong thing.
