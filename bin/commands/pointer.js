import { dirname, relative, resolve } from 'node:path';
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
  const { pointerBlock, pointerHomes, placePointer } = await import('../../lib/init.js');
  const root = resolve(values.dir ?? process.cwd());
  const loc = resolveLocations({ cwd: root });
  const spec = loc.spec?.path;
  if (!spec) noBlueprintHere(loc);
  /*
   * How the block should NAME the blueprint, from wherever it is being read.
   *
   * This measured "is the spec under here?" against the working directory and
   * fell back to the absolute path when it was not. Run from a subdirectory
   * the home does not sit under - `packages/web` of a repo whose home is at
   * the root - the block therefore named `/Users/somebody/...`, a machine
   * path written into a file that gets committed and is wrong for everyone
   * else (n-0209).
   *
   * The path is read from beside the FILE it lands in, so that is what it is
   * relative to; and both being inside the same checkout is what makes a
   * relative path meaningful, so the code root is the test, not the cwd. Only
   * a spec genuinely outside the checkout has nothing relative to say, and
   * that one is absolute because it has to be - it is also the one that is
   * personal rather than committed.
   */
  const codeRoot = loc.code?.path;
  const inside = (p) => codeRoot && (p === codeRoot || p.startsWith(`${codeRoot}/`));
  const nameFrom = (base) => (inside(spec) && inside(base) ? `${relative(base, spec)}/` : spec);

  if (values.into) {
    const file = resolve(root, values.into);
    const action = placePointer(file, pointerBlock(nameFrom(dirname(file))));
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

  process.stdout.write(pointerBlock(nameFrom(root)));
  const homes = pointerHomes(root);
  console.error(
    homes.length
      ? `\n${dim(`Agent files here: ${homes.join(', ')}. `)}` +
          dim('`--into <file>` puts the block in one, idempotently.')
      : `\n${dim('No agent-instruction file here yet. `--into CLAUDE.md` makes one.')}`,
  );
}
