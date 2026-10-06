import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveLocations } from '../../lib/locations.js';
import { dim } from '../../lib/report/tty.js';
import { noBlueprintHere } from './context.js';

/*
 * Print the pointer, or put it somewhere.
 *
 * A separate command because WHICH file an agent reads is a project's own
 * business: CLAUDE.md, AGENTS.md, a pack-level one in a monorepo, or none at
 * all because the team keeps conventions somewhere walkdown has never heard
 * of. `init` handles the unambiguous cases; this handles the rest, and it is
 * what the setup wizard will call once it has asked.
 */
export async function run(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, into: { type: 'string' } },
  });
  const { POINTER_TEXT, pointerHomes, placePointer } = await import('../../lib/init.js');
  const root = resolve(values.dir ?? process.cwd());
  const loc = resolveLocations({ cwd: root });
  // Several blueprints in the project is not none: the paragraph names none of them.
  if (!loc.spec?.path && !loc.ambiguous) noBlueprintHere(loc);
  /*
   * The paragraph is fixed (ADR 0014 §7): it names no blueprint, because a
   * blueprint's ID differs from machine to machine, so there is nothing in
   * it to work out from where it is read.
   */

  if (values.into) {
    const file = resolve(root, values.into);
    const action = placePointer(file, POINTER_TEXT);
    const say = {
      created: 'written to',
      'pointer-appended': 'added to',
      'pointer-updated': 'updated in',
      'up-to-date': 'already current in',
      kept: 'left alone (an unclosed walkdown:begin marker) in',
    };
    console.log(`${say[action] ?? action} ${file}`);
    return;
  }

  process.stdout.write(POINTER_TEXT);
  const homes = pointerHomes(root);
  console.error(
    homes.length
      ? `\n${dim(`Agent files here: ${homes.join(', ')}. `)}` +
          dim('`--into <file>` puts the block in one, idempotently.')
      : `\n${dim('No agent-instruction file here yet. `--into CLAUDE.md` makes one.')}`,
  );
}
