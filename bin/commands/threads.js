import { parseArgs } from 'node:util';
import { anchorText, paintStatus } from '../../lib/report/threads.js';
import { dim } from '../../lib/report/tty.js';
import { listThreads } from '../../lib/threads.js';
import { end, loadOrExit } from './context.js';

export function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      rule: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  const blueprint = loadOrExit(values.dir);
  const threads = listThreads(blueprint, { rule: values.rule, all: values.all });

  if (values.json) {
    console.log(JSON.stringify(threads, null, 2));
    return end(0);
  }
  if (!threads.length) {
    console.log(values.all ? 'No threads.' : 'No active threads. (--all includes resolved ones.)');
    return end(0);
  }
  console.log(dim(`walkdown threads — ${threads.length} ${values.all ? 'total' : 'active'}\n`));
  for (const t of threads) {
    const firstLine = String(t.body ?? '')
      .trim()
      .split('\n')[0];
    console.log(
      `  ${t.id}  ${t.kind.padEnd(8)} ${paintStatus(String(t.status).padEnd(12))} ${dim(anchorText(t.anchor))}`,
    );
    console.log(`      ${firstLine.length > 100 ? firstLine.slice(0, 97) + '…' : firstLine}\n`);
  }
  console.log(dim('  walkdown thread <id> shows a thread in full'));
  return end(0);
}
