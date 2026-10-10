---
name: setup
description: Set walkdown up for a project from nothing - clone it, install it without a package registry, put the skills where the agent will find them, initialise the project's home outside the repository unless asked otherwise, start the panel, and hand the person the browser-extension steps. Use when asked to set up, install, or add walkdown to a project, or when walkdown.dev sends you here.
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

If `walkdown where` answers, walkdown is installed. Check its version first:
`git -C <clone> describe --tags`. If it is older than the latest tag
(`git -C <clone> fetch --tags`, then `git -C <clone> tag`), follow the clone's
`UPGRADING.md` from that version up, section by section - it gives the exact
commands, including `walkdown upgrade` where the files moved - and only then
skip to step 3 and set up this project rather than the tool. If the project already has a blueprint,
there is nothing to set up: say so and stop.

## 1. Clone it

Ask where. Recommend `~/.walkdown/walkdown` - it is one directory to delete and
it sits beside the records walkdown keeps - but a person with a `~/src` will
usually want it there.

    git clone --branch v0.4.1 https://github.com/profoundry-us/walkdown.git <where>

`v0.4.1` is the latest tagged version: a tag is the stable copy, and `main`
moves daily. Use the tag unless the person asks to follow `main`, in which case
leave `--branch` off. `git -C <where> tag` lists the versions a clone knows.
Git may warn that `refs/tags/v0.4.1` "is not a commit". That is how it
announces an annotated tag; the clone is fine.

**Do not run `npm install`.** walkdown has no runtime dependencies - the panel
bundle, the stylesheet and its one library (`vendor/yaml.js`) are committed, so
the clone is the install. If the person's organisation restricts which packages
may be installed, there is nothing here to approve, and that is worth saying
out loud because it is usually the thing they were braced for.

Then check it runs, and offer to put it on their PATH:

    node <where>/bin/walkdown.js --help
    ln -s <where>/bin/walkdown.js ~/.local/bin/walkdown    # only if that is on PATH

Everywhere below, `walkdown` means whichever of those two forms works.

## 2. Get the machine ready

    walkdown init

It makes `~/.walkdown` and its registry, records who the person is, installs
the skills, and names anything walkdown needs that this machine lacks (Node 20
or later, git) - exit 1 if so, with where to get it. It touches no project and
is safe to run again. To install the skills somewhere else, name the
directory - run by an agent there is no terminal to ask, and a bare
`walkdown skills` writes nothing:

    walkdown skills --into <dir>

The clone is a Claude Code plugin named `walkdown`, so into Claude Code's own
folder this makes one link, `~/.claude/skills/walkdown`, to the clone: the
skills appear as `/walkdown:setup`, `/walkdown:formulate`, `/walkdown:judge`,
`/walkdown:incorporate` and `/walkdown:backlog`, with `/walkdown:lint` and
`/walkdown:status` beside them, in every project. Updating the clone updates
them; there is never anything to copy again. Claude Code may only list them
from the next session.

If it reports copies from an earlier walkdown (`walkdown-judge` and so on)
beside the link, Claude Code lists every skill twice until they go:
`walkdown skills --into ~/.claude/skills --force` removes the ones walkdown
released and keeps any the person edited.

For an agent other than Claude Code, name that agent's skills directory and it
gets copies instead. `walkdown skills --project` commits copies to this
repository, which is right for a team that wants everyone to have them from a
clone.

## 3. Set the project up

    walkdown blueprints new --dir <project-root>

By default the whole home - spec, threads, runs, evidence, drafts, in one flat
folder - lands in `~/.walkdown/projects/<project>/blueprints/`, and the
repository gets nothing at all, not even a pointer. Ask whether they would
rather commit it: `--commit spec` puts the home in `.walkdown/blueprints/` with
its own `.gitignore` that keeps runs, evidence and drafts out; `--commit all`
the same with no `.gitignore`. The honest recommendation is
`spec` for a team and nothing for an evaluation, and it can be changed later
with `walkdown blueprints commit <standard> --blueprint <id>` - the home moves whole.

With the spec committed, place the pointer deliberately. If the project has
several agent files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`),
walkdown writes none of them and says so - ask which one their agents actually
read, and:

    walkdown pointer --dir <project-root> --into <that file>

**A second blueprint in a project that has one** - an unrelated feature that
wants its own rules, threads and runs - is `blueprints new` again with an id:

    walkdown blueprints new <name> --dir <project-root>

It gets a home of its own and a registry ID (`0003-sh-search`, numbered on this
machine), and says which blueprints the project already holds; check the name is
the one the person meant. Inside the project the bare name works anywhere the ID
does. From then on, every command
that writes takes `--blueprint <id>`, and the reads report on each blueprint.
Never pick one for the person when it is unclear which a rule belongs in - ask.

With nothing committed there is no pointer; the person's own skills are how
their agent knows to ask `walkdown where`.

Finally, tell them where everything went, in one line each: `walkdown where`.

### Recording checks from a clone

The blueprint's `spec.yml` says which reporter to add to their Playwright config, by the
clone's path: nothing puts a `walkdown` package in their `node_modules`, so
`['walkdown/reporter']` would not resolve there. Copy the line `blueprints new` wrote. The
RSpec lines load the formatter from the clone the same way (`-I <clone>/adapters/rspec/lib
-r walkdown/formatter`), so there is no gem to add, and the formatter files its runs
wherever `walkdown where` says, including a home outside the repository.

### Pictures on the storyboard

The storyboard photographs each screen with Playwright, found beside walkdown
or in the project. A project that already runs Playwright tests has it;
otherwise the cards say they could not draw. The server's browser is not
signed in, so an app behind a sign-in shows its login page, and each card
says where the page landed.

## 4. Serve it

    walkdown serve

One server answers for every blueprint on this machine, so if one is already
running, there is nothing to start: it picks up a newly registered blueprint
without a restart. Otherwise run it in the background, from any directory, and
report the URL (`http://localhost:4700` unless taken). This is the panel: the
rules, the threads, and the side-by-side review. The panel finds each page's
blueprint from its address and asks when it cannot tell, so `--blueprint <id>`
is never needed to reach one; it only picks what a page naming none opens.

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
they have, then offer the next step honestly: **`/walkdown:formulate`** turns a
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
