import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { replyToThread, transitionThread } from '../lib/threads.js';
import { canTransition } from '../lib/vocab.js';
import { declaredHome, threadAt } from '../tools/test-home.mjs';
import { parse } from '../vendor/yaml.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-mut-'));
/*
 * A home: the threads sit BESIDE the spec, which is the only layout walkdown
 * answers for. Declared in the root's own `.walkdown`, so the blueprint is
 * one somebody wrote down rather than one found by looking.
 */
const h = declaredHome(root, 'mut');
const bp = h.spec;
after(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  rmSync(h.threads, { recursive: true, force: true });
  mkdirSync(h.threads, { recursive: true });
  mkdirSync(bp, { recursive: true });
  writeFileSync(join(bp, 'spec.yml'), 'blueprint: mut\n');
  writeFileSync(
    join(h.threads, 'n-1.yml'),
    'id: n-1\nkind: note\nstatus: open\nbody: Fix the button.\n',
  );
  writeFileSync(
    join(h.threads, 'q-1.yml'),
    'id: q-1\nkind: question\nstatus: open\nbody: Blur or submit?\n',
  );
});

const load = () => loadBlueprint(bp, { cwd: h.root });
const onDisk = (id) => parse(readFileSync(threadAt(h.threads, id), 'utf8'));

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

test('provenance is refused by its presence, not its spelling @rule:threads.lifecycle.claim-never-accept', () => {
  /*
   * n-0212: this guard read `via === 'agent'` - case sensitive, untrimmed -
   * one line below an actor test that deliberately folds case. On any machine
   * whose home declares a person (an agent sitting at somebody's desk, which
   * is the ordinary case) `via: 'Agent'` verified the thread. And folding case
   * would not have closed it: `via` is free text, so an agent naming itself
   * honestly was the one that would still have got through.
   *
   * `via` means something typed this FOR the person named, and a person's
   * acceptance is the one thing nothing may type for them.
   */
  transitionThread(load(), 'n-1', { status: 'addressed', actor: 'agent' });
  for (const via of ['agent', 'Agent', ' AGENT ', 'claude-opus-5', 'a helpful script'])
    for (const status of ['verified', 'waived'])
      assert.throws(
        () => transitionThread(load(), 'n-1', { status, actor: 'Topher', reason: 'because', via }),
        /claim work on their behalf/,
        `${status} via ${JSON.stringify(via)}`,
      );

  // A person at a keyboard sends no provenance, and is unaffected.
  const t = transitionThread(load(), 'n-1', { status: 'verified', actor: 'Topher' });
  assert.equal(t.verified_by, 'Topher');
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

/*
 * An ending can be reopened, and the conversation stays append-only: the
 * reason lands as a reply, the status goes back, and the acceptance it
 * undoes stays on the file. Only a person may take a person's acceptance
 * back; a machine files a new thread instead (2026-09-17).
 */
test('an ended thread reopens append-only, and only a person reopens an accepted one @rule:threads.lifecycle.validated-transitions @rule:threads.lifecycle.reasoned-endings', () => {
  transitionThread(load(), 'n-1', { status: 'addressed', actor: 'agent' });
  transitionThread(load(), 'n-1', { status: 'verified', actor: 'topher' });
  const before = onDisk('n-1');
  // A machine may not, by name or by mark.
  assert.throws(
    () => transitionThread(load(), 'n-1', { status: 'open', actor: 'agent', reason: 'regressed' }),
    /takes back a person's acceptance/,
  );
  assert.throws(
    () =>
      transitionThread(load(), 'n-1', {
        status: 'open',
        actor: 'topher',
        reason: 'regressed',
        via: 'agent',
      }),
    /takes back a person's acceptance/,
  );
  assert.deepEqual(onDisk('n-1'), before, 'a refused reopen writes nothing');
  // A person may, with a reason; nothing said is unsaid.
  assert.throws(
    () => transitionThread(load(), 'n-1', { status: 'open', actor: 'topher' }),
    /requires a reason/,
  );
  transitionThread(load(), 'n-1', {
    status: 'open',
    actor: 'topher',
    reason: 'It came back at 375.',
  });
  const after = onDisk('n-1');
  assert.equal(after.status, 'open');
  assert.equal(after.verified_by, 'topher', 'what once happened stays on the record');
  assert.equal(after.replies.length, (before.replies ?? []).length + 1);
  assert.equal(after.replies.at(-1).body, 'It came back at 375.');
  // The agent's own endings, either party may reopen.
  transitionThread(load(), 'q-1', { status: 'answered', actor: 'topher' });
  transitionThread(load(), 'q-1', { status: 'incorporated', actor: 'agent' });
  transitionThread(load(), 'q-1', {
    status: 'open',
    actor: 'agent',
    reason: 'the answer did not fit the rule',
  });
  assert.equal(onDisk('q-1').status, 'open');
  // A decision is a record, not a task: it never reopens.
  writeFileSync(
    join(h.threads, 'n-2.yml'),
    'id: n-2\nkind: note\nreason: decision\nstatus: recorded\nbody: Keep the old URL.\n',
  );
  assert.throws(
    () => transitionThread(load(), 'n-2', { status: 'open', actor: 'topher', reason: 'why?' }),
    /recorded decision and never reopens/,
  );
  assert.equal(canTransition('note', 'recorded', 'addressed'), false);
});

test('a person reopens a redline into a note waiting on the agent, and keeps its pair @rule:embed.pin.redline-explains-a-gap', () => {
  writeFileSync(
    join(h.threads, 'n-3.yml'),
    'id: n-3\nkind: note\nreason: redline\nstatus: recorded\nauthor: topher\ndesign: a button that reads Join\nbody: On a phone, Join read as sign in.\n',
  );
  // Never the agent, by name or by mark.
  for (const by of [{ actor: 'agent' }, { actor: 'topher', via: 'agent' }])
    assert.throws(
      () => transitionThread(load(), 'n-3', { status: 'open', reason: 'why?', ...by }),
      /only a person reopens a redline/,
    );
  assert.equal(onDisk('n-3').status, 'recorded');
  transitionThread(load(), 'n-3', {
    status: 'open',
    actor: 'topher',
    reason: 'Is Join the waitlist too long on the smallest phones?',
  });
  const t = onDisk('n-3');
  assert.equal(t.status, 'open');
  assert.equal(t.reason, 'feedback');
  assert.equal(t.reopened_from, 'redline');
  assert.equal(t.design, 'a button that reads Join');
  assert.equal(t.body, 'On a phone, Join read as sign in.');
  assert.equal(t.replies.at(-1).body, 'Is Join the waitlist too long on the smallest phones?');
});
