/*
 * `walkdown project add|forget`, and `walkdown projects`.
 *
 * WHY THIS EXISTS AND `--dir` DOES NOT (n-0156, and the six threads before it).
 *
 * There used to be two ways to reach a blueprint: declared in a config, or
 * named on the command line with `--dir`. Two ways to answer one question is
 * two answers to keep in agreement, and they did not stay in agreement - the
 * named-but-undeclared blueprint was a second-class citizen with no entry, so
 * it needed a home derived from a NAME, and names collide. That derivation is
 * the ancestor of every locations defect this project has had.
 *
 * So there is one way now. A blueprint walkdown answers for is one somebody
 * wrote down, and this is how you write one down that `init` did not create -
 * a clone, a copy, somebody else's checkout. `init` still writes its own
 * entry, so this is for blueprints that arrive rather than blueprints that
 * are made.
 *
 * `--ephemeral` is for a copy that is not meant to outlive the afternoon: a
 * scratch blueprint a judging agent works against. It is declared like
 * anything else, because an undeclared one is exactly the ghost this file
 * exists to abolish - and it is marked, given no `roots`, and written only to
 * the personal config, so it is reachable by name and never by standing
 * somewhere. A scratch copy lives inside the project it is a copy of; a
 * rooted entry would shadow the real thing from the person's own working
 * directory.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  claimHome,
  configPath,
  expand,
  readUserConfig,
  rememberProject,
  walkdownHome,
  walkdownRoot,
} from '../../lib/locations.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { parseDocument } from '../../vendor/yaml.js';
import { end } from './context.js';

const HELP = `walkdown project add <path> [--id <name>] [--ephemeral] [--why <reason>]
walkdown project forget <id>
walkdown projects [--stale]`;

/** How old an ephemeral entry has to be before it is worth mentioning. */
const STALE_DAYS = 2;

const days = (iso) => (Date.now() - Date.parse(iso ?? '')) / 86400000;

function load(path, header = '') {
  const doc = existsSync(path) ? parseDocument(readFileSync(path, 'utf8')) : parseDocument(header);
  if (!doc.get('projects')) doc.set('projects', doc.createNode([]));
  return doc;
}

function add(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      ephemeral: { type: 'boolean', default: false },
      why: { type: 'string' },
    },
  });
  const at = positionals[0];
  if (!at) {
    console.error('walkdown project add needs a path to a blueprint.');
    console.error(HELP);
    return end(2);
  }
  const spec = expand(at, process.cwd());
  if (!existsSync(join(spec, 'walkdown.yml'))) {
    console.error(`No blueprint at ${at} — no walkdown.yml there.`);
    return end(2);
  }
  /*
   * Which `.walkdown` takes it. An ephemeral copy always goes in the personal
   * one: it is a fact about this afternoon on this disk, and a clone should
   * never inherit somebody's scratch directory. Anything else goes in the
   * `.walkdown` that answers where you are standing, so a declaration a team
   * shares travels with the checkout.
   */
  /*
   * A blueprint whose own checkout declares it is already a project there,
   * and listing it again from outside minted a second entry and an empty
   * second home for the same spec (n-0170, G2). Say so and stop; standing in
   * that checkout is how it is reached.
   */
  const own = walkdownRoot(resolve(spec, '..'));
  if (own && !values.ephemeral && own !== walkdownRoot()) {
    const theirs = load(join(own, 'config.yml')).get('projects');
    const there = (theirs?.items ?? []).find(
      (it) => String(it.get?.('spec') ?? '') && expand(String(it.get('spec')), resolve(own, '..')) === spec,
    );
    /*
     * That `.walkdown` is the one that answers for it, listed there already
     * or not (q-0168): a committed entry from here would be the boundary
     * crossing one-walkdown-answers forbids, so it is refused rather than
     * written and contained.
     */
    console.error(
      red(
        `${spec} lies under ${own}, which answers for it${there ? ` (listed there as \`${there.get('id')}\`)` : ''} — stand in that checkout to use it, declare it there, or list a throwaway copy with --ephemeral.`,
      ),
    );
    return end(2);
  }
  const wd = values.ephemeral ? walkdownHome() : (walkdownRoot() ?? walkdownHome());
  const inRepo = !values.ephemeral && wd !== walkdownHome();
  const target = join(wd, 'config.yml');
  const doc = load(target);
  const projects = doc.get('projects');
  const listed = (projects.items ?? []).find(
    (it) => String(it.get?.('spec') ?? '') && expand(String(it.get('spec')), wd) === spec,
  );
  if (listed) {
    console.log(`  ${dim('· already listed')} ${spec}  ${dim(`as \`${listed.get('id')}\``)}`);
    return end(0);
  }
  const name = values.id ?? basename(resolve(spec, '..'));
  const taken = new Set(
    (readUserConfig().config.projects ?? []).map((p) => p?.id).filter(Boolean),
  );
  let id = name;
  for (let n = 2; taken.has(id); n++) id = `${name}-${n}`;
  const claim = claimHome({ name: id, walkdown: wd });
  /*
   * Where its records go: into the home just claimed, beside nothing - the
   * spec stands where it already stands. A blueprint that predates homes
   * and keeps runs or threads inside itself keeps them there, and the entry
   * says so outright rather than leaving anything downstream to guess.
   *
   * Written by the same hand as init's entry, which is what keeps a
   * committed entry relative to its repository and a personal one spelled
   * with `~`. This used to write absolute paths into the committed file and
   * send runs and threads to the blueprint's parent, a directory the home it
   * named never read (n-0169).
   */
  const records = Object.fromEntries(
    ['runs', 'threads', 'evidence', 'drafts']
      .filter((kind) => existsSync(join(spec, kind)))
      .map((kind) => [kind, join(spec, kind)]),
  );
  let written;
  try {
    written = rememberProject({
      id,
      root: values.ephemeral ? null : resolve(spec, '..'),
      base: inRepo ? resolve(wd, '..') : null,
      spec,
      homeDir: claim.dir,
      home: claim.home,
      inRepo,
      records,
      ...(values.ephemeral
        ? { extra: { ephemeral: true, declared: new Date().toISOString(), why: values.why ?? '' } }
        : {}),
    });
  } catch (e) {
    console.error(red(e.message));
    console.error(dim('  `walkdown project add <path> --ephemeral` lists it in ~/.walkdown instead.'));
    return end(2);
  }
  console.log(`  ${green('+ listed')}   ${spec}  ${dim(`as \`${written.id}\``)}`);
  console.log(`  ${dim(`            in ${written.path}${values.ephemeral ? ' · ephemeral' : ''}`)}`);
  return end(0);
}

function forget(args) {
  const id = args[0];
  if (!id) {
    console.error('walkdown project forget needs a project id.');
    return end(2);
  }
  let removed = false;
  for (const path of [configPath(), walkdownRoot() && join(walkdownRoot(), 'config.yml')]) {
    if (!path || !existsSync(path)) continue;
    const doc = load(path);
    const projects = doc.get('projects');
    const i = (projects.items ?? []).findIndex((it) => String(it.get?.('id') ?? '') === id);
    if (i < 0) continue;
    projects.delete(i);
    writeFileSync(path, String(doc));
    console.log(`  ${green('- forgotten')} \`${id}\`  ${dim(path)}`);
    console.log(dim('            Its records are untouched — only the declaration is gone.'));
    removed = true;
  }
  if (!removed) {
    console.error(`No project \`${id}\` in either config. \`walkdown projects\` lists them.`);
    return end(2);
  }
  return end(0);
}

export function list(args) {
  const { values } = parseArgs({ args, options: { stale: { type: 'boolean', default: false } } });
  const { config, shadowed } = readUserConfig();
  /*
   * An entry with no spec is not a blueprint: it is a personal override of a
   * repository's entry - evidence on this disk, a port - and it lists as that
   * repository's project wherever that repository answers. Standing anywhere
   * else there is nothing to list under it.
   */
  const all = (config.projects ?? []).filter((p) => p?.spec);
  const live = all.filter((p) => !p?.ephemeral);
  const scratch = all.filter((p) => p?.ephemeral);
  if (!all.length) {
    console.log(dim('No projects. `walkdown init` starts one, `walkdown project add` lists one.'));
    return end(0);
  }
  const row = (p, pad = '  ') => {
    const missing = p.spec && !existsSync(expand(p.spec)) ? red('  (gone)') : '';
    console.log(`${pad}${String(p.id).padEnd(14)} ${expand(p.spec ?? '')}${missing}`);
  };
  if (!values.stale) for (const p of live) row(p);
  // A personal entry sharing a name with one this repository declares, and
  // rooted elsewhere: a different project, reachable from its own checkout,
  // and not silently merged into this one (n-0160).
  if (shadowed?.length && !values.stale)
    console.log(
      dim(
        `\n  ${shadowed.length} personal entr${shadowed.length === 1 ? 'y' : 'ies'} shadowed here by this repository's: ${shadowed.join(', ')}`,
      ),
    );
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

export function run(args) {
  const [verb, ...rest] = args;
  if (verb === 'add') return add(rest);
  if (verb === 'forget') return forget(rest);
  if (!verb) {
    console.error(HELP);
    return end(2);
  }
  console.error(`walkdown project: no such action "${verb}".`);
  console.error(HELP);
  return end(2);
}
