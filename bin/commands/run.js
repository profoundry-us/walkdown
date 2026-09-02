import { existsSync, readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { green, yellow } from '../../lib/report/tty.js';
import { loadOrExit } from './context.js';

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: { project: { type: 'string' }, target: { type: 'string' }, rule: { type: 'string' } },
  });
  const blueprint = loadOrExit(values.project);
  const { runChecks } = await import('../../lib/run-cmd.js');
  /*
   * The RESOLVED runs directory, not `<spec>/runs`. They are the same path
   * until a config moves the ledger - and then the hardcoded one reported
   * "no run record was written" over a record that was, which reads as a
   * broken reporter to the person who just watched their tests pass.
   */
  const runsDir = blueprint.at.runs.path;
  const before = new Set(existsSync(runsDir) ? readdirSync(runsDir) : []);
  let result;
  try {
    result = runChecks(blueprint, { target: values.target ?? 'local', rule: values.rule });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const after = existsSync(runsDir) ? readdirSync(runsDir) : [];
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
