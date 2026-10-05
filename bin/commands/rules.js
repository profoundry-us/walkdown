import { parseArgs } from 'node:util';
import { resolveLocations } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { applyMove, planMove } from '../../lib/rules-move.js';
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
    .map((id) => ({ id, dir: resolveLocations({ blueprint: id }).spec?.path }))
    .filter((b) => b.dir);
  if (project.length < 2) {
    console.error(red('This project has one blueprint, so there is nowhere to move rules to.'));
    console.error(dim('`walkdown blueprints new <name>` gives it another.'));
    return end(2);
  }
  const to = project.find((b) => b.id === values.to);
  if (!to) {
    console.error(red(`✗ \`${values.to}\` is not a blueprint of this project — a rule moves only between blueprints of one project (${project.map((b) => b.id).join(', ')})`));
    console.error(dim('Nothing was moved.'));
    return end(2);
  }
  const holders = values.blueprint
    ? project.filter((b) => b.id === values.blueprint)
    : project.filter((b) => b.id !== to.id && planMove({ from: b, to, what, project }).picks.length === what.length);
  if (holders.length !== 1) {
    console.error(
      red(
        holders.length
          ? `\`${what.join(' ')}\` is in ${holders.map((b) => `\`${b.id}\``).join(' and ')} — \`--blueprint <from>\` says which to move it out of.`
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

export const VERBS = {
  move: {
    usage: 'walkdown rules move <rule|story|feature>... --to <blueprint> [--dry-run] [--blueprint <from>]',
    about:
      "Move rules to another blueprint of the same project, with their threads. The run\nrecords and evidence behind their verdicts are copied, so nothing is judged or signed\nagain, and the source's records are never edited. --dry-run says what would move.",
    run: move,
  },
};

export const run = (args) => dispatch('rules', VERBS, args);
