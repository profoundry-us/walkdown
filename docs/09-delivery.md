# 09 — Delivery

## Principle: installing it must not require permission

walkdown's job is to make a project's requirements legible, and the projects
that need that most are the large, governed ones — the ones with thirty packs,
a review board, and an allowlist saying which packages may be installed. A tool
that can only arrive through `npm install` cannot be evaluated by the person
who most needs it, because trying it costs them a procurement conversation.

So the same rule that governs where walkdown puts files governs how it arrives:
**adopting it should cost nothing and be undone by deleting one directory.**

## What it actually needs to run

Measured, not assumed:

| | |
|---|---|
| Runtime dependencies | **one**: `yaml` (ISC), 1.2 MB installed |
| Build dependencies | rollup, tailwind, playwright, eslint — **none needed to run** |
| Node | 20 or newer |
| Network, at runtime | none |

The build outputs are committed on purpose: `lib/viewer/panel.js` is Rollup's
output, `lib/viewer/walkdown.css` is Tailwind's, and `extension/vendor/` holds
copies of both. That was originally about two deliveries needing the same
bundle; it turns out to be what makes the tool installable without a build
toolchain at all. `git clone && npm install --omit=dev` installs exactly
`yaml`, and every command works: `init`, `where`, `lint`, `status`, `serve`.

## The channels, in the order we would recommend them

**1. Clone, plus one package.** Today's answer, and the one the setup page
uses. The whole install is:

    git clone https://github.com/profoundry-us/walkdown.git ~/.walkdown/walkdown
    cd ~/.walkdown/walkdown && npm install --omit=dev

A restricted registry is a conversation about *one* well-known package rather
than about a tool nobody has heard of, which is a conversation that can be won.

**2. Clone, with `yaml` vendored.** Zero registry, and the honest end state for
a tool that wants to be installable anywhere. `yaml` is ISC, its browser build
is 456 KB across many files, and this repository already bundles with Rollup —
so a committed `vendor/yaml.js` is a build step we already run and a single
file to review. The costs are real and worth stating: the vendored copy has to
be updated deliberately rather than by `npm update`, and the published npm
package would need to keep the dependency for people installing it that way.
**Not done. It is one commit away, and it is the thing that removes the last
registry from the path.**

**3. npm.** Still the nicest install where a registry is available, and the
package is already shaped for it (`bin`, `exports`, `files`). It should stay a
channel, never the only one.

**4. A release tarball.** Nothing here needs a build, so a zip of the working
tree is a functioning install. Worth doing when there is a release to cut; not
worth doing before then.

## Skills are their own delivery

The procedures — formulate, judge, incorporate, backlog, setup — are markdown
files an agent reads, and they are useful in a project long before anything
else about walkdown is set up. They install to **`~/.claude/skills`** by
default: the person's own directory, where they work in every project on the
machine and add nothing to any repository.

    walkdown skills                 # yours, every project
    walkdown skills --project       # ./.claude/skills, committed and shared

`walkdown init` picks between those the same way it picks everywhere else —
**skills follow the spec.** A spec committed to the repository is something the
team shares, so the procedures for working on it should arrive with a clone; a
spec kept outside is one person's, and so are their skills. One decision, not
two.

Not every skill ships. `walkdown-sitting` drives a harness that exists only in
walkdown's own repository, and a skill whose first command is missing is worse
than no skill: an agent follows it, fails, and improvises the procedure the
skill existed to stop it improvising.

## The extension needs the clone

The browser extension is loaded unpacked, from `extension/` in the clone. It is
not in any store, which means today there is no way to have the extension
without having the repository — and that, not the CLI, is the reason the setup
flow clones rather than installs.

A store listing would change that, and would also cost the thing the extension
is currently best at: being a directory you can read before you trust it.
Either way the CLI still has to be somewhere, so the clone does not become
wasted work.

## "Visit walkdown.dev and set it up for this project"

The install being four commands is what makes that sentence work. The flow is
deliberately split in two:

- **`site/setup.md`** — fetched by an agent that has nothing. It can assume
  `git` and `node` and no more, so it does one thing: get walkdown onto the
  machine and the skills into the agent's own directory.
- **the `walkdown-setup` skill** — runs after walkdown exists, so it can use
  the tool to set the project up: initialise the spec outside the repository,
  ask which agent file the pointer belongs in, start the panel, and print the
  extension steps a person has to do themselves.

Keeping the bootstrap in one and the procedure in the other is what stops them
drifting into two half-right sets of instructions. The page is markdown because
an agent fetching a URL gets text reliably and a styled page unreliably.

What the wizard may not do is decide for the person: where to clone, whether
the spec is committed, and which file their agents read are all questions with
a recommended answer and a person's decision at the end of them.
