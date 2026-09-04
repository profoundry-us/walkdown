import { parseArgs } from 'node:util';
import { KINDS, resolveLocations } from '../../lib/locations.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { tracking } from '../../lib/standard.js';
import { end } from './context.js';

/*
 * `walkdown where`: the resolver's answer, in the order a person reads it.
 *
 * The reason each path was chosen is printed beside it, because the interesting
 * question is never only "where" but "why there" - a path that came from a
 * config, from the working tree, or from a default are three different
 * situations, and only one of them is somebody's decision.
 */
export function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });

  const loc = resolveLocations({ project: values.project });
  if (values.json) {
    const { findings, words, why } = tracking(loc);
    console.log(JSON.stringify({ ...loc, tracking: { words, why, findings } }, null, 2));
    return end(0);
  }

  /*
   * One kind, one path, nothing else - so a script or a skill can ask
   * `walkdown where evidence` and use the answer directly instead of parsing a
   * report meant for a person.
   */
  const only = positionals[0];
  if (only) {
    const cell =
      only === 'spec' || only === 'code' ? loc[only] : KINDS.includes(only) ? loc[only] : null;
    if (!cell) {
      console.error(`No such location "${only}". Try: spec, code, ${KINDS.join(', ')}.`);
      return end(2);
    }
    console.log(cell.path ?? '');
    return end(cell.path ? 0 : 1);
  }

  console.log(`walkdown where — ${loc.id}\n`);
  /*
   * Each file answers for ITSELF. The two rows used to share one flag, which
   * was computed over the merge - so a repository declaring the project lit
   * up the personal file's row as "names this project" even where the
   * personal file had never heard of it, and the alternative wording was
   * unreachable whenever a repo config claimed the project (n-0144). Two
   * files with two authors get two answers; that is the question this command
   * exists to answer.
   */
  const names = loc.config.matchedIn;
  const cfg = loc.config.exists
    ? loc.config.error
      ? red(`unreadable — ${loc.config.error}`)
      : names === 'personal' || names === 'both'
        ? green('names this project')
        : dim('present, no entry for this project')
    : dim('not present — every default applies');
  console.log(`  ${'config'.padEnd(9)} ${loc.config.path}`);
  console.log(`  ${''.padEnd(9)} ${cfg}`);
  // A relative path has no base in a file that sits in ~/.walkdown and is
  // about every project on the disk; it was set aside, and this says so.
  for (const ig of loc.config.ignored ?? [])
    console.log(
      `  ${''.padEnd(9)} ${yellow(
        `ignores \`${ig.key}: ${ig.value}\`${ig.id ? ` in entry \`${ig.id}\`` : ''} — ${ig.why ?? 'a relative path means nothing in this file; write it in full'}`,
      )}`,
    );
  if (loc.config.repo) {
    console.log(`  ${''.padEnd(9)} ${loc.config.repo.path}`);
    const shared = "this repository's, shared";
    console.log(
      `  ${''.padEnd(9)} ${
        loc.config.repo.error
          ? red(`unreadable — ${loc.config.repo.error}`)
          : loc.config.repo.matched
            ? green(
                names === 'both'
                  ? `${shared} — names this project too; the personal config above wins where they disagree`
                  : `${shared} — names this project`,
              )
            : dim(`${shared} — no entry for this project`)
      }`,
    );
    // A committed entry reaching under another `.walkdown` is not read: that
    // directory answers for it, and this row says which (q-0168, q-0176).
    for (const r of loc.config.repo.refused ?? [])
      console.log(
        `  ${''.padEnd(9)} ${red(
          `refuses \`${r.id}\` — its spec ${r.spec} lies under ${r.under}, which answers for it; declare it there`,
        )}`,
      );
  }
  /*
   * Which `.walkdown` answered, before any path it answered with - the one
   * fact every row below is relative to, and the one a person in a monorepo
   * most needs to see (locations.answer.one-walkdown-answers).
   */
  console.log(`  ${'answers'.padEnd(9)} ${loc.walkdown.path ?? dim('—')}`);
  console.log(`  ${''.padEnd(9)} ${dim(loc.walkdown.why)}`);
  console.log('');

  const row = (label, cell) => {
    const missing = cell.missing ? yellow('  (does not exist yet)') : '';
    console.log(`  ${label.padEnd(9)} ${cell.path ?? dim('—')}${missing}`);
    console.log(`  ${''.padEnd(9)} ${dim(cell.why)}`);
  };
  row('spec', loc.spec);
  for (const kind of KINDS) row(kind, loc[kind]);
  row('code', loc.code);
  /*
   * And what git sees of it, asked of git rather than of the ignore file
   * walkdown wrote: a home in `~/.walkdown` is nobody's diff, a `.gitignore`
   * beside a home in the repository says what stays out, and no such file
   * means all of it is committed (n-0158) - but a root `.gitignore` hiding
   * `.walkdown/`, or a rule that does not reach a home standing elsewhere,
   * makes the file a liar, and git is the one that knows (n-0180, n-0181).
   * Where the two disagree it is said here in colour and refused by lint.
   */
  const t = tracking(loc);
  console.log(`  ${'tracked'.padEnd(9)} ${t.words}`);
  console.log(`  ${''.padEnd(9)} ${dim(t.why)}`);
  if (loc.standard) console.log(`  ${''.padEnd(9)} ${dim(`the tree says: ${loc.standard.why}`)}`);
  for (const f of t.findings)
    console.log(`  ${''.padEnd(9)} ${f.level === 'error' ? red(`✗ ${f.message}`) : yellow(`! ${f.message}`)}`);

  /*
   * Asking writes nothing, and that is a rule
   * (locations.default.one-home-per-blueprint): asking allocates nothing,
   * claims nothing, and leaves the disk as it found it. There used to be a
   * `--fix` here, and a `walkdown migrate` before it, that folded the homes
   * an older layout left behind into the config; the older layout is not
   * read any more, so there is nothing left to fold.
   */
  console.log(dim('\nNothing was written. See docs/08-locations.md for the resolution order.'));
  return end(0);
}
