/*
 * What every command needs from the process: the blueprint it runs against,
 * and a clean way to finish.
 */
import { findBlueprintDir, loadBlueprint } from '../../lib/blueprint.js';

/*
 * How a command finishes. process.exit() tears the process down before Node
 * has flushed stdout, so a large `--json` payload down a pipe is truncated at
 * the pipe's buffer - 128KB, which a real blueprint passes without warning.
 * Setting the code lets the write drain and the process end on its own.
 */
const end = (code) => {
  process.exitCode = code;
};

export function loadOrExit(dirOpt) {
  const dir = dirOpt ?? findBlueprintDir();
  if (!dir) {
    console.error(
      'No blueprint found: no walkdown.yml in ./, ./blueprint/, or ancestors. Use --dir.',
    );
    process.exit(2);
  }
  return loadBlueprint(dir);
}

export { end };
