import { parseArgs } from 'node:util';
import { defaultActor } from '../../lib/identity.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { writeSweep } from '../../lib/run-record.js';
import { TIERS } from '../../lib/vocab.js';
import { end, loadOrExit, namedOrExit } from './context.js';

/*
 * Declare a sweep. The only thing in walkdown that writes one - checks runs,
 * walkdowns and blueprint edits never do, because putting every rule back on
 * the queue is a decision and not a consequence.
 */
export function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      blueprint: { type: 'string' },
      target: { type: 'string' },
      tiers: { type: 'string' },
      why: { type: 'string' },
    },
  });
  const blueprint = loadOrExit(namedOrExit(values.blueprint, 'sweep'));
  const tiers = (values.tiers ?? 'checks,agent')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const bad = tiers.filter((t) => ![...TIERS, 'human'].includes(t));
  if (bad.length) {
    console.error(
      `${red('unknown tier')}: ${bad.join(', ')} — expected checks, agent or human. Nothing was changed.`,
    );
    return end(2);
  }
  if (!values.why?.trim()) {
    console.error(`${red('a sweep needs a reason')} — pass --why "…"`);
    console.error(dim('  It puts every rule back on the queue; the marker is what tells a'));
    console.error(dim('  later reader whether that was warranted. Nothing was changed.'));
    return end(2);
  }
  const targets = Object.keys(blueprint.config?.runner?.targets ?? {});
  const target = values.target ?? targets[0] ?? 'local';
  const { file, record } = writeSweep({
    blueprintDir: blueprint.dir,
    runsDir: blueprint.at?.runs?.path,
    codeRoot: blueprint.codeRoot,
    target,
    tiers,
    why: values.why,
    actor: defaultActor(blueprint.codeRoot ?? blueprint.projectRoot).username,
  });
  console.log(`${green('swept')} ${record.run_id} — ${tiers.join(', ')} on ${target}`);
  console.log(dim(`  ${record.why}`));
  console.log(dim(`  ${file}`));
  console.log(`\nEvery ${tiers.join('/')} verdict recorded before now reads as stale.`);
  console.log(dim('Nothing was deleted. `walkdown status` says what is still owed.'));
  return end(0);
}
