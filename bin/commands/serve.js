import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { listedBlueprints } from '../../lib/blueprint.js';
import { canon, resolveLocations, SPEC_FILE, tilde } from '../../lib/locations.js';
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
  const standing = here.spec?.path && existsSync(join(here.spec.path, SPEC_FILE));
  const blueprint = values.blueprint || standing ? loadOrExit(values.blueprint) : null;
  const { startServe } = await import('../../lib/serve.js');
  const { port } = await startServe(blueprint?.dir ?? null, {
    port: values.port ? Number(values.port) : undefined,
  });
  /*
   * Every blueprint by id, with its project and home, not a count: the
   * id is what a page or `--blueprint` names, and a count left the person
   * to go and find them (n-0596).
   */
  const listed = listedBlueprints();
  const mine = blueprint ? canon(blueprint.dir) : null;
  const idWidth = Math.max(0, ...listed.map((b) => b.id.length)) + 2;
  const projectWidth = Math.max(0, ...listed.map((b) => (b.label ?? '—').length)) + 2;
  console.log(`walkdown serve — every blueprint registered on this machine (${listed.length})`);
  for (const b of listed)
    console.log(
      `  ${b.id.padEnd(idWidth)}${(b.label ?? '—').padEnd(projectWidth)}${tilde(b.dir)}${
        b.key === mine ? '  (default)' : ''
      }`,
    );
  console.log(
    dim(
      blueprint
        ? `  A page that names no blueprint opens ${here.id}.`
        : here.ambiguous
          ? // Inside a project, just not one with a single blueprint (n-0500).
            `  Started in a project with several blueprints (${here.config.registry.candidates.join(', ')}), so no blueprint is the default. A page that names none asks you to choose one.`
          : '  Started outside a registered project, so no blueprint is the default. A page that names none asks you to choose one.',
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
