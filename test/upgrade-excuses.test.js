/*
 * locations.keeping.upgrade-records-excuses - `walkdown upgrade` records on
 * each old stamp the tiers its rule excuses, so `hash --reword` can tell an
 * excuse kept from one added, on a throwaway machine of its own.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';
import { parse } from '../vendor/yaml.js';

const m = machine();
after(() => m.done());
FIXTURES['g2-old-excuses'](m);

const file = () => join(m.specOf('checkout'), 'features', 'checkout.yml');
const rules = () =>
  Object.fromEntries(
    parse(readFileSync(file(), 'utf8')).stories.flatMap((s) => s.rules.map((r) => [r.id, r])),
  );

test('the dry run names the excused rules and writes nothing @rule:locations.keeping.upgrade-records-excuses', () => {
  const before = readFileSync(file(), 'utf8');
  const r = m.wd(['upgrade', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /checkout\.payment\.declined-card +would record: agent/);
  assert.match(r.stdout, /checkout\.receipt\.email +would record: agent/);
  assert.doesNotMatch(r.stdout, /checkout\.cart\.add/);
  assert.equal(readFileSync(file(), 'utf8'), before);
});

test('--layout-only leaves the stamps alone @rule:locations.keeping.upgrade-records-excuses', () => {
  const before = readFileSync(file(), 'utf8');
  const r = m.wd(['upgrade', '--layout-only']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(file(), 'utf8'), before);
});

test('the upgrade records the tiers, stale or current, and changes no hash @rule:locations.keeping.upgrade-records-excuses', () => {
  const was = rules();
  const r = m.wd(['upgrade']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ checkout\.payment\.declined-card +recorded: agent/);
  assert.match(r.stdout, /No hash changed, so no verdict went stale\./);
  assert.match(r.stdout, /Upgraded 1 blueprint\. Run again, it finds nothing to do\./);
  const now = rules();
  for (const id of ['checkout.payment.declined-card', 'checkout.receipt.email']) {
    assert.deepEqual(now[id].steps.excused, ['agent'], id);
    assert.equal(now[id].steps.statement_hash, was[id].steps.statement_hash, id);
  }
  assert.deepEqual(now['checkout.cart.add'], was['checkout.cart.add']);
});

test('afterwards hash --reword rewords both excused rules, and the upgrade finds nothing @rule:locations.keeping.upgrade-records-excuses', () => {
  const r = m.wd([
    'hash',
    '--write',
    '--reword',
    'the excuse joined the hash',
    '--blueprint',
    'checkout',
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /excused nothing/);
  assert.ok(rules()['checkout.receipt.email'].steps.reworded?.length);
  const again = m.wd(['upgrade']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Nothing to upgrade/);
});
