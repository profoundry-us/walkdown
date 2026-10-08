/*
 * `walkdown upgrade` - move walkdown's files to the layout ADR 0014 settled,
 * once, when a person runs it. lib/upgrade.js holds what moves; this says
 * it, step by step, and with `--dry-run` says it without moving anything.
 */
import { parseArgs } from 'node:util';
import { canon, expand, gitRoot, readRegistry } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { planUpgrade, runUpgrade } from '../../lib/upgrade.js';
import { end } from './context.js';

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: { 'dry-run': { type: 'boolean', default: false }, code: { type: 'string' } },
  });
  /*
   * The code of the project standing here, chosen rather than derived from
   * its label (`--code ac` for acme_main, which would derive `am`). Asked
   * for here because the upgrade is what gives an existing project its code.
   */
  const code = values.code === undefined ? null : values.code.trim().toLowerCase();
  if (code !== null && !/^[a-z0-9]{2,3}$/.test(code)) {
    console.error(
      red(
        `✗ \`${values.code}\` is not a project code — two or three lowercase letters or digits. Nothing was changed.`,
      ),
    );
    return end(2);
  }
  // Asked before anything moves: a refusal halfway would leave the machine
  // half upgraded (n-0514).
  if (code !== null) {
    const top = gitRoot(process.cwd());
    if (!top) {
      console.error(
        red(
          '✗ `--code` names the code of the project you run this in, and this is no repository. Nothing was changed.',
        ),
      );
      return end(2);
    }
    const holder = readRegistry().rows.find(
      (r) => r?.code === code && r.checkout && canon(expand(String(r.checkout))) !== canon(top),
    );
    if (holder) {
      console.error(
        red(
          `✗ The project code \`${code}\` is already the project \`${holder.project}\`'s. Nothing was changed.`,
        ),
      );
      console.error(dim('  Choose another with `--code <two or three letters>`.'));
      return end(2);
    }
  }
  const { steps } = planUpgrade();
  if (!steps.length && code !== null) {
    console.error(
      red(
        `✗ Nothing to upgrade, so \`--code ${code}\` was not used: a project's code is chosen when it is first registered or upgraded. Nothing was changed.`,
      ),
    );
    return end(2);
  }
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
    runUpgrade({ code, say: (what) => console.log(`  ${green('✓')} ${what}`) });
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
