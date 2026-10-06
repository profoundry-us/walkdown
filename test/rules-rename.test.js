/*
 * A RULE RENAMED KEEPS EVERY VERDICT (ADR 0014, n-0355).
 *
 * A rule with a checks run, an agent verdict, a signature and a thread is
 * renamed. Its old id stays on it under `formerly:`, status reads every
 * verdict under the new id from records nobody edited, and a test still
 * tagged with the old id counts while lint names it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { threadAt } from '../tools/test-home.mjs';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-rename-')));
  roots.push(root);
  const home = join(root, 'home');
  const shop = join(root, 'shop');
  mkdirSync(shop, { recursive: true });
  mkdirSync(home, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: shop });
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: topher\n');
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: topher\n');
  const env = { ...process.env, WALKDOWN_HOME: home, WALKDOWN_SKILLS_DIR: join(home, 'skills'), NO_COLOR: '1' };
  delete env.WALKDOWN_SPEC;
  const wd = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: shop, encoding: 'utf8', env });
  assert.equal(wd(['blueprints', 'new', 'shop']).status, 0);
  const at = JSON.parse(wd(['where', '--json']).stdout);
  const features = join(at.spec.path, 'features');
  writeFileSync(
    join(features, 'shop.yml'),
    [
      'feature: shop',
      'stories:',
      '  - id: shop.cart',
      '    title: A cart',
      '    statement: As a shopper I keep things in a cart.',
      '    rules:',
      '      - id: shop.cart.init-adds',
      '        statement: Adding an item puts it in the cart.',
      '        verify: [checks]',
      '        signoff: [eng]',
      '        steps:',
      '          then: [It is in the cart]',
      '      - id: shop.cart.remove',
      '        statement: Removing an item takes it out.',
      '        verify: [checks]',
      '        steps:',
      '          then: [It is gone]',
      '',
    ].join('\n'),
  );
  assert.equal(wd(['hash', '--write', '--blueprint', 'shop']).status, 0);
  const hash = readFileSync(join(features, 'shop.yml'), 'utf8').match(/statement_hash: (sha256:[0-9a-f]+)/)[1];
  mkdirSync(at.runs.path, { recursive: true });
  const put = (name, record) =>
    writeFileSync(join(at.runs.path, `${name}.json`), `${JSON.stringify({ run_id: name, ...record }, null, 2)}\n`);
  put('2026-10-01T10-00-00Z-local-01', {
    created: '2026-10-01T10:00:00Z', actor: 'topher', kind: 'checks', target: 'local',
    results: [{ rule: 'shop.cart.init-adds', status: 'pass', statement_hash: hash }],
  });
  put('2026-10-01T11-00-00Z-local-01', {
    created: '2026-10-01T11:00:00Z', actor: 'agent', kind: 'walkdown', target: 'local',
    results: [{ rule: 'shop.cart.init-adds', status: 'pass', statement_hash: hash, reasoning: 'It was in the cart after adding it.' }],
  });
  put('2026-10-01T12-00-00Z-local-01', {
    created: '2026-10-01T12:00:00Z', actor: 'topher', kind: 'walkdown', target: 'local',
    signatures: [{ role: 'eng', signer: 'topher' }],
    results: [{ rule: 'shop.cart.init-adds', status: 'pass', statement_hash: hash }],
  });
  mkdirSync(at.threads.path, { recursive: true });
  writeFileSync(
    threadAt(at.threads.path, 'n-0001'),
    'id: n-0001\nkind: note\nreason: feedback\nauthor: topher\ncreated: 2026-10-01T12:30:00Z\nanchor:\n  rule: shop.cart.init-adds\nstatus: open\nbody: The id says init.\n',
  );
  // A test, in the code, still tagged with the old id.
  // Spelled in two halves, so this file is not itself a test tagged with it.
  mkdirSync(join(shop, 'tests'), { recursive: true });
  writeFileSync(join(shop, 'tests', 'cart.test.js'), `test('adds @${'rule'}:shop.cart.init-adds', () => {});\n`);
  const runsBefore = Object.fromEntries(
    readdirSync(at.runs.path).map((f) => [f, readFileSync(join(at.runs.path, f), 'utf8')]),
  );
  return { wd, at, features, runsBefore };
}

const cells = (wd, rule) => JSON.parse(wd(['status', rule, '--json']).stdout);

test('a renamed rule keeps its verdicts, its threads follow it, and its old tag still counts @rule:commands.rules.rename', () => {
  const { wd, at, features, runsBefore } = fixture();
  const before = cells(wd, 'shop.cart.init-adds');

  const r = wd(['rules', 'rename', 'shop.cart.init-adds', 'shop.cart.add', '--blueprint', 'shop']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /renamed/);

  const text = readFileSync(join(features, 'shop.yml'), 'utf8');
  assert.match(text, /- id: shop\.cart\.add\n\s+formerly: \[shop\.cart\.init-adds\]/);
  assert.equal(
    text.match(/statement_hash: (sha256:[0-9a-f]+)/)[1],
    before.statement_hash ?? text.match(/statement_hash: (sha256:[0-9a-f]+)/)[1],
  );

  const after_ = cells(wd, 'shop.cart.add');
  // The verdicts were really there to keep, and they were kept.
  assert.equal(before.cells.local.state, 'pass');
  assert.equal(before.agent.state, 'pass');
  assert.equal(before.acceptance[0].state, 'signed');
  assert.deepEqual(after_.cells, before.cells);
  assert.deepEqual(after_.agent, before.agent);
  assert.deepEqual(after_.acceptance, before.acceptance);
  assert.equal(after_.verdict, before.verdict);

  // No run record was edited.
  for (const [f, body] of Object.entries(runsBefore)) assert.equal(readFileSync(join(at.runs.path, f), 'utf8'), body, f);

  // The thread is anchored to the new id.
  assert.match(readFileSync(threadAt(at.threads.path, 'n-0001'), 'utf8'), /rule: shop\.cart\.add\n/);

  // The old tag counts, and lint names it with the id to use.
  const lint = wd(['lint']);
  assert.match(lint.stdout, /renamed - tag it `shop\.cart\.add`/);
  assert.doesNotMatch(lint.stdout, /no such rule exists/);
  assert.doesNotMatch(lint.stdout, /shop\.cart\.add: verify includes checks but no check/);
});

test('a taken id, a former id of another rule, or a non-id is refused and nothing changes @rule:commands.rules.rename', () => {
  const { wd, features } = fixture();
  assert.equal(wd(['rules', 'rename', 'shop.cart.init-adds', 'shop.cart.add', '--blueprint', 'shop']).status, 0);
  const text = readFileSync(join(features, 'shop.yml'), 'utf8');

  for (const [to, says] of [
    ['shop.cart.remove', /already a rule/],
    ['shop.cart.init-adds', /was an id of `shop\.cart\.add`/],
    ['Not An Id', /is not a rule id/],
  ]) {
    const from = to === 'shop.cart.init-adds' ? 'shop.cart.remove' : 'shop.cart.add';
    const r = wd(['rules', 'rename', from, to, '--blueprint', 'shop']);
    assert.equal(r.status, 2, to);
    assert.match(r.stderr, says, to);
    assert.match(r.stderr, /Nothing was renamed/);
    assert.equal(readFileSync(join(features, 'shop.yml'), 'utf8'), text, to);
  }
});
