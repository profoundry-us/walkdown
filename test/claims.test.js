/*
 * The cross-blueprint constraint: a page belongs to exactly one blueprint.
 * This is the ledger-law tier, not a browser scenario — no page is involved,
 * only what the set of blueprints claims.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blueprintsForUrl, claimsOf, sharedPages } from '../lib/claims.js';

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
      config: {
        runner: {
          targets: {
            local: { base_url: 'http://localhost:3000' },
            staging: { base_url: 'https://staging.example.com' },
          },
        },
      },
      storyboard: { screens: [{ id: 'home', app: { path: '/index.html' } }] },
    },
  };
  const keys = claimsOf(two.blueprint)
    .map((c) => c.key)
    .sort();
  // One screen, two targets: a blueprint with several targets claims several origins.
  assert.deepEqual(keys, [
    'http://localhost:3000/index.html',
    'https://staging.example.com/index.html',
  ]);
});

test('the same path on two origins is not a collision @rule:screens.ownership.one-claimant', () => {
  const a = bp('a', 'http://localhost:3000', [{ id: 'home', app: { path: '/index.html' } }]);
  const b = bp('b', 'http://localhost:4000', [{ id: 'home', app: { path: '/index.html' } }]);
  assert.deepEqual(sharedPages([a, b]), []);
});

test('two blueprints on one page collide, even under different queries @rule:screens.ownership.one-claimant', () => {
  // The naive check q-0019 warned about: differing queries, same page.
  const a = bp('a', 'http://localhost:3000', [
    { id: 'confirm', app: { path: '/confirm.html?email=x' } },
  ]);
  const b = bp('b', 'http://localhost:3000', [
    { id: 'done', app: { path: '/confirm.html?already=1' } },
  ]);
  const clash = sharedPages([a, b]);
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
  assert.deepEqual(sharedPages([a]), []);
});

test('a url resolves to the blueprints that claim it @rule:screens.ownership.routes-by-page', () => {
  const a = bp('a', 'http://localhost:3000', [{ id: 'home', app: { path: '/index.html' } }]);
  const b = bp('b', 'http://localhost:4310', [{ id: 'admin', app: { path: '/admin.html' } }]);
  assert.deepEqual(blueprintsForUrl([a, b], 'http://localhost:4310/admin.html').map((m) => m.id), ['b']);
  assert.deepEqual(blueprintsForUrl([a, b], 'http://localhost:3000/index.html').map((m) => m.id), ['a']);
  // An address nobody claims is not guessed at.
  assert.deepEqual(blueprintsForUrl([a, b], 'http://elsewhere.test/page'), []);
});

test('two blueprints claiming one page both answer, and neither is preferred @rule:screens.ownership.routes-by-page', () => {
  /*
   * The case the one-claimant constraint forbade until 2026-09-09: two efforts
   * about different functionality of one page (ADR 0001). What used to happen
   * was worse than an error - the longer path won, silently.
   */
  const a = bp('a', 'http://localhost:3000', [{ id: 'home', app: { path: '/' } }]);
  const b = bp('b', 'http://localhost:3000', [{ id: 'hero-test', app: { path: '/' } }]);
  assert.deepEqual(blueprintsForUrl([a, b], 'http://localhost:3000/').map((m) => m.id), ['a', 'b']);
  assert.deepEqual(sharedPages([a, b]).map((x) => x.key), ['http://localhost:3000/']);
});

test('an enumerated fragment beats the page it lives on @rule:screens.ownership.routes-by-page', () => {
  const a = bp('a', 'http://localhost:3000', [
    { id: 'admin', app: { path: '/admin.html' } },
    { id: 'batch', app: { path: '/admin.html#invite-batch' } },
  ]);
  // Ranking survives INSIDE a blueprint - it is how a screen is identified -
  // and is abandoned across them (ADR 0001).
  assert.equal(
    blueprintsForUrl([a], 'http://localhost:3000/admin.html#invite-batch')[0].screen,
    'batch',
  );
  assert.equal(blueprintsForUrl([a], 'http://localhost:3000/admin.html')[0].screen, 'admin');
});
