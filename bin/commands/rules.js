import { parseArgs } from 'node:util';
import { nameOf, resolveLocations } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { applyMove, planMove } from '../../lib/rules-move.js';
import { applyRename, planRename } from '../../lib/rules-rename.js';
import { end } from './context.js';
import { dispatch } from './noun.js';

/*
 * `walkdown rules move <rule|story|feature> --to <blueprint>` (ADR 0013 §5).
 *
 * The rules, their threads and the history behind their verdicts go to
 * another blueprint of the same project. Which blueprint they come from is
 * the one that holds them, so `--blueprint` is only needed where two do.
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
    console.error('walkdown rules move <rule|story|feature>... --to <blueprint> [--dry-run] [--blueprint <from>]');
    return end(2);
  }

  const here = resolveLocations({});
  const project = (here.ambiguous ? here.config.registry.candidates : here.spec?.path ? [here.id] : [])
    // By the name an ID ends with: the ID is this machine's, and what a move
    // writes - `copied_from` - is read on every machine (ADR 0014 §2).
    .map((full) => ({ id: nameOf(full), full, dir: resolveLocations({ blueprint: full }).spec?.path }))
    .filter((b) => b.dir);
  if (project.length < 2) {
    console.error(red('This project has one blueprint, so there is nowhere to move rules to.'));
    console.error(dim('`walkdown blueprints new <name>` gives it another.'));
    return end(2);
  }
  const named = (b, want) => b.id === want || b.full === want;
  const to = project.find((b) => named(b, values.to));
  if (!to) {
    console.error(red(`✗ \`${values.to}\` is not a blueprint of this project — a rule moves only between blueprints of one project (${project.map((b) => b.id).join(', ')})`));
    console.error(dim('Nothing was moved.'));
    return end(2);
  }
  const holders = values.blueprint
    ? project.filter((b) => named(b, values.blueprint))
    : project.filter((b) => b.id !== to.id && planMove({ from: b, to, what, project }).picks.length === what.length);
  if (holders.length !== 1) {
    console.error(
      red(
        holders.length
          ? `\`${what.join(' ')}\` is in ${holders.map((b) => `\`${b.id}\``).join(' and ')} — choose the one to move it out of with \`--blueprint <from>\` (e.g. \`--blueprint ${holders[0].id}\`).`
          : `No one blueprint in this project holds all of ${what.map((w) => `\`${w}\``).join(', ')}.`,
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
    console.log(dim(`\nNothing was changed. Without --dry-run, ${plan.from.id}'s run records stay as they are; the copies say where they came from.`));
    return end(0);
  }
  applyMove(plan);
  console.log(`${green('✓ moved')} ${lines.join('\n  ')}`);
  console.log(dim(`\n${plan.from.id}'s run records are unchanged. \`walkdown status --blueprint ${plan.to.id}\` shows the moved rules with the verdicts they had.`));
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
    console.error('walkdown rules rename <rule> <new-id> [--dry-run] [--blueprint <id>]');
    return end(2);
  }
  const here = resolveLocations({ blueprint: values.blueprint ?? null });
  const project = values.blueprint
    ? here.spec?.path ? [{ id: here.id, dir: here.spec.path }] : []
    : (here.ambiguous ? here.config.registry.candidates : here.spec?.path ? [here.id] : [])
        // By the name an ID ends with: the ID is this machine's, and what a move
    // writes - `copied_from` - is read on every machine (ADR 0014 §2).
    .map((full) => ({ id: nameOf(full), full, dir: resolveLocations({ blueprint: full }).spec?.path }))
        .filter((b) => b.dir);
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
  console.log(dim(`\nNo run record was edited; they still say \`${from}\` and count for \`${to}\`. Tests tagged \`${from}\` still count, and lint names them so the tag can be updated.`));
  return end(0);
}

export const VERBS = {
  move: {
    usage: 'walkdown rules move <rule|story|feature>... --to <blueprint> [--dry-run] [--blueprint <from>]',
    about:
      "Move rules to another blueprint of the same project, with their threads. The run\nrecords and evidence behind their verdicts are copied, so nothing is judged or signed\nagain, and the source's records are never edited. --dry-run says what would move.",
    run: move,
  },
  rename: {
    usage: 'walkdown rules rename <rule> <new-id> [--dry-run] [--blueprint <id>]',
    about:
      "Give a rule a new id. The old id stays on the rule under `formerly:`, so the run\nrecords, threads and tests that name it still count for it, and no verdict is lost.\nIts threads are anchored to the new id. --dry-run says what would change.",
    run: rename,
  },
};

export const run = (args) => dispatch('rules', VERBS, args);
