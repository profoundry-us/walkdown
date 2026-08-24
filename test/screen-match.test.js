import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationOfUrl, matchScreen, screenKey, splitScreenRef } from '../lib/screen-match.js';

const at = (url) => locationOfUrl('http://localhost:4310' + url);

const SCREENS = [
  { id: 'admin', prototype: '/screens/waitlist-admin.html', app: { path: '/admin.html' } },
  {
    id: 'admin-invite',
    prototype: '/screens/waitlist-admin.html#invite-batch',
    app: { path: '/admin.html#invite-batch' },
  },
  { id: 'confirm', app: { path: '/confirm.html?email=you@example.com' } },
  { id: 'already', app: { path: '/confirm.html?email=you@example.com&already=1' } },
  { id: 'orders', app: { path: '/orders' } },
];

test('a fragment is part of a screen’s identity @rule:screens.identity.fragment-is-identity', () => {
  assert.equal(matchScreen(SCREENS, at('/admin.html')).screen.id, 'admin');
  assert.equal(matchScreen(SCREENS, at('/admin.html#invite-batch')).screen.id, 'admin-invite');
});

test('an unenumerated fragment falls back to the screen at that path @rule:screens.identity.fragment-is-identity', () => {
  // The SPA case: /orders is on the storyboard, its routes are not yet.
  assert.equal(matchScreen(SCREENS, at('/orders#/order/1234')).screen.id, 'orders');
});

test('a declared query breaks ties between screens sharing a path @rule:screens.identity.query-is-not-identity', () => {
  assert.equal(matchScreen(SCREENS, at('/confirm.html?email=you@example.com')).screen.id, 'confirm');
  assert.equal(
    matchScreen(SCREENS, at('/confirm.html?email=you@example.com&already=1')).screen.id,
    'already'
  );
});

test('an undeclared query does not change which screen you are on @rule:screens.identity.query-is-not-identity', () => {
  assert.equal(matchScreen(SCREENS, at('/admin.html?page=2')).screen.id, 'admin');
  assert.equal(matchScreen(SCREENS, at('/admin.html?page=2#invite-batch')).screen.id, 'admin-invite');
});

test('the prototype surface is reported as the prototype', () => {
  assert.equal(matchScreen(SCREENS, at('/prototype/screens/waitlist-admin.html')).surface, 'prototype');
  assert.equal(matchScreen(SCREENS, at('/admin.html')).surface, 'app');
});

test('a location off the storyboard matches nothing', () => {
  assert.equal(matchScreen(SCREENS, at('/nowhere.html')), null);
});

test('a ref splits into path, query and fragment; the fragment wins at the first #', () => {
  assert.deepEqual(splitScreenRef('/orders?tab=open#/order/1?zoom=2'), {
    path: '/orders',
    query: '?tab=open',
    fragment: '#/order/1?zoom=2',
  });
  assert.equal(screenKey('/confirm.html?email=a@b.c'), '/confirm.html');
  assert.equal(screenKey('/admin.html#invite-batch'), '/admin.html#invite-batch');
});

test('the browser copies of the matcher have not drifted @rule:screens.identity.one-matcher', () => {
  // The two browser files ship self-contained and cannot import the module, so
  // the only thing keeping three programs answering alike is that their copies
  // are generated. This is that guarantee, enforced.
  const sync = spawnSync('node', ['tools/sync-shared.mjs', '--check'], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
  });
  assert.equal(sync.status, 0, sync.stderr || sync.stdout);
});
