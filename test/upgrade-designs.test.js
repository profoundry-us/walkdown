/*
 * ADR 0015 §2 - `walkdown upgrade` moves every blueprint's designs from
 * screens/, drafts/ and proposals/ into a folder per screen of dated
 * versions, on a throwaway machine of its own (tools/cli-scenarios.mjs).
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';
import { parse } from '../vendor/yaml.js';

const m = machine();
after(() => m.done());
FIXTURES['g2-old-prototypes'](m);

const threadsOf = (name) => {
  const dir = join(m.specOf(name), 'threads');
  return readdirSync(dir).map((f) => ({
    file: join(dir, f),
    data: parse(readFileSync(join(dir, f), 'utf8')),
  }));
};

test('the dry run moves nothing @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const r = m.wd(['upgrade', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(m.shop, 'prototype', 'screens', 'cart.html')));
  assert.ok(!existsSync(join(m.shop, 'designs')));
  assert.ok(existsSync(join(m.shop, 'as-built', 'redlines.json')));
});

test('upgrade moves each design into a dated version of its screen, and repoints the records @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const before = readFileSync(join(m.specOf('checkout'), 'storyboard.yml'), 'utf8');
  const r = m.wd(['upgrade']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = (...p) => join(m.shop, 'designs', ...p);

  // Accepted versions, dated by first commit; a same-day proposal is -v2.
  for (const f of [
    'cart/20260918.html',
    'payment/20260918.html',
    'receipt/20260921.html',
    'results/20260925.html',
  ])
    assert.ok(existsSync(d(f)), f);
  assert.ok(existsSync(d('receipt', '20260921-v2.html')));
  assert.ok(existsSync(d('shipping', '20261006.html')));

  // The storyboard: design keys, pointed at the accepted versions, nothing else touched.
  const board = readFileSync(join(m.specOf('checkout'), 'storyboard.yml'), 'utf8');
  assert.match(board, /^ {4}design: \/cart\/20260918\.html$/m);
  assert.match(board, /^ {4}design: null$/m);
  assert.doesNotMatch(board, /prototype:/);
  assert.equal(board.replace(/design: \S+/g, ''), before.replace(/prototype: \S+/g, ''));

  // spec.yml: the root renamed.
  const spec = parse(readFileSync(join(m.specOf('checkout'), 'spec.yml'), 'utf8'));
  assert.equal(spec.design?.root, 'designs/');
  assert.equal(spec.prototype, undefined);

  // Each pending request names its proposed version.
  const requests = threadsOf('checkout').filter((t) => t.data.reason === 'request');
  assert.deepEqual(requests.map((t) => [t.data.anchor.screen, t.data.proposes]).sort(), [
    ['receipt', '/receipt/20260921-v2.html'],
    ['shipping', '/shipping/20261006.html'],
  ]);

  // Leftovers: removed if git holds them, kept and named if not.
  assert.ok(!existsSync(join(m.shop, 'prototype')));
  assert.ok(!existsSync(join(m.shop, 'proposals', 'payment-sketch.html')));
  assert.ok(existsSync(join(m.shop, 'proposals', 'payment-notes.html')));
  assert.match(r.stdout, /! proposals\/payment-notes\.html KEPT/);

  // Redlines: closed threads in the person's name, and the file gone.
  const redlines = threadsOf('checkout').filter((t) => t.data.reason === 'redline');
  assert.deepEqual(redlines.map((t) => t.data.anchor.screen).sort(), ['cart', 'receipt']);
  for (const t of redlines) {
    assert.equal(t.data.status, 'recorded');
    assert.equal(t.data.author, 'topher');
  }
  assert.equal(
    redlines.find((t) => t.data.anchor.screen === 'cart').data.anchor.element,
    'cart.total',
  );
  assert.ok(!existsSync(join(m.shop, 'as-built', 'redlines.json')));

  // The panel's reading of it: accepted beside proposed, both served from designs/.
  const status = m.wd(['lint', '--no-checks', '--blueprint', 'checkout']);
  assert.doesNotMatch(status.stdout, /✗/, status.stdout);
});

test('run again, the upgrade finds nothing to do @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const r = m.wd(['upgrade']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nothing to upgrade/);
});
