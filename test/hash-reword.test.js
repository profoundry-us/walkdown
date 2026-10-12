/*
 * status.derived.reword-never-adds-an-excuse - `hash --write --reword` keeps
 * every verdict, so it refuses a rule that excuses a tier it did not when it
 * was last stamped, and `hash --write <rule>...` stamps only the rules named.
 * The refusal itself is the hash-reword-adds-excuse scenario; these are the
 * steps around it.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';
import { parse, parseDocument } from '../vendor/yaml.js';

const m = machine();
after(() => m.done());
FIXTURES['g4-reword-adds-excuse'](m);
const file = join(m.specOf('checkout'), 'features', 'checkout.yml');
const rules = () =>
  Object.fromEntries(
    parse(readFileSync(file, 'utf8')).stories[0].rules.map((r) => [r.id.split('.').pop(), r]),
  );

test('the refused rules stamped on their own, a second --reword keeps the reworded rule @rule:status.derived.reword-never-adds-an-excuse', () => {
  const before = rules();
  const totals = before.totals.steps.statement_hash;
  assert.deepEqual(before.totals.steps.excused, ['agent'], 'a stamp records what it excused');

  // Named, only those are stamped: totals is still stale, its hash untouched.
  const named = m.wd([
    'hash',
    '--write',
    'checkout.basics.receipt',
    'checkout.basics.refunds',
    '--blueprint',
    'checkout',
  ]);
  assert.equal(named.status, 0, named.stdout + named.stderr);
  const mid = rules();
  assert.equal(mid.totals.steps.statement_hash, totals);
  assert.deepEqual(mid.receipt.steps.excused, ['agent']);
  assert.deepEqual(mid.refunds.steps.excused, ['agent']);
  assert.equal(mid.receipt.steps.reworded, undefined, 'a plain write keeps no old hash');

  // Run again, the rewording goes through and keeps totals' old hash.
  const again = m.wd(['hash', '--write', '--reword', 'plainer', '--blueprint', 'checkout']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /reworded checkout\.basics\.totals/);
  assert.equal(rules().totals.steps.reworded.at(-1).hash, totals);
});

test('removing an excuse under --reword is allowed, and an unknown rule named is refused @rule:status.derived.reword-never-adds-an-excuse', () => {
  const doc = parseDocument(readFileSync(file, 'utf8'));
  doc.deleteIn(['stories', 0, 'rules', 3, 'unverifiable']);
  writeFileSync(file, String(doc));
  const r = m.wd(['hash', '--write', '--reword', 'the excuse went', '--blueprint', 'checkout']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(rules().totals.steps.excused, undefined, 'nothing excused, nothing recorded');

  const unknown = m.wd(['hash', '--write', 'checkout.basics.nope', '--blueprint', 'checkout']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /No rule "checkout\.basics\.nope"/);
});
