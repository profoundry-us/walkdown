/*
 * `walkdown threads show` reads a redline's Design and Build pair, a dash for
 * a half not given, and says when a note was reopened from one
 * (embed.pin.redline-explains-a-gap, q-0610), on a throwaway machine.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';

const RULE = '@rule:embed.pin.redline-explains-a-gap';
const m = machine();
after(() => m.done());
FIXTURES['g2-receipt-drawn'](m);
m.ok([
  'threads',
  'new',
  '--reason',
  'redline',
  '--screen',
  'receipt',
  '--element',
  'receipt.total',
  '--body',
  'The total sits under the items. It reads better on a phone.',
  '--design',
  'the total above the items',
  '--blueprint',
  'checkout',
]);
// A design half only, as the pin form can file it.

test(`threads show prints a redline's pair, a dash for the half not given ${RULE}`, () => {
  const out = m.wd(['threads', 'show', 'n-0001']).stdout;
  assert.match(out, /^ {2}design {2}the total above the items$/m, out);
  assert.match(out, /^ {2}build {3}—$/m, out);
  assert.doesNotMatch(out, /reopened from a redline/);
  // Closed, as the panel says it - never the store's "recorded".
  assert.match(out, /^n-0001 · note · .* · closed$/m, out);
});

test(`reopened by a person, it says it was a redline and keeps the pair ${RULE}`, () => {
  const r = m.wd([
    'threads',
    'set',
    'n-0001',
    '--reopen',
    '--reason',
    'Does the phone layout still need it?',
    '--blueprint',
    'checkout',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const out = m.wd(['threads', 'show', 'n-0001']).stdout;
  assert.match(out, /^n-0001 · note · feedback · open$/m, out);
  assert.match(out, /^ {2}reopened from a redline$/m, out);
  assert.match(out, /^ {2}design {2}the total above the items$/m, out);
});
