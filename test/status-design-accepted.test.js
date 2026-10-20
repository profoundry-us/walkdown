/*
 * ADR 0015 §8, q-0580: while a new design for a screen waits, the screen's
 * built rules keep their verdicts; accepting it makes them stale, so they
 * are judged again against it. Derived from the request's acceptance, over
 * the rules naming its screen, for the tiers that look at a design.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { formatHash } from '../lib/hash.js';
import { deriveStatus } from '../lib/status.js';
import { finishWalkdown, openThread } from '../lib/writes.js';
import { declareProject, threadAt } from '../tools/test-home.mjs';
import { parse } from '../vendor/yaml.js';

const said = (id) => `The ${id} rule holds.`;

const rule = (id, screens) => ({ id, statement: said(id), verify: ['checks'], screens });
function blueprint({ runs = [], threads = [] } = {}) {
  return {
    config: { runner: { targets: { local: {} } } },
    features: [
      {
        file: 'features/pay.yml',
        data: {
          feature: 'pay',
          stories: [
            {
              id: 'shop.pay',
              rules: [
                rule('shop.pay.one', ['receipt']),
                rule('shop.pay.two', ['receipt']),
                rule('shop.pay.cart', ['cart']),
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

const run = (created, kind, actor, status = 'pass') => ({
  created,
  kind,
  target: 'local',
  actor,
  run_id: `${created}-${kind}-${actor}`,
  results: ['shop.pay.one', 'shop.pay.two', 'shop.pay.cart'].map((id) => ({
    rule: id,
    status,
    statement_hash: formatHash(said(id)),
  })),
});
const before = [
  run('2026-10-01T00:00:00Z', 'checks', 'agent'),
  run('2026-10-01T00:00:00Z', 'walkdown', 'agent'),
  run('2026-10-01T00:00:00Z', 'walkdown', 'topher'),
];
const request = (over = {}) => ({
  id: 'n-0001',
  kind: 'note',
  reason: 'request',
  author: 'agent',
  created: '2026-10-05T00:00:00Z',
  anchor: { screen: 'receipt' },
  status: 'verified',
  verified_by: 'topher',
  verified_at: '2026-10-10T00:00:00Z',
  replies: [],
  ...over,
});
const cells = (bp) =>
  Object.fromEntries(
    deriveStatus(bp).rows.map((r) => [
      r.rule,
      { checks: r.cells.local.state, agent: r.agent.state, human: r.human.state },
    ]),
  );

test(`accepting a new design stales the agent and person verdicts given against the old one @rule:status.derived.new-design-stales-older-verdicts`, () => {
  assert.deepEqual(cells(blueprint({ runs: before }))['shop.pay.one'], {
    checks: 'pass',
    agent: 'pass',
    human: 'pass',
  });
  const after = deriveStatus(blueprint({ runs: before, threads: [request()] }));
  const by = Object.fromEntries(after.rows.map((r) => [r.rule, r]));
  for (const id of ['shop.pay.one', 'shop.pay.two']) {
    assert.equal(by[id].agent.state, 'stale', id);
    assert.equal(by[id].human.state, 'stale', id);
    // Which acceptance did it, so a reader is not left guessing at a sweep.
    assert.deepEqual(by[id].agent.designAccepted, { thread: 'n-0001', at: '2026-10-10T00:00:00Z' });
    // The checks tier tests behaviour, never a drawing.
    assert.equal(by[id].cells.local.state, 'pass', id);
  }
  // A rule on another screen is untouched.
  assert.deepEqual(cells(blueprint({ runs: before, threads: [request()] }))['shop.pay.cart'], {
    checks: 'pass',
    agent: 'pass',
    human: 'pass',
  });
  // And the agent's queue holds the built rules again, to judge them anew.
  const owed = after.attention.filter((a) => a.who === 'agent' && a.rule?.startsWith('shop.pay.'));
  assert.deepEqual(owed.map((a) => a.rule).sort(), ['shop.pay.one', 'shop.pay.two']);

  // The person's signature is stale too, not only their cell: once the agent
  // has judged again, the rule is not verified on the old signature, and the
  // person is asked to look again.
  const rejudged = deriveStatus(
    blueprint({
      runs: [...before, run('2026-10-11T00:00:00Z', 'walkdown', 'agent')],
      threads: [request()],
    }),
  );
  const one = rejudged.rows.find((r) => r.rule === 'shop.pay.one');
  assert.equal(one.agent.state, 'pass');
  assert.deepEqual(
    one.acceptance.map((a) => a.state),
    ['stale'],
  );
  assert.notEqual(one.verdict, 'pass');
  assert.ok(
    rejudged.attention.some((a) => a.who !== 'agent' && a.rule === 'shop.pay.one'),
    JSON.stringify(rejudged.attention),
  );
});

test(`a verdict given after the acceptance passes again, so the screen is not stale forever @rule:status.derived.new-design-stales-older-verdicts`, () => {
  const again = [
    ...before,
    run('2026-10-11T00:00:00Z', 'walkdown', 'agent'),
    run('2026-10-11T00:00:00Z', 'walkdown', 'topher'),
  ];
  assert.deepEqual(cells(blueprint({ runs: again, threads: [request()] }))['shop.pay.one'], {
    checks: 'pass',
    agent: 'pass',
    human: 'pass',
  });
});

test(`a person's verdict given while the request was open stands; the agent's does not @rule:status.derived.new-design-stales-older-verdicts`, () => {
  const meanwhile = [
    run('2026-10-07T00:00:00Z', 'walkdown', 'agent'),
    run('2026-10-07T00:00:00Z', 'walkdown', 'topher', 'approved'),
  ];
  const c = cells(blueprint({ runs: meanwhile, threads: [request()] }))['shop.pay.one'];
  // The walk shows the proposal beside the rule, so the person's look was at
  // it; the agent judges against the accepted design until it changes.
  assert.equal(c.human, 'approved');
  assert.equal(c.agent, 'stale');
});

test(`a request accepted with no time on it, or still open, stales nothing @rule:status.derived.new-design-stales-older-verdicts`, () => {
  const silent = request({ verified_at: undefined, replies: [] });
  const open = request({ status: 'open', verified_by: undefined, verified_at: undefined });
  for (const t of [silent, open])
    assert.deepEqual(cells(blueprint({ runs: before, threads: [t] }))['shop.pay.one'], {
      checks: 'pass',
      agent: 'pass',
      human: 'pass',
    });
  // A request verified before verified_at existed is dated by the newest
  // reply its verifier wrote.
  const replied = request({
    verified_at: undefined,
    replies: [
      { author: 'agent', created: '2026-10-06T00:00:00Z', body: 'Drawn.' },
      { author: 'topher', created: '2026-10-10T00:00:00Z', body: 'Accepted.' },
    ],
  });
  assert.equal(
    cells(blueprint({ runs: before, threads: [replied] }))['shop.pay.one'].agent,
    'stale',
  );
});

/*
 * The case that matters most, through the door the panel's Finish uses: the
 * walkdown that approves the last rule on a screen accepts its design, and
 * its acceptance is written a moment after the run. The approvals that
 * accepted it must not read stale for it.
 */
const root = mkdtempSync(join(tmpdir(), 'walkdown-redesign-'));
after(() => rmSync(root, { recursive: true, force: true }));

test(`the approvals that accept a design are not staled by it @rule:status.derived.new-design-stales-older-verdicts`, () => {
  const dir = mkdtempSync(join(root, 'p-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: design-person\n');
  process.env.WALKDOWN_HOME = home;
  const proj = join(dir, 'proj');
  const bp = join(proj, '.walkdown', 'blueprints', '0001-accept');
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'runs'), { recursive: true });
  writeFileSync(join(bp, 'spec.yml'), 'blueprint: accept\n');
  writeFileSync(
    join(bp, 'storyboard.yml'),
    'screens:\n  - id: receipt\n    title: Receipt\n    design: /receipt/20260901.html\n',
  );
  const lines = (id) => [
    `      - id: shop.pay.${id}`,
    `        statement: The ${id} rule holds.`,
    '        verify: [checks]',
    '        signoff: [eng]',
    '        screens: [receipt]',
    '        steps:',
    '          given: [A paid order]',
    '          when: [The receipt is open]',
    '          then: [It shows what it must]',
  ];
  writeFileSync(
    join(bp, 'features', 'pay.yml'),
    [
      'feature: pay',
      'stories:',
      '  - id: shop.pay',
      '    rules:',
      ...lines('one'),
      ...lines('two'),
    ].join('\n'),
  );
  declareProject(home, bp, 'accept');
  const load = () => loadBlueprint(bp, { cwd: proj });
  const { id } = openThread(load(), {
    kind: 'note',
    reason: 'request',
    body: 'Draw the receipt again.',
    anchor: { screen: 'receipt' },
  });
  const file = threadAt(load().at.threads.path, id);
  writeFileSync(file, `${readFileSync(file, 'utf8')}proposes: /receipt/20261010.html\n`);
  const walk = (results) =>
    finishWalkdown(load(), {
      target: 'local',
      baseUrl: null,
      roles: ['eng'],
      signatures: [{ role: 'eng', signer: 'design-person' }],
      results,
    });
  // Over two walks: the first approval is as much the acceptance as the last.
  walk([{ rule: 'shop.pay.one', status: 'approved' }]);
  const out = walk([{ rule: 'shop.pay.two', status: 'approved' }]);
  assert.deepEqual(out.accepted, [id]);
  const t = parse(readFileSync(file, 'utf8'));
  assert.equal(t.status, 'verified');
  // Dated, and dated after the run that accepted it.
  assert.ok(t.verified_at && Date.parse(t.verified_at) >= Date.parse(out.created));

  const rows = deriveStatus(load()).rows;
  for (const r of rows) {
    assert.equal(r.human.state, 'approved', r.rule);
    assert.ok(
      r.acceptance.every((a) => a.state === 'approved'),
      r.rule,
    );
  }
});
