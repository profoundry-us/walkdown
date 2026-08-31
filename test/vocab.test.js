/*
 * The vocabulary's internal guarantees. Untagged on purpose: that walkdown's
 * two runtimes read one vocabulary is an engineering invariant nobody outside
 * the codebase could notice (blueprint/AGENTS.md routes those away from the
 * ledger) — the rules these terms power are claimed by the thread-lifecycle
 * and status tests, which exercise them through real behaviour.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTransition,
  FLOWS,
  HUMAN_ONLY,
  NEEDS_REASON,
  RESULT_STATUSES,
  ROLES,
  statusesFor,
  TERMINAL,
  THREAD_KINDS,
  threadPrefix,
  TIERS,
} from '../lib/vocab.js';

test('terminal is derived from the flows, so the two cannot disagree', () => {
  // Four hand-written copies of this list existed before vocab.js, in three
  // orderings. The derivation is the fix: a status is terminal exactly when
  // its flow offers nowhere to go.
  assert.deepEqual([...TERMINAL].sort(), ['incorporated', 'verified', 'waived']);
  for (const status of TERMINAL)
    for (const flow of Object.values(FLOWS))
      assert.deepEqual(flow[status] ?? [], [], `${status} must offer no exit`);
});

test('canTransition answers exactly what the flows table says', () => {
  for (const [kind, flow] of Object.entries(FLOWS))
    for (const from of Object.keys(flow))
      for (const to of [...Object.keys(flow), 'nonsense'])
        assert.equal(canTransition(kind, from, to), flow[from].includes(to), `${kind}: ${from} → ${to}`);
  // An unknown kind falls back to the note flow, matching the enforcement
  // in threads.js — old threads written before `kind` was required.
  assert.equal(canTransition('mystery', 'open', 'addressed'), true);
});

test('every kind has its statuses, and each set is closed over its own flow', () => {
  for (const kind of THREAD_KINDS) {
    const statuses = statusesFor(kind);
    for (const [from, nexts] of Object.entries(FLOWS[kind])) {
      assert.ok(statuses.includes(from));
      for (const to of nexts) assert.ok(statuses.includes(to), `${kind}.${from} → ${to} leaves the set`);
    }
  }
});

test('the guarded lists are subsets of real statuses, and everything is frozen', () => {
  const all = new Set(THREAD_KINDS.flatMap((k) => statusesFor(k)));
  for (const s of [...HUMAN_ONLY, ...NEEDS_REASON]) assert.ok(all.has(s), s);
  for (const list of [THREAD_KINDS, TERMINAL, HUMAN_ONLY, NEEDS_REASON, TIERS, ROLES, RESULT_STATUSES])
    assert.ok(Object.isFrozen(list), 'a vocabulary a caller can push() into is not a vocabulary');
  assert.ok(Object.isFrozen(FLOWS) && Object.isFrozen(FLOWS.note.open));
});

test('thread prefixes: q for questions, n for everything else', () => {
  assert.equal(threadPrefix('question'), 'q');
  assert.equal(threadPrefix('note'), 'n');
});
