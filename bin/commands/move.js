import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { KINDS, rememberLocation, resolveLocations } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { moveDir } from '../../lib/standard.js';
import { end } from './context.js';

/*
 * `walkdown move`: relocate one kind of record, and write down that you did.
 *
 * Moving a run file is not editing it, so the append-only law is satisfied -
 * but two ledgers merged into one directory would be, in every way that
 * matters, an edit of both. So a destination holding records is refused
 * rather than merged, and the caller is told to pick an empty one.
 */
export function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { to: { type: 'string' }, project: { type: 'string' } },
  });
  const kind = positionals[0];
  if (!KINDS.includes(kind)) {
    console.error(`walkdown move <kind> --to <path>\n  kind is one of: ${KINDS.join(', ')}`);
    return end(2);
  }
  if (!values.to) {
    console.error('move needs --to <path>');
    return end(2);
  }

  const loc = resolveLocations({ project: values.project });
  /*
   * Only a listed project's records move. Standing in a directory nothing
   * declares, this used to fall through to an entry found BY NAME and rewrote
   * an unrelated project's drafts key from a repository that merely shared
   * its basename (n-0153, n-0160). No entry, no move.
   */
  if (!loc.project) {
    console.error(
      red(
        values.project
          ? `No project \`${values.project}\` — \`walkdown projects\` lists them.`
          : 'Nothing declares this directory, so there is no entry to remember a move in.',
      ),
    );
    console.error(dim('`walkdown init` starts a project here; `walkdown project add <path>` lists one.'));
    return end(2);
  }
  const from = loc[kind].path;
  const to = resolve(values.to.replace(/^~(?=$|\/)/, homedir()));
  if (from === to) {
    console.log(`${kind} is already at ${to}`);
    return end(0);
  }

  const held = (d) => (existsSync(d) ? readdirSync(d).filter((f) => !f.startsWith('.')) : []);
  if (held(to).length) {
    console.error(red(`${to} already holds ${held(to).length} file(s).`));
    console.error(
      'Two ledgers merged into one directory is an edit of both. Pick an empty destination.',
    );
    return end(2);
  }

  mkdirSync(dirname(to), { recursive: true });
  // Across volumes too, and into a destination holding only the dotfiles the
  // guard above ignores - `renameSync` alone refused both (n-0185).
  if (existsSync(from)) moveDir(from, to);
  else mkdirSync(to, { recursive: true });

  const written = rememberLocation(loc, kind, to);
  console.log(`${green('moved')} ${kind}`);
  console.log(dim(`  from ${from}`));
  console.log(dim(`  to   ${to}`));
  console.log(dim(`  recorded in ${written}`));
  console.log(dim('\nNo record was edited. `walkdown where` confirms it.'));
  return end(0);
}
