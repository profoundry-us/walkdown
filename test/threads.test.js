import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getThread, listThreads } from '../lib/threads.js';

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
