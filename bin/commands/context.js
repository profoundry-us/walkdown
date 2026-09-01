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
export function loadOrExit(dirOpt) {
  const loc = resolveLocations({ dir: dirOpt });
  // The file is the test, not the flag: `--dir` names a path without promising
  // anything is there, and the fallback answer is a guess at where a spec
  // WOULD go. Both are "no blueprint" and both should say so the same way.
  const there = loc.spec?.path && existsSync(join(loc.spec.path, 'walkdown.yml'));
  if (!there) {
    const where = loc.config.repo?.path ?? loc.config.path;
    console.error(
      dirOpt
        ? `No blueprint at ${dirOpt} — no walkdown.yml there.`
        : `No blueprint here. Nothing in ${where} claims this directory.`,
    );
    console.error(
      dirOpt
        ? 'Point --dir at a directory holding walkdown.yml.'
        : "`walkdown init` starts one, `walkdown where` shows what was consulted, or name one with --dir.",
    );
    process.exit(2);
  }
  return loadBlueprint(loc.spec.path);
}

export { end };
