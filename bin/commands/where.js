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
      blueprint: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });

  const loc = resolveLocations({ blueprint: values.blueprint });
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
   * Two files, each answering for itself. config.yml is the person's -
   * identity and defaults - and registers nothing since ADR 0003; the
   * registry is what this machine knows about, and the only thing consulted.
   */
  const cfg = loc.config.exists
    ? loc.config.error
      ? red(`unreadable — ${loc.config.error}`)
      : dim('yours — identity and defaults; registers nothing')
    : dim('not present — every default applies');
  console.log(`  ${'config'.padEnd(9)} ${loc.config.path}`);
  console.log(`  ${''.padEnd(9)} ${cfg}`);
  // A row this file no longer reads - a `blueprints:` list from before the
  // registry, or a relative path in a file about every project on the disk
  // - was set aside, and this says so.
  const ignores = (ig) =>
    console.log(
      `  ${''.padEnd(9)} ${yellow(
        `ignores \`${ig.key}: ${typeof ig.value === 'string' ? ig.value : ig.id ?? '…'}\`${ig.id && typeof ig.value === 'string' ? ` in entry \`${ig.id}\`` : ''} — ${ig.why ?? 'a relative path means nothing in this file; write it in full'}`,
      )}`,
    );
  for (const ig of loc.config.ignored ?? []) if (ig.key !== 'registry') ignores(ig);
  const reg = loc.config.registry;
  console.log(`  ${''.padEnd(9)} ${reg.path}`);
  console.log(
    `  ${''.padEnd(9)} ${
      reg.exists
        ? reg.error
          ? red(`unreadable — ${reg.error}`)
          : reg.matched
            ? green(`the registry — names this project, registered by ${reg.registeredBy ?? 'walkdown'}`)
            : dim('the registry — what this machine knows about; no row for this project')
        : dim('the registry — not present; `walkdown import` or `walkdown init` starts it')
    }`,
  );
  // A row in the registry nothing wrote (ADR 0003 §5): set aside, and said
  // under the file it is in.
  for (const ig of loc.config.ignored ?? []) if (ig.key === 'registry') ignores(ig);
  if (loc.ambiguous)
    console.log(
      `  ${''.padEnd(9)} ${yellow(
        `several registered blueprints stand here (${(reg.candidates ?? []).join(', ')}) — say which with --blueprint`,
      )}`,
    );
  /*
   * Which `.walkdown` answered, before any path it answered with - the one
   * fact every row below is relative to, and the one a person in a monorepo
   * most needs to see (locations.answer.registry-is-the-only-door).
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
