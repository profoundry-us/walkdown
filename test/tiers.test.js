/*
 * The evidence ladder's own arithmetic: which tiers a rule asks for, why one is
 * missing when it is, and who has to accept the result.
 *
 * These are ledger laws, so they live here rather than in checks/ - nothing a
 * browser can see is involved. What the PANEL draws for an excused tier, and
 * what its Settings offers for roles, are claims about the panel and belong in
 * checks/ under panel.* ids; deriving the right answer is not the same as
 * drawing it (thread q-0070).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { excuseFor, signoffList, verifyList } from '../lib/blueprint.js';
import { TIERS } from '../lib/vocab.js';

const EXCUSE = 'The control is the browser toolbar, which no tool an agent drives can reach.';

test('the agent tier is assumed, and only an excuse removes it @rule:status.evidence.agent-assumed', () => {
  /*
   * A rule that says nothing about verification still owes an agent
   * walkdown. This is the whole inversion: the old default handed a silent
   * rule the cheapest tier and skipping the agent cost nothing, so it
   * happened by omission rather than by decision.
   */
  assert.deepEqual(verifyList({ id: 'demo.silent' }), ['agent']);

  // `checks` must be AUTHORED, so it stays opt-in - a check is engineering
  // work somebody schedules and reviews, and a walkdown is only a run.
  assert.deepEqual(verifyList({ verify: ['checks'] }), ['checks', 'agent']);
  assert.deepEqual(verifyList({ verify: 'checks' }), ['checks', 'agent']);

  // Saying `agent` out loud is redundant, never wrong - and never doubled.
  assert.deepEqual(verifyList({ verify: ['agent'] }), ['agent']);

  // The tier vocabulary is the two of them. `human` is not a tier any more.
  assert.deepEqual(TIERS, ['checks', 'agent']);
});

test('an excuse removes the tier it names, and says why @rule:status.evidence.excuse-says-why', () => {
  const rule = { id: 'demo.toolbar', unverifiable: { agent: EXCUSE } };
  assert.deepEqual(verifyList(rule), []);
  assert.equal(excuseFor(rule, 'agent'), EXCUSE);
  assert.equal(excuseFor(rule, 'checks'), null);

  // An excuse beats a declaration, because it is the more specific statement:
  // a rule that asks for checks and then says it cannot have them is telling
  // you the second thing.
  const both = { verify: ['checks'], unverifiable: { checks: EXCUSE, agent: EXCUSE } };
  assert.deepEqual(verifyList(both), []);

  // A blank excuse is not an excuse. Nothing is removed on the strength of a
  // key with nothing behind it - the tier stays owed and lint complains.
  const blank = { unverifiable: { agent: '   ' } };
  assert.equal(excuseFor(blank, 'agent'), null);
  assert.deepEqual(verifyList({ id: 'x', verify: ['checks'] }), ['checks', 'agent']);
});

test('engineering always signs, whatever the file says @rule:status.acceptance.signoff-defaults-to-eng', () => {
  // The default. Somebody has to own that the thing was built right.
  assert.deepEqual(signoffList({ id: 'demo.plain' }), ['eng']);

  // Declared order is kept, because the report draws a fixed slot per role
  // and a list that reshuffles itself is a list nobody can read at a glance.
  assert.deepEqual(signoffList({ signoff: ['eng', 'product'] }), ['eng', 'product']);
  assert.deepEqual(signoffList({ signoff: ['product', 'eng'] }), ['product', 'eng']);

  // And a list that forgot eng gets it anyway, at the front - a rule nobody
  // accepts is a rule nobody owns (docs/00-vision.md, problem 7).
  assert.deepEqual(signoffList({ signoff: ['product'] }), ['eng', 'product']);
  assert.deepEqual(signoffList({ signoff: 'product' }), ['eng', 'product']);
  assert.deepEqual(signoffList({ signoff: [] }), ['eng']);
});
