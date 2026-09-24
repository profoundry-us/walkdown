/*
 * The RSpec formatter files its run where walkdown says runs go (#16), with
 * the home outside the repository - the default since `init` stopped writing
 * into the project. Runs real rspec; skipped where there is none.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { runChecks } from '../lib/run-cmd.js';

// Absolute, because the suite runs rspec in another directory and the hook
// pins the home as a path relative to this repository.
process.env.WALKDOWN_HOME = resolve(process.env.WALKDOWN_HOME);
const REPO = join(import.meta.dirname, '..');
const LIB = join(REPO, 'adapters', 'rspec', 'lib');
const RULE = 'app.main.thing';
const hasRspec = spawnSync('rspec', ['--version'], { encoding: 'utf8' }).status === 0;

const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-rspec-')));
const code = join(root, 'app');
const homeDir = join(process.env.WALKDOWN_HOME, 'blueprints', '0001-app');
const spec = join(homeDir, 'blueprint');
const runs = join(homeDir, 'runs');
const command = `rspec -I ${LIB} -r walkdown/formatter --format progress --format Walkdown::Formatter spec`;
// The child must hear nothing this process was told: only what each case hands it.
const env = (extra = {}) => {
  const out = { ...process.env, ...extra };
  if (!('WALKDOWN_SPEC' in extra)) delete out.WALKDOWN_SPEC;
  if (!('WALKDOWN_RUNS' in extra)) delete out.WALKDOWN_RUNS;
  return out;
};
const recorded = () => readdirSync(runs).filter((f) => f.endsWith('.json'));

before(() => {
  mkdirSync(join(code, 'spec'), { recursive: true });
  writeFileSync(
    join(code, 'spec', 'thing_spec.rb'),
    `RSpec.describe 'thing' do\n  it 'does the thing', rule: '${RULE}' do\n    expect(1).to eq(1)\n  end\nend\n`,
  );
  mkdirSync(join(spec, 'features'), { recursive: true });
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(spec, 'walkdown.yml'), 'blueprint: app\n');
  writeFileSync(join(spec, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(
    join(spec, 'features', 'main.yml'),
    `feature: main\nstories:\n  - id: app.main\n    rules:\n      - id: ${RULE}\n        statement: The thing is done.\n        verify: [checks]\n`,
  );
  // Registered the way init registers a home outside the project: the row
  // names the code as its project and the home apart from it.
  writeFileSync(
    join(process.env.WALKDOWN_HOME, 'registry.yml'),
    `blueprints:\n  - id: app\n    project: ${code}\n    home: ${homeDir}\n    registered: { by: init, at: '2026-09-24T00:00:00Z' }\n`,
  );
});
after(() => rmSync(root, { recursive: true, force: true }));

test('through walkdown run, the formatter files into the home it was handed (#16) @rule:locations.answer.adapters-file-where-walkdown-says', { skip: !hasRspec && 'no rspec here' }, () => {
  const before_ = recorded().length;
  const res = runChecks(
    { config: { runner: { run_all: command } }, codeRoot: code, dir: spec, at: { runs: { path: runs } } },
    { stdio: 'pipe' },
  );
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /walkdown: recorded 1 rule result/, res.stdout + res.stderr);
  assert.equal(recorded().length, before_ + 1);
  const run = JSON.parse(readFileSync(join(runs, recorded().sort().at(-1)), 'utf8'));
  assert.deepEqual(run.results.map((r) => [r.rule, r.status]), [[RULE, 'pass']]);
  assert.match(run.results[0].statement_hash, /^sha256:/, 'hashed against the spec it was handed');
});

test('run as bare rspec in the code, it asks walkdown where and files into the home (#16) @rule:locations.answer.adapters-file-where-walkdown-says', { skip: !hasRspec && 'no rspec here' }, () => {
  const before_ = recorded().length;
  const res = spawnSync('sh', ['-c', command], { cwd: code, env: env(), encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.doesNotMatch(res.stderr, /no blueprint/, res.stderr);
  assert.equal(recorded().length, before_ + 1, res.stdout + res.stderr);
});

test('a spec committed in the repository is still found by looking up from the code @rule:locations.answer.adapters-file-where-walkdown-says', { skip: !hasRspec && 'no rspec here' }, () => {
  // No registry row answers here, and no clone is asked: the walk is the fallback.
  const repo = join(root, 'inrepo');
  mkdirSync(join(repo, 'spec'), { recursive: true });
  mkdirSync(join(repo, 'blueprint', 'features'), { recursive: true });
  writeFileSync(join(repo, 'spec', 'thing_spec.rb'), readFileSync(join(code, 'spec', 'thing_spec.rb')));
  writeFileSync(join(repo, 'blueprint', 'walkdown.yml'), 'blueprint: inrepo\n');
  const lonely = join(root, 'lonely-home');
  mkdirSync(lonely, { recursive: true });
  const res = spawnSync('sh', ['-c', command], { cwd: repo, env: env({ WALKDOWN_HOME: lonely }), encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(readdirSync(join(repo, 'runs')).filter((f) => f.endsWith('.json')).length, 1, res.stdout + res.stderr);
});
