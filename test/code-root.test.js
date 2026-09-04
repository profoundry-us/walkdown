/*
 * The shape walkdown's own repository cannot be: a spec that lives OUTSIDE
 * the code it describes.
 *
 * This project keeps its blueprint in the tree, so `projectRoot` and the code
 * root are the same directory here and every bug in issue #7 is invisible to
 * the rest of the suite. It was found in a work project configured the way
 * `walkdown init` now configures things by default - spec out, code in a
 * repository somewhere else - where `walkdown run` shelled out into the
 * walkdown home and found no `bin/`, no `packs/`, and no test suite.
 *
 * Every test here builds that arrangement on purpose.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { scanCheckFiles } from '../lib/checks.js';
import { lint } from '../lib/lint.js';
import { runChecks } from '../lib/run-cmd.js';

const prevHome = process.env.WALKDOWN_HOME;
const roots = [];
after(() => {
  if (prevHome === undefined) delete process.env.WALKDOWN_HOME;
  else process.env.WALKDOWN_HOME = prevHome;
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/*
 * A repository with a suite in it, and a spec kept somewhere else entirely,
 * joined only by a config entry — which is the one thing that can say where
 * the code is once the spec has stopped sitting next to it.
 */
function apart({ runner = {}, withEntry = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wd-coderoot-'));
  roots.push(root);
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;

  const code = join(root, 'the-repo');
  mkdirSync(join(code, 'spec', 'workflows'), { recursive: true });
  mkdirSync(join(code, '.git'), { recursive: true });
  // A suite that exists ONLY in the code tree. Anything resolving from the
  // spec's side of the world will not find it.
  writeFileSync(
    join(code, 'spec', 'workflows', 'a_spec.rb'),
    ["it 'does the thing', " + "rule: 'd.s.thing' do", '  expect(1).to eq(1)', 'end', ''].join('\n'),
  );

  const spec = join(home, 'blueprints', '0001-apart', 'blueprint');
  mkdirSync(join(spec, 'features'), { recursive: true });
  writeFileSync(
    join(spec, 'walkdown.yml'),
    ['project: apart', 'authoring:', '  location: [spec/workflows/]', 'runner:', ...runner.lines]
      .join('\n')
      .concat('\n'),
  );
  writeFileSync(
    join(spec, 'features', 'd.yml'),
    'feature: d\nstories:\n  - id: d.s\n    rules:\n      - id: d.s.thing\n        statement: The thing.\n        verify: [checks]\n',
  );
  if (withEntry)
    writeFileSync(
      join(home, 'config.yml'),
      // A real home: `home:` is what every record path derives from, and an
      // entry naming a spec but no home is a hand edit lint now refuses.
      `projects:\n  - id: apart\n    roots: [${code}]\n    home: 0001-apart\n    spec: ${spec}\n`,
    );
  return { root, home, code, spec };
}

test('the code root is the repository, not the home the spec sits in @rule:locations.answer.says-why', () => {
  const { code, spec } = apart({ runner: { lines: [] } });
  const bp = loadBlueprint(spec);
  assert.equal(bp.codeRoot, code, 'where the code is');
  assert.notEqual(bp.codeRoot, bp.projectRoot, 'and it is NOT the blueprint parent here');
  assert.ok(bp.projectRoot.includes('0001-apart'), 'which is inside the walkdown home');
});

test('runner commands execute in the code, where the suite actually is', () => {
  const { code, spec } = apart({
    // Writes a file next to itself, so where it ran is a fact on disk rather
    // than a claim in stdout.
    runner: { lines: ['  run_all: "pwd > where-it-ran.txt"'] },
  });
  const bp = loadBlueprint(spec);
  const res = runChecks(bp, { stdio: 'pipe' });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(
    existsSync(join(code, 'where-it-ran.txt')),
    'the command ran in the repository, not in the walkdown home',
  );
  // realpath on both sides: `pwd` resolves macOS's /private symlink on tmp,
  // which would otherwise read as a different directory than the one asked for.
  assert.equal(readFileSync(join(code, 'where-it-ran.txt'), 'utf8').trim(), realpathSync(code));
});

test('{results} is absolute under the code root, and nameable in the blueprint', () => {
  const { code, spec } = apart({
    runner: { lines: ['  run_all: "echo {results} > seen.txt"'] },
  });
  const seen = () => readFileSync(join(code, 'seen.txt'), 'utf8').trim();

  runChecks(loadBlueprint(spec), { stdio: 'pipe' });
  assert.equal(seen(), join(code, '.walkdown', 'results.out'), 'defaulted, absolute');

  // And a project whose framework insists on somewhere else says so.
  const named = apart({
    runner: {
      lines: ['  run_all: "echo {results} > seen.txt"', '  results_file: tmp/junit.xml'],
    },
  });
  runChecks(loadBlueprint(named.spec), { stdio: 'pipe' });
  assert.equal(
    readFileSync(join(named.code, 'seen.txt'), 'utf8').trim(),
    join(named.code, 'tmp', 'junit.xml'),
  );
});

test('authoring.location resolves into the code, so coverage sees the suite', () => {
  const { code, spec } = apart({ runner: { lines: [] } });
  const bp = loadBlueprint(spec);

  const hits = scanCheckFiles(bp.config, bp.codeRoot);
  assert.equal(hits.length, 1, 'the check in the code tree was found');
  assert.equal(hits[0].ruleId, 'd.s.thing');
  assert.ok(hits[0].file.startsWith(code + '/'));

  // Resolved the old way it finds nothing at all, which is what made a
  // fully-covered project report every rule as uncovered.
  assert.equal(scanCheckFiles(bp.config, bp.projectRoot).length, 0);

  // And the rule reads as covered rather than as a coverage warning.
  const { findings } = lint(bp);
  assert.equal(
    findings.filter((f) => f.category === 'coverage' && f.subject === 'd.s.thing').length,
    0,
    'no "no check references this rule" for a rule whose check exists',
  );
});

/*
 * With no entry there is nothing that can say where the code is, and the only
 * honest fallback is the spec's own parent. What must NOT happen is walkdown
 * guessing from the working directory - that would run one project's suite
 * inside whatever checkout the caller happened to be standing in.
 */
test('a blueprint no entry declares is refused, never resolved from the caller', () => {
  /*
   * This used to assert a FALLBACK: with no entry, the code root became the
   * spec's own parent. That fallback was the by-path door - a blueprint
   * walkdown answered for without anybody having written it down - and it is
   * gone. What matters is what replaced it: a refusal that says so, rather
   * than a silent answer derived from wherever this process happens to be.
   */
  const { spec } = apart({ runner: { lines: [] }, withEntry: false });
  assert.throws(
    () => loadBlueprint(spec),
    (err) => {
      assert.match(err.message, /nothing declares/);
      assert.ok(!err.message.includes('walkdown/lib'), 'and never this process’s repository');
      return true;
    },
  );
});
