/*
 * The RSpec formatter files its run where walkdown says runs go (#16), with
 * the home outside the repository - the default since `init` stopped writing
 * into the project. Runs real rspec; skipped where there is none.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
const spec = join(homeDir);
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
  writeFileSync(join(spec, 'spec.yml'), 'blueprint: app\n');
  writeFileSync(join(spec, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(
    join(spec, 'features', 'main.yml'),
    `feature: main\nstories:\n  - id: app.main\n    rules:\n      - id: ${RULE}\n        statement: The thing is done.\n        verify: [checks]\n`,
  );
  // Registered the way init registers a home outside the project: the row
  // names the code as its project and the home apart from it.
  writeFileSync(
    join(process.env.WALKDOWN_HOME, 'registry.yml'),
    `blueprints:\n  - id: 0001-fx-app\n    project: fx\n    code: fx\n    checkout: ${code}\n    home: ${homeDir}\n    registered: { by: init, at: '2026-09-24T00:00:00Z' }\n`,
  );
});
after(() => rmSync(root, { recursive: true, force: true }));

test('through walkdown run, the formatter files into the home it was handed (#16) @rule:locations.answer.adapters-file-where-walkdown-says', {
  skip: !hasRspec && 'no rspec here',
}, () => {
  const before_ = recorded().length;
  const res = runChecks(
    {
      config: { runner: { run_all: command } },
      codeRoot: code,
      dir: spec,
      at: { runs: { path: runs } },
    },
    { stdio: 'pipe' },
  );
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /walkdown: recorded 1 rule result/, res.stdout + res.stderr);
  assert.equal(recorded().length, before_ + 1);
  const run = JSON.parse(readFileSync(join(runs, recorded().sort().at(-1)), 'utf8'));
  assert.deepEqual(
    run.results.map((r) => [r.rule, r.status]),
    [[RULE, 'pass']],
  );
  assert.match(run.results[0].statement_hash, /^sha256:/, 'hashed against the spec it was handed');
});

test('run as bare rspec in the code, it asks walkdown where and files into the home (#16) @rule:locations.answer.adapters-file-where-walkdown-says', {
  skip: !hasRspec && 'no rspec here',
}, () => {
  const before_ = recorded().length;
  const res = spawnSync('sh', ['-c', command], { cwd: code, env: env(), encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.doesNotMatch(res.stderr, /no blueprint/, res.stderr);
  assert.equal(recorded().length, before_ + 1, res.stdout + res.stderr);
});

test('a spec committed in the repository is still found by looking up from the code @rule:locations.answer.adapters-file-where-walkdown-says', {
  skip: !hasRspec && 'no rspec here',
}, () => {
  // No registry row answers here, and no clone is asked: the walk is the fallback.
  const repo = join(root, 'inrepo');
  mkdirSync(join(repo, 'spec'), { recursive: true });
  mkdirSync(join(repo, 'features'), { recursive: true });
  writeFileSync(
    join(repo, 'spec', 'thing_spec.rb'),
    readFileSync(join(code, 'spec', 'thing_spec.rb')),
  );
  writeFileSync(join(repo, 'spec.yml'), 'blueprint: inrepo\n');
  const lonely = join(root, 'lonely-home');
  mkdirSync(lonely, { recursive: true });
  const res = spawnSync('sh', ['-c', command], {
    cwd: repo,
    env: env({ WALKDOWN_HOME: lonely }),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(
    readdirSync(join(repo, 'runs')).filter((f) => f.endsWith('.json')).length,
    1,
    res.stdout + res.stderr,
  );
});

test('a run is recorded under the username profile.yml says, and config.yml still answers on a machine not yet upgraded (n-0510) @rule:status.attribution.username-is-the-record', {
  skip: !hasRspec && 'no rspec here',
}, () => {
  const actorOf = (files) => {
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(process.env.WALKDOWN_HOME, name), text);
    try {
      // Not under CI, which records every run as `ci` whatever the profile says.
      const { CI: _, ...local } = env();
      const res = spawnSync('sh', ['-c', command], { cwd: code, env: local, encoding: 'utf8' });
      assert.equal(res.status, 0, res.stdout + res.stderr);
      return JSON.parse(readFileSync(join(runs, recorded().sort().at(-1)), 'utf8')).actor;
    } finally {
      for (const name of Object.keys(files))
        rmSync(join(process.env.WALKDOWN_HOME, name), { force: true });
    }
  };
  assert.equal(actorOf({ 'profile.yml': 'identity:\n  username: pat\n' }), 'pat');
  assert.equal(
    actorOf({ 'config.yml': 'identity:\n  username: lee\n' }),
    'lee',
    'the name before ADR 0014',
  );
  assert.equal(
    actorOf({
      'profile.yml': 'identity:\n  username: pat\n',
      'config.yml': 'identity:\n  username: lee\n',
    }),
    'pat',
    'profile.yml wins',
  );
});

test('rspec and the CLI name the same person, whatever this machine has said or not (n-0513) @rule:status.attribution.username-is-the-record', {
  skip: !hasRspec && 'no rspec here',
}, () => {
  // git's global config through HOME, which both read: the CLI asks git with
  // every GIT_CONFIG_* variable removed, and so does the formatter.
  const home = join(root, 'person');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[github]\n\tuser = ghpat\n');
  const { CI: _, ...local } = env({ HOME: home });
  const both = (files) => {
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(process.env.WALKDOWN_HOME, name), text);
    try {
      const res = spawnSync('sh', ['-c', command], { cwd: code, env: local, encoding: 'utf8' });
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const rspec = JSON.parse(readFileSync(join(runs, recorded().sort().at(-1)), 'utf8')).actor;
      const cli = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { defaultActor } from ${JSON.stringify(join(REPO, 'lib', 'identity.js'))}; console.log(defaultActor(process.cwd()).username)`,
        ],
        { cwd: code, env: local, encoding: 'utf8' },
      ).stdout.trim();
      return { rspec, cli };
    } finally {
      for (const name of Object.keys(files))
        rmSync(join(process.env.WALKDOWN_HOME, name), { force: true });
    }
  };
  assert.deepEqual(
    both({ 'config.yml': 'identity:\n  username: lee\n' }),
    { rspec: 'lee', cli: 'lee' },
    'not yet upgraded',
  );
  assert.deepEqual(
    both({}),
    { rspec: 'ghpat', cli: 'ghpat' },
    'nothing said: git answers for both',
  );
  assert.deepEqual(
    both({ 'profile.yml': 'name: Pat\n' }),
    { rspec: 'ghpat', cli: 'ghpat' },
    'a profile with no username',
  );
});
