import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { parse } from 'yaml';
import { readDraft } from '../lib/draft.js';
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
  assert.match(await (await fetch(`${base}/`)).text(), /<title>walkdown<\/title>/);
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

  // An anchored pin keeps its spot too: the element says what it is about, the
  // point says where the reviewer was pointing, and the offset ties the two
  // together so the spot survives the element moving.
  const anchored = await (await fetch(`${base}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'note', body: 'On the CTA.', author: 'tester',
      anchor: { screen: 'home', element: 'home.cta', position: { x: 205, y: 190 }, offset: { x: 5, y: 5 } },
    }),
  })).json();
  const anchoredDisk = parse(readFileSync(join(bp, 'threads', `${anchored.id}.yml`), 'utf8'));
  assert.equal(anchoredDisk.anchor.element, 'home.cta');
  assert.deepEqual(anchoredDisk.anchor.position, { x: 205, y: 190 });
  assert.deepEqual(anchoredDisk.anchor.offset, { x: 5, y: 5 });

  // An offset without an element means nothing, and is not kept.
  const stray = await (await fetch(`${base}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'note', body: 'Loose offset.', author: 'tester',
      anchor: { screen: 'home', position: { x: 9, y: 9 }, offset: { x: 3, y: 3 } },
    }),
  })).json();
  assert.equal(parse(readFileSync(join(bp, 'threads', `${stray.id}.yml`), 'utf8')).anchor.offset, undefined);

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

test('a pin records the surface it was placed on @rule:embed.pin.both-surfaces', async () => {
  const pin = (anchor) => fetch(`${base}/api/threads`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'note', body: 'On this surface.', author: 'tester', anchor }),
  }).then((r) => r.json());
  const onDisk = async (id) => parse(readFileSync(join(bp, 'threads', `${id}.yml`), 'utf8'));

  const fromApp = await pin({ screen: 'home', element: 'home.cta', surface: 'app' });
  assert.equal((await onDisk(fromApp.id)).anchor.surface, 'app');

  const fromProto = await pin({ screen: 'home', element: 'home.cta', surface: 'prototype' });
  assert.equal((await onDisk(fromProto.id)).anchor.surface, 'prototype');

  // Anything that is not one of the two surfaces is dropped, not stored.
  const bogus = await pin({ screen: 'home', element: 'home.cta', surface: 'staging-ish' });
  assert.equal((await onDisk(bogus.id)).anchor.surface, undefined);
});

test('a pin records the viewport it was placed at @rule:embed.pin.viewport-recorded', async () => {
  const res = await (await fetch(`${base}/api/threads`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'note', body: 'Cramped on a phone.', author: 'tester',
      anchor: { screen: 'home', element: 'home.cta', surface: 'app', viewport: { name: 'mobile', width: 390 } },
    }),
  })).json();
  const onDisk = parse(readFileSync(join(bp, 'threads', `${res.id}.yml`), 'utf8'));
  assert.deepEqual(onDisk.anchor.viewport, { name: 'mobile', width: 390 });

  const noWidth = await (await fetch(`${base}/api/threads`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'note', body: 'x', author: 'tester',
      anchor: { screen: 'home', element: 'home.cta', viewport: { name: 'mobile' } } }),
  })).json();
  assert.equal(parse(readFileSync(join(bp, 'threads', `${noWidth.id}.yml`), 'utf8')).anchor.viewport, undefined);
});

test('positions are stored in the surface coordinate space given @rule:embed.pin.surface-coordinates', async () => {
  // The server persists exactly the surface-space point it was handed; nothing
  // about the viewer's panes, zoom, or window may enter the stored value.
  const place = (position, viewport) => fetch(`${base}/api/threads`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'note', body: 'Spot.', author: 'tester',
      anchor: { screen: 'home', surface: 'app', position, viewport } }),
  }).then((r) => r.json());
  const at = { x: 980, y: 1420 };   // beyond any pane size: document space, not screen space

  const wide = await place(at, { name: 'desktop', width: 1440 });
  const narrow = await place(at, { name: 'mobile', width: 390 });
  const w = parse(readFileSync(join(bp, 'threads', `${wide.id}.yml`), 'utf8')).anchor;
  const n = parse(readFileSync(join(bp, 'threads', `${narrow.id}.yml`), 'utf8')).anchor;
  assert.deepEqual(w.position, at);
  assert.deepEqual(n.position, at, 'the viewport must not rescale a recorded position');
  assert.equal(w.viewport.width, 1440);
  assert.equal(n.viewport.width, 390);
});

test('the blueprint payload carries a default actor @rule:panel.identity.default-actor', async () => {
  const payload = await (await fetch(`${base}/api/blueprint`)).json();
  assert.ok(payload.identity?.actor, 'an identity must always be offered');
  assert.match(payload.identity.source, /^(git|os)$/);
  // In this repo git config user.name is set, so git wins over the OS username.
  const { defaultActor } = await import('../lib/serve.js');
  const here = defaultActor(process.cwd());
  assert.equal(here.source, 'git');
  assert.ok(here.actor.length > 0);
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

test('a sign-off records approved with its hash and threads @rule:panel.signoff.approved-recorded', async () => {
  const res = await (await fetch(`${base}/api/walkdowns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'topher', results: [
      { rule: 'demo.main.thing', status: 'approved', threads: ['n-0001'] },
    ] }),
  })).json();
  assert.ok(res.run_id, JSON.stringify(res));
  const file = readdirSync(join(bp, 'runs')).find((f) => f.includes(res.run_id));
  const record = JSON.parse(readFileSync(join(bp, 'runs', file), 'utf8'));
  assert.equal(record.results[0].status, 'approved');
  // An approval is of the statement as written, so it is hash-stamped like a pass.
  assert.equal(record.results[0].statement_hash, formatHash('The visitor can do the thing.'));
  assert.deepEqual(record.results[0].threads, ['n-0001']);
});

test('the blueprint payload names the panel build it ships @rule:panel.delivery.stale-copy-says-so', async () => {
  const { createHash } = await import('node:crypto');
  const payload = await (await fetch(`${base}/api/blueprint`)).json();
  const shipped = createHash('sha256')
    .update(readFileSync(new URL('../lib/viewer/panel.js', import.meta.url)))
    .digest('hex').slice(0, 12);
  assert.equal(payload.panelHash, shipped);
});

test('a session drafts to disk and finishing seals it into one run @rule:panel.walkdown.draft-on-disk', async () => {
  const draftFile = join(bp, 'drafts', 'local.json');
  const post = (body) => fetch(`${base}/api/draft`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  // A verdict, then a second one: the draft is rewritten, never appended to.
  await post({ actor: 'topher', started: '2026-08-24T00:00:00Z', verdicts: { 'demo.main.thing': 'approved' } });
  let draft = JSON.parse(readFileSync(draftFile, 'utf8'));
  assert.equal(draft.draft, true);
  assert.equal(draft.actor, 'topher');
  assert.deepEqual(draft.verdicts, { 'demo.main.thing': 'approved' });
  // Not a run: no run id, and it is nowhere near runs/.
  assert.equal(draft.run_id, undefined);
  assert.ok(!readdirSync(join(bp, 'runs')).some((f) => f.includes('local.json')));
  // And never committed by accident.
  assert.equal(readFileSync(join(bp, 'drafts', '.gitignore'), 'utf8'), '*\n!.gitignore\n');

  await post({ actor: 'topher', started: '2026-08-24T00:00:00Z', verdicts: { 'demo.main.thing': 'pass' }, threads: { 'demo.main.thing': ['n-0002'] } });
  draft = JSON.parse(readFileSync(draftFile, 'utf8'));
  assert.deepEqual(draft.verdicts, { 'demo.main.thing': 'pass' });
  assert.deepEqual(draft.threads, { 'demo.main.thing': ['n-0002'] });

  // The panel that just booted gets the sitting back with the blueprint.
  const payload = await (await fetch(`${base}/api/blueprint`)).json();
  assert.deepEqual(payload.draft.verdicts, { 'demo.main.thing': 'pass' });
  assert.deepEqual((await (await fetch(`${base}/api/draft`)).json()).draft.verdicts, { 'demo.main.thing': 'pass' });

  // Junk never accumulates: an unknown rule or status is refused.
  const bad = await fetch(`${base}/api/draft`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verdicts: { 'nope.not.a.rule': 'pass' } }),
  });
  assert.equal(bad.status, 400);

  // Finish: one run appended, draft gone.
  const before = readdirSync(join(bp, 'runs')).length;
  const sealed = await (await fetch(`${base}/api/walkdowns`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'topher', results: [{ rule: 'demo.main.thing', status: 'pass' }] }),
  })).json();
  assert.ok(sealed.run_id);
  assert.equal(readdirSync(join(bp, 'runs')).length, before + 1);
  assert.equal(readDraft(bp), null);

  // Discarding writes nothing and leaves nothing.
  await post({ actor: 'topher', verdicts: { 'demo.main.thing': 'fail' } });
  assert.ok(readDraft(bp));
  assert.deepEqual(await post({ discard: true }), { draft: null });
  assert.equal(readDraft(bp), null);
});

test('a stand-in serves the design as the app, marked as one @rule:screens.surfaces.stand-in-app', async () => {
  const res = await fetch(`${base}/stand-in/home`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // The design's own markup and anchors, so a pin lands on the same element
  // on either surface — and the embed still rides along.
  assert.match(html, /data-testid="home\.cta"/);
  // Neither the mockups' theme nor walkdown's chrome, and it says what it is.
  assert.match(html, /data-theme="emerald"/);
  assert.match(html, /walkdown-stand-in-ring/);
  assert.match(html, /stand-in app/);
  // A screen with no design has no stand-in to serve.
  assert.equal((await fetch(`${base}/stand-in/nope`)).status, 404);
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
