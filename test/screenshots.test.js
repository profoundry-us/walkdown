import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { candidates, closeBrowser, elsewhere, openBrowser, pictureOf } from '../lib/screenshots.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-shots-'));
after(async () => {
  await closeBrowser();
  rmSync(root, { recursive: true, force: true });
});

test('where a page landed is said only when it left the address it was asked for @rule:panel.dock.storyboard', () => {
  assert.equal(elsewhere('http://a.test/app/home', 'http://a.test/app/home'), null);
  assert.equal(elsewhere('http://a.test/app/home', 'http://a.test/app/home#tab'), null);
  assert.equal(elsewhere('http://a.test/app/home', 'http://a.test/login?next=/app/home'), 'http://a.test/login?next=/app/home');
  assert.equal(elsewhere('http://a.test/app/home', 'https://sso.example/authorize'), 'https://sso.example/authorize');
});

/*
 * The case the rule is about: an app behind a sign-in answers every address
 * with its login page, and the server's browser has no cookies.
 */
test('a page that redirects to a sign-in is photographed as where it landed, and says so from the cache too @rule:panel.dock.storyboard', async () => {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/login')) return res.end('<!doctype html><h1>Sign in</h1>');
    res.writeHead(302, { location: `/login?next=${encodeURIComponent(req.url)}` });
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/dashboard?probe=${Date.now()}`;
    const first = await pictureOf(url, { refresh: true });
    assert.equal(first.hit, false);
    assert.ok(existsSync(first.file));
    assert.match(first.landed, /\/login\?next=%2Fdashboard/);
    const again = await pictureOf(url);
    assert.equal(again.hit, true);
    assert.equal(again.landed, first.landed);
    const home = `http://127.0.0.1:${server.address().port}/login?stay=${Date.now()}`;
    assert.equal((await pictureOf(home, { refresh: true })).landed, null);
  } finally {
    server.close();
  }
});

/*
 * A clone is the install and brings no node_modules, so the browser has to
 * be found in the project being served as well. A project directory holding
 * Playwright is enough; one holding nothing adds nothing.
 */
test('the browser is looked for in the project being served, after walkdown\'s own tree @rule:panel.dock.storyboard', () => {
  const project = join(root, 'with-playwright');
  // A stand-in package of the project's own, so the lookup cannot be
  // answered from this tree's node_modules by following a link back.
  const pkg = join(project, 'node_modules', '@playwright', 'test');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(project, 'package.json'), '{"name":"p"}');
  writeFileSync(join(pkg, 'package.json'), '{"name":"@playwright/test","main":"index.js"}');
  writeFileSync(join(pkg, 'index.js'), 'module.exports = { chromium: null };');
  const found = candidates(project);
  assert.deepEqual(found.slice(0, 2), ['playwright', '@playwright/test']);
  assert.equal(found.length, 3);
  assert.match(found[2], /with-playwright\/node_modules\/@playwright\/test\//);
  const bare = join(root, 'bare');
  mkdirSync(bare);
  writeFileSync(join(bare, 'package.json'), '{"name":"b"}');
  assert.deepEqual(candidates(bare), ['playwright', '@playwright/test']);
});

test('a browser that dies between pictures is launched again, not held @rule:panel.dock.storyboard', async () => {
  const server = createServer((req, res) => res.end('<!doctype html><h1>here</h1>'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await pictureOf(`${base}/one?${Date.now()}`, { refresh: true });
    // Kill it the way a crash would, from outside the module's own close.
    const first = openBrowser();
    assert.ok(first?.isConnected());
    await first.close();
    const second = await pictureOf(`${base}/two?${Date.now()}`, { refresh: true });
    assert.equal(second.hit, false);
    assert.ok(existsSync(second.file));
  } finally {
    server.close();
  }
});
