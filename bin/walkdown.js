#!/usr/bin/env node
/*
 * The router, and only the router. Each command lives in ./commands/<name>.js
 * and is imported when named, so `walkdown lint` never pays for the server's
 * import graph - the lazy loading three commands already did by hand, made
 * the shape of the whole CLI. Rendering shared between commands lives in
 * lib/report/, where it has tests.
 */
const HELP = `walkdown — verify that what you built is what you designed

Usage:
  walkdown init [--dir <project-root>] [--in-repo]
  walkdown run [--target <name>] [--rule <id>] [--dir <blueprint>]
  walkdown status [<rule-id>] [--dir <blueprint>] [--target <name>] [--json]
  walkdown lint [--dir <blueprint>] [--no-checks] [--json]
  walkdown hash [--dir <blueprint>] [--write]
  walkdown judge <rule-id> [--target <name>] [--serve <origin>] [--dir <blueprint>] [--json]
  walkdown sweep --why <reason> [--tiers checks,agent] [--dir <blueprint>] [--target <name>]
  walkdown threads [--dir <blueprint>] [--rule <id>] [--all] [--json]
  walkdown thread <id> [--reply <text>] [--status <s>|--verify|--reopen|--waive]
                       [--reason <text>] [--actor <name>] [--dir <blueprint>] [--json]
  walkdown serve [--dir <blueprint>] [--port <n>]
  walkdown claims [--dir <blueprint>] [--url <address>] [--json]
  walkdown where [<kind>] [--dir <blueprint>] [--json]
  walkdown move <kind> --to <path> [--dir <blueprint>]
  walkdown pointer [--dir <project-root>] [--into <file>]
  walkdown skills [--into <dir>] [--project] [--force]

Commands:
  init    Scaffold blueprint/ in a project: config, storyboard, feature
          template, and blueprint/AGENTS.md (the conventions AI agents follow),
          plus a pointer in CLAUDE.md.
  run     Run the project's checks via the runner contract (run_all, or
          run_for_rule with --rule), injecting the target's env and
          WALKDOWN_TARGET. The reporter/formatter records the run.
  status  Derived per-rule verification from the runs ledger: latest checks
          per target, the latest agent walkdown, which roles have accepted the
          rule, and open threads. With a rule id: that rule in full
          (statement, evidence, the excuses for any tier it does not ask for,
          who has signed and who has not, threads).
  lint    Validate the blueprint: schema, ids, storyboard refs, staleness,
          check coverage (via runner.list), threads, and runs.
  hash    Report statement_hash status for every rule; --write updates
          missing/stale hashes in place (formatting preserved).
  judge   Print the judging prompt for one rule — statement, steps, setup,
          screens with real addresses, where evidence goes and how a verdict
          is recorded — ready to paste into any agent with a browser. The
          first step toward prompt-driven judging (docs/11-architecture.md):
          the prompt ends where the reader begins, and this judges nothing.

  sweep   Ask for the named tiers to be judged again from scratch. Verdicts
          recorded before the sweep read as stale, so a rule nobody gets back
          to is legible as unfinished rather than as passing. Nothing is
          deleted - the ledger stays append-only and the marker says why.
          Deliberate on purpose: nothing else in walkdown ever writes one.
  threads List active threads (questions & notes); --all includes
          incorporated/verified/waived, --rule filters by anchored rule.
  thread  Show one thread in full: anchor, body, and replies. With --reply
          and/or a status flag, mutate it first: transitions are validated
          (notes: open → addressed → verified | reopen | waived; questions:
          open → answered → incorporated | reopen | waived). "verified" and
          "waived" require a named human actor — never "agent". Waiving and
          reopening require --reason (recorded as a reply). Actor defaults
          to WALKDOWN_ACTOR or the OS username.
  where   Print where this project's pieces live and why each was chosen -
          the spec, the runs, the threads, the evidence, the drafts, and the
          repository a run's git_sha comes from. With a kind (spec, code,
          runs, threads, evidence, drafts) prints that one path alone, for
          scripts. Reads the personal config and the working tree, and
          writes nothing at all.
  move    Move one kind of record somewhere else and record the choice in
          ~/.walkdown/config.yml. Moves files; never edits one. Refuses a
          destination that already holds records rather than interleaving
          two ledgers.
  pointer Print the paragraph that tells an AI agent this project has a spec,
          or place it with --into <file>. Which file agents read is a
          project's own business - CLAUDE.md, AGENTS.md, a pack-level file in
          a monorepo - so walkdown asks rather than assuming. Idempotent: it
          replaces its own marked block and touches no other line.
  skills  Install the agent procedures walkdown ships - formulate, judge,
          incorporate, backlog, setup. Default is your own skills directory
          (~/.claude/skills), where they work in every project and add nothing
          to any repository; --project puts them in ./.claude/skills instead,
          to be committed and shared. A copy you have edited is kept, not
          overwritten, unless you pass --force.
  serve   Start the local viewer: status board, side-by-side prototype/app
          with the embed (pinning), and human walkdown recording. Also
          serves /embed.js and the pin/walkdown API.

Options:
  --dir <path>     Blueprint directory (default: found from cwd upward)
  --target <name>  status: only this target's checks column
  --rule <id>      threads: only threads anchored to this rule
  --all            threads: include terminal (incorporated/verified/waived)
  --no-checks      lint: skip running the runner.list command
  --write          hash: write missing/stale hashes back to feature files
  --why <reason>   sweep: why the whole thing is being asked for again (required)
  --tiers <list>   sweep: comma-separated tiers to sweep (default: checks,agent)
  --json           status/lint/threads/thread: machine-readable output
`;

const COMMANDS = new Set([
  'init',
  'run',
  'lint',
  'status',
  'hash',
  'judge',
  'sweep',
  'threads',
  'thread',
  'serve',
  'claims',
  'where',
  'move',
  'pointer',
  'skills',
]);

const [cmd, ...rest] = process.argv.slice(2);
if (!COMMANDS.has(cmd)) {
  console.log(HELP);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 2 : 0);
}

const { run } = await import(`./commands/${cmd}.js`);
await run(rest);
