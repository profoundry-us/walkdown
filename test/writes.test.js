/*
 * The write boundary, tested from the outside: what a browser's request can
 * cause to land on disk, and where.
 */
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { declaredHome } from '../tools/test-home.mjs';
import { createWalkdownServer } from '../lib/serve.js';

/*
 * A project of its own per test, with WALKDOWN_HOME pinned - and pinned
 * FIRST, before anything resolves a location and caches it.
 */
function project({ movedThreads = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wd-writes-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const threadsDir = join(home, 'moved-threads');
  /*
   * And a person at it. Every write here is recorded under the config's
   * identity rather than under a name the request carried, and accepting work
   * is refused outright on a machine that has only a login name to go on - so
   * a fixture with no identity cannot exercise the write paths at all.
   *
   * `movedThreads` is a PERSONAL OVERRIDE on the declared entry - the shape
   * `walkdown move threads --to <path>` writes. A blanket `defaults:` would
   * not do it any more: the entry names its threads outright, because every
   * blueprint lives in a home whose layout the entry records, and a named key
   * outranks a blanket one.
   */
  writeFileSync(
    join(home, 'config.yml'),
    'identity:\n  username: writes-person\n' +
      (movedThreads ? `projects:\n  - id: writes-fixture\n    threads: ${threadsDir}\n` : ''),
  );
  process.env.WALKDOWN_HOME = home;
  const h = declaredHome(join(root, 'proj'), 'writes-fixture');
  const bp = h.spec;
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
  return { root, h, bp, threadsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function serve(p, fn) {
  const server = createWalkdownServer(p.bp, { cwd: p.h.root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    // Keep-alive sockets outlive close() and keep the process up long after
    // the last assertion - a suite that "hangs" with every test reported.
    server.closeAllConnections();
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
    await serve(p, async (base) => {
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
      const seen = loadBlueprint(p.bp, { cwd: p.h.root }).threads.map((t) => t.data?.id);
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
    await serve(p, async (base) => {
      const { ok, data } = await post(base, '/api/threads', {
        kind: 'question',
        body: 'what should the empty state say?',
        author: 'tester',
        anchor: {},
      });
      assert.ok(ok, JSON.stringify(data));
      assert.equal(loadBlueprint(p.bp, { cwd: p.h.root }).threads.length, 1);
    });
  } finally {
    p.cleanup();
  }
});

/* Every file under a root, with its mtime+size, so a test can say what moved. */
function snapshot(dir, prefix = '') {
  const out = new Map();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix + e.name;
    if (e.isDirectory()) for (const [k, v] of snapshot(join(dir, e.name), rel + '/')) out.set(k, v);
    else {
      const s = statSync(join(dir, e.name));
      out.set(rel, `${s.size}:${s.mtimeMs}`);
    }
  }
  return out;
}

/*
 * The whole allowlist, exercised, and then the strongest claim a test can
 * make about a boundary: not "the right files changed" but "NOTHING ELSE
 * did". Every write the API offers runs against a real server, and every
 * changed path in the entire project tree - spec, prototype, source, home -
 * must sit under the resolved threads, drafts or runs directories.
 */
test('every write the API offers lands in threads, drafts or runs - and nowhere else @rule:ownership.writes.spec-never-implementation', async () => {
  const p = project();
  try {
    mkdirSync(join(p.root, 'proj', 'src'), { recursive: true });
    writeFileSync(join(p.root, 'proj', 'src', 'app.js'), '// the implementation\n');
    await serve(p, async (base) => {
      const before = snapshot(p.root);

      const opened = await post(base, '/api/threads', {
        kind: 'note',
        body: 'pin',
        author: 'tester',
        anchor: { rule: 'demo.main.thing' },
      });
      assert.ok(opened.ok);
      const id = opened.data.id;
      assert.ok(
        (await post(base, `/api/threads/${id}/replies`, { author: 'tester', body: 'more' })).ok,
      );
      assert.ok(
        (await post(base, `/api/threads/${id}/status`, { status: 'addressed', actor: 'tester' }))
          .ok,
      );
      assert.ok(
        (
          await post(base, '/api/draft', {
            target: 'local',
            actor: 'tester',
            started: '2026-01-01T00:00:00Z',
            verdicts: { 'demo.main.thing': 'pass' },
          })
        ).ok,
      );
      assert.ok((await post(base, '/api/draft', { target: 'local', discard: true })).ok);
      const sealed = await post(base, '/api/walkdowns', {
        actor: 'tester',
        target: 'local',
        results: [{ rule: 'demo.main.thing', status: 'pass' }],
      });
      assert.ok(sealed.ok, JSON.stringify(sealed.data));

      const after = snapshot(p.root);
      const loc = loadBlueprint(p.bp, { cwd: p.h.root }).at;
      const allowed = [loc.threads.path, loc.drafts.path, loc.runs.path].map(
        (abs) => abs.slice(p.root.length + 1) + '/',
      );
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
        (k) => before.get(k) !== after.get(k),
      );
      assert.ok(changed.length >= 2, 'the writes actually wrote');
      for (const path of changed)
        assert.ok(
          allowed.some((root) => path.startsWith(root)),
          `${path} changed, outside ${allowed.join(', ')}`,
        );
    });
  } finally {
    p.cleanup();
  }
});

/*
 * The same claim, held structurally: the modules a request flows through may
 * not carry a writer of their own. Read the source, like the one-matcher
 * check does - a handler that imported writeFileSync would pass every
 * behavioural test until the day it was used.
 */
test('only writes.js may write: the request path imports no writer of its own @rule:ownership.writes.spec-never-implementation', () => {
  const requestPath = ['lib/serve.js', 'lib/api.js', 'lib/identity.js'];
  const WRITERS =
    /\b(writeFileSync|appendFileSync|mkdirSync|rmSync|renameSync|cpSync|unlinkSync|createWriteStream)\b/;
  for (const file of requestPath) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const imports = src.match(/^import[^;]+from\s+'[^']+';/gms) ?? [];
    for (const line of imports)
      assert.ok(
        !WRITERS.test(line),
        `${file} imports a filesystem writer: ${line.trim()} - route it through lib/writes.js`,
      );
  }
  // The router must not reach the mutating modules at all - not even
  // writes.js, so a new route cannot mutate without going through the API
  // layer where validation lives. api.js reads drafts and validates roles,
  // so its line is drawn at the filesystem writers above.
  const serveSrc = readFileSync(new URL('../lib/serve.js', import.meta.url), 'utf8');
  for (const banned of ["'./threads.js'", "'./draft.js'", "'./run-record.js'", "'./writes.js'"])
    assert.ok(!serveSrc.includes(`from ${banned}`), `serve.js imports ${banned}`);
});
