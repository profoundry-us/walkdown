import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { formatHash } from '../lib/hash.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-nodereporter-'));
const home = join(root, 'home');
after(() => rmSync(root, { recursive: true, force: true }));

test('node:test reporter records tagged tests as a hash-stamped run', () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.yml'), 'identity:\n  username: A Person\n');
  mkdirSync(join(root, 'blueprint', 'features'), { recursive: true });
  writeFileSync(join(root, 'blueprint', 'walkdown.yml'), 'blueprint: node-fixture\n');
  writeFileSync(
    join(root, 'blueprint', 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.adds',
      '        statement: Adding works.',
      '        verify: [checks]',
    ].join('\n'),
  );
  /*
   * Registered, because the reporter resolves through the registry (ADR
   * 0003) rather than walking up for a `walkdown.yml` (n-0133). The fixture
   * root is the home: `blueprint/` with the records beside it.
   */
  writeFileSync(
    join(home, 'registry.yml'),
    [
      'blueprints:',
      '  - id: node-fixture',
      `    project: ${root}`,
      `    home: ${root}`,
      "    registered: { by: import, at: '2026-01-01T00:00:00Z' }",
      '',
    ].join('\n'),
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
    ].join('\n'),
  );

  const reporter = new URL('../lib/node-test-reporter.js', import.meta.url).pathname;
  const res = spawnSync(
    process.execPath,
    [
      '--test',
      `--test-reporter=${reporter}`,
      '--test-reporter-destination=stdout',
      'demo.test.mjs',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      // strip the parent test-runner's env so the nested node --test runs
      // standalone. WALKDOWN_RECORD_HOME goes too: `npm run test:record` sets
      // it empty for the outer run, and inherited by this nested one it sent
      // the fixture's record to no blueprint at all - so the recorded suite
      // exited 1 on this test while the plain one passed (2026-09-19).
      env: Object.fromEntries(
        Object.entries({
          ...process.env,
          // Who a check run is recorded under is the configured identity —
          // never an environment variable, which is the door an agent used to
          // record under a name of its choosing (n-0139).
          WALKDOWN_HOME: home,
          WALKDOWN_TARGET: 'ci-lane',
        }).filter(([k]) => !/^NODE_(TEST|OPTIONS)|^WALKDOWN_RECORD_HOME$/.test(k)),
      ),
    },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /recorded 1 rule result/);

  const runFile = readdirSync(join(root, 'runs')).find((f) => f.endsWith('.json'));
  const record = JSON.parse(readFileSync(join(root, 'runs', runFile), 'utf8'));
  assert.equal(record.kind, 'checks');
  assert.equal(record.actor, 'A Person');
  assert.equal(record.target, 'ci-lane');
  assert.equal(record.results.length, 1); // the untagged test is ignored
  assert.equal(record.results[0].rule, 'demo.main.adds');
  assert.equal(record.results[0].status, 'pass');
  assert.equal(record.results[0].statement_hash, formatHash('Adding works.'));
  // file:line — the tagged test sits on line 3 of the fixture above
  assert.deepEqual(record.results[0].checks, ['demo.test.mjs:3']);
});
