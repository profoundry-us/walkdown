import { parseArgs } from 'node:util';
import { checkedRuleIds } from '../../lib/checks.js';
import { listDrafts } from '../../lib/draft.js';
import { defaultActor } from '../../lib/identity.js';
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
import { whenIn } from '../../lib/time.js';
import { eachOrExit, end, sectionHead } from './context.js';

function renderRuleDetail(blueprint, derived, ruleId, json, emit) {
  // Stamps are UTC on disk and the reader's clock on screen (n-0290).
  const zone = defaultActor(blueprint.codeRoot ?? blueprint.projectRoot).timezone;
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
        emit({ ...gone, state: 'retired' });
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
    emit(row);
    return end(exitCode);
  }

  const verdictWord = { pass: green('verified'), fail: red('failing'), pending: yellow('pending') }[
    row.verdict
  ];
  console.log(`${row.rule} · ${verdictWord}`);
  console.log(`  ${row.statement ?? dim('(no statement)')}`);
  if (row.because) console.log(`  ${dim('because')} ${row.because}`);
  if (row.history) console.log(`  ${dim('history')} ${row.history}`);
  console.log(
    dim(
      `  story ${row.story} · verify ${row.verify.join(', ') || 'nothing'}` +
        ` · signed by ${row.acceptance.map((a) => a.role).join(', ')}` +
        ` · screens ${row.screens.join(', ') || '—'}`,
    ),
  );

  // given and when read as prose; then is the list of things to look for.
  if (row.steps) {
    console.log(`\n  ${dim('STEPS')}`);
    for (const [phase, items] of Object.entries(row.steps)) {
      if (phase === 'then') {
        console.log(`    ${dim('then')}`);
        for (const step of items) console.log(`      - ${step}`);
      } else console.log(`    ${dim(phase.padEnd(6))}${items.join(' ')}`);
    }
  }

  console.log(`\n  ${dim('EVIDENCE')}`);
  const sources = [
    ...derived.targets.map((t) => [`checks/${t}`, row.cells[t]]),
    ['agent', row.agent],
  ].filter(([, cell]) => cell.state !== 'na');
  for (const [label, cell] of sources) {
    const state = (paint[cell.state] ?? ((s) => s))(cellText(cell));
    const provenance = cell.runId
      ? dim(`  ${cell.runId}${cell.created ? ` · ${whenIn(cell.created, zone)}` : ''}`)
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
    // Who accepted, and - when somebody else drove the walk - who typed it.
    // Both, because "signed by sam" and "signed by sam, recorded by topher"
    // are different claims and only one of them is sam's own doing (q-0225).
    const who = a.signer ?? a.actor;
    const by = who ? ` by ${who}${a.recordedBy ? `, recorded by ${a.recordedBy}` : ''}` : '';
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
      blueprint: { type: 'string' },
      target: { type: 'string' },
      json: { type: 'boolean', default: false },
      retired: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  let each = eachOrExit(values.blueprint);
  const ruleId = positionals[0];
  /*
   * One rule asked after, among several blueprints: it lives in one of them,
   * and that one answers alone - a rule's page is not a report to section.
   */
  if (ruleId && each.length > 1) {
    const knows = ({ blueprint }) =>
      deriveStatus(blueprint, {}).rows.some((r) => r.rule === ruleId) ||
      retiredRules(blueprint).some((r) => r.rule === ruleId);
    const holding = each.filter(knows);
    if (holding.length) each = holding.length === 1 ? [{ ...holding[0], several: false }] : holding;
  }
  const several = each.length > 1;
  /*
   * With several, the JSON answer is one object holding each blueprint's,
   * which is the single answer plus its id (ADR 0011 §2). A list - the
   * retired rules - rides under the name of what it is.
   */
  const answers = [];
  let worst = 0;
  each.forEach(({ id, blueprint }, i) => {
    const emit = several
      ? (obj) => answers.push(Array.isArray(obj) ? { id, retired: obj } : { id, ...obj })
      : (obj) => console.log(JSON.stringify(obj, null, 2));
    if (several && !values.json) console.log(`${i ? '\n' : ''}${sectionHead(id)}\n`);
    process.exitCode = 0;
    report(blueprint, values, ruleId, emit);
    worst = Math.max(worst, Number(process.exitCode ?? 0));
  });
  if (several && values.json) console.log(JSON.stringify({ blueprints: answers }, null, 2));
  return end(worst);
}

/* One blueprint's status, printed, or handed to `emit` as JSON. */
function report(blueprint, values, ruleId, emit) {
  if (values.retired) {
    const gone = retiredRules(blueprint);
    if (values.json) {
      emit(gone);
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

  if (ruleId) return renderRuleDetail(blueprint, derived, ruleId, values.json, emit);

  // Sittings that are underway but not yet sealed. They are not verdicts and
  // never count as any, but a queue that hides them tells you to go judge what
  // someone is judging right now.
  const drafts = listDrafts(blueprint.at.drafts.path);

  if (values.json) {
    // `sweeps` rides along because the JSON is the surface agents read
    // (blueprint/AGENTS.md), and it was the one place an open sweep - its
    // date, its reason, what it still owes - could not be seen at all.
    emit({
      targets,
      rows,
      drift: derived.drift,
      attention: derived.attention,
      sweeps: derived.sweeps,
      drafts,
      activeThreads: listThreads(blueprint),
    });
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const verifyParts = (i) => {
    const requests = i.requests?.length ?? 0;
    const yours = i.threads.length - requests;
    return [
      ...(yours ? [`${plural(yours, 'note')} of yours answered`] : []),
      ...(requests ? [`${plural(requests, 'design request')} drawn`] : []),
    ].join(', ');
  };

  const HOWTO = {
    // Named, because "needs a human" was never the question - the question is
    // whether it needs PRODUCT or engineering, and a queue that cannot say
    // which is a queue two people both scroll past.
    judge: (i) =>
      i.after
        ? `walk down ${i.rule} again — ${i.role ?? 'nobody'} sent it back, and the fix ${i.after} claims is judged`
        : i.unbuilt
          ? `approve the wording of ${i.rule} — not built yet, and ${i.role ?? 'nobody'} has not approved it`
          : `walk down ${i.rule} — ${i.role ?? 'nobody'} has not accepted it yet`,
    // Per rule when the notes have one (ADR 0005 §6): the look that clears
    // them is a verdict on the rule, so the item says which rule to walk and
    // what waits there - your own notes answered, and any design request
    // drawn, whoever filed it (n-0338).
    verify: (i) =>
      i.threads
        ? `walk down ${i.rule} — ${verifyParts(i)}` +
          dim(` (${i.threads.join(', ')})`) +
          (i.unjudged ? yellow(' — a fix nothing has judged yet') : '')
        : `verify ${i.thread} — ` +
          (i.unjudged
            ? yellow('fix claimed, but nothing has judged it yet')
            : 'fix claimed, awaiting your judgment'),
    // Per rule when the questions have one, like verify: the ask is on the
    // rule's own screen, one at a time, so the item names the rule and how
    // many it asks.
    answer: (i) =>
      i.threads
        ? `answer ${i.rule} — ${i.threads.length} question${i.threads.length === 1 ? '' : 's'}` +
          dim(` (${i.threads.join(', ')})`)
        : `answer ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''}`,
    address: (i) => `address ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — open note`,
    incorporate: (i) =>
      `incorporate ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — answered, fold it into the rule`,
    cover: (i) => `cover ${i.rule} — demands checks, and no check claims it`,
    'judge-first': (i) =>
      `judge ${i.rule} — ${
        i.state === 'stale'
          ? 'the agent verdict on it is stale, and no signer is asked until it is judged again'
          : i.state === 'fail'
            ? 'the agent failed it and no open note says why, so no signer is asked until it is judged again'
            : 'the agent tier has never judged it, and no signer is asked until it has'
      }`,
    rejudge: (i) =>
      `judge ${i.rule} again — ${i.thread} claims a fix newer than the ${i.after === 'fail' ? 'failing' : 'passing'} verdict`,
    // The machine's own observation, addressed by the machine: it closes it
    // itself. Missing from this table for a day, so the queue crashed the
    // moment one existed (2026-09-21).
    settle: (i) =>
      `settle ${i.thread}${i.rule ? dim(` (${i.rule})`) : ''} — a note you wrote, addressed; close it`,
    // A design request (ADR 0009): design's to draw, never the building agent's.
    draw: (i) =>
      `draw ${i.screen ?? i.rule ?? 'what it asks for'} — design request ${i.thread}${i.rule && i.screen ? dim(` (${i.rule})`) : ''}`,
  };
  /*
   * Design's queue says who design is, from the blueprint's design.by: a
   * designer is a person and reads it like one; a design agent is never the
   * agent building the app, so it is not the AGENT QUEUE.
   */
  const designTitle = derived.attention.some((i) => i.who === 'design' && i.by === 'agent')
    ? 'DESIGN QUEUE — for the design agent, never the agent building the app'
    : 'DESIGN QUEUE — for the designer';
  for (const [who, title] of [
    ['human', 'NEEDS A HUMAN'],
    ['design', designTitle],
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
  const active = listThreads(blueprint);
  // A request that has not ended is still live, open or not; say which, so
  // this line never calls "open" what ACTIVE THREADS below calls addressed.
  const statusOf = new Map(active.map((t) => [t.id, t.status]));
  const requestLabel = (id) => `${id} ${statusOf.get(id) ?? 'open'}`;
  if (drift.design.length || drift.sources.length) {
    console.log(`\n  ${dim('DRIFT — spec ahead of its sources')}`);
    for (const d of drift.design)
      console.log(
        `  ${yellow(d.screen)}: no design yet${d.proposal ? ' (proposal on file)' : ''}` +
          `${d.requests.length ? dim(` — request ${d.requests.map(requestLabel).join(', ')}`) : red(' — no design request filed')}`,
      );
    /*
     * One line, not one per rule. Every rule born of a thread or of walkdown
     * itself is listed, nothing ever clears one, and on this project the list
     * ran to 139 lines that buried the rest of the report (2026-09-23). The
     * rules are in `status --json` under drift.sources for whoever updates
     * the source documents.
     */
    if (drift.sources.length)
      console.log(
        `  ${drift.sources.length} rule${drift.sources.length === 1 ? '' : 's'} came from threads or from walkdown rather than a PRD or the design` +
          dim(' — the source documents may not say so yet (status --json lists them)'),
      );
  }

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
