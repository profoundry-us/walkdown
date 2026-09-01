import { parseArgs } from 'node:util';
import { configPath, foldLegacyHomes, KINDS, resolveLocations } from '../../lib/locations.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
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
      dir: { type: 'string' },
      json: { type: 'boolean', default: false },
      fix: { type: 'boolean', default: false },
    },
  });

  /*
   * `--fix` is the one thing this command does that is not asking, and it is
   * spelled as a flag on `where` because it answers the same question: these
   * are homes full of records that the config does not name, so `where` cannot
   * see them and nothing else will look. It was `walkdown migrate` - a command
   * whose name promised a great deal more than it did, since the day it
   * stopped renaming directories (n-0124). Folding four addresses into a
   * config is not a migration; it is `where`, finishing its own sentence.
   *
   * The bare command still writes nothing, and that is a rule
   * (locations.default.one-home-per-blueprint): asking allocates nothing,
   * claims nothing, and leaves the disk as it found it. --fix is not asking,
   * says so, and prints the report afterwards so the answer it changed is the
   * next thing you read.
   */
  if (values.fix && positionals.length) {
    console.error('walkdown where --fix takes no kind — it repairs the config, not one path.');
    return end(2);
  }
  if (values.fix && !fix()) return end(2);
  const loc = resolveLocations({ dir: values.dir });
  if (values.json) {
    console.log(JSON.stringify(loc, null, 2));
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
  }
  console.log('');

  const row = (label, cell) => {
    const missing = cell.missing ? yellow('  (does not exist yet)') : '';
    console.log(`  ${label.padEnd(9)} ${cell.path ?? dim('—')}${missing}`);
    console.log(`  ${''.padEnd(9)} ${dim(cell.why)}`);
  };
  row('spec', loc.spec);
  for (const kind of KINDS) row(kind, loc[kind]);
  row('code', loc.code);

  console.log(
    dim(
      values.fix
        ? '\nOnly the config was written — no record was moved, renamed or edited.'
        : '\nNothing was written. See docs/08-locations.md for the resolution order.',
    ),
  );
  return end(0);
}

/*
 * The homes an older layout left behind, written into the config so the
 * records in them keep being found. Nothing is renamed and nothing is moved:
 * an existing ledger is a fact, and relocating one is a decision a person
 * makes with `walkdown move`.
 */
function fix() {
  let plan;
  try {
    plan = foldLegacyHomes();
  } catch (e) {
    console.error(e.message);
    return false;
  }
  if (!plan.found.length) {
    console.log(dim(`Nothing to fold in — no homes from the old layout under ${plan.home}\n`));
    return true;
  }
  // Padded before colouring: an escape sequence has no width, and padEnd
  // counts it, so a coloured label pads itself into a ragged column.
  const pad = (s) => s.padEnd(14);
  const mark = {
    recorded: green(pad('→ recorded')),
    already: dim(pad('· already said')),
    left: yellow(pad('? left')),
  };
  for (const f of plan.found) {
    console.log(`  ${mark[f.act]} ${f.path}`);
    console.log(dim(`  ${''.padEnd(14)} ${f.why}`));
  }
  console.log(
    `\n  ${plan.written} home${plan.written === 1 ? '' : 's'} written into ${configPath()}.` +
      (plan.index
        ? `\n  ${dim(`${plan.index} is no longer read. Delete it when you are satisfied — it is your record, not ours.`)}`
        : ''),
  );
  console.log('');
  return true;
}
