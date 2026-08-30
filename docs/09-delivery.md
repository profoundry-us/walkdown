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
| Runtime dependencies | **none.** `yaml` is vendored — `vendor/yaml.js`, 260 KB, committed |
| Build dependencies | rollup, tailwind, playwright, eslint — **none needed to run** |
| Node | 20 or newer |
| Network, at runtime | none |

The build outputs are committed on purpose: `lib/viewer/panel.js` is Rollup's
output, `lib/viewer/walkdown.css` is Tailwind's, and `extension/vendor/` holds
copies of both. That was originally about two deliveries needing the same
bundle; it turns out to be what makes the tool installable without a build
toolchain at all. `vendor/yaml.js` finishes the job: **`git clone` is the whole
install.**

Verified rather than assumed — from a clone with no `node_modules` directory at
all, `init`, `where`, `lint` and `serve` all work, walkdown's own 127-rule
blueprint parses, and the panel and the embed both answer 200.

## The channels, in the order we would recommend them

**1. Clone. That is the install.**

    git clone https://github.com/profoundry-us/walkdown.git ~/.walkdown/walkdown
    node ~/.walkdown/walkdown/bin/walkdown.js --help

No registry, no build, no network. This is what `vendor/yaml.js` buys, and it
is why it is worth the costs below.

**2. npm.** Still the nicest install where a registry is available, and the
package is already shaped for it (`bin`, `exports`, `files`). It should stay a
channel, never the only one.

**3. A release tarball.** Nothing here needs a build, so a zip of the working
tree is a functioning install. Worth doing when there is a release to cut; not
worth doing before then.

## The cost of vendoring, stated plainly

`vendor/yaml.js` is 260 KB of somebody else's code in our repository, bundled
from yaml's browser build by `npm run build:yaml` (`rollup.vendor.mjs` explains
why the browser build: it is ESM with relative imports, so Rollup needs no
resolver, while the Node build is CJS and would need two plugins). `yaml` stays
in `devDependencies`, because it is still a real dependency — of the build,
not of running walkdown.

Three things this costs, none of them free:

- **Updates become deliberate.** No `npm update` fixes a yaml bug for us; a
  person bumps the devDependency and rebuilds. For a file that changes a few
  times a year, deliberate is the right side of that trade — but it is a trade.
- **A stale bundle is invisible.** Everything imports it and it still parses, so
  nothing fails until somebody assumes a fix is present that is not. Hence
  `npm run check:yaml`, which Highball runs: it rebuilds to a scratch path and
  compares, the same arrangement the panel bundle has, and for the same reason
  — rebuilding in place would make the file current and the check could never
  fail.
- **The browser build differs from the Node one** in exactly two places:
  `log.js` calls `console.warn` instead of `process.emitWarning`, and `!!binary`
  yields a `Uint8Array` rather than a `Buffer`. walkdown parses neither, so
  neither reaches us — but that is a fact about today's walkdown, and it should
  be re-checked if we ever accept binary tags.

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
