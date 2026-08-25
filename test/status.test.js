/*
 * Derivation tests over lib/status.js. These legitimately carry status.* and
 * threads.* rule tags - the ledger's own laws are exactly what they exercise.
 *
 * What they must NOT carry is a panel.* tag. The verdict pair a rule offers is
 * derived here, but "which pair the panel shows" is a claim about the panel,
 * and deriving the right answer is not the same as drawing it. Those tags were
 * removed on 2026-08-25 (thread q-0070): a check must exercise the same surface
 * the rule describes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatHash } from '../lib/hash.js';
import { deriveStatus, screenFlow } from '../lib/status.js';

const STATEMENT = 'The visitor can do the thing.';
// hoisted away from tagged test names: a hex literal near a rule ref reads as
// a recorded statement hash to walkdown's stale-check scanner
const BOGUS_HASH = 'sha256:' + '0'.repeat(12);

function blueprint({ runs = [], threads = [], verify = ['checks'], environments, targets } = {}) {
  return {
    config: { runner: { targets: targets ?? { local: {}, staging: {} } } },
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

test('sign-off is not build evidence: approved stays unbuilt and pending, and discharges the queue until built', () => {
  const owed = (attention) =>
    attention.some((a) => a.who === 'human' && a.action === 'judge' && a.rule === 'demo.main.thing');
  const unbuilt = deriveStatus(blueprint({
    verify: ['human'],
    runs: [walkdownRun('2026-01-02T00:00:00Z', 'topher', 'approved')],
  }));
  assert.equal(unbuilt.rows[0].built, false);
  assert.equal(unbuilt.rows[0].human.state, 'approved');
  assert.equal(unbuilt.rows[0].signoff, 'approved');
  assert.equal(unbuilt.rows[0].verdict, 'pending');
  // The sign-off is given: nothing is owed until the build lands.
  assert.equal(owed(unbuilt.attention), false);
  // Unsigned and unbuilt: the sign-off itself is owed.
  const unsigned = deriveStatus(blueprint({ verify: ['human'] }));
  assert.equal(owed(unsigned.attention), true);
  // Built with only a stale-free approval on file: a real walkdown is owed.
  const built = deriveStatus(blueprint({
    verify: ['checks', 'human'],
    runs: [
      walkdownRun('2026-01-02T00:00:00Z', 'topher', 'approved'),
      checksRun('2026-01-03T00:00:00Z', 'local', 'pass'),
    ],
  }));
  assert.equal(built.rows[0].built, true);
  assert.equal(owed(built.attention), true);
});

test('a build verdict flips built; an approval goes stale when the statement moves', () => {
  const built = deriveStatus(blueprint({ runs: [checksRun('2026-01-02T00:00:00Z', 'local', 'fail')] }));
  assert.equal(built.rows[0].built, true);
  const stale = deriveStatus(blueprint({
    verify: ['human'],
    runs: [{ created: '2026-01-02T00:00:00Z', kind: 'walkdown', target: 'local', actor: 'topher',
      run_id: 'r-stale', results: [{ rule: 'demo.main.thing', status: 'approved', statement_hash: BOGUS_HASH }] }],
  }));
  assert.equal(stale.rows[0].human.state, 'stale');
});


/*
 * A verdict is about a place. These fix the rule that a pass earned against one
 * address is not evidence about a different one - the case that matters is a
 * review app being replaced, where inheriting the old verdicts would quietly
 * report a system nobody has looked at as verified.
 */
const at = (run, baseUrl) => ({ ...run, base_url: baseUrl });

test('a verdict counts only at the address it was made against @rule:status.derived.verdict-belongs-to-a-place', () => {
  const runs = [
    at(walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass'), 'https://pr-1.review.app'),
    at(checksRun('2026-01-01T00:00:00Z', 'local', 'pass'), 'https://pr-1.review.app'),
  ];
  const here = { local: { base_url: 'https://pr-1.review.app' } };
  const moved = { local: { base_url: 'https://pr-2.review.app' } };

  const before = deriveStatus(blueprint({ runs, verify: ['checks', 'agent'], targets: here })).rows[0];
  assert.equal(before.cells.local.state, 'pass');
  assert.equal(before.agent.state, 'pass');

  // Same ledger, same files - only the address the target points at moved.
  const after = deriveStatus(blueprint({ runs, verify: ['checks', 'agent'], targets: moved })).rows[0];
  assert.equal(after.cells.local.state, 'never', 'checks earned elsewhere must not fill this target');
  assert.equal(after.agent.state, 'never', 'a walkdown of another system is not a walkdown of this one');

  // Nothing was consumed: aiming back restores it, because the ledger is history.
  const back = deriveStatus(blueprint({ runs, verify: ['checks', 'agent'], targets: here })).rows[0];
  assert.equal(back.agent.state, 'pass');
});

test('a run with no recorded address is taken at face value @rule:status.derived.addressless-runs-count', () => {
  const runs = [walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass')]; // no base_url, as a unit-test runner writes
  const row = deriveStatus(
    blueprint({ runs, verify: ['agent'], targets: { local: { base_url: 'https://pr-2.review.app' } } })
  ).rows[0];
  assert.equal(row.agent.state, 'pass');
});

test('a walkdown on one target does not answer for another @rule:status.derived.latest-wins', () => {
  const runs = [
    { ...walkdownRun('2026-01-02T00:00:00Z', 'agent', 'pass'), target: 'staging' },
  ];
  // The verdict was made on staging; local has never been judged.
  const local = deriveStatus(blueprint({ runs, verify: ['agent'] }), { target: 'local' }).rows[0];
  const staging = deriveStatus(blueprint({ runs, verify: ['agent'] }), { target: 'staging' }).rows[0];
  assert.equal(local.agent.state, 'never');
  assert.equal(staging.agent.state, 'pass');
});
