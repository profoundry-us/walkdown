/*
 * THE COMMAND LINE'S SHAPE, STEP BY STEP (ADR 0012).
 *
 * test/cli/scenarios/ draws one moment of each command for a person to look
 * at; this walks every step the `commands` rules name, on a throwaway machine
 * of the same kind (tools/cli-scenarios.mjs), and looks at the disk as well
 * as the words.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { machine, steady } from '../tools/cli-scenarios.mjs';
import { parse } from '../vendor/yaml.js';

const nm = (id) => String(id).replace(/^\d{4}-[a-z0-9]{2,3}-/, '');
const registry = (m) => parse(readFileSync(join(m.home, 'registry.yml'), 'utf8'))?.blueprints ?? [];

/* Every file under a directory, path -> contents, for "byte for byte". */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p.slice(dir.length)] = readFileSync(p, 'utf8');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/* A real repository, for the commands that ask git. */
function gitInit(m) {
  rmSync(join(m.shop, '.git'), { recursive: true, force: true });
  spawnSync('git', ['init', '-q'], { cwd: m.shop, env: m.env });
}

/* `checkout` with one rule, `checkout.basics.pays`. */
function oneRule(m, id = 'checkout') {
  m.ok(['blueprints', 'new', id]);
  const features = join(m.specOf(id), 'features');
  for (const f of readdirSync(features)) rmSync(join(features, f));
  writeFileSync(
    join(features, 'checkout.yml'),
    [
      'feature: checkout',
      'stories:',
      '  - id: checkout.basics',
      '    title: Paying',
      '    statement: As a shopper I pay.',
      '    rules:',
      '      - id: checkout.basics.pays',
      '        statement: A card payment goes through.',
      '        verify: [checks]',
      '        steps:',
      '          then: [It does]',
      '',
    ].join('\n'),
  );
  m.ok(['hash', '--write', '--blueprint', id]);
}

test('a noun alone lists, and each noun takes its verbs @rule:commands.shape.noun-then-verb', () => {
  const m = machine();
  try {
    oneRule(m);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'Declined cards do nothing.',
      '--blueprint',
      'checkout',
    ]);
    for (const noun of ['blueprints', 'threads', 'records']) {
      const bare = m.wd([noun]);
      const list = m.wd([noun, 'list']);
      assert.equal(bare.status, 0, `${noun}: ${bare.stderr}`);
      assert.equal(
        bare.stdout,
        list.stdout,
        `bare \`${noun}\` prints what \`${noun} list\` prints`,
      );
      assert.ok(bare.stdout.trim(), `${noun} lists something`);
    }
    const verbs = (noun) => m.wd([noun, 'help']).stdout.split('\n')[0];
    assert.match(verbs('blueprints'), /<list\|new\|import\|rename\|commit\|forget>/);
    assert.match(verbs('threads'), /<list\|new\|show\|reply\|set\|relabel>/);
    assert.match(verbs('records'), /<list\|move>/);
    assert.match(verbs('rules'), /<move\|rename>/);
    for (const cmd of [
      'status',
      'lint',
      'hash',
      'run',
      'judge',
      'sweep',
      'where',
      'claims',
      'serve',
      'pointer',
      'skills',
    ]) {
      const r = m.wd([cmd, '--help']);
      assert.equal(r.status, 0, `${cmd} keeps its name`);
      assert.match(r.stdout, new RegExp(`^Usage: walkdown ${cmd}`, 'm'));
    }
    const nope = m.wd(['threads', 'shout']);
    assert.equal(nope.status, 2);
    assert.match(nope.stderr, /no verb "shout"\. It takes list, new, show, reply, set/);
  } finally {
    m.done();
  }
});

test('every retired form exits 2, changes nothing, and prints the form that replaced it @rule:commands.shape.old-forms-say-the-new', () => {
  const m = machine();
  try {
    oneRule(m);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'Declined cards do nothing.',
      '--blueprint',
      'checkout',
    ]);
    const before = { home: snapshot(m.home), shop: snapshot(m.shop) };
    const cases = [
      [['thread', 'n-0001', '--reply', 'ok'], 'walkdown threads reply n-0001 ok'],
      [
        ['thread', 'n-0001', '--status', 'addressed'],
        'walkdown threads set n-0001 --status addressed',
      ],
      [['thread', 'n-0001'], 'walkdown threads show n-0001'],
      [
        ['thread', 'new', '--rule', 'x', '--body', 'two words'],
        'walkdown threads new --rule x --body "two words"',
      ],
      [['move', 'runs', '--to', 'x'], 'walkdown records move runs --to x'],
      [['import', '.'], 'walkdown blueprints import .'],
      [['blueprint', 'forget', 'a'], 'walkdown blueprints forget a'],
      [['init', '--id', 'b'], 'walkdown blueprints new b'],
      [['init', '--commit', 'spec', '--id', 'b'], 'walkdown blueprints commit spec --blueprint b'],
    ];
    for (const [argv, now] of cases) {
      const r = m.wd(argv);
      assert.equal(r.status, 2, `${argv.join(' ')} exits 2`);
      assert.ok(
        r.stderr.split('\n').includes(`  ${now}`),
        `${argv.join(' ')} says ${now}:\n${r.stderr}`,
      );
      assert.match(r.stderr, /Nothing was changed/);
    }
    assert.deepEqual(snapshot(m.home), before.home, 'the home is as it was');
    assert.deepEqual(snapshot(m.shop), before.shop, 'the project is as it was');
  } finally {
    m.done();
  }
});

test('the help is grouped in order, and a noun lists its verbs with their usage @rule:commands.shape.help-by-noun', () => {
  const m = machine();
  try {
    const help = m.wd(['help']).stdout.split('\n');
    const groups = [
      'Getting ready',
      'Blueprints',
      'Records',
      'Threads',
      'Rules and verdicts',
      'The panel',
    ];
    const at = groups.map((g) => help.indexOf(g));
    assert.ok(
      at.every((i) => i >= 0),
      `every group is there: ${at}`,
    );
    assert.deepEqual(
      [...at].sort((a, b) => a - b),
      at,
      'in that order',
    );
    const threads = m.wd(['threads', 'help']).stdout;
    for (const verb of ['list', 'new', 'show', 'reply', 'set'])
      assert.match(
        threads,
        new RegExp(`^  walkdown threads (\\[${verb}\\]|${verb})`, 'm'),
        `${verb} has its usage line`,
      );
  } finally {
    m.done();
  }
});

test('init readies the machine, makes no blueprint, and the second run creates nothing @rule:commands.init.this-machine-only', () => {
  const m = machine();
  try {
    rmSync(m.home, { recursive: true, force: true });
    const shop = snapshot(m.shop);
    const first = m.wd(['init']);
    assert.equal(first.status, 0, first.stderr);
    const said = steady(first.stdout, m);
    assert.match(said, /\+ created {2}~\/\.walkdown$/m);
    assert.match(said, /\+ created {2}~\/\.walkdown\/registry\.yml$/m);
    assert.match(
      readFileSync(join(m.home, 'profile.yml'), 'utf8'),
      /username: sam/,
      'the identity git knows',
    );
    assert.deepEqual(registry(m), [], 'no blueprint registered');
    assert.deepEqual(snapshot(m.shop), shop, 'nothing written in the project');
    assert.match(said, /`walkdown blueprints new` starts a spec\.\s*$/);

    const home = snapshot(m.home);
    const again = m.wd(['init']);
    assert.equal(again.status, 0);
    assert.doesNotMatch(again.stdout, /created|\+ /);
    assert.match(steady(again.stdout, m), /up to date {2}~\/\.walkdown$/m);
    assert.deepEqual(snapshot(m.home), home, 'nothing changed the second time');
  } finally {
    m.done();
  }
});

test('init installs the skills the way `walkdown skills` does, with the same lines @rule:commands.init.one-skill-installer', () => {
  const a = machine();
  const b = machine();
  try {
    rmSync(a.home, { recursive: true, force: true });
    const viaInit = steady(a.wd(['init']).stdout, a);
    const viaSkills = steady(
      b.wd(['skills', '--into', join(b.root, 'claude', 'skills')]).stdout,
      b,
    );
    const skillLines = (text) =>
      text
        .split('\n')
        .filter(
          (l) => /~\/\.claude\/skills/.test(l) || /^ {2}(Claude Code|Updating|Copies)/.test(l),
        );
    assert.ok(skillLines(viaInit).length >= 2, viaInit);
    assert.deepEqual(skillLines(viaInit), skillLines(viaSkills));
    assert.deepEqual(
      readdirSync(join(a.root, 'claude', 'skills')),
      readdirSync(join(b.root, 'claude', 'skills')),
    );
  } finally {
    a.done();
    b.done();
  }
});

test('init names what the machine lacks, installs none of it, and sets up the rest @rule:commands.init.names-what-is-missing', () => {
  const m = machine({ path: 'node-only' });
  try {
    rmSync(m.home, { recursive: true, force: true });
    rmSync(join(m.root, 'claude'), { recursive: true, force: true });
    const r = m.wd(['init']);
    assert.equal(r.status, 1, 'a missing need is exit 1');
    assert.match(r.stdout, /✗ git\s+not found — .*https:\/\/git-scm\.com/);
    assert.match(r.stdout, /walkdown needs git and does not install it itself/);
    assert.match(r.stdout, /\? claude\s+.* is not there/, 'says Claude Code is not here');
    assert.doesNotMatch(r.stdout, /✗ claude/, 'and does not fail over it');
    assert.ok(existsSync(join(m.home, 'registry.yml')), 'what it could set up is set up');

    // With git back, no Claude Code is a word, not a failure.
    const fine = machine();
    try {
      rmSync(join(fine.root, 'claude'), { recursive: true, force: true });
      const ok = fine.wd(['init']);
      assert.equal(ok.status, 0, ok.stdout);
      assert.match(ok.stdout, /\? claude/);
    } finally {
      fine.done();
    }
  } finally {
    m.done();
  }
});

test('blueprints new makes one outside the repository, again changes nothing, and a name makes another @rule:commands.blueprints.new-makes-one', () => {
  const m = machine();
  try {
    m.ok(['init']);
    const shop = snapshot(m.shop);
    const first = m.wd(['blueprints', 'new']);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(
      registry(m).map((r) => nm(r.id)),
      ['shop'],
      'named for the directory',
    );
    const personal = join(m.home, 'projects', 'shop', 'blueprints');
    assert.deepEqual(readdirSync(personal), ['shop'], 'in a folder named after the blueprint');
    assert.ok(existsSync(join(personal, readdirSync(personal)[0], 'spec.yml')));
    assert.deepEqual(snapshot(m.shop), shop, 'nothing added to the repository');

    const again = m.wd(['blueprints', 'new']);
    assert.equal(again.status, 0);
    assert.doesNotMatch(again.stdout, /created|listed/);

    const another = m.wd(['blueprints', 'new', 'search']);
    assert.equal(another.status, 0, another.stderr);
    assert.match(
      another.stdout,
      /added to `shop`, beside `shop` — commands that write take `--blueprint <id>`/,
    );
    assert.deepEqual(
      registry(m)
        .map((r) => nm(r.id))
        .sort(),
      ['search', 'shop'],
    );
  } finally {
    m.done();
  }
});

test('with no terminal, blueprints new in a folder inside the checkout joins its project, named for the folder, and --project makes one of its own @rule:commands.blueprints.new-makes-one', () => {
  const m = machine();
  try {
    m.ok(['init']);
    m.ok(['blueprints', 'new']);
    const api = join(m.shop, 'api');
    mkdirSync(api);

    const joined = m.wd(['blueprints', 'new'], api);
    assert.equal(joined.status, 0, joined.stderr);
    const said = joined.stdout + joined.stderr;
    assert.match(
      said,
      /api is inside .*shop, so this blueprint joins its project `shop`\. `--project <label>` makes a project of its own instead\./,
    );
    const rows = registry(m);
    assert.deepEqual(
      rows.map((r) => nm(r.id)),
      ['shop', 'api'],
      "named for the folder, never taken for shop's own",
    );
    assert.deepEqual(
      rows.map((r) => r.project),
      ['shop', 'shop'],
      'in the project `shop`',
    );
  } finally {
    m.done();
  }
  // The same folder with --project api is a project of its own, and nothing is asked.
  const n = machine();
  try {
    n.ok(['init']);
    n.ok(['blueprints', 'new']);
    const api = join(n.shop, 'api');
    mkdirSync(api);
    const separate = n.wd(['blueprints', 'new', '--project', 'api'], api);
    assert.equal(separate.status, 0, separate.stderr);
    assert.doesNotMatch(separate.stdout + separate.stderr, /joins its project/);
    const row = registry(n).find((r) => nm(r.id) === 'api');
    assert.equal(row?.project, 'api', 'a project of its own');
  } finally {
    n.done();
  }
});

test('blueprints commit moves the whole home in and out, keeping its folder name and its ID @rule:commands.blueprints.commit-moves-the-home', () => {
  const m = machine();
  try {
    gitInit(m);
    m.ok(['blueprints', 'new', 'shop']);
    m.ok(['blueprints', 'new', 'search']);
    const idOf = (name) => registry(m).find((r) => nm(r.id) === name).id;
    const shopId = idOf('shop');
    const runs = m.ok(['where', 'runs', '--blueprint', 'shop']).stdout.trim();
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, 'r.json'), '{"a run":true}\n');
    const outside = m.ok(['where', 'spec', '--blueprint', 'shop']).stdout.trim();
    const folder = basename(outside);
    const search = snapshot(m.ok(['where', 'spec', '--blueprint', 'search']).stdout.trim());

    m.ok(['blueprints', 'commit', 'spec', '--blueprint', 'shop']);
    const inside = join(m.shop, '.walkdown', 'blueprints', folder);
    assert.equal(
      m.ok(['where', 'spec', '--blueprint', 'shop']).stdout.trim(),
      inside,
      'the same folder name, in the repository',
    );
    assert.equal(
      readFileSync(
        join(m.ok(['where', 'runs', '--blueprint', 'shop']).stdout.trim(), 'r.json'),
        'utf8',
      ),
      '{"a run":true}\n',
      'records and all',
    );
    assert.match(
      readFileSync(join(inside, '.gitignore'), 'utf8'),
      /^runs\/$/m,
      'with its own .gitignore',
    );
    assert.equal(idOf('shop'), shopId, 'the ID is the same');

    m.ok(['blueprints', 'commit', 'none', '--blueprint', 'shop']);
    assert.equal(existsSync(inside), false, 'back out');
    assert.equal(m.ok(['where', 'spec', '--blueprint', 'shop']).stdout.trim(), outside);
    assert.equal(
      readFileSync(
        join(m.ok(['where', 'runs', '--blueprint', 'shop']).stdout.trim(), 'r.json'),
        'utf8',
      ),
      '{"a run":true}\n',
    );
    assert.equal(idOf('shop'), shopId, 'and still the same');
    assert.deepEqual(
      snapshot(m.ok(['where', 'spec', '--blueprint', 'search']).stdout.trim()),
      search,
      "no other blueprint's files change",
    );

    // A committed folder with the same name as search's: refused, and nothing moves.
    const searchFolder = basename(m.ok(['where', 'spec', '--blueprint', 'search']).stdout.trim());
    mkdirSync(join(m.shop, '.walkdown', 'blueprints', searchFolder), { recursive: true });
    writeFileSync(
      join(m.shop, '.walkdown', 'blueprints', searchFolder, 'spec.yml'),
      'blueprint: someone-elses\n',
    );
    const taken = m.wd(['blueprints', 'commit', 'spec', '--blueprint', 'search']);
    assert.equal(taken.status, 2);
    assert.match(taken.stderr, new RegExp(searchFolder));
    assert.deepEqual(
      snapshot(m.ok(['where', 'spec', '--blueprint', 'search']).stdout.trim()),
      search,
      'and nothing moved',
    );
  } finally {
    m.done();
  }
});

test('blueprints rename changes the name its ID ends with, and with --folder its folder, and nothing it holds @rule:commands.blueprints.rename', () => {
  const m = machine();
  try {
    gitInit(m);
    m.ok(['blueprints', 'new', 'a']);
    oneRule(m, 'b');
    m.ok(['blueprints', 'commit', 'spec', '--blueprint', 'b']);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'Declined cards do nothing.',
      '--blueprint',
      'b',
    ]);
    const home = m.ok(['where', 'spec', '--blueprint', 'b']).stdout.trim();
    const was = registry(m).find((r) => nm(r.id) === 'b').id;
    const held = snapshot(home);
    const repo = snapshot(m.shop);
    const status = m.ok(['status', '--blueprint', 'b', '--json']).stdout;

    const r = m.wd(['blueprints', 'rename', 'b', 'search']);
    assert.equal(r.status, 0, r.stderr);
    const now = registry(m).find((row) => nm(row.id) === 'search');
    assert.ok(now && !registry(m).some((row) => nm(row.id) === 'b'));
    assert.equal(
      now.id,
      `${was.slice(0, was.lastIndexOf('-'))}-search`,
      'keeping its number and its project code',
    );
    assert.equal(
      m.ok(['where', 'spec', '--blueprint', 'search']).stdout.trim(),
      home,
      'its folder is unchanged',
    );
    assert.deepEqual(snapshot(m.shop), repo, 'and nothing in the repository changed');
    assert.equal(
      m.ok(['status', '--blueprint', 'search', '--json']).stdout,
      status.replaceAll(was, now.id),
      'status reads as b did',
    );

    // With --folder, the folder is renamed, and that is the only change in the repository.
    const f = m.wd(['blueprints', 'rename', 'search', 'search', '--folder', '202610-search']);
    assert.equal(f.status, 0, f.stderr);
    const moved = join(m.shop, '.walkdown', 'blueprints', '202610-search');
    assert.equal(m.ok(['where', 'spec', '--blueprint', 'search']).stdout.trim(), moved);
    assert.deepEqual(snapshot(moved), held, 'its rules, threads and runs byte for byte');
    const rel = (p) => p.slice(m.shop.length);
    const expected = Object.fromEntries(
      Object.entries(repo).map(([k, v]) => [k.replace(rel(home), rel(moved)), v]),
    );
    assert.deepEqual(snapshot(m.shop), expected, 'the rename is the only change in the repository');

    const before = { home: snapshot(m.home), shop: snapshot(m.shop) };
    for (const bad of [
      ['a', 'search'],
      ['a', 'Not An Id'],
    ]) {
      const refused = m.wd(['blueprints', 'rename', ...bad]);
      assert.equal(refused.status, 2, `${bad.join(' → ')} is refused`);
    }
    assert.deepEqual(
      { home: snapshot(m.home), shop: snapshot(m.shop) },
      before,
      'and nothing changed',
    );
  } finally {
    m.done();
  }
});

test('records move moves one kind and the registry says where @rule:commands.records.move', () => {
  const m = machine();
  try {
    m.ok(['blueprints', 'new']);
    const evidence = m.ok(['where', 'evidence']).stdout.trim();
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, 'shot.png'), 'png');
    const to = join(m.root, 'elsewhere', 'evidence');
    const r = m.wd(['records', 'move', 'evidence', '--to', to, '--blueprint', 'shop']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(to, 'shot.png'), 'utf8'), 'png');
    assert.equal(m.ok(['where', 'evidence']).stdout.trim(), to);
    assert.match(readFileSync(join(m.home, 'registry.yml'), 'utf8'), /elsewhere/);
  } finally {
    m.done();
  }
});

test('show reads, reply says, set changes, and a refused change lands nothing @rule:commands.threads.one-verb-per-change', () => {
  const m = machine();
  try {
    oneRule(m);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'Declined cards do nothing.',
      '--blueprint',
      'checkout',
    ]);
    m.ok([
      'threads',
      'new',
      '--kind',
      'question',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'Which cards?',
      '--blueprint',
      'checkout',
    ]);
    const threads = m.ok(['where', 'threads']).stdout.trim();
    const ids = JSON.parse(m.ok(['threads', 'list', '--json']).stdout)
      .map((t) => t.id)
      .sort();
    const [note, question] = [
      ids.find((i) => i.startsWith('n-')),
      ids.find((i) => i.startsWith('q-')),
    ];
    const read = (id) => JSON.parse(m.ok(['threads', 'show', id, '--json']).stdout);

    const before = snapshot(threads);
    m.ok(['threads', 'show', note]);
    assert.deepEqual(snapshot(threads), before, 'show changes nothing');

    m.ok(['threads', 'reply', note, 'done', '--blueprint', 'checkout']);
    assert.equal(read(note).status, 'open', 'a reply leaves the status');
    assert.equal(read(note).replies.at(-1).body, 'done');

    m.ok(['threads', 'reply', note, '--as-agent', 'flags first', '--blueprint', 'checkout']);
    assert.equal(
      read(note).replies.at(-1).body,
      'flags first',
      'the text is found after the flags too',
    );

    m.ok([
      'threads',
      'set',
      note,
      '--status',
      'addressed',
      '--reply',
      'fixed in 1a2b3c',
      '--blueprint',
      'checkout',
    ]);
    assert.equal(read(note).status, 'addressed');
    assert.equal(
      read(note).replies.at(-1).body,
      'fixed in 1a2b3c',
      'the reply landed with the change',
    );

    m.ok([
      'threads',
      'set',
      question,
      '--status',
      'answered',
      '--reply',
      'Visa only.',
      '--blueprint',
      'checkout',
    ]);
    const settled = snapshot(threads);
    const refused = m.wd([
      'threads',
      'set',
      question,
      '--status',
      'open',
      '--reply',
      'never mind',
      '--blueprint',
      'checkout',
    ]);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /reply did not land/);
    assert.deepEqual(snapshot(threads), settled, 'refused whole');

    // reply refuses a status, and set refuses to be a bare reply.
    assert.equal(
      m.wd(['threads', 'reply', note, 'x', '--status', 'open', '--blueprint', 'checkout']).status,
      2,
    );
    assert.equal(
      m.wd(['threads', 'set', note, '--reply', 'x', '--blueprint', 'checkout']).status,
      2,
    );
  } finally {
    m.done();
  }
});
