import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
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
  assert.equal(
    matchScreen(SCREENS, at('/confirm.html?email=you@example.com')).screen.id,
    'confirm',
  );
  assert.equal(
    matchScreen(SCREENS, at('/confirm.html?email=you@example.com&already=1')).screen.id,
    'already',
  );
});

test('an undeclared query does not change which screen you are on @rule:screens.identity.query-is-not-identity', () => {
  assert.equal(matchScreen(SCREENS, at('/admin.html?page=2')).screen.id, 'admin');
  assert.equal(
    matchScreen(SCREENS, at('/admin.html?page=2#invite-batch')).screen.id,
    'admin-invite',
  );
});

test('the prototype surface is reported as the prototype', () => {
  assert.equal(
    matchScreen(SCREENS, at('/prototype/screens/waitlist-admin.html')).surface,
    'prototype',
  );
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

test('the panel and the embed take the matcher from the module, never a copy @rule:screens.identity.one-matcher', () => {
  // The browser files are BUILT now, so "the copies have not drifted" became
  // "there are no copies": both sources import lib/screen-match.js and rollup
  // inlines it. This asserts the construction - a hand-written matcher
  // reappearing in either source is the drift coming back - and the built
  // bundles being current is highball's panel-built/embed-built check.
  const root = new URL('..', import.meta.url).pathname;
  for (const entry of ['src/panel/app.js', 'src/embed/index.js']) {
    const src = readFileSync(join(root, entry), 'utf8');
    assert.match(
      src,
      /from '\.\.\/\.\.\/lib\/screen-match\.js'/,
      `${entry} imports the one matcher`,
    );
    assert.ok(!/function matchScreen/.test(src), `${entry} carries its own matcher`);
  }
});

/*
 * One implementation, two deliveries. The panel and the embed each ship as a
 * single self-contained file down two paths - a script tag from the server and
 * a vendored copy inside the extension - and the copy is the half that can
 * silently rot: an extension running yesterday's build looks exactly like the
 * build working.
 */
test('the extension ships the same panel and embed the server does @rule:panel.delivery.one-implementation', () => {
  const root = new URL('../', import.meta.url).pathname;
  for (const file of ['panel.js', 'embed.js']) {
    const shipped = readFileSync(join(root, 'lib', 'viewer', file), 'utf8');
    const vendored = readFileSync(join(root, 'extension', 'vendor', file), 'utf8');
    assert.equal(vendored, shipped, `extension/vendor/${file} has drifted from lib/viewer/${file}`);
  }
  // And the delivery-specific bootstrap is the only thing the extension adds.
  const boot = readFileSync(join(root, 'extension', 'boot-host.js'), 'utf8');
  assert.match(boot, /__walkdownConfig/);
});
