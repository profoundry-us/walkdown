<!-- walkdown:begin -->
## walkdown

This project's spec is the walkdown blueprint in `blueprint/`. Before building,
testing, or reviewing, read and follow that folder's `AGENTS.md`. Run
`walkdown where` to see where everything this project uses actually lives.
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

## The panel is built, not edited in place

`lib/viewer/panel.js` is Rollup's output. Edit `src/panel/index.js` — an edit
to the built file survives until the next `npm run build:js` and then vanishes,
which reads exactly like the change never worked.

    npm run build:js     # src/panel -> lib/viewer/panel.js
    npm run check:js     # the build is current (Highball runs this)

The build is committed because both deliveries read it: the classic `<script>`
`walkdown serve` hands out, and `extension/vendor/panel.js`, which `build:ext`
copies. Rollup runs with `treeshake: false` and `format: 'es'`; the reasons are
in `rollup.config.mjs` and both are load-bearing.

`tools/sync-shared.mjs` and `tools/sync-phosphor.mjs` write their generated
blocks into the source, not the build, for the same reason.

## Judging the whole board

`walkdown-judge` is for a rule or the handful a change touched. For everything
at once — after a big refactor, or on a cadence of days — there is
`walkdown-sitting`, and a harness for the mechanical half:

    node tools/sitting.mjs owed       what the agent tier still owes
    node tools/sitting.mjs capture    drive every panel state, save both surfaces
    node tools/sitting.mjs record f   append the run (refuses thin reasoning)

The state list inside `sitting.mjs` is data. A rule needing a state nobody has
captured belongs in that list, not in a throwaway script.

Both skills serve a disposable copy for anything that makes the panel write,
and both are now told to take it away again:

    node tools/scratch.mjs new sitting-0830 --why "..."   # a copy, stamped
    node tools/scratch.mjs list                           # what is lying about
    node tools/scratch.mjs clean sitting-0830             # or --stale

The stamp exists because six unstamped copies once sat in `.walkdown/tmp` for
weeks, and by the time anyone found them nobody could say which sitting had
made which.

To make "did we skip any?" answerable, declare a sweep first:

    node bin/walkdown.js sweep --tiers agent --why "..."

Every verdict older than the marker then reads as stale, so an unjudged rule is
visibly unjudged. Nothing is deleted — the ledger is append-only, which is why
a sweep supersedes rather than clears. It is deliberate on purpose: nothing
else in walkdown ever writes one, and it is the human's call to ask for it.
