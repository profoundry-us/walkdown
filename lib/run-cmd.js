import { spawnSync } from 'node:child_process';

/**
 * Execute the project's own check suite via the runner contract:
 * runner.run_all (or run_for_rule with {id} substituted), from the project
 * root, with the target's env plus WALKDOWN_TARGET injected. The run record
 * itself is emitted by the project's reporter/formatter — this just runs the
 * command honestly and reports the exit code.
 */
export function runChecks(blueprint, { target = 'local', rule, stdio = 'inherit' } = {}) {
  const runner = blueprint.config?.runner ?? {};
  const template = rule ? runner.run_for_rule : runner.run_all;
  if (!template)
    throw new Error(`runner.${rule ? 'run_for_rule' : 'run_all'} is not configured in walkdown.yml`);
  const targets = runner.targets ?? {};
  if (Object.keys(targets).length && !targets[target])
    throw new Error(`unknown target "${target}" (configured: ${Object.keys(targets).join(', ')})`);

  const command = template
    .replaceAll('{id}', rule ?? '')
    .replaceAll('{results}', '.walkdown/results.out');
  const res = spawnSync(command, {
    shell: true,
    cwd: blueprint.projectRoot,
    stdio,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
    env: { ...process.env, WALKDOWN_TARGET: target, ...(targets[target]?.env ?? {}) },
  });
  if (res.error) throw res.error;
  return { command, code: res.status ?? 1, stdout: res.stdout, stderr: res.stderr };
}
