import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultActor } from '../../lib/identity.js';
import {
  claimHome,
  expand,
  readUserConfig,
  rememberIdentity,
  rememberProject,
} from '../../lib/locations.js';
import { dim, green, yellow } from '../../lib/report/tty.js';

/*
 * WHAT VERSION CONTROL SEES, as three standards rather than a pile of
 * negations (locations.default.in-repo-on-request, n-0157).
 *
 * The whole `.walkdown` is beside the code and out of git by default, so
 * trying walkdown adds nothing to anybody's history and abandoning it is one
 * `rm -rf`. Committing is a decision, and there are two worth offering.
 *
 * These are written as ignore rules inside `.walkdown/` rather than appended
 * to the project's own .gitignore, which keeps the whole arrangement in one
 * directory a person can read at a glance - and keeps walkdown out of a file
 * it does not own.
 *
 * Written as they are for a reason worth not rediscovering: git does not
 * descend into an excluded directory, so "ignore everything, then re-include
 * some of it" needs negations in an order that is easy to get subtly wrong,
 * and a wrong one silently commits nothing or silently commits everything.
 * Ignoring only what is unwanted has no such failure mode.
 */
const IGNORE = {
  none: `# Everything walkdown makes for this project lives here, beside the code
# and out of git. \`walkdown init --commit spec\` (or \`--commit all\`) changes
# that; nothing else in your tree is touched either way.
*
`,
  spec: `# The spec and its conversations are committed; evidence and drafts are not.
# Screenshots are binary nobody reads in a diff, and a draft is one person's
# half-finished sitting.
blueprints/*/evidence/
blueprints/*/drafts/
`,
  all: `# Everything here is committed, evidence included — asked for outright with
# \`walkdown init --commit all\`. Note that git keeps every version of every
# screenshot forever, whether or not the working copy moves.
`,
};

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      force: { type: 'boolean', default: false },
      commit: { type: 'string' },
    },
  });
  const commit = values.commit ?? 'none';
  if (!IGNORE[commit]) {
    console.error(`walkdown init --commit takes none, spec or all — not "${commit}".`);
    console.error('  none  nothing is committed (the default)');
    console.error('  spec  the spec and its runs and threads');
    console.error('  all   everything, evidence included');
    return process.exit(2);
  }
  const { scaffold } = await import('../../lib/init.js');
  const root = resolve(values.dir ?? process.cwd());
  /*
   * The project's own `.walkdown`, and a numbered home inside it. One layout
   * whichever way the commit question is answered - what changes is the
   * ignore rules, not where anything sits, so there is no second shape for a
   * reader (or a resolver) to learn.
   *
   * Decide the home FIRST, then build into it. This used to take the spec
   * path from resolveLocations, whose derived home was keyed on a name, and
   * let rememberProject pick a different one afterwards; the two answers then
   * disagreed in both directions (n-0141, n-0145).
   */
  const walkdown = join(root, '.walkdown');
  const fresh = !existsSync(walkdown);
  mkdirSync(walkdown, { recursive: true });
  const ignore = join(walkdown, '.gitignore');
  if (fresh || values.force || !existsSync(ignore)) writeFileSync(ignore, IGNORE[commit]);
  /*
   * Already set up? Then keep the home it has. Allocating unconditionally is
   * how `init` run twice in one project minted a second home and a second
   * entry, with the second blueprint read by nothing while the command told
   * the person to go fill it in (n-0145). The test is the project ROOT,
   * because that is what a repeat `init` is about - and it is exact, never
   * containment, since a pack inside a listed repository is its own question
   * and not one a claim should answer quietly (n-0135).
   */
  const here = expand(root);
  const listed = (readUserConfig({ cwd: root }).config.projects ?? []).find((p) =>
    [p?.roots ?? []].flat().some((r) => r && expand(r) === here),
  );
  const claim =
    listed?.home
      ? { home: String(listed.home), dir: join(walkdown, 'blueprints', String(listed.home)) }
      : claimHome({ name: basename(root), walkdown });
  const specDir = join(claim.dir, 'blueprint');
  const results = scaffold(root, { force: values.force, specDir, commit });
  /*
   * And write it down. Walkdown does not find blueprints by looking any more,
   * so a spec nobody declared is a directory rather than a project - init
   * would otherwise hand somebody a blueprint that `walkdown status` denies
   * the existence of. This is also why there is no adopt command: the entry
   * is written where it belongs, and a clone reads it from the repository.
   */
  const entry = rememberProject({
    id: basename(root),
    root,
    spec: specDir,
    inRepo: true,
    home: claim.home,
  });
  /*
   * And who is sitting here, if nobody has said. Every record is written
   * under the config's identity now and nothing else can name a person, so an
   * absent block is a wall rather than a default - work cannot be accepted on
   * a machine that only has a git email to go on. Setting it up is part of
   * being set up, which is what this command is.
   */
  const who = defaultActor(root);
  const me = rememberIdentity({ username: who.username, name: who.name });
  const MARK = {
    created: green('+ created'),
    updated: green('~ updated'),
    'pointer-appended': green('+ appended'),
    'pointer-updated': green('~ pointer updated'),
    'pointer-undecided': yellow('? several agent files — `walkdown pointer --into <file>`'),
    'skills-in-repo': dim('· skills'),
    'skills-personal': dim('· skills'),
    'up-to-date': dim('· up to date'),
    kept: dim('· kept'),
    'kept-differs': yellow('! kept (differs from packaged — --force to update)'),
  };
  const summary = (r) => r.action.startsWith('spec-') || r.action.startsWith('skills-');
  const placed = results.filter((r) => r.action.startsWith('spec-'));
  const skills = results.find((r) => r.action.startsWith('skills-'));
  for (const r of results.filter((r) => !summary(r)))
    console.log(`  ${MARK[r.action] ?? r.action}  ${r.path}`);

  /*
   * Say where it went, always. A tool that quietly puts a project's spec
   * somewhere the person did not look for it has not been polite, it has been
   * confusing - and half of what the setup wizard exists to do is this
   * sentence.
   */
  if (entry.action === 'written')
    console.log(`  ${green('+ listed')}   ${entry.path}  ${dim(`as \`${entry.id}\``)}`);
  if (me.action === 'written')
    console.log(`  ${green('+ you')}      ${me.path}  ${dim(`as \`${me.username}\``)}`);
  else if (me.action === 'unknown')
    console.log(
      `  ${yellow('? you')}      this machine offers no name — add \`identity:\` to ${me.path} before accepting work`,
    );

  const where = placed[0];
  if (where) {
    console.log(`\n  spec: ${where.path}`);
    console.log(
      dim(
        commit === 'none'
          ? '  Beside your code and out of git — walkdown has added nothing to your' +
              ' history. Deleting .walkdown/ undoes all of it.'
          : commit === 'spec'
            ? '  Committed, so a rule change arrives as a diff somebody approves, and a' +
              ' clone is a working project. Evidence and drafts stay out of git.'
            : '  Committed in full, evidence included. Note that git keeps every version' +
              ' of every screenshot forever, whether or not the working copy moves.',
      ),
    );
    if (commit === 'none')
      console.log(
        dim('  Prefer it committed? `walkdown init --commit spec`, or `--commit all`.'),
      );
  }
  /*
   * And where the procedures went, which is the other half of "what did this
   * just do to my repository". Skills follow the spec, so this line is usually
   * a consequence of the one above rather than a separate decision - but it is
   * the line a person scans for when they are worried about the answer.
   */
  if (skills) {
    console.log(`\n  skills: ${skills.path}`);
    console.log(
      dim(
        skills.action === 'skills-in-repo'
          ? '  In the repository, so a clone brings them. `walkdown skills` re-installs them anywhere.'
          : "  Yours, not this project's — they work in every project on this machine, and this" +
              ' repository gets nothing. `walkdown skills --project` commits them here instead.',
      ),
    );
  }
  if (results.some((r) => r.action === 'created')) {
    const cfg = join(where?.path ?? 'blueprint', 'walkdown.yml');
    console.log(`\nNext: fill in ${dim(cfg)} (runner commands, targets), sketch your`);
    console.log(`first feature from its ${dim('features/_template.yml')}, then \`walkdown lint\`.`);
    console.log(dim('`walkdown where` shows every path this project uses.'));
  }
}
