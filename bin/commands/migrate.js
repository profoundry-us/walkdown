import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configPath, expand, readUserConfig, walkdownHome } from '../../lib/locations.js';
import { parse, parseDocument } from '../../vendor/yaml.js';
import { dim, green, yellow } from '../../lib/report/tty.js';
import { end } from './context.js';

/*
 * Fold what the old bookkeeping knew into the config, and move nothing.
 *
 * This command used to RENAME directories: homes were keyed by project name,
 * names collided across monorepo packs, and migrating meant renumbering each
 * one and re-pointing the config at its new address (n-0124).
 *
 * There is no registry to renumber into any more. The config entry carries
 * its own home, so the whole job is to write down where each existing home
 * already is - the index's `blueprints:` entries, and the older name-keyed
 * `projects/<id>` directories beside them. Nothing is renamed, nothing is
 * moved, and no records change hands: an existing ledger is a fact, and the
 * safest migration is the one that only writes a sentence about it.
 *
 * The index file itself is left on disk. Deleting somebody's records - even
 * an index of them - is their call, and the report says so.
 */
export async function run() {
  const home = walkdownHome();
  const index = join(home, 'blueprints', 'index.yml');
  const legacyRoot = join(home, 'projects');

  /** Every home this machine holds, however it came to hold it. */
  const found = [];
  if (existsSync(index)) {
    let entries = [];
    try {
      entries = parse(readFileSync(index, 'utf8'))?.blueprints ?? [];
    } catch {
      console.error(`Could not read ${index} — fix or remove it, then run this again.`);
      return end(2);
    }
    for (const e of entries)
      if (e?.name)
        found.push({ path: join(home, 'blueprints', e.name), spec: e.spec ?? null, from: 'index' });
  }
  if (existsSync(legacyRoot))
    for (const id of readdirSync(legacyRoot).filter((d) => !d.startsWith('.')))
      found.push({ path: join(legacyRoot, id), spec: null, id, from: 'legacy' });

  if (!found.length) {
    console.log('Nothing to migrate — no homes from the old layout under ' + home);
    return end(0);
  }

  const { config } = readUserConfig();
  /*
   * One home per entry, even here. Two old layouts could each hold records
   * for the same project - a home the index recorded by spec, and an older
   * name-keyed one beside it - and writing both into one entry left that
   * blueprint with its evidence in one directory and its drafts in another,
   * which is the split this rule exists to prevent (n-0141). The first is
   * written down; the second is reported for a person to settle, because
   * which of two ledgers is the real one is not a guess a tool should make.
   */
  const spokenFor = new Set();
  const doc = existsSync(configPath())
    ? parseDocument(readFileSync(configPath(), 'utf8'))
    : parseDocument('');
  if (!doc.get('projects')) doc.set('projects', doc.createNode([]));
  const projects = doc.get('projects');
  let written = 0;

  for (const h of found) {
    /*
     * Which entry does this home belong to? Its spec, when the index recorded
     * one; otherwise the entry whose id matches the directory's name, which
     * is exactly what the name-keyed layout meant. A home nothing claims is
     * reported and left alone - guessing is the mistake this replaces.
     */
    const entry = (config.projects ?? []).find((p) =>
      h.spec ? p?.spec && expand(p.spec) === expand(h.spec) : p?.id === h.id,
    );
    if (!entry) {
      console.log(`  ${yellow('? left')}     ${h.path}`);
      console.log(dim(`             no config entry claims it — add one, or delete the directory`));
      continue;
    }
    if (spokenFor.has(entry.id)) {
      console.log(`  ${yellow('? left')}     ${h.path}`);
      console.log(
        dim(`             \`${entry.id}\` already has a home recorded — say which is the real one`),
      );
      continue;
    }
    const item = (projects.items ?? []).find((it) => String(it.get?.('id') ?? '') === entry.id);
    if (!item) continue;
    let touched = false;
    for (const kind of ['evidence', 'drafts']) {
      const already = item.get(kind);
      const at = join(h.path, kind);
      if (already || !existsSync(at)) continue;
      item.set(kind, at);
      touched = true;
    }
    if (!touched) {
      console.log(`  ${dim('· already said')} ${h.path}`);
      spokenFor.add(entry.id);
      continue;
    }
    spokenFor.add(entry.id);
    written++;
    console.log(`  ${green('→ recorded')} ${h.path}`);
    console.log(dim(`             now named by entry \`${entry.id}\` — nothing moved`));
  }

  if (written) writeFileSync(configPath(), String(doc));
  console.log(
    `\n  ${written} home${written === 1 ? '' : 's'} written into ${configPath()}.` +
      (existsSync(index)
        ? `\n  ${dim(`${index} is no longer read. Delete it when you are satisfied — it is your record, not ours.`)}`
        : ''),
  );
  return end(0);
}
