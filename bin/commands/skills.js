import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dim, green, yellow } from '../../lib/report/tty.js';

/*
 * Skills are procedures a person carries, not records a project owns - so the
 * default is the person's own directory and no repository is touched at all.
 * This is the whole install for a team whose registry will not have walkdown
 * in it: clone once, point the skills at your home, and every project on the
 * machine has them.
 */
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
  const into = values.into
    ? resolve(values.into)
    : values.project
      ? join(process.cwd(), '.claude', 'skills')
      : skillsHome();

  const MARK = {
    created: green('+ created'),
    updated: green('~ updated'),
    'up-to-date': dim('· up to date'),
    'kept-differs': yellow('! kept (yours differs — --force to overwrite)'),
  };
  for (const r of installSkills(into, { force: values.force }))
    console.log(`  ${MARK[r.action] ?? r.action}  ${r.path}`);
  console.log(`\n  ${into}`);
  console.log(
    dim(
      into.startsWith(process.cwd() + '/')
        ? '  In the repository, so a clone brings them. Commit them with the spec.'
        : '  Your own skills directory — every project on this machine, and nothing added to any of them.',
    ),
  );
}
