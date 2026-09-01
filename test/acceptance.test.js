/*
 * Acceptance: who has signed a rule, derived per role from the runs ledger.
 *
 * Ledger laws, so node:test over lib/status.js. The panel's row of dots and
 * the Settings control that picks a role are claims about the panel and belong
 * in checks/ - deriving the right answer is not drawing it (thread q-0070).
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatHash } from '../lib/hash.js';
import { deriveStatus } from '../lib/status.js';

const STATEMENT = 'The visitor can do the thing.';
const HASH = formatHash(STATEMENT);

function blueprint({ runs = [], signoff, verify = ['checks'] } = {}) {
  return {
    config: { runner: { targets: { local: {} } } },
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
                  ...(signoff && { signoff }),
                },
              ],
            },
          ],
        },
      },
    ],
    threads: [],
    runs: runs.map((data, i) => ({ file: `runs/r-${i}.json`, data })),
  };
}

/** A person's walkdown, signed in the roles given (or in none at all). */
const signed = (created, actor, status, roles, hash = HASH) => ({
  created,
  kind: 'walkdown',
  target: 'local',
  actor,
  run_id: created,
  ...(roles && { roles }),
  results: [{ rule: 'demo.main.thing', status, statement_hash: hash }],
});
const checksRun = (created, status) => ({
  created,
  kind: 'checks',
  target: 'local',
  actor: 'agent',
  run_id: created,
  results: [{ rule: 'demo.main.thing', status, statement_hash: HASH }],
});
const agentRun = (created, status) => ({
  created,
  kind: 'walkdown',
  target: 'local',
  actor: 'agent',
  run_id: created,
  results: [{ rule: 'demo.main.thing', status, statement_hash: HASH }],
});

const states = (row) => Object.fromEntries(row.acceptance.map((a) => [a.role, a.state]));

test('acceptance is derived per role from the roles the run was recorded under @rule:status.acceptance.role-comes-from-the-run', () => {
  const { rows } = deriveStatus(
    blueprint({
      signoff: ['eng', 'product'],
      runs: [signed('2026-01-01', 'topher', 'pass', ['eng'])],
    }),
  );
  // One sitting, one signature. Engineering's pass does not speak for
  // product - which is the entire reason acceptance is a set of people
  // rather than a single "human" cell.
  assert.deepEqual(states(rows[0]), { eng: 'signed', product: 'none' });

  // A person wearing both hats signs both in one sitting, and says so.
  const both = deriveStatus(
    blueprint({
      signoff: ['eng', 'product'],
      runs: [signed('2026-01-02', 'topher', 'pass', ['eng', 'product'])],
    }),
  );
  assert.deepEqual(states(both.rows[0]), { eng: 'signed', product: 'signed' });

  // The ROLE comes off the run, not off whoever the signer is today. A
  // second person signing only as product leaves engineering's earlier
  // signature exactly where it was: people change teams, and a signature
  // does not stop meaning what it meant.
  const two = deriveStatus(
    blueprint({
      signoff: ['eng', 'product'],
      runs: [
        signed('2026-01-01', 'topher', 'pass', ['eng']),
        signed('2026-01-03', 'dana', 'pass', ['product']),
      ],
    }),
  );
  assert.deepEqual(states(two.rows[0]), { eng: 'signed', product: 'signed' });
  assert.equal(two.rows[0].acceptance.find((a) => a.role === 'product').actor, 'dana');
});

test('a run recorded before roles existed reads as engineering @rule:status.acceptance.role-comes-from-the-run', () => {
  // Historically the person signing a walkdown was the developer who built
  // it. Reading the old records as product's would be inventing signatures
  // nobody gave; reading them as nobody's would discard real judgment.
  for (const roles of [undefined, []]) {
    const { rows } = deriveStatus(
      blueprint({
        signoff: ['eng', 'product'],
        runs: [signed('2026-01-01', 'topher', 'pass', roles)],
      }),
    );
    assert.deepEqual(
      states(rows[0]),
      { eng: 'signed', product: 'none' },
      `roles ${JSON.stringify(roles)} should read as engineering's`,
    );
  }
});

test('an approval covers an unbuilt rule and stops the moment there is a build @rule:status.acceptance.approval-covers-only-the-unbuilt', () => {
  // Nothing has ever verified this rule, so there is nothing to judge and
  // approving the wording is the honest thing to record.
  const unbuilt = deriveStatus(
    blueprint({
      runs: [signed('2026-01-01', 'topher', 'approved', ['eng'])],
    }),
  );
  assert.equal(unbuilt.rows[0].built, false);
  assert.deepEqual(states(unbuilt.rows[0]), { eng: 'approved' });
  // Approved is not signed: the verdict stays pending either way.
  assert.equal(unbuilt.rows[0].verdict, 'pending');
  // And it discharges the queue - nobody is asked to look at a rule that
  // has nothing to look at.
  assert.equal(unbuilt.attention.filter((i) => i.action === 'judge').length, 0);

  // Now a check runs. There is a build, so the approval stops covering it
  // and the rule owes a real signature: approving a spec is not judging a
  // build.
  const built = deriveStatus(
    blueprint({
      runs: [signed('2026-01-01', 'topher', 'approved', ['eng']), checksRun('2026-01-02', 'pass')],
    }),
  );
  assert.equal(built.rows[0].built, true);
  assert.deepEqual(states(built.rows[0]), { eng: 'approved' });
  assert.deepEqual(
    built.attention.filter((i) => i.action === 'judge').map((i) => [i.who, i.role, i.rule]),
    [['human', 'eng', 'demo.main.thing']],
  );
});

test('a rule sent back fails, and is not queued to the person who sent it @rule:status.acceptance.sent-back-is-a-fail', () => {
  for (const status of ['refining', 'fail']) {
    const { rows, attention } = deriveStatus(
      blueprint({
        signoff: ['eng', 'product'],
        runs: [
          checksRun('2026-01-01', 'pass'),
          agentRun('2026-01-02', 'pass'),
          signed('2026-01-03', 'topher', status, ['product']),
        ],
      }),
    );
    // Somebody looked and said not yet. That is a fail, not a gap - every
    // tier below is green and the rule is still not right.
    assert.equal(states(rows[0]).product, 'sent-back', status);
    assert.equal(rows[0].verdict, 'fail', status);
    // They have looked. What the rule owes them is a fix, not another look.
    assert.equal(
      attention.some((i) => i.action === 'judge' && i.role === 'product'),
      false,
      status,
    );
    // Engineering has still not signed, and is still asked to.
    assert.equal(
      attention.some((i) => i.action === 'judge' && i.role === 'eng'),
      true,
      status,
    );
  }
});

test('a verdict needs every tier AND every role @rule:status.acceptance.verdict-needs-every-role', () => {
  const runs = [checksRun('2026-01-01', 'pass'), agentRun('2026-01-02', 'pass')];

  // Every tier green, nobody signed: pending, not passing. The tiers exist to
  // earn a person's attention, never to stand in for it.
  const unsigned = deriveStatus(blueprint({ signoff: ['eng', 'product'], runs }));
  assert.equal(unsigned.rows[0].verdict, 'pending');

  // One of two roles signed: still pending. One signature never speaks for
  // another's - this is the case a single "human" cell got wrong.
  const half = deriveStatus(
    blueprint({
      signoff: ['eng', 'product'],
      runs: [...runs, signed('2026-01-03', 'topher', 'pass', ['eng'])],
    }),
  );
  assert.equal(half.rows[0].verdict, 'pending');
  assert.deepEqual(states(half.rows[0]), { eng: 'signed', product: 'none' });

  // Both roles signed, every tier green: verified.
  const whole = deriveStatus(
    blueprint({
      signoff: ['eng', 'product'],
      runs: [...runs, signed('2026-01-03', 'topher', 'pass', ['eng', 'product'])],
    }),
  );
  assert.equal(whole.rows[0].verdict, 'pass');

  // Both roles signed but a tier is red: still a fail. Acceptance does not
  // outrank evidence; it is the other half of the same sum.
  const broken = deriveStatus(
    blueprint({
      signoff: ['eng', 'product'],
      runs: [
        checksRun('2026-01-01', 'fail'),
        agentRun('2026-01-02', 'pass'),
        signed('2026-01-03', 'topher', 'pass', ['eng', 'product']),
      ],
    }),
  );
  assert.equal(broken.rows[0].verdict, 'fail');
});

test('rewording a statement un-signs it, per role @rule:status.acceptance.role-comes-from-the-run', () => {
  const { rows } = deriveStatus(
    blueprint({
      signoff: ['eng', 'product'],
      runs: [
        signed('2026-01-01', 'topher', 'pass', ['eng'], 'sha256:' + '0'.repeat(12)),
        signed('2026-01-02', 'dana', 'pass', ['product']),
      ],
    }),
  );
  // A signature is of the statement as written. Moving the words asks the
  // signer again - and asks only the signer whose signature moved.
  assert.deepEqual(states(rows[0]), { eng: 'stale', product: 'signed' });
});

test('the queue names the role a rule waits on @rule:status.attention.names-the-role', () => {
  const { attention } = deriveStatus(
    blueprint({
      signoff: ['eng', 'product', 'design'],
      runs: [checksRun('2026-01-01', 'pass'), signed('2026-01-02', 'topher', 'pass', ['eng'])],
    }),
  );
  // "Somebody should look at this" was never the question. A queue that
  // cannot say which role is a queue two people both scroll past.
  assert.deepEqual(
    attention.filter((i) => i.action === 'judge').map((i) => i.role),
    ['product', 'design'],
  );
});

test('an excused tier is derived out of the sum entirely @rule:status.evidence.agent-assumed', () => {
  const excused = {
    config: { runner: { targets: { local: {} } } },
    threads: [],
    runs: [{ file: 'runs/r-0.json', data: signed('2026-01-01', 'topher', 'pass', ['eng']) }],
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
                  unverifiable: {
                    checks:
                      'The control is the browser toolbar - a test that drives a page cannot click it.',
                    agent:
                      'The same button, for the same reason - no tool an agent drives reaches browser chrome.',
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
  const { rows } = deriveStatus(excused);
  // Both tiers excused: nothing verifies this rule but a signature, and with
  // that signature given the verdict is a pass. This is the legitimate case
  // lint warns about - legitimate, but never accidental.
  assert.deepEqual(rows[0].verify, []);
  assert.equal(rows[0].cells.local.state, 'na');
  assert.equal(rows[0].agent.state, 'na');
  assert.deepEqual(Object.keys(rows[0].excuses).sort(), ['agent', 'checks']);
  assert.equal(rows[0].verdict, 'pass');
});
