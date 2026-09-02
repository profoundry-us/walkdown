/*
 * What every command needs from the process: the blueprint it runs against,
 * and a clean way to finish.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadBlueprint } from '../../lib/blueprint.js';
import { resolveLocations } from '../../lib/locations.js';

/*
 * How a command finishes. process.exit() tears the process down before Node
 * has flushed stdout, so a large `--json` payload down a pipe is truncated at
 * the pipe's buffer - 128KB, which a real blueprint passes without warning.
 * Setting the code lets the write drain and the process end on its own.
 */
const end = (code) => {
  process.exitCode = code;
};

/*
 * Every command resolves the same way `walkdown where` does, through one
 * answer. This used to walk the tree for a `walkdown.yml` and knew nothing
 * about the config, so a spec kept outside the repository was invisible to
 * `status`, `lint`, `serve`, `run`, `judge`, `sweep` and both thread commands
 * while `where` reported it correctly (n-0133). The config is the list now,
 * so there is one place to look and one thing to say when it is empty.
 */
export function loadOrExit(projectId) {
  const loc = resolveLocations({ project: projectId });
  // The file is the test, not the declaration: an entry can name a spec that
  // has been deleted, and a directory nothing declares is not a project at
  // all. Both are "no blueprint" and both should say so the same way.
  const there = loc.spec?.path && existsSync(join(loc.spec.path, 'walkdown.yml'));
  if (!there) {
    const where = loc.config.repo?.path ?? loc.config.path;
    console.error(
      projectId
        ? `No blueprint for \`${projectId}\` — either nothing declares it, or its spec is gone.`
        : `No blueprint here. Nothing in ${where} claims this directory.`,
    );
    console.error(
      projectId
        ? '`walkdown projects` lists what is declared here.'
        : '`walkdown init` starts one, `walkdown project add <path>` lists an existing one, and `walkdown where` shows what was consulted.',
    );
    process.exit(2);
  }
  return loadBlueprint(loc.spec.path);
}

export { end };
