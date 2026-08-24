<!-- walkdown:begin -->
## walkdown

This project's spec is the walkdown blueprint in `blueprint/`. Before building,
testing, or reviewing, read and follow `blueprint/AGENTS.md`.
<!-- walkdown:end -->

## Highball

This repo's rules are enforced locally by Highball: `.highball/checks.yml`,
fired by the Claude Code hooks in `.claude/settings.json` — fast checks after
every edit, the full set at turn end, exit 2 blocking on failure.

The hooks fire in terminal CLI sessions only. The Claude Code desktop app
loads them but never executes command hooks (a known limitation — see
claude-code issues #42336/#63047), so in desktop sessions the agent must run
the two commands below itself: `--fast` after edits, the full set before any
commit.

Highball and walkdown answer different questions and their records stay
separate. Highball witnesses that the agent followed this repo's rules while
building; walkdown witnesses that the built thing matches its spec. Verdicts
belong in walkdown's runs ledger, never in a Highball run.

    npx @profoundry-us/highball run --fast   # what the edit hook runs
    npx @profoundry-us/highball run          # what the turn-end hook runs
    npx @profoundry-us/highball runs [n]     # local run history
