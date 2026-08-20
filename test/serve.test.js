import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { parse } from 'yaml';
import { formatHash } from '../lib/hash.js';
import { createWalkdownServer } from '../lib/serve.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-serve-'));
const bp = join(root, 'blueprint');
let base;
let server;

before(async () => {
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'threads'), { recursive: true });
  mkdirSync(join(root, 'proto'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: serve-fixture\nprototype: { root: proto/ }\n');
  writeFileSync(
    join(bp, 'storyboard.yml'),
    'screens:\n  - id: home\n    prototype: /home.html\n    app: { path: /home }\n    anchors: [home.cta]\n'
  );
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    ['feature: demo', 'stories:', '  - id: demo.main', '    rules:',
      '      - id: demo.main.thing', '        statement: The visitor can do the thing.',
      '        verify: [human]', '        screens: [home]'].join('\n')
  );
  writeFileSync(join(root, 'proto', 'home.html'), '<h1 data-testid="home.cta">hi</h1>');

  server = createWalkdownServer(bp);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

test('GET /api/blueprint returns rows, storyboard, and config bits', async () => {
  const data = await (await fetch(`${base}/api/blueprint`)).json();
  assert.equal(data.project, 'serve-fixture');
  assert.equal(data.rows[0].rule, 'demo.main.thing');
  assert.equal(data.storyboard[0].id, 'home');
  assert.equal(data.anchorAttr, 'data-testid');
  assert.equal(data.hasPrototype, true);
});

test('viewer, embed.js, and prototype static files are served', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /<title>Walkdown<\/title>/);
  const embed = await (await fetch(`${base}/embed.js`)).text();
  assert.match(embed, /data-testid/); // __ANCHOR_ATTR__ substituted
  assert.doesNotMatch(embed, /__ANCHOR_ATTR__/);
  assert.match(await (await fetch(`${base}/prototype/home.html`)).text(), /home\.cta/);
  assert.equal((await fetch(`${base}/prototype/../walkdown.yml`)).status, 404);
});

test('POST /api/threads writes a thread file; screen resolved from URL', async () => {
  const res = await (await fetch(`${base}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'note', body: 'Make it bigger.', author: 'tester',
      anchor: { element: 'home.cta' }, url: 'http://localhost:3000/home',
    }),
  })).json();
  assert.equal(res.id, 'n-0001');
  const onDisk = parse(readFileSync(join(bp, 'threads', 'n-0001.yml'), 'utf8'));
  assert.equal(onDisk.status, 'open');
  assert.equal(onDisk.anchor.screen, 'home'); // resolved from the app path
  assert.equal(onDisk.anchor.element, 'home.cta');
});

test('POST /api/walkdowns writes a hash-stamped human run record', async () => {
  const res = await (await fetch(`${base}/api/walkdowns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'topher', results: [{ rule: 'demo.main.thing', status: 'pass' }] }),
  })).json();
  assert.ok(res.run_id, JSON.stringify(res));
  const file = readdirSync(join(bp, 'runs')).find((f) => f.includes(res.run_id));
  const record = JSON.parse(readFileSync(join(bp, 'runs', file), 'utf8'));
  assert.equal(record.kind, 'walkdown');
  assert.equal(record.actor, 'topher');
  assert.equal(record.results[0].statement_hash, formatHash('The visitor can do the thing.'));
});

test('invalid writes are rejected with 400', async () => {
  const bad = await fetch(`${base}/api/walkdowns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'x', results: [{ rule: 'nope', status: 'pass' }] }),
  });
  assert.equal(bad.status, 400);
  const noBody = await fetch(`${base}/api/threads`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"note"}',
  });
  assert.equal(noBody.status, 400);
});

test('OPTIONS preflight answers CORS and Private Network Access', async () => {
  const res = await fetch(`${base}/api/threads`, {
    method: 'OPTIONS',
    headers: { origin: 'https://staging.example.com', 'access-control-request-private-network': 'true' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://staging.example.com');
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
});
