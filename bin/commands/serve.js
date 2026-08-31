import { parseArgs } from 'node:util';
import { dim } from '../../lib/report/tty.js';
import { loadOrExit } from './context.js';

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, port: { type: 'string' } },
  });
  const blueprint = loadOrExit(values.dir);
  const { startServe } = await import('../../lib/serve.js');
  const { port } = await startServe(blueprint.dir, {
    port: values.port ? Number(values.port) : undefined,
  });
  console.log(`walkdown serve — ${blueprint.dir}`);
  console.log(`  review:  http://localhost:${port}/`);
  // The embed, not the panel. The panel needs a page to frame and a page cannot
  // frame itself, so it arrives by extension or from the review page above.
  console.log(
    `  in your app:  <script src="http://localhost:${port}/embed.js" data-walkdown data-bp="blueprint"></script>`,
  );
  console.log(dim('  Ctrl-C to stop'));
}
