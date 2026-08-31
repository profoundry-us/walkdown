import { parseArgs } from 'node:util';
import { KINDS, resolveLocations } from '../../lib/locations.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { end } from './context.js';

/*
 * `walkdown where`: the resolver's answer, in the order a person reads it.
 *
 * The reason each path was chosen is printed beside it, because the interesting
 * question is never only "where" but "why there" - a path that came from a
 * config, from the working tree, or from a default are three different
 * situations, and only one of them is somebody's decision.
 */
export function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { dir: { type: 'string' }, json: { type: 'boolean', default: false } },
  });
  const loc = resolveLocations({ dir: values.dir });
  if (values.json) {
    console.log(JSON.stringify(loc, null, 2));
    return end(0);
  }

  /*
   * One kind, one path, nothing else - so a script or a skill can ask
   * `walkdown where evidence` and use the answer directly instead of parsing a
   * report meant for a person.
   */
  const only = positionals[0];
  if (only) {
    const cell =
      only === 'spec' || only === 'code' ? loc[only] : KINDS.includes(only) ? loc[only] : null;
    if (!cell) {
      console.error(`No such location "${only}". Try: spec, code, ${KINDS.join(', ')}.`);
      return end(2);
    }
    console.log(cell.path ?? '');
    return end(cell.path ? 0 : 1);
  }

  console.log(`walkdown where — ${loc.id}\n`);
  const cfg = loc.config.exists
    ? loc.config.error
      ? red(`unreadable — ${loc.config.error}`)
      : loc.config.matched
        ? green('names this project')
        : dim('present, no entry for this project')
    : dim('not present — every default applies');
  console.log(`  ${'config'.padEnd(9)} ${loc.config.path}`);
  console.log(`  ${''.padEnd(9)} ${cfg}\n`);

  const row = (label, cell) => {
    const missing = cell.missing ? yellow('  (does not exist yet)') : '';
    console.log(`  ${label.padEnd(9)} ${cell.path ?? dim('—')}${missing}`);
    console.log(`  ${''.padEnd(9)} ${dim(cell.why)}`);
  };
  row('spec', loc.spec);
  for (const kind of KINDS) row(kind, loc[kind]);
  row('code', loc.code);

  console.log(dim('\nNothing was written. See docs/08-locations.md for the resolution order.'));
  return end(0);
}
