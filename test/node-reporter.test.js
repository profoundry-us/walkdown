import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { formatHash } from '../lib/hash.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-nodereporter-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('node:test reporter records tagged tests as a hash-stamped run', () => {
  mkdirSync(join(root, 'blueprint', 'features'), { recursive: true });
  writeFileSync(join(root, 'blueprint', 'walkdown.yml'), 'project: node-fixture\n');
  writeFileSync(
    join(root, 'blueprint', 'features', 'demo.yml'),
    ['feature: demo', 'stories:', '  - id: demo.main', '    rules:',
      '      - id: demo.main.adds', '        statement: Adding works.', '        verify: [checks]'].join('\n')
  );
  // The tag is assembled so this file's source never contains a literal
  // rule ref — walkdown's own coverage lint greps test/ for them.
  const tag = '@rule' + ':demo.main.adds';
  writeFileSync(
    join(root, 'demo.test.mjs'),
    [
      "import assert from 'node:assert/strict';",
      "import { test } from 'node:test';",
      `test('adds ${tag}', () => assert.equal(1 + 1, 2));`,
      "test('untagged', () => assert.ok(true));",
    ].join('\n')
  );

  const reporter = new URL('../lib/node-test-reporter.js', import.meta.url).pathname;
  const res = spawnSync(
    process.execPath,
    ['--test', `--test-reporter=${reporter}`, '--test-reporter-destination=stdout', 'demo.test.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
      // strip the parent test-runner's env so the nested node --test runs standalone
      env: Object.fromEntries(
        Object.entries({ ...process.env, WALKDOWN_ACTOR: 'agent', WALKDOWN_TARGET: 'ci-lane' })
          .filter(([k]) => !/^NODE_(TEST|OPTIONS)/.test(k))
      ),
    }
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /recorded 1 rule result/);

  const runFile = readdirSync(join(root, 'blueprint', 'runs')).find((f) => f.endsWith('.json'));
  const record = JSON.parse(readFileSync(join(root, 'blueprint', 'runs', runFile), 'utf8'));
  assert.equal(record.kind, 'checks');
  assert.equal(record.actor, 'agent');
  assert.equal(record.target, 'ci-lane');
  assert.equal(record.results.length, 1); // the untagged test is ignored
  assert.equal(record.results[0].rule, 'demo.main.adds');
  assert.equal(record.results[0].status, 'pass');
  assert.equal(record.results[0].statement_hash, formatHash('Adding works.'));
  assert.deepEqual(record.results[0].checks, ['demo.test.mjs']);
});
