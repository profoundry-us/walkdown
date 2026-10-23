/*
 * status.derived.a-change-says-why - a signed rule whose words changed is
 * stamped only with a reason. The refusal itself is the hash-change-says-why
 * scenario; these are the steps after it: --changed keeps the reason on the
 * rule and stales the signature, --reword keeps the signature.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';
import { parse } from '../vendor/yaml.js';

function signed() {
  const m = machine();
  FIXTURES['g4-change-says-why'](m);
  const file = join(m.specOf('checkout'), 'features', 'checkout.yml');
  const receipt = () => parse(readFileSync(file, 'utf8')).stories[0].rules[1];
  const eng = () => {
    const out = m.wd(['status', '--json', '--blueprint', 'checkout']);
    const json = JSON.parse(out.stdout);
    const row = (json.rows ?? json.blueprints[0].rows).find(
      (r) => r.rule === 'checkout.basics.receipt',
    );
    return row.acceptance.find((a) => a.role === 'eng');
  };
  return { m, receipt, eng };
}

const machines = [];
after(() => {
  for (const m of machines) m.done();
});

test('--changed stamps the rule and keeps the hash it replaced, with the why and a UTC instant; the signature reads stale @rule:status.derived.a-change-says-why', () => {
  const { m, receipt, eng } = signed();
  machines.push(m);
  const was = receipt().steps.statement_hash;
  const r = m.wd([
    'hash',
    '--write',
    '--changed',
    'A receipt names what was bought.',
    'checkout.basics.receipt',
    '--blueprint',
    'checkout',
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const kept = receipt().steps.changed;
  assert.equal(kept.length, 1);
  assert.equal(kept[0].hash, was);
  assert.equal(kept[0].why, 'A receipt names what was bought.');
  assert.match(kept[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'a UTC instant');
  assert.notEqual(receipt().steps.statement_hash, was);
  assert.equal(eng().state, 'stale');
});

test('--reword keeps the signature standing, as before @rule:status.derived.a-change-says-why', () => {
  const { m, receipt, eng } = signed();
  machines.push(m);
  const r = m.wd([
    'hash',
    '--write',
    '--reword',
    'plainer',
    'checkout.basics.receipt',
    '--blueprint',
    'checkout',
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(receipt().steps.changed, undefined);
  assert.notEqual(eng().state, 'stale');
});

test('--changed takes a reason, goes with --write, and is not given with --reword @rule:status.derived.a-change-says-why', () => {
  const { m, receipt } = signed();
  machines.push(m);
  const was = receipt().steps.statement_hash;
  for (const args of [
    ['hash', '--changed', 'why', '--blueprint', 'checkout'],
    ['hash', '--write', '--changed', ' ', '--blueprint', 'checkout'],
    ['hash', '--write', '--changed', 'why', '--reword', 'why', '--blueprint', 'checkout'],
  ]) {
    const r = m.wd(args);
    assert.equal(r.status, 2, args.join(' '));
  }
  assert.equal(receipt().steps.statement_hash, was, 'nothing written');
});
