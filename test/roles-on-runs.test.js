/*
 * The write path for roles: what a run record carries, what the recording
 * endpoint accepts, and what the server offers a panel as a default.
 *
 * A ledger law rather than a panel behaviour - the control that picks a role
 * is the panel's, and its check belongs in checks/. This is about what ends up
 * on disk, which no browser can see.
 */
import { declaredHome } from '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { defaultActor } from '../lib/identity.js';
import { normalizeRoles, writeRunRecord } from '../lib/run-record.js';
import { createWalkdownServer } from '../lib/serve.js';
import { ROLES } from '../lib/vocab.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-roles-'));
/*
 * A machine that says who is sitting at it. Recording a walkdown is an
 * acceptance, so it asks for a person who wrote their name down rather than a
 * name the request carried (n-0143). The roles beside it are still the
 * caller's to send: which hats you sign in is a choice you make per sitting,
 * and is not a claim about who you are.
 */
const HOME = join(root, 'home');
/*
 * A home: `blueprint/` with runs beside it, declared in the root's own
 * `.walkdown`. The server is handed the spec and the tree it stands in, the
 * way `walkdown serve` is - runs no longer live inside the blueprint.
 */
let h;
let bp;
let base;
let server;

before(async () => {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(join(HOME, 'config.yml'), 'identity:\n  username: roles-person\n');
  process.env.WALKDOWN_HOME = HOME;
  h = declaredHome(join(root, 'proj'), 'roles-fixture');
  bp = h.spec;
  mkdirSync(join(bp, 'features'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: roles-fixture\n');
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.thing',
      '        statement: The visitor can do the thing.',
      '        signoff: [eng, product]',
    ].join('\n'),
  );
  server = createWalkdownServer(bp, { cwd: h.root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(root, { recursive: true, force: true });
});

/*
 * The direct writes go to a home of their own: `writeRunRecord` resolves the
 * runs directory from the config, and a directory nothing declares has none.
 */
const direct = declaredHome(join(root, 'direct'), 'roles-direct');

const post = (body) =>
  fetch(`${base}/api/walkdowns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const recordFor = (runId) =>
  JSON.parse(
    readFileSync(
      join(h.runs, readdirSync(h.runs).find((f) => f.includes(runId))),
      'utf8',
    ),
  );

test('a run carries the roles its signer was acting in @rule:status.acceptance.roles-recorded-on-the-run', () => {
  const { record } = writeRunRecord({
    blueprintDir: direct.spec,
    runsDir: direct.runs,
    target: 'local',
    actor: 'topher',
    kind: 'walkdown',
    roles: ['eng', 'product'],
    results: [{ rule: 'demo.main.thing', status: 'pass' }],
  });
  assert.deepEqual(record.roles, ['eng', 'product']);

  /*
   * Absent, not empty. A run with no roles is read as engineering's
   * (lib/status.js), so writing `roles: []` would put a shape in the ledger
   * that nothing downstream tells apart from the shape it already means -
   * two spellings of one fact is how a ledger starts disagreeing with
   * itself.
   */
  for (const roles of [undefined, null, [], ['', '  ']]) {
    const { record: r } = writeRunRecord({
      blueprintDir: direct.spec,
    runsDir: direct.runs,
      target: 'local',
      actor: 'topher',
      kind: 'walkdown',
      roles,
      results: [{ rule: 'demo.main.thing', status: 'pass' }],
    });
    assert.equal('roles' in r, false, `roles ${JSON.stringify(roles)} should be absent, not empty`);
  }
});

test('a role outside the vocabulary is refused, never filed @rule:status.acceptance.roles-recorded-on-the-run', () => {
  // A role nothing recognises is not a harmless label: acceptance matches
  // these against a rule's signoff list, so a typo signs nothing while
  // looking exactly like a signature, and the rule waits forever for a
  // person who has already signed it.
  assert.throws(() => normalizeRoles(['eng', 'enginering']), /unknown role "enginering"/);
  assert.throws(() => normalizeRoles(['Product']), /unknown role "Product"/);
  assert.throws(() => normalizeRoles('eng'), /must be an array/);

  // Duplicates are one signature, and order is the caller's.
  assert.deepEqual(normalizeRoles(['product', 'eng', 'product']), ['product', 'eng']);

  // QA is deliberately not a role: the agent walkdown is QA, and that is a
  // tier rather than a signature (docs/00-vision.md).
  assert.deepEqual(ROLES, ['eng', 'product', 'design']);
  assert.throws(() => normalizeRoles(['qa']), /unknown role "qa"/);
});

test('the recording endpoint accepts roles and persists them @rule:status.acceptance.roles-recorded-on-the-run', async () => {
  const ok = await (
    await post({
      actor: 'topher',
      roles: ['eng', 'product'],
      results: [{ rule: 'demo.main.thing', status: 'pass' }],
    })
  ).json();
  assert.ok(ok.run_id, JSON.stringify(ok));
  assert.deepEqual(ok.roles, ['eng', 'product']);
  assert.deepEqual(recordFor(ok.run_id).roles, ['eng', 'product']);

  // An emptied control files a run under no roles at all, which the ledger
  // reads as engineering's - the historical default, stated once.
  const empty = await (
    await post({
      actor: 'topher',
      roles: [],
      results: [{ rule: 'demo.main.thing', status: 'pass' }],
    })
  ).json();
  assert.equal(empty.roles, null);
  assert.equal('roles' in recordFor(empty.run_id), false);

  // Omitting the field entirely is the same thing, so an older panel that
  // has never heard of roles keeps working.
  const legacy = await (
    await post({
      actor: 'topher',
      results: [{ rule: 'demo.main.thing', status: 'pass' }],
    })
  ).json();
  assert.equal('roles' in recordFor(legacy.run_id), false);

  // And a bad role is a 400 with nothing written, rather than a run nobody
  // can act on.
  const before = readdirSync(h.runs).length;
  const bad = await post({
    actor: 'topher',
    roles: ['eng', 'marketing'],
    results: [{ rule: 'demo.main.thing', status: 'pass' }],
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /unknown role "marketing"/);
  assert.equal(readdirSync(h.runs).length, before);
});

test('the identity the server derives carries roles, and the vocabulary to change them @rule:status.acceptance.roles-recorded-on-the-run', async () => {
  const payload = await (await fetch(`${base}/api/blueprint`)).json();
  // The panel round-trips these: they arrive as a default and come back on
  // the run. A default is not a permission - a person changes it per
  // sitting, and what counts is what the run recorded.
  assert.ok(Array.isArray(payload.identity.roles));
  assert.ok(payload.identity.roles.length);
  for (const role of payload.identity.roles) assert.ok(ROLES.includes(role), role);
  assert.deepEqual(payload.identity.knownRoles, ROLES);

  // Nobody has said, so engineering it is - the same answer the ledger gives
  // a run that carries none, which is the point of choosing that default.
  assert.deepEqual(defaultActor(root).roles, ['eng']);
  assert.equal(defaultActor(root).roles_source, 'default');

  // Said out loud, it is honoured - and anything unrecognised is dropped
  // rather than refused, because a bad default must never stop a panel from
  // booting. The write path is where a role is validated for real.
  process.env.WALKDOWN_ROLES = 'product, design, wizard';
  try {
    assert.deepEqual(defaultActor(root).roles, ['product', 'design']);
    assert.equal(defaultActor(root).roles_source, 'env');
  } finally {
    delete process.env.WALKDOWN_ROLES;
  }
});
