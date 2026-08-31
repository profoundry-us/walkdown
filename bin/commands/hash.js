import { parseArgs } from 'node:util';
import { runHashCommand } from '../../lib/hash-cmd.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { end, loadOrExit } from './context.js';

export function run(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, write: { type: 'boolean', default: false } },
  });
  const blueprint = loadOrExit(values.dir);
  const { rows, changedFiles, exitCode } = runHashCommand(blueprint, { write: values.write });

  const mark = {
    ok: green('✓'),
    written: green('✓'),
    stale: red('✗'),
    missing: yellow('⚠'),
    'no-steps': dim('–'),
  };
  for (const r of rows)
    console.log(`  ${mark[r.status]} ${r.status.padEnd(8)} ${r.rule} ${dim(r.expected)}`);
  if (values.write) console.log(`\n${changedFiles} file(s) updated`);
  else if (exitCode)
    console.log(`\n${red('stale/missing hashes')} — run \`walkdown hash --write\``);
  return end(exitCode);
}
