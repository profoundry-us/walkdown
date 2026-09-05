import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { end } from './context.js';

/*
 * `walkdown skills`: put the agent procedures somewhere, and never guess where.
 *
 * Skills are procedures a person carries, not records a project owns, so for a
 * long time this wrote to the person's own directory and said so. In a project
 * whose spec IS committed that was the wrong half: the committed set a clone
 * brings sat untouched and possibly stale, five fresh copies appeared under
 * $HOME, and the report said "nothing added to any of them" while the person
 * now had two same-named sets (n-0184).
 *
 * The answer is not a better default. It is to ASK - and, before asking, to
 * show every place these can go and what is already in each, because "where do
 * my skills currently live" is the question underneath the question. Nothing is
 * ever written to a place nobody picked.
 */

/** The repository's one copy, at the ROOT - never a nested pack's. */
async function repoSkills(cwd) {
  const { gitRoot } = await import('../../lib/locations.js');
  const root = gitRoot(cwd);
  return root ? join(root, '.claude', 'skills') : null;
}

const MARK = {
  created: green('+ created'),
  updated: green('~ updated'),
  'up-to-date': dim('· up to date'),
  'kept-differs': yellow('! kept (yours differs — --force to overwrite)'),
};

/*
 * What a person needs to see before choosing: not "does this directory exist"
 * but which of THESE skills are in it and which a write would change. An
 * edited copy is the one that matters - it is somebody's work, and it is what
 * `--force` would overwrite.
 */
function survey(into, installSkills) {
  const rows = installSkills(into, { dry: true });
  const here = rows.filter((r) => r.action !== 'created').length;
  const differs = rows.filter((r) => r.action === 'kept-differs').length;
  if (!here) return dim('nothing here yet');
  const said = `${here} of ${rows.length} already here`;
  return differs
    ? `${said} · ${yellow(`${differs} differ${differs === 1 ? 's' : ''} from the shipped copy`)}`
    : dim(`${said} · all identical to the shipped copies`);
}

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      into: { type: 'string' },
      project: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  });
  const { installSkills } = await import('../../lib/init.js');
  const { skillsHome } = await import('../../lib/locations.js');

  const personal = skillsHome();
  const repo = await repoSkills(process.cwd());

  const explicit = values.into ? resolve(values.into) : values.project ? repo : null;
  if (values.project && !repo) {
    console.error(red('--project wants a repository, and this directory is not in one.'));
    console.error(dim(`  \`--into <dir>\` names a directory outright, or run it in a checkout.`));
    return end(2);
  }

  let into = explicit;
  if (!into) {
    /*
     * The survey, printed whether or not there is a terminal to ask. A script
     * that gets refused should still learn where its skills are - the refusal
     * is the same news as the question, minus the answer.
     */
    const places = [
      [personal, 'yours — every project on this machine, and no repository touched'],
      ...(repo ? [[repo, 'the repository — a clone brings them; commit them with the spec']] : []),
    ];
    const count = places.length === 1 ? 'One place' : `${places.length} places`;
    console.log(`\n  ${dim(`Where should the skills go? ${count} to put them.`)}\n`);
    places.forEach(([path, what], i) => {
      console.log(`  ${green(String(i + 1))}  ${path}`);
      console.log(`     ${dim(what)}`);
      console.log(`     ${survey(path, installSkills)}\n`);
    });

    if (!process.stdin.isTTY) {
      console.error(red('Nothing written: there is no terminal to ask, and this never picks for you.'));
      console.error(dim('  `--into <dir>` names a directory; `--project` is the repository root above.'));
      return end(2);
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question(`  Which? [1-${places.length}, or q to leave it] `)).trim();
      const pick = Number(answer);
      if (!Number.isInteger(pick) || pick < 1 || pick > places.length) {
        console.log(dim('\n  Nothing written.'));
        return end(answer.toLowerCase() === 'q' || !answer ? 0 : 2);
      }
      into = places[pick - 1][0];
    } finally {
      rl.close();
    }
    console.log('');
  }

  for (const r of installSkills(into, { force: values.force }))
    console.log(`  ${MARK[r.action] ?? r.action}  ${r.path}`);
  console.log(`\n  ${into}`);
  console.log(
    dim(
      into === repo
        ? '  In the repository, so a clone brings them. Commit them with the spec.'
        : '  Your own skills directory — every project on this machine.',
    ),
  );
  return end(0);
}
