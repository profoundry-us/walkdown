import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatHash } from '../lib/hash.js';
import { deriveStatus } from '../lib/status.js';

const STATEMENT = 'The visitor can do the thing.';

function blueprint({ runs = [], threads = [], verify = ['checks'], environments } = {}) {
  return {
    config: { runner: { targets: { local: {}, staging: {} } } },
    features: [
      {
        file: 'features/demo.yml',
        data: {
          feature: 'demo',
          stories: [
            {
              id: 'demo.main',
              rules: [{ id: 'demo.main.thing', statement: STATEMENT, verify, ...(environments && { environments }) }],
            },
          ],
        },
      },
    ],
    threads: threads.map((data, i) => ({ file: `threads/t-${i}.yml`, data })),
    runs: runs.map((data, i) => ({ file: `runs/r-${i}.json`, data })),
  };
}

const checksRun = (created, target, status, hash = formatHash(STATEMENT)) => ({
  created, kind: 'checks', target, actor: 'agent', run_id: created,
  results: [{ rule: 'demo.main.thing', status, statement_hash: hash }],
});
const walkdownRun = (created, actor, status) => ({
  created, kind: 'walkdown', target: 'local', actor, run_id: created,
  results: [{ rule: 'demo.main.thing', status, statement_hash: formatHash(STATEMENT) }],
});

test('no runs: required cells are never, verdict pending', () => {
  const { rows, targets } = deriveStatus(blueprint());
  assert.deepEqual(targets, ['local', 'staging']);
  assert.equal(rows[0].cells.local.state, 'never');
  assert.equal(rows[0].agent.state, 'na');
  assert.equal(rows[0].verdict, 'pending');
});

test('later run wins; per-target isolation', () => {
  const { rows } = deriveStatus(
    blueprint({ runs: [checksRun('2026-01-01', 'local', 'fail'), checksRun('2026-01-02', 'local', 'pass')] })
  );
  assert.equal(rows[0].cells.local.state, 'pass');
  assert.equal(rows[0].cells.staging.state, 'never');
  assert.equal(rows[0].verdict, 'pending'); // staging never ran
});

test('any fail makes the verdict fail', () => {
  const { rows } = deriveStatus(
    blueprint({ runs: [checksRun('2026-01-01', 'local', 'pass'), checksRun('2026-01-01', 'staging', 'fail')] })
  );
  assert.equal(rows[0].verdict, 'fail');
});

test('a pass with an outdated statement_hash renders stale, not passing', () => {
  const { rows } = deriveStatus(
    blueprint({ runs: [checksRun('2026-01-01', 'local', 'pass', 'sha256:000000000000')] })
  );
  assert.equal(rows[0].cells.local.state, 'stale');
  assert.equal(rows[0].verdict, 'pending');
});

test('environments scope targets; agent pass does not satisfy human', () => {
  const { rows } = deriveStatus(
    blueprint({
      verify: ['agent', 'human'],
      environments: ['local'],
      runs: [walkdownRun('2026-01-01', 'agent', 'pass')],
    })
  );
  assert.equal(rows[0].cells.local.state, 'na'); // checks not required
  assert.equal(rows[0].agent.state, 'pass');
  assert.equal(rows[0].human.state, 'never');
  assert.equal(rows[0].verdict, 'pending');
  const done = deriveStatus(
    blueprint({
      verify: ['agent', 'human'],
      runs: [walkdownRun('2026-01-01', 'agent', 'pass'), walkdownRun('2026-01-02', 'topher', 'pass')],
    })
  );
  assert.equal(done.rows[0].human.actor, 'topher');
  assert.equal(done.rows[0].verdict, 'pass');
});

test('open threads listed; terminal ones excluded', () => {
  const { rows } = deriveStatus(
    blueprint({
      threads: [
        { id: 'n-1', kind: 'note', status: 'addressed', anchor: { rule: 'demo.main.thing' } },
        { id: 'q-1', kind: 'question', status: 'incorporated', anchor: { rule: 'demo.main.thing' } },
      ],
    })
  );
  assert.deepEqual(rows[0].threads, [{ id: 'n-1', status: 'addressed' }]);
});
