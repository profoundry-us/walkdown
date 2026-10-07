#!/usr/bin/env node
/*
 * The router, and only the router. Each command lives in ./commands/<name>.js
 * and is imported when named, so `walkdown lint` never pays for the server's
 * import graph - the lazy loading three commands already did by hand, made
 * the shape of the whole CLI. Rendering shared between commands lives in
 * lib/report/, where it has tests.
 */
import { Refused } from '../lib/refusal.js';

const HELP = `walkdown — verify that what you built is what you designed

A command is a noun and then a verb; the noun alone lists, and
\`walkdown <noun> help\` lists its verbs. \`walkdown <command> --help\` says more.

Getting ready
  walkdown init [--force]
  walkdown skills [--into <dir>] [--project] [--force]
  walkdown upgrade [--dry-run] [--code <pc>]

Blueprints
  walkdown blueprints [list] [--stale]
  walkdown blueprints new [<name>] [--folder <folder>] [--commit none|spec|all] [--project <label>] [--code <pc>]
  walkdown blueprints import <path> [--all|--only <folders>] [--ephemeral] [--why <reason>]
  walkdown blueprints rename <id> <new-name> [--folder <folder>]
  walkdown blueprints commit <none|spec|all> --blueprint <id>
  walkdown blueprints forget <id>
  walkdown pointer [--dir <root>] [--into <file>]

Records
  walkdown records [list] [--blueprint <id>] [--json]
  walkdown records move <kind> --to <path> --blueprint <id>
  walkdown where [<kind>] [--blueprint <id>] [--json]

Threads
  walkdown threads [list] [--rule <id>] [--all] [--blueprint <id>] [--json]
  walkdown threads new --rule <id> | --screen <id> --body <text> --blueprint <id> [--kind note|question] ...
  walkdown threads show <id>
  walkdown threads reply <id> <text> --blueprint <id> [--as-agent [--said <text>] [--added <text>]]
  walkdown threads set <id> --status <s> | --verify | --reopen | --waive --blueprint <id> [--reason <text>] [--reply <text>]
  walkdown threads relabel <label|uuid> --blueprint <id> [--yes]

Rules and verdicts
  walkdown status [<rule-id>] [--blueprint <id>] [--target <name>] [--json]
  walkdown lint [--blueprint <id>] [--no-checks] [--json]
  walkdown hash [--blueprint <id>] [--write [--reword <why>]]    (--write needs --blueprint)
  walkdown run [--target <name>] [--rule <id>] [--blueprint <id>]
  walkdown judge <rule-id> --blueprint <id> [--target <name>] [--serve <origin>] [--json]
  walkdown sweep --why <reason> --blueprint <id> [--tiers checks,agent] [--target <name>]
  walkdown rules move <rule|story|feature>... --blueprint <from> --to <blueprint> [--dry-run]
  walkdown rules rename <rule> <new-id> --blueprint <id> [--dry-run]

The panel
  walkdown serve [--blueprint <id>] [--port <n>]
  walkdown claims [--blueprint <id>] [--url <address>] [--json]

--blueprint <id> names a blueprint. Reads cover every blueprint in the project
without it; anything that writes into one needs it, wherever it is run from.
\`walkdown blueprints\` lists the IDs.
`;

/* What each command that is not a noun does, for `walkdown <command> --help`. */
const ABOUT = {
  upgrade:
    "Move walkdown's files from the layout before ADR 0014 to the current one, once:\nthe profile, each home flattened around its spec.yml, registry rows given IDs\nand projects, threads given UUIDs. Folder names and verdicts are kept. With\n--dry-run it says what it would do and changes nothing. --code <pc> gives the\nproject you run it in that code, instead of the one derived from its label.",
  run: "Run the project's checks via the runner contract (run_all, or run_for_rule\nwith --rule), injecting the target's env and WALKDOWN_TARGET. The\nreporter/formatter records the run.",
  status:
    'Derived per-rule verification from the runs ledger: latest checks per target,\nthe latest agent walkdown, which roles have accepted the rule, and open\nthreads. With a rule id: that rule in full (statement, evidence, the excuses\nfor any tier it does not ask for, who has signed and who has not, threads).',
  lint: 'Validate the blueprint: schema, ids, storyboard refs, staleness, check\ncoverage (the rule tags in the test files, or runner.list), threads, and runs.',
  hash: 'Report statement_hash status for every rule - the hash pins the statement and\nthe steps; --write updates missing/stale hashes in place (formatting\npreserved), and every verdict on a re-stamped rule reads stale. --reword\n"<why>" keeps the old hash under steps.reworded so the verdicts stay current:\nthe words changed, the rule did not.',
  judge:
    'Print the judging prompt for one rule — statement, steps, setup, screens with\nreal addresses, where evidence goes and how a verdict is recorded — ready to\npaste into any agent with a browser. The first step toward prompt-driven\njudging (docs/11-architecture.md): the prompt ends where the reader begins,\nand this judges nothing.',
  sweep:
    'Ask for the named tiers to be judged again from scratch. Verdicts recorded\nbefore the sweep read as stale, so a rule nobody gets back to is legible as\nunfinished rather than as passing. Nothing is deleted - the ledger stays\nappend-only and the marker says why. Deliberate on purpose: nothing else in\nwalkdown ever writes one.',
  where:
    "Print where this project's pieces live and why each was chosen - the spec, the\nruns, the threads, the evidence, the drafts, and the repository a run's\ngit_sha comes from. With a kind (spec, code, runs, threads, evidence, drafts)\nprints that one path alone, for scripts. Reads the personal config and the\nworking tree, and writes nothing at all.",
  pointer:
    "Print the paragraph that tells an AI agent this project has a spec, or place\nit with --into <file>. Which file agents read is a project's own business -\nCLAUDE.md, AGENTS.md, a pack-level file in a monorepo - so walkdown asks\nrather than assuming. Idempotent: it replaces its own marked block and touches\nno other line.",
  skills:
    "Install the agent procedures walkdown ships - formulate, judge, incorporate,\nbacklog, setup. With no flags it shows every place they can go and what is\nalready in each, then ASKS - it never picks for you, and with no terminal to\nask it writes nothing and says so. --into <dir> names a directory outright;\n--project is the repository's one copy, at the root's .claude/skills wherever\nin the tree you run it, to be committed and shared. Your own directory\n(~/.claude/skills) works in every project and touches no repository. A copy\nyou have edited is kept, not overwritten, unless --force.",
  serve:
    'Start the local viewer: status board, side-by-side prototype/app with the\nembed (pinning), and human walkdown recording. Also serves /embed.js and the\npin/walkdown API.',
};

/* The nouns, each a table of verbs (bin/commands/noun.js). */
const NOUNS = ['blueprints', 'records', 'threads', 'rules'];

/* Forms ADR 0012 retired: refused with the form that replaced them. */
const OLD = new Set(['thread', 'import', 'move', 'blueprint']);

const COMMANDS = new Set([
  'init',
  'upgrade',
  'skills',
  'pointer',
  'where',
  'status',
  'lint',
  'hash',
  'run',
  'judge',
  'sweep',
  'serve',
  'claims',
  ...NOUNS,
]);

const [cmd, ...rest] = process.argv.slice(2);
if (OLD.has(cmd)) {
  const { oldForm } = await import('./commands/old-forms.js');
  oldForm([cmd, ...rest]);
  process.exit(2);
}
if (!COMMANDS.has(cmd)) {
  if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') {
    console.error(`walkdown: no command "${cmd}". \`walkdown help\` lists them.`);
    process.exit(2);
  }
  console.log(HELP);
  process.exit(0);
}

// Asking a subcommand for help is the friendliest possible ask, and every
// subcommand used to hand it straight to parseArgs, which answered with a
// stack trace pointing at node internals. One answer, here, for all of them:
// a noun lists its verbs (bin/commands/noun.js), anything else says what it does.
if (!NOUNS.includes(cmd) && (rest.includes('--help') || rest.includes('-h'))) {
  const usage = HELP.split('\n').filter(
    (l) => l.startsWith(`  walkdown ${cmd} `) || l === `  walkdown ${cmd}`,
  );
  console.log(`${usage.map((l) => `Usage: ${l.trim()}`).join('\n')}\n\n${ABOUT[cmd] ?? ''}`.trim());
  process.exit(0);
}

const { run } = await import(`./commands/${cmd}.js`);
try {
  await run(rest);
} catch (err) {
  /*
   * A refusal walkdown wrote reaches a person as the sentence it is. Commands
   * used to catch their own, one at a time, which left a refusal raised three
   * layers down - an unreadable spec file, a shut features/ directory - to
   * arrive under a caret and four stack frames (n-0217). One boundary, at the
   * place everything already passes through. Anything unmarked still throws:
   * an error nobody has thought about is better read as a stack trace than
   * dressed up as a refusal.
   */
  if (err instanceof Refused) {
    console.error(err.message);
    process.exit(2);
  }
  const usage =
    err?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ||
    err?.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE';
  if (!usage) throw err;
  // A usage mistake is refused the way every refusal here is: what was
  // wrong, on stderr, exit 2 - so a script stops and a person is answered.
  console.error(`walkdown ${cmd}: ${err.message.split('. ')[0]}.`);
  console.error("'walkdown --help' lists every command and its flags.");
  process.exit(2);
}
