import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveLocations } from '../../lib/locations.js';
import { dim } from '../../lib/report/tty.js';

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
  const { pointerBlock, pointerHomes, placePointer } = await import('../../lib/init.js');
  const root = resolve(values.dir ?? process.cwd());
  const spec = resolveLocations({ cwd: root }).spec.path;
  const block = pointerBlock(
    spec.startsWith(root + '/') ? `${spec.slice(root.length + 1)}/` : spec,
  );

  if (values.into) {
    const file = resolve(root, values.into);
    const action = placePointer(file, block);
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

  process.stdout.write(block);
  const homes = pointerHomes(root);
  console.error(
    homes.length
      ? `\n${dim(`Agent files here: ${homes.join(', ')}. `)}` +
          dim('`--into <file>` puts the block in one, idempotently.')
      : `\n${dim('No agent-instruction file here yet. `--into CLAUDE.md` makes one.')}`,
  );
}
