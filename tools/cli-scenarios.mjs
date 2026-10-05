/*
 * ONE DESCRIPTION OF A CLI SCENARIO, USED TWICE (ADR 0013 §8).
 *
 * A scenario is a moment at a terminal: a fixture, a command, the exit code
 * it should end with and the lines it should print, written as YAML in
 * test/cli/scenarios/ - data, so `node --test` never mistakes one for a
 * suite, and so a scenario reads the same to the person who walks its screen
 * as to the check that runs it. test/cli.test.js runs
 * every one as a check tagged with its rule; tools/cli-captures.mjs runs the
 * same ones to draw the app side of each `cli` screen. The picture a person
 * judges and the check that records a pass come from one run of one command.
 *
 * Output is made steady before anyone reads it: the throwaway machine's paths
 * become `~/.walkdown` and `~/shop`, and times and run ids become fixed
 * placeholders - and so do the clone's own path, the versions of node and
 * git, and a thread's printed date - so a fade between the design and the build shows what changed
 * and nothing else. Expected lines are matched against the steady text.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const REPO = dirname(dirname(CLI));
export const SCENARIOS = new URL('../test/cli/scenarios/', import.meta.url).pathname;

/**
 * Every scenario, in file order: `expect` patterns compiled, each matching
 * anywhere in the output with `^` and `$` at line ends.
 */
export function scenarios() {
  return readdirSync(SCENARIOS)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const s = parse(readFileSync(join(SCENARIOS, file), 'utf8'));
      return { file, ...s, command: s.command.map(String), expect: (s.expect ?? []).map((e) => new RegExp(e, 'm')) };
    });
}

/*
 * A machine of its own: a personal home, and a project called `shop`. Git
 * knows the person as Sam, from a config of the machine's own, so what
 * `walkdown init` infers reads the same on every machine that runs it.
 * `path: node-only` leaves nothing on the PATH but node - a machine without
 * git, for the moment walkdown has to say so.
 */
export function machine({ path } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-cli-')));
  const home = join(root, 'home');
  const shop = join(root, 'shop');
  mkdirSync(join(shop, '.git'), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, 'claude'), { recursive: true }); // Claude Code is installed
  writeFileSync(join(home, 'config.yml'), 'identity:\n  username: topher\n');
  writeFileSync(join(root, '.gitconfig'), '[user]\n\tname = Sam Shopper\n\temail = sam@example.com\n');
  const env = {
    ...process.env,
    WALKDOWN_HOME: home,
    WALKDOWN_SKILLS_DIR: join(root, 'claude', 'skills'),
    // lib/identity.js sets GIT_CONFIG_* aside on purpose, so the machine's
    // own git config is the one HOME points at.
    HOME: root,
    XDG_CONFIG_HOME: join(root, '.config'),
    TZ: 'America/Chicago',
    NO_COLOR: '1',
  };
  for (const k of ['WALKDOWN_SPEC', 'WALKDOWN_RECORD_HOME', 'NODE_TEST_CONTEXT', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_GLOBAL']) delete env[k];
  if (path === 'node-only') env.PATH = dirname(process.execPath);
  const wd = (args, cwd = shop) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  const ok = (args) => {
    const r = wd(args);
    if (r.status !== 0) throw new Error(`fixture: walkdown ${args.join(' ')} exited ${r.status}\n${r.stderr}`);
    return r;
  };
  const specOf = (id) => ok(['where', 'spec', '--blueprint', id]).stdout.trim();
  return { root, home, shop, env, wd, ok, specOf, done: () => rmSync(root, { recursive: true, force: true }) };
}

/* A feature with one story of the given rules, written into a blueprint. */
function feature(m, id, name, rules) {
  writeFileSync(
    join(m.specOf(id), 'features', `${name}.yml`),
    [
      `feature: ${name}`,
      'stories:',
      `  - id: ${name}.basics`,
      `    title: The basics of ${name}`,
      `    statement: As a shopper I use ${name}.`,
      '    rules:',
      ...rules.flatMap(([rule, statement]) => [
        `      - id: ${name}.basics.${rule}`,
        `        statement: ${statement}`,
        '        verify: [checks]',
        '        steps:',
        '          then: [It does]',
      ]),
      '',
    ].join('\n'),
  );
  m.ok(['hash', '--write', '--blueprint', id]);
}

/**
 * The fixtures a scenario may name. Each takes a fresh machine and leaves it
 * where the scenario's command starts.
 */
export const FIXTURES = {
  /* Nothing at all: no ~/.walkdown, as on the day walkdown is installed. */
  'fresh-machine'(m) {
    rmSync(m.home, { recursive: true, force: true });
  },
  /* A machine `walkdown init` has already been run on. */
  initialised(m) {
    m.ok(['init']);
  },
  /* `checkout` with one rule and an open note on it, n-0001. */
  'a-note'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    for (const f of readdirSync(join(m.specOf('checkout'), 'features'))) rmSync(join(m.specOf('checkout'), 'features', f));
    feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
    m.ok(['threads', 'new', '--rule', 'checkout.basics.pays', '--body', 'The pay button does nothing on a declined card.']);
  },
  /* `shop` with one blueprint, `checkout`. */
  'one-blueprint'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
  },
  /* `shop` with `checkout` and `search`, a rule or two each. */
  'two-blueprints'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    m.ok(['blueprints', 'new', 'search']);
    for (const id of ['checkout', 'search'])
      for (const f of readdirSync(join(m.specOf(id), 'features'))) rmSync(join(m.specOf(id), 'features', f));
    feature(m, 'checkout', 'checkout', [
      ['pays', 'A card payment goes through.'],
      ['totals', 'The total is the sum of the cart.'],
    ]);
    feature(m, 'search', 'search', [['finds', 'A search for a product finds it.']]);
  },
};

/**
 * Text as anyone reading it should see it, whoever's machine ran it.
 *
 * @param {string} text
 * @param {{ root?: string, home: string, shop: string }} m
 */
export function steady(text, m) {
  return (m.root ? text.replaceAll(join(m.root, 'claude'), '~/.claude') : text)
    .replaceAll(REPO, '~/src/walkdown')
    // HOME is the machine's root, so a path walkdown shortens itself reads
    // ~/home - the same ~/.walkdown a person would see.
    .replace(/~\/home\b/g, '~/.walkdown')
    .replaceAll(`as \`${userInfo().username}\``, 'as `sam`')
    .replace(/^(\s+· node\s+)\S+/m, '$124.0.0')
    .replace(/^(\s+· git\s+)\S.*$/m, '$12.50.1')
    .replace(/\b[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d\d [AP]M [A-Z]{3,4}\b/g, 'Oct 2, 2026, 9:00 AM CDT')
    .replaceAll(m.shop, '~/shop')
    .replaceAll(m.home, '~/.walkdown')
    .replace(/\d{4}-\d\d-\d\dT\d\d[-:]\d\d[-:]\d\d(\.\d+)?Z/g, '2026-10-02T00-00-00Z')
    .replace(/sha256:[0-9a-f]{12}/g, 'sha256:000000000000');
}

/**
 * Run one scenario on a machine of its own, and give back what it printed,
 * steadied: stdout then stderr, as a terminal shows them.
 *
 * @returns {{ status: number | null, text: string, stdout: string, stderr: string }}
 */
export function run(scenario) {
  const m = machine({ path: scenario.path });
  try {
    for (const name of [scenario.fixture ?? []].flat()) {
      if (!FIXTURES[name]) throw new Error(`${scenario.file}: no fixture "${name}"`);
      FIXTURES[name](m);
    }
    const r = m.wd(scenario.command);
    const stdout = steady(r.stdout, m);
    const stderr = steady(r.stderr, m);
    return { status: r.status, stdout, stderr, text: `${stdout}${stderr}`.replace(/\n+$/, '') };
  } finally {
    m.done();
  }
}

/**
 * Where each anchor sits in the output: the first run of consecutive lines
 * its pattern matches, as line indices.
 *
 * @returns {Map<string, { from: number, to: number }>}
 */
export function placeAnchors(lines, anchors = []) {
  const placed = new Map();
  for (const a of anchors) {
    const re = new RegExp(a.match);
    let from = -1;
    let to = -1;
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        if (from < 0) from = i;
        to = i;
      } else if (from >= 0) break;
    }
    if (from >= 0) placed.set(a.id, { from, to });
  }
  return placed;
}
