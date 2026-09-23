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
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatHash } from '../lib/hash.js';
import { deriveStatus, screenFlow } from '../lib/status.js';

const STATEMENT = 'The visitor can do the thing.';
// hoisted away from tagged test names: a hex literal near a rule ref reads as
// a recorded statement hash to walkdown's stale-check scanner
const BOGUS_HASH = 'sha256:' + '0'.repeat(12);

function blueprint({ runs = [], threads = [], verify = ['checks'], environments, targets, steps, unverifiable, retired } = {}) {
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
              rules: [
                {
                  id: 'demo.main.thing',
                  statement: STATEMENT,
                  verify,
                  ...(steps && { steps }),
                  ...(environments && { environments }),
                  ...(unverifiable && { unverifiable }),
                  ...(retired && { retired }),
                },
              ],
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
  created,
  kind: 'checks',
  target,
  actor: 'agent',
  run_id: created,
  results: [{ rule: 'demo.main.thing', status, statement_hash: hash }],
});
const walkdownRun = (created, actor, status) => ({
  created,
  kind: 'walkdown',
  target: 'local',
  actor,
  run_id: created,
  results: [{ rule: 'demo.main.thing', status, statement_hash: formatHash(STATEMENT) }],
});

test('no runs: required cells are never, verdict pending', () => {
  const { rows, targets } = deriveStatus(blueprint());
  assert.deepEqual(targets, ['local', 'staging']);
  assert.equal(rows[0].cells.local.state, 'never');
  // The agent tier is assumed rather than asked for, so a rule that named only
  // `checks` still owes an agent walkdown - which is the point of inverting it.
  assert.equal(rows[0].agent.state, 'never');
  assert.equal(rows[0].verdict, 'pending');
  // And engineering signs everything, so an unsigned rule is short a signature
  // even before any evidence lands.
  assert.deepEqual(
    rows[0].acceptance.map((a) => [a.role, a.state]),
    [['eng', 'none']],
  );
});

test('later run wins; per-target isolation @rule:status.derived.latest-wins', () => {
  const { rows } = deriveStatus(
    blueprint({
      runs: [checksRun('2026-01-01', 'local', 'fail'), checksRun('2026-01-02', 'local', 'pass')],
    }),
  );
  assert.equal(rows[0].cells.local.state, 'pass');
  assert.equal(rows[0].cells.staging.state, 'never');
  assert.equal(rows[0].verdict, 'pending'); // staging never ran
});

test('any fail makes the verdict fail', () => {
  const { rows } = deriveStatus(
    blueprint({
      runs: [checksRun('2026-01-01', 'local', 'pass'), checksRun('2026-01-01', 'staging', 'fail')],
    }),
  );
  assert.equal(rows[0].verdict, 'fail');
});

test('a pass with an outdated statement_hash renders stale, not passing @rule:status.derived.stale-never-passes', () => {
  const { rows } = deriveStatus(
    blueprint({ runs: [checksRun('2026-01-01', 'local', 'pass', BOGUS_HASH)] }),
  );
  assert.equal(rows[0].cells.local.state, 'stale');
  assert.equal(rows[0].verdict, 'pending');
});

/*
 * A person said the words changed and the rule did not (`walkdown hash
 * --write --reword`): the hash the verdict carries sits in steps.reworded,
 * and the verdict is current. Any other old hash is still stale.
 */
test('a pass against a hash the rule lists as reworded is current, not stale @rule:status.derived.stale-never-passes', () => {
  const OLD = 'sha256:' + 'a'.repeat(12);
  const steps = { given: ['x'], when: ['y'], then: ['z'], reworded: [{ hash: OLD, at: '2026-09-13', why: 'plainer' }] };
  const kept = deriveStatus(blueprint({ steps, runs: [checksRun('2026-01-01', 'local', 'pass', OLD)] }));
  assert.equal(kept.rows[0].cells.local.state, 'pass');
  const other = deriveStatus(blueprint({ steps, runs: [checksRun('2026-01-01', 'local', 'pass', BOGUS_HASH)] }));
  assert.equal(other.rows[0].cells.local.state, 'stale');
});

test('environments scope targets; agent pass does not satisfy human @rule:status.derived.human-tier-distinct', () => {
  const { rows } = deriveStatus(
    blueprint({
      verify: ['agent', 'human'],
      environments: ['local'],
      runs: [walkdownRun('2026-01-01', 'agent', 'pass')],
    }),
  );
  assert.equal(rows[0].cells.local.state, 'na'); // checks not required
  assert.equal(rows[0].agent.state, 'pass');
  assert.equal(rows[0].human.state, 'never');
  assert.equal(rows[0].verdict, 'pending');
  const done = deriveStatus(
    blueprint({
      verify: ['agent', 'human'],
      runs: [
        walkdownRun('2026-01-01', 'agent', 'pass'),
        walkdownRun('2026-01-02', 'topher', 'pass'),
      ],
    }),
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
    ['join', 'confirm'],
  );
  // "remains on" shape: same screen mentioned in given and then
  assert.deepEqual(screenFlow(rule({ given: ['On `join`'], then: ['Still on `join`'] }), screens), [
    'join',
  ]);
  // a genuine revisit is preserved
  assert.deepEqual(
    screenFlow(
      rule({ given: ['On `join`'], when: ['Go to `confirm`'], then: ['Back on `join`'] }),
      screens,
    ),
    ['join', 'confirm', 'join'],
  );
  assert.deepEqual(screenFlow({}, screens), []);
});

test('drift: undesigned screens and thread-born rules are derived', () => {
  const bp = blueprint({
    threads: [{ id: 'q-9', kind: 'question', status: 'open', anchor: { screen: 'extra' } }],
  });
  bp.storyboard = {
    screens: [
      { id: 'home', prototype: '/home.html' },
      { id: 'extra', prototype: null, proposal: '/extra.html' },
    ],
  };
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
      // Every addressed note on a walkable rule is that rule's conversation:
      // ONE verify item, on the rule, naming them all (ADR 0006 §3) - the
      // look that clears them is a verdict on the rule. A settled
      // observation and a decision wait on nothing.
      { id: 'n-1', kind: 'note', reason: 'feedback', status: 'addressed', anchor: { rule: 'demo.main.thing' } },
      { id: 'n-4', kind: 'note', status: 'addressed', anchor: { rule: 'demo.main.thing' } }, // no reason: feedback
      { id: 'n-5', kind: 'note', reason: 'finding', status: 'addressed', anchor: { rule: 'demo.main.thing' } },
      { id: 'n-6', kind: 'note', reason: 'observation', status: 'settled', anchor: { rule: 'demo.main.thing' } },
      // An addressed observation is the agent's to settle, never a person's
      // to verify: it noticed it itself and closes it itself.
      { id: 'n-9', kind: 'note', reason: 'observation', status: 'addressed', anchor: { rule: 'demo.main.thing' } },
      { id: 'n-7', kind: 'note', reason: 'decision', status: 'recorded', anchor: { rule: 'demo.main.thing' } },
      // Feedback with no rule stands on its own.
      { id: 'n-8', kind: 'note', reason: 'feedback', status: 'addressed', anchor: { screen: 'main' } },
      { id: 'n-2', kind: 'note', status: 'open', anchor: { rule: 'demo.main.thing' } },
      { id: 'q-1', kind: 'question', status: 'open', anchor: {} },
      { id: 'q-2', kind: 'question', status: 'answered', anchor: {} },
      { id: 'q-3', kind: 'question', status: 'waived', anchor: {} },
    ],
  });
  const { attention } = deriveStatus(bp);
  const byWho = (who) =>
    attention.filter((i) => i.who === who).map((i) => `${i.action}:${i.thread ?? i.rule}`);
  assert.deepEqual(byWho('human'), ['judge:demo.main.thing', 'verify:n-8', 'answer:q-1', 'verify:demo.main.thing']);
  assert.deepEqual(byWho('agent'), ['settle:n-9', 'address:n-2', 'incorporate:q-2']);
  const perRule = attention.find((i) => i.action === 'verify' && i.rule === 'demo.main.thing');
  assert.deepEqual(perRule.threads, ['n-1', 'n-4', 'n-5']);
});

/*
 * An answered question hands the rule to the agent. Until it is folded in,
 * the rule is nobody else's: a person answering it and then being offered
 * Pass/Fail on the same rule is what this guards (2026-09-18).
 */
test('a rule holding an answered question waits on the fold-in and on nobody else @rule:status.attention.blocked-queues', () => {
  const { attention } = deriveStatus(
    blueprint({
      verify: ['checks', 'human'],
      runs: [checksRun('2026-01-03T00:00:00Z', 'local', 'pass')],
      threads: [
        { id: 'n-1', kind: 'note', reason: 'feedback', status: 'addressed', anchor: { rule: 'demo.main.thing' } },
        { id: 'q-1', kind: 'question', status: 'answered', anchor: { rule: 'demo.main.thing' } },
      ],
    }),
  );
  assert.deepEqual(
    attention.map((i) => `${i.who}:${i.action}:${i.thread ?? i.rule}`),
    ['agent:incorporate:q-1'],
  );
  // Incorporated, and the rule is the person's again: the walk, and the note.
  const after = deriveStatus(
    blueprint({
      verify: ['checks', 'human'],
      runs: [checksRun('2026-01-03T00:00:00Z', 'local', 'pass')],
      threads: [
        { id: 'n-1', kind: 'note', reason: 'feedback', status: 'addressed', anchor: { rule: 'demo.main.thing' } },
        { id: 'q-1', kind: 'question', status: 'incorporated', anchor: { rule: 'demo.main.thing' } },
      ],
    }),
  );
  assert.deepEqual(
    after.attention.filter((i) => i.who === 'human').map((i) => `${i.action}:${i.rule}`),
    ['judge:demo.main.thing', 'verify:demo.main.thing'],
  );
});

test('open threads listed; terminal ones excluded', () => {
  const { rows } = deriveStatus(
    blueprint({
      threads: [
        { id: 'n-1', kind: 'note', status: 'addressed', anchor: { rule: 'demo.main.thing' } },
        {
          id: 'q-1',
          kind: 'question',
          status: 'incorporated',
          anchor: { rule: 'demo.main.thing' },
        },
      ],
    }),
  );
  assert.deepEqual(rows[0].threads, [{ id: 'n-1', status: 'addressed' }]);
});

test('sign-off is not build evidence: approved stays unbuilt and pending, and discharges the queue until built', () => {
  const owed = (attention) =>
    attention.some(
      (a) => a.who === 'human' && a.action === 'judge' && a.rule === 'demo.main.thing',
    );
  const unbuilt = deriveStatus(
    blueprint({
      verify: ['human'],
      runs: [walkdownRun('2026-01-02T00:00:00Z', 'topher', 'approved')],
    }),
  );
  assert.equal(unbuilt.rows[0].built, false);
  assert.equal(unbuilt.rows[0].human.state, 'approved');
  assert.equal(unbuilt.rows[0].signoff, 'approved');
  // The role that approved reads as approved, not as signed: the wording is
  // accepted and the build is not judged.
  assert.deepEqual(
    unbuilt.rows[0].acceptance.map((a) => [a.role, a.state]),
    [['eng', 'approved']],
  );
  assert.equal(unbuilt.rows[0].verdict, 'pending');
  // The sign-off is given: nothing is owed until the build lands.
  assert.equal(owed(unbuilt.attention), false);
  // Unsigned and unbuilt: the sign-off itself is owed.
  const unsigned = deriveStatus(blueprint({ verify: ['human'] }));
  assert.equal(owed(unsigned.attention), true);
  // Built with only a stale-free approval on file: a real walkdown is owed.
  const built = deriveStatus(
    blueprint({
      verify: ['checks', 'human'],
      runs: [
        walkdownRun('2026-01-02T00:00:00Z', 'topher', 'approved'),
        checksRun('2026-01-03T00:00:00Z', 'local', 'pass'),
      ],
    }),
  );
  assert.equal(built.rows[0].built, true);
  assert.equal(owed(built.attention), true);
});

/*
 * A rule nothing verifies but a signature - every evidence tier excused. It
 * can never earn a build verdict, so "built" cannot come from the ledger,
 * so a signature on it only ever read as approving the wording: pending for
 * ever, its feedback closable by nobody (one-switch, 2026-09-16). Where the
 * signature is the whole judgment, it is the verdict.
 */
test('where nothing verifies a rule but a signature, the signature is the verdict', () => {
  const excused = { checks: 'the button is browser chrome', agent: 'no tool an agent drives reaches it' };
  const signed = deriveStatus(
    blueprint({
      verify: [],
      unverifiable: excused,
      runs: [walkdownRun('2026-01-02T00:00:00Z', 'topher', 'approved')],
    }),
  );
  assert.equal(signed.rows[0].built, true);
  assert.deepEqual(signed.rows[0].acceptance.map((a) => [a.role, a.state]), [['eng', 'signed']]);
  assert.equal(signed.rows[0].verdict, 'pass');
  // Unsigned, the signature is owed - the one thing that can be.
  const unsigned = deriveStatus(blueprint({ verify: [], unverifiable: excused }));
  assert.equal(unsigned.rows[0].verdict, 'pending');
  assert.ok(unsigned.attention.some((a) => a.who === 'human' && a.action === 'judge' && a.rule === 'demo.main.thing'));
  // And a rule that is merely unbuilt is not this: agent is asked by default.
  const unbuilt = deriveStatus(blueprint({ verify: [], runs: [walkdownRun('2026-01-02T00:00:00Z', 'topher', 'approved')] }));
  assert.equal(unbuilt.rows[0].built, false);
  assert.equal(unbuilt.rows[0].verdict, 'pending');
});

/*
 * A thread on a rule that can be walked is the rule's conversation, whatever
 * its reason: a request on a live rule waits under the rule with the feedback
 * (ADR 0006 §3). A note on a retired rule has no rule to walk, so it stands
 * on its own where Verify is.
 */
test('every note on a walkable rule waits under the rule; one on a retired rule waits as a thread', () => {
  const rule = 'demo.main.thing';
  const live = deriveStatus(
    blueprint({
      verify: ['agent'],
      runs: [walkdownRun('2026-01-01', 'agent', 'pass')],
      threads: [
        { id: 'n-1', kind: 'note', reason: 'feedback', status: 'addressed', anchor: { rule } },
        { id: 'n-2', kind: 'note', reason: 'request', status: 'addressed', anchor: { rule } },
        { id: 'q-1', kind: 'question', status: 'open', anchor: { rule } },
      ],
    }),
  );
  const verify = (st) => st.attention.filter((i) => i.who === 'human' && i.action === 'verify').map((i) => i.thread ?? `rule:${i.rule}`);
  assert.deepEqual(verify(live), [`rule:${rule}`]);
  assert.deepEqual(live.attention.find((i) => i.rule === rule && i.action === 'verify' && !i.thread).threads, ['n-1', 'n-2']);
  // And an open question on it is the rule's to answer, listed once under
  // the rule rather than as a thread of its own.
  const asks = live.attention.filter((i) => i.who === 'human' && i.action === 'answer');
  assert.deepEqual(asks, [{ who: 'human', action: 'answer', rule, threads: ['q-1'] }]);

  const retired = deriveStatus(
    blueprint({
      retired: '2026-01-01',
      threads: [
        { id: 'n-3', kind: 'note', reason: 'feedback', status: 'addressed', anchor: { rule } },
        { id: 'q-2', kind: 'question', status: 'open', anchor: { rule } },
      ],
    }),
  );
  assert.equal(retired.rows.length, 0);
  assert.deepEqual(verify(retired), ['n-3']);
  assert.deepEqual(retired.attention.filter((i) => i.action === 'answer').map((i) => i.thread), ['q-2']);
});

test('a build verdict flips built; an approval goes stale when the statement moves', () => {
  const built = deriveStatus(
    blueprint({ runs: [checksRun('2026-01-02T00:00:00Z', 'local', 'fail')] }),
  );
  assert.equal(built.rows[0].built, true);
  const stale = deriveStatus(
    blueprint({
      verify: ['human'],
      runs: [
        {
          created: '2026-01-02T00:00:00Z',
          kind: 'walkdown',
          target: 'local',
          actor: 'topher',
          run_id: 'r-stale',
          results: [{ rule: 'demo.main.thing', status: 'approved', statement_hash: BOGUS_HASH }],
        },
      ],
    }),
  );
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

  const before = deriveStatus(blueprint({ runs, verify: ['checks', 'agent'], targets: here }))
    .rows[0];
  assert.equal(before.cells.local.state, 'pass');
  assert.equal(before.agent.state, 'pass');

  // Same ledger, same files - only the address the target points at moved.
  const after = deriveStatus(blueprint({ runs, verify: ['checks', 'agent'], targets: moved }))
    .rows[0];
  assert.equal(
    after.cells.local.state,
    'never',
    'checks earned elsewhere must not fill this target',
  );
  assert.equal(
    after.agent.state,
    'never',
    'a walkdown of another system is not a walkdown of this one',
  );

  // Nothing was consumed: aiming back restores it, because the ledger is history.
  const back = deriveStatus(blueprint({ runs, verify: ['checks', 'agent'], targets: here }))
    .rows[0];
  assert.equal(back.agent.state, 'pass');
});

test('a cosmetic edit to the address is the same place @rule:status.derived.verdict-belongs-to-a-place', () => {
  // A trailing slash and an uppercased host: the same system, and exact
  // string equality emptied every cell over it (n-0199).
  const runs = [at(walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass'), 'https://pr-1.review.app')];
  for (const base_url of ['https://pr-1.review.app/', 'https://PR-1.review.app']) {
    const row = deriveStatus(blueprint({ runs, verify: ['agent'], targets: { local: { base_url } } })).rows[0];
    assert.equal(row.agent.state, 'pass', base_url);
  }
  // A different path is a different place still.
  const other = deriveStatus(
    blueprint({ runs, verify: ['agent'], targets: { local: { base_url: 'https://pr-1.review.app/v2' } } }),
  ).rows[0];
  assert.equal(other.agent.state, 'never');
});

test('a run with no recorded address is taken at face value @rule:status.derived.addressless-runs-count', () => {
  const runs = [walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass')]; // no base_url, as a unit-test runner writes
  const row = deriveStatus(
    blueprint({
      runs,
      verify: ['agent'],
      targets: { local: { base_url: 'https://pr-2.review.app' } },
    }),
  ).rows[0];
  assert.equal(row.agent.state, 'pass');
});

/*
 * The other half (q-0302): a TARGET with no address is a target with no
 * place, so a run that named a place cannot fill its cells. Deleting a
 * target's address used to resurrect every run ever made against it - 170
 * verdicts at once (n-0199). The addressless RUN above still counts.
 */
test('an addressless target counts no run that named an address @rule:status.derived.verdict-belongs-to-a-place', () => {
  const placed = at(walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass'), 'https://pr-1.review.app');
  const row = deriveStatus(blueprint({ runs: [placed], verify: ['agent'], targets: { local: {} } })).rows[0];
  assert.equal(row.agent.state, 'never');
  const unplaced = walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass');
  assert.equal(
    deriveStatus(blueprint({ runs: [unplaced], verify: ['agent'], targets: { local: {} } })).rows[0].agent.state,
    'pass',
  );
});

test('a walkdown on one target does not answer for another @rule:status.derived.latest-wins', () => {
  const runs = [{ ...walkdownRun('2026-01-02T00:00:00Z', 'agent', 'pass'), target: 'staging' }];
  // The verdict was made on staging; local has never been judged.
  const local = deriveStatus(blueprint({ runs, verify: ['agent'] }), { target: 'local' }).rows[0];
  const staging = deriveStatus(blueprint({ runs, verify: ['agent'] }), { target: 'staging' })
    .rows[0];
  assert.equal(local.agent.state, 'never');
  assert.equal(staging.agent.state, 'pass');
});

test('a pass whose check no longer claims the rule goes stale @rule:status.derived.unbacked-pass-goes-stale', () => {
  const runs = [checksRun('2026-01-01T00:00:00Z', 'local', 'pass')];
  const bp = blueprint({ runs });

  // Suite still claims it: a live pass.
  assert.equal(
    deriveStatus(bp, { checkRefs: new Set(['demo.main.thing']) }).rows[0].cells.local.state,
    'pass',
  );

  // Suite no longer mentions it - deleted, renamed, or untagged as false evidence.
  assert.equal(
    deriveStatus(bp, { checkRefs: new Set(['something.else']) }).rows[0].cells.local.state,
    'stale',
  );

  // No inventory supplied is not evidence of an empty suite.
  assert.equal(deriveStatus(bp).rows[0].cells.local.state, 'pass');
});

test('coverage staleness does not touch judgment tiers @rule:status.derived.unbacked-pass-goes-stale', () => {
  const runs = [walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass')];
  const row = deriveStatus(blueprint({ runs, verify: ['agent'] }), { checkRefs: new Set() })
    .rows[0];
  // An agent looked at it; no check ever claimed to. That is not staleness.
  assert.equal(row.agent.state, 'pass');
});

test('an empty inventory is not proof the suite is empty @rule:status.derived.unbacked-pass-goes-stale', () => {
  const runs = [checksRun('2026-01-01T00:00:00Z', 'local', 'pass')];
  // A blueprint served from a copy finds no check files at all. Reading that as
  // "nothing checks this rule" turned every checks pass stale at once.
  const row = deriveStatus(blueprint({ runs }), { checkRefs: new Set() }).rows[0];
  assert.equal(row.cells.local.state, 'pass');
});

/*
 * Sweeps. A sweep is a marker saying "from here, earn it again" - it makes
 * every verdict older than itself read as stale, without a single run file
 * being edited or deleted, which is the law that made supersession the only
 * available shape (status.derived.latest-wins).
 */
const sweep = (created, tiers, target = 'local') => ({
  created,
  kind: 'sweep',
  target,
  actor: 'topher',
  run_id: created,
  tiers,
  why: 'the thing was rebuilt',
  results: [],
});

test('a sweep makes earlier verdicts stale, and the runs survive it @rule:status.sweep.declares-a-floor', () => {
  const runs = [walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass')];
  const before = deriveStatus(blueprint({ runs, verify: ['checks', 'agent'] }));
  assert.equal(before.rows[0].agent.state, 'pass');

  const swept = deriveStatus(
    blueprint({
      runs: [...runs, sweep('2026-02-01T00:00:00Z', ['agent'])],
      verify: ['checks', 'agent'],
    }),
  );
  // Stale, not never: it did pass once, and saying so is the difference
  // between "we have not got to it" and "nothing ever tested this".
  assert.equal(swept.rows[0].agent.state, 'stale');
  assert.equal(swept.rows[0].agent.sweptBy, '2026-02-01T00:00:00Z');
  // The superseded run is still in the ledger, unedited.
  assert.equal(swept.rows[0].agent.runId, '2026-01-01T00:00:00Z');
});

/*
 * Why a cell is stale, when a sweep is not the whole answer. The turn-end
 * gate (.highball/checks/agent-tier-owed) leaves a cell stale only by a
 * sweep to the sitting, and refuses one that was also reworded.
 */
test('a cell stale only by a sweep says so; one also reworded says that too @rule:status.sweep.declares-a-floor', () => {
  const swept = deriveStatus(
    blueprint({ runs: [walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass'), sweep('2026-02-01T00:00:00Z', ['agent'])], verify: ['checks', 'agent'] }),
  );
  assert.equal(swept.rows[0].agent.sweptBy, '2026-02-01T00:00:00Z');
  assert.equal(swept.rows[0].agent.staleBy, undefined);

  const reworded = { ...walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass') };
  reworded.results = [{ ...reworded.results[0], statement_hash: 'sha256:000000000000' }];
  const both = deriveStatus(blueprint({ runs: [reworded, sweep('2026-02-01T00:00:00Z', ['agent'])], verify: ['checks', 'agent'] }));
  assert.equal(both.rows[0].agent.state, 'stale');
  assert.equal(both.rows[0].agent.sweptBy, '2026-02-01T00:00:00Z');
  assert.equal(both.rows[0].agent.staleBy, 'rewording');
});

test('judging again after a sweep clears it @rule:status.sweep.declares-a-floor', () => {
  const derived = deriveStatus(
    blueprint({
      runs: [
        walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass'),
        sweep('2026-02-01T00:00:00Z', ['agent']),
        walkdownRun('2026-03-01T00:00:00Z', 'agent', 'pass'),
      ],
      verify: ['checks', 'agent'],
    }),
  );
  assert.equal(derived.rows[0].agent.state, 'pass');
  assert.equal(derived.rows[0].agent.sweptBy, undefined);
});

test('a sweep touches only the tiers it names @rule:status.sweep.declares-a-floor', () => {
  const derived = deriveStatus(
    blueprint({
      runs: [
        checksRun('2026-01-01T00:00:00Z', 'local', 'pass'),
        walkdownRun('2026-01-01T00:00:01Z', 'agent', 'pass'),
        sweep('2026-02-01T00:00:00Z', ['agent']),
      ],
      verify: ['checks', 'agent'],
    }),
  );
  assert.equal(derived.rows[0].cells.local.state, 'pass', 'checks were not swept');
  assert.equal(derived.rows[0].agent.state, 'stale', 'agent was');
});

test('a sweep counts what is still owed, never-judged rules included @rule:status.sweep.says-what-is-left', () => {
  const derived = deriveStatus(
    blueprint({
      runs: [
        walkdownRun('2026-01-01T00:00:00Z', 'agent', 'pass'),
        sweep('2026-02-01T00:00:00Z', ['agent']),
      ],
      verify: ['checks', 'agent'],
    }),
  );
  const [s] = derived.sweeps;
  assert.equal(s.tier, 'agent');
  assert.equal(s.of, 1);
  assert.equal(s.done, 0);
  assert.deepEqual(s.owed, ['demo.main.thing']);
  assert.equal(s.why, 'the thing was rebuilt');
});

test('nothing but the sweep command writes a sweep @rule:status.sweep.deliberate', () => {
  // The shape of the guarantee: no checks run and no walkdown carries the kind,
  // so deriving over a ledger of ordinary runs finds no sweep to report.
  const derived = deriveStatus(
    blueprint({
      runs: [
        checksRun('2026-01-01T00:00:00Z', 'local', 'pass'),
        walkdownRun('2026-01-02T00:00:00Z', 'agent', 'pass'),
        walkdownRun('2026-01-03T00:00:00Z', 'topher', 'pass'),
      ],
      verify: ['checks', 'agent', 'human'],
    }),
  );
  assert.deepEqual(derived.sweeps, []);
  assert.equal(derived.rows[0].agent.state, 'pass');
});

/*
 * A pass that predates the fix claimed on its rule.
 *
 * The board goes stale on three things - a moved statement, a sweep, a dropped
 * check - and deliberately not on the code changing. That leaves the common
 * shape uncovered: a judge passes a rule and files a note about something it
 * saw beside the verdict, somebody fixes the note, and the cell stays green
 * through all of it. n-0195 sat exactly there, its passing run the very one
 * that filed it.
 */
const note = (id, status, replyAt, rule = 'demo.main.thing') => ({
  id,
  kind: 'note',
  status,
  anchor: { rule },
  created: '2026-01-01T00:00:00Z',
  ...(replyAt && { replies: [{ author: 'topher', created: replyAt, body: 'fixed' }] }),
});

test('a pass older than the fix claimed on its rule is marked, and owed to the agent @rule:status.derived.latest-wins', () => {
  const { rows, attention } = deriveStatus(
    blueprint({
      verify: ['agent'],
      runs: [walkdownRun('2026-02-01T00:00:00Z', 'agent', 'pass')],
      threads: [note('n-1', 'addressed', '2026-02-02T00:00:00Z')],
    }),
  );
  // The verdict is not withdrawn - it was earned. It is marked.
  assert.equal(rows[0].agent.state, 'pass');
  assert.deepEqual(rows[0].unjudgedFix, { thread: 'n-1', at: '2026-02-02T00:00:00Z' });
  assert.ok(
    attention.some((i) => i.who === 'agent' && i.action === 'rejudge' && i.thread === 'n-1'),
    'the agent owes a fresh judgment',
  );
  // And the human item says the machine side is not finished, rather than
  // presenting acceptance as the only step left.
  assert.equal(attention.find((i) => i.action === 'verify')?.unjudged, true);
});

test('the verdict reply that closed a thread is not a fix the pass missed @rule:threads.lifecycle.closes-where-it-was-asked', () => {
  // A signed pass on 02-03 closed the thread and wrote its own reply, dated
  // after the agent's pass; the fix itself was claimed on 02-02, before it.
  const closed = {
    ...note('n-1', 'verified', '2026-02-02T00:00:00Z'),
    verified_by: 'topher',
    replies: [
      { author: 'topher', created: '2026-02-02T00:00:00Z', body: 'fixed' },
      { author: 'topher', via: 'verdict', created: '2026-02-04T00:00:00Z', body: "Verified by topher's pass." },
    ],
  };
  const { rows, attention } = deriveStatus(
    blueprint({
      verify: ['agent'],
      runs: [walkdownRun('2026-02-03T00:00:00Z', 'agent', 'pass')],
      threads: [closed],
    }),
  );
  assert.equal(rows[0].unjudgedFix, null);
  assert.ok(!attention.some((i) => i.action === 'rejudge'));
});

test('a pass recorded after the claim is not marked', () => {
  const { rows, attention } = deriveStatus(
    blueprint({
      verify: ['agent'],
      runs: [walkdownRun('2026-02-03T00:00:00Z', 'agent', 'pass')],
      threads: [note('n-1', 'addressed', '2026-02-02T00:00:00Z')],
    }),
  );
  assert.equal(rows[0].unjudgedFix, null);
  assert.ok(!attention.some((i) => i.action === 'rejudge'));
  assert.equal(attention.find((i) => i.action === 'verify')?.unjudged, false);
});

/*
 * The checks tier is deliberately exempt. Its suite runs on every edit and only
 * sometimes RECORDS, so its newest record is routinely older than everything
 * while the tests themselves are current - marking it starred sixty rules at
 * once and buried the four that meant something.
 */
test('the checks tier is not marked, however old its record is', () => {
  const { rows } = deriveStatus(
    blueprint({
      verify: ['checks'],
      runs: [checksRun('2026-02-01T00:00:00Z', 'local', 'pass')],
      threads: [note('n-1', 'addressed', '2026-02-02T00:00:00Z')],
    }),
  );
  assert.equal(rows[0].cells.local.state, 'pass');
  assert.equal(rows[0].cells.local.unjudgedFix, undefined);
  assert.equal(rows[0].unjudgedFix, null);
});

/*
 * A claim is a reply. Addressing a note means saying what was done, and the
 * transition itself records no time - threads.js writes a reply or nothing -
 * so a thread that moved status silently has no honest answer to give and is
 * left alone rather than guessed at.
 */
test('a thread addressed with nothing written claims no time', () => {
  const { rows } = deriveStatus(
    blueprint({
      verify: ['agent'],
      runs: [walkdownRun('2026-02-01T00:00:00Z', 'agent', 'pass')],
      threads: [note('n-1', 'addressed', null)],
    }),
  );
  assert.equal(rows[0].unjudgedFix, null);
});

test('an open note claims nothing - it is unfixed work, already queued as such', () => {
  const { rows, attention } = deriveStatus(
    blueprint({
      verify: ['agent'],
      runs: [walkdownRun('2026-02-01T00:00:00Z', 'agent', 'pass')],
      threads: [note('n-1', 'open', '2026-02-02T00:00:00Z')],
    }),
  );
  assert.equal(rows[0].unjudgedFix, null);
  assert.ok(attention.some((i) => i.action === 'address'));
});

/*
 * A rule nobody has judged owes a FIRST judgment, not a second one, and the
 * board already says so. Marking it would put two items on the queue for one
 * piece of work.
 */
test('a rule with no verdict at all is never marked', () => {
  const { rows, attention } = deriveStatus(
    blueprint({
      verify: ['agent'],
      threads: [note('n-1', 'addressed', '2026-02-02T00:00:00Z')],
    }),
  );
  assert.equal(rows[0].agent.state, 'never');
  assert.equal(rows[0].unjudgedFix, null);
  assert.ok(!attention.some((i) => i.action === 'rejudge'));
});

test('a fail is not marked either - it is loud already, and owes a fix rather than a re-judgment', () => {
  const { rows } = deriveStatus(
    blueprint({
      verify: ['agent'],
      runs: [walkdownRun('2026-02-01T00:00:00Z', 'agent', 'fail')],
      threads: [note('n-1', 'addressed', '2026-02-02T00:00:00Z')],
    }),
  );
  assert.equal(rows[0].agent.state, 'fail');
  assert.equal(rows[0].unjudgedFix, null);
});

/*
 * A person's skip is a record of not judging (n-0309, q-0315): the sitting
 * set the rule aside. It fills no cell and touches no signature, so a signed
 * rule skipped next sitting is still signed, and an owed one is still owed
 * and comes round again. The run keeps the skip; the board does not read it
 * as a verdict of any kind.
 */
test('a human skip signs nothing and revokes nothing; the rule is what it was @rule:status.derived.latest-wins', () => {
  const skippedAfterSigning = deriveStatus(
    blueprint({
      runs: [
        walkdownRun('2026-01-01T00:00:00Z', 'topher', 'pass'),
        walkdownRun('2026-01-02T00:00:00Z', 'topher', 'skipped'),
      ],
    }),
  );
  assert.deepEqual(skippedAfterSigning.rows[0].acceptance.map((a) => [a.role, a.state]), [['eng', 'signed']]);
  assert.equal(skippedAfterSigning.rows[0].human.state, 'pass');

  const skippedUnsigned = deriveStatus(
    blueprint({ runs: [walkdownRun('2026-01-02T00:00:00Z', 'topher', 'skipped')] }),
  );
  assert.deepEqual(skippedUnsigned.rows[0].acceptance.map((a) => [a.role, a.state]), [['eng', 'none']]);
  assert.equal(skippedUnsigned.rows[0].human.state, 'never');
});
