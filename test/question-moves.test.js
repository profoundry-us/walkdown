/*
 * A question moved onto the rule written from its answer, answered by
 * approving that rule, and lint refusing one left behind
 * (threads.lifecycle.question-moves-to-its-rule,
 * threads.lifecycle.approval-answers-a-moved-question,
 * threads.lifecycle.no-question-asked-twice), each on a throwaway machine.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';
import { parse } from '../vendor/yaml.js';

const machines = [];
after(() => {
  for (const m of machines) m.done();
});
const fresh = (fixture) => {
  const m = machine();
  machines.push(m);
  FIXTURES[fixture](m);
  return m;
};
const thread = (m, id) => {
  const dir = join(m.specOf('checkout'), 'threads');
  return readdirSync(dir)
    .map((f) => parse(readFileSync(join(dir, f), 'utf8')))
    .find((t) => t.id === id);
};
const set = (m, ...args) => m.wd(['threads', 'set', ...args, '--blueprint', 'checkout']);

/* A walk finished the way the panel finishes one. */
function walk(m, { results, signatures = [{ role: 'product', signer: 'topher' }] }) {
  const lib = (f) => JSON.stringify(new URL(`../lib/${f}`, import.meta.url).href);
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { finishWalkdown } = await import(${lib('writes.js')});
       const { loadBlueprint } = await import(${lib('blueprint.js')});
       const out = finishWalkdown(loadBlueprint(${JSON.stringify(m.specOf('checkout'))}), {
         target: 'local', baseUrl: null, roles: ${JSON.stringify(signatures.map((s) => s.role))},
         signatures: ${JSON.stringify(signatures)}, results: ${JSON.stringify(results)},
       });
       console.log(JSON.stringify(out.answered));`,
    ],
    { cwd: m.shop, env: m.env, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const MOVES = '@rule:threads.lifecycle.question-moves-to-its-rule';
const ANSWERS = '@rule:threads.lifecycle.approval-answers-a-moved-question';
const TWICE = '@rule:threads.lifecycle.no-question-asked-twice';

/* One machine for the move and the approval after it: each test builds on the last. */
const shop = fresh('g5-question-written-as');

test(`a move onto a retired, unknown or the same rule is refused, and nothing is written ${MOVES}`, () => {
  const m = shop;
  const before = JSON.stringify(thread(m, 'q-0002'));
  const retired = set(m, 'q-0002', '--written-as', 'checkout.cart.coupons');
  assert.equal(retired.status, 2);
  assert.match(
    retired.stderr,
    /^checkout\.cart\.coupons is retired, so no question can move onto it\. Its note: Folded into checkout\.cart\.discounts\.$/m,
  );
  assert.match(
    retired.stderr,
    /^Move it onto the rule that carries the answer now, such as checkout\.cart\.discounts\.$/m,
  );
  assert.match(
    retired.stderr,
    /^Nothing was changed\. q-0002 is still open on checkout\.cart\.add\.$/m,
  );
  for (const [to, said] of [
    ['checkout.cart.nope', /No rule checkout\.cart\.nope/],
    ['checkout.cart.add', /q-0002 is already on checkout\.cart\.add/],
  ]) {
    const r = set(m, 'q-0002', '--written-as', to);
    assert.equal(r.status, 2, to);
    assert.match(r.stderr, said);
  }
  assert.equal(JSON.stringify(thread(m, 'q-0002')), before);
});

test(`the question moves, keeps where it was asked, stays open, and a reply says so ${MOVES}`, () => {
  const m = shop;
  const r = set(m, 'q-0001', '--written-as', 'checkout.cart.empty', '--as-agent');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^✓ q-0001 still open · by agent · \+1 reply$/m);
  const t = thread(m, 'q-0001');
  assert.equal(t.anchor.rule, 'checkout.cart.empty');
  assert.equal(t.asked_on, 'checkout.cart.add');
  assert.equal(t.status, 'open');
  assert.equal(t.replies.at(-1).author, 'agent');
  const shown = m.wd(['threads', 'show', 'q-0001']);
  assert.match(shown.stdout, /rule checkout\.cart\.empty/);
  assert.match(shown.stdout, /asked on rule checkout\.cart\.add/);
  // A note, not a question, is refused.
  m.ok([
    'threads',
    'new',
    '--rule',
    'checkout.cart.add',
    '--body',
    'A note.',
    '--blueprint',
    'checkout',
  ]);
  const note = set(m, 'n-0003', '--written-as', 'checkout.cart.empty');
  assert.equal(note.status, 2);
  assert.match(note.stderr, /not an open question/);
});

test(`approving the rule answers the moved question and nothing else ${ANSWERS}`, () => {
  const m = shop; // q-0001 moved onto checkout.cart.empty by the test above
  m.ok([
    'threads',
    'new',
    '--kind',
    'question',
    '--rule',
    'checkout.cart.empty',
    '--body',
    'Should the empty cart suggest items?',
    '--option',
    'Yes :: three',
    '--option',
    'No :: nothing',
    '--blueprint',
    'checkout',
  ]);
  m.ok([
    'threads',
    'new',
    '--rule',
    'checkout.cart.empty',
    '--body',
    'A note.',
    '--blueprint',
    'checkout',
  ]);

  // While the rule waits on its approval, the moved question is not asked
  // again; the one asked on the rule in the first place still is.
  const owed = m.wd(['status', '--blueprint', 'checkout']).stdout;
  assert.doesNotMatch(owed, /◆ answer .*q-0001/, owed);
  assert.match(owed, /◆ answer checkout\.cart\.empty — 1 question \(q-0004\)/, owed);

  // Unsigned, or a refinement, answers nothing.
  assert.deepEqual(
    walk(m, { results: [{ rule: 'checkout.cart.empty', status: 'approved' }], signatures: [] }),
    [],
  );
  assert.deepEqual(walk(m, { results: [{ rule: 'checkout.cart.empty', status: 'refining' }] }), []);
  assert.equal(thread(m, 'q-0001').status, 'open');

  assert.deepEqual(walk(m, { results: [{ rule: 'checkout.cart.empty', status: 'approved' }] }), [
    'q-0001',
  ]);
  const q = thread(m, 'q-0001');
  assert.equal(q.status, 'incorporated');
  assert.equal(q.incorporated_by, 'topher');
  assert.deepEqual(q.answered_by.roles, ['product']);
  assert.equal(q.replies.at(-1).via, 'walkdown');
  // Asked on the rule in the first place: not answered by approving its words.
  assert.equal(thread(m, 'q-0004').status, 'open');
  assert.equal(thread(m, 'n-0005').status, 'open');
});

test(`lint refuses a question left where it was asked, and is quiet once it moves ${TWICE}`, () => {
  const m = fresh('g5-question-asked-twice');
  const before = m.wd(['lint', '--blueprint', 'checkout']);
  assert.equal(before.status, 1);
  assert.match(
    before.stdout,
    /q-0001: open on checkout\.cart\.add, but checkout\.cart\.empty was written/,
  );
  assert.doesNotMatch(before.stdout, /q-0002:/);
  set(m, 'q-0001', '--written-as', 'checkout.cart.empty');
  const afterwards = m.wd(['lint', '--blueprint', 'checkout']);
  assert.equal(afterwards.status, 0, afterwards.stdout);
  assert.doesNotMatch(afterwards.stdout, /asked twice|ask it twice/);
});

test(`one answer written as two rules: on either, lint does not ask it twice ${TWICE}`, () => {
  const m = fresh('g5-question-asked-twice');
  // checkout.cart.totals is written from q-0001's answer too.
  const file = join(m.specOf('checkout'), 'features', 'checkout.yml');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('origin: thread:q-0002', 'origin: thread:q-0001'),
  );
  m.ok(['hash', '--write', '--blueprint', 'checkout']);
  const before = m.wd(['lint', '--blueprint', 'checkout']);
  assert.equal((before.stdout.match(/ask it twice/g) ?? []).length, 2, before.stdout);
  set(m, 'q-0001', '--written-as', 'checkout.cart.empty');
  const afterwards = m.wd(['lint', '--blueprint', 'checkout']);
  assert.doesNotMatch(afterwards.stdout, /ask it twice/);
});

test(`a question asked on a screen moves too, and keeps the screen as where it was asked ${MOVES}`, () => {
  const m = fresh('g5-question-written-as');
  m.ok([
    'threads',
    'new',
    '--kind',
    'question',
    '--screen',
    'cart',
    '--element',
    'cart.checkout',
    '--body',
    'Should the button hide when the cart is empty?',
    '--blueprint',
    'checkout',
  ]);
  const r = set(m, 'q-0003', '--written-as', 'checkout.cart.empty');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /asked on screen cart, now on rule checkout\.cart\.empty/);
  assert.equal(thread(m, 'q-0003').asked_on, 'screen cart');
});
