/*
 * `walkdown threads relabel <label|uuid>` — give the newer of two threads
 * sharing a label a label of its own (ADR 0014 §9).
 *
 * Two branches that each filed a thread both took the next number, and the
 * merge holds two conversations labelled alike. Nothing is relabelled until
 * a person agrees: at a terminal this asks; with no terminal it says what it
 * would do and the command that does it, and changes nothing.
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { planRelabel, relabelThread } from '../../lib/writes.js';
import { end, loadOrExit, namedOrExit } from './context.js';

const firstLine = (t) => String(t?.body ?? '').trim().split('\n')[0].slice(0, 80);

export async function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      blueprint: { type: 'string' },
      yes: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  const name = positionals[0];
  if (!name) {
    console.error('Usage: walkdown threads relabel <label|uuid> --blueprint <id> [--yes] [--json]');
    return end(2);
  }
  const blueprint = loadOrExit(namedOrExit(values.blueprint, 'threads relabel'));

  let plan;
  try {
    plan = planRelabel(blueprint, name);
  } catch (e) {
    console.error(red(e.message));
    return end(2);
  }
  const say = () => {
    console.log(`${plan.from} labels ${plan.keeps.length + 1} threads. The newer one would be relabelled:`);
    console.log(`  ${plan.uuid}  ${dim(String(plan.thread.created ?? ''))}  ${firstLine(plan.thread)}`);
    console.log(dim(`  ${plan.from} → ${plan.to}, keeping ${plan.from} as its alias; ${plan.keeps.join(', ')} keeps ${plan.from}`));
  };

  if (!values.yes) {
    if (!process.stdin.isTTY) {
      say();
      console.error(yellow(`\nNothing was changed. \`walkdown threads relabel ${plan.uuid} --yes --blueprint ${values.blueprint}\` does it.`));
      return end(2);
    }
    say();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const said = (await rl.question(`\nRelabel it ${plan.to}? [y/N] `).catch(() => '')).trim().toLowerCase();
    rl.close();
    if (said !== 'y' && said !== 'yes') {
      console.log(dim('Nothing was changed.'));
      return end(0);
    }
  }
  const done = relabelThread(blueprint, plan.uuid);
  if (values.json) {
    console.log(JSON.stringify({ uuid: done.uuid, from: done.from, to: done.to, aliases: [done.from], keeps: done.keeps }, null, 2));
    return end(0);
  }
  console.log(`${green('✓')} ${done.uuid} is ${done.to} now. ${done.from} stays as its alias, and still labels ${done.keeps.join(', ')}.`);
  return end(0);
}
