/*
 * What every command needs from the process: the blueprint it runs against,
 * and a clean way to finish.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadBlueprint } from '../../lib/blueprint.js';
import { nameOf, resolveLocations, SPEC_FILE, tilde, upgradeDue } from '../../lib/locations.js';

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
export function loadOrExit(blueprintId) {
  upgradeOrExit();
  const loc = resolveLocations({ blueprint: blueprintId });
  if (loc.ambiguous) severalHere(loc);
  // The file is the test, not the declaration: an entry can name a spec that
  // has been deleted, and a directory nothing declares is not a project at
  // all. Both are "no blueprint" and both should say so the same way.
  const there = loc.spec?.path && existsSync(join(loc.spec.path, SPEC_FILE));
  if (!there) noBlueprintHere(loc, blueprintId);
  return loadBlueprint(loc.spec.path);
}

/*
 * AN UPGRADE DUE IS SAID, NEVER DONE (ADR 0014 §11). A layout from before
 * ADR 0014 is moved once, by `walkdown upgrade`, when a person runs it; any
 * other command that finds one says so and stops, having changed nothing,
 * rather than reading half of an old layout and writing into the new one.
 */
export function upgradeOrExit() {
  const due = upgradeDue();
  if (!due.length) return;
  console.error('An upgrade is due — walkdown keeps its files differently now (ADR 0014):');
  for (const d of due) console.error(`  · ${d}`);
  console.error('Run `walkdown upgrade` to move them, once. Nothing was changed.');
  process.exit(2);
}

/*
 * EVERY BLUEPRINT STANDING HERE, for a command that only reads (ADR 0011
 * §2). One blueprint, or one named with --blueprint, is a list of one and
 * the command prints exactly what it always has; several registered for the
 * project come back in the order they were registered, each with its id, so
 * the command can print a section apiece. Nothing is guessed, because
 * reading all of them chooses none.
 *
 * @returns {{ id: string, blueprint: any }[]}
 */
export function eachOrExit(blueprintId) {
  upgradeOrExit();
  const loc = resolveLocations({ blueprint: blueprintId });
  if (!loc.ambiguous) return [{ id: loc.id, blueprint: loadOrExit(blueprintId), several: false }];
  return loc.config.registry.candidates.map((id) => ({ id, blueprint: loadOrExit(id), several: true }));
}

/*
 * The ids a write would have to choose between, or none. A thread command
 * uses it to find the one blueprint holding a thread id before refusing.
 */
export function candidatesHere() {
  const loc = resolveLocations({});
  return loc.ambiguous ? loc.config.registry.candidates : [];
}

/*
 * What a command that writes says where several blueprints stand. It used
 * to fall through to "No blueprint here", which was false - two were
 * registered - and sent the person looking for a problem they did not have
 * (issue #20).
 */
export function severalHere(loc) {
  const ids = loc.config.registry.candidates;
  const project = loc.code?.path ? ` for ${tilde(loc.code.path)}` : '';
  console.error(`Several blueprints are registered${project}: ${ids.join(', ')}.`);
  // Inside the project the name an ID ends with is enough (ADR 0014 §2).
  console.error(`Choose one with \`--blueprint <id>\` (e.g. \`--blueprint ${nameOf(ids[0])}\`).`);
  process.exit(2);
}

/** A section heading for one blueprint among several. */
export const sectionHead = (id) => `━━ ${id} ━━`;

/*
 * The words, apart from the loading.
 *
 * `walkdown pointer` resolves by --dir rather than by project id, so it could
 * not call loadOrExit and grew no refusal of its own: with nothing declared,
 * `loc.spec.path` was null and the command called `.startsWith` on it - a raw
 * TypeError from the one door a person reaches for precisely when their
 * project is not set up yet (n-0207). Every other command in this position
 * says what is wrong and what to do, and now there is one copy of that to say.
 */
export function noBlueprintHere(loc, blueprintId) {
  const where = loc.config.registry?.path ?? loc.config.path;
  // A home standing here, or called that, or in this checkout, that nothing
  // has imported: the reason names its folder and the import that registers it.
  if (/has not imported|`walkdown blueprints import /.test(loc.spec?.why ?? '')) {
    console.error(`No blueprint ${blueprintId ? `for \`${blueprintId}\`` : 'here'}: ${loc.spec.why}.`);
    process.exit(2);
  }
  console.error(
    blueprintId
      ? `No blueprint for \`${blueprintId}\` — either nothing registered it, or its spec is gone.`
      : `No blueprint here. Nothing registered in ${where} contains this directory.`,
  );
  console.error(
    blueprintId
      ? '`walkdown blueprints` lists what is registered.'
      : '`walkdown blueprints new` starts one, `walkdown blueprints import <project>` registers an existing one, and `walkdown where` shows what was consulted.',
  );
  process.exit(2);
}

export { end };
