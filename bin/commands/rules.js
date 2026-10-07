import { parseArgs } from 'node:util';
import { nameOf, projectIdsAt, resolveLocations } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { applyMove, planMove } from '../../lib/rules-move.js';
import { applyRename, planRename } from '../../lib/rules-rename.js';
import { end, namedOrExit } from './context.js';
import { dispatch } from './noun.js';

/*
 * `walkdown rules move <rule|story|feature> --to <blueprint>` (ADR 0013 §5).
 *
 * The rules, their threads and the history behind their verdicts go to
 * another blueprint of the same project. Which blueprint they come from is
 * named with `--blueprint`, as every write names its blueprint
 * (locations.several.writes-name-one).
 */
function move(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      to: { type: 'string' },
      blueprint: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const what = positionals;
  if (!what.length || !values.to) {
    console.error(
      'walkdown rules move <rule|story|feature>... --blueprint <from> --to <blueprint> [--dry-run]',
    );
    return end(2);
  }
  const from = namedOrExit(values.blueprint, 'rules move');

  // Every blueprint of the project, wherever in it this is run.
  const project = projectIdsAt()
    // By the name an ID ends with: the ID is this machine's, and what a move
    // writes - `copied_from` - is read on every machine (ADR 0014 §2).
    .map((full) => ({
      id: nameOf(full),
      full,
      dir: resolveLocations({ blueprint: full }).spec?.path,
    }))
    .filter((b) => b.dir);
  if (project.length < 2) {
    console.error(red('This project has one blueprint, so there is nowhere to move rules to.'));
    console.error(dim('`walkdown blueprints new <name>` gives it another.'));
    return end(2);
  }
  const named = (b, want) => b.id === want || b.full === want;
  const to = project.find((b) => named(b, values.to));
  if (!to) {
    console.error(
      red(
        `✗ \`${values.to}\` is not a blueprint of this project — a rule moves only between blueprints of one project (${project.map((b) => b.id).join(', ')})`,
      ),
    );
    console.error(dim('Nothing was moved.'));
    return end(2);
  }
  const holders = project.filter((b) => named(b, from));
  if (holders.length !== 1) {
    console.error(
      red(
        `✗ \`${from}\` is not a blueprint of this project (${project.map((b) => b.id).join(', ')}). Nothing was moved.`,
      ),
    );
    return end(2);
  }

  const plan = planMove({ from: holders[0], to, what, project });
  if (plan.refusals.length) {
    for (const r of plan.refusals) console.error(red(`✗ ${r}`));
    console.error(dim('Nothing was moved.'));
    return end(2);
  }
  const lines = [
    `${plan.rules.length} rule(s) from \`${plan.from.id}\` to \`${plan.to.id}\`: ${plan.rules.join(', ')}`,
    `${plan.threads.length} thread(s) moved, keeping their ids${plan.threads.length ? `: ${plan.threads.map((t) => t.id).join(', ')}` : ''}`,
    `${plan.runs.length} run record(s) copied, holding only these rules' results, and ${plan.sweeps.length} sweep(s)`,
    `${plan.evidence.length} piece(s) of evidence copied under the same keys`,
  ];
  if (values['dry-run']) {
    console.log(`Would move ${lines.join('\n  ')}`.replace('Would move ', 'Would move:\n  '));
    console.log(
      dim(
        `\nNothing was changed. Without --dry-run, ${plan.from.id}'s run records stay as they are; the copies say where they came from.`,
      ),
    );
    return end(0);
  }
  applyMove(plan);
  console.log(`${green('✓ moved')} ${lines.join('\n  ')}`);
  console.log(
    dim(
      `\n${plan.from.id}'s run records are unchanged. \`walkdown status --blueprint ${plan.to.id}\` shows the moved rules with the verdicts they had.`,
    ),
  );
  return end(0);
}

/*
 * `walkdown rules rename <rule> <new-id>` (ADR 0014). The old id stays on the
 * rule as `formerly:`, so every verdict, thread and tag that names it still
 * means this rule.
 */
function rename(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { blueprint: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
  });
  const [from, to] = positionals;
  if (!from || !to || positionals.length !== 2) {
    console.error('walkdown rules rename <rule> <new-id> --blueprint <id> [--dry-run]');
    return end(2);
  }
  const here = resolveLocations({ blueprint: namedOrExit(values.blueprint, 'rules rename') });
  if (here.ambiguous) {
    console.error(
      red(
        `✗ ${here.config.registry.why ?? `\`${values.blueprint}\` names more than one blueprint`}`,
      ),
    );
    return end(2);
  }
  const project = here.spec?.path ? [{ id: here.id, dir: here.spec.path }] : [];
  if (!project.length) {
    console.error(red(`✗ ${here.spec?.why ?? 'no blueprint here'}`));
    return end(2);
  }
  const plans = project.map((b) => ({ b, plan: planRename({ specDir: b.dir, from, to }) }));
  const holders = plans.filter((p) => p.plan.hit);
  if (holders.length !== 1) {
    console.error(
      red(
        holders.length
          ? `✗ \`${from}\` is in ${holders.map((p) => `\`${p.b.id}\``).join(' and ')} — choose one with \`--blueprint <id>\` (e.g. \`--blueprint ${holders[0].b.id}\`).`
          : `✗ no rule \`${from}\` in ${project.map((b) => `\`${b.id}\``).join(', ')}`,
      ),
    );
    console.error(dim('Nothing was renamed.'));
    return end(2);
  }
  const { plan, b } = holders[0];
  if (plan.refusals.length) {
    for (const r of plan.refusals) console.error(red(`✗ ${r}`));
    console.error(dim('Nothing was renamed.'));
    return end(2);
  }
  const lines = [
    `\`${from}\` → \`${to}\` in ${b.id}, keeping \`${from}\` under \`formerly:\``,
    `${plan.threads.length} thread(s) anchored to the new id${plan.threads.length ? `: ${plan.threads.map((t) => t.id).join(', ')}` : ''}`,
  ];
  if (values['dry-run']) {
    console.log(`Would rename:\n  ${lines.join('\n  ')}`);
    console.log(dim('\nNothing was changed.'));
    return end(0);
  }
  applyRename(plan);
  console.log(`${green('✓ renamed')} ${lines.join('\n  ')}`);
  console.log(
    dim(
      `\nNo run record was edited; they still say \`${from}\` and count for \`${to}\`. Tests tagged \`${from}\` still count, and lint names them so the tag can be updated.`,
    ),
  );
  return end(0);
}

export const VERBS = {
  move: {
    usage:
      'walkdown rules move <rule|story|feature>... --blueprint <from> --to <blueprint> [--dry-run]',
    about:
      "Move rules to another blueprint of the same project, with their threads. The run\nrecords and evidence behind their verdicts are copied, so nothing is judged or signed\nagain, and the source's records are never edited. --dry-run says what would move.",
    run: move,
  },
  rename: {
    usage: 'walkdown rules rename <rule> <new-id> --blueprint <id> [--dry-run]',
    about:
      'Give a rule a new id. The old id stays on the rule under `formerly:`, so the run\nrecords, threads and tests that name it still count for it, and no verdict is lost.\nIts threads are anchored to the new id. --dry-run says what would change.',
    run: rename,
  },
};

export const run = (args) => dispatch('rules', VERBS, args);
