import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatHash } from '../lib/hash.js';
import { deriveStatus, screenFlow } from '../lib/status.js';

const STATEMENT = 'The visitor can do the thing.';
// hoisted away from tagged test names: a hex literal near a rule ref reads as
// a recorded statement hash to walkdown's stale-check scanner
const BOGUS_HASH = 'sha256:' + '0'.repeat(12);

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

test('later run wins; per-target isolation @rule:status.derived.latest-wins', () => {
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

test('a pass with an outdated statement_hash renders stale, not passing @rule:status.derived.stale-never-passes', () => {
  const { rows } = deriveStatus(
    blueprint({ runs: [checksRun('2026-01-01', 'local', 'pass', BOGUS_HASH)] })
  );
  assert.equal(rows[0].cells.local.state, 'stale');
  assert.equal(rows[0].verdict, 'pending');
});

test('environments scope targets; agent pass does not satisfy human @rule:status.derived.human-tier-distinct', () => {
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

test('rows carry statement/screens; cells carry run provenance for detail views', () => {
  const run = checksRun('2026-01-01', 'local', 'fail');
  run.results[0].evidence = ['runs/evidence/x.png'];
  run.results[0].message = 'expected error to be visible';
  const { rows } = deriveStatus(blueprint({ runs: [run] }));
  assert.equal(rows[0].statement, STATEMENT);
  assert.deepEqual(rows[0].screens, []);
  assert.equal(rows[0].steps, null); // fixture rule has none
  const cell = rows[0].cells.local;
  assert.equal(cell.runId, '2026-01-01');
  assert.equal(cell.created, '2026-01-01');
  assert.deepEqual(cell.evidence, ['runs/evidence/x.png']);
  assert.equal(cell.detail, 'expected error to be visible');
});

test('screenFlow: step order wins, consecutive repeats collapse, revisits show', () => {
  const screens = new Set(['join', 'confirm']);
  const rule = (steps) => ({ steps });
  assert.deepEqual(
    screenFlow(rule({ given: ['On `join`'], then: ['Now on `confirm` showing `x.y`'] }), screens),
    ['join', 'confirm']
  );
  // "remains on" shape: same screen mentioned in given and then
  assert.deepEqual(
    screenFlow(rule({ given: ['On `join`'], then: ['Still on `join`'] }), screens),
    ['join']
  );
  // a genuine revisit is preserved
  assert.deepEqual(
    screenFlow(rule({ given: ['On `join`'], when: ['Go to `confirm`'], then: ['Back on `join`'] }), screens),
    ['join', 'confirm', 'join']
  );
  assert.deepEqual(screenFlow({ }, screens), []);
});

test('drift: undesigned screens and thread-born rules are derived', () => {
  const bp = blueprint({
    threads: [{ id: 'q-9', kind: 'question', status: 'open', anchor: { screen: 'extra' } }],
  });
  bp.storyboard = { screens: [
    { id: 'home', prototype: '/home.html' },
    { id: 'extra', prototype: null, proposal: '/extra.html' },
  ] };
  bp.features[0].data.stories[0].rules[0].origin = 'thread:q-9';
  const { drift } = deriveStatus(bp);
  assert.deepEqual(drift.design, [{ screen: 'extra', proposal: '/extra.html', requests: ['q-9'] }]);
  assert.deepEqual(drift.sources, [{ rule: 'demo.main.thing', origin: 'thread:q-9' }]);

  bp.features[0].data.stories[0].rules[0].origin = 'prototype';
  assert.deepEqual(deriveStatus(bp).drift.sources, []);
});

test('attention: human vs agent queues derived from rows and threads @rule:status.attention.blocked-queues', () => {
  const bp = blueprint({
    verify: ['agent', 'human'],
    runs: [walkdownRun('2026-01-01', 'agent', 'pass')],
    threads: [
      { id: 'n-1', kind: 'note', status: 'addressed', anchor: { rule: 'demo.main.thing' } },
      { id: 'n-2', kind: 'note', status: 'open', anchor: { rule: 'demo.main.thing' } },
      { id: 'q-1', kind: 'question', status: 'open', anchor: {} },
      { id: 'q-2', kind: 'question', status: 'answered', anchor: {} },
      { id: 'q-3', kind: 'question', status: 'waived', anchor: {} },
    ],
  });
  const { attention } = deriveStatus(bp);
  const byWho = (who) => attention.filter((i) => i.who === who).map((i) => `${i.action}:${i.thread ?? i.rule}`);
  assert.deepEqual(byWho('human'), ['judge:demo.main.thing', 'verify:n-1', 'answer:q-1']);
  assert.deepEqual(byWho('agent'), ['address:n-2', 'incorporate:q-2']);
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
