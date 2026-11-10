import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { isFixtureValue, keepFixtures, keptFixturesPath } from '../../lib/fixtures.js';
import { projectIdsAt, tilde } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { end, loadOrExit, namedOrExit } from './context.js';
import { dispatch } from './noun.js';

/*
 * `walkdown fixtures set --blueprint <b> --target <t>` (ADR 0017 §3).
 *
 * Keeps the values it is handed, for this machine only: a flat JSON object on
 * standard input, or `key=value` pairs as arguments. It never makes the
 * records and never runs the app's code to make them - the app's own task
 * does, and its output is piped in.
 */

/* What a kept file is said to be when nothing was kept: there, or not yet. */
const untouched = (file) =>
  `Nothing was kept. ${tilde(file)} ${existsSync(file) ? 'is as it was' : 'does not exist yet'}.`;

/* `412` is a number and `true` a boolean, as JSON would have said them. */
function typed(text) {
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  return text;
}

function set(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { blueprint: { type: 'string' }, target: { type: 'string' } },
  });
  // Named before anything is read: a refusal owes standard input nothing.
  const named = namedOrExit(values.blueprint, 'fixtures set', (ids) => {
    if (ids.length === 1 && values.target)
      console.error(untouched(keptFixturesPath(ids[0], values.target)));
    else console.error('Nothing was kept.');
  });
  const blueprint = loadOrExit(named);
  const id = blueprint.at?.id ?? projectIdsAt()[0];
  const declared = Object.keys(blueprint.config?.runner?.targets ?? {});
  const targets = declared.length ? declared : ['local'];
  if (!values.target || !targets.includes(values.target)) {
    console.error(
      values.target
        ? `${red('✗')} This blueprint declares no target called \`${values.target}\`. Its targets: ${targets.join(', ')}.`
        : `${red('✗')} \`walkdown fixtures set\` keeps values for one target — name it with \`--target <name>\`. This blueprint's targets: ${targets.join(', ')}.`,
    );
    console.error('Nothing was kept.');
    return end(2);
  }
  const file = keptFixturesPath(id, values.target);

  let handed;
  if (positionals.length) {
    const bad = positionals.filter((p) => !/^[A-Za-z0-9_-]+=./.test(p));
    if (bad.length) {
      console.error(
        `${red('✗')} ${bad.map((b) => `\`${b}\``).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not \`key=value\`. A key is letters, digits, \`_\` and \`-\`, and a value is what follows the first \`=\`.`,
      );
      console.error(`\n${untouched(file)}`);
      return end(2);
    }
    handed = Object.fromEntries(
      positionals.map((p) => [p.slice(0, p.indexOf('=')), typed(p.slice(p.indexOf('=') + 1))]),
    );
  } else {
    if (process.stdin.isTTY) {
      console.error(
        `${red('✗')} \`walkdown fixtures set\` was handed nothing. Pipe a JSON object into it, or pass \`key=value\` arguments.`,
      );
      console.error(`\n${untouched(file)}`);
      return end(2);
    }
    const text = readFileSync(0, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const flat =
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0 &&
      Object.values(parsed).every(isFixtureValue);
    if (!flat) {
      const lines = text.replace(/\n+$/, '').split('\n');
      const shown = lines.slice(0, 4);
      console.error(
        `${red('✗')} What was handed in on standard input is not a flat JSON object of keys and values.`,
      );
      console.error(
        `\nIt was given${lines.length > shown.length ? ` (the first ${shown.length} of ${lines.length} lines)` : ''}:`,
      );
      for (const l of shown) console.error(dim(`  ${l}`));
      console.error(
        '\nwalkdown fixtures set reads one JSON object, such as {"expense_submitted": 412}. Each value is a string, a number or a boolean. A null, a list or an object is refused. Anything else the task says belongs on standard error, or pass the values as key=value arguments instead.',
      );
      console.error(`\n${untouched(file)}`);
      return end(2);
    }
    handed = parsed;
  }

  keepFixtures(id, values.target, handed);
  const keys = Object.keys(handed);
  const wide = Math.max(...keys.map((k) => k.length)) + 3;
  console.log(`Kept ${keys.length} fixture${keys.length === 1 ? '' : 's'} for ${values.target}:`);
  for (const k of keys) console.log(`  ${k.padEnd(wide)}${handed[k]}`);
  console.log(`\n  ${green('+ kept')}  ${tilde(file)}`);
  console.log(
    "\nThese values are this machine's only. Nothing was written to the blueprint or the repository.",
  );
  console.log(
    `On ${values.target}, screens now fill in {fixtures.<key>} from them, and they win over any in spec.yml.`,
  );
  return end(0);
}

const VERBS = {
  set: {
    usage: 'walkdown fixtures set [<key>=<value>...] --blueprint <id> --target <name>',
    about:
      "Keep the values a screen's setup and path fill in for {fixtures.<key>}, for this\nmachine only: a flat JSON object on standard input, or key=value arguments. Each run\nmerges key by key. walkdown never runs the app's code to make the records; pipe the\napp's own task into it.",
    run: set,
  },
};

export const run = (args) => dispatch('fixtures', VERBS, args);
