/*
 * `walkdown blueprints forget` and `walkdown blueprints list`.
 *
 * The registry is the only door (ADR 0003), and these read and shorten it.
 * Registering is `walkdown blueprints import` (import.js) and making is
 * `walkdown blueprints new`; a row here is the whole of a registration, so
 * forgetting one is the whole of forgetting and touches no file (ADR 0014).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  canon,
  expand,
  findHomes,
  forgetFromRegistry,
  nameOf,
  projectsDir,
  readRegistry,
  readUserConfig,
  registryPath,
  tilde,
  within,
} from '../../lib/locations.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { end } from './context.js';

/** How old an ephemeral entry has to be before it is worth mentioning. */
const STALE_DAYS = 2;

const days = (iso) => (Date.now() - Date.parse(iso ?? '')) / 86400000;

export function forget(args) {
  const want = args[0];
  if (!want) {
    console.error('walkdown blueprints forget needs a blueprint id.');
    return end(2);
  }
  /*
   * By its ID, or by its description among the rows of the project standing
   * here - the same two spellings `--blueprint` takes.
   */
  const rows = readRegistry().rows.filter((r) => r?.registered && r.home);
  const here = canon(process.cwd());
  let row = rows.find((r) => String(r.id) === want);
  if (!row) {
    const named = rows.filter(
      (r) => nameOf(r.id) === want && r.checkout && within(here, canon(expand(String(r.checkout)))),
    );
    if (named.length > 1) {
      console.error(red(`${named.length} blueprints here are called \`${want}\` (${named.map((r) => r.id).join(', ')}) — name one by its ID.`));
      return end(2);
    }
    row = named[0];
  }
  if (!row) {
    console.error(`No blueprint \`${want}\` in ${tilde(registryPath())}. \`walkdown blueprints\` lists them.`);
    return end(2);
  }
  // The registry is the only door (ADR 0003): a row there is the whole
  // registration, and taking it away is the whole forgetting.
  forgetFromRegistry({ id: String(row.id) });
  const home = canon(expand(String(row.home)));
  console.log(`  ${green('- forgotten')} \`${row.id}\`  ${dim(tilde(registryPath()))}`);
  console.log(dim('            Its files are untouched — only the registration is gone.'));
  /*
   * A committed home is still in its repository, and importing it again
   * brings it back. A personal one is in nobody's repository and nothing
   * will ever mention it again, so it is named, with how to delete it.
   */
  if (within(home, canon(projectsDir())))
    console.log(dim(`            ${tilde(home)} is still on disk and nothing else will mention it; \`rm -rf ${tilde(home)}\` deletes it.`));
  return end(0);
}

export function list(args) {
  const { values } = parseArgs({ args, options: { stale: { type: 'boolean', default: false } } });
  const { config } = readUserConfig();
  const all = (config.blueprints ?? []).filter((p) => p?.spec);
  const live = all.filter((p) => !p?.ephemeral);
  const scratch = all.filter((p) => p?.ephemeral);
  if (!all.length) {
    console.log(dim('No blueprints. `walkdown blueprints new` starts one, `walkdown blueprints import <path>` registers one.'));
    return end(0);
  }
  const width = Math.max(14, ...all.map((p) => String(p.id).length));
  const row = (p, pad = '  ') => {
    const missing = p.spec && !existsSync(expand(p.spec)) ? red('  (gone)') : '';
    console.log(`${pad}${String(p.id).padEnd(width)} ${tilde(expand(p.spec ?? ''))}${missing}`);
  };
  if (!values.stale)
    for (const label of [...new Set(live.map((p) => p.label ?? '—'))]) {
      console.log(dim(`  ${label}`));
      for (const p of live.filter((q) => (q.label ?? '—') === label)) row(p, '    ');
    }
  /*
   * And the homes standing where no row names them.
   *
   * Reported, never adopted (n-0219): which project a stranded home belongs
   * to is a guess, and a name is not a claim. This says what is standing
   * there and leaves the decision, an import included, to a person.
   */
  const claimed = new Set(all.map((p) => canon(expand(String(p.spec)))));
  const places = [
    ...new Set(live.map((p) => p.checkout).filter(Boolean)),
  ].map((c) => [c, findHomes(c).homes.map((h) => h.dir)]);
  if (existsSync(projectsDir()))
    for (const label of readdirSync(projectsDir())) {
      const dir = join(projectsDir(), label, 'blueprints');
      if (existsSync(dir)) places.push([dir, findHomes(dir, { flat: true }).homes.map((h) => h.dir)]);
    }
  for (const [where, homes] of places) {
    const orphans = homes.filter((h) => !claimed.has(canon(h)));
    if (!orphans.length) continue;
    console.log(yellow(`\n  ${orphans.length} blueprint folder(s) in ${tilde(where)} that no registry row names:`));
    for (const d of orphans) console.log(`    ${tilde(d)}`);
    console.log(dim('    Left standing, and not guessed at. `walkdown blueprints import <folder>` registers one.'));
  }
  if (scratch.length) {
    console.log(`\n  ${dim('Ephemeral')}`);
    for (const p of scratch) {
      const old = days(p.declared) >= STALE_DAYS;
      if (values.stale && !old) continue;
      row(p, '    ');
      const age = p.declared ? `${Math.round(days(p.declared) * 24)}h ago` : 'undated';
      const why = p.why ? ` · "${p.why}"` : '';
      console.log(`      ${dim(age + why)}${old ? yellow(' · stale') : ''}`);
    }
  }
  return end(0);
}
