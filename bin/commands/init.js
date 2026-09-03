import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultActor } from '../../lib/identity.js';
import {
  canon,
  claimHome,
  expand,
  homePaths,
  readUserConfig,
  rememberIdentity,
  rememberProject,
  resolveLocations,
  walkdownHome,
} from '../../lib/locations.js';
import { relocateHome, removePointer, setIgnore, STANDARDS } from '../../lib/standard.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';

/*
 * `walkdown init`: a project, set up - and, run again with `--commit`, a
 * project moved between the three arrangements version control can be in.
 *
 * WHAT VERSION CONTROL SEES is not recorded anywhere; it is read off the tree
 * (lib/standard.js, n-0158). So this command's whole job with a standard is
 * to make the tree say it: put the home under the `.walkdown` the standard
 * needs, and write or delete the `.gitignore` beside it. Run with no
 * `--commit` on a project that exists, it keeps whatever the tree already
 * says, which is what makes it safe to run twice.
 */
export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      force: { type: 'boolean', default: false },
      commit: { type: 'string' },
    },
  });
  if (values.commit && !STANDARDS.includes(values.commit)) {
    console.error(`walkdown init --commit takes none, spec or all — not "${values.commit}".`);
    console.error('  none  the home lives in ~/.walkdown and the repository gets nothing (the default)');
    console.error('  spec  the home lives in .walkdown/; the spec and its threads are committed');
    console.error('  all   the same, and the runs and evidence are committed too');
    return process.exit(2);
  }
  const { removeSkills, scaffold } = await import('../../lib/init.js');
  const root = resolve(values.dir ?? process.cwd());

  /*
   * Already set up? Then keep the home it has. Allocating unconditionally is
   * how `init` run twice in one project minted a second home and a second
   * entry, with the second blueprint read by nothing while the command told
   * the person to go fill it in (n-0145). The test is the project ROOT,
   * because that is what a repeat `init` is about - and it is exact, never
   * containment, since a pack inside a listed repository is its own question
   * and not one a claim should answer quietly (n-0135).
   */
  const exact = () =>
    (readUserConfig({ cwd: root }).config.projects ?? []).find((p) =>
      [p?.roots ?? []].flat().some((r) => r && canon(expand(r)) === canon(root)),
    );
  let listed = exact();
  let loc = listed ? resolveLocations({ cwd: root, project: listed.id }) : null;
  const current = loc?.standard?.name ?? null;
  const commit = values.commit ?? current ?? 'none';

  /*
   * A change of standard that crosses the line - into the repository, or
   * back out - is a home moving. It moves whole, and the declarations follow
   * it; only then is the ignore file the question.
   */
  let moved = null;
  if (listed && current && (current === 'none') !== (commit === 'none')) {
    try {
      moved = relocateHome({ loc, root, to: commit === 'none' ? 'personal' : 'repo' });
    } catch (e) {
      console.error(red(e.message));
      return process.exit(2);
    }
    listed = exact();
    loc = resolveLocations({ cwd: root, project: listed.id });
  }

  /*
   * The home, decided FIRST and built into afterwards. This used to take the
   * spec path from one derivation and let the entry-writer pick another, and
   * the two disagreed in both directions (n-0141, n-0145). A project with no
   * home at all - a blueprint standing where it always stood, declared by
   * path - is scaffolded where it is and claims nothing.
   */
  const walkdown = commit === 'none' ? walkdownHome() : join(root, '.walkdown');
  const claim = listed
    ? { home: listed.home ? String(listed.home) : null, dir: loc.homeDir }
    : claimHome({ name: basename(root), walkdown });
  const specDir = listed ? loc.spec.path : homePaths(claim.dir).spec;
  const results = scaffold(root, { force: values.force, specDir, commit });
  /*
   * And write it down. Walkdown does not find blueprints by looking, so a
   * spec nobody declared is a directory rather than a project - init would
   * otherwise hand somebody a blueprint that `walkdown status` denies the
   * existence of. This is also why there is no adopt command: the entry is
   * written where it belongs, and a clone reads it from the repository.
   */
  const entry = listed
    ? { action: 'kept', id: listed.id }
    : rememberProject({
        id: basename(root),
        root,
        homeDir: claim.dir,
        home: claim.home,
        inRepo: commit !== 'none',
      });
  const ignore = commit === 'none' || !claim.dir ? null : setIgnore(walkdown, commit, { force: values.force });
  /*
   * What git STILL tracks under the standard just chosen. An ignore file is
   * a rule for files git has not met: a run committed under `all` stays in
   * the index after `--commit spec` writes the file, and this command said
   * "keeps runs, evidence and drafts out" over a tree where they were in -
   * the sentence about the index was printed only when a home had moved,
   * which the spec<->all flip never does (n-0164). So ask git, every time.
   */
  const tracked = commit === 'spec' && claim.dir ? stillTracked(root, claim.dir) : [];
  if (commit === 'none' && moved) {
    for (const rel of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', 'CONVENTIONS.md'])
      if (['removed', 'deleted'].includes(removePointer(join(root, rel))))
        results.push({ path: rel, action: 'pointer-removed' });
    // The skills leave with the spec, or the "repository gets nothing" line lies.
    for (const r of removeSkills(join(root, '.claude', 'skills')))
      results.push({ path: relative(root, r.path), action: `skill-${r.action}` });
  }
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
    'pointer-removed': green('- pointer removed'),
    'skill-removed': green('- removed'),
    'skill-kept-edited': yellow('! kept (edited here — it is yours now, and this repository keeps it)'),
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
  if (moved) {
    console.log(`  ${green('→ moved')}    ${moved.from}`);
    console.log(`  ${''.padEnd(10)} ${dim(`to ${moved.to} — the whole home, no record edited`)}`);
    for (const g of moved.gone) console.log(`  ${green('- removed')}  ${g}`);
  }
  for (const r of results.filter((r) => !summary(r)))
    console.log(`  ${MARK[r.action] ?? r.action}  ${r.path}`);
  if (ignore) {
    const IGN = {
      written: green('+ written'),
      'up-to-date': dim('· up to date'),
      removed: green('- removed'),
      absent: null,
      'kept-differs': yellow('! kept (yours differs from the spec standard — --force to rewrite)'),
    };
    if (IGN[ignore.action]) console.log(`  ${IGN[ignore.action]}  ${ignore.path}`);
  }

  /*
   * Say where it went, always. A tool that quietly puts a project's spec
   * somewhere the person did not look for it has not been polite, it has been
   * confusing - and half of what the setup wizard exists to do is this
   * sentence.
   */
  if (entry.action === 'written')
    console.log(`  ${green('+ listed')}   ${entry.path}  ${dim(`as \`${entry.id}\``)}`);
  else if (moved)
    console.log(`  ${green('~ listed')}   ${moved.config}  ${dim(`as \`${moved.id}\``)}`);
  if (me.action === 'written')
    console.log(`  ${green('+ you')}      ${me.path}  ${dim(`as \`${me.username}\``)}`);
  else if (me.action === 'unknown')
    console.log(
      `  ${yellow('? you')}      this machine offers no name — add \`identity:\` to ${me.path} before accepting work`,
    );

  const where = placed[0];
  if (where) {
    console.log(`\n  spec: ${where.path}`);
    const say = {
      none:
        '  In ~/.walkdown, which git never sees. Nothing was added to this repository,' +
        ' not even a pointer — `walkdown pointer --into CLAUDE.md` adds one for agents.' +
        '\n  Prefer it committed? `walkdown init --commit spec` moves the home into the repository.',
      spec:
        '  Committed: the spec and its threads, so a rule change arrives as a diff somebody' +
        ' approves and a clone is a working project. .walkdown/.gitignore keeps runs,' +
        '\n  evidence and drafts out — delete it to commit everything, or `walkdown init' +
        ' --commit none` to move the home back out of the repository.',
      all:
        '  Committed in full, runs and evidence included — there is no .gitignore under' +
        ' .walkdown/. Note that git keeps every version of every screenshot forever.' +
        '\n  `walkdown init --commit spec` writes the ignore file back.',
    };
    console.log(dim(say[commit]));
    if (tracked.length)
      console.log(
        dim(
          `  Already committed, so still tracked: ${tracked.length} file(s) under runs, evidence` +
            ' or drafts. The ignore file rules only what git has not met; they stay in history' +
            '\n  until you `git rm --cached` them — walkdown never touches the index.' +
            `\n    ${tracked.slice(0, 3).join('\n    ')}${tracked.length > 3 ? `\n    … ${tracked.length - 3} more` : ''}`,
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
  if (results.some((r) => r.action === 'created' && !r.path.includes('SKILL.md'))) {
    const cfg = join(where?.path ?? 'blueprint', 'walkdown.yml');
    console.log(`\nNext: fill in ${dim(cfg)} (runner commands, targets), sketch your`);
    console.log(`first feature from its ${dim('features/_template.yml')}, then \`walkdown lint\`.`);
    console.log(dim('`walkdown where` shows every path this project uses.'));
  }
  if (!existsSync(specDir)) console.error(red(`  the spec did not land at ${specDir}`));
}

/**
 * The record files git already tracks under a home, asked of git itself -
 * the only thing that knows. Empty outside a repository.
 * @param {string} root
 * @param {string} home
 * @returns {string[]}
 */
function stillTracked(root, home) {
  const under = relative(root, home);
  const dirs = ['runs', 'evidence', 'drafts'].map((k) => join(under, k));
  try {
    return execFileSync('git', ['ls-files', '-z', '--', ...dirs], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}
