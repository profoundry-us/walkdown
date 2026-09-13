import { parseArgs } from 'node:util';
import { runHashCommand } from '../../lib/hash-cmd.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { end, loadOrExit } from './context.js';

export function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      blueprint: { type: 'string' },
      write: { type: 'boolean', default: false },
      reword: { type: 'string' },
    },
  });
  if (values.reword != null && !values.write) {
    console.error('--reword goes with --write: it says why the old hash is kept when the new one is written.');
    return end(2);
  }
  if (values.reword != null && !values.reword.trim()) {
    console.error('--reword wants a reason - the old hash is kept on your word, and the file says whose.');
    return end(2);
  }
  const blueprint = loadOrExit(values.blueprint);
  const { rows, changedFiles, exitCode } = runHashCommand(blueprint, {
    write: values.write,
    reword: values.reword ?? null,
  });

  const mark = {
    ok: green('✓'),
    legacy: yellow('~'),
    written: green('✓'),
    reworded: green('✓'),
    stale: red('✗'),
    missing: yellow('⚠'),
    'no-steps': dim('–'),
  };
  for (const r of rows)
    console.log(`  ${mark[r.status]} ${r.status.padEnd(8)} ${r.rule} ${dim(r.expected)}`);
  if (values.write) console.log(`\n${changedFiles} file(s) updated`);
  else if (exitCode)
    console.log(
      `\n${red('stale/missing hashes')} — run \`walkdown hash --write\`; add \`--reword "<why>"\` if only the words changed, and the verdicts stay current`,
    );
  return end(exitCode);
}
