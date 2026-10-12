import { parseArgs } from 'node:util';
import { runHashCommand } from '../../lib/hash-cmd.js';
import { blueprintFlag } from '../../lib/locations.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { end, loadOrExit, namedOrExit } from './context.js';

export function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      blueprint: { type: 'string' },
      write: { type: 'boolean', default: false },
      reword: { type: 'string' },
    },
  });
  if (values.reword != null && !values.write) {
    console.error(
      '--reword goes with --write: it says why the old hash is kept when the new one is written.',
    );
    return end(2);
  }
  if (values.reword != null && !values.reword.trim()) {
    console.error(
      '--reword wants a reason - the old hash is kept on your word, and the file says whose.',
    );
    return end(2);
  }
  const blueprint = loadOrExit(
    values.write ? namedOrExit(values.blueprint, 'hash --write') : values.blueprint,
  );
  // Rules named stamp alone, so a rule that must lose its verdicts can do so
  // without taking every other stale rule's with it.
  const known = new Set(
    blueprint.features.flatMap(
      ({ data }) => data?.stories?.flatMap((st) => st?.rules?.map((r) => r?.id) ?? []) ?? [],
    ),
  );
  const unknown = positionals.filter((id) => !known.has(id));
  if (unknown.length) {
    console.error(
      `No rule ${unknown.map((id) => `"${id}"`).join(', ')} in ${blueprint.dir}. \`walkdown status\` lists all rules.`,
    );
    return end(2);
  }
  const { rows, changedFiles, refused, exitCode } = runHashCommand(blueprint, {
    write: values.write,
    reword: values.reword ?? null,
    only: positionals,
  });
  if (refused) {
    const tiers = (ts) => (ts.length === 1 ? `the ${ts[0]} tier` : `the ${ts.join(' and ')} tiers`);
    for (const r of refused) {
      const was = r.was.length ? `excused only ${tiers(r.was)}` : 'excused nothing';
      console.log(
        `  ${red('✗')} ${r.rule} now excuses ${tiers(r.added.map((a) => a.tier))}, and it ${was} when it was last stamped:`,
      );
      for (const a of r.added) console.log(dim(`      ${a.tier}: ${a.excuse}`));
    }
    const ids = refused.map((r) => r.rule);
    const one = ids.length === 1;
    const names =
      ids.length > 2 ? `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : ids.join(' and ');
    console.log(
      `  Rewording cannot add an excuse. A rewording keeps every verdict, so the tier would be set aside with nobody reading the rule again.`,
    );
    console.log(
      `  Run \`walkdown hash --write ${ids.join(' ')}${values.blueprint ? ` --blueprint ${values.blueprint}` : blueprintFlag(blueprint.dir)}\` to stamp only ${
        one ? 'this one' : ids.length === 2 ? 'these two' : `these ${ids.length}`
      }. ${one ? 'Its verdicts then read stale until it is' : 'Their verdicts then read stale until each is'} judged and approved again.`,
    );
    console.log(
      `  Nothing was written for any rule. Once ${names} ${one ? 'is' : 'are'} stamped on ${one ? 'its' : 'their'} own, run this again to reword the rest.`,
    );
    return end(exitCode);
  }

  const mark = {
    ok: green('✓'),
    legacy: yellow('~'),
    written: green('✓'),
    reworded: green('✓'),
    stale: red('✗'),
    missing: yellow('⚠'),
    'no-steps': dim('–'),
  };
  for (const r of rows)
    console.log(`  ${mark[r.status]} ${r.status.padEnd(8)} ${r.rule} ${dim(r.expected)}`);
  if (values.write) console.log(`\n${changedFiles} file(s) updated`);
  else if (exitCode)
    console.log(
      `\n${red('stale/missing hashes')} — run \`walkdown hash --write${blueprintFlag(blueprint.dir)}\`; add \`--reword "<why>"\` if only the words changed, and the verdicts stay current`,
    );
  return end(exitCode);
}
