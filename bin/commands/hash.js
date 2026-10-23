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
      changed: { type: 'string' },
    },
  });
  if (values.changed != null && values.reword != null) {
    console.error(
      '--changed and --reword are two answers to one question: did the meaning move, or only the words? Give one.',
    );
    return end(2);
  }
  if (values.changed != null && !values.write) {
    console.error('--changed goes with --write: it says why the rule changed as it is stamped.');
    return end(2);
  }
  if (values.changed != null && !values.changed.trim()) {
    console.error(
      '--changed wants a reason - whoever signs the rule again reads it beside what changed.',
    );
    return end(2);
  }
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
  const { rows, changedFiles, refused, unsaid, exitCode } = runHashCommand(blueprint, {
    write: values.write,
    reword: values.reword ?? null,
    changed: values.changed ?? null,
    only: positionals,
  });
  const bp = values.blueprint ? ` --blueprint ${values.blueprint}` : blueprintFlag(blueprint.dir);
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
      `  Run \`walkdown hash --write --changed "<why>" ${ids.join(' ')}${bp}\` to stamp only ${
        one ? 'this one' : ids.length === 2 ? 'these two' : `these ${ids.length}`
      }. ${one ? 'Its verdicts then read stale until it is' : 'Their verdicts then read stale until each is'} judged and approved again.`,
    );
    console.log(
      `  Nothing was written for any rule. Once ${names} ${one ? 'is' : 'are'} stamped on ${one ? 'its' : 'their'} own, run this again to reword the rest.`,
    );
    return end(exitCode);
  }

  /*
   * A signed rule changed with no word of why (status.derived.a-change-says-why).
   * What was stamped is said, so a mixed run is not read as nothing done.
   */
  if (unsaid) {
    for (const r of rows.filter((x) => x.status === 'written'))
      console.log(
        `  ${green('✓')} ${r.rule} stamped. Nobody has signed it, so no reason is needed.`,
      );
    const and = (xs) =>
      xs.length > 2 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs.join(' and ');
    for (const r of unsaid)
      console.log(
        `  ${red('✗')} ${r.rule} changed since ${and(r.roles)} signed it, and no reason was given.`,
      );
    const roles = [...new Set(unsaid.flatMap((r) => r.roles))];
    const whose = roles.length === 1 ? `${roles[0]}'s signature` : `The ${and(roles)} signatures`;
    const ids = unsaid.map((r) => r.rule).join(' ');
    console.log(
      "  A signed rule's change needs its reason, so whoever signs it again can read why. Say which kind of change it was:",
    );
    console.log(`    walkdown hash --write --changed "<why>" ${ids}${bp}`);
    console.log(
      dim(
        `        the meaning moved. ${roles.length === 1 ? `${whose} reads` : `${whose} read`} stale until ${unsaid.length === 1 ? 'it is' : 'each is'} signed again.`,
      ),
    );
    console.log(`    walkdown hash --write --reword "<why>" ${ids}${bp}`);
    console.log(
      dim(
        `        only the words changed. ${roles.length === 1 ? `${whose} stands` : `${whose} stand`}.`,
      ),
    );
    console.log(`  Nothing was written for ${and(unsaid.map((r) => r.rule))}.`);
    return end(exitCode);
  }

  const mark = {
    ok: green('✓'),
    legacy: yellow('~'),
    written: green('✓'),
    reworded: green('✓'),
    changed: green('✓'),
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
