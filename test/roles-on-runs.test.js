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
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { defaultActor } from '../lib/identity.js';
import { deriveStatus } from '../lib/status.js';
import { normalizeRoles, normalizeSignatures, writeRunRecord } from '../lib/run-record.js';
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

/*
 * The proxy case, end to end: one person drives, two people sign.
 *
 * This is the walk two people actually do - Topher driving while Sam accepts
 * product beside him - and before signatures there was no honest way to write
 * it down: ticking `product` filed Sam's acceptance under Topher's name.
 */
test('a walkdown signs per role, and a role signed for somebody else says whose it was @rule:status.acceptance.signature-names-its-signer', async () => {
  const out = await (
    await post({
      target: 'local',
      signatures: [
        { role: 'eng', signer: 'roles-person' },
        { role: 'product', signer: 'sam' },
      ],
      results: [{ rule: 'demo.main.thing', status: 'pass' }],
    })
  ).json();
  assert.ok(out.run_id, JSON.stringify(out));
  const record = recordFor(out.run_id);
  assert.deepEqual(record.signatures, [
    { role: 'eng', signer: 'roles-person' },
    { role: 'product', signer: 'sam' },
  ]);
  // Who typed it is the actor, and it is the machine's answer rather than
  // anything the request said - so the proxy needs no second field.
  assert.equal(record.actor, 'roles-person');
  assert.equal('roles' in record, false);

  const rows = deriveStatus({
    config: { runner: { targets: { local: {} } } },
    features: [
      {
        file: 'features/demo.yml',
        data: {
          feature: 'demo',
          stories: [
            {
              id: 'demo.main',
              rules: [
                {
                  id: 'demo.main.thing',
                  statement: 'The visitor can do the thing.',
                  signoff: ['eng', 'product'],
                },
              ],
            },
          ],
        },
      },
    ],
    threads: [],
    runs: [{ file: 'runs/r-0.json', data: record }],
  }).rows;
  const acceptance = rows[0].acceptance;
  const product = acceptance.find((a) => a.role === 'product');
  const eng = acceptance.find((a) => a.role === 'eng');
  assert.equal(product.state, 'signed');
  assert.equal(product.signer, 'sam', 'product counts for the person who accepted');
  assert.equal(product.recordedBy, 'roles-person', 'and says who typed it');
  assert.equal(eng.signer, 'roles-person');
  assert.equal(eng.recordedBy, null, 'signing for yourself is not a proxy');
});

test('a signature is refused where nobody, or a machine, is named as the signer @rule:status.acceptance.signature-names-its-signer', async () => {
  assert.deepEqual(normalizeSignatures(null), null);
  // The signer defaults to whoever ran the walk, which is the ordinary case.
  assert.deepEqual(normalizeSignatures([{ role: 'eng' }], { actor: 'topher' }), [
    { role: 'eng', signer: 'topher' },
  ]);
  // Accepting is the one thing an agent may never do for somebody, in any
  // spelling the actor gate already refuses.
  assert.throws(() => normalizeSignatures([{ role: 'eng', signer: 'AGENT' }]), /never accept/);
  assert.throws(() => normalizeSignatures([{ role: 'wizard', signer: 'sam' }]), /unknown role/);
  assert.throws(
    () => normalizeSignatures([{ role: 'eng', signer: 'a' }, { role: 'eng', signer: 'b' }]),
    /signs once/,
  );

  // And the door refuses it too, rather than filing half of it.
  const bad = await post({
    signatures: [{ role: 'eng', signer: 'agent' }],
    results: [{ rule: 'demo.main.thing', status: 'pass' }],
  });
  assert.equal(bad.status, 400);
});

/*
 * What the door answers with, because the panel says it back. Three sittings
 * filed something nobody chose and none of them said so on screen; the
 * response is where the panel gets the truth from (n-0226).
 */
test('the recording endpoint answers with the signatures it filed @rule:panel.walkdown.records-to-ledger', async () => {
  const out = await (
    await post({
      signatures: [{ role: 'product', signer: 'sam' }],
      results: [{ rule: 'demo.main.thing', status: 'pass' }],
    })
  ).json();
  assert.deepEqual(out.signatures, [{ role: 'product', signer: 'sam' }]);
  // And nothing stated comes back as nothing, rather than as a guess the
  // panel would then report as fact.
  const bare = await (
    await post({ results: [{ rule: 'demo.main.thing', status: 'pass' }] })
  ).json();
  assert.equal(bare.signatures, null);
  assert.equal(bare.roles, null);
});

/*
 * A server older than its tree is the failure that produced n-0226's three
 * cases; the payload is where it becomes visible (n-0227).
 */
test('the payload says whether the running server is older than the code @rule:panel.delivery.stale-copy-says-so', async () => {
  const fresh = await (await fetch(`${base}/api/blueprint`)).json();
  assert.equal(typeof fresh.server?.booted, 'string');
  assert.equal(fresh.server.stale, false, 'a server started after the last edit is current');

  // Touch a module this process would import if it started again. The server
  // in hand booted before that, so it is now serving yesterday's code.
  const target = new URL('../lib/api.js', import.meta.url).pathname;
  const later = new Date(Date.now() + 60_000);
  utimesSync(target, later, later);
  try {
    const after = await (await fetch(`${base}/api/blueprint`)).json();
    assert.equal(after.server.stale, true, 'an edit after boot makes the running code stale');
    assert.ok(after.server.changed, 'and it says when the tree moved');
  } finally {
    const now = new Date();
    utimesSync(target, now, now);
  }
});
