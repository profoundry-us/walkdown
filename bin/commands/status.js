import { parseArgs } from 'node:util';
import { checkedRuleIds } from '../../lib/checks.js';
import { listDrafts } from '../../lib/draft.js';
import {
  ACCEPT_MARK,
  acceptanceCell,
  cellText,
  formatThreads,
  paint,
  tierText,
} from '../../lib/report/status.js';
import { anchorLabel, paintStatus } from '../../lib/report/threads.js';
import { dim, green, red, truncate, yellow } from '../../lib/report/tty.js';
import { deriveStatus, retiredRules } from '../../lib/status.js';
import { listThreads } from '../../lib/threads.js';
import { end, loadOrExit } from './context.js';

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
      if (json) {
        console.log(JSON.stringify({ ...gone, state: 'retired' }, null, 2));
        return end(0);
      }
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

  const verdictWord = { pass: green('verified'), fail: red('failing'), pending: yellow('pending') }[
    row.verdict
  ];
  console.log(`${row.rule} · ${verdictWord}`);
  console.log(`  ${row.statement ?? dim('(no statement)')}`);
  console.log(
    dim(
      `  story ${row.story} · verify ${row.verify.join(', ') || 'nothing'}` +
        ` · signed by ${row.acceptance.map((a) => a.role).join(', ')}` +
        ` · screens ${row.screens.join(', ') || '—'}`,
    ),
  );

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
  ].filter(([, cell]) => cell.state !== 'na');
  for (const [label, cell] of sources) {
    const state = (paint[cell.state] ?? ((s) => s))(cellText(cell));
    const provenance = cell.runId
      ? dim(`  ${cell.runId}${cell.created ? ` · ${cell.created}` : ''}`)
      : '';
    console.log(`    ${label.padEnd(15)}${state}${provenance}`);
    if (cell.detail) console.log(dim(`                   ${truncate(cell.detail, 90)}`));
    if (cell.evidence?.length)
      console.log(dim(`                   evidence: ${cell.evidence.join(', ')}`));
  }
  /*
   * The excuses, in full, under the evidence that is missing because of them.
   * A tier is absent for one of two reasons and only one of them is a
   * decision - so the reason is printed where the verdict would have been,
   * whole rather than truncated. An excuse nobody can read is one nobody can
   * argue with, which is the entire point of writing it down.
   */
  for (const [tier, why] of Object.entries(row.excuses ?? {})) {
    console.log(`    ${tier.padEnd(15)}${dim('· excused')}`);
    console.log(dim(`                   ${why}`));
  }

  /*
   * Acceptance, one line per role. Both halves matter: who has signed, and who
   * has not - a rule waiting on product and a rule waiting on nobody look
   * identical if only the signatures are listed.
   */
  console.log(`\n  ${dim('ACCEPTANCE')}`);
  for (const a of row.acceptance) {
    const [glyph, colour] = ACCEPT_MARK[a.state] ?? ['?', yellow];
    const label =
      {
        signed: 'signed',
        approved: 'approved the wording',
        'sent-back': 'sent back',
        stale: 'signed an older wording',
        none: 'not yet',
      }[a.state] ?? a.state;
    const by = a.actor ? ` by ${a.actor}` : '';
    const provenance = a.runId ? dim(`  ${a.runId}${a.created ? ` · ${a.created}` : ''}`) : '';
    console.log(`    ${a.role.padEnd(15)}${colour(`${glyph} ${label}${by}`)}${provenance}`);
    if (a.detail) console.log(dim(`                   ${truncate(a.detail, 90)}`));
  }

  const threads = listThreads(blueprint, { rule: ruleId, all: true });
  if (threads.length) {
    console.log(`\n  ${dim('THREADS')}`);
    for (const t of threads)
      console.log(`    ${t.id} ${paintStatus(t.status)} — ${truncate(t.body, 70)}`);
  }
  return end(exitCode);
}

export function run(args) {
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
    if (values.json) {
      console.log(JSON.stringify(gone, null, 2));
      return end(0);
    }
    if (!gone.length) {
      console.log('No retired rules.');
      return end(0);
    }
    console.log(dim(`retired rules — ${blueprint.dir}\n`));
    for (const r of gone) console.log(`  ${yellow(r.rule)}\n    ${r.retired}\n`);
    console.log(dim(`${gone.length} rule(s) withdrawn. Their verdicts stay in the ledger.`));
    return end(0);
  }
  const derived = deriveStatus(blueprint, {
    target: values.target,
    checkRefs: checkedRuleIds(blueprint.config, blueprint.codeRoot ?? blueprint.projectRoot),
  });
  const { targets, rows } = derived;

  if (positionals[0]) return renderRuleDetail(blueprint, derived, positionals[0], values.json);

  // Sittings that are underway but not yet sealed. They are not verdicts and
  // never count as any, but a queue that hides them tells you to go judge what
  // someone is judging right now.
  const drafts = listDrafts(blueprint.dir);

  if (values.json) {
    // `sweeps` rides along because the JSON is the surface agents read
    // (blueprint/AGENTS.md), and it was the one place an open sweep - its
    // date, its reason, what it still owes - could not be seen at all.
    console.log(
      JSON.stringify(
        {
          targets,
          rows,
          drift: derived.drift,
          attention: derived.attention,
          sweeps: derived.sweeps,
          drafts,
          activeThreads: listThreads(blueprint),
        },
        null,
        2,
      ),
    );
    return end(rows.some((r) => r.verdict === 'fail') ? 1 : 0);
  }

  const verdictMark = { pass: green('✓'), fail: red('✗'), pending: dim('○') };

  /*
   * ACCEPTED rather than HUMAN, because the column no longer holds a person's
   * walkdown - it holds every role the rule names and what each has said. The
   * header changed with the meaning on purpose: a column called HUMAN that had
   * quietly become something else is how a report starts being misread.
   */
  const headers = [
    '',
    'RULE',
    ...targets.map((t) => t.toUpperCase()),
    'AGENT',
    'ACCEPTED',
    'THREADS',
  ];
  const table = rows.map((r) => [
    verdictMark[r.verdict],
    r.rule,
    ...targets.map((t) => ({ text: tierText(r, 'checks', r.cells[t]), state: r.cells[t].state })),
    { text: tierText(r, 'agent', r.agent), state: r.agent.state },
    acceptanceCell(r.acceptance),
    formatThreads(r.threads),
  ]);

  const plain = (c) => (typeof c === 'string' ? c : c.text);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...table.map((row) => [...plain(row[i])].length)),
  );
  const renderCell = (c, i) => {
    const text = plain(c);
    const pad = ' '.repeat(Math.max(0, widths[i] - [...text].length));
    if (typeof c === 'string') return text + pad;
    // A cell can be painted as a whole (one state) or piecewise (the roles,
    // which disagree with each other by design).
    if (c.parts) return c.parts.map(([s, colour]) => colour(s)).join('') + pad;
    return (paint[c.state] ?? ((s) => s))(text + pad);
  };

  console.log(dim(`walkdown status — ${blueprint.dir}\n`));
  console.log('  ' + headers.map((h, i) => dim(h.padEnd(widths[i]))).join('  '));
  for (const row of table) console.log('  ' + row.map(renderCell).join('  '));

  const counts = rows.reduce(
    (acc, r) => ((acc[r.verdict] = (acc[r.verdict] ?? 0) + 1), acc),
    /** @type {Record<string, number>} */ ({}),
  );
  const open = (derived.sweeps ?? []).filter((s) => s.done < s.of);
  console.log(
    `\n${counts.pass ?? 0} verified, ${counts.pending ?? 0} pending, ${counts.fail ?? 0} failing` +
      (open.length
        ? dim(` — ${open.map((s) => `${s.of - s.done} awaiting the ${s.tier} sweep`).join(', ')}`)
        : ''),
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
    console.log(
      dim(`  ${s.runId}${s.actor ? ` by ${s.actor}` : ''} — ${s.why ?? 'no reason recorded'}`),
    );
    /*
     * Every one of them, uncapped. A sweep's owed list IS the work - the rule
     * it answers says they are "listed as work, not merely counted" - and the
     * first version printed twelve and `+59 more`, which put fifty-nine rules
     * beyond reach of anyone reading the report. Nothing else in the report
     * carries them either: the attention queue has no action for a rule a
     * sweep put back on the board. A long list during a sweep is the honest
     * shape of a sweep.
     */
    for (const rule of s.owed) console.log(`  ◇ ${rule}`);
  }

  const HOWTO = {
    // Named, because "needs a human" was never the question - the question is
    // whether it needs PRODUCT or engineering, and a queue that cannot say
    // which is a queue two people both scroll past.
    judge: (i) => `walk down ${i.rule} — ${i.role ?? 'nobody'} has not accepted it yet`,
    verify: (i) =>
      `verify ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — fix claimed, awaiting your judgment`,
    answer: (i) => `answer ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''}`,
    address: (i) => `address ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — open note`,
    incorporate: (i) =>
      `incorporate ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — answered, fold it into the rule`,
    cover: (i) => `cover ${i.rule} — demands checks, and no check claims it`,
  };
  for (const [who, title] of [
    ['human', 'NEEDS A HUMAN'],
    ['agent', 'AGENT QUEUE'],
  ]) {
    const items = derived.attention.filter((i) => i.who === who);
    if (!items.length) continue;
    console.log(`\n  ${dim(title)}`);
    for (const i of items) console.log(`  ${yellow('◆')} ${HOWTO[i.action](i)}`);
  }

  for (const d of drafts) {
    const n = Object.keys(d.verdicts).length;
    console.log(
      `\n  ${yellow('◐')} walkdown in progress — ${n} rule${n === 1 ? '' : 's'} judged by ` +
        `${d.actor ?? 'someone'}${dim(`, unsealed since ${d.started}`)}`,
    );
    console.log(dim('    Not in the ledger until the session is finished in the panel.'));
  }

  const { drift } = derived;
  if (drift.design.length || drift.sources.length) {
    console.log(`\n  ${dim('DRIFT — spec ahead of its sources')}`);
    for (const d of drift.design)
      console.log(
        `  ${yellow(d.screen)}: no design yet${d.proposal ? ' (proposal on file)' : ''}` +
          `${d.requests.length ? dim(` — request ${d.requests.join(', ')} open`) : red(' — no design request filed')}`,
      );
    for (const s of drift.sources)
      console.log(`  ${yellow(s.rule)} ← ${s.origin} ${dim('(source docs not yet updated)')}`);
  }

  const active = listThreads(blueprint);
  if (active.length) {
    console.log(`\n  ${dim('ACTIVE THREADS')}`);
    for (const t of active.slice(0, 6))
      console.log(
        `  ${t.id} ${paintStatus(t.status)} ${dim(`(${anchorLabel(t.anchor)})`)} — ${truncate(t.body, 60)}`,
      );
    if (active.length > 6) console.log(dim(`  +${active.length - 6} more — walkdown threads`));
  }
  return end(counts.fail ? 1 : 0);
}
