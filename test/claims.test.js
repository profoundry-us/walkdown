/*
 * The cross-blueprint constraint: a page belongs to exactly one blueprint.
 * This is the ledger-law tier, not a browser scenario — no page is involved,
 * only what the set of blueprints claims.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blueprintForUrl, claimsOf, findCollisions } from '../lib/claims.js';

const bp = (id, base, screens) => ({
  id,
  blueprint: {
    config: { runner: { targets: { local: { base_url: base } } } },
    storyboard: { screens },
  },
});

test('a claim is an origin plus a path, one per target @rule:screens.ownership.one-claimant', () => {
  const two = {
    id: 'a',
    blueprint: {
      config: { runner: { targets: { local: { base_url: 'http://localhost:3000' },
                                     staging: { base_url: 'https://staging.example.com' } } } },
      storyboard: { screens: [{ id: 'home', app: { path: '/index.html' } }] },
    },
  };
  const keys = claimsOf(two.blueprint).map((c) => c.key).sort();
  // One screen, two targets: a blueprint with several targets claims several origins.
  assert.deepEqual(keys, ['http://localhost:3000/index.html', 'https://staging.example.com/index.html']);
});

test('the same path on two origins is not a collision @rule:screens.ownership.one-claimant', () => {
  const a = bp('a', 'http://localhost:3000', [{ id: 'home', app: { path: '/index.html' } }]);
  const b = bp('b', 'http://localhost:4000', [{ id: 'home', app: { path: '/index.html' } }]);
  assert.deepEqual(findCollisions([a, b]), []);
});

test('two blueprints on one page collide, even under different queries @rule:screens.ownership.one-claimant', () => {
  // The naive check q-0019 warned about: differing queries, same page.
  const a = bp('a', 'http://localhost:3000', [{ id: 'confirm', app: { path: '/confirm.html?email=x' } }]);
  const b = bp('b', 'http://localhost:3000', [{ id: 'done', app: { path: '/confirm.html?already=1' } }]);
  const clash = findCollisions([a, b]);
  assert.equal(clash.length, 1);
  assert.equal(clash[0].key, 'http://localhost:3000/confirm.html');
  assert.deepEqual(clash[0].claimants.map((c) => c.blueprint).sort(), ['a', 'b']);
});

test('one blueprint claiming a page twice is its own business @rule:screens.ownership.one-claimant', () => {
  // Two states of one page inside one project is exactly what queries are for.
  const a = bp('a', 'http://localhost:3000', [
    { id: 'confirm', app: { path: '/confirm.html?email=x' } },
    { id: 'already', app: { path: '/confirm.html?already=1' } },
  ]);
  assert.deepEqual(findCollisions([a]), []);
});

test('a url resolves to the blueprint that claims it @rule:screens.ownership.routes-by-page', () => {
  const a = bp('a', 'http://localhost:3000', [{ id: 'home', app: { path: '/index.html' } }]);
  const b = bp('b', 'http://localhost:4310', [{ id: 'admin', app: { path: '/admin.html' } }]);
  assert.equal(blueprintForUrl([a, b], 'http://localhost:4310/admin.html')?.id, 'b');
  assert.equal(blueprintForUrl([a, b], 'http://localhost:3000/index.html')?.id, 'a');
  // An address nobody claims is not guessed at.
  assert.equal(blueprintForUrl([a, b], 'http://elsewhere.test/page'), null);
});

test('an enumerated fragment beats the page it lives on @rule:screens.ownership.routes-by-page', () => {
  const a = bp('a', 'http://localhost:3000', [
    { id: 'admin', app: { path: '/admin.html' } },
    { id: 'batch', app: { path: '/admin.html#invite-batch' } },
  ]);
  assert.equal(blueprintForUrl([a], 'http://localhost:3000/admin.html#invite-batch')?.screen, 'batch');
  assert.equal(blueprintForUrl([a], 'http://localhost:3000/admin.html')?.screen, 'admin');
});
