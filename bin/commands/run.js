import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { green, yellow } from '../../lib/report/tty.js';
import { loadOrExit } from './context.js';

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, target: { type: 'string' }, rule: { type: 'string' } },
  });
  const blueprint = loadOrExit(values.dir);
  const { runChecks } = await import('../../lib/run-cmd.js');
  const before = new Set(
    existsSync(join(blueprint.dir, 'runs')) ? readdirSync(join(blueprint.dir, 'runs')) : [],
  );
  let result;
  try {
    result = runChecks(blueprint, { target: values.target ?? 'local', rule: values.rule });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const after = existsSync(join(blueprint.dir, 'runs'))
    ? readdirSync(join(blueprint.dir, 'runs'))
    : [];
  const recorded = after.filter((f) => !before.has(f) && f.endsWith('.json'));
  if (recorded.length)
    console.log(
      `\n${green('recorded')}: ${recorded.join(', ')} — \`walkdown status\` for the picture`,
    );
  else
    console.log(
      `\n${yellow('no run record was written')} — is the walkdown reporter/formatter wired into the test config?`,
    );
  process.exit(result.code);
}
