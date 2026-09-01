import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { replyToThread, transitionThread } from '../lib/threads.js';
import { parse } from '../vendor/yaml.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-mut-'));
const bp = join(root, 'blueprint');
after(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  rmSync(bp, { recursive: true, force: true });
  mkdirSync(join(bp, 'threads'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: mut\n');
  writeFileSync(
    join(bp, 'threads', 'n-1.yml'),
    'id: n-1\nkind: note\nstatus: open\nbody: Fix the button.\n',
  );
  writeFileSync(
    join(bp, 'threads', 'q-1.yml'),
    'id: q-1\nkind: question\nstatus: open\nbody: Blur or submit?\n',
  );
});

const load = () => loadBlueprint(bp);
const onDisk = (id) => parse(readFileSync(join(bp, 'threads', `${id}.yml`), 'utf8'));

test('replies append with author and timestamp', () => {
  replyToThread(load(), 'n-1', { author: 'agent', body: 'Fixed in abc123.' });
  const t = onDisk('n-1');
  assert.equal(t.replies.length, 1);
  assert.equal(t.replies[0].author, 'agent');
  assert.match(t.replies[0].created, /^\d{4}-/);
  assert.throws(() => replyToThread(load(), 'n-1', { author: 'x', body: '  ' }), /body required/);
  assert.throws(() => replyToThread(load(), 'nope', { author: 'x', body: 'hi' }), /no thread/);
});

test('legal note lifecycle: open → addressed → verified', () => {
  transitionThread(load(), 'n-1', { status: 'addressed', actor: 'agent' });
  transitionThread(load(), 'n-1', { status: 'verified', actor: 'topher' });
  assert.equal(onDisk('n-1').status, 'verified');
  assert.equal(onDisk('n-1').verified_by, 'topher', 'acceptance keeps the name it demanded');
});

test('illegal transitions are rejected @rule:threads.lifecycle.validated-transitions', () => {
  assert.throws(
    () => transitionThread(load(), 'n-1', { status: 'verified', actor: 'topher' }),
    /illegal transition open → verified/,
  );
  assert.throws(
    () => transitionThread(load(), 'q-1', { status: 'addressed', actor: 'x' }),
    /illegal transition open → addressed for a question/,
  );
  assert.throws(
    () => transitionThread(load(), 'n-1', { status: 'open', actor: 'x', reason: 'r' }),
    /illegal transition open → open|already open/,
  );
});

test('agents may claim, never accept: verified/waived need a named human @rule:threads.lifecycle.claim-never-accept', () => {
  transitionThread(load(), 'n-1', { status: 'addressed', actor: 'agent' });
  assert.throws(
    () => transitionThread(load(), 'n-1', { status: 'verified', actor: 'agent' }),
    /named human actor/,
  );
  // The gate names a role, not a spelling: "Agent" and "AGENT" walked
  // through the case-sensitive match and stood on disk as accepters (n-0130).
  for (const spelled of ['Agent', 'AGENT', ' agent ']) {
    assert.throws(
      () => transitionThread(load(), 'n-1', { status: 'verified', actor: spelled }),
      /named human actor/,
    );
  }
  assert.throws(() => transitionThread(load(), 'n-1', { status: 'waived' }), /named human actor/);
});

test('waiving records waived_by and the reason as a reply @rule:threads.lifecycle.reasoned-endings', () => {
  assert.throws(
    () => transitionThread(load(), 'n-1', { status: 'waived', actor: 'topher' }),
    /requires a reason/,
  );
  transitionThread(load(), 'n-1', { status: 'waived', actor: 'topher', reason: 'By design.' });
  const t = onDisk('n-1');
  assert.equal(t.status, 'waived');
  assert.equal(t.waived_by, 'topher');
  assert.equal(t.replies.at(-1).body, 'By design.');
});

test('reopening requires a reason; question answer/incorporate flow works @rule:threads.lifecycle.reasoned-endings', () => {
  transitionThread(load(), 'n-1', { status: 'addressed', actor: 'agent' });
  assert.throws(
    () => transitionThread(load(), 'n-1', { status: 'open', actor: 'topher' }),
    /reopening requires a reason/,
  );
  transitionThread(load(), 'n-1', {
    status: 'open',
    actor: 'topher',
    reason: 'Still broken on mobile.',
  });
  assert.equal(onDisk('n-1').status, 'open');

  transitionThread(load(), 'q-1', { status: 'answered', actor: 'topher' });
  transitionThread(load(), 'q-1', { status: 'incorporated', actor: 'agent' });
  assert.equal(onDisk('q-1').status, 'incorporated');
});
