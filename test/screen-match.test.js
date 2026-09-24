import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { appUrlOf, locationOfUrl, matchScreen, screenKey, splitScreenRef } from '../lib/screen-match.js';

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
    origin: '',
    path: '/orders',
    query: '?tab=open',
    fragment: '#/order/1?zoom=2',
  });
  assert.equal(screenKey('/confirm.html?email=a@b.c'), '/confirm.html');
  assert.equal(screenKey('/admin.html#invite-batch'), '/admin.html#invite-batch');
});

test('an app path written as a whole URL keeps its origin apart from its path (#15) @rule:screens.surfaces.stand-in-app', () => {
  const standIn = 'http://localhost:4700/stand-in/party-id-types';
  assert.deepEqual(splitScreenRef(standIn), {
    origin: 'http://localhost:4700',
    path: '/stand-in/party-id-types',
    query: '',
    fragment: '',
  });
  const screens = [{ id: 'party-id-types', app: { path: standIn } }, ...SCREENS];
  const here = locationOfUrl(standIn);
  assert.equal(matchScreen(screens, here).screen.id, 'party-id-types');
  // The same path on the app's own origin is not the stand-in.
  assert.equal(matchScreen(screens, locationOfUrl('http://localhost:3000/stand-in/party-id-types')), null);
  // Its key carries the origin, so two blueprints' stand-ins at one path
  // on different servers are not the same page.
  assert.equal(screenKey(standIn), standIn);
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

/*
 * The two deliveries of walkdown's own page - the served review.html and the
 * extension's boot-host.js - read the same address: the blueprint in ?bp=,
 * what to open in ?rule= and ?thread=, the framed page after #. Each is its
 * own bootstrap, so a parameter taught to one and not the other is a link
 * that works from the server and does nothing from the extension - which is
 * how ?rule= arrived on the extension's page on 2026-09-16 and opened
 * nothing, while every check passed against the served page.
 */
test('both of walkdown\'s own pages read the same address @rule:panel.start.address-opens-what-it-names', () => {
  const root = new URL('../', import.meta.url).pathname;
  const served = readFileSync(join(root, 'lib', 'viewer', 'review.html'), 'utf8');
  const extension = readFileSync(join(root, 'extension', 'boot-host.js'), 'utf8');
  for (const read of [/\.get\('bp'\)/, /\.get\('rule'\)/, /\.get\('thread'\)/, /location\.hash/]) {
    assert.match(served, read, `the served page does not read ${read}`);
    assert.match(extension, read, `the extension's page does not read ${read}`);
  }
});

test('an app path resolves against base_url the way a link does, so a whole URL is framed where it points (#15) @rule:screens.surfaces.app-address-is-resolved', () => {
  const base = 'http://localhost:3000';
  assert.equal(appUrlOf('/orders#/order/1', base), 'http://localhost:3000/orders#/order/1');
  assert.equal(
    appUrlOf('http://localhost:4700/stand-in/party-id-types', base),
    'http://localhost:4700/stand-in/party-id-types',
  );
  assert.equal(appUrlOf(null, base), null);
  assert.equal(appUrlOf('/orders', null), null);
  // The panel's frame and the server's picture both take it from here.
  for (const src of ['src/panel/vocab.js', 'lib/serve.js'])
    assert.match(readFileSync(join(import.meta.dirname, '..', src), 'utf8'), /appUrlOf\(screen\.app\.path/, src);
});
