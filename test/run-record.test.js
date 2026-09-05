import { declaredHome } from '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { formatHash } from '../lib/hash.js';
import { aggregateResults, nextRunId, writeRunRecord, writeSweep } from '../lib/run-record.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-runrec-'));
after(() => rmSync(root, { recursive: true, force: true }));

const STATEMENT = 'The visitor can do the thing.';
const rulesById = new Map([['demo.thing', { id: 'demo.thing', statement: STATEMENT }]]);

test('aggregation: fail beats pass, durations sum, checks and evidence dedupe', () => {
  const results = aggregateResults(
    [
      {
        ruleId: 'demo.thing',
        status: 'pass',
        durationMs: 100,
        check: 'a.spec.ts:1',
        evidence: ['x.png'],
      },
      {
        ruleId: 'demo.thing',
        status: 'fail',
        durationMs: 50,
        check: 'b.spec.ts:9',
        evidence: ['x.png', 'y.png'],
      },
    ],
    rulesById,
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
    rulesById,
  );
  const byRule = Object.fromEntries(results.map((r) => [r.rule, r]));
  assert.equal(byRule['demo.thing'].statement_hash, formatHash(STATEMENT));
  assert.equal(byRule['demo.gone'].statement_hash, undefined);
  assert.equal(byRule['demo.skip'].statement_hash, undefined);
});

test('nextRunId sequences within the same timestamp and target', () => {
  const date = new Date('2026-08-20T22:00:00Z');
  const h = declaredHome(join(root, 'bp'), 'runrec');
  const runsDir = h.runs;
  assert.equal(nextRunId(runsDir, 'local', date), '2026-08-20T22-00-00Z-local-01');
  writeRunRecord({
    blueprintDir: h.spec,
    runsDir: h.runs,
    target: 'local',
    actor: 't',
    perTest: [{ ruleId: 'demo.thing', status: 'pass', durationMs: 1 }],
    rulesById,
    date,
  });
  assert.equal(nextRunId(runsDir, 'local', date), '2026-08-20T22-00-00Z-local-02');
  assert.equal(nextRunId(runsDir, 'staging', date), '2026-08-20T22-00-00Z-staging-01');
});

test('writeRunRecord emits a well-formed record', () => {
  const h = declaredHome(join(root, 'bp2'), 'runrec-2');
  const { file, record } = writeRunRecord({
    blueprintDir: h.spec,
    runsDir: h.runs,
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

/*
 * What a verdict is ABOUT is the code. These fields used to be asked of the
 * blueprint directory, which was the same place only while a spec lived at
 * <project>/blueprint - on the default layout the home is in ~/.walkdown and
 * carries no repository, so records came out with no provenance at all
 * (n-0190). And a home that IS versioned, which is what keeping your dotfiles
 * in git gives you, stamped its own sha onto verdicts about code sitting at
 * another commit somewhere else (n-0192). That is the case worth a test: the
 * wrong answer here is a plausible-looking sha, not a missing one.
 */
test('a run is stamped with the code repository, not the home the blueprint sits in', () => {
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], {
      cwd,
      encoding: 'utf8',
    }).trim();

  const code = join(root, 'code-repo');
  mkdirSync(code, { recursive: true });
  git(code, 'init', '-q');
  writeFileSync(join(code, 'app.js'), 'export const x = 1;\n');
  git(code, 'add', '-A');
  git(code, 'commit', '-qm', 'the code this verdict is about');
  const codeSha = git(code, 'rev-parse', '--short', 'HEAD');

  // The home lives elsewhere and is versioned in its own right.
  const h = declaredHome(join(root, 'bp-provenance'), 'runrec-3');
  git(h.root, 'init', '-q');
  git(h.root, 'add', '-A');
  git(h.root, 'commit', '-qm', 'the home, which no verdict is about');
  const homeSha = git(h.root, 'rev-parse', '--short', 'HEAD');
  assert.notEqual(codeSha, homeSha, 'the two trees must be distinguishable for this to mean anything');

  const { record } = writeRunRecord({
    blueprintDir: h.spec,
    runsDir: h.runs,
    codeRoot: code,
    target: 'local',
    actor: 'agent',
    kind: 'walkdown',
    results: [{ rule: 'demo.thing', status: 'pass' }],
    date: new Date('2026-09-05T03:00:00Z'),
  });
  assert.equal(record.git_sha, codeSha, 'the sha names the code, so a person can go and look at it');
  assert.notEqual(record.git_sha, homeSha);

  const swept = writeSweep({
    blueprintDir: h.spec,
    runsDir: h.runs,
    codeRoot: code,
    target: 'local',
    tiers: ['agent'],
    why: 'the code moved under every verdict',
    actor: 'agent',
    date: new Date('2026-09-05T03:01:00Z'),
  });
  assert.equal(swept.record.git_sha, codeSha, 'a sweep is stamped the same way');
});

/*
 * The sweep writer. Its two refusals are the rule (status.sweep.deliberate):
 * a sweep without a reason, and a sweep naming no tier, are both mistakes
 * worth catching before they reach the ledger.
 */
test('a sweep refuses to be written without a reason @rule:status.sweep.deliberate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wd-sweep-'));
  assert.throws(
    () => writeSweep({ blueprintDir: dir, target: 'local', tiers: ['agent'], why: '  ' }),
    /needs a reason/,
  );
  assert.throws(
    () => writeSweep({ blueprintDir: dir, target: 'local', tiers: [], why: 'because' }),
    /at least one tier/,
  );
});

test('a written sweep carries its reason and no results @rule:status.sweep.deliberate', () => {
  const h = declaredHome(mkdtempSync(join(tmpdir(), 'wd-sweep-')), 'sweep');
  const { record } = writeSweep({
    blueprintDir: h.spec,
    runsDir: h.runs,
    target: 'local',
    tiers: ['checks', 'agent'],
    why: 'the panel was split into sixteen modules',
    actor: 'topher',
  });
  assert.equal(record.kind, 'sweep');
  assert.deepEqual(record.tiers, ['checks', 'agent']);
  assert.equal(record.why, 'the panel was split into sixteen modules');
  // It is not evidence about any rule - it is a statement about when we
  // stopped trusting the evidence we had.
  assert.deepEqual(record.results, []);
});
