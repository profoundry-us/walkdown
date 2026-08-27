<!-- walkdown:begin -->
## walkdown

This project's spec is the walkdown blueprint in `blueprint/`. Before building,
testing, or reviewing, read and follow `blueprint/AGENTS.md`.
<!-- walkdown:end -->

## Running walkdown's own CLI

walkdown is not a dependency of itself, so `npx walkdown` and a bare `walkdown`
reach whatever is on PATH — often a stale npx cache, which is how a server from
this morning ends up serving files this working tree has deleted. Inside this
repo, run the working tree:

    node bin/walkdown.js status
    node_modules/.bin/walkdown status   # same thing; a symlink `postinstall` keeps

The second form exists because it is what everything else here uses (highball
below), and reaching for it and getting "no such file or directory" is a paper
cut we have both hit more than once.

## Highball

This repo's rules are enforced locally by Highball: `.highball/checks.yml`,
fired by the Claude Code hooks in `.claude/settings.json` — fast checks after
every edit, the full set at turn end, exit 2 blocking on failure.

The hooks fire in both terminal CLI and desktop-app sessions — but only
because they call the local binary directly. Routed through `npx` they died
silently in the hook environment (observed 2026-08-24: zero journal entries,
no error surfaced), which looks identical to the desktop app not running
hooks at all. If hooks ever seem dead again, suspect the command's
resolution before suspecting the harness.

Highball and walkdown answer different questions and their records stay
separate. Highball witnesses that the agent followed this repo's rules while
building; walkdown witnesses that the built thing matches its spec. Verdicts
belong in walkdown's runs ledger, never in a Highball run.

    node_modules/.bin/highball run --fast   # what the edit hook runs
    node_modules/.bin/highball run          # what the turn-end hook runs
    node_modules/.bin/highball runs [n]     # local run history

The hooks call the local binary directly — npx resolves the same package
but intermittently stalls for minutes, which a per-edit hook cannot afford.
