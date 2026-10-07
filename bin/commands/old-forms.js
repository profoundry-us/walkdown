import { red } from '../../lib/report/tty.js';
import { end } from './context.js';

/*
 * THE FORMS WALKDOWN NO LONGER TAKES (ADR 0012).
 *
 * A command is a noun and then a verb now, and the old spellings are not kept
 * as aliases - an alias is a second answer the help has to explain. But a
 * skill or a habit written for them should fail where somebody sees it, not
 * do something else quietly, so each is refused with exit 2 and the form that
 * replaced it, its arguments carried over and ready to copy
 * (commands.shape.old-forms-say-the-new). Nothing is run.
 */

const quote = (w) =>
  /^[\w./:@=+,-]+$/.test(w) ? w : `"${w.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/* Pull `--name value` (or `--name=value`) out of args; returns [value, rest]. */
function take(args, name) {
  const rest = [];
  let value;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) value = args[++i];
    else if (args[i].startsWith(`--${name}=`)) value = args[i].slice(name.length + 3);
    else rest.push(args[i]);
  }
  return [value, rest];
}

const SETS = ['--status', '--verify', '--reopen', '--waive', '--option'];

/** The form that replaced an old one, as words: [command, ...args]. */
export function newFormOf([cmd, ...args]) {
  if (cmd === 'thread') {
    const [first, ...rest] = args;
    if (first === 'new') return ['threads', 'new', ...rest];
    if (!first) return ['threads', 'help'];
    if (rest.some((a) => SETS.some((s) => a === s || a.startsWith(`${s}=`))))
      return ['threads', 'set', first, ...rest];
    const [reply, others] = take(rest, 'reply');
    if (reply !== undefined) return ['threads', 'reply', first, reply, ...others];
    if (rest.includes('--said') || rest.includes('--added'))
      return ['threads', 'reply', first, ...rest];
    return ['threads', 'show', first, ...rest];
  }
  if (cmd === 'import') return ['blueprints', 'import', ...args];
  if (cmd === 'move') return ['records', 'move', ...args];
  if (cmd === 'blueprint')
    return args[0] === 'forget'
      ? ['blueprints', ...args]
      : ['blueprints', 'list', ...args.slice(1)];
  if (cmd === 'init') {
    const [id, a] = take(args, 'id');
    const [commit, b] = take(a, 'commit');
    if (commit !== undefined)
      return ['blueprints', 'commit', commit, ...(id ? ['--blueprint', id] : []), ...b];
    return ['blueprints', 'new', ...(id ? [id] : []), ...b];
  }
  return null;
}

/** Refuse an old form, naming the new one. Changes nothing. */
export function oldForm(argv) {
  const now = newFormOf(argv);
  console.error(
    red(
      argv[0] === 'init'
        ? '`walkdown init` gets this machine ready and makes no blueprint any more (ADR 0012). That is now:'
        : `\`walkdown ${argv[0]}\` is not a command any more (ADR 0012). It is now:`,
    ),
  );
  console.error(`  walkdown ${now.map(quote).join(' ')}`);
  console.error('Nothing was changed. `walkdown help` lists every command.');
  return end(2);
}
