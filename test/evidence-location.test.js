import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWalkdownServer } from '../lib/serve.js';

/*
 * Evidence is recorded in the ledger as a logical key - "runs/evidence/<run>/
 * <file>" - and resolved per machine. These check both halves of that: a
 * record written before evidence could move still finds its screenshot in the
 * blueprint, and one on a machine that has moved evidence out finds it at the
 * configured root, with no run record edited either way.
 */
async function withServer(bp, fn) {
  const server = createWalkdownServer(bp);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wd-ev-'));
  const bp = join(root, 'blueprint');
  mkdirSync(join(bp, 'features'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: ev-fixture\n');
  writeFileSync(join(bp, 'storyboard.yml'), 'screens: []\n');
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;
  return { root, bp, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a screenshot in the blueprint is served, as every older record expects', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.bp, 'runs', 'evidence', 'r1'), { recursive: true });
    writeFileSync(join(f.bp, 'runs', 'evidence', 'r1', 'shot.png'), 'IN-REPO');
    await withServer(f.bp, async (base) => {
      const res = await fetch(`${base}/evidence/runs/evidence/r1/shot.png`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'IN-REPO');
    });
  } finally {
    f.cleanup();
  }
});

test('with evidence moved out, the same recorded key finds it at the new root @rule:locations.travel.evidence-by-key', async () => {
  const f = fixture();
  try {
    /*
     * Declared, because a home is only ever keyed by an id the config
     * allocated (n-0150). This fixture used to rely on the resolver deriving
     * `projects/<project: field>` for a blueprint nobody had listed - which is
     * precisely the derivation from a non-unique name that let two blueprints
     * share one home. The rule under test is unchanged: a recorded key still
     * finds its screenshot at the configured root.
     */
    writeFileSync(
      join(f.home, 'config.yml'),
      `projects:\n  - id: ev-fixture\n    spec: ${f.bp}\n    evidence: ${join(f.home, 'projects', 'ev-fixture', 'evidence')}\n`,
    );
    const out = join(f.home, 'projects', 'ev-fixture', 'evidence', 'r1');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'shot.png'), 'MOVED-OUT');
    await withServer(f.bp, async (base) => {
      const res = await fetch(`${base}/evidence/runs/evidence/r1/shot.png`);
      assert.equal(res.status, 200);
      assert.equal(
        await res.text(),
        'MOVED-OUT',
        'the logical key resolved to the configured root',
      );
    });
  } finally {
    f.cleanup();
  }
});

test('evidence serving still refuses anything outside the evidence key space @rule:locations.travel.evidence-by-key', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.bp, 'walkdown.yml'), 'project: ev-fixture\n');
    await withServer(f.bp, async (base) => {
      for (const path of [
        '/evidence/walkdown.yml',
        '/evidence/../walkdown.yml',
        '/evidence/runs/walkdown.yml',
      ]) {
        const res = await fetch(base + path);
        assert.equal(res.status, 404, `${path} is not evidence`);
      }
    });
  } finally {
    f.cleanup();
  }
});
