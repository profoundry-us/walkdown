/*
 * ADR 0015 §4 - a redline says the build leaves the design at an element on
 * purpose. It excuses a gap, so only a person files one: any sign a machine
 * typed it refuses it. A person's is filed closed, waits on nobody, and is
 * carried into every judge's prompt for the rule's screens as an intended gap.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadBlueprint } from '../lib/blueprint.js';
import { transitionThread } from '../lib/threads.js';
import { closesOnVerdict, waitsOnPerson } from '../lib/vocab.js';
import { openThread } from '../lib/writes.js';
import { declareProject } from '../tools/test-home.mjs';

const root = mkdtempSync(join(tmpdir(), 'walkdown-redline-'));
after(() => rmSync(root, { recursive: true, force: true }));
// A personal home of its own with a person declared in it, so the CLI
// spawned below finds the blueprint registered there and files as them.
const home = join(root, 'home');
mkdirSync(home, { recursive: true });
writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: redline-person\n');
process.env.WALKDOWN_HOME = home;
const proj = join(root, 'proj');
const bp = join(proj, '.walkdown', 'blueprints', '0001-redline-fixture');
mkdirSync(join(bp, 'features'), { recursive: true });
writeFileSync(join(bp, 'spec.yml'), 'blueprint: redline-fixture\n');
writeFileSync(
  join(bp, 'storyboard.yml'),
  'screens:\n  - id: receipt\n    title: Receipt\n    prototype: /screens/receipt.html\n    anchors: [receipt.total]\n',
);
writeFileSync(
  join(bp, 'features', 'demo.yml'),
  [
    'feature: demo',
    'stories:',
    '  - id: demo.main',
    '    rules:',
    '      - id: demo.main.total',
    '        statement: The receipt shows the total.',
    '        verify: [checks, agent]',
    '        screens: [receipt]',
    '        steps:',
    '          given: [A paid order]',
    '          when: [The receipt is open]',
    "          then: ['`receipt.total` shows what was paid']",
  ].join('\n'),
);
const id = declareProject(home, bp, 'redline-fixture');
const load = () => loadBlueprint(bp, { cwd: proj });
const anchor = { screen: 'receipt', element: 'receipt.total' };
const body = 'The total sits under the items. It reads better on a phone.';
const count = () => readdirSync(load().at.threads.path).length;

test('any sign a machine typed a redline refuses it, and nothing is filed @rule:threads.lifecycle.redline-is-a-persons', () => {
  const before = (() => {
    try {
      return count();
    } catch {
      return 0;
    }
  })();
  const signs = [
    { via: 'agent' },
    { via: 'agent', said: body },
    { via: 'claude-code', said: body, added: 'Seen on the phone width.' },
  ];
  for (const sign of signs)
    assert.throws(
      () => openThread(load(), { kind: 'note', reason: 'redline', body, anchor, ...sign }),
      (err) => err.code === 'redline-by-machine' && /only a person files one/.test(err.message),
      JSON.stringify(sign),
    );
  let after = 0;
  try {
    after = count();
  } catch {}
  assert.equal(after, before, 'a refused redline leaves no file');
});

test("a person's redline is filed closed, waits on nobody, and no pass closes it @rule:threads.lifecycle.redline-is-a-persons", () => {
  const { thread } = openThread(load(), { kind: 'note', reason: 'redline', body, anchor });
  assert.equal(thread.reason, 'redline');
  assert.equal(thread.status, 'recorded');
  assert.equal(thread.author, 'redline-person');
  assert.deepEqual(thread.anchor, anchor);
  assert.equal(waitsOnPerson(thread), false);
  assert.equal(closesOnVerdict(thread), false);
  // On an element, always: a redline says where the gap is.
  assert.throws(
    () =>
      openThread(load(), { kind: 'note', reason: 'redline', body, anchor: { screen: 'receipt' } }),
    /a redline is on an element/,
  );
});

test("a judge reads a redline on the rule's screen as an intended gap @rule:threads.lifecycle.redline-is-a-persons", () => {
  const bin = fileURLToPath(new URL('../bin/walkdown.js', import.meta.url));
  const run = (...extra) =>
    spawnSync(process.execPath, [bin, 'judge', 'demo.main.total', '--blueprint', id, ...extra], {
      cwd: proj,
      env: { ...process.env, WALKDOWN_HOME: home },
      encoding: 'utf8',
    });
  const out = run();
  assert.equal(out.status, 0, out.stderr);
  const text = out.stdout;
  assert.match(text, /^REDLINES \(where a person said the build leaves the design on purpose\)$/m);
  assert.match(text, /on receipt, element receipt\.total, by redline-person:/);
  assert.match(text, /It reads better on a phone\./);
  assert.match(text, /A gap a redline names is intended, not a fail\./);
  const json = JSON.parse(run('--json').stdout);
  assert.equal(json.redlines.length, 1);
  assert.equal(json.redlines[0].element, 'receipt.total');
});

test("a person's reopening makes a redline a note waiting on the agent, and only a person may @rule:threads.lifecycle.redline-is-a-persons", () => {
  const { thread } = openThread(load(), {
    kind: 'note',
    reason: 'redline',
    body,
    anchor,
    design: 'the total above the items',
  });
  const reason = 'Is the total still easy to find on the widest screens?';
  for (const by of [
    { actor: 'agent' },
    { actor: 'redline-person', via: 'claude-code' },
    { actor: 'redline-person', via: 'agent' },
  ])
    assert.throws(
      () => transitionThread(load(), thread.id, { status: 'open', reason, ...by }),
      /only a person reopens a redline/,
      JSON.stringify(by),
    );
  const reread = () => load().threads.find((t) => t.data.id === thread.id).data;
  assert.equal(reread().status, 'recorded', 'a refused reopening changes nothing');
  assert.equal(reread().reason, 'redline');

  transitionThread(load(), thread.id, { status: 'open', actor: 'redline-person', reason });
  const t = reread();
  assert.equal(t.status, 'open', "open, so it is the agent's to address");
  assert.equal(t.reason, 'feedback');
  assert.equal(t.reopened_from, 'redline');
  assert.equal(closesOnVerdict(t), true, 'a task again, which a pass on the rule can end');
  assert.equal(t.body, body, 'its why stays');
  assert.equal(t.design, 'the total above the items', 'and so does its pair');
  assert.equal(t.replies.at(-1).body, reason);
});
