import { existsSync, readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { green, yellow } from '../../lib/report/tty.js';
import { eachOrExit } from './context.js';

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      blueprint: { type: 'string' },
      target: { type: 'string' },
      rule: { type: 'string' },
    },
  });
  /*
   * Several blueprints in the project and none named: the suite is the
   * project's, so it runs once - each distinct runner command once - and
   * the reporter files every result by its rule (ADR 0013 §1). Named, it
   * runs narrowed to that blueprint, as it always did.
   */
  const each = eachOrExit(values.blueprint).map((e) => e.blueprint);
  const several = each.length > 1;
  const { distinctRunners, runChecks } = await import('../../lib/run-cmd.js');
  /*
   * The RESOLVED runs directories, not `<spec>/runs`. They are the same path
   * until a config moves the ledger - and then the hardcoded one reported
   * "no run record was written" over a record that was, which reads as a
   * broken reporter to the person who just watched their tests pass.
   */
  const dirs = each.map((b) => b.at.runs.path);
  const listing = () =>
    dirs.flatMap((d) => (existsSync(d) ? readdirSync(d).map((f) => `${d}/${f}`) : []));
  const before = new Set(listing());
  let code = 0;
  try {
    for (const blueprint of several ? distinctRunners(each, { rule: values.rule }) : each) {
      const result = runChecks(blueprint, {
        target: values.target ?? 'local',
        rule: values.rule,
        narrow: !several,
      });
      code = Math.max(code, result.code);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const recorded = listing().filter((f) => !before.has(f) && f.endsWith('.json'));
  if (recorded.length)
    console.log(
      `\n${green('recorded')}: ${recorded.map((f) => f.split('/').pop()).join(', ')} — \`walkdown status\` for the picture`,
    );
  else
    console.log(
      `\n${yellow('no run record was written')} — is the walkdown reporter/formatter wired into the test config?`,
    );
  process.exit(code);
}
