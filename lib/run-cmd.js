import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

/**
 * Execute the project's own check suite via the runner contract:
 * runner.run_all (or run_for_rule with {id} substituted), from the project
 * root, with the target's env plus WALKDOWN_TARGET injected. The run record
 * itself is emitted by the project's reporter/formatter — this just runs the
 * command honestly and reports the exit code.
 */
/**
 * @param {{ config?: Record<string, any>, projectRoot?: string, codeRoot?: string }} blueprint
 * @param {{ target?: string, rule?: string, stdio?: 'inherit' | 'pipe' }} [opts]
 */
export function runChecks(blueprint, { target = 'local', rule, stdio = 'inherit' } = {}) {
  const runner = blueprint.config?.runner ?? {};
  const template = rule ? runner.run_for_rule : runner.run_all;
  if (!template)
    throw new Error(
      `runner.${rule ? 'run_for_rule' : 'run_all'} is not configured in walkdown.yml`,
    );
  const targets = runner.targets ?? {};
  if (Object.keys(targets).length && !targets[target])
    throw new Error(`unknown target "${target}" (configured: ${Object.keys(targets).join(', ')})`);

  /*
   * Where the command runs: the CODE root, not the blueprint's parent. Those
   * are the same directory only while the spec lives in the repository, and
   * `init` stopped putting it there - so `run` shelled out into the walkdown
   * home, where there is no test suite and no `bin/` (issue #7).
   */
  const cwd = blueprint.codeRoot ?? blueprint.projectRoot;
  /*
   * `{results}` is a path handed to somebody else's tool - walkdown never
   * reads the file, it only tells the framework where to write one. It was a
   * relative literal, which meant it followed whichever cwd won: the same bug
   * one line down, in a different costume. Absolute against the code root now,
   * and nameable in the blueprint for a project whose framework insists.
   */
  const declared = runner.results_file ?? '.walkdown/results.out';
  const results = isAbsolute(declared) ? declared : resolve(cwd, declared);
  const command = template.replaceAll('{id}', rule ?? '').replaceAll('{results}', results);
  // spawnSync's two-argument (command, options) form is real but untyped;
  // the empty argv keeps the checker and the runtime telling the same story.
  const res = spawnSync(command, [], {
    shell: true,
    cwd,
    stdio,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
    env: { ...process.env, WALKDOWN_TARGET: target, ...(targets[target]?.env ?? {}) },
  });
  if (res.error) throw res.error;
  return { command, code: res.status ?? 1, stdout: res.stdout, stderr: res.stderr };
}
