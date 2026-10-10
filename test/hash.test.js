import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize, formatHash, hashMatches, statementHash } from '../lib/hash.js';

test('canonicalize collapses whitespace and trims', () => {
  assert.equal(
    canonicalize('  A visitor\n  must provide\ta valid email.  '),
    'A visitor must provide a valid email.',
  );
});

test('folded YAML and single-line statements hash identically', () => {
  const oneLine = 'After submitting, the visitor sees a confirmation.';
  const folded = 'After submitting,\nthe visitor sees\na confirmation.\n';
  assert.equal(statementHash(oneLine), statementHash(folded));
});

test('formatHash produces sha256: prefix with 12 hex chars by default', () => {
  const h = formatHash('anything');
  assert.match(h, /^sha256:[0-9a-f]{12}$/);
});

test('hashMatches accepts truncated hashes with or without prefix', () => {
  const s = 'A visitor must provide a valid email address before joining the waitlist.';
  const full = statementHash(s);
  assert.ok(hashMatches(`sha256:${full.slice(0, 12)}`, s));
  assert.ok(hashMatches(full.slice(0, 16), s));
  assert.ok(hashMatches(full, s));
});

test('hashMatches rejects wrong, short, and malformed hashes', () => {
  const s = 'Some statement.';
  assert.equal(hashMatches('sha256:deadbeef0000', s), false);
  assert.equal(hashMatches('sha256:abc', s), false); // under 8 chars
  assert.equal(hashMatches('not-a-hash', s), false);
  assert.equal(hashMatches(null, s), false);
});

/*
 * A rule's focus says where opening it takes the panel, not what it says, so
 * moving it never makes a verdict stale (ADR 0016).
 */
test('a rule hashes the same whatever its focus @rule:panel.rules.opens-at-its-focus', () => {
  const rule = {
    statement: 'A declined card says so.',
    steps: { given: ['A card the bank declines'], when: ['Pay'], then: ['It says so'] },
  };
  const before = formatHash(rule);
  assert.equal(formatHash({ ...rule, focus: 'pay.decline-banner' }), before);
  assert.equal(formatHash({ ...rule, focus: 'pay-error.message' }), before);
});
