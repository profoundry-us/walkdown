#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { findBlueprintDir, loadBlueprint } from '../lib/blueprint.js';
import { runHashCommand } from '../lib/hash-cmd.js';
import { lint } from '../lib/lint.js';
import { deriveStatus } from '../lib/status.js';

const HELP = `walkdown — verify that what you built is what you designed

Usage:
  walkdown status [--dir <blueprint>] [--target <name>] [--json]
  walkdown lint [--dir <blueprint>] [--no-checks] [--json]
  walkdown hash [--dir <blueprint>] [--write]

Commands:
  status Derived per-rule verification from the runs ledger: latest checks
         per target, latest agent/human walkdowns, open threads.
  lint   Validate the blueprint: schema, ids, storyboard refs, staleness,
         check coverage (via runner.list), threads, and runs.
  hash   Report statement_hash status for every rule; --write updates
         missing/stale hashes in place (formatting preserved).

Options:
  --dir <path>     Blueprint directory (default: found from cwd upward)
  --target <name>  status: only this target's checks column
  --no-checks      lint: skip running the runner.list command
  --write          hash: write missing/stale hashes back to feature files
  --json           status/lint: machine-readable output on stdout
`;

const tty = process.stdout.isTTY;
const red = (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s);
const green = (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);

function loadOrExit(dirOpt) {
  const dir = dirOpt ?? findBlueprintDir();
  if (!dir) {
    console.error('No blueprint found: no walkdown.yml in ./, ./blueprint/, or ancestors. Use --dir.');
    process.exit(2);
  }
  return loadBlueprint(dir);
}

function cmdLint(args) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      checks: { type: 'boolean', default: true },
      json: { type: 'boolean', default: false },
    },
    allowNegative: true,
  });
  const blueprint = loadOrExit(values.dir);
  const { findings, summary, exitCode } = lint(blueprint, { checks: values.checks });

  if (values.json) {
    console.log(JSON.stringify({ findings, summary }, null, 2));
    process.exit(exitCode);
  }

  console.log(dim(`walkdown lint — ${blueprint.dir}\n`));
  for (const level of ['error', 'warn']) {
    const group = findings.filter((f) => f.level === level);
    if (!group.length) continue;
    console.log(level === 'error' ? red('ERRORS') : yellow('WARNINGS'));
    for (const f of group) {
      const where = [f.file, f.subject].filter(Boolean).join(' › ');
      console.log(`  ${level === 'error' ? red('✗') : yellow('⚠')} [${f.category}] ${where ? `${where}: ` : ''}${f.message}`);
    }
    console.log('');
  }
  const s = summary;
  const counts = `${s.rules} rules, ${s.screens} screens, ${s.anchors} anchors, ${s.threads} threads, ${s.runs} runs`;
  const verdict = s.errors ? red(`${s.errors} error(s)`) : green('0 errors');
  console.log(`${s.errors ? red('✗') : green('✓')} ${counts} — ${verdict}, ${s.warnings} warning(s)`);
  process.exit(exitCode);
}

function cmdHash(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, write: { type: 'boolean', default: false } },
  });
  const blueprint = loadOrExit(values.dir);
  const { rows, changedFiles, exitCode } = runHashCommand(blueprint, { write: values.write });

  const mark = { ok: green('✓'), written: green('✓'), stale: red('✗'), missing: yellow('⚠'), 'no-steps': dim('–') };
  for (const r of rows) console.log(`  ${mark[r.status]} ${r.status.padEnd(8)} ${r.rule} ${dim(r.expected)}`);
  if (values.write) console.log(`\n${changedFiles} file(s) updated`);
  else if (exitCode) console.log(`\n${red('stale/missing hashes')} — run \`walkdown hash --write\``);
  process.exit(exitCode);
}

function cmdStatus(args) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      target: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  const blueprint = loadOrExit(values.dir);
  const { targets, rows } = deriveStatus(blueprint, { target: values.target });

  if (values.json) {
    console.log(JSON.stringify({ targets, rows }, null, 2));
    process.exit(rows.some((r) => r.verdict === 'fail') ? 1 : 0);
  }

  const paint = { pass: green, fail: red, stale: yellow, blocked: yellow, never: dim, skipped: dim, na: dim };
  const cellText = (cell, withActor = false) => {
    if (cell.state === 'na') return '·';
    if (cell.state === 'never') return 'never';
    const glyph = { pass: '✓', fail: '✗', stale: '~', skipped: '–', blocked: '⊘' }[cell.state] ?? '?';
    const label = withActor && cell.actor ? cell.actor : cell.state;
    return `${glyph} ${label}`;
  };
  const verdictMark = { pass: green('✓'), fail: red('✗'), pending: dim('○') };

  const headers = ['', 'RULE', ...targets.map((t) => t.toUpperCase()), 'AGENT', 'HUMAN', 'THREADS'];
  const table = rows.map((r) => [
    verdictMark[r.verdict],
    r.rule,
    ...targets.map((t) => ({ text: cellText(r.cells[t]), state: r.cells[t].state })),
    { text: cellText(r.agent), state: r.agent.state },
    { text: cellText(r.human, true), state: r.human.state },
    r.threads.map((t) => `${t.id} ${t.status}`).join(', ') || '—',
  ]);

  const plain = (c) => (typeof c === 'string' ? c : c.text);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...table.map((row) => [...plain(row[i])].length))
  );
  const renderCell = (c, i) => {
    const text = plain(c);
    const padded = text + ' '.repeat(Math.max(0, widths[i] - [...text].length));
    return typeof c === 'string' ? padded : (paint[c.state] ?? ((s) => s))(padded);
  };

  console.log(dim(`walkdown status — ${blueprint.dir}\n`));
  console.log('  ' + headers.map((h, i) => dim(h.padEnd(widths[i]))).join('  '));
  for (const row of table) console.log('  ' + row.map(renderCell).join('  '));

  const counts = rows.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] ?? 0) + 1), acc), {});
  console.log(
    `\n${counts.pass ?? 0} verified, ${counts.pending ?? 0} pending, ${counts.fail ?? 0} failing`
  );
  process.exit(counts.fail ? 1 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'lint') cmdLint(rest);
else if (cmd === 'status') cmdStatus(rest);
else if (cmd === 'hash') cmdHash(rest);
else {
  console.log(HELP);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 2 : 0);
}
