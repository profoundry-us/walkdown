/*
 * The write boundary, tested from the outside: what a browser's request can
 * cause to land on disk, and where.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { createWalkdownServer } from '../lib/serve.js';

/*
 * A project of its own per test, with WALKDOWN_HOME pinned - and pinned
 * FIRST, before anything resolves a location and caches it.
 */
function project({ movedThreads = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wd-writes-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;
  const bp = join(root, 'proj', 'blueprint');
  mkdirSync(join(bp, 'features'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: writes-fixture\n');
  writeFileSync(join(bp, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.thing',
      '        statement: The visitor can do the thing.',
      '        verify: [checks]',
    ].join('\n'),
  );
  const threadsDir = join(home, 'moved-threads');
  if (movedThreads) writeFileSync(join(home, 'config.yml'), `defaults:\n  threads: ${threadsDir}\n`);
  return { root, bp, threadsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function serve(bp, fn) {
  const server = createWalkdownServer(bp);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    server.close();
  }
}

const post = (base, path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ ok: r.ok, data: await r.json() }));

/*
 * The bug family cmdRun had, on the write side: openThread filed pins into
 * `<spec>/threads` by name while every reader asked the resolver - so with a
 * config that moves the ledger, the panel confirmed a thread the next reload
 * had never heard of, and the id counter restarted in the shadow directory.
 */
test('a pin filed with the ledger moved lands where readers read @rule:locations.keeping.moving-is-a-decision', async () => {
  const p = project({ movedThreads: true });
  try {
    await serve(p.bp, async (base) => {
      const { ok, data } = await post(base, '/api/threads', {
        kind: 'note',
        body: 'the button is mislabeled',
        author: 'tester',
        anchor: { rule: 'demo.main.thing' },
      });
      assert.ok(ok, JSON.stringify(data));
      assert.match(data.id, /^n-\d{4}$/);

      // On disk where the config says, not beside the spec.
      assert.deepEqual(readdirSync(p.threadsDir), [`${data.id}.yml`]);

      // And - the actual claim - a fresh read of the blueprint SEES it.
      const seen = loadBlueprint(p.bp).threads.map((t) => t.data?.id);
      assert.deepEqual(seen, [data.id], 'filed and found are the same place');
    });
  } finally {
    p.cleanup();
  }
});

test('a pin on a fresh project creates the threads directory it needs', async () => {
  // Untagged: init deliberately scaffolds no threads/ ("every writer creates
  // its own directory on demand") - this holds the writer to that promise.
  const p = project();
  try {
    await serve(p.bp, async (base) => {
      const { ok, data } = await post(base, '/api/threads', {
        kind: 'question',
        body: 'what should the empty state say?',
        author: 'tester',
        anchor: {},
      });
      assert.ok(ok, JSON.stringify(data));
      assert.equal(loadBlueprint(p.bp).threads.length, 1);
    });
  } finally {
    p.cleanup();
  }
});
