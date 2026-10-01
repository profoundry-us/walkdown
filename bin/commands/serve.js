import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { listedBlueprints } from '../../lib/blueprint.js';
import { resolveLocations } from '../../lib/locations.js';
import { dim } from '../../lib/report/tty.js';
import { loadOrExit } from './context.js';

/*
 * One server answers for every blueprint this machine has registered: each
 * request names its blueprint, and the panel finds it from the page it is
 * on, or asks. So it starts anywhere. Started inside a registered project,
 * or with --blueprint, that blueprint is where a request naming none is
 * answered; started anywhere else there is no such default, and nothing is
 * refused for it (GitHub issue #19).
 */
export async function run(args) {
  const { values } = parseArgs({
    args,
    options: { blueprint: { type: 'string' }, port: { type: 'string' } },
  });
  // Named, it must exist: a typo should say so, not serve without it.
  const here = resolveLocations({ blueprint: values.blueprint });
  const standing = here.spec?.path && existsSync(join(here.spec.path, 'walkdown.yml'));
  const blueprint = values.blueprint || standing ? loadOrExit(values.blueprint) : null;
  const { startServe } = await import('../../lib/serve.js');
  const { port } = await startServe(blueprint?.dir ?? null, {
    port: values.port ? Number(values.port) : undefined,
  });
  const count = listedBlueprints().length;
  console.log(`walkdown serve — every blueprint registered on this machine (${count})`);
  console.log(
    dim(
      blueprint
        ? `  a page naming none opens ${blueprint.dir}`
        : "  started outside a registered project: the panel finds each page's blueprint, or asks",
    ),
  );
  console.log(`  review:  http://localhost:${port}/`);
  // The embed, not the panel. The panel needs a page to frame and a page cannot
  // frame itself, so it arrives by extension or from the review page above.
  console.log(
    `  in your app:  <script src="http://localhost:${port}/embed.js" data-walkdown data-bp="${
      blueprint ? here.id : '<id>'
    }"></script>`,
  );
  console.log(dim('  Ctrl-C to stop'));
}
