import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { allocateHome, configPath, expand, readUserConfig, registryDir, setHomeSpec, walkdownHome } from '../../lib/locations.js';
import { dim, green, yellow } from '../../lib/report/tty.js';
import { end } from './context.js';

/*
 * Renumber the legacy name-keyed homes (thread n-0124). `projects/<id>/` was
 * keyed by a name, and names collide exactly where the default-out design
 * matters: thirty monorepo packs sharing a repository basename. The registry
 * allocates a number instead, and this command moves what already exists -
 * once, on the person's say-so, because an existing ledger is a fact and a
 * resolver must never move one on its own.
 */
export async function run() {
  const home = walkdownHome();
  const legacyRoot = join(home, 'projects');
  const dirs = existsSync(legacyRoot)
    ? readdirSync(legacyRoot).filter((d) => !d.startsWith('.'))
    : [];
  if (!dirs.length) {
    console.log('Nothing to migrate — no legacy homes under ' + legacyRoot);
    return end(0);
  }

  const { config } = readUserConfig();
  const { parseDocument } = await import('../../vendor/yaml.js');
  const { readFileSync, writeFileSync } = await import('node:fs');
  let moved = 0;

  for (const id of dirs) {
    const legacy = join(legacyRoot, id);
    /*
     * Which blueprint does this home serve? Only the config can say - the
     * directory carries records, not an address book, and a spec sitting
     * INSIDE the directory is still not a claim: it says what the records
     * are, never whose machine wants them moved. A home no entry claims is
     * reported and left standing - migrating one on the strength of its
     * contents moved two orphans on 2026-09-01 (n-0129, second judging),
     * and guessing is exactly the mistake this migration exists to end.
     */
    const entry = (config.projects ?? []).find((p) => p?.id === id);
    if (!entry) {
      console.log(
        `  ${yellow('? left')}     ${legacy}\n` +
          dim(
            `             no config entry claims it — add one under projects: with id ${id}, or delete the directory if it is done with`,
          ),
      );
      continue;
    }

    const spec = entry?.spec ? expand(entry.spec) : null;
    const root = entry?.roots ? [entry.roots].flat().map((r) => expand(r))[0] : null;
    const allocated = allocateHome(
      // A home whose spec lives INSIDE it is keyed by where that spec lands
      // after the move; the name is chosen first so the path can say so.
      { spec: spec ?? undefined, root: root ?? undefined, slug: id },
      { makeDir: false },
    );
    if (existsSync(allocated.path)) {
      console.log(`  ${yellow('! kept')}     ${legacy}`);
      console.log(dim(`             ${allocated.path} already exists — resolve by hand`));
      continue;
    }
    renameSync(legacy, allocated.path);
    moved++;
    console.log(`  ${green('→ moved')}    ${legacy}`);
    console.log(dim(`             now ${allocated.path}`));

    /*
     * The index must say where this home's spec lives, or the next
     * spec-keyed ask misses the entry and allocates the same blueprint a
     * second home with the first one's records stranded (n-0129). Two
     * shapes: a configured spec that sat INSIDE the legacy directory follows
     * it to the new address; the config-less shape the old defaults produced
     * (an entry of only id and roots) holds its spec at blueprint/ inside
     * the home it just became.
     */
    const specWas = allocated.spec ? expand(allocated.spec) : null;
    const specNow =
      specWas && (specWas === legacy || specWas.startsWith(legacy + '/'))
        ? allocated.path + specWas.slice(legacy.length)
        : existsSync(join(allocated.path, 'blueprint', 'walkdown.yml'))
          ? join(allocated.path, 'blueprint')
          : null;
    if (specNow) setHomeSpec(allocated.name, specNow);

    /*
     * The person's config spoke in the old address; keep it true. Surgical,
     * like rememberLocation: only the strings that named the moved directory
     * change, and the file's comments and ordering stay theirs.
     */
    if (entry) {
      const doc = parseDocument(readFileSync(configPath(), 'utf8'));
      const projects = doc.get('projects');
      const item = (projects?.items ?? []).find((it) => String(it.get?.('id') ?? '') === id);
      let touched = false;
      for (const pair of item?.items ?? []) {
        const v = pair.value;
        if (v?.value && typeof v.value === 'string' && expand(v.value).startsWith(legacy)) {
          v.value = allocated.path + expand(v.value).slice(legacy.length);
          touched = true;
        }
        for (const sub of v?.items ?? []) {
          if (typeof sub?.value === 'string' && expand(sub.value).startsWith(legacy)) {
            sub.value = allocated.path + expand(sub.value).slice(legacy.length);
            touched = true;
          }
        }
      }
      if (touched) {
        writeFileSync(configPath(), String(doc));
        console.log(dim(`             config re-pointed (${configPath()})`));
      }
    }
  }

  const left = readdirSync(legacyRoot).filter((d) => !d.startsWith('.'));
  if (!left.length) {
    const { rmdirSync } = await import('node:fs');
    rmdirSync(legacyRoot);
    console.log(dim(`\n  ${legacyRoot} emptied and removed`));
  }
  console.log(
    `\n  ${moved} home${moved === 1 ? '' : 's'} renumbered under ${registryDir()}` +
      (left.length ? `; ${left.length} left in place` : ''),
  );
  return end(0);
}
