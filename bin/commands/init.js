import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultActor } from '../../lib/identity.js';
import { rememberIdentity, rememberProject, resolveLocations } from '../../lib/locations.js';
import { dim, green, yellow } from '../../lib/report/tty.js';

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      force: { type: 'boolean', default: false },
      'in-repo': { type: 'boolean', default: false },
    },
  });
  const { scaffold } = await import('../../lib/init.js');
  const root = resolve(values.dir ?? process.cwd());
  /*
   * The spec goes outside the repository unless asked otherwise. Adopting
   * walkdown should cost a project nothing and be undone by deleting one
   * directory - and runs and threads follow the spec, so this one flag decides
   * all three. Evidence and drafts are outside either way.
   */
  const specDir = values['in-repo']
    ? join(root, 'blueprint')
    : resolveLocations({ cwd: root }).spec.path;
  const results = scaffold(root, { force: values.force, specDir });
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
    inRepo: values['in-repo'],
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
    const outside = where.action === 'spec-outside';
    console.log(`\n  spec: ${where.path}`);
    console.log(
      dim(
        outside
          ? '  Outside the repository, so walkdown has added nothing to your tree but' +
              ' agent conventions. Runs and threads live beside it; evidence and drafts' +
              ' stay out either way.'
          : '  In the repository, where a rule change arrives as a diff somebody approves.' +
              ' Runs and threads live beside it; evidence and drafts stay outside.',
      ),
    );
    if (outside)
      console.log(
        dim(
          '  Prefer it committed? `walkdown init --in-repo`, or move it later' +
            ' with `walkdown move`.',
        ),
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
