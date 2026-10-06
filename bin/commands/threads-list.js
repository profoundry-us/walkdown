import { blueprintFlag } from '../../lib/locations.js';
import { parseArgs } from 'node:util';
import { anchorText, paintStatus } from '../../lib/report/threads.js';
import { dim, yellow } from '../../lib/report/tty.js';
import { labelClashes, listThreads } from '../../lib/threads.js';
import { eachOrExit, end, sectionHead } from './context.js';

export function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      blueprint: { type: 'string' },
      rule: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  const each = eachOrExit(values.blueprint);
  const of = (blueprint) => listThreads(blueprint, { rule: values.rule, all: values.all });

  if (values.json) {
    console.log(
      JSON.stringify(
        each.length > 1 ? { blueprints: each.map(({ id, blueprint }) => ({ id, threads: of(blueprint) })) } : of(each[0].blueprint),
        null,
        2,
      ),
    );
    return end(0);
  }
  each.forEach(({ id, blueprint }, i) => {
    if (each.length > 1) console.log(`${i ? '\n' : ''}${sectionHead(id)}\n`);
    report(of(blueprint), values);
    clashes(blueprint);
  });
  return end(0);
}

/* One blueprint's threads, printed. */
function report(threads, values) {
  if (!threads.length) {
    console.log(values.all ? 'No threads.' : 'No active threads. (--all includes resolved ones.)');
    return;
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
  console.log(dim('  walkdown threads show <id> shows a thread in full'));
}

/*
 * Labels a merge left shared (ADR 0014 §9), said under the list whether or
 * not the threads are active: a label names a conversation, and a second
 * one answering to it is news either way. Listing never relabels.
 */
function clashes(blueprint) {
  for (const { label, threads } of labelClashes(blueprint.threads)) {
    console.log(yellow(`\n  ! ${label} labels ${threads.length} threads: ${threads.map((t) => t.uuid).join(', ')}`));
    console.log(dim(`    \`walkdown threads relabel ${label}${blueprintFlag(blueprint.dir)}\` gives the newer one a label of its own`));
  }
}
