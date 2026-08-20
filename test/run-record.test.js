import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { formatHash } from '../lib/hash.js';
import { aggregateResults, nextRunId, writeRunRecord } from '../lib/run-record.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-runrec-'));
after(() => rmSync(root, { recursive: true, force: true }));

const STATEMENT = 'The visitor can do the thing.';
const rulesById = new Map([['demo.thing', { id: 'demo.thing', statement: STATEMENT }]]);

test('aggregation: fail beats pass, durations sum, checks and evidence dedupe', () => {
  const results = aggregateResults(
    [
      { ruleId: 'demo.thing', status: 'pass', durationMs: 100, check: 'a.spec.ts:1', evidence: ['x.png'] },
      { ruleId: 'demo.thing', status: 'fail', durationMs: 50, check: 'b.spec.ts:9', evidence: ['x.png', 'y.png'] },
    ],
    rulesById
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'fail');
  assert.equal(results[0].duration_ms, 150);
  assert.deepEqual(results[0].checks, ['a.spec.ts:1', 'b.spec.ts:9']);
  assert.deepEqual(results[0].evidence, ['x.png', 'y.png']);
});

test('pass/fail results are stamped with the current statement_hash; skipped and unknown rules are not', () => {
  const results = aggregateResults(
    [
      { ruleId: 'demo.thing', status: 'pass', durationMs: 1 },
      { ruleId: 'demo.gone', status: 'pass', durationMs: 1 },
      { ruleId: 'demo.skip', status: 'skipped', durationMs: 0 },
    ],
    rulesById
  );
  const byRule = Object.fromEntries(results.map((r) => [r.rule, r]));
  assert.equal(byRule['demo.thing'].statement_hash, formatHash(STATEMENT));
  assert.equal(byRule['demo.gone'].statement_hash, undefined);
  assert.equal(byRule['demo.skip'].statement_hash, undefined);
});

test('nextRunId sequences within the same timestamp and target', () => {
  const date = new Date('2026-08-20T22:00:00Z');
  const runsDir = join(root, 'bp', 'runs');
  assert.equal(nextRunId(runsDir, 'local', date), '2026-08-20T22-00-00Z-local-01');
  writeRunRecord({ blueprintDir: join(root, 'bp'), target: 'local', actor: 't', perTest: [
    { ruleId: 'demo.thing', status: 'pass', durationMs: 1 },
  ], rulesById, date });
  assert.equal(nextRunId(runsDir, 'local', date), '2026-08-20T22-00-00Z-local-02');
  assert.equal(nextRunId(runsDir, 'staging', date), '2026-08-20T22-00-00Z-staging-01');
});

test('writeRunRecord emits a well-formed record', () => {
  const { file, record } = writeRunRecord({
    blueprintDir: join(root, 'bp2'),
    target: 'staging',
    baseUrl: 'https://staging.example.com',
    actor: 'agent',
    perTest: [{ ruleId: 'demo.thing', status: 'pass', durationMs: 42, check: 'a.spec.ts:1' }],
    rulesById,
    date: new Date('2026-08-20T22:05:00Z'),
  });
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk, record);
  assert.equal(record.kind, 'checks');
  assert.equal(record.target, 'staging');
  assert.equal(record.created, '2026-08-20T22:05:00Z');
  assert.equal(record.results[0].statement_hash, formatHash(STATEMENT));
});
