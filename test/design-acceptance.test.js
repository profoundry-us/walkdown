/*
 * ADR 0015 §8 - approving every rule on a screen accepts its design. The
 * walkdown that completes the set accepts the screen's pending design
 * request in the signer's name, and the version it proposes becomes the
 * accepted one. Exercised through finishWalkdown, the door the panel's
 * Finish uses, on a throwaway home with a declared person at it.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { lint } from '../lib/lint.js';
import { finishWalkdown, openThread } from '../lib/writes.js';
import { declareProject, threadAt } from '../tools/test-home.mjs';
import { parse } from '../vendor/yaml.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-accept-'));
after(() => rmSync(root, { recursive: true, force: true }));

function project(username = 'design-person') {
  const dir = mkdtempSync(join(root, 'p-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.yml'), `identity:\n  username: ${username}\n`);
  process.env.WALKDOWN_HOME = home;
  const proj = join(dir, 'proj');
  const bp = join(proj, '.walkdown', 'blueprints', '0001-accept');
  mkdirSync(join(bp, 'features'), { recursive: true });
  writeFileSync(join(bp, 'spec.yml'), 'blueprint: accept\n');
  writeFileSync(
    join(bp, 'storyboard.yml'),
    [
      'screens:',
      '  - id: receipt',
      '    title: Receipt',
      '    design: /receipt/20260901.html',
      '  - id: cart',
      '    title: Cart',
      '    design: null',
    ].join('\n'),
  );
  const rule = (id, screens) => [
    `      - id: shop.pay.${id}`,
    `        statement: The ${id} rule holds.`,
    '        verify: [checks]',
    '        signoff: [eng]',
    `        screens: [${screens}]`,
    '        steps:',
    '          given: [A paid order]',
    '          when: [The receipt is open]',
    '          then: [It shows what it must]',
  ];
  writeFileSync(
    join(bp, 'features', 'pay.yml'),
    [
      'feature: pay',
      'stories:',
      '  - id: shop.pay',
      '    rules:',
      ...rule('one', 'receipt'),
      ...rule('two', 'receipt'),
      ...rule('both', 'receipt, cart'),
    ].join('\n'),
  );
  declareProject(home, bp, 'accept');
  const load = () => loadBlueprint(bp, { cwd: proj });
  const onDisk = (id) => parse(readFileSync(threadAt(load().at.threads.path, id), 'utf8'));
  const request = (screen, proposes) => {
    const { id } = openThread(load(), {
      kind: 'note',
      reason: 'request',
      body: `Draw the ${screen} again.`,
      anchor: { screen },
    });
    const file = threadAt(load().at.threads.path, id);
    if (proposes) writeFileSync(file, readFileSync(file, 'utf8') + `proposes: ${proposes}\n`);
    return id;
  };
  const walk = (results, signer = username) =>
    finishWalkdown(load(), {
      target: 'local',
      baseUrl: null,
      roles: ['eng'],
      signatures: [{ role: 'eng', signer }],
      results,
    });
  return { load, onDisk, request, walk };
}

test("approving every rule on a screen accepts its design in the signer's name @rule:ownership.design.approved-rules-accept-the-design", () => {
  const p = project();
  const receipt = p.request('receipt', '/receipt/20261010.html');
  const screenOf = (id) => p.load().storyboard.screens.find((s) => s.id === id);
  assert.equal(screenOf('receipt').prototype, '/receipt/20260901.html');
  assert.equal(screenOf('receipt').proposed.path, '/prototype/receipt/20261010.html');

  // Two of three: still pending.
  let out = p.walk([
    { rule: 'shop.pay.one', status: 'approved' },
    { rule: 'shop.pay.two', status: 'approved' },
  ]);
  assert.deepEqual(out.accepted, []);
  assert.equal(p.onDisk(receipt).status, 'open');

  // The third sent back: still pending.
  out = p.walk([{ rule: 'shop.pay.both', status: 'refining' }]);
  assert.deepEqual(out.accepted, []);
  assert.equal(p.onDisk(receipt).status, 'open');

  // The third approved: accepted, in the signer's name, and the proposed
  // version is the accepted one.
  out = p.walk([{ rule: 'shop.pay.both', status: 'approved' }]);
  assert.ok(out.accepted.includes(receipt));
  const t = p.onDisk(receipt);
  assert.equal(t.status, 'verified');
  assert.equal(t.verified_by, 'design-person');
  assert.equal(t.verified_via, out.run_id);
  assert.match(
    t.replies.at(-1).body,
    /Accepted by design-person's approval of every rule on receipt/,
  );
  assert.equal(screenOf('receipt').prototype, '/receipt/20261010.html');
  assert.equal(screenOf('receipt').behind, '/receipt/20260901.html');
  assert.equal(screenOf('receipt').proposed, undefined);
  // Lint asks for the storyboard to catch up.
  const behind = lint(p.load(), { checks: false }).findings.filter((f) => f.subject === 'receipt');
  assert.ok(behind.some((f) => /point `design:` at \/receipt\/20261010\.html/.test(f.message)));
});

test('a rule naming two screens counts toward each @rule:ownership.design.approved-rules-accept-the-design', () => {
  const p = project();
  const cart = p.request('cart', '/cart/20261010.html');
  const out = p.walk([{ rule: 'shop.pay.both', status: 'approved' }]);
  assert.deepEqual(out.accepted, [cart]);
  assert.equal(p.onDisk(cart).status, 'verified');
});

test('a request with nothing drawn on it stays open, however the rules are approved @rule:ownership.design.approved-rules-accept-the-design', () => {
  const p = project();
  const cart = p.request('cart', null);
  const out = p.walk([{ rule: 'shop.pay.both', status: 'approved' }]);
  assert.deepEqual(out.accepted, []);
  assert.equal(p.onDisk(cart).status, 'open');
});

test("an agent's verdict never accepts a design @rule:ownership.design.approved-rules-accept-the-design", () => {
  const p = project('agent');
  const cart = p.request('cart', '/cart/20261010.html');
  let out = null;
  try {
    out = p.walk([{ rule: 'shop.pay.both', status: 'approved' }], 'agent');
  } catch {
    // A machine's name is refused at the door; either way nothing is accepted.
  }
  assert.deepEqual(out?.accepted ?? [], []);
  assert.equal(p.onDisk(cart).status, 'open');
});

test('an approval given before the request was filed does not count; the rule is approved again beside the design (q-0613) @rule:ownership.design.approved-rules-accept-the-design', () => {
  const p = project();
  // shop.pay.one signed long before anybody asked for a new receipt.
  const early = p.walk([{ rule: 'shop.pay.one', status: 'approved' }]);
  const runFile = join(p.load().at.runs.path, `${early.run_id}.json`);
  const record = JSON.parse(readFileSync(runFile, 'utf8'));
  record.created = '2026-01-01T00:00:00Z';
  writeFileSync(runFile, `${JSON.stringify(record, null, 2)}\n`);

  const receipt = p.request('receipt', '/receipt/20261010.html');
  let out = p.walk([
    { rule: 'shop.pay.two', status: 'approved' },
    { rule: 'shop.pay.both', status: 'approved' },
  ]);
  assert.deepEqual(out.accepted, [], 'one was signed before there was a design to read');
  assert.equal(p.onDisk(receipt).status, 'open');

  out = p.walk([{ rule: 'shop.pay.one', status: 'approved' }]);
  assert.ok(out.accepted.includes(receipt));
  assert.equal(p.onDisk(receipt).status, 'verified');
});
