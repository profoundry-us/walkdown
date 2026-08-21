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
      '        verify: [checks, human]', '        screens: [home]'].join('\n')
  );
  writeFileSync(join(root, 'proto', 'home.html'), '<h1 data-testid="home.cta">hi</h1>');
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'tests', 'demo.test.js'),
    ["// helpers", "", "test('does the thing', () => {", "  expect(1).toBe(1);", "});", "",
      "test('unrelated', () => {});"].join('\n'));
  mkdirSync(join(bp, 'runs'), { recursive: true });
  writeFileSync(join(bp, 'runs', '2026-01-01T00-00-00Z-local-01.json'), JSON.stringify({
    run_id: '2026-01-01T00-00-00Z-local-01', created: '2026-01-01T00:00:00Z',
    actor: 'agent', kind: 'checks', target: 'local',
    results: [{ rule: 'demo.main.thing', status: 'pass',
      checks: ['tests/demo.test.js:3', '../../outside.js:1'] }],
  }));

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

test('POST /api/threads writes a thread file; screen resolved from URL @rule:embed.pin.anchored-target', async () => {
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

test('a pin with no anchored element is kept by position @rule:embed.pin.coordinate-fallback', async () => {
  const res = await (await fetch(`${base}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'note', body: 'Nothing selectable here.', author: 'tester',
      anchor: { screen: 'home', position: { x: 412.4, y: 218.7 } },
    }),
  })).json();
  const onDisk = parse(readFileSync(join(bp, 'threads', `${res.id}.yml`), 'utf8'));
  assert.equal(onDisk.anchor.element, undefined);
  assert.deepEqual(onDisk.anchor.position, { x: 412, y: 219 });
  assert.equal(onDisk.anchor.screen, 'home');

  // An anchored pin still wins: position is the fallback, not a competitor.
  const anchored = await (await fetch(`${base}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'note', body: 'On the CTA.', author: 'tester',
      anchor: { screen: 'home', element: 'home.cta', position: { x: 5, y: 5 } },
    }),
  })).json();
  const anchoredDisk = parse(readFileSync(join(bp, 'threads', `${anchored.id}.yml`), 'utf8'));
  assert.equal(anchoredDisk.anchor.element, 'home.cta');
  assert.equal(anchoredDisk.anchor.position, undefined);

  // Garbage coordinates are dropped rather than persisted.
  const junk = await (await fetch(`${base}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'note', body: 'Bad point.', author: 'tester',
      anchor: { screen: 'home', position: { x: 'left', y: null } },
    }),
  })).json();
  const junkDisk = parse(readFileSync(join(bp, 'threads', `${junk.id}.yml`), 'utf8'));
  assert.equal(junkDisk.anchor.position, undefined);
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

test('thread reply and status endpoints mutate through the validated path', async () => {
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const reply = await (await post('/api/threads/n-0001/replies', { author: 'agent', body: 'Done in run 7.' })).json();
  assert.equal(reply.thread.replies.at(-1).body, 'Done in run 7.');

  const addressed = await (await post('/api/threads/n-0001/status', { status: 'addressed', actor: 'agent' })).json();
  assert.equal(addressed.thread.status, 'addressed');

  // an agent may not self-accept
  const agentVerify = await post('/api/threads/n-0001/status', { status: 'verified', actor: 'agent' });
  assert.equal(agentVerify.status, 400);
  assert.match((await agentVerify.json()).error, /named human/);

  const verified = await (await post('/api/threads/n-0001/status', { status: 'verified', actor: 'topher' })).json();
  assert.equal(verified.thread.status, 'verified');

  const unknown = await post('/api/threads/zzz/replies', { body: 'x' });
  assert.equal(unknown.status, 400);
});

test('GET /api/checks returns source snippets from ledger refs; traversal refs are dropped', async () => {
  const data = await (await fetch(`${base}/api/checks?rule=demo.main.thing`)).json();
  assert.equal(data.checks.length, 1); // the ../../ ref was filtered out
  assert.equal(data.checks[0].ref, 'tests/demo.test.js:3');
  assert.equal(data.checks[0].startLine, 3);
  assert.match(data.checks[0].source, /does the thing/);
  assert.doesNotMatch(data.checks[0].source, /unrelated/); // cut at the next test opener

  assert.equal((await fetch(`${base}/api/checks?rule=nope`)).status, 400);
});

test('multi-project: sibling blueprints are discovered and ?bp= switches, membership-validated', async () => {
  mkdirSync(join(root, 'sibling', 'blueprint', 'features'), { recursive: true });
  writeFileSync(join(root, 'sibling', 'blueprint', 'walkdown.yml'), 'project: sibling-app\n');
  writeFileSync(join(root, 'sibling', 'blueprint', 'features', 'f.yml'),
    'feature: f\nstories:\n  - id: f.s\n    rules:\n      - id: f.s.one\n        statement: One.\n        verify: [checks]\n');

  const home = await (await fetch(`${base}/api/blueprint`)).json();
  const ids = home.projects.map((p) => p.id).sort();
  assert.deepEqual(ids, ['blueprint', 'sibling/blueprint']);
  assert.ok(home.projects.find((p) => p.id === 'blueprint').current);

  const sibling = await (await fetch(`${base}/api/blueprint?bp=${encodeURIComponent('sibling/blueprint')}`)).json();
  assert.equal(sibling.project, 'sibling-app');
  assert.equal(sibling.rows[0].rule, 'f.s.one');
  assert.ok(sibling.projects.find((p) => p.id === 'sibling/blueprint').current);

  assert.equal((await fetch(`${base}/api/blueprint?bp=../../etc`)).status, 404);
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
