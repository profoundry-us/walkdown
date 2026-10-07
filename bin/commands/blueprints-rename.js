import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  canon,
  codeOf,
  expand,
  nameOf,
  numberOf,
  personalHomes,
  readRegistry,
  registryPath,
  registryPick,
  tilde,
  within,
  writeRegistry,
} from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { end } from './context.js';

/*
 * `walkdown blueprints rename <id> <new-name> [--folder <folder>]` (ADR 0012
 * §2, ADR 0014 §2).
 *
 * An ID chosen badly - by a person, or by an agent guessing - is put right
 * without starting over. The ID is written only in the registry, so renaming
 * one changes the name at its end there and nowhere else: its number and its
 * project's code stay, and the repository does not change at all. `--folder`
 * renames the folder too, in place, and that is then the one change the
 * repository sees. Nothing a blueprint recorded is touched: rules, threads
 * and run records do not carry the ID.
 */

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export async function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { folder: { type: 'string' } },
  });
  const [want, next, ...extra] = positionals;
  if (!want || !next || extra.length) {
    console.error('Usage: walkdown blueprints rename <id> <new-name> [--folder <folder>]');
    return end(2);
  }
  if (!NAME.test(next)) {
    console.error(
      red(
        `\`${next}\` is not a name — lowercase letters, digits and dashes, starting with a letter or digit.`,
      ),
    );
    console.error(dim('Nothing was renamed.'));
    return end(2);
  }
  // A name shaped like an ID is read as one: `--blueprint 0001-sp-a` would
  // reach blueprint 0001, never the one renamed to it.
  if (/^\d{4}-[a-z0-9]{2,3}-/.test(next)) {
    console.error(
      red(
        `\`${next}\` reads as an ID, so it could never name this blueprint — give the name alone (the part after \`NNNN-pc-\`).`,
      ),
    );
    console.error(dim('Nothing was renamed.'));
    return end(2);
  }
  const { rows, next: counter, error } = readRegistry();
  if (error) {
    console.error(red(`${registryPath()} does not parse — ${error}`));
    return end(2);
  }
  const pick = registryPick(process.cwd(), rows, want);
  const row = pick.picked && !pick.picked.ephemeral ? pick.picked : null;
  if (!row) {
    console.error(
      red(
        pick.candidates.length > 1
          ? pick.why
          : `No blueprint \`${want}\` in ${tilde(registryPath())}. \`walkdown blueprints\` lists them.`,
      ),
    );
    return end(2);
  }
  const id = String(row.id);
  const homeDir = row.home ? canon(expand(String(row.home))) : null;
  if (!homeDir || !existsSync(homeDir)) {
    console.error(
      red(`\`${id}\` names no folder on disk${homeDir ? ` (${tilde(homeDir)})` : ''}.`),
    );
    return end(2);
  }
  /*
   * A name is what a person types inside a project, so two in one project
   * cannot share one. The ID would still be unique - its number sees to
   * that - but `--blueprint search` would stop meaning anything.
   */
  const project = row.project ?? null;
  const sibling = rows.find(
    (r) => r !== row && !r.ephemeral && (r.project ?? null) === project && nameOf(r.id) === next,
  );
  if (sibling) {
    console.error(
      red(
        `\`${next}\` is already a blueprint in project \`${project}\` (\`${sibling.id}\`) — choose another name.`,
      ),
    );
    console.error(dim('Nothing was renamed.'));
    return end(2);
  }
  const num = numberOf(id);
  const code = codeOf(id) ?? row.code;
  const nextId = num !== null && code ? `${String(num).padStart(4, '0')}-${code}-${next}` : next;

  // ---- the folder, only when asked ------------------------------------------
  let nextDir = homeDir;
  if (values.folder) {
    const f = values.folder;
    if (isAbsolute(f) || f.split('/').some((p) => !p || p === '.' || p === '..')) {
      console.error(
        red(`\`${f}\` is not a folder name — give a name, or a path below the blueprints folder.`),
      );
      console.error(dim('Nothing was renamed.'));
      return end(2);
    }
    // Read from the blueprints folder, as a home's folder name is: from the
    // home's own parent, a nested home's `--folder teams/b` landed in teams/teams/b.
    const base = (() => {
      for (let d = homeDir; d !== dirname(d); d = dirname(d))
        if (basename(d) === 'blueprints') return d;
      return dirname(homeDir);
    })();
    nextDir = join(base, f);
    if (canon(nextDir) !== homeDir && existsSync(nextDir)) {
      console.error(red(`${tilde(nextDir)} already exists — nothing was renamed.`));
      return end(2);
    }
    /*
     * The same folder name on the other side - committed in the checkout for
     * a home kept on this machine, or kept here for a committed one - is a
     * home `blueprints commit` would then refuse, and lint would warn of. A
     * rename is not the way to make that clash (n-0381).
     */
    const rootOf = (dir) => {
      for (let d = dir; d !== dirname(d); d = dirname(d))
        if (basename(d) === 'blueprints') return d;
      return null;
    };
    const key = rootOf(homeDir) ? relative(rootOf(homeDir), nextDir) : null;
    const checkout = row.checkout ? canon(expand(String(row.checkout))) : null;
    const roots = new Set([
      ...(checkout ? [join(checkout, '.walkdown', 'blueprints')] : []),
      ...(project ? [canon(personalHomes(String(project)))] : []),
      ...rows
        .filter((r) => r !== row && !r.ephemeral && (r.project ?? null) === project && r.home)
        .map((r) => rootOf(canon(expand(String(r.home)))))
        .filter(Boolean),
    ]);
    roots.delete(rootOf(homeDir));
    /*
     * A home is one folder, never inside another or holding one: moved into
     * a sibling's folder, a rename of that sibling carries it off where
     * nothing finds it, and into its own folder it cannot move at all.
     */
    const homes = rows.filter((r) => r !== row && r.home).map((r) => canon(expand(String(r.home))));
    const root = rootOf(homeDir) ?? dirname(homeDir);
    let up = dirname(nextDir);
    let holder = null;
    for (; !holder && up.length >= root.length && within(up, root); up = dirname(up))
      if (canon(up) === homeDir || existsSync(join(up, 'spec.yml'))) holder = up;
    const held = homes.find((h) => h !== canon(nextDir) && within(h, nextDir));
    if (holder || held) {
      console.error(
        red(
          holder
            ? `${tilde(nextDir)} is inside ${tilde(holder)}, which is a blueprint's home — a home is one folder, never inside another.`
            : `${tilde(nextDir)} would hold ${tilde(held)}, another blueprint's home — a home is one folder, never around another.`,
        ),
      );
      console.error(dim('Nothing was renamed.'));
      return end(2);
    }
    const clash =
      key && [...roots].map((r) => join(r, key)).find((d) => existsSync(join(d, 'spec.yml')));
    if (clash) {
      console.error(
        red(
          `${tilde(clash)} already holds a blueprint of project \`${project}\` under the folder name \`${key}\` — choose another.`,
        ),
      );
      console.error(dim('Nothing was renamed.'));
      return end(2);
    }
  }
  if (nextId === id && nextDir === homeDir) {
    console.log(dim(`\`${id}\` is already called that. Nothing was renamed.`));
    return end(0);
  }

  const said = [];
  if (nextDir !== homeDir) {
    // `--folder teams/cart` may name a folder that does not exist yet.
    mkdirSync(dirname(nextDir), { recursive: true });
    renameSync(homeDir, nextDir);
    said.push([green('~ folder'), tilde(homeDir), `now ${relative(dirname(homeDir), nextDir)}`]);
  }
  const renamed = rows.map((r) =>
    r === row ? { ...r, id: nextId, ...(nextDir !== homeDir ? { home: tilde(nextDir) } : {}) } : r,
  );
  writeRegistry(renamed, counter);
  if (nextId !== id)
    said.push([green('~ registry'), tilde(registryPath()), `\`${id}\` is \`${nextId}\``]);

  try {
    const { refreshIndex } = await import('../../lib/registry.js');
    refreshIndex();
  } catch {
    /* the claims index is a cache; the next import rebuilds it */
  }

  for (const [mark, at, what] of said) console.log(`  ${mark}  ${at}  ${dim(what)}`);
  console.log(`\n✓ \`${id}\` is now \`${nextId}\`. Its rules, threads and runs are as they were.`);
  console.log(
    dim(
      `  \`--blueprint ${next}\` names it inside its project, \`--blueprint ${nextId}\` anywhere.`,
    ),
  );
  return end(0);
}
