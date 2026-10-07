/*
 * `walkdown upgrade` - move walkdown's files to the layout ADR 0014 settled,
 * once, when a person runs it. lib/upgrade.js holds what moves; this says
 * it, step by step, and with `--dry-run` says it without moving anything.
 */
import { parseArgs } from 'node:util';
import { dim, green, red } from '../../lib/report/tty.js';
import { planUpgrade, runUpgrade } from '../../lib/upgrade.js';
import { end } from './context.js';

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: { 'dry-run': { type: 'boolean', default: false } },
  });
  const { steps } = planUpgrade();
  if (!steps.length) {
    console.log(
      dim(
        "Nothing to upgrade — walkdown's files are already laid out the way this version keeps them.",
      ),
    );
    return end(0);
  }
  if (values['dry-run']) {
    console.log('`walkdown upgrade` would:');
    for (const s of steps) console.log(`  · ${s.what}`);
    console.log(dim('\nNothing was changed.'));
    return end(0);
  }
  try {
    runUpgrade({ say: (what) => console.log(`  ${green('✓')} ${what}`) });
  } catch (e) {
    console.error(red(`✗ ${e.message}`));
    console.error(
      dim(
        '  The steps above landed; the rest did not. Run `walkdown upgrade` again once that is put right.',
      ),
    );
    return end(2);
  }
  console.log(`\n✓ Upgraded. Every folder kept its name, and every verdict is where it was.`);
  return end(0);
}
