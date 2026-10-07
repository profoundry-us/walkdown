/*
 * A PROJECT'S BLUEPRINTS SHARE ITS SUITE, ITS NUMBERING AND ITS POINTER
 * (ADR 0013 §1-§4).
 *
 * One project, two blueprints - `a` and `b` - and one test suite tagged for
 * a rule of each and for a rule neither holds. The suite is filed by rule,
 * lint reads the project, thread ids are the project's, and the pointer
 * names both.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { threadAt } from '../tools/test-home.mjs';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const REPO = new URL('..', import.meta.url).pathname;
const REPORTER = join(REPO, 'lib', 'node-test-reporter.js');
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

// Built, never written whole, so this repository's own coverage scan does
// not read a fixture's tag as a check of a rule it lacks.
const tag = (id) => '@rule' + `:${id}`;

/*
 * A project `shop` with blueprints a and b, each holding one rule, and a
 * node:test suite tagged for both and for `nobody.holds.this`.
 */
function project({ commit = 'none' } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-sev-')));
  roots.push(root);
  const home = join(root, 'home');
  const shop = join(root, 'shop');
  mkdirSync(join(shop, 'test'), { recursive: true });
  mkdirSync(home, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: shop });
  const env = {
    ...process.env,
    WALKDOWN_HOME: home,
    WALKDOWN_SKILLS_DIR: join(home, 'skills'),
    NO_COLOR: '1',
  };
  delete env.WALKDOWN_SPEC;
  delete env.WALKDOWN_RUNS;
  delete env.WALKDOWN_RECORD_HOME;
  // A child `node --test` that inherits this runner's context reports into
  // it instead of running as a suite of its own.
  delete env.NODE_TEST_CONTEXT;
  const wd = (args, cwd = shop) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  for (const id of ['a', 'b']) {
    const made = wd(['blueprints', 'new', id, ...(commit === 'none' ? [] : ['--commit', commit])]);
    assert.equal(made.status, 0, made.stderr);
  }
  const specOf = (id) => JSON.parse(wd(['where', '--blueprint', id, '--json']).stdout).spec.path;
  // A home is one folder now (ADR 0014 §5): the spec is the home.
  const homeOf = (id) => specOf(id);
  for (const id of ['a', 'b']) {
    writeFileSync(
      join(specOf(id), 'features', `${id}.yml`),
      `feature: ${id}\nstories:\n  - id: ${id}.s\n    title: ${id}\n    statement: As a shopper I use ${id}.\n    rules:\n      - id: ${id}.s.works\n        statement: The ${id} page works.\n        verify: [checks]\n        steps:\n          then: [It works]\n`,
    );
    const cfg = join(specOf(id), 'spec.yml');
    writeFileSync(
      cfg,
      readFileSync(cfg, 'utf8')
        .replace(
          / {2}run_all: .*/,
          `  run_all: "node --test --test-reporter=${REPORTER} --test-reporter-destination=stdout"`,
        )
        .replace(/^ {2}location: .*$/m, '  location: test/'),
    );
    assert.equal(wd(['hash', '--write', '--blueprint', id]).status, 0);
  }
  writeFileSync(
    join(shop, 'test', 'shop.test.js'),
    [
      "import { test } from 'node:test';",
      ...['a.s.works', 'b.s.works', 'nobody.holds.this'].map(
        (r) => `test('${r} ${tag(r)}', () => {});`,
      ),
    ].join('\n'),
  );
  const runsOf = (id) => {
    const d = join(homeOf(id), 'runs');
    return existsSync(d)
      ? readdirSync(d)
          .filter((f) => f.endsWith('.json'))
          .map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')))
      : [];
  };
  const suite = (extra = {}) =>
    spawnSync(
      process.execPath,
      ['--test', `--test-reporter=${REPORTER}`, '--test-reporter-destination=stdout'],
      {
        cwd: shop,
        encoding: 'utf8',
        env: { ...env, ...extra },
      },
    );
  return { root, home, shop, env, wd, specOf, homeOf, runsOf, suite };
}

test('a recorded run files each result in the blueprint that holds its rule, under one run id @rule:locations.several.results-filed-by-rule', () => {
  const p = project();
  const out = p.suite();
  assert.equal(out.status, 0, out.stderr);
  const [ra, rb] = [p.runsOf('a'), p.runsOf('b')];
  assert.equal(ra.length, 1, out.stdout);
  assert.equal(rb.length, 1);
  assert.deepEqual(
    ra[0].results.map((r) => r.rule),
    ['a.s.works'],
  );
  assert.deepEqual(
    rb[0].results.map((r) => r.rule),
    ['b.s.works'],
  );
  assert.equal(ra[0].run_id, rb[0].run_id, 'one run, one id');
  assert.match(ra[0].results[0].statement_hash, /^sha256:/, 'stamped against its own blueprint');
  assert.match(out.stdout, /no blueprint in this project holds nobody\.holds\.this — not recorded/);
  assert.equal(JSON.stringify([ra, rb]).includes('nobody.holds.this'), false, 'recorded nowhere');
});

test('walkdown run with no --blueprint runs the suite once and files by rule; with one, only its results @rule:locations.several.results-filed-by-rule', () => {
  const p = project();
  const all = p.wd(['run']);
  assert.equal(all.status, 0, all.stderr + all.stdout);
  assert.equal((all.stdout.match(/✓ a\.s\.works/g) ?? []).length, 1, 'the shared suite ran once');
  assert.equal(p.runsOf('a').length, 1);
  assert.equal(p.runsOf('b').length, 1);

  const one = p.wd(['run', '--blueprint', 'a']);
  assert.equal(one.status, 0, one.stderr);
  assert.equal(p.runsOf('a').length, 2);
  assert.equal(p.runsOf('b').length, 1, 'nothing filed in b');
  assert.match(
    one.stdout,
    /set aside 1 result\(s\) for another blueprint in this project — b\.s\.works/,
  );
});

test('the Playwright reporter files by rule too @rule:locations.several.results-filed-by-rule', async () => {
  const p = project();
  const script = `
    import Reporter from ${JSON.stringify(join(REPO, 'lib', 'playwright-reporter.js'))};
    const t = (id) => ({ tags: [${JSON.stringify('@rule')} + ':' + id], title: id, outcome: () => 'expected', results: [{ duration: 1, attachments: [] }], location: { file: 'checks/x.spec.js', line: 1 } });
    const r = new Reporter({});
    r.onBegin({}, { allTests: () => ['a.s.works', 'b.s.works', 'nobody.holds.this'].map(t) });
    r.onEnd();`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: p.shop,
    encoding: 'utf8',
    env: p.env,
  });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(
    p.runsOf('a')[0].results.map((r) => r.rule),
    ['a.s.works'],
  );
  assert.deepEqual(
    p.runsOf('b')[0].results.map((r) => r.rule),
    ['b.s.works'],
  );
  assert.equal(p.runsOf('a')[0].run_id, p.runsOf('b')[0].run_id);
  assert.match(out.stdout, /no blueprint in this project holds nobody\.holds\.this/);
});

const hasRspec = spawnSync('rspec', ['--version'], { encoding: 'utf8' }).status === 0;
test('the RSpec formatter files by rule too @rule:locations.several.results-filed-by-rule', {
  skip: !hasRspec && 'rspec is not installed',
}, () => {
  const p = project();
  mkdirSync(join(p.shop, 'spec'), { recursive: true });
  writeFileSync(
    join(p.shop, 'spec', 'shop_spec.rb'),
    `RSpec.describe 'shop' do\n${['a.s.works', 'b.s.works', 'nobody.holds.this'].map((r) => `  it '${r}', rule: '${r}' do\n    expect(1).to eq(1)\n  end\n`).join('')}end\n`,
  );
  const lib = join(REPO, 'adapters', 'rspec', 'lib');
  const out = spawnSync(
    'rspec',
    [
      '-I',
      lib,
      '-r',
      'walkdown/formatter',
      '--format',
      'progress',
      '--format',
      'Walkdown::Formatter',
      'spec',
    ],
    {
      cwd: p.shop,
      encoding: 'utf8',
      env: p.env,
    },
  );
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.deepEqual(
    p.runsOf('a')[0].results.map((r) => r.rule),
    ['a.s.works'],
  );
  assert.deepEqual(
    p.runsOf('b')[0].results.map((r) => r.rule),
    ['b.s.works'],
  );
  assert.equal(p.runsOf('a')[0].run_id, p.runsOf('b')[0].run_id);
  assert.match(out.stdout, /no blueprint in this project holds nobody\.holds\.this/);
});

test("lint accepts a sibling blueprint's rule and thread, and still flags what no blueprint holds @rule:locations.several.lint-reads-the-project", () => {
  const p = project();
  // A rule of a's whose origin is a thread of b's.
  const filed = p.wd([
    'threads',
    'new',
    '--blueprint',
    'b',
    '--rule',
    'b.s.works',
    '--body',
    'something seen',
    '--json',
  ]);
  assert.equal(filed.status, 0, filed.stderr);
  const bThread = JSON.parse(filed.stdout).id;
  const fa = join(p.specOf('a'), 'features', 'a.yml');
  writeFileSync(
    fa,
    readFileSync(fa, 'utf8').replace(
      '        verify: [checks]',
      `        origin: thread:${bThread}\n        verify: [checks]`,
    ),
  );
  p.wd(['hash', '--write', '--blueprint', 'a']);

  const out = p.wd(['lint', '--blueprint', 'a', '--json']);
  const findings = JSON.parse(out.stdout).findings;
  const about = (s) => findings.filter((f) => f.subject === s || f.message.includes(s));
  assert.deepEqual(
    about('b.s.works').filter((f) => f.category === 'coverage'),
    [],
    "b's tag is b's",
  );
  assert.deepEqual(about(bThread), [], "b's thread is a thread");
  assert.equal(
    about('nobody.holds.this').filter((f) => f.level === 'error').length,
    1,
    'a tag nobody holds is still an error',
  );

  // A run record of a's with a result for a rule b now holds - a verdict
  // that moved with its rule - and a thread of a's on a screen of b's.
  writeFileSync(
    join(p.specOf('b'), 'storyboard.yml'),
    'screens:\n  - id: cart\n    app: { path: /cart }\n',
  );
  mkdirSync(join(p.homeOf('a'), 'runs'), { recursive: true });
  writeFileSync(
    join(p.homeOf('a'), 'runs', '2026-10-01T00-00-00Z-local-01.json'),
    JSON.stringify({
      run_id: '2026-10-01T00-00-00Z-local-01',
      created: '2026-10-01T00:00:00Z',
      actor: 't',
      kind: 'checks',
      target: 'local',
      results: [{ rule: 'b.s.works', status: 'pass' }],
    }),
  );
  const onScreen = p.wd([
    'threads',
    'new',
    '--blueprint',
    'a',
    '--rule',
    'a.s.works',
    '--body',
    'seen on the cart',
    '--json',
  ]);
  const sid = JSON.parse(onScreen.stdout).id;
  const tf = threadAt(p.homeOf('a'), 'threads', sid);
  writeFileSync(
    tf,
    readFileSync(tf, 'utf8').replace('  rule: a.s.works', '  rule: a.s.works\n  screen: cart'),
  );
  const withSiblings = JSON.parse(p.wd(['lint', '--blueprint', 'a', '--json']).stdout).findings;
  assert.deepEqual(
    withSiblings.filter((f) => /unknown rule "b\.s\.works"|unknown screen "cart"/.test(f.message)),
    [],
    'the project knows them',
  );
  writeFileSync(tf, readFileSync(tf, 'utf8').replace('screen: cart', 'screen: nowhere'));
  assert.ok(
    JSON.parse(p.wd(['lint', '--blueprint', 'a', '--json']).stdout).findings.some((f) =>
      f.message.includes('unknown screen "nowhere"'),
    ),
    'a screen no blueprint has is still an error',
  );

  writeFileSync(
    fa,
    readFileSync(fa, 'utf8').replace(`origin: thread:${bThread}`, 'origin: thread:n-9999'),
  );
  p.wd(['hash', '--write', '--blueprint', 'a']);
  const again = JSON.parse(p.wd(['lint', '--blueprint', 'a', '--json']).stdout).findings;
  assert.ok(
    again.some((f) => f.message.includes('unknown thread "n-9999"')),
    'a thread no blueprint holds still warns',
  );
});

test("a new thread's label is numbered across the project's blueprints, and its file is its UUID @rule:locations.threads.uuid-is-the-identity", () => {
  const p = project();
  const file = (bp, kind = 'note', extra = []) => {
    const r = p.wd([
      'threads',
      'new',
      '--blueprint',
      bp,
      '--rule',
      `${bp}.s.works`,
      '--body',
      'seen',
      '--kind',
      kind,
      ...extra,
      '--json',
    ]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).id;
  };
  const ids = [file('a'), file('a'), file('a'), file('a'), file('a')];
  assert.deepEqual(ids, ['n-0001', 'n-0002', 'n-0003', 'n-0004', 'n-0005']);
  assert.equal(file('b'), 'n-0006', 'b counts past a');
  assert.equal(
    file('a', 'question', ['--option', 'Yes :: do it', '--option', 'No :: leave it']),
    'q-0007',
  );

  // Every file is named by its thread's UUID, with the label inside it.
  const aThreads = join(p.homeOf('a'), 'threads');
  for (const f of readdirSync(aThreads).filter((f) => f.endsWith('.yml'))) {
    const [uuid] = f.split('.yml');
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, f);
    assert.match(readFileSync(join(aThreads, f), 'utf8'), new RegExp(`^uuid: ${uuid}$`, 'm'));
  }

  // Labels that already collide stay as they are, and the next counts past both.
  const bThreads = join(p.homeOf('b'), 'threads');
  const n1 = threadAt(aThreads, 'n-0001');
  writeFileSync(join(bThreads, 'copied.yml'), readFileSync(n1, 'utf8'));
  assert.equal(file('b'), 'n-0008');
  assert.ok(existsSync(join(bThreads, 'copied.yml')) && existsSync(n1));

  // A run record written now names a thread by its UUID; one already in the
  // ledger keeps its label, unchanged, and both are read as the label.
  const runs = join(p.homeOf('a'), 'runs');
  mkdirSync(runs, { recursive: true });
  const old = join(runs, '2026-09-01T00-00-00Z-local-01.json');
  const oldText = JSON.stringify({
    run_id: '2026-09-01T00-00-00Z-local-01',
    created: '2026-09-01T00:00:00Z',
    actor: 'sam',
    kind: 'walkdown',
    target: 'local',
    results: [{ rule: 'a.s.works', status: 'fail', threads: ['n-0001'] }],
  });
  writeFileSync(old, oldText);
  const wrote = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { writeRunRecord } from ${JSON.stringify(join(REPO, 'lib', 'run-record.js'))};
       const { record } = writeRunRecord({ blueprintDir: ${JSON.stringify(p.homeOf('a'))}, cwd: process.cwd(), target: 'local', actor: 'sam', kind: 'walkdown',
         results: [{ rule: 'a.s.works', status: 'fail', threads: ['n-0002', 'n-0006'] }] });
       console.log(JSON.stringify(record));`,
    ],
    { cwd: p.shop, encoding: 'utf8', env: p.env },
  );
  assert.equal(wrote.status, 0, wrote.stderr);
  const n2 = readFileSync(threadAt(aThreads, 'n-0002'), 'utf8').match(/^uuid: (.+)$/m)[1];
  // n-0006 is b's: a label is the project's, and so is the lookup.
  const n6 = readFileSync(threadAt(bThreads, 'n-0006'), 'utf8').match(/^uuid: (.+)$/m)[1];
  assert.deepEqual(
    JSON.parse(wrote.stdout).results[0].threads,
    [n2, n6],
    'each label became its UUID',
  );
  // And filing says the UUID, so a hand-written record can cite it.
  const filed = JSON.parse(
    p.wd(['threads', 'new', '--blueprint', 'a', '--rule', 'a.s.works', '--body', 'again', '--json'])
      .stdout,
  );
  assert.match(filed.uuid, /^[0-9a-f-]{36}$/);
  assert.equal(readFileSync(old, 'utf8'), oldText, 'the old record is not edited');
  const st = JSON.parse(p.wd(['status', '--blueprint', 'a', '--json']).stdout);
  assert.match(
    JSON.stringify(st.rows.find((r) => r.rule === 'a.s.works')),
    /"threads":\["n-0002","n-0006"\]/,
    'and read back as their labels',
  );
});

test('the pointer names no blueprint, and is the same paragraph with one blueprint or two @rule:locations.pointer.names-no-blueprint', () => {
  const p = project({ commit: 'spec' });
  const claude = join(p.shop, 'CLAUDE.md');
  const block = () => readFileSync(claude, 'utf8');
  // The first commit placed it.
  assert.match(block(), /specs are walkdown blueprints, under `\.walkdown\/blueprints\/`/);
  assert.match(
    block(),
    /read and follow the `AGENTS\.md` in the\s+folder of the blueprint you are working on/,
  );
  assert.match(block(), /`walkdown blueprints` lists them\s+with their IDs/);
  assert.match(block(), /commands that write take `--blueprint <id>`/);
  // No name, no folder, no ID.
  for (const id of ['a', 'b']) {
    const row = JSON.parse(p.wd(['where', '--blueprint', id, '--json']).stdout);
    assert.doesNotMatch(block(), new RegExp(`\`${id}\``), `${id} is not named`);
    assert.equal(block().includes(row.id), false, `${id}'s ID is not in it`);
    assert.equal(
      block().includes(`blueprints/${row.spec.path.split('/').at(-1)}`),
      false,
      `${id}'s folder is not in it`,
    );
  }
  assert.equal(block().includes(p.home), false, 'no machine path in a committed file');

  const again = p.wd(['pointer', '--into', 'CLAUDE.md']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already current/);
  assert.equal(block().split('<!-- walkdown:begin -->').length, 2, 'once');

  // b leaves the repository: nothing in the paragraph was about b, so
  // nothing in it changes.
  const before = block();
  const out = p.wd(['blueprints', 'commit', 'none', '--blueprint', 'b']);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(block(), before);
});

test('a project with one blueprint gets the same paragraph, and files every result as before @rule:locations.pointer.names-no-blueprint @rule:locations.several.results-filed-by-rule', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-solo-')));
  roots.push(root);
  const solo = join(root, 'solo');
  mkdirSync(solo, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: solo });
  const env = {
    ...process.env,
    WALKDOWN_HOME: join(root, 'home'),
    WALKDOWN_SKILLS_DIR: join(root, 'home', 'skills'),
    NO_COLOR: '1',
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.WALKDOWN_RECORD_HOME;
  delete env.WALKDOWN_SPEC;
  assert.equal(
    spawnSync(process.execPath, [CLI, 'blueprints', 'new', '--commit', 'spec'], { cwd: solo, env })
      .status,
    0,
  );
  const text = readFileSync(join(solo, 'CLAUDE.md'), 'utf8');
  assert.match(text, /specs are walkdown blueprints, under `\.walkdown\/blueprints\/`/);
  assert.doesNotMatch(text, /solo/, 'not even the only one is named');

  writeFileSync(
    join(solo, 'x.test.js'),
    `import { test } from 'node:test';\ntest('t ${tag('not.in.this.blueprint')}', () => {});\n`,
  );
  const out = spawnSync(
    process.execPath,
    ['--test', `--test-reporter=${REPORTER}`, '--test-reporter-destination=stdout'],
    { cwd: solo, encoding: 'utf8', env },
  );
  assert.match(
    out.stdout,
    /recorded 1 rule result\(s\) →/,
    'held or not, filed in the one blueprint, as before',
  );
  assert.doesNotMatch(out.stdout, /for solo|not recorded|set aside/);
});

/*
 * A screen's page is loaded by the browser, in a frame, so its address can
 * carry no `?bp=` - nor can anything that page loads. A server standing over
 * several blueprints serves it when the file it names is one file, and names
 * the blueprints when they disagree.
 */
test('a framed screen is served without ?bp= when its file is one file, and refused by name when it is two @rule:locations.several.serve-shows-each-screen', async () => {
  const p = project();
  const { createWalkdownServer } = await import('../lib/serve.js');
  mkdirSync(join(p.shop, 'as-built'), { recursive: true });
  writeFileSync(join(p.shop, 'as-built', 'home.html'), '<p>as built</p>');
  for (const id of ['a', 'b']) {
    const cfg = join(p.specOf(id), 'spec.yml');
    writeFileSync(
      cfg,
      `${readFileSync(cfg, 'utf8').replace(/^prototype:[\s\S]*?(?=^\S)/m, '')}\nprototype:\n  root: proto-${id}/\n`,
    );
    mkdirSync(join(p.shop, `proto-${id}`, 'screens'), { recursive: true });
    writeFileSync(join(p.shop, `proto-${id}`, 'screens', 'both.html'), `<p>${id}</p>`);
  }
  writeFileSync(join(p.shop, 'proto-a', 'screens', 'only-a.html'), '<p>only a</p>');
  const was = process.env.WALKDOWN_HOME;
  process.env.WALKDOWN_HOME = p.home;
  const server = createWalkdownServer(null, { cwd: p.shop });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const at = (path) => fetch(`http://127.0.0.1:${server.address().port}${path}`);
  try {
    const shared = await at('/as-built/home.html');
    assert.equal(shared.status, 200, 'one as-built/ for both: nothing to choose');
    assert.equal(await shared.text(), '<p>as built</p>');
    const one = await at('/prototype/screens/only-a.html');
    assert.equal(one.status, 200, 'only a has it');
    assert.equal(await one.text(), '<p>only a</p>');
    const two = await at('/prototype/screens/both.html');
    assert.equal(two.status, 409);
    assert.match(
      (await two.json()).error,
      /different file in \d{4}-[a-z0-9]+-a and \d{4}-[a-z0-9]+-b/,
    );
    const none = await at('/prototype/screens/nowhere.html');
    assert.equal(none.status, 404);
    assert.match((await none.json()).error, /is in no blueprint registered here/);
    assert.equal((await at('/as-built/home.html?bp=b')).status, 200, 'named, as ever');
  } finally {
    server.close();
    if (was === undefined) delete process.env.WALKDOWN_HOME;
    else process.env.WALKDOWN_HOME = was;
  }
});
