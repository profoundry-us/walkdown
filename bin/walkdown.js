#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collectRules, findBlueprintDir, loadBlueprint } from '../lib/blueprint.js';
import { blueprintForUrl, claimsOf, findCollisions } from '../lib/claims.js';
import { listDrafts } from '../lib/draft.js';
import { runHashCommand } from '../lib/hash-cmd.js';
import { writeSweep } from '../lib/run-record.js';
import { lint } from '../lib/lint.js';
import { checkedRuleIds } from '../lib/checks.js';
import { deriveStatus } from '../lib/status.js';
import { discoverBlueprints } from '../lib/serve.js';
import { getThread, listThreads, replyToThread, transitionThread } from '../lib/threads.js';

const HELP = `walkdown — verify that what you built is what you designed

Usage:
  walkdown init [--dir <project-root>]
  walkdown run [--target <name>] [--rule <id>] [--dir <blueprint>]
  walkdown status [<rule-id>] [--dir <blueprint>] [--target <name>] [--json]
  walkdown lint [--dir <blueprint>] [--no-checks] [--json]
  walkdown hash [--dir <blueprint>] [--write]
  walkdown sweep --why <reason> [--tiers checks,agent,human] [--dir <blueprint>] [--target <name>]
  walkdown threads [--dir <blueprint>] [--rule <id>] [--all] [--json]
  walkdown thread <id> [--reply <text>] [--status <s>|--verify|--reopen|--waive]
                       [--reason <text>] [--actor <name>] [--dir <blueprint>] [--json]
  walkdown serve [--dir <blueprint>] [--port <n>]
  walkdown claims [--dir <blueprint>] [--url <address>] [--json]

Commands:
  init    Scaffold blueprint/ in a project: config, storyboard, feature
          template, and blueprint/AGENTS.md (the conventions AI agents follow),
          plus a pointer in CLAUDE.md.
  run     Run the project's checks via the runner contract (run_all, or
          run_for_rule with --rule), injecting the target's env and
          WALKDOWN_TARGET. The reporter/formatter records the run.
  status  Derived per-rule verification from the runs ledger: latest checks
          per target, latest agent/human walkdowns, open threads. With a
          rule id: that rule in full (statement, evidence, threads).
  lint    Validate the blueprint: schema, ids, storyboard refs, staleness,
          check coverage (via runner.list), threads, and runs.
  hash    Report statement_hash status for every rule; --write updates
          missing/stale hashes in place (formatting preserved).

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

const tty = process.stdout.isTTY;
const red = (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s);
const green = (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);

/*
 * How a command finishes. process.exit() tears the process down before Node
 * has flushed stdout, so a large `--json` payload down a pipe is truncated at
 * the pipe's buffer - 128KB, which a real blueprint passes without warning.
 * Setting the code lets the write drain and the process end on its own.
 */
const end = (code) => { process.exitCode = code; };

function loadOrExit(dirOpt) {
  const dir = dirOpt ?? findBlueprintDir();
  if (!dir) {
    console.error('No blueprint found: no walkdown.yml in ./, ./blueprint/, or ancestors. Use --dir.');
    process.exit(2);
  }
  return loadBlueprint(dir);
}

/*
 * Who claims what, across every blueprint under the served folder. Two jobs in
 * one place because they are one question: with `--url`, which blueprint a page
 * belongs to; without, whether any page is claimed by more than one, which is
 * the constraint that makes the first question answerable at all.
 *
 * It lives outside `lint` on purpose - lint validates ONE blueprint, and this
 * is only visible across the set.
 */
function cmdClaims(args) {
  const { values } = parseArgs({
    args, options: { dir: { type: 'string' }, url: { type: 'string' }, json: { type: 'boolean' } },
  });
  const dir = values.dir ?? findBlueprintDir();
  if (!dir) {
    console.error('No blueprint found: no walkdown.yml in ./, ./blueprint/, or ancestors. Use --dir.');
    return end(2);
  }
  const baseRoot = dirname(resolve(dir));
  const projects = discoverBlueprints(baseRoot).map((p) => ({ id: p.id, blueprint: loadBlueprint(p.dir) }));

  if (values.url) {
    const hit = blueprintForUrl(projects, values.url);
    if (values.json) { console.log(JSON.stringify({ url: values.url, match: hit }, null, 2)); return end(0); }
    if (!hit) { console.log(`no blueprint claims ${values.url}`); return end(1); }
    console.log(`${values.url}\n  ${hit.id} — screen ${hit.screen} (target ${hit.target})`);
    return end(0);
  }

  const clashes = findCollisions(projects);
  if (values.json) {
    console.log(JSON.stringify({ projects: projects.map((p) => p.id), collisions: clashes }, null, 2));
    return end(clashes.length ? 1 : 0);
  }
  if (!clashes.length) {
    const total = projects.reduce((n, p) => n + claimsOf(p.blueprint).length, 0);
    console.log(`\u2713 ${projects.length} blueprint(s), ${total} claim(s) — no page claimed twice`);
    return end(0);
  }
  for (const c of clashes) {
    console.log(`\u2717 ${c.key} is claimed by ${new Set(c.claimants.map((x) => x.blueprint)).size} blueprints:`);
    for (const who of c.claimants)
      console.log(`    ${who.blueprint} — screen ${who.screen} (target ${who.target})`);
  }
  console.log(`\n${clashes.length} page(s) claimed more than once. A page belongs to exactly one blueprint.`);
  return end(1);
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
    return end(exitCode);
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
  return end(exitCode);
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
  return end(exitCode);
}

/** "n-0001 addressed, q-0002 open" up to two threads; beyond that "n-0001 addressed +2".
 *  `walkdown threads --rule <id>` shows the full list. */
function formatThreads(threads) {
  if (!threads.length) return '—';
  const shown = threads.slice(0, 2).map((t) => `${t.id} ${t.status}`).join(', ');
  return threads.length > 2 ? `${shown} +${threads.length - 2}` : shown;
}

const paint = { pass: green, fail: red, stale: yellow, blocked: yellow, never: dim, skipped: dim, na: dim, approved: yellow, refining: yellow };
const cellText = (cell, withActor = false) => {
  if (cell.state === 'na') return '·';
  if (cell.state === 'never') return 'never';
  const glyph = { pass: '✓', fail: '✗', stale: '~', skipped: '–', blocked: '⊘', approved: '✍︎', refining: '✎︎' }[cell.state] ?? '?';
  const label = withActor && cell.actor ? cell.actor : cell.state;
  return `${glyph} ${label}`;
};
const truncate = (s, n) => {
  const text = String(s ?? '').trim().replace(/\s+/g, ' ');
  return [...text].length > n ? [...text].slice(0, n - 1).join('') + '…' : text;
};

/** The rules withdrawn from the report but kept in the file, and why. */
const retiredRules = (blueprint) =>
  collectRules(blueprint.features)
    .filter(({ rule }) => rule?.retired)
    .map(({ rule }) => ({ rule: rule.id, statement: rule.statement, retired: rule.retired }));

function renderRuleDetail(blueprint, derived, ruleId, json) {
  const row = derived.rows.find((r) => r.rule === ruleId);
  if (!row) {
    /*
     * A retired rule is not an unknown one. It answers here rather than sending
     * you to a list it is deliberately absent from - otherwise retiring a rule
     * and deleting it look identical from the command line, which is the whole
     * distinction the marker exists to make.
     */
    const gone = retiredRules(blueprint).find((r) => r.rule === ruleId);
    if (gone) {
      if (json) { console.log(JSON.stringify({ ...gone, state: 'retired' }, null, 2)); return end(0); }
      console.log(`${gone.rule} · ${dim('retired')}`);
      console.log(`  ${dim(gone.statement)}`);
      console.log(`\n  ${yellow('RETIRED')}\n  ${gone.retired}`);
      console.log(dim('\n  Its verdicts stay in the ledger; nothing is owed against it.'));
      return end(0);
    }
    console.error(`No rule "${ruleId}". \`walkdown status\` lists all rules.`);
    process.exit(2);
  }
  const exitCode = row.verdict === 'fail' ? 1 : 0;
  if (json) {
    console.log(JSON.stringify(row, null, 2));
    return end(exitCode);
  }

  const verdictWord = { pass: green('verified'), fail: red('failing'), pending: yellow('pending') }[row.verdict];
  console.log(`${row.rule} · ${verdictWord}`);
  console.log(`  ${row.statement ?? dim('(no statement)')}`);
  console.log(dim(`  story ${row.story} · verify ${row.verify.join(', ')} · screens ${row.screens.join(', ') || '—'}`));

  if (row.steps) {
    console.log(`\n  ${dim('STEPS')}`);
    for (const [phase, items] of Object.entries(row.steps))
      for (const [i, step] of items.entries())
        console.log(`    ${dim((i === 0 ? phase : '').padEnd(6))}${step}`);
  }

  console.log(`\n  ${dim('EVIDENCE')}`);
  const sources = [
    ...derived.targets.map((t) => [`checks/${t}`, row.cells[t]]),
    ['agent', row.agent],
    ['human', row.human],
  ].filter(([, cell]) => cell.state !== 'na');
  for (const [label, cell] of sources) {
    const state = (paint[cell.state] ?? ((s) => s))(cellText(cell, label === 'human'));
    const provenance = cell.runId ? dim(`  ${cell.runId}${cell.created ? ` · ${cell.created}` : ''}`) : '';
    console.log(`    ${label.padEnd(15)}${state}${provenance}`);
    if (cell.detail) console.log(dim(`                   ${truncate(cell.detail, 90)}`));
    if (cell.evidence?.length) console.log(dim(`                   evidence: ${cell.evidence.join(', ')}`));
  }

  const threads = listThreads(blueprint, { rule: ruleId, all: true });
  if (threads.length) {
    console.log(`\n  ${dim('THREADS')}`);
    for (const t of threads)
      console.log(`    ${t.id} ${paintStatus(t.status)} — ${truncate(t.body, 70)}`);
  }
  return end(exitCode);
}

function cmdStatus(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      target: { type: 'string' },
      json: { type: 'boolean', default: false },
      retired: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const blueprint = loadOrExit(values.dir);
  if (values.retired) {
    const gone = retiredRules(blueprint);
    if (values.json) { console.log(JSON.stringify(gone, null, 2)); return end(0); }
    if (!gone.length) { console.log('No retired rules.'); return end(0); }
    console.log(dim(`retired rules — ${blueprint.dir}\n`));
    for (const r of gone) console.log(`  ${yellow(r.rule)}\n    ${r.retired}\n`);
    console.log(dim(`${gone.length} rule(s) withdrawn. Their verdicts stay in the ledger.`));
    return end(0);
  }
  const derived = deriveStatus(blueprint, {
    target: values.target,
    checkRefs: checkedRuleIds(blueprint.config, blueprint.projectRoot),
  });
  const { targets, rows } = derived;

  if (positionals[0]) return renderRuleDetail(blueprint, derived, positionals[0], values.json);

  // Sittings that are underway but not yet sealed. They are not verdicts and
  // never count as any, but a queue that hides them tells you to go judge what
  // someone is judging right now.
  const drafts = listDrafts(blueprint.dir);

  if (values.json) {
    console.log(JSON.stringify({ targets, rows, drift: derived.drift, attention: derived.attention, drafts, activeThreads: listThreads(blueprint) }, null, 2));
    return end(rows.some((r) => r.verdict === 'fail') ? 1 : 0);
  }

  const verdictMark = { pass: green('✓'), fail: red('✗'), pending: dim('○') };

  const headers = ['', 'RULE', ...targets.map((t) => t.toUpperCase()), 'AGENT', 'HUMAN', 'THREADS'];
  const table = rows.map((r) => [
    verdictMark[r.verdict],
    r.rule,
    ...targets.map((t) => ({ text: cellText(r.cells[t]), state: r.cells[t].state })),
    { text: cellText(r.agent), state: r.agent.state },
    { text: cellText(r.human, true), state: r.human.state },
    formatThreads(r.threads),
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
  const open = (derived.sweeps ?? []).filter((s) => s.done < s.of);
  console.log(
    `\n${counts.pass ?? 0} verified, ${counts.pending ?? 0} pending, ${counts.fail ?? 0} failing` +
      (open.length
        ? dim(` — ${open.map((s) => `${s.of - s.done} awaiting the ${s.tier} sweep`).join(', ')}`)
        : '')
  );

  /*
   * An open sweep is the loudest thing on the board while it lasts, because
   * the whole point of declaring one is to stop a rule nobody got back to from
   * reading green. It names itself, says why it was asked for, and lists what
   * is left - counted, not remembered.
   */
  for (const s of derived.sweeps ?? []) {
    const left = s.of - s.done;
    const head = left
      ? `${yellow('SWEEP')} ${s.tier} on ${s.target} — ${s.done}/${s.of} judged, ${yellow(String(left))} to go`
      : `${green('SWEEP')} ${s.tier} on ${s.target} — ${s.done}/${s.of}, complete`;
    console.log(`\n  ${head}`);
    console.log(dim(`  ${s.runId}${s.actor ? ` by ${s.actor}` : ''} — ${s.why ?? 'no reason recorded'}`));
    for (const rule of s.owed.slice(0, 12)) console.log(`  ◇ ${rule}`);
    if (s.owed.length > 12) console.log(dim(`  +${s.owed.length - 12} more`));
  }

  const HOWTO = {
    judge: (i) => `walk down ${i.rule} — human verification not yet recorded`,
    verify: (i) => `verify ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — fix claimed, awaiting your judgment`,
    answer: (i) => `answer ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''}`,
    address: (i) => `address ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — open note`,
    incorporate: (i) => `incorporate ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — answered, fold it into the rule`,
    cover: (i) => `cover ${i.rule} — demands checks, and no check claims it`,
  };
  for (const [who, title] of [['human', 'NEEDS A HUMAN'], ['agent', 'AGENT QUEUE']]) {
    const items = derived.attention.filter((i) => i.who === who);
    if (!items.length) continue;
    console.log(`\n  ${dim(title)}`);
    for (const i of items) console.log(`  ${yellow('◆')} ${HOWTO[i.action](i)}`);
  }

  for (const d of drafts) {
    const n = Object.keys(d.verdicts).length;
    console.log(
      `\n  ${yellow('◐')} walkdown in progress — ${n} rule${n === 1 ? '' : 's'} judged by ` +
      `${d.actor ?? 'someone'}${dim(`, unsealed since ${d.started}`)}`
    );
    console.log(dim('    Not in the ledger until the session is finished in the panel.'));
  }

  const { drift } = derived;
  if (drift.design.length || drift.sources.length) {
    console.log(`\n  ${dim('DRIFT — spec ahead of its sources')}`);
    for (const d of drift.design)
      console.log(`  ${yellow(d.screen)}: no design yet${d.proposal ? ' (proposal on file)' : ''}` +
        `${d.requests.length ? dim(` — request ${d.requests.join(', ')} open`) : red(' — no design request filed')}`);
    for (const s of drift.sources)
      console.log(`  ${yellow(s.rule)} ← ${s.origin} ${dim('(source docs not yet updated)')}`);
  }

  const active = listThreads(blueprint);
  if (active.length) {
    console.log(`\n  ${dim('ACTIVE THREADS')}`);
    for (const t of active.slice(0, 6))
      console.log(
        `  ${t.id} ${paintStatus(t.status)} ${dim(`(${anchorLabel(t.anchor)})`)} — ${truncate(t.body, 60)}`
      );
    if (active.length > 6) console.log(dim(`  +${active.length - 6} more — walkdown threads`));
  }
  return end(counts.fail ? 1 : 0);
}

const STATUS_COLOR = { open: yellow, answered: yellow, addressed: green, incorporated: green, verified: green, waived: dim };
const paintStatus = (s) => (STATUS_COLOR[s] ?? ((x) => x))(s);

/*
 * The shortest true thing about where a thread is anchored, for a digest line.
 * A rule is the usual answer, but the ownership rules ask for design requests
 * anchored to a SCREEN and nothing else - and reading those back as
 * "unanchored" said the opposite of what filing one means.
 */
function anchorLabel(a = {}) {
  if (a.rule) return a.rule;
  if (a.element) return a.element;
  if (a.screen) return `screen ${a.screen}`;
  return 'unanchored';
}

function anchorText(a = {}) {
  return [a.rule && `rule ${a.rule}`, a.screen && `screen ${a.screen}`, a.element && `element ${a.element}`]
    .filter(Boolean)
    .join(' · ') || '(unanchored)';
}

function cmdThreads(args) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      rule: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  const blueprint = loadOrExit(values.dir);
  const threads = listThreads(blueprint, { rule: values.rule, all: values.all });

  if (values.json) {
    console.log(JSON.stringify(threads, null, 2));
    return end(0);
  }
  if (!threads.length) {
    console.log(values.all ? 'No threads.' : 'No active threads. (--all includes resolved ones.)');
    return end(0);
  }
  console.log(dim(`walkdown threads — ${threads.length} ${values.all ? 'total' : 'active'}\n`));
  for (const t of threads) {
    const firstLine = String(t.body ?? '').trim().split('\n')[0];
    console.log(`  ${t.id}  ${t.kind.padEnd(8)} ${paintStatus(String(t.status).padEnd(12))} ${dim(anchorText(t.anchor))}`);
    console.log(`      ${firstLine.length > 100 ? firstLine.slice(0, 97) + '…' : firstLine}\n`);
  }
  console.log(dim('  walkdown thread <id> shows a thread in full'));
  return end(0);
}

function cmdThread(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      json: { type: 'boolean', default: false },
      reply: { type: 'string' },
      status: { type: 'string' },
      verify: { type: 'boolean', default: false },
      reopen: { type: 'boolean', default: false },
      waive: { type: 'boolean', default: false },
      reason: { type: 'string' },
      actor: { type: 'string' },
    },
    allowPositionals: true,
  });
  const id = positionals[0];
  if (!id) {
    console.error('Usage: walkdown thread <id> [--reply <text>] [--status <s>|--verify|--reopen|--waive] [--reason <text>] [--actor <name>]');
    process.exit(2);
  }
  let blueprint = loadOrExit(values.dir);

  const actor = values.actor ?? process.env.WALKDOWN_ACTOR ?? userInfo().username;
  const status = values.verify ? 'verified' : values.reopen ? 'open' : values.waive ? 'waived' : values.status;
  const mutating = Boolean(values.reply || status);
  // What it was before we touched it, so the command can say what it changed
  // rather than only what the thread now happens to say.
  const was = mutating ? getThread(blueprint, id) : null;
  if (mutating) {
    try {
      if (values.reply) replyToThread(blueprint, id, { author: actor, body: values.reply });
      if (status) transitionThread(blueprint, id, { status, actor, reason: values.reason });
    } catch (err) {
      console.error(err.message);
      process.exit(2);
    }
    blueprint = loadBlueprint(blueprint.dir);
  }

  const t = getThread(blueprint, id);
  if (!t) {
    console.error(`No thread "${id}". \`walkdown threads --all\` lists every thread.`);
    process.exit(2);
  }
  if (values.json) {
    console.log(JSON.stringify(t, null, 2));
    return end(0);
  }
  /*
   * A command that changed something reports the change, not the thread.
   * Printing the whole conversation back was right for a bare `walkdown
   * thread <id>` - that IS the ask - but after a mutation it buries the one
   * fact the caller needs, and a loop over five threads scrolls the answer off
   * the screen. Worse, it reads identically whether or not anything happened,
   * which is what drove people to chase it with a second command to check.
   */
  if (mutating) {
    const added = (t.replies ?? []).length - (was?.replies ?? []).length;
    const parts = [];
    if (status) {
      parts.push(`${was?.status ?? '?'} → ${paintStatus(t.status)}`);
      if (t.status === 'waived' && t.waived_by) parts.push(`by ${t.waived_by}`);
    } else {
      parts.push(`still ${paintStatus(t.status)}`);
    }
    if (added > 0) parts.push(`+${added} ${added === 1 ? 'reply' : 'replies'}`);
    console.log(`✓ ${t.id} ${parts.join(' · ')}`);
    console.log(dim(`  ${anchorText(t.anchor)}`));
    console.log(dim(`  walkdown thread ${t.id} reads it in full`));
    return end(0);
  }
  console.log(`${t.id} · ${t.kind} · ${paintStatus(t.status)}${t.status === 'waived' && t.waived_by ? dim(` by ${t.waived_by}`) : ''}`);
  console.log(dim(`  ${anchorText(t.anchor)}`));
  console.log(dim(`  ${t.author ?? 'unknown'} · ${t.created ?? 'undated'}`));
  console.log(`\n  ${String(t.body ?? '').trim().replace(/\n/g, '\n  ')}`);
  for (const r of t.replies ?? []) {
    console.log(dim(`\n  ↳ ${r.author ?? 'unknown'} · ${r.created ?? 'undated'}`));
    console.log(`    ${String(r.body ?? '').trim().replace(/\n/g, '\n    ')}`);
  }
  return end(0);
}

async function cmdInit(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, force: { type: 'boolean', default: false } },
  });
  const { scaffold } = await import('../lib/init.js');
  const results = scaffold(values.dir ?? process.cwd(), { force: values.force });
  const MARK = {
    created: green('+ created'),
    updated: green('~ updated'),
    'pointer-appended': green('+ appended'),
    'up-to-date': dim('· up to date'),
    kept: dim('· kept'),
    'kept-differs': yellow('! kept (differs from packaged — --force to update)'),
  };
  for (const r of results) console.log(`  ${MARK[r.action] ?? r.action}  ${r.path}`);
  if (results.every((r) => r.action === 'created' || r.action === 'pointer-appended')) {
    console.log(`\nNext: fill in ${dim('blueprint/walkdown.yml')} (runner commands, targets), sketch your`);
    console.log(`first feature from ${dim('blueprint/features/_template.yml')}, then \`walkdown lint\`.`);
  }
}

async function cmdRun(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, target: { type: 'string' }, rule: { type: 'string' } },
  });
  const blueprint = loadOrExit(values.dir);
  const { runChecks } = await import('../lib/run-cmd.js');
  const before = new Set(
    existsSync(join(blueprint.dir, 'runs')) ? readdirSync(join(blueprint.dir, 'runs')) : []
  );
  let result;
  try {
    result = runChecks(blueprint, { target: values.target ?? 'local', rule: values.rule });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const after = existsSync(join(blueprint.dir, 'runs')) ? readdirSync(join(blueprint.dir, 'runs')) : [];
  const recorded = after.filter((f) => !before.has(f) && f.endsWith('.json'));
  if (recorded.length)
    console.log(`\n${green('recorded')}: ${recorded.join(', ')} — \`walkdown status\` for the picture`);
  else
    console.log(`\n${yellow('no run record was written')} — is the walkdown reporter/formatter wired into the test config?`);
  process.exit(result.code);
}

async function cmdServe(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, port: { type: 'string' } },
  });
  const blueprint = loadOrExit(values.dir);
  const { startServe } = await import('../lib/serve.js');
  const { port } = await startServe(blueprint.dir, {
    port: values.port ? Number(values.port) : undefined,
  });
  console.log(`walkdown serve — ${blueprint.dir}`);
  console.log(`  review:  http://localhost:${port}/`);
  // The embed, not the panel. The panel needs a page to frame and a page cannot
  // frame itself, so it arrives by extension or from the review page above.
  console.log(`  in your app:  <script src="http://localhost:${port}/embed.js" data-walkdown data-bp="blueprint"></script>`);
  console.log(dim('  Ctrl-C to stop'));
}

const [cmd, ...rest] = process.argv.slice(2);

/*
 * Declare a sweep. The only thing in walkdown that writes one - checks runs,
 * walkdowns and blueprint edits never do, because putting every rule back on
 * the queue is a decision and not a consequence.
 */
function cmdSweep(args) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      target: { type: 'string' },
      tiers: { type: 'string' },
      why: { type: 'string' },
    },
  });
  const blueprint = loadOrExit(values.dir);
  const tiers = (values.tiers ?? 'checks,agent')
    .split(',').map((t) => t.trim()).filter(Boolean);
  const bad = tiers.filter((t) => !['checks', 'agent', 'human'].includes(t));
  if (bad.length) {
    console.error(`${red('unknown tier')}: ${bad.join(', ')} — expected checks, agent or human`);
    return end(1);
  }
  if (!values.why?.trim()) {
    console.error(`${red('a sweep needs a reason')} — pass --why "…"`);
    console.error(dim('  It puts every rule back on the queue; the marker is what tells a'));
    console.error(dim('  later reader whether that was warranted.'));
    return end(1);
  }
  const targets = Object.keys(blueprint.config?.runner?.targets ?? {});
  const target = values.target ?? targets[0] ?? 'local';
  const { file, record } = writeSweep({
    blueprintDir: blueprint.dir,
    target,
    tiers,
    why: values.why,
    actor: process.env.WALKDOWN_ACTOR ?? userInfo().username,
  });
  console.log(`${green('swept')} ${record.run_id} — ${tiers.join(', ')} on ${target}`);
  console.log(dim(`  ${record.why}`));
  console.log(dim(`  ${file}`));
  console.log(`\nEvery ${tiers.join('/')} verdict recorded before now reads as stale.`);
  console.log(dim('Nothing was deleted. `walkdown status` says what is still owed.'));
  return end(0);
}

if (cmd === 'init') cmdInit(rest);
else if (cmd === 'run') cmdRun(rest);
else if (cmd === 'lint') cmdLint(rest);
else if (cmd === 'status') cmdStatus(rest);
else if (cmd === 'hash') cmdHash(rest);
else if (cmd === 'sweep') cmdSweep(rest);
else if (cmd === 'threads') cmdThreads(rest);
else if (cmd === 'thread') cmdThread(rest);
else if (cmd === 'serve') cmdServe(rest);
else if (cmd === 'claims') cmdClaims(rest);
else {
  console.log(HELP);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 2 : 0);
}
