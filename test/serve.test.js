/*
 * Server tests. Deliberately NOT tagged with panel.* or embed.* rule ids.
 *
 * They exercise the HTTP surface the panel and the embed talk to, which is a
 * real thing worth testing - but a rule whose statement is about hovering,
 * placing, drawing or displaying is not verified by handing the server an
 * answer already filled in and checking the filing. Those tags were removed on
 * 2026-08-25 (see thread q-0070): a check must exercise the same surface the
 * rule describes, and until a browser harness exists those rules read as
 * unverified, which is the honest state.
 *
 * If you are here to make a red rule green, write the browser check. Do not
 * re-tag one of these.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { readDraft } from '../lib/draft.js';
import { formatHash } from '../lib/hash.js';
import { resolveLocations } from '../lib/locations.js';
import { createWalkdownServer } from '../lib/serve.js';
import { parse } from '../vendor/yaml.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-serve-'));
const bp = join(root, 'blueprint');
/*
 * A home that declares who is sitting here. Every write this server makes is
 * recorded under the config's identity now - a name in a request is asserted
 * and never proved, since this server has no authentication - so a fixture
 * with no identity is a machine that refuses to accept work, which is a
 * different test and lives beside the first one.
 */
const DECLARED_HOME = join(root, 'home-declared');
const GUESSING_HOME = join(root, 'home-guessing');
let base;
let server;

before(async () => {
  mkdirSync(DECLARED_HOME, { recursive: true });
  mkdirSync(GUESSING_HOME, { recursive: true });
  writeFileSync(
    join(DECLARED_HOME, 'config.yml'),
    'identity:\n  username: serve-person\n  name: A Serve Person\n',
  );
  process.env.WALKDOWN_HOME = DECLARED_HOME;
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'threads'), { recursive: true });
  mkdirSync(join(root, 'proto'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: serve-fixture\nprototype: { root: proto/ }\n');
  writeFileSync(
    join(bp, 'storyboard.yml'),
    'screens:\n  - id: home\n    prototype: /home.html\n    app: { path: /home }\n    anchors: [home.cta]\n',
  );
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.thing',
      '        statement: The visitor can do the thing.',
      '        verify: [checks, human]',
      '        screens: [home]',
    ].join('\n'),
  );
  writeFileSync(join(root, 'proto', 'home.html'), '<h1 data-testid="home.cta">hi</h1>');
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(
    join(root, 'tests', 'demo.test.js'),
    [
      '// helpers',
      '',
      "test('does the thing', () => {",
      '  expect(1).toBe(1);',
      '});',
      '',
      "test('unrelated', () => {});",
    ].join('\n'),
  );
  mkdirSync(join(bp, 'runs'), { recursive: true });
  writeFileSync(
    join(bp, 'runs', '2026-01-01T00-00-00Z-local-01.json'),
    JSON.stringify({
      run_id: '2026-01-01T00-00-00Z-local-01',
      created: '2026-01-01T00:00:00Z',
      actor: 'agent',
      kind: 'checks',
      target: 'local',
      results: [
        {
          rule: 'demo.main.thing',
          status: 'pass',
          checks: ['tests/demo.test.js:3', '../../outside.js:1'],
        },
      ],
    }),
  );

  /*
   * Declared, not discovered. The server used to walk the fixture root for
   * `walkdown.yml` files; it reads the list now, so the fixture writes one -
   * a repository config beside the blueprints it describes (n-0133, n-0140).
   */
  mkdirSync(join(root, '.walkdown'), { recursive: true });
  writeFileSync(
    join(root, '.walkdown', 'config.yml'),
    [
      'projects:',
      '  - id: main',
      '    roots: [.]',
      '    spec: blueprint',
      '  - id: sibling',
      '    roots: [sibling]',
      '    spec: sibling/blueprint',
      '',
    ].join('\n'),
  );

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

test('the review page, embed.js, and prototype static files are served', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /<title>walkdown<\/title>/);
  const embed = await (await fetch(`${base}/embed.js`)).text();
  assert.match(embed, /data-testid/); // __ANCHOR_ATTR__ substituted
  assert.doesNotMatch(embed, /__ANCHOR_ATTR__/);
  assert.match(await (await fetch(`${base}/prototype/home.html`)).text(), /home\.cta/);
  assert.equal((await fetch(`${base}/prototype/../walkdown.yml`)).status, 404);
});

test('the panel and the embed are served as two files, neither carrying the other', async () => {
  const panel = await (await fetch(`${base}/panel.js`)).text();
  const embed = await (await fetch(`${base}/embed.js`)).text();
  // Two documents need two files: the embed goes into every page the extension
  // visits, the panel only into walkdown's own. A single file could not tell
  // those apart without drawing a panel on every site you browse.
  assert.ok(panel.includes('__walkdownPanel'), 'panel.js is the panel');
  assert.ok(embed.includes('walkdownEmbed'), 'embed.js is the embed');
  assert.doesNotMatch(panel, /walkdownEmbed\s*=/, 'panel.js does not carry the embed');
  assert.doesNotMatch(embed, /__walkdownPanel\s*=/, 'embed.js does not carry the panel');
  // And the one-tag route that concatenated them is gone with the docked layout.
  assert.equal((await fetch(`${base}/walkdown.js`)).status, 404);
});

test('the review page is handed its front door and its blueprint', async () => {
  const html = await (await fetch(`${base}/`)).text();
  // Whatever the page has to know before it can load the panel is baked in on
  // the way out: it cannot ask the blueprint, because asking is what the panel
  // it is about to load does.
  assert.doesNotMatch(html, /__FRONT_DOOR__|__BLUEPRINT__/);
  // No app base declared in this fixture, so the front door is the design.
  assert.match(html, /'\/prototype\/home\.html'/);
  assert.match(html, /'main'/);
});

test('POST /api/threads writes a thread file; screen resolved from URL', async () => {
  const res = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'Make it bigger.',
        author: 'tester',
        anchor: { element: 'home.cta' },
        url: 'http://localhost:3000/home',
      }),
    })
  ).json();
  assert.equal(res.id, 'n-0001');
  const onDisk = parse(readFileSync(join(bp, 'threads', 'n-0001.yml'), 'utf8'));
  assert.equal(onDisk.status, 'open');
  assert.equal(onDisk.anchor.screen, 'home'); // resolved from the app path
  assert.equal(onDisk.anchor.element, 'home.cta');
  // Millisecond precision: the panel's session gate compares this stamp to a
  // millisecond session start, and a seconds-only stamp made the whole start
  // second ambiguous (n-0132).
  assert.match(
    String(onDisk.created),
    /\.\d{3}Z$/,
    'a thread stamp carries milliseconds @rule:panel.walkdown.fail-requires-why',
  );
});

test('a pin with no anchored element is kept by position', async () => {
  const res = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'Nothing selectable here.',
        author: 'tester',
        anchor: { screen: 'home', position: { x: 412.4, y: 218.7 } },
      }),
    })
  ).json();
  const onDisk = parse(readFileSync(join(bp, 'threads', `${res.id}.yml`), 'utf8'));
  assert.equal(onDisk.anchor.element, undefined);
  assert.deepEqual(onDisk.anchor.position, { x: 412, y: 219 });
  assert.equal(onDisk.anchor.screen, 'home');

  // An anchored pin keeps its spot too: the element says what it is about, the
  // point says where the reviewer was pointing, and the offset ties the two
  // together so the spot survives the element moving.
  const anchored = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'On the CTA.',
        author: 'tester',
        anchor: {
          screen: 'home',
          element: 'home.cta',
          position: { x: 205, y: 190 },
          offset: { x: 5, y: 5 },
        },
      }),
    })
  ).json();
  const anchoredDisk = parse(readFileSync(join(bp, 'threads', `${anchored.id}.yml`), 'utf8'));
  assert.equal(anchoredDisk.anchor.element, 'home.cta');
  assert.deepEqual(anchoredDisk.anchor.position, { x: 205, y: 190 });
  assert.deepEqual(anchoredDisk.anchor.offset, { x: 5, y: 5 });

  // An offset without an element means nothing, and is not kept.
  const stray = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'Loose offset.',
        author: 'tester',
        anchor: { screen: 'home', position: { x: 9, y: 9 }, offset: { x: 3, y: 3 } },
      }),
    })
  ).json();
  assert.equal(
    parse(readFileSync(join(bp, 'threads', `${stray.id}.yml`), 'utf8')).anchor.offset,
    undefined,
  );

  // Garbage coordinates are dropped rather than persisted.
  const junk = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'Bad point.',
        author: 'tester',
        anchor: { screen: 'home', position: { x: 'left', y: null } },
      }),
    })
  ).json();
  const junkDisk = parse(readFileSync(join(bp, 'threads', `${junk.id}.yml`), 'utf8'));
  assert.equal(junkDisk.anchor.position, undefined);
});

test('a pin records the surface it was placed on', async () => {
  const pin = (anchor) =>
    fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

test('a pin records the viewport it was placed at', async () => {
  const res = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'Cramped on a phone.',
        author: 'tester',
        anchor: {
          screen: 'home',
          element: 'home.cta',
          surface: 'app',
          viewport: { name: 'mobile', width: 390 },
        },
      }),
    })
  ).json();
  const onDisk = parse(readFileSync(join(bp, 'threads', `${res.id}.yml`), 'utf8'));
  assert.deepEqual(onDisk.anchor.viewport, { name: 'mobile', width: 390 });

  const noWidth = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'x',
        author: 'tester',
        anchor: { screen: 'home', element: 'home.cta', viewport: { name: 'mobile' } },
      }),
    })
  ).json();
  assert.equal(
    parse(readFileSync(join(bp, 'threads', `${noWidth.id}.yml`), 'utf8')).anchor.viewport,
    undefined,
  );
});

test('positions are stored in the surface coordinate space given', async () => {
  // The server persists exactly the surface-space point it was handed; nothing
  // about the viewer's panes, zoom, or window may enter the stored value.
  const place = (position, viewport) =>
    fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'Spot.',
        author: 'tester',
        anchor: { screen: 'home', surface: 'app', position, viewport },
      }),
    }).then((r) => r.json());
  const at = { x: 980, y: 1420 }; // beyond any pane size: document space, not screen space

  const wide = await place(at, { name: 'desktop', width: 1440 });
  const narrow = await place(at, { name: 'mobile', width: 390 });
  const w = parse(readFileSync(join(bp, 'threads', `${wide.id}.yml`), 'utf8')).anchor;
  const n = parse(readFileSync(join(bp, 'threads', `${narrow.id}.yml`), 'utf8')).anchor;
  assert.deepEqual(w.position, at);
  assert.deepEqual(n.position, at, 'the viewport must not rescale a recorded position');
  assert.equal(w.viewport.width, 1440);
  assert.equal(n.viewport.width, 390);
});

test('the blueprint payload carries a default actor @rule:status.attribution.username-is-the-record', async () => {
  const payload = await (await fetch(`${base}/api/blueprint`)).json();
  assert.ok(payload.identity?.actor, 'an identity must always be offered');
  assert.match(payload.identity.source, /^(config|git|os)$/);
  const { defaultActor } = await import('../lib/identity.js');
  const here = defaultActor(process.cwd());
  assert.ok(here.actor.length > 0);

  /*
   * Where it comes from, in order, and the top of that order is new: the
   * personal config's `identity:` block used to be read by nothing at all
   * while looking exactly like the source of truth (n-0139). Everything under
   * it - a git email, a login name - is inference, and the report says which
   * it is, because a guess and a signature must not read the same.
   */
  const said = mkdtempSync(join(tmpdir(), 'walkdown-said-'));
  writeFileSync(
    join(said, 'config.yml'),
    'identity:\n  username: declared-person\n  name: A Declared Person\n  roles: [product]\n',
  );
  const pinned = process.env.WALKDOWN_HOME;
  process.env.WALKDOWN_HOME = said;
  try {
    const declared = defaultActor(process.cwd());
    assert.equal(declared.username, 'declared-person', 'the config outranks what git guesses');
    assert.equal(declared.name, 'A Declared Person');
    assert.deepEqual(declared.roles, ['product']);
    assert.equal(declared.source, 'config');
    assert.equal(declared.declared, true, 'and it is legible AS said, which the accept gate asks');
  } finally {
    process.env.WALKDOWN_HOME = pinned;
  }
  // And inference is never a signature: a home that says nothing reports the
  // guess it made AS a guess, which is what the accept gate reads.
  const guessing = defaultActor(process.cwd());
  process.env.WALKDOWN_HOME = GUESSING_HOME;
  try {
    assert.equal(defaultActor(process.cwd()).declared, false);
    assert.notEqual(defaultActor(process.cwd()).source, 'config');
  } finally {
    process.env.WALKDOWN_HOME = DECLARED_HOME;
  }
  assert.ok(guessing.username.length > 0, 'though it still always has a name to offer');

  // Identity and display name are two fields. `actor` - the one thing records
  // are written under - is the username, never the full name.
  assert.equal(here.actor, here.username, 'records carry the username');
  assert.ok(here.username.length > 0, 'there is always a username to record under');
  assert.ok(!/\s/.test(here.username), 'a username is a handle, not a full name');
  assert.equal(typeof here.name, 'string', 'the full name is offered, even as empty');

  // And every handle this machine could have signed with is reported, so a
  // ledger holding both the old full name and the new username still reads as
  // one person. Nothing rewrites the records themselves.
  assert.ok(Array.isArray(here.handles));
  assert.ok(here.handles.includes(here.username));
  if (here.name)
    assert.ok(
      here.handles.includes(here.name),
      'the full name records were written under before the split is still claimed',
    );
});

test('POST /api/walkdowns writes a hash-stamped human run record', async () => {
  const res = await (
    await fetch(`${base}/api/walkdowns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'topher',
        results: [{ rule: 'demo.main.thing', status: 'pass' }],
      }),
    })
  ).json();
  assert.ok(res.run_id, JSON.stringify(res));
  const file = readdirSync(join(bp, 'runs')).find((f) => f.includes(res.run_id));
  const record = JSON.parse(readFileSync(join(bp, 'runs', file), 'utf8'));
  assert.equal(record.kind, 'walkdown');
  // Not the actor the request asked for: a walkdown is an acceptance, and it
  // is recorded under the person this machine says is sitting at it.
  assert.equal(record.actor, 'serve-person');
  assert.equal(record.results[0].statement_hash, formatHash('The visitor can do the thing.'));
});

test('a sign-off records approved with its hash and threads @rule:panel.signoff.approved-recorded', async () => {
  const res = await (
    await fetch(`${base}/api/walkdowns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'topher',
        results: [{ rule: 'demo.main.thing', status: 'approved', threads: ['n-0001'] }],
      }),
    })
  ).json();
  assert.ok(res.run_id, JSON.stringify(res));
  const file = readdirSync(join(bp, 'runs')).find((f) => f.includes(res.run_id));
  const record = JSON.parse(readFileSync(join(bp, 'runs', file), 'utf8'));
  assert.equal(record.results[0].status, 'approved');
  // An approval is of the statement as written, so it is hash-stamped like a pass.
  assert.equal(record.results[0].statement_hash, formatHash('The visitor can do the thing.'));
  assert.deepEqual(record.results[0].threads, ['n-0001']);
});

test('the blueprint payload names the panel build it ships', async () => {
  const { createHash } = await import('node:crypto');
  const payload = await (await fetch(`${base}/api/blueprint`)).json();
  const shipped = createHash('sha256')
    .update(readFileSync(new URL('../lib/viewer/panel.js', import.meta.url)))
    .digest('hex')
    .slice(0, 12);
  assert.equal(payload.panelHash, shipped);
});

test('a session drafts to disk and finishing seals it into one run', async () => {
  /*
   * Asked, not assumed. Drafts do not follow the spec into a repository - a
   * half-finished sitting is one person's working state - so where they land
   * is a resolved location, and a test that hardcoded the blueprint's own
   * folder would be asserting the old default rather than the behaviour.
   */
  const draftsDir = resolveLocations({ spec: bp }).drafts.path;
  const draftFile = join(draftsDir, 'local.json');
  const post = (body) =>
    fetch(`${base}/api/draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  // A verdict, then a second one: the draft is rewritten, never appended to.
  await post({
    actor: 'topher',
    started: '2026-08-24T00:00:00Z',
    verdicts: { 'demo.main.thing': 'approved' },
  });
  let draft = JSON.parse(readFileSync(draftFile, 'utf8'));
  assert.equal(draft.draft, true);
  assert.equal(draft.actor, 'serve-person');
  assert.deepEqual(draft.verdicts, { 'demo.main.thing': 'approved' });
  // Not a run: no run id, and it is nowhere near runs/.
  assert.equal(draft.run_id, undefined);
  assert.ok(!readdirSync(join(bp, 'runs')).some((f) => f.includes('local.json')));
  // And never committed by accident.
  assert.equal(readFileSync(join(draftsDir, '.gitignore'), 'utf8'), '*\n!.gitignore\n');

  await post({
    actor: 'topher',
    started: '2026-08-24T00:00:00Z',
    verdicts: { 'demo.main.thing': 'pass' },
    threads: { 'demo.main.thing': ['n-0002'] },
  });
  draft = JSON.parse(readFileSync(draftFile, 'utf8'));
  assert.deepEqual(draft.verdicts, { 'demo.main.thing': 'pass' });
  assert.deepEqual(draft.threads, { 'demo.main.thing': ['n-0002'] });

  // The panel that just booted gets the sitting back with the blueprint.
  const payload = await (await fetch(`${base}/api/blueprint`)).json();
  assert.deepEqual(payload.draft.verdicts, { 'demo.main.thing': 'pass' });
  assert.deepEqual((await (await fetch(`${base}/api/draft`)).json()).draft.verdicts, {
    'demo.main.thing': 'pass',
  });

  // Junk never accumulates: an unknown rule or status is refused.
  const bad = await fetch(`${base}/api/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verdicts: { 'nope.not.a.rule': 'pass' } }),
  });
  assert.equal(bad.status, 400);

  // Finish: one run appended, draft gone.
  const before = readdirSync(join(bp, 'runs')).length;
  const sealed = await (
    await fetch(`${base}/api/walkdowns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'topher',
        results: [{ rule: 'demo.main.thing', status: 'pass' }],
      }),
    })
  ).json();
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
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"kind":"note"}',
  });
  assert.equal(noBody.status, 400);
});

test('thread reply and status endpoints mutate through the validated path', async () => {
  const post = (path, body) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const reply = await (
    await post('/api/threads/n-0001/replies', { author: 'agent', body: 'Done in run 7.' })
  ).json();
  assert.equal(reply.thread.replies.at(-1).body, 'Done in run 7.');

  const addressed = await (
    await post('/api/threads/n-0001/status', { status: 'addressed', actor: 'agent' })
  ).json();
  assert.equal(addressed.thread.status, 'addressed');

  /*
   * An agent may not self-accept. It used to be spelled by sending
   * `actor: 'agent'`, which this door no longer reads at all — what an agent
   * cannot do now is have a declared identity to act under, so the refusal
   * that stands here is the one for a machine nobody has named.
   */
  process.env.WALKDOWN_HOME = GUESSING_HOME;
  const guessVerify = await post('/api/threads/n-0001/status', { status: 'verified' });
  process.env.WALKDOWN_HOME = DECLARED_HOME;
  assert.equal(guessVerify.status, 400);
  assert.match((await guessVerify.json()).error, /identity:/);

  const verified = await (
    await post('/api/threads/n-0001/status', { status: 'verified' })
  ).json();
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

/*
 * A recorded ref is a line number in a file that keeps being edited. When the
 * tree's own @rule tag scan no longer corroborates it, serving the old line
 * literally shows a NEIGHBORING test's tail as this rule's source - which is
 * what failed panel.rules.steps-not-an-appendix in the 2026-09-01T01-04-49Z
 * run, after 40 lines landed above the tests it pointed at. The tree answers
 * for content then; the stale ref stays visible as provenance.
 */
test('a drifted check ref hands display to the tree and keeps the stale line as provenance', async () => {
  const root2 = mkdtempSync(join(tmpdir(), 'walkdown-drift-'));
  const bp2 = join(root2, 'blueprint');
  mkdirSync(join(bp2, 'features'), { recursive: true });
  mkdirSync(join(bp2, 'threads'), { recursive: true });
  mkdirSync(join(bp2, 'runs'), { recursive: true });
  writeFileSync(
    join(bp2, 'walkdown.yml'),
    'project: drift-fixture\nauthoring: { location: [suite/] }\n',
  );
  writeFileSync(
    join(bp2, 'features', 'd.yml'),
    'feature: d\nstories:\n  - id: d.s\n    rules:\n      - id: d.s.thing\n        statement: The thing.\n        verify: [checks]\n',
  );
  mkdirSync(join(root2, 'suite'), { recursive: true });
  writeFileSync(
    join(root2, 'suite', 'demo.spec.js'),
    [
      "test('neighbor', () => {", // line 1 — where the ledger still says d.s.thing lives
      '  neighborBody();',
      '});',
      '',
      "test('does the thing', {", // line 5 — where it actually lives now
      // Concatenated so the real project's own coverage scan never reads this
      // fixture literal as a check claiming a rule that does not exist.
      `  tag: '${'@rule' + ':d.s.thing'}',`, // line 6 — the scan sees this; snaps to the opener above
      '}, () => {',
      '  realBody();',
      '});',
    ].join('\n'),
  );
  const record = (checks) =>
    writeFileSync(
      join(bp2, 'runs', '2026-01-01T00-00-00Z-local-01.json'),
      JSON.stringify({
        run_id: '2026-01-01T00-00-00Z-local-01',
        created: '2026-01-01T00:00:00Z',
        actor: 'agent',
        kind: 'checks',
        target: 'local',
        results: [{ rule: 'd.s.thing', status: 'pass', checks }],
      }),
    );
  const srv = createWalkdownServer(bp2);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${srv.address().port}`;
  const ask = async () => (await (await fetch(`${at}/api/checks?rule=d.s.thing`)).json()).checks;
  try {
    // Drifted: the run recorded :1, the test now opens at :5.
    record(['suite/demo.spec.js:1']);
    const drifted = await ask();
    assert.equal(drifted.length, 1);
    assert.equal(drifted[0].ref, 'suite/demo.spec.js:5');
    assert.equal(drifted[0].recorded, 'suite/demo.spec.js:1');
    assert.match(drifted[0].source, /realBody/);
    assert.doesNotMatch(drifted[0].source, /neighbor/);

    // Corroborated: the recorded opener (:5) and the scanned tag (:6) are the
    // same test - the offset between them must never read as drift.
    record(['suite/demo.spec.js:5']);
    const steady = await ask();
    assert.equal(steady[0].ref, 'suite/demo.spec.js:5');
    assert.equal(steady[0].recorded, undefined);
    assert.match(steady[0].source, /realBody/);

    // Never recorded: the tree still answers (n-0084), from the opener.
    rmSync(join(bp2, 'runs', '2026-01-01T00-00-00Z-local-01.json'));
    const unrecorded = await ask();
    assert.equal(unrecorded[0].ref, 'suite/demo.spec.js:5');
    assert.equal(unrecorded[0].recorded, undefined);
    assert.match(unrecorded[0].source, /realBody/);
  } finally {
    srv.close();
    rmSync(root2, { recursive: true, force: true });
  }
});

test('multi-project: sibling blueprints are discovered and ?bp= switches, membership-validated', async () => {
  mkdirSync(join(root, 'sibling', 'blueprint', 'features'), { recursive: true });
  writeFileSync(join(root, 'sibling', 'blueprint', 'walkdown.yml'), 'project: sibling-app\n');
  writeFileSync(
    join(root, 'sibling', 'blueprint', 'features', 'f.yml'),
    'feature: f\nstories:\n  - id: f.s\n    rules:\n      - id: f.s.one\n        statement: One.\n        verify: [checks]\n',
  );

  const home = await (await fetch(`${base}/api/blueprint`)).json();
  const ids = home.projects.map((p) => p.id).sort();
  // The config entry's id, not a path relative to wherever this server was
  // started — the same string on every machine.
  assert.deepEqual(ids, ['main', 'sibling']);
  assert.ok(home.projects.find((p) => p.id === 'main').current);

  const sibling = await (
    await fetch(`${base}/api/blueprint?bp=sibling`)
  ).json();
  assert.equal(sibling.project, 'sibling-app');
  assert.equal(sibling.rows[0].rule, 'f.s.one');
  assert.ok(sibling.projects.find((p) => p.id === 'sibling').current);

  assert.equal((await fetch(`${base}/api/blueprint?bp=../../etc`)).status, 404);
});

test('a pin files against the page\u2019s own project, not the server\u2019s default', async () => {
  // The sibling project is created by the multi-project test above; this one
  // is about where a WRITE lands, which is the part a mis-routed pin gets wrong.
  mkdirSync(join(root, 'sibling', 'blueprint', 'threads'), { recursive: true });
  const res = await (
    await fetch(`${base}/api/threads?bp=sibling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', body: 'Belongs to the sibling.', author: 'tester' }),
    })
  ).json();
  assert.ok(res.id, JSON.stringify(res));
  // In the sibling's threads/, carrying this note. Ids are only unique within
  // a blueprint - each has its own ledger - so the check is what the file
  // says, not whether the name happens to be taken in the default project.
  const filed = parse(
    readFileSync(join(root, 'sibling', 'blueprint', 'threads', `${res.id}.yml`), 'utf8'),
  );
  assert.equal(filed.body, 'Belongs to the sibling.');
  const inDefault = join(bp, 'threads', `${res.id}.yml`);
  if (existsSync(inDefault))
    assert.notEqual(parse(readFileSync(inDefault, 'utf8')).body, 'Belongs to the sibling.');
});

test('the browser cannot name who a write is recorded under @rule:threads.lifecycle.acts-for-a-person', async () => {
  const note = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        body: 'something is off',
        author: 'mallory',
        anchor: { screen: 'home' },
      }),
    })
  ).json();
  /*
   * `author` was passed straight through and written to disk, so a POST filed
   * a thread under any name it liked. This server has no authentication and
   * never will — it is a localhost review server over one person's own
   * blueprint — so a name in a request is asserted, never proved, and an
   * assertion nobody can check is the text field `--actor` was at the CLI
   * (n-0142). The machine's own configured identity answers instead.
   */
  assert.equal(note.thread.author, 'serve-person', 'the request did not get to choose');

  await fetch(`${base}/api/threads/${note.id}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'addressed', actor: 'mallory' }),
  });

  // Accepting is the panel's own person doing it, under their own name —
  // never the name the request carried.
  const accepted = await fetch(`${base}/api/threads/${note.id}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'verified', actor: 'mallory' }),
  });
  assert.equal(accepted.status, 200);
  const disk = parse(readFileSync(join(bp, 'threads', `${note.id}.yml`), 'utf8'));
  assert.equal(disk.verified_by, 'serve-person');
  assert.notEqual(disk.verified_by, 'mallory', 'the invented name never reaches the ledger');
});

test('a machine that only has a guess is refused, at this door too @rule:threads.lifecycle.claim-never-accept', async () => {
  const note = await (
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', body: 'unaccepted', anchor: { screen: 'home' } }),
    })
  ).json();
  await fetch(`${base}/api/threads/${note.id}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'addressed' }),
  });

  /*
   * Removing the override is not enough on its own: a machine whose config
   * declares nobody still has a git email and a login name to fall back to,
   * and the panel offered Verify under one of those with the click going
   * through (n-0143). The refusal the CLI gives belongs here too.
   */
  process.env.WALKDOWN_HOME = GUESSING_HOME;
  try {
    const refused = await fetch(`${base}/api/threads/${note.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /identity:/, 'and it says where to say who you are');

    // A walkdown is an acceptance too, and asks the same.
    const run = await fetch(`${base}/api/walkdowns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'local',
        results: [{ rule: 'demo.main.thing', status: 'pass' }],
      }),
    });
    assert.equal(run.status, 400);

    // Claiming is not accepting, and stays open to a machine that is guessing.
    const claimed = await fetch(`${base}/api/threads/${note.id}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'looked at it' }),
    });
    assert.equal(claimed.status, 200);
  } finally {
    process.env.WALKDOWN_HOME = DECLARED_HOME;
  }
  const disk = parse(readFileSync(join(bp, 'threads', `${note.id}.yml`), 'utf8'));
  assert.equal(disk.status, 'addressed', 'the thread never moved');
  assert.equal(disk.verified_by, undefined);
});

test('OPTIONS preflight answers CORS and Private Network Access', async () => {
  const res = await fetch(`${base}/api/threads`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://staging.example.com',
      'access-control-request-private-network': 'true',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://staging.example.com');
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
});
