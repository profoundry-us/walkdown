import { parseArgs } from 'node:util';
import { collectRules, excuseFor, signoffList, verifyList } from '../../lib/blueprint.js';
import { formatHash } from '../../lib/hash.js';
import { screenFlow } from '../../lib/status.js';
import { end, loadOrExit } from './context.js';

/*
 * The first step toward prompt-driven judging (docs/11-architecture.md,
 * "Where the agent tier goes next"; thread n-0128): assemble the prompt.
 *
 * A sitting hands the judging agent one rule at a time and lets it decide how
 * to earn the verdict, driving its own browser. Everything the agent needs to
 * start is already in the blueprint - the statement, the steps, the setup, the
 * screens with real addresses, where evidence goes and how a verdict is
 * recorded - and assembling that by hand is the mechanical half of judging.
 * This prints it, ready to paste into any agent with a browser. It judges
 * nothing itself: the prompt ends where the reader begins.
 *
 * Plain text on purpose - no colour, no decoration - so
 * `walkdown judge <rule> | pbcopy` is the whole workflow.
 */
export function run(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      target: { type: 'string', default: 'local' },
      serve: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const id = positionals[0];
  if (!id || positionals.length > 1) {
    console.error(
      'Usage: walkdown judge <rule-id> [--target <name>] [--serve <origin>] [--dir <blueprint>] [--json]',
    );
    process.exit(2);
  }
  const blueprint = loadOrExit(values.dir);
  const { config, storyboard } = blueprint;
  // The evidence path below is written to BY HAND from this printout, so a
  // fresh project's tentative home is made real before it is promised.

  const found = collectRules(blueprint.features).find(({ rule }) => rule?.id === id);
  if (!found) {
    console.error(`No rule "${id}". \`walkdown status\` lists every rule.`);
    process.exit(2);
  }
  const { rule, story } = found;

  if (rule.retired) {
    console.log(`${id} is retired — ${rule.retired}\nNothing to judge.`);
    return end(0);
  }
  const excuse = excuseFor(rule, 'agent');
  if (excuse) {
    console.log(`The agent tier is excused for ${id}:\n  ${excuse}\nNothing to judge by agent.`);
    return end(0);
  }

  const screens = storyboard?.screens ?? [];
  const byId = new Map(screens.map((s) => [s?.id, s]));
  const flow = screenFlow(rule, new Set(byId.keys()));
  const wanted = [...new Set([...flow, ...(rule.screens ?? [])])]
    .map((sid) => byId.get(sid))
    .filter(Boolean);

  const baseUrl = config?.runner?.targets?.[values.target]?.base_url ?? null;
  /*
   * The project's own governance (walkdown.yml `governance:`), carried into
   * every prompt verbatim. The built-in lines below cover what is true of any
   * blueprint; these cover what only the project knows - walkdown's own
   * blueprint, for instance, is written to by the very panel under review.
   */
  const governance = (Array.isArray(config?.governance) ? config.governance : [])
    .map((g) => String(g).trim())
    .filter(Boolean);
  const serve = (values.serve ?? `http://localhost:${config?.embed?.port ?? 4700}`).replace(
    /\/+$/,
    '',
  );
  const appUrl = (s) => (s.app?.path && baseUrl ? baseUrl + s.app.path : null);
  const protoUrl = (s) =>
    s.prototype ? serve + '/prototype' + s.prototype : s.proposal ? serve + '/proposals' + s.proposal : null;

  // The anchors the steps actually name: a dotted backtick token is an anchor
  // by the same convention lint resolves them under (lib/lint.js).
  const anchors = new Set();
  for (const phase of ['given', 'when', 'then'])
    for (const step of rule.steps?.[phase] ?? [])
      for (const m of String(step).matchAll(/`([A-Za-z0-9][A-Za-z0-9._-]*)`/g))
        if (m[1].includes('.')) anchors.add(m[1]);

  // A governance line arrives as one string; fold it to the block's width.
  const bullet = (text) => {
    const out = [];
    let line = '  -';
    for (const word of text.split(/\s+/)) {
      if (line.length + 1 + word.length > 96 && line.trim()) {
        out.push(line);
        line = '   ';
      }
      line += ` ${word}`;
    }
    out.push(line);
    return out;
  };

  const stamp = new Date()
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replaceAll(':', '-');
  const evidenceKey = `runs/evidence/${stamp}/`;
  const hash = rule.statement ? formatHash(rule.statement) : null;

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          rule: id,
          story: story?.id ?? null,
          statement: rule.statement ?? null,
          statement_hash: hash,
          verify: verifyList(rule),
          signoff: signoffList(rule),
          steps: rule.steps ?? null,
          screens: wanted.map((s) => ({
            id: s.id,
            title: s.title ?? null,
            prototype: protoUrl(s),
            proposed: Boolean(!s.prototype && s.proposal),
            app: appUrl(s),
            setup: s.app?.setup ?? null,
          })),
          anchors: [...anchors],
          target: values.target,
          base_url: baseUrl,
          serve,
          governance,
          evidence: { key_prefix: evidenceKey, resolved_root: blueprint.at.evidence.path },
          runs_dir: blueprint.at.runs.path,
        },
        null,
        2,
      ),
    );
    return end(0);
  }

  const lines = [];
  const say = (...l) => lines.push(...l);

  say(
    `You are judging one rule of the "${config?.project ?? 'walkdown'}" blueprint against the running system. Decide for yourself how to earn the verdict — navigate, look, and try to break it. You are producing evidence a person can trust, never their acceptance.`,
    '',
    `RULE ${id}`,
    rule.statement ?? '(no statement — the blueprint fails lint; judge nothing until it says what it means)',
  );

  for (const s of wanted)
    if (s.app?.setup) say('', `SETUP — ${s.id} is a state, not an address. On arrival:`, `  ${s.app.setup}`);

  if (rule.steps) {
    say('', 'STEPS');
    for (const phase of ['given', 'when', 'then'])
      for (const [i, step] of (rule.steps[phase] ?? []).entries())
        say(`  ${i === 0 ? phase.toUpperCase().padEnd(5) : '     '} ${step}`);
  }

  if (wanted.length) {
    say('', 'SCREENS (in step order; the last is where the outcome is observable)');
    for (const s of wanted) {
      say(`  ${s.id} — ${s.title ?? ''}`.trimEnd());
      const p = protoUrl(s);
      if (p)
        say(
          `    ${s.prototype ? 'prototype' : 'proposal '}  ${p}${s.prototype ? '' : '   (a sketch, not design authority — say so if you compare against it)'}`,
        );
      const a = appUrl(s);
      if (a) say(`    app        ${a}`);
      if (!p && !a) say('    (no address on either surface — reach it by hand and say how)');
    }
  } else {
    say(
      '',
      'SCREENS',
      '  No screen belongs to this rule — judge it by its checks and recorded behavior, not by looking.',
    );
  }

  if (anchors.size)
    say(
      '',
      `ANCHORS the steps name: ${[...anchors].join(', ')}`,
      '  (declared per screen in the storyboard; in pin mode, hovering highlights them)',
    );

  say(
    '',
    'EVIDENCE',
    `  Save screenshots and probe output under the logical key ${evidenceKey}`,
    `  which this machine resolves to ${blueprint.at.evidence.path}/${stamp}/`,
    '  Cite evidence by the logical key, never a filesystem path.',
    '',
    'VERDICT',
    `  Append one run record to ${blueprint.at.runs.path}/${stamp}-${values.target}-01.json:`,
    `  { "kind": "walkdown", "actor": "agent", "target": "${values.target}"${baseUrl ? `, "base_url": "${baseUrl}"` : ''},`,
    '    "results": [ { "rule", "status": "pass"|"fail", "statement_hash", "evidence": [<keys>],',
    '                   "reasoning": <one honest paragraph>, "threads": [<ids>] } ] }',
    ...(hash
      ? [`  statement_hash to stamp: ${hash} — valid only while the statement reads exactly as above.`]
      : []),
    '',
    'GOVERNANCE',
    '  - You claim work; a person accepts it. Never write "verified" or "waived" anywhere.',
    '  - A fail needs a note thread anchored to this rule citing the evidence; put its id in the result.',
    `  - The ledger is append-only: one new record, at the end, and no record ever edited.`,
    ...governance.flatMap(bullet),
  );

  console.log(lines.join('\n'));
  return end(0);
}
