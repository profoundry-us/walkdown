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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

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
  const env = { ...process.env, WALKDOWN_HOME: home, WALKDOWN_SKILLS_DIR: join(home, 'skills'), NO_COLOR: '1' };
  delete env.WALKDOWN_SPEC;
  delete env.WALKDOWN_RUNS;
  delete env.WALKDOWN_RECORD_HOME;
  // A child `node --test` that inherits this runner's context reports into
  // it instead of running as a suite of its own.
  delete env.NODE_TEST_CONTEXT;
  const wd = (args, cwd = shop) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  for (const id of ['a', 'b']) {
    const made = wd(['init', '--id', id, ...(commit === 'none' ? [] : ['--commit', commit])]);
    assert.equal(made.status, 0, made.stderr);
  }
  const specOf = (id) => JSON.parse(wd(['where', '--blueprint', id, '--json']).stdout).spec.path;
  const homeOf = (id) => join(specOf(id), '..');
  for (const id of ['a', 'b']) {
    writeFileSync(
      join(specOf(id), 'features', `${id}.yml`),
      `feature: ${id}\nstories:\n  - id: ${id}.s\n    title: ${id}\n    statement: As a shopper I use ${id}.\n    rules:\n      - id: ${id}.s.works\n        statement: The ${id} page works.\n        verify: [checks]\n        steps:\n          then: [It works]\n`,
    );
    const cfg = join(specOf(id), 'walkdown.yml');
    writeFileSync(
      cfg,
      readFileSync(cfg, 'utf8')
        .replace(/ {2}run_all: .*/, `  run_all: "node --test --test-reporter=${REPORTER} --test-reporter-destination=stdout"`)
        .replace(/ {2}list: .*/, `  list: "grep -rn '@rule:' test/"`),
    );
    assert.equal(wd(['hash', '--write', '--blueprint', id]).status, 0);
  }
  writeFileSync(
    join(shop, 'test', 'shop.test.js'),
    ["import { test } from 'node:test';", ...['a.s.works', 'b.s.works', 'nobody.holds.this'].map((r) => `test('${r} ${tag(r)}', () => {});`)].join('\n'),
  );
  const runsOf = (id) => {
    const d = join(homeOf(id), 'runs');
    return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(d, f), 'utf8'))) : [];
  };
  const suite = (extra = {}) =>
    spawnSync(process.execPath, ['--test', `--test-reporter=${REPORTER}`, '--test-reporter-destination=stdout'], {
      cwd: shop,
      encoding: 'utf8',
      env: { ...env, ...extra },
    });
  return { root, home, shop, env, wd, specOf, homeOf, runsOf, suite };
}

test('a recorded run files each result in the blueprint that holds its rule, under one run id @rule:locations.several.results-filed-by-rule', () => {
  const p = project();
  const out = p.suite();
  assert.equal(out.status, 0, out.stderr);
  const [ra, rb] = [p.runsOf('a'), p.runsOf('b')];
  assert.equal(ra.length, 1, out.stdout);
  assert.equal(rb.length, 1);
  assert.deepEqual(ra[0].results.map((r) => r.rule), ['a.s.works']);
  assert.deepEqual(rb[0].results.map((r) => r.rule), ['b.s.works']);
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
  assert.match(one.stdout, /set aside 1 result\(s\) for another blueprint in this project — b\.s\.works/);
});

test('the Playwright reporter files by rule too @rule:locations.several.results-filed-by-rule', async () => {
  const p = project();
  const script = `
    import Reporter from ${JSON.stringify(join(REPO, 'lib', 'playwright-reporter.js'))};
    const t = (id) => ({ tags: [${JSON.stringify('@rule')} + ':' + id], title: id, outcome: () => 'expected', results: [{ duration: 1, attachments: [] }], location: { file: 'checks/x.spec.js', line: 1 } });
    const r = new Reporter({});
    r.onBegin({}, { allTests: () => ['a.s.works', 'b.s.works', 'nobody.holds.this'].map(t) });
    r.onEnd();`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: p.shop, encoding: 'utf8', env: p.env });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(p.runsOf('a')[0].results.map((r) => r.rule), ['a.s.works']);
  assert.deepEqual(p.runsOf('b')[0].results.map((r) => r.rule), ['b.s.works']);
  assert.equal(p.runsOf('a')[0].run_id, p.runsOf('b')[0].run_id);
  assert.match(out.stdout, /no blueprint in this project holds nobody\.holds\.this/);
});

const hasRspec = spawnSync('rspec', ['--version'], { encoding: 'utf8' }).status === 0;
test('the RSpec formatter files by rule too @rule:locations.several.results-filed-by-rule', { skip: !hasRspec && 'rspec is not installed' }, () => {
  const p = project();
  mkdirSync(join(p.shop, 'spec'), { recursive: true });
  writeFileSync(
    join(p.shop, 'spec', 'shop_spec.rb'),
    `RSpec.describe 'shop' do\n${['a.s.works', 'b.s.works', 'nobody.holds.this'].map((r) => `  it '${r}', rule: '${r}' do\n    expect(1).to eq(1)\n  end\n`).join('')}end\n`,
  );
  const lib = join(REPO, 'adapters', 'rspec', 'lib');
  const out = spawnSync('rspec', ['-I', lib, '-r', 'walkdown/formatter', '--format', 'progress', '--format', 'Walkdown::Formatter', 'spec'], {
    cwd: p.shop,
    encoding: 'utf8',
    env: p.env,
  });
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.deepEqual(p.runsOf('a')[0].results.map((r) => r.rule), ['a.s.works']);
  assert.deepEqual(p.runsOf('b')[0].results.map((r) => r.rule), ['b.s.works']);
  assert.equal(p.runsOf('a')[0].run_id, p.runsOf('b')[0].run_id);
  assert.match(out.stdout, /no blueprint in this project holds nobody\.holds\.this/);
});

test('lint accepts a sibling blueprint\'s rule and thread, and still flags what no blueprint holds @rule:locations.several.lint-reads-the-project', () => {
  const p = project();
  // A rule of a's whose origin is a thread of b's.
  const filed = p.wd(['thread', 'new', '--blueprint', 'b', '--rule', 'b.s.works', '--body', 'something seen', '--json']);
  assert.equal(filed.status, 0, filed.stderr);
  const bThread = JSON.parse(filed.stdout).id;
  const fa = join(p.specOf('a'), 'features', 'a.yml');
  writeFileSync(fa, readFileSync(fa, 'utf8').replace('        verify: [checks]', `        origin: thread:${bThread}\n        verify: [checks]`));
  p.wd(['hash', '--write', '--blueprint', 'a']);

  const out = p.wd(['lint', '--blueprint', 'a', '--json']);
  const findings = JSON.parse(out.stdout).findings;
  const about = (s) => findings.filter((f) => f.subject === s || f.message.includes(s));
  assert.deepEqual(about('b.s.works').filter((f) => f.category === 'coverage'), [], 'b\'s tag is b\'s');
  assert.deepEqual(about(bThread), [], 'b\'s thread is a thread');
  assert.equal(about('nobody.holds.this').filter((f) => f.level === 'error').length, 1, 'a tag nobody holds is still an error');

  writeFileSync(fa, readFileSync(fa, 'utf8').replace(`origin: thread:${bThread}`, 'origin: thread:n-9999'));
  p.wd(['hash', '--write', '--blueprint', 'a']);
  const again = JSON.parse(p.wd(['lint', '--blueprint', 'a', '--json']).stdout).findings;
  assert.ok(again.some((f) => f.message.includes('unknown thread "n-9999"')), 'a thread no blueprint holds still warns');
});

test('a new thread\'s id is unique across the project\'s blueprints @rule:locations.several.thread-ids-unique', () => {
  const p = project();
  const file = (bp, kind = 'note', extra = []) => {
    const r = p.wd(['thread', 'new', '--blueprint', bp, '--rule', `${bp}.s.works`, '--body', 'seen', '--kind', kind, ...extra, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).id;
  };
  const ids = [file('a'), file('a'), file('a'), file('a'), file('a')];
  assert.deepEqual(ids, ['n-0001', 'n-0002', 'n-0003', 'n-0004', 'n-0005']);
  assert.equal(file('b'), 'n-0006', 'b counts past a');
  assert.equal(file('a', 'question', ['--option', 'Yes :: do it', '--option', 'No :: leave it']), 'q-0007');

  // Ids that already collide stay as they are.
  const bThreads = join(p.homeOf('b'), 'threads');
  writeFileSync(join(bThreads, 'n-0001.yml'), readFileSync(join(p.homeOf('a'), 'threads', 'n-0001.yml'), 'utf8'));
  assert.equal(file('b'), 'n-0008');
  assert.ok(existsSync(join(bThreads, 'n-0001.yml')) && existsSync(join(p.homeOf('a'), 'threads', 'n-0001.yml')));
});

test('the pointer names every blueprint, and says writes need --blueprint @rule:locations.pointer.names-every-blueprint', () => {
  const p = project({ commit: 'spec' });
  const claude = join(p.shop, 'CLAUDE.md');
  const block = () => readFileSync(claude, 'utf8');
  // init placed it, and the second init brought it up to date with both.
  assert.match(block(), /- `a` in `\.walkdown\/blueprints\/0001-a\/blueprint\/`/);
  assert.match(block(), /- `b` in `\.walkdown\/blueprints\/0002-b\/blueprint\/`/);
  assert.match(block(), /need `--blueprint <id>`/);

  const again = p.wd(['pointer', '--into', 'CLAUDE.md']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already current/);
  assert.equal(block().split('<!-- walkdown:begin -->').length, 2, 'once');

  // b leaves the repository: the pointer stays, for a, and names b by id -
  // never by a path into one person's home.
  const out = p.wd(['init', '--id', 'b', '--commit', 'none']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(block(), /- `a` in `\.walkdown\/blueprints\/0001-a\/blueprint\/`/);
  assert.match(block(), /- `b`, kept outside this repository - `walkdown where --blueprint b` finds it/);
  assert.equal(block().includes(p.home), false, 'no machine path in a committed file');
  assert.doesNotMatch(out.stdout, /not even a pointer/);
});

test('a project with one blueprint keeps its one-line pointer and files every result as before @rule:locations.pointer.names-every-blueprint @rule:locations.several.results-filed-by-rule', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-solo-')));
  roots.push(root);
  const solo = join(root, 'solo');
  mkdirSync(solo, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: solo });
  const env = { ...process.env, WALKDOWN_HOME: join(root, 'home'), WALKDOWN_SKILLS_DIR: join(root, 'home', 'skills'), NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.WALKDOWN_RECORD_HOME;
  delete env.WALKDOWN_SPEC;
  assert.equal(spawnSync(process.execPath, [CLI, 'init', '--commit', 'spec'], { cwd: solo, env }).status, 0);
  assert.match(readFileSync(join(solo, 'CLAUDE.md'), 'utf8'), /This project's spec is the walkdown blueprint in `\.walkdown\/blueprints\/0001-solo\/blueprint\/`\./);

  writeFileSync(join(solo, 'x.test.js'), `import { test } from 'node:test';\ntest('t ${tag('not.in.this.blueprint')}', () => {});\n`);
  const out = spawnSync(process.execPath, ['--test', `--test-reporter=${REPORTER}`, '--test-reporter-destination=stdout'], { cwd: solo, encoding: 'utf8', env });
  assert.match(out.stdout, /recorded 1 rule result\(s\) →/, 'held or not, filed in the one blueprint, as before');
  assert.doesNotMatch(out.stdout, /for solo|not recorded|set aside/);
});
