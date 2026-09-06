import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getThread, listThreads } from '../lib/threads.js';
import { saysSomething } from '../lib/vocab.js';

const bp = {
  threads: [
    {
      file: 'a',
      data: {
        id: 'q-1',
        kind: 'question',
        status: 'open',
        created: '2026-01-01',
        anchor: { rule: 'r.a' },
      },
    },
    {
      file: 'b',
      data: {
        id: 'n-1',
        kind: 'note',
        status: 'verified',
        created: '2026-01-02',
        anchor: { rule: 'r.a' },
      },
    },
    {
      file: 'c',
      data: {
        id: 'n-2',
        kind: 'note',
        status: 'addressed',
        created: '2026-01-03',
        anchor: { rule: 'r.b' },
      },
    },
    {
      file: 'd',
      data: { id: 'q-2', kind: 'question', status: 'waived', created: '2026-01-04', anchor: {} },
    },
  ],
};

test('default listing excludes terminal statuses, newest first', () => {
  assert.deepEqual(
    listThreads(bp).map((t) => t.id),
    ['n-2', 'q-1'],
  );
});

test('--all includes terminal; --rule filters by anchor', () => {
  assert.equal(listThreads(bp, { all: true }).length, 4);
  assert.deepEqual(
    listThreads(bp, { all: true, rule: 'r.a' }).map((t) => t.id),
    ['n-1', 'q-1'],
  );
});

test('getThread finds by id, null otherwise', () => {
  assert.equal(getThread(bp, 'n-2').status, 'addressed');
  assert.equal(getThread(bp, 'nope'), null);
});

/*
 * n-0203: a "why" that says nothing.
 *
 * `trim()` strips whitespace and stops there, leaving the format characters —
 * which have no visible content at all. A single U+200B walked through the
 * panel's fail-requires-why gate and recorded the verdict: the box looked
 * empty the whole time, and the note it filed renders on the board as an
 * author, a timestamp and a blank line. One keystroke from the empty box the
 * panel refuses.
 */
test('a body of nothing anybody could see is not a body @rule:panel.walkdown.fail-requires-why', () => {
  for (const nothing of ['\u200b', '\u200b \u200c\ufeff', '\u2060', ' \t\n', '\u00a0'])
    assert.equal(saysSomething(nothing), false, JSON.stringify(nothing));
  // And the text itself is never rewritten - a body that DOES say something
  // keeps every character the person typed, zero-width joiners included.
  for (const said of ['x', ' a ', 'family: \u{1f468}\u200d\u{1f469}\u200d\u{1f466}'])
    assert.equal(saysSomething(said), true, JSON.stringify(said));
});
