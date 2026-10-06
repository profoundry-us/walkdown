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
import { register, threadAt } from '../tools/test-home.mjs';
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
import { SITTING_FIELDS } from '../lib/sitting.js';
import { formatHash } from '../lib/hash.js';
import { resolveLocations } from '../lib/locations.js';
import { createWalkdownServer } from '../lib/serve.js';
import { parse } from '../vendor/yaml.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-serve-'));
const bp = root;
// Beside the spec, never inside it: the home layout is the only one walkdown
// answers for, and the fixture's `.walkdown` declares exactly these.
const threads = join(root, 'threads');
const runs = join(root, 'runs');
/*
 * A home that declares who is sitting here. Every write this server makes is
 * recorded under the config's identity now - a name in a request is asserted
 * and never proved, since this server has no authentication - so a fixture
 * with no identity is a machine that refuses to accept work, which is a
 * different test and lives beside the first one.
 */
const DECLARED_HOME = join(root, 'home-declared');
// The name an ID ends with: `main` in `0001-fx-main` (ADR 0014 §2).
const nm = (id) => String(id).replace(/^\d{4}-[a-z0-9]{2,3}-/, '');
const GUESSING_HOME = join(root, 'home-guessing');
let base;
let server;
/*
 * A home that names nobody - but knows the same blueprints. The registry
 * lives in the home (ADR 0003), so a home swapped in for its missing
 * identity has to carry the registry with it, or the refusal under test is
 * "nothing registered" rather than "nobody named".
 */
const guessing = () => {
  writeFileSync(join(GUESSING_HOME, 'registry.yml'), readFileSync(join(DECLARED_HOME, 'registry.yml'), 'utf8'));
  process.env.WALKDOWN_HOME = GUESSING_HOME;
};

before(async () => {
  mkdirSync(DECLARED_HOME, { recursive: true });
  mkdirSync(GUESSING_HOME, { recursive: true });
  writeFileSync(
    join(DECLARED_HOME, 'profile.yml'),
    'identity:\n  username: serve-person\n  name: A Serve Person\n',
  );
  process.env.WALKDOWN_HOME = DECLARED_HOME;
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(threads, { recursive: true });
  mkdirSync(join(root, 'proto'), { recursive: true });
  writeFileSync(join(bp, 'spec.yml'), 'blueprint: serve-fixture\nprototype: { root: proto/ }\n');
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
  mkdirSync(runs, { recursive: true });
  writeFileSync(
    join(runs, '2026-01-01T00-00-00Z-local-01.json'),
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
   * Registered, not discovered. The server used to walk the fixture root for
   * `walkdown.yml` files, then read a committed list; it reads the registry
   * now (ADR 0003), so the fixture registers its two homes the way
   * `walkdown import` would - each home is `blueprint/` with the records
   * beside it, and each is its own project.
   */
  register({ id: 'main', project: root, homeDir: root });
  register({ id: 'sibling', project: join(root, 'sibling'), homeDir: join(root, 'sibling') });

  // Started IN the fixture: the `.walkdown` that answers where a server is
  // started is the scope of what it offers, never the served blueprint's
  // parent (n-0159).
  server = createWalkdownServer(bp, { cwd: root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
});

test('GET /api/blueprint returns rows, storyboard, and config bits', async () => {
  const data = await (await fetch(`${base}/api/blueprint`)).json();
  assert.equal(data.blueprint, 'serve-fixture');
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

test('the review page bakes in nothing, and has no front door of its own', async () => {
  const html = await (await fetch(`${base}/`)).text();
  /*
   * It used to be handed the blueprint's front door and the key of the
   * blueprint the server started in, so walkdown's own root framed one
   * project's front page and opened its board over it. A server offering
   * every project this machine has imported has no front door (ADR 0001 §3),
   * and its root is the project modal's case: nothing to route from, so the
   * panel asks which project.
   */
  assert.doesNotMatch(html, /__FRONT_DOOR__|__BLUEPRINT__/, 'no placeholder is left unsubstituted');
  assert.doesNotMatch(html, /prototype\/home\.html/, 'and none is substituted either');
  const home = await (await fetch(`${base}/api/blueprint`)).json();
  const current = home.blueprints.find((p) => p.current);
  assert.ok(current.key, JSON.stringify(current));
  assert.ok(!html.includes(`'${current.key}'`), 'no blueprint is baked in');
  // The fragment is still how you point it at a page - that gesture is what
  // the extension uses too, and it is the only thing that frames anything.
  assert.match(html, /location\.hash/);
});

test('the page is served whatever ?bp= names; the API refuses a blueprint it does not have @rule:panel.start.address-keeps-the-pick', async () => {
  // The address carries the pick so a reload comes back to it. A blueprint
  // forgotten since is then a name that opens nothing: the page still comes,
  // and it is the panel that hears the 404 and asks which project instead.
  const page = await fetch(`${base}/?bp=no.such.blueprint`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /location\.hash/);
  const api = await fetch(`${base}/api/blueprint?bp=no.such.blueprint`);
  assert.equal(api.status, 404);
  assert.match((await api.json()).error, /unknown project/);
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
  const onDisk = parse(readFileSync(threadAt(threads, 'n-0001'), 'utf8'));
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
  const onDisk = parse(readFileSync(threadAt(threads, res.id), 'utf8'));
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
  const anchoredDisk = parse(readFileSync(threadAt(threads, anchored.id), 'utf8'));
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
    parse(readFileSync(threadAt(threads, stray.id), 'utf8')).anchor.offset,
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
  const junkDisk = parse(readFileSync(threadAt(threads, junk.id), 'utf8'));
  assert.equal(junkDisk.anchor.position, undefined);
});

test('a pin records the surface it was placed on', async () => {
  const pin = (anchor) =>
    fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', body: 'On this surface.', author: 'tester', anchor }),
    }).then((r) => r.json());
  const onDisk = async (id) => parse(readFileSync(threadAt(threads, id), 'utf8'));

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
  const onDisk = parse(readFileSync(threadAt(threads, res.id), 'utf8'));
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
    parse(readFileSync(threadAt(threads, noWidth.id), 'utf8')).anchor.viewport,
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
  const w = parse(readFileSync(threadAt(threads, wide.id), 'utf8')).anchor;
  const n = parse(readFileSync(threadAt(threads, narrow.id), 'utf8')).anchor;
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
    join(said, 'profile.yml'),
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
  process.env.WALKDOWN_HOME = GUESSING_HOME;
  let guessed;
  try {
    guessed = defaultActor(process.cwd());
    assert.equal(guessed.declared, false);
    assert.notEqual(guessed.source, 'config');
  } finally {
    process.env.WALKDOWN_HOME = DECLARED_HOME;
  }
  assert.ok(guessed.username.length > 0, 'though it still always has a name to offer');

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
        signatures: [{ role: 'eng', signer: 'topher' }],
        results: [{ rule: 'demo.main.thing', status: 'pass' }],
      }),
    })
  ).json();
  assert.ok(res.run_id, JSON.stringify(res));
  const file = readdirSync(runs).find((f) => f.includes(res.run_id));
  const record = JSON.parse(readFileSync(join(runs, file), 'utf8'));
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
        signatures: [{ role: 'eng', signer: 'topher' }],
        results: [{ rule: 'demo.main.thing', status: 'approved', threads: ['n-0001'] }],
      }),
    })
  ).json();
  assert.ok(res.run_id, JSON.stringify(res));
  const file = readdirSync(runs).find((f) => f.includes(res.run_id));
  const record = JSON.parse(readFileSync(join(runs, file), 'utf8'));
  assert.equal(record.results[0].status, 'approved');
  // An approval is of the statement as written, so it is hash-stamped like a pass.
  assert.equal(record.results[0].statement_hash, formatHash('The visitor can do the thing.'));
  // Named by the thread's UUID, which a second branch's n-0001 cannot share (ADR 0014 §9).
  const n1 = readdirSync(join(runs, '..', 'threads'))
    .map((f) => readFileSync(join(runs, '..', 'threads', f), 'utf8'))
    .find((t) => /^id: n-0001$/m.test(t));
  assert.ok(n1, 'n-0001 was filed earlier in this file');
  assert.deepEqual(record.results[0].threads, [n1.match(/^uuid: (.+)$/m)[1]]);
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

test('every field a sitting carries survives the door, the writer and the read back', async () => {
  /*
   * Field by field, driven by the schema itself rather than by a list typed
   * here — the point is that a field added to lib/sitting.js is carried by
   * this door without anybody remembering to teach it. Every silent drop this
   * repo has had (roles twice, signatures twice) was a door that knew about a
   * field one release later than the panel did, and none of them failed
   * anywhere; they were found by reading JSON afterwards.
   */
  const draftsDir = resolveLocations({ spec: bp, cwd: root }).drafts.path;
  const FULL = {
    started: '2026-09-07T09:00:00Z',
    signatures: [
      { role: 'eng', signer: 'topher' },
      { role: 'product', signer: 'sam' },
    ],
    verdicts: { 'demo.main.thing': 'pass' },
    threads: { 'demo.main.thing': ['n-0001'] },
  };
  assert.deepEqual(Object.keys(FULL).sort(), [...SITTING_FIELDS].sort());

  const posted = await fetch(`${base}/api/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target: 'local', ...FULL }),
  }).then((r) => r.json());
  const onDisk = JSON.parse(readFileSync(join(draftsDir, 'local.json'), 'utf8'));
  const readBack = await (await fetch(`${base}/api/draft?target=local`)).json();
  const payload = await (await fetch(`${base}/api/blueprint`)).json();

  for (const field of SITTING_FIELDS) {
    assert.deepEqual(posted.draft[field], FULL[field], `the door answered with no ${field}`);
    assert.deepEqual(onDisk[field], FULL[field], `${field} never reached the file`);
    assert.deepEqual(readBack.draft[field], FULL[field], `GET /api/draft dropped ${field}`);
    // And on the payload the panel boots from, which is what a reload
    // restores the sitting out of.
    assert.deepEqual(payload.draft[field], FULL[field], `the blueprint payload dropped ${field}`);
  }

  // Then the last hop: the sitting is sealed, and what it was signed by is
  // on the run rather than on nothing.
  const sealed = await fetch(`${base}/api/walkdowns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: 'local',
      signatures: FULL.signatures,
      results: [{ rule: 'demo.main.thing', status: 'pass' }],
    }),
  }).then((r) => r.json());
  const record = JSON.parse(
    readFileSync(join(runs, readdirSync(runs).find((f) => f.startsWith(sealed.run_id))), 'utf8'),
  );
  assert.deepEqual(record.signatures, FULL.signatures);
  assert.equal(existsSync(join(draftsDir, 'local.json')), false);
});

test('a session drafts to disk and finishing seals it into one run', async () => {
  /*
   * Asked, not assumed. Drafts do not follow the spec into a repository - a
   * half-finished sitting is one person's working state - so where they land
   * is a resolved location, and a test that hardcoded the blueprint's own
   * folder would be asserting the old default rather than the behaviour.
   */
  const draftsDir = resolveLocations({ spec: bp, cwd: root }).drafts.path;
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

  /*
   * And who the sitting is being signed by, because the draft is what a
   * reload restores FROM. Dropped at this door, a sitting declared as eng and
   * product came back from a reload as eng alone - silently, mid-walkdown
   * (n-0230).
   */
  await post({
    started: '2026-08-24T00:00:00Z',
    verdicts: { 'demo.main.thing': 'approved' },
    signatures: [
      { role: 'eng', signer: 'topher' },
      { role: 'product', signer: 'sam' },
    ],
  });
  draft = JSON.parse(readFileSync(draftFile, 'utf8'));
  assert.deepEqual(draft.signatures, [
    { role: 'eng', signer: 'topher' },
    { role: 'product', signer: 'sam' },
  ]);
  // Validated here too, so a draft can never hold a signature the run door
  // would refuse when the sitting is finished.
  const refused = await fetch(`${base}/api/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      started: '2026-08-24T00:00:00Z',
      verdicts: { 'demo.main.thing': 'approved' },
      signatures: [{ role: 'eng', signer: 'agent' }],
    }),
  });
  assert.equal(refused.status, 400);
  // Not a run: no run id, and it is nowhere near runs/.
  assert.equal(draft.run_id, undefined);
  assert.ok(!readdirSync(runs).some((f) => f.includes('local.json')));
  // Kept out of git by the home's own .gitignore, never by one of its own,
  // which overruled a home committed whole (ADR 0014 §7).
  assert.ok(!existsSync(join(draftsDir, '.gitignore')));

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
  const before = readdirSync(runs).length;
  const sealed = await (
    await fetch(`${base}/api/walkdowns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'topher',
        signatures: [{ role: 'eng', signer: 'topher' }],
        results: [{ rule: 'demo.main.thing', status: 'pass' }],
      }),
    })
  ).json();
  assert.ok(sealed.run_id);
  assert.equal(readdirSync(runs).length, before + 1);
  assert.equal(readDraft(draftsDir), null);

  // Discarding writes nothing and leaves nothing.
  await post({ actor: 'topher', verdicts: { 'demo.main.thing': 'fail' } });
  assert.ok(readDraft(draftsDir));
  assert.deepEqual(await post({ discard: true }), { draft: null });
  assert.equal(readDraft(draftsDir), null);
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

test("an as-built drawing is served as written, from the project's own folder @rule:screens.surfaces.as-built-drawing", async () => {
  mkdirSync(join(root, 'as-built'), { recursive: true });
  const page = '<!doctype html><html data-theme="redline"><body><h1 data-testid="home.cta">as built</h1></body></html>';
  writeFileSync(join(root, 'as-built', 'home.html'), page);
  const res = await fetch(`${base}/as-built/home.html`);
  assert.equal(res.status, 200);
  // Byte for byte: no theme swapped in, no ring, no label. What the drawing
  // says about itself is the project's business (ADR 0007).
  assert.equal(await res.text(), page);
  assert.equal((await fetch(`${base}/as-built/nope.html`)).status, 404);
  // The folder and nothing above it.
  assert.equal((await fetch(`${base}/as-built/../blueprint/walkdown.yml`)).status, 404);
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
  guessing();
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
  const bp2 = root2;
  const runs2 = join(root2, 'runs');
  mkdirSync(join(bp2, 'features'), { recursive: true });
  mkdirSync(join(root2, 'threads'), { recursive: true });
  mkdirSync(runs2, { recursive: true });
  register({ id: 'drift-fixture', project: root2, homeDir: root2 });
  writeFileSync(
    join(bp2, 'spec.yml'),
    'blueprint: drift-fixture\nauthoring: { location: [suite/] }\n',
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
      join(runs2, '2026-01-01T00-00-00Z-local-01.json'),
      JSON.stringify({
        run_id: '2026-01-01T00-00-00Z-local-01',
        created: '2026-01-01T00:00:00Z',
        actor: 'agent',
        kind: 'checks',
        target: 'local',
        results: [{ rule: 'd.s.thing', status: 'pass', checks }],
      }),
    );
  const srv = createWalkdownServer(bp2, { cwd: root2 });
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
    rmSync(join(runs2, '2026-01-01T00-00-00Z-local-01.json'));
    const unrecorded = await ask();
    assert.equal(unrecorded[0].ref, 'suite/demo.spec.js:5');
    assert.equal(unrecorded[0].recorded, undefined);
    assert.match(unrecorded[0].source, /realBody/);
  } finally {
    srv.close();
    rmSync(root2, { recursive: true, force: true });
  }
});

test('multi-blueprint: sibling blueprints are discovered and ?bp= switches, membership-validated', async () => {
  mkdirSync(join(root, 'sibling', 'features'), { recursive: true });
  writeFileSync(join(root, 'sibling', 'spec.yml'), 'blueprint: sibling-app\n');
  writeFileSync(
    join(root, 'sibling', 'features', 'f.yml'),
    'feature: f\nstories:\n  - id: f.s\n    rules:\n      - id: f.s.one\n        statement: One.\n        verify: [checks]\n',
  );

  const home = await (await fetch(`${base}/api/blueprint`)).json();
  const ids = home.blueprints.map((p) => nm(p.id)).sort();
  // The config entry's id, not a path relative to wherever this server was
  // started — the same string on every machine.
  assert.deepEqual(ids, ['main', 'sibling']);
  assert.ok(home.blueprints.find((p) => nm(p.id) === 'main').current);

  const sibling = await (
    await fetch(`${base}/api/blueprint?bp=sibling`)
  ).json();
  assert.equal(sibling.blueprint, 'sibling-app');
  assert.equal(sibling.rows[0].rule, 'f.s.one');
  assert.ok(sibling.blueprints.find((p) => nm(p.id) === 'sibling').current);

  assert.equal((await fetch(`${base}/api/blueprint?bp=../../etc`)).status, 404);
});

test('two listed blueprints sharing an id are told apart by key, and a bare ?bp= that names both is refused @rule:locations.default.one-home-per-blueprint', async () => {
  /*
   * n-0173 (2): mono/app committed at the root and mono/app/packs/app listed
   * personally are both `app`, and the chooser served the root's for either.
   * A key is the spec directory - unique by construction - and an id that
   * names two is refused with the choices rather than resolved to the first.
   */
  mkdirSync(join(root, 'twin', 'features'), { recursive: true });
  writeFileSync(join(root, 'twin', 'spec.yml'), 'blueprint: the-twin\n');
  writeFileSync(
    join(root, 'twin', 'features', 'f.yml'),
    'feature: f\nstories:\n  - id: f.s\n    rules:\n      - id: f.s.twin\n        statement: Twin.\n        verify: [checks]\n',
  );
  // A second row under the SAME id, written by hand into the registry: the
  // writer de-duplicates ids, and this is the collision the key exists for.
  const cfg = join(DECLARED_HOME, 'registry.yml');
  const before = readFileSync(cfg, 'utf8');
  writeFileSync(
    cfg,
    before +
      `  - id: 0099-tw-sibling\n    project: twin\n    code: tw\n    checkout: ${join(root, 'twin')}\n    home: ${join(root, 'twin')}\n    registered: { by: import, at: '2026-01-01T00:00:00Z' }\n`,
  );
  try {
    const home = await (await fetch(`${base}/api/blueprint`)).json();
    const twins = home.blueprints.filter((p) => nm(p.id) === 'sibling');
    assert.equal(twins.length, 2);
    assert.notEqual(twins[0].key, twins[1].key);
    const refused = await fetch(`${base}/api/blueprint?bp=sibling`);
    assert.equal(refused.status, 409);
    const body = await refused.json();
    assert.equal(body.candidates.length, 2);
    const twin = twins.find((p) => p.key.endsWith('/twin'));
    const picked = await (await fetch(`${base}/api/blueprint?bp=${encodeURIComponent(twin.key)}`)).json();
    assert.equal(picked.blueprint, 'the-twin');
    assert.ok(picked.blueprints.find((p) => p.key === twin.key).current);
    // A write through an ambiguous name lands nowhere.
    const write = await fetch(`${base}/api/threads?bp=sibling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', body: 'nowhere', author: 'tester' }),
    });
    assert.equal(write.status, 409);
    assert.ok(!existsSync(join(root, 'twin', 'threads')));
  } finally {
    writeFileSync(cfg, before);
  }
});

test('a pin files against the page\u2019s own project, not the server\u2019s default', async () => {
  // The sibling project is created by the multi-project test above; this one
  // is about where a WRITE lands, which is the part a mis-routed pin gets wrong.
  mkdirSync(join(root, 'sibling', 'threads'), { recursive: true });
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
    readFileSync(threadAt(root, 'sibling', 'threads', res.id), 'utf8'),
  );
  assert.equal(filed.body, 'Belongs to the sibling.');
  const inDefault = threadAt(threads, res.id);
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
  const disk = parse(readFileSync(threadAt(threads, note.id), 'utf8'));
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
  guessing();
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
  const disk = parse(readFileSync(threadAt(threads, note.id), 'utf8'));
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

test('a via the door cannot use is refused, never quietly erased @rule:threads.lifecycle.claim-never-accept', async () => {
  /*
   * The sanitizer dropped anything it did not like - a non-string, or a
   * string over forty characters - to null, and null is how the acceptance
   * gate spells "no machine was involved". So the agent that described
   * itself honestly and at length walked straight through the gate that
   * n-0212 had just closed: forty characters refused, forty-one accepted
   * (n-0216). Erasure and absence must never be the same thing.
   */
  const post = (path, body) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const opened = await post('/api/threads', {
    kind: 'note',
    body: 'Typed by a machine.',
    via: 'agent',
    anchor: { element: 'home.cta' },
    url: 'http://localhost:3000/home',
  }).then((r) => r.json());
  const file = threadAt(threads, opened.id);
  const before = readFileSync(file, 'utf8');
  const long = 'an automated judging agent driven by claude-opus-5 on behalf of the person here';
  assert.equal(long.length > 40, true);
  for (const via of [long, ['agent'], { name: 'agent' }, 42, true, '   ']) {
    for (const status of ['verified', 'waived']) {
      const res = await post(`/api/threads/${opened.id}/status`, {
        status,
        reason: 'because I say so',
        via,
      });
      assert.equal(res.status, 400, `${JSON.stringify(via)} → ${status} must be refused`);
    }
    const res = await post(`/api/threads/${opened.id}/replies`, { body: 'anything', via });
    assert.equal(res.status, 400, `${JSON.stringify(via)} on a reply must be refused`);
  }
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing refused may reach the disk');
});

test('via rides through the API on a note, a reply and a move @rule:status.attribution.username-is-the-record @rule:threads.lifecycle.acts-for-a-person', async () => {
  /*
   * The CLI has always carried provenance (--as-agent); the HTTP door dropped
   * it, so an agent driving the panel or the embed filed under a person's
   * bare name, and the embed showed the opening note with no `via` while the
   * reply under it said `via agent` (n-0152).
   *
   * Since 2026-09-17 provenance follows the WORDS: a machine relaying what a
   * person said (`said`) records it under the person with the mark beside
   * them and its own addition apart; a machine's own words are the agent's.
   */
  const post = (path, body) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const { id } = await post('/api/threads', {
    kind: 'note',
    said: 'The label reads wrong.',
    body: 'On the second screen, at 375.',
    via: 'agent',
    anchor: { element: 'home.cta' },
    url: 'http://localhost:3000/home',
  });
  const file = threadAt(threads, id);
  const opened = parse(readFileSync(file, 'utf8'));
  assert.equal(opened.via, 'agent');
  assert.equal(opened.author, 'serve-person', 'relayed words are the person\'s');
  assert.equal(opened.body, 'The label reads wrong.', 'as they typed them');
  assert.equal(opened.added, 'On the second screen, at 375.', 'and the machine\'s addition is apart');
  assert.equal(opened.reason, 'feedback', 'a person\'s words, so feedback and not an observation');
  await post(`/api/threads/${id}/replies`, { said: 'Still wrong.', added: 'Checked at 1440 too.', via: 'agent' });
  await post(`/api/threads/${id}/replies`, { body: 'Fixed the label.', via: 'agent' });
  const replies = parse(readFileSync(file, 'utf8')).replies;
  assert.equal(replies.length, 2);
  assert.equal(replies[0].via, 'agent');
  assert.equal(replies[0].author, 'serve-person');
  assert.equal(replies[0].added, 'Checked at 1440 too.');
  assert.equal(replies[1].author, 'agent', 'the machine\'s own words are its own');
  assert.equal(replies[1].via, undefined, 'and need no mark - the author IS the machine');
  assert.equal(replies[1].added, undefined);
  await post(`/api/threads/${id}/status`, { status: 'addressed', reason: 'done', via: 'agent' });
  const t = parse(readFileSync(file, 'utf8'));
  assert.equal(t.status, 'addressed');
  // The reason is the machine's sentence, recorded as its own reply.
  assert.equal(t.replies.at(-1).author, 'agent');
  // What the embed and the panel read back carries it too.
  const listed = (await (await fetch(`${base}/api/blueprint`)).json()).threads.find((x) => x.id === id);
  assert.equal(listed.via, 'agent');
  assert.equal(listed.added, 'On the second screen, at 375.');
  // `added` without the person's words is refused: there is nothing for it
  // to sit beside.
  const bad = await fetch(`${base}/api/threads/${id}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'x', added: 'y', via: 'agent' }),
  });
  assert.equal(bad.status, 400);
});

/*
 * Started outside every registered project (GitHub issue #19). One server
 * answers for every registered blueprint, so where it was started decides
 * nothing but a default - and with no default, a request naming no
 * blueprint gets the list to choose from, never a refusal to start.
 */
test('a server started outside any project offers every registered blueprint, with no default @rule:locations.answer.serve-starts-anywhere', async () => {
  process.env.WALKDOWN_HOME = DECLARED_HOME;
  const elsewhere = mkdtempSync(join(tmpdir(), 'walkdown-nowhere-'));
  const loose = createWalkdownServer(null, { cwd: elsewhere });
  await new Promise((r) => loose.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${loose.address().port}`;
  try {
    // Nothing named: the list, and no board.
    const unnamed = await (await fetch(`${at}/api/blueprint`)).json();
    assert.equal(unnamed.key, null);
    assert.deepEqual(unnamed.blueprints.map((b) => nm(b.id)).sort(), ['main', 'sibling']);
    assert.ok(unnamed.blueprints.every((b) => !b.current));
    assert.equal(unnamed.rows, undefined, 'no blueprint, so no rules');

    // The page, the scripts and whose page an address is need no blueprint.
    for (const path of ['/', '/embed.js', '/panel.js', '/walkdown.css'])
      assert.equal((await fetch(at + path)).status, 200, path);
    const whose = await (await fetch(`${at}/api/whose?url=${encodeURIComponent('http://x.test/home')}`)).json();
    assert.ok(Array.isArray(whose.matches));

    // Everything else is asked by name, and says so when it is not.
    const threads = await fetch(`${at}/api/threads`);
    assert.equal(threads.status, 404);
    assert.match((await threads.json()).error, /\?bp=/);

    // Named, it is that blueprint's, as on any server.
    const named = await (await fetch(`${at}/api/blueprint?bp=main`)).json();
    assert.equal(named.blueprint, 'serve-fixture');
    assert.ok(named.rows.some((r) => r.rule === 'demo.main.thing'));

    // Started in a project instead, that blueprint answers a request naming none.
    const defaulted = await (await fetch(`${base}/api/blueprint`)).json();
    assert.equal(defaulted.key, named.key);
    assert.equal(defaulted.blueprint, 'serve-fixture');
  } finally {
    loose.closeAllConnections();
    loose.close();
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('`walkdown serve` starts outside any project rather than refusing @rule:locations.answer.serve-starts-anywhere', async () => {
  process.env.WALKDOWN_HOME = DECLARED_HOME;
  const elsewhere = mkdtempSync(join(tmpdir(), 'walkdown-nowhere-'));
  const { spawn } = await import('node:child_process');
  const bin = new URL('../bin/walkdown.js', import.meta.url).pathname;
  const child = spawn(process.execPath, [bin, 'serve', '--port', '0'], {
    cwd: elsewhere,
    env: { ...process.env, WALKDOWN_HOME: DECLARED_HOME, NO_COLOR: '1' },
  });
  try {
    const said = await new Promise((resolveSaid, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`no answer: ${out}`)), 10_000);
      const take = (chunk) => {
        out += chunk;
        if (/review:/.test(out)) {
          clearTimeout(timer);
          resolveSaid(out);
        }
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`exited ${code}: ${out}`));
      });
    });
    assert.match(said, /every blueprint registered on this machine \(2\)/);
    assert.match(said, /outside a registered project/);
    assert.doesNotMatch(said, /No blueprint here/);
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }

  // With --blueprint, from the same place: that one is the default, and a
  // name nothing registered is refused rather than served without it.
  const run = (args) =>
    new Promise((resolveRun) => {
      const c = spawn(process.execPath, [bin, 'serve', '--port', '0', ...args], {
        cwd: elsewhere,
        env: { ...process.env, WALKDOWN_HOME: DECLARED_HOME, NO_COLOR: '1' },
      });
      let out = '';
      const done = () => {
        c.kill();
        resolveRun(out);
      };
      const timer = setTimeout(done, 10_000);
      c.stdout.on('data', (d) => {
        out += d;
        if (/review:/.test(out)) {
          clearTimeout(timer);
          done();
        }
      });
      c.stderr.on('data', (d) => (out += d));
      c.on('exit', () => {
        clearTimeout(timer);
        resolveRun(out);
      });
    });
  try {
    const mainId = parse(readFileSync(join(DECLARED_HOME, 'registry.yml'), 'utf8')).blueprints.find((r) => nm(r.id) === 'main').id;
    assert.match(await run(['--blueprint', mainId]), /a page naming none opens .*walkdown-serve-/);
    assert.match(await run(['--blueprint', 'nobody']), /No blueprint for `nobody`/);
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('a blueprint registered or drawn after the server started is found from its own page, without a restart @rule:locations.answer.serve-starts-anywhere', async () => {
  process.env.WALKDOWN_HOME = DECLARED_HOME;
  const late = join(root, 'late');
  mkdirSync(late, { recursive: true });
  writeFileSync(
    join(late, 'spec.yml'),
    'blueprint: late\nrunner:\n  targets:\n    local:\n      base_url: http://late.test\n',
  );
  writeFileSync(
    join(late, 'storyboard.yml'),
    'screens:\n  - id: arrival\n    app: { path: /arrival }\n',
  );
  const whose = async () =>
    (await (await fetch(`${base}/api/whose?url=${encodeURIComponent('http://late.test/arrival')}`)).json()).matches;
  assert.deepEqual(await whose(), [], 'nothing claims it before it is registered');
  register({ id: 'late', project: late, homeDir: late });
  const after = await whose();
  assert.equal(after.length, 1);
  assert.equal(nm(after[0].id), 'late');

  // And a screen drawn after that - the order walkdown-formulate works in,
  // registering at init and writing the storyboard later - is found too.
  const later = `${base}/api/whose?url=${encodeURIComponent('http://late.test/departure')}`;
  assert.deepEqual((await (await fetch(later)).json()).matches, []);
  writeFileSync(
    join(late, 'storyboard.yml'),
    'screens:\n  - id: arrival\n    app: { path: /arrival }\n  - id: departure\n    app: { path: /departure }\n',
  );
  const { utimesSync } = await import('node:fs');
  const soon = new Date(Date.now() + 2000);
  utimesSync(join(late, 'storyboard.yml'), soon, soon);
  assert.equal((await (await fetch(later)).json()).matches[0]?.screen, 'departure');
});
