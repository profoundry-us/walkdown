/*
 * `walkdown blueprint forget`, `walkdown blueprints`, and the bare-home half
 * of `walkdown import` (`add`, called from import.js).
 *
 * It was `walkdown project` until ADR 0001, which is exactly the confusion
 * that ADR is about: what this declares is a BLUEPRINT - a specification with
 * its own storyboard, rules, threads and runs - and what a person means by a
 * project is the repository those live in. `walkdown import` is the command
 * about projects.
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
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  canon,
  expand,
  forgetFromRegistry,
  readRegistry,
  registryPath,
  HOME_LAYOUT,
  KINDS,
  readUserConfig,
  rememberBlueprint,
  walkdownHome,
} from '../../lib/locations.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { end } from './context.js';

const HELP = `walkdown blueprint forget <id>
walkdown blueprints [--stale]

(\`walkdown import <path>\` is how a blueprint joins the registry — a project, or one bare home.)`;

/** How old an ephemeral entry has to be before it is worth mentioning. */
const STALE_DAYS = 2;

const days = (iso) => (Date.now() - Date.parse(iso ?? '')) / 86400000;

export function add(args) {
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
    console.error('walkdown blueprint add needs a path to a blueprint.');
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
   * Where the home stands says what it is (ADR 0003 §3). A numbered home
   * under some `<project>/.walkdown/blueprints/` is that project's - the
   * row carries the project, and standing in the checkout reaches it. A
   * home standing anywhere else is a copy, and a copy is what `--ephemeral`
   * lists: no project, reachable by name only.
   */
  const project = /\/\.walkdown\/blueprints\/\d{4}-[^/]+$/.test(homeDir)
    ? resolve(homeDir, '..', '..', '..')
    : null;
  /*
   * A COPY MEANS A COPY. `--ephemeral` used to accept an original, and an
   * ephemeral entry's records follow its spec - so the "throwaway copy" was
   * the live ledger with a second name, and a root server's pin landed in it
   * (q-0176). A project's own numbered home is refused; a path no project
   * owns, such as a copy under `.walkdown/tmp/`, is what this flag is for.
   */
  if (project && values.ephemeral) {
    console.error(
      red(
        `${spec} is ${project}'s own blueprint — an ephemeral entry is for a throwaway COPY, and this is the original. Copy it somewhere no project owns (${join(project, '.walkdown', 'tmp', '<label>')}, say) and list the copy.`,
      ),
    );
    return end(2);
  }
  if (!project && !values.ephemeral) {
    console.error(
      red(
        `${homeDir} is not a numbered home under any project's .walkdown/blueprints/ — a registered blueprint lives in one (\`walkdown init\` lays one out, \`walkdown import <project>\` registers what a checkout declares). A copy standing elsewhere is listed with --ephemeral.`,
      ),
    );
    return end(2);
  }
  for (const kind of KINDS) mkdirSync(join(homeDir, HOME_LAYOUT[kind]), { recursive: true });
  // The registry is the list (ADR 0003): a home already registered under any
  // spelling is already listed.
  const registered = readRegistry().rows.find(
    (r) => r.home && canon(expand(String(r.home))) === canon(homeDir),
  );
  if (registered) {
    console.log(`  ${dim('· already listed')} ${spec}  ${dim(`as \`${registered.id}\``)}`);
    return end(0);
  }
  const name = values.id ?? basename(homeDir).replace(/^\d{4}-/, '');
  const taken = new Set(readRegistry().rows.map((r) => r?.id).filter(Boolean));
  let id = name;
  for (let n = 2; taken.has(id); n++) id = `${name}-${n}`;
  let written;
  try {
    written = rememberBlueprint({
      id,
      root: project,
      homeDir,
      home: project ? basename(homeDir) : null,
      inRepo: false,
      by: 'import',
      ...(values.ephemeral ? { ephemeral: { why: values.why ?? '' } } : {}),
    });
  } catch (e) {
    console.error(red(e.message));
    return end(2);
  }
  console.log(`  ${green('+ listed')}   ${spec}  ${dim(`as \`${written.id}\``)}`);
  console.log(`  ${dim(`            in ${written.path}${values.ephemeral ? ' · ephemeral' : ''}`)}`);
  return end(0);
}

function forget(args) {
  const id = args[0];
  if (!id) {
    console.error('walkdown blueprint forget needs a blueprint id.');
    return end(2);
  }
  // The registry is the only door (ADR 0003): a row there is the whole
  // registration, and taking it away is the whole forgetting.
  if (!forgetFromRegistry({ id })) {
    console.error(`No blueprint \`${id}\` in ${registryPath()}. \`walkdown blueprints\` lists them.`);
    return end(2);
  }
  console.log(`  ${green('- forgotten')} \`${id}\`  ${dim(registryPath())}`);
  console.log(dim('            Its records are untouched — only the registration is gone.'));
  return end(0);
}

export function list(args) {
  const { values } = parseArgs({ args, options: { stale: { type: 'boolean', default: false } } });
  const { config } = readUserConfig();
  const all = (config.blueprints ?? []).filter((p) => p?.spec);
  const live = all.filter((p) => !p?.ephemeral);
  const scratch = all.filter((p) => p?.ephemeral);
  if (!all.length) {
    console.log(dim('No blueprints. `walkdown init` starts one, `walkdown import <project>` registers one.'));
    return end(0);
  }
  const row = (p, pad = '  ') => {
    const missing = p.spec && !existsSync(expand(p.spec)) ? red('  (gone)') : '';
    console.log(`${pad}${String(p.id).padEnd(14)} ${expand(p.spec ?? '')}${missing}`);
  };
  if (!values.stale) for (const p of live) row(p);
  /*
   * And the homes standing in the .walkdown that no row names.
   *
   * "A home nothing claims is reported and left standing, never guessed at
   * and never moved" is the rule's own step, and only the second half of it
   * was true: an unclaimed home stood there and appeared in no output at all.
   * That is what made the config's unserialised read-modify-write invisible -
   * six concurrent inits made six homes and three rows, every process exited
   * 0 saying which home was its own, and nothing anywhere afterwards
   * mentioned the three with no row (n-0219).
   *
   * Reported, never adopted. Which checkout a stranded home belonged to is
   * exactly the guess the same step forbids - a name is not a claim, and two
   * blueprints can share one - so this says what is standing there and leaves
   * the decision, `blueprint add` included, to a person.
   */
  const projects = [...new Set(all.map((p) => p.project).filter(Boolean))];
  for (const [walkdown, label] of [
    [walkdownHome(), 'your own'],
    ...projects.map((root) => [join(root, '.walkdown'), `${root}'s`]),
  ]) {
    const homes = walkdown ? join(walkdown, 'blueprints') : null;
    if (!homes || !existsSync(homes)) continue;
    // A home is claimed by the row whose spec it holds - or by a row that
    // moved one kind of record into it (`evidence: ~/.walkdown/blueprints/
    // 0001-x/evidence` on a row whose home is in a checkout is that home's
    // claim on the directory, not a stranded home).
    const claimed = new Set(
      all.flatMap((p) => [
        p.spec && canon(dirname(expand(String(p.spec)))),
        ...KINDS.map((k) => p[k] && canon(dirname(expand(String(p[k]))))),
      ]).filter(Boolean),
    );
    const orphans = readdirSync(homes)
      .filter((d) => /^\d{4}-/.test(d))
      .filter((d) => !claimed.has(canon(join(homes, d))));
    if (!orphans.length) continue;
    console.log(
      yellow(`\n  ${orphans.length} home(s) in ${label} .walkdown that no entry names:`),
    );
    for (const d of orphans) console.log(`    ${join(homes, d)}`);
    console.log(
      dim(
        '    Left standing, and not guessed at — walkdown will not decide which checkout\n' +
          '    they belong to. `walkdown import <home>` registers one if you know.',
      ),
    );
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

export function run(args) {
  const [verb, ...rest] = args;
  if (verb === 'forget') return forget(rest);
  // ONE ADD (ADR 0003 §3): `import` takes a project or a bare home, and
  // `blueprint add` was the second door to the same registry.
  if (verb === 'add') {
    console.error(red('`walkdown blueprint add` is `walkdown import <path>` now — one door into the registry.'));
    console.error(HELP);
    return end(2);
  }
  if (!verb) {
    console.error(HELP);
    return end(2);
  }
  console.error(`walkdown blueprint: no such action "${verb}".`);
  console.error(HELP);
  return end(2);
}
