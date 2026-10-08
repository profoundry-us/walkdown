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
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
      return {
        file,
        ...s,
        command: (s.command ?? []).map(String),
        expect: (s.expect ?? []).map((e) => new RegExp(e, 'm')),
      };
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
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: topher\n');
  writeFileSync(
    join(root, '.gitconfig'),
    '[user]\n\tname = Sam Shopper\n\temail = sam@example.com\n',
  );
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
  for (const k of [
    'WALKDOWN_SPEC',
    'WALKDOWN_RECORD_HOME',
    'NODE_TEST_CONTEXT',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_CONFIG_GLOBAL',
  ])
    delete env[k];
  if (path === 'node-only') env.PATH = dirname(process.execPath);
  const wd = (args, cwd = shop) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  const ok = (args) => {
    const r = wd(args);
    if (r.status !== 0)
      throw new Error(`fixture: walkdown ${args.join(' ')} exited ${r.status}\n${r.stderr}`);
    return r;
  };
  const specOf = (id) => ok(['where', 'spec', '--blueprint', id]).stdout.trim();
  return {
    root,
    home,
    shop,
    env,
    wd,
    ok,
    specOf,
    done: () => rmSync(root, { recursive: true, force: true }),
  };
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

/* A real repository where the fake `.git` stood: some moments need git's answers. */
function git(m, cwd, ...args) {
  const r = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    env: m.env,
  });
  if (r.status !== 0)
    throw new Error(`fixture: git ${args.join(' ')} exited ${r.status}\n${r.stderr}`);
  return r.stdout;
}
function realRepo(m, dir = m.shop) {
  rmSync(join(dir, '.git'), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(m, dir, 'init', '-q');
  git(m, dir, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git');
  writeFileSync(join(dir, 'README.md'), '# shop\n');
  git(m, dir, 'add', '-A');
  git(m, dir, 'commit', '-q', '-m', 'shop');
}
/* A home written straight into the repository, as a teammate's commit leaves it. */
function committedHome(m, folder, name) {
  const dir = join(m.shop, '.walkdown', 'blueprints', folder);
  mkdirSync(join(dir, 'features'), { recursive: true });
  writeFileSync(join(dir, 'spec.yml'), `blueprint: ${name}\n`);
  return dir;
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
    for (const f of readdirSync(join(m.specOf('checkout'), 'features')))
      rmSync(join(m.specOf('checkout'), 'features', f));
    feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'The pay button does nothing on a declined card.',
      '--blueprint',
      'checkout',
    ]);
  },
  /* `shop` with one blueprint, `checkout`. */
  'one-blueprint'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
  },
  /* `shop` whose one blueprint, `checkout`, was forgotten: its files stay (n-0501). */
  'forgotten-blueprint'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    m.ok(['blueprints', 'forget', 'checkout']);
  },
  /* `shop` with `checkout` and `search`, a rule or two each. */
  'two-blueprints'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    m.ok(['blueprints', 'new', 'search']);
    for (const id of ['checkout', 'search'])
      for (const f of readdirSync(join(m.specOf(id), 'features')))
        rmSync(join(m.specOf(id), 'features', f));
    feature(m, 'checkout', 'checkout', [
      ['pays', 'A card payment goes through.'],
      ['totals', 'The total is the sum of the cart.'],
    ]);
    feature(m, 'search', 'search', [['finds', 'A search for a product finds it.']]);
  },
  /* `shop` with `checkout`, and a second checkout called shop at ~/work/shop, whose label and code are both taken. */
  /* Two projects on one machine, each with a blueprint called `search`. */
  'two-searches'(m) {
    m.ok(['blueprints', 'new', 'search']);
    const other = join(m.root, 'acme_main');
    mkdirSync(join(other, '.git'), { recursive: true });
    const r = m.wd(['blueprints', 'new', 'search'], other);
    if (r.status !== 0)
      throw new Error(
        `fixture: blueprints new search in acme_main exited ${r.status}\n${r.stderr}`,
      );
  },
  'second-shop'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    mkdirSync(join(m.root, 'work', 'shop', '.git'), { recursive: true });
  },
  /*
   * `checkout`, committed at .walkdown/blueprints/checkout, as a home looks
   * once it has been used: a rule, a thread on it, a sweep's run, a picture
   * a judge filed as evidence and a sitting saved as a draft.
   */
  'lived-in-home'(m) {
    realRepo(m);
    m.ok(['blueprints', 'new', 'checkout', '--commit', 'spec', '--folder', 'checkout']);
    const home = m.specOf('checkout');
    for (const f of readdirSync(join(home, 'features'))) rmSync(join(home, 'features', f));
    feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'The pay button does nothing on a declined card.',
      '--blueprint',
      'checkout',
    ]);
    m.ok(['sweep', '--why', 'every check again', '--blueprint', 'checkout']);
    mkdirSync(join(home, 'evidence', '2026-10-02T00-00-00Z'), { recursive: true });
    writeFileSync(join(home, 'evidence', '2026-10-02T00-00-00Z', 'app-checkout.png'), '');
    mkdirSync(join(home, 'drafts'), { recursive: true });
    writeFileSync(join(home, 'drafts', 'local.json'), '{}\n');
  },
  /* `checkout`, committed with `--commit spec` at .walkdown/blueprints/checkout. */
  'committed-spec'(m) {
    realRepo(m);
    m.ok(['blueprints', 'new', 'checkout', '--commit', 'spec', '--folder', 'checkout']);
  },
  /* A home a teammate committed to `shop` that this machine has not imported. */
  'unimported-home'(m) {
    committedHome(m, '202610-search', 'search');
  },
  /* A registry row somebody wrote by hand, with no `registered:`, naming a home. */
  'hand-written-row'(m) {
    const home = committedHome(m, '202610-search', 'search');
    writeFileSync(
      join(m.home, 'registry.yml'),
      `next: 2\nblueprints:\n  - id: 0001-sp-search\n    project: shop\n    code: sp\n    checkout: ${m.shop}\n    home: ${home}\n`,
    );
  },
  /* `shop`, a real repository that already keeps agent instructions in both CLAUDE.md and AGENTS.md. */
  'two-agent-files'(m) {
    realRepo(m);
    writeFileSync(join(m.shop, 'CLAUDE.md'), '# shop\n\nRun the tests before you push.\n');
    writeFileSync(join(m.shop, 'AGENTS.md'), '# shop\n\nRun the tests before you push.\n');
  },
  /* `checkout` and `search`, both committed. */
  'two-committed'(m) {
    realRepo(m);
    m.ok(['blueprints', 'new', 'checkout', '--commit', 'spec', '--folder', 'checkout']);
    m.ok(['blueprints', 'new', 'search', '--commit', 'spec', '--folder', 'search']);
  },
  /* A CLAUDE.md with the team's own words above and below walkdown's block, and two blueprints committed. */
  'own-words'(m) {
    realRepo(m);
    writeFileSync(join(m.shop, 'CLAUDE.md'), '# shop\n\nRun the tests before you push.\n');
    m.ok(['blueprints', 'new', 'checkout', '--commit', 'spec', '--folder', 'checkout']);
    // The team writes below walkdown's block, then a second blueprint is committed.
    writeFileSync(
      join(m.shop, 'CLAUDE.md'),
      `${readFileSync(join(m.shop, 'CLAUDE.md'), 'utf8')}\n## Deploys\n\nOnly from main.\n`,
    );
    m.ok(['blueprints', 'new', 'search', '--commit', 'spec', '--folder', 'search']);
  },
  /* `checkout`, committed, with one note filed on it. */
  'committed-note'(m) {
    realRepo(m);
    m.ok(['blueprints', 'new', 'checkout', '--commit', 'spec', '--folder', 'checkout']);
    const home = m.specOf('checkout');
    for (const f of readdirSync(join(home, 'features'))) rmSync(join(home, 'features', f));
    feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'The pay button does nothing on a declined card.',
      '--blueprint',
      'checkout',
    ]);
  },
  /* `shop` a real git repository with an origin, and one commit. */
  'git-repo'(m) {
    realRepo(m);
  },
  /* Three homes a teammate committed to `shop`; this machine has imported one. */
  'committed-homes'(m) {
    for (const [folder, name] of [
      ['202610-checkout', 'checkout'],
      ['202610-search', 'search'],
      ['billing', 'billing'],
    ])
      committedHome(m, folder, name);
    m.ok(['blueprints', 'import', '.walkdown/blueprints/202610-checkout']);
  },
  /* Homes under any folder names, and one inside another (ADR 0014 §4). */
  'odd-folders'(m) {
    for (const [folder, name] of [
      ['202610-search', 'search'],
      ['0002-search', 'search-old'],
      ['billing/api/invoices', 'invoices'],
      ['202610-search/inner', 'inner'],
    ])
      committedHome(m, folder, name);
  },
  /* `checkout`, committed, in a real repository that has since moved to ~/shop-moved. */
  'moved-checkout'(m) {
    realRepo(m);
    m.ok(['blueprints', 'new', 'checkout', '--commit', 'spec']);
    git(m, m.shop, 'add', '-A');
    git(m, m.shop, 'commit', '-q', '-m', 'checkout');
    renameSync(m.shop, join(m.root, 'shop-moved'));
  },
  /* `checkout`, committed, and a git worktree of `shop` at ~/shop-wt. */
  worktree(m) {
    realRepo(m);
    m.ok(['blueprints', 'new', 'checkout', '--commit', 'spec']);
    git(m, m.shop, 'add', '-A');
    git(m, m.shop, 'commit', '-q', '-m', 'checkout');
    git(m, m.shop, 'worktree', 'add', '-q', join(m.root, 'shop-wt'), '-b', 'reword');
  },
  /* `checkout`, committed, its records.yml sending evidence to ../evidence. */
  'records-yml'(m) {
    realRepo(m);
    m.ok(['blueprints', 'new', 'checkout', '--commit', 'spec', '--folder', 'checkout']);
    const f = join(m.shop, '.walkdown', 'blueprints', 'checkout', 'records.yml');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^evidence: .*$/m, 'evidence: ../evidence'));
  },
  /* `checkout` where a merge left two threads labelled n-0001. */
  'clashing-labels'(m) {
    FIXTURES['a-note'](m);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'The receipt shows the wrong total.',
      '--blueprint',
      'checkout',
    ]);
    const dir = join(m.specOf('checkout'), 'threads');
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      const t = readFileSync(p, 'utf8');
      if (/^id: n-0002$/m.test(t)) writeFileSync(p, t.replace(/^id: n-0002$/m, 'id: n-0001'));
    }
  },
  /* The layout walkdown kept before ADR 0014: config.yml, a blueprint/ folder, threads named by label. */
  'old-layout'(m) {
    const home = join(m.home, 'blueprints', '0001-checkout');
    writeFileSync(join(m.home, 'config.yml'), 'identity:\n  username: topher\n');
    rmSync(join(m.home, 'profile.yml'));
    mkdirSync(join(home, 'blueprint', 'features'), { recursive: true });
    mkdirSync(join(home, 'threads'), { recursive: true });
    writeFileSync(join(home, 'blueprint', 'walkdown.yml'), 'blueprint: checkout\n');
    writeFileSync(join(home, 'blueprint', 'storyboard.yml'), 'screens: []\n');
    writeFileSync(
      join(home, 'threads', 'n-0001.yml'),
      'id: n-0001\nkind: note\nauthor: topher\ncreated: 2026-09-01T00:00:00Z\nanchor: { rule: checkout.basics.pays }\nstatus: open\nbody: Seen.\n',
    );
    writeFileSync(
      join(m.home, 'registry.yml'),
      `blueprints:\n  - id: checkout\n    project: ${m.shop}\n    home: ${home}\n    registered: { by: init, at: '2026-09-01T00:00:00Z' }\n`,
    );
  },
};

/*
 * More fixtures, a file per group of screens in tools/cli-fixtures/, each
 * exporting an object of them by name: `(m, h) => ...`, where `h` holds the
 * helpers here (feature, git, realRepo, committedHome, and the base fixtures
 * by name). A name two files share is refused, so one group's machine is
 * never quietly another's.
 */
const MORE = new URL('./cli-fixtures/', import.meta.url).pathname;
for (const f of (() => {
  try {
    return readdirSync(MORE)
      .filter((n) => n.endsWith('.mjs'))
      .sort();
  } catch {
    return [];
  }
})()) {
  const extra = (await import(join(MORE, f))).default;
  for (const [name, fn] of Object.entries(extra)) {
    if (FIXTURES[name])
      throw new Error(`tools/cli-fixtures/${f}: fixture "${name}" is already defined`);
    FIXTURES[name] = (m) => fn(m, { feature, git, realRepo, committedHome, fixtures: FIXTURES });
  }
}

/**
 * Text as anyone reading it should see it, whoever's machine ran it.
 *
 * @param {string} text
 * @param {{ root?: string, home: string, shop: string }} m
 */
export function steady(text, m, uuids = new Map()) {
  return (
    (m.root ? text.replaceAll(join(m.root, 'claude'), '~/.claude') : text)
      .replaceAll(REPO, '~/src/walkdown')
      // HOME is the machine's root, so a path walkdown shortens itself reads
      // ~/home - the same ~/.walkdown a person would see.
      .replace(/~\/home\b/g, '~/.walkdown')
      // and a path printed relative to the code reaches it as ../home.
      .replace(/(^|[\s(])((?:\.\.\/)+)home\//gm, '$1$2.walkdown/')
      .replaceAll(`as \`${userInfo().username}\``, 'as `sam`')
      .replace(/^(\s+· node\s+)\S+/m, '$124.0.0')
      .replace(/^(\s+· git\s+)\S.*$/m, '$12.50.1')
      .replace(
        /\b[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d\d [AP]M [A-Z]{3,4}\b/g,
        'Oct 2, 2026, 9:00 AM CDT',
      )
      .replaceAll(m.shop, '~/shop')
      .replaceAll(m.home, '~/.walkdown')
      // Anything else on the machine is under HOME, which is its root.
      .replaceAll(m.root ?? '\0', '~')
      // A thread's UUID is new on every run: numbered in the order they appear.
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => {
        if (!uuids.has(u))
          uuids.set(u, `00000000-0000-4000-8000-${String(uuids.size + 1).padStart(12, '0')}`);
        return uuids.get(u);
      })
      // The day a row was registered.
      .replace(/\bon \d{4}-\d\d-\d\d\b/g, 'on 2026-10-02')
      // Written as it was: dashes in a file name or run id, colons in a record.
      .replace(
        /\d{4}-\d\d-\d\dT\d\d([-:])\d\d[-:]\d\d(\.\d+)?Z/g,
        (_, sep) => `2026-10-02T00${sep}00${sep}00Z`,
      )
      .replace(/("git_sha": ")[0-9a-f]{7,40}(-dirty)?"/g, '$11a2b3c4"')
      .replace(/sha256:[0-9a-f]{12}/g, 'sha256:000000000000')
      // A folder `blueprints new` names for this month reads as October 2026.
      .replace(/\b20\d{2}(0[1-9]|1[0-2])-(?=[a-z])/g, '202610-')
  );
}

/* The one file a path names, where its last part may be a `*` pattern. */
function one(path) {
  const base = path.split('/').pop();
  if (!base.includes('*')) return path;
  const re = new RegExp(`^${base.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const hits = readdirSync(dirname(path)).filter((f) => re.test(f));
  if (hits.length !== 1)
    throw new Error(`cat ${path}: ${hits.length} files match, a screen shows one`);
  return join(dirname(path), hits[0]);
}

/* A folder as `tree -a --dirsfirst` prints it: its path, then every entry below it. */
function tree(dir, label = dir) {
  const out = [label];
  let dirs = 0;
  let files = 0;
  const walk = (d, pad) => {
    const names = readdirSync(d, { withFileTypes: true })
      .filter((e) => e.name !== '.git')
      .sort((a, b) => b.isDirectory() - a.isDirectory() || a.name.localeCompare(b.name));
    names.forEach((e, i) => {
      const last = i === names.length - 1;
      out.push(`${pad}${last ? '└── ' : '├── '}${e.name}`);
      if (e.isDirectory()) dirs++, walk(join(d, e.name), pad + (last ? '    ' : '│   '));
      else files++;
    });
  };
  walk(dir, '');
  return `${out.join('\n')}\n\n${dirs} directories, ${files} files\n`;
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
    // A file printed as `cat` prints it, where a screen is about what one says.
    if (scenario.cat) {
      const text = steady(readFileSync(one(join(m.root, scenario.cat)), 'utf8'), m);
      return { status: 0, stdout: text, stderr: '', text: text.replace(/\n+$/, '') };
    }
    // A folder drawn as `tree` draws it, where a screen is about a layout.
    if (scenario.tree) {
      const text = steady(
        tree(join(m.root, scenario.tree), scenario.tree.replace(/^shop\//, '')),
        m,
      );
      return { status: 0, stdout: text, stderr: '', text: text.replace(/\n+$/, '') };
    }
    // Where the command is typed: ~/shop, or a path under the machine's root.
    const r = m.wd(scenario.command, scenario.cwd ? join(m.root, scenario.cwd) : m.shop);
    const uuids = new Map();
    const stdout = steady(r.stdout, m, uuids);
    const stderr = steady(r.stderr, m, uuids);
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
