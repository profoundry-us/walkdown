import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWalkdownServer } from '../lib/serve.js';
import { declaredHome } from '../tools/test-home.mjs';

/*
 * Evidence is recorded in the ledger as a logical key - "runs/evidence/<run>/
 * <file>" - and resolved per machine. These check both halves of that: a
 * record written before evidence could move still finds its screenshot in the
 * blueprint, and one on a machine that has moved evidence out finds it at the
 * configured root, with no run record edited either way.
 */
async function withServer(f, fn) {
  const server = createWalkdownServer(f.bp, { cwd: f.root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

/*
 * A declared home, because that is the only shape walkdown answers for. The
 * evidence key space is unchanged - a run records `runs/evidence/<id>/x.png`
 * and the server resolves it against wherever evidence actually lives - but
 * where it lives is now always a home's `evidence/`, never a directory
 * inside the blueprint.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wd-ev-'));
  const h = declaredHome(root, 'ev-fixture');
  mkdirSync(join(h.spec, 'features'), { recursive: true });
  writeFileSync(join(h.spec, 'walkdown.yml'), 'project: ev-fixture\n');
  writeFileSync(join(h.spec, 'storyboard.yml'), 'screens: []\n');
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;
  return { root, bp: h.spec, h, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/*
 * The case that used to stand here served a screenshot from
 * `blueprint/runs/evidence/` - records kept INSIDE the spec, the layout from
 * before homes. Nothing reads that layout now (every blueprint is declared
 * and lives in a home), so the test went with it rather than being rewritten
 * to assert a shape walkdown no longer produces.
 */
test('a screenshot in the home is served under the key the run recorded @rule:locations.travel.evidence-by-key', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.h.evidence, 'r1'), { recursive: true });
    writeFileSync(join(f.h.evidence, 'r1', 'shot.png'), 'IN-HOME');
    await withServer(f, async (base) => {
      const res = await fetch(`${base}/evidence/runs/evidence/r1/shot.png`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'IN-HOME');
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
      // A pure personal override on the declared entry - the shape
      // `walkdown move evidence --to <path>` writes. It names no spec and no
      // roots: the repository's entry says where the blueprint is, and this
      // says only where THIS machine keeps its screenshots.
      `projects:\n  - id: ev-fixture\n    evidence: ${join(f.home, 'projects', 'ev-fixture', 'evidence')}\n`,
    );
    const out = join(f.home, 'projects', 'ev-fixture', 'evidence', 'r1');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'shot.png'), 'MOVED-OUT');
    await withServer(f, async (base) => {
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
    await withServer(f, async (base) => {
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
