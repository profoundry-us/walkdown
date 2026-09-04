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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  canon,
  configPath,
  expand,
  HOME_LAYOUT,
  KINDS,
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
  /*
   * A path to a home, or to the blueprint inside one - either spelling names
   * the same thing. Every blueprint walkdown answers for lives in a home:
   * `blueprint/` with threads, runs, evidence and drafts beside it, the
   * layout `init` lays out. A bare `<dir>/blueprint` keeping records inside
   * itself was the layout from before homes, and it is not read any more;
   * listing one would write an entry the resolver cannot finish. It is
   * refused with the shape spelled out, since the fix is a copy of the
   * whole home, not a rename.
   */
  /*
   * Canonical from the start. A person may type `/var/...` where the process
   * knows the same directory as `/private/var/...`, and the entry is written
   * RELATIVE to the repository - so an uncanonical path came out as a string
   * of `../..` climbing out of the tree and back in (the n-0169 shape, one
   * spelling over).
   */
  const named = canon(expand(at, process.cwd()));
  const homeDir = existsSync(join(named, 'walkdown.yml'))
    ? resolve(named, '..')
    : existsSync(join(named, HOME_LAYOUT.spec, 'walkdown.yml'))
      ? named
      : null;
  const spec = homeDir ? join(homeDir, HOME_LAYOUT.spec) : null;
  if (!homeDir || basename(spec) !== HOME_LAYOUT.spec || !existsSync(join(spec, 'walkdown.yml'))) {
    console.error(
      red(
        `No home at ${at} — every blueprint walkdown answers for lives in one: ${HOME_LAYOUT.spec}/ with ${KINDS.join(', ')} beside it. \`walkdown init\` lays one out, and a copy is a copy of the whole home.`,
      ),
    );
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
  const own = walkdownRoot(homeDir);
  const here = walkdownRoot();
  /*
   * Compared canonically: `own` is walked from the spelling the person
   * typed and `here` from process.cwd(), which is the real path, and on
   * macOS /tmp is /private/tmp - so naming a pack's own blueprint through
   * the other spelling refused it as lying under itself (n-0177).
   */
  const same = (a, b) => Boolean(a) && Boolean(b) && canon(a) === canon(b);
  const listedIn = (walkdown) => {
    const rows = load(join(walkdown, 'config.yml')).get('projects');
    return (rows?.items ?? []).find(
      (it) =>
        String(it.get?.('spec') ?? '') &&
        canon(expand(String(it.get('spec')), resolve(walkdown, '..'))) === canon(spec),
    );
  };
  if (own && !values.ephemeral && !same(own, here)) {
    const there = listedIn(own);
    /*
     * That `.walkdown` is the one that answers for it, listed there already
     * or not (q-0168): a committed entry from here would be the boundary
     * crossing one-walkdown-answers forbids, so it is refused rather than
     * written and contained.
     */
    console.error(
      red(
        `${spec} lies under ${own}, which answers for it${there ? ` (listed there as \`${there.get('id')}\`)` : ''} — stand in that checkout to use it, declare it there, or list a throwaway COPY of it with --ephemeral.`,
      ),
    );
    return end(2);
  }
  /*
   * A COPY MEANS A COPY. `--ephemeral` used to accept the very spec the
   * refusal above pointed away from, and an ephemeral entry's records follow
   * its spec - so for a pack that keeps its ledger inside its blueprint, the
   * "throwaway copy" was the pack's live ledger with a second name, and a
   * root server's pin landed in it (q-0176). A blueprint some `.walkdown`
   * declares - listed in its config, or standing in one of its numbered
   * homes - is refused; a path nothing declares, such as a copy under
   * `.walkdown/tmp/`, is what this flag is for.
   */
  if (own && values.ephemeral) {
    const there = listedIn(own);
    const inHome = spec.startsWith(join(own, 'blueprints') + '/');
    if (there || inHome) {
      console.error(
        red(
          `${spec} is ${own}'s own blueprint${there ? ` (listed there as \`${there.get('id')}\`)` : ''} — an ephemeral entry is for a throwaway COPY, and this is the original. Copy it somewhere nothing declares (${join(own, 'tmp', '<label>', 'blueprint')}, say) and list the copy.`,
        ),
      );
      return end(2);
    }
  }
  const wd = values.ephemeral ? walkdownHome() : (here ?? walkdownHome());
  const inRepo = !values.ephemeral && wd !== walkdownHome();
  /*
   * A listed home is a numbered one under the `.walkdown` that answers for
   * it - that is what `home:` in the entry names, and what every other
   * writer keeps. A home standing anywhere else is a copy, and a copy is
   * what `--ephemeral` lists.
   */
  if (!values.ephemeral && canon(resolve(homeDir, '..')) !== canon(join(wd, 'blueprints'))) {
    console.error(
      red(
        `${homeDir} is not one of ${join(wd, 'blueprints')}'s homes — a listed blueprint lives in a numbered home there (\`walkdown init\` lays one out). A copy standing elsewhere is listed with --ephemeral.`,
      ),
    );
    return end(2);
  }
  for (const kind of KINDS) mkdirSync(join(homeDir, HOME_LAYOUT[kind]), { recursive: true });
  const target = join(wd, 'config.yml');
  const doc = load(target);
  const projects = doc.get('projects');
  /*
   * Against the file's own base - the repository for a committed file, and
   * nothing for the personal one, whose paths are absolute. Expanded against
   * the `.walkdown` directory, `.walkdown/blueprints/...` became
   * `.walkdown/.walkdown/blueprints/...` and a blueprint the file already
   * listed was listed again (n-0178).
   */
  const listed = (projects.items ?? []).find(
    (it) =>
      String(it.get?.('spec') ?? '') &&
      canon(expand(String(it.get('spec')), inRepo ? resolve(wd, '..') : undefined)) === canon(spec),
  );
  if (listed) {
    console.log(`  ${dim('· already listed')} ${spec}  ${dim(`as \`${listed.get('id')}\``)}`);
    return end(0);
  }
  const name = values.id ?? basename(homeDir).replace(/^\d{4}-/, '');
  const taken = new Set(
    (readUserConfig().config.projects ?? []).map((p) => p?.id).filter(Boolean),
  );
  let id = name;
  for (let n = 2; taken.has(id); n++) id = `${name}-${n}`;
  /*
   * Written by the same hand as init's entry, which is what keeps a
   * committed entry relative to its repository and a personal one spelled
   * with `~` (n-0169). The home implies every record path; nothing is
   * claimed, since the directory already stands, and an ephemeral copy
   * carries no `home:` because it is nobody's numbered home.
   */
  let written;
  try {
    written = rememberProject({
      id,
      root: values.ephemeral ? null : resolve(wd, '..'),
      base: inRepo ? resolve(wd, '..') : null,
      homeDir,
      home: values.ephemeral ? null : basename(homeDir),
      inRepo,
      ...(values.ephemeral
        ? { extra: { ephemeral: true, declared: new Date().toISOString(), why: values.why ?? '' } }
        : {}),
    });
  } catch (e) {
    console.error(red(e.message));
    console.error(dim('  `walkdown project add <copy> --ephemeral` lists a throwaway copy in ~/.walkdown instead.'));
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
