import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { canon, expand, readRegistry, registryPath, tilde, writeRegistry } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { parseDocument } from '../../vendor/yaml.js';
import { end } from './context.js';

/*
 * `walkdown blueprints rename <id> <new-id>` (ADR 0012 §2).
 *
 * An id chosen badly - by a person, or by an agent guessing - is put right
 * without starting over. The id lives in four places, and all four move
 * together: the registry row, the numbered folder's name (its number stays,
 * since the number is what keeps two homes apart), the blueprint's own
 * walkdown.yml, and, for a committed blueprint, the repository's
 * .walkdown/config.yml. Nothing a blueprint recorded is touched: rules,
 * threads and run records do not carry the id, and a run copied from it says
 * where it came from as history.
 */

const ID = /^[a-z0-9][a-z0-9._-]*$/i;

/* Written back as written: no folding, no padding (rules-move.js says why). */
const emit = (doc) => doc.toString({ lineWidth: 0, flowCollectionPadding: false });

export async function run(args) {
  const [id, next, ...extra] = args;
  if (!id || !next || extra.length) {
    console.error('Usage: walkdown blueprints rename <id> <new-id>');
    return end(2);
  }
  if (!ID.test(next)) {
    console.error(red(`\`${next}\` is not an id — letters, digits, dots, dashes and underscores, starting with a letter or digit.`));
    console.error(dim('Nothing was renamed.'));
    return end(2);
  }
  const { rows, error } = readRegistry();
  if (error) {
    console.error(red(`${registryPath()} does not parse — ${error}`));
    return end(2);
  }
  const row = rows.find((r) => String(r.id) === id && !r.ephemeral);
  if (!row) {
    console.error(red(`No blueprint \`${id}\` in ${registryPath()}. \`walkdown blueprints\` lists them.`));
    return end(2);
  }
  if (next === id) {
    console.log(dim(`\`${id}\` is already called that. Nothing was renamed.`));
    return end(0);
  }
  if (rows.some((r) => String(r.id) === next)) {
    console.error(red(`\`${next}\` is already a blueprint on this machine — choose another id.`));
    console.error(dim('Nothing was renamed.'));
    return end(2);
  }

  const homeDir = row.home ? expand(String(row.home)) : null;
  if (!homeDir || !existsSync(homeDir)) {
    console.error(red(`\`${id}\` names no home on disk${homeDir ? ` (${homeDir})` : ''} — there is no folder to rename.`));
    return end(2);
  }
  const project = row.project ? expand(String(row.project)) : null;
  const repoConfig = project ? join(project, '.walkdown', 'config.yml') : null;
  const repoDoc = repoConfig && existsSync(repoConfig) ? parseDocument(readFileSync(repoConfig, 'utf8')) : null;
  const repoRows = /** @type {any} */ (repoDoc?.get('blueprints'))?.items ?? [];
  const repoRow = repoRows.find((n) => String(n.get?.('id')) === id) ?? null;
  if (repoRows.some((n) => String(n.get?.('id')) === next)) {
    console.error(red(`\`${next}\` is already declared in ${repoConfig} — choose another id.`));
    console.error(dim('Nothing was renamed.'));
    return end(2);
  }

  // ---- the folder: same number, new name ------------------------------------
  const was = basename(homeDir);
  const numbered = was.match(/^(\d{4})-/);
  const name = numbered ? `${numbered[1]}-${next}` : was;
  const nextDir = join(dirname(homeDir), name);
  if (name !== was && existsSync(nextDir)) {
    console.error(red(`${nextDir} already exists — nothing was renamed.`));
    return end(2);
  }
  const said = [];
  if (name !== was) {
    renameSync(homeDir, nextDir);
    said.push([green('~ folder'), `${tilde(homeDir)}`, `now ${name}, keeping its number`]);
  }

  // ---- every path that named the folder, and the id ---------------------------
  const swap = (v) =>
    typeof v === 'string'
      ? [homeDir, tilde(homeDir)].reduce((s, from) => s.split(from).join(from === homeDir ? nextDir : tilde(nextDir)), v)
      : Array.isArray(v)
        ? v.map(swap)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
          : v;
  const renamed = rows.map((r) => (r === row ? { ...swap(r), id: next } : r));
  writeRegistry(renamed);
  said.push([green('~ registry'), tilde(registryPath()), `\`${id}\` is \`${next}\``]);

  const yml = join(nextDir, 'blueprint', 'walkdown.yml');
  if (existsSync(yml)) {
    const text = readFileSync(yml, 'utf8');
    const named = text.replace(new RegExp(`^blueprint:\\s*${id.replace(/[.]/g, '\\.')}\\s*$`, 'm'), `blueprint: ${next}`);
    if (named !== text) {
      writeFileSync(yml, named);
      said.push([green('~ named'), tilde(yml), `blueprint: ${next}`]);
    }
  }

  if (repoRow) {
    repoRow.set('id', next);
    for (const pair of repoRow.items) {
      const v = pair.value?.value;
      if (typeof v === 'string' && v.includes(was)) pair.value.value = v.split(`/${was}/`).join(`/${name}/`).replace(new RegExp(`(^|/)${was}$`), `$1${name}`);
    }
    writeFileSync(repoConfig, emit(repoDoc));
    said.push([green('~ declared'), repoConfig, `as \`${next}\``]);
  }

  // ---- the pointer names it by its new id ------------------------------------
  if (project) {
    const { placePointer, pointerBlock, pointerHomes, pointerTargets, POINTER_BEGIN } = await import('../../lib/init.js');
    for (const rel of pointerHomes(project)) {
      const file = join(project, rel);
      if (!readFileSync(file, 'utf8').includes(POINTER_BEGIN)) continue;
      const action = placePointer(file, pointerBlock(pointerTargets(project, dirname(file))));
      if (action === 'pointer-updated') said.push([green('~ pointer'), rel, `names \`${next}\``]);
    }
    try {
      const { refreshIndex } = await import('../../lib/registry.js');
      refreshIndex({ cwd: project });
    } catch {
      /* the claims index is a cache; the next import rebuilds it */
    }
  }

  for (const [mark, at, what] of said) console.log(`  ${mark}  ${at}  ${dim(what)}`);
  console.log(`\n✓ \`${id}\` is now \`${next}\`. Its rules, threads and runs are as they were.`);
  if (canon(process.cwd()).startsWith(canon(project ?? '/nowhere')))
    console.log(dim(`  \`--blueprint ${next}\` names it from here on.`));
  return end(0);
}
