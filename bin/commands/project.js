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
  const wd = values.ephemeral ? walkdownHome() : (walkdownRoot() ?? walkdownHome());
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
   * Where its records already are. A blueprint that predates homes keeps its
   * runs and threads inside the spec directory; one built as a home keeps
   * them beside it. Whichever it is, the entry says so outright, so nothing
   * downstream has to guess which shape it is looking at.
   */
  const beside = (kind) =>
    existsSync(join(spec, kind)) ? join(spec, kind) : join(resolve(spec, '..'), kind);
  projects.add(
    doc.createNode({
      id,
      spec,
      runs: beside('runs'),
      threads: beside('threads'),
      home: claim.home,
      ...(values.ephemeral
        ? { ephemeral: true, declared: new Date().toISOString(), why: values.why ?? '' }
        : { roots: [resolve(spec, '..')] }),
    }),
  );
  writeFileSync(target, String(doc));
  console.log(`  ${green('+ listed')}   ${spec}  ${dim(`as \`${id}\``)}`);
  console.log(`  ${dim(`            in ${target}${values.ephemeral ? ' · ephemeral' : ''}`)}`);
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
