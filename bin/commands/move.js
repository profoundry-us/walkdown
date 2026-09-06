import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { canRemember, KINDS, rememberLocation, resolveLocations } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { MoveFailed, moveDir } from '../../lib/standard.js';
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

  /*
   * Two destinations that are not destinations. Both used to reach the
   * filesystem and come back as a raw stack trace - ENOTDIR from the readdir
   * below, EINVAL from the rename (n-0195). Nothing was lost either way, but a
   * command that refuses in a sentence everywhere else should not answer these
   * with a crash.
   */
  if (existsSync(to) && !statSync(to).isDirectory()) {
    console.error(red(`${to} is not a directory.`));
    console.error(`${kind} is a directory of records. Name a directory to keep them in.`);
    return end(2);
  }
  if (to.startsWith(from + sep)) {
    console.error(red(`${to} is inside ${from}.`));
    console.error('A directory cannot be moved into itself. Pick a destination beside it.');
    return end(2);
  }

  const held = (d) => (existsSync(d) ? readdirSync(d).filter((f) => !f.startsWith('.')) : []);
  if (held(to).length) {
    console.error(red(`${to} already holds ${held(to).length} file(s).`));
    console.error(
      'Two ledgers merged into one directory is an edit of both. Pick an empty destination.',
    );
    return end(2);
  }

  /*
   * Can this be written down at all? Asked BEFORE anything moves, because a
   * move that cannot be recorded is a move that must not happen: the records
   * end up at the new address with the config still naming the old one, which
   * no longer exists, and `walkdown where` names a directory that is gone
   * (n-0201). `relocateHome` has read both files up front since n-0172; this
   * door never inherited it, not even when n-0185 put both on one moveDir.
   */
  /*
   * A destination that is a LINK to a directory. The guard above follows the
   * link and sees a directory, quite rightly, and then rename will not have it
   * and the copy refuses to write a directory over a symlink - a stack trace
   * before, and after n-0196 a sentence that said "stopped part way" about an
   * attempt that never started. Refused here instead, naming the target,
   * because which of the two the person meant is theirs to say (n-0201).
   */
  if (existsSync(to) && lstatSync(to).isSymbolicLink()) {
    console.error(red(`${to} is a link, not a directory.`));
    console.error(dim(`  It points at ${statSync(to).isDirectory() ? realpathSync(to) : 'something else'}. Name the directory itself.`));
    return end(2);
  }

  try {
    canRemember(loc);
  } catch (e) {
    console.error(red(e.message));
    return end(2);
  }

  try {
    mkdirSync(dirname(to), { recursive: true });
  } catch (e) {
    // A parent path running through a FILE. Every neighbour here refuses in a
    // sentence; this one died with a raw ENOTDIR (n-0201).
    console.error(red(`${dirname(to)} cannot be made a directory (${e.code ?? e.message}).`));
    console.error(dim('  Something on that path is a file. Nothing was moved.'));
    return end(2);
  }
  // Across volumes too, and into a destination holding only the dotfiles the
  // guard above ignores - `renameSync` alone refused both (n-0185).
  try {
    if (existsSync(from)) moveDir(from, to);
    else mkdirSync(to, { recursive: true });
  } catch (e) {
    /*
     * A copy that stopped part way is news, not a crash: the ledger is exactly
     * where it was, and the sentence says so and says what to fix. Anything
     * else still throws - an error nobody has thought about is better read as
     * a stack trace than dressed up as a refusal (n-0196).
     */
    if (!(e instanceof MoveFailed)) throw e;
    console.error(red(e.message));
    return end(2);
  }

  const written = rememberLocation(loc, kind, to);
  console.log(`${green('moved')} ${kind}`);
  console.log(dim(`  from ${from}`));
  console.log(dim(`  to   ${to}`));
  console.log(dim(`  recorded in ${written}`));
  console.log(dim('\nNo record was edited. `walkdown where` confirms it.'));
  return end(0);
}
