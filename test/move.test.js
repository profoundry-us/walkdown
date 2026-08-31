import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;

function project() {
  const root = mkdtempSync(join(tmpdir(), 'wd-move-'));
  const home = join(root, 'home');
  const bp = join(root, 'repo', 'blueprint');
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'runs'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: movable\n');
  writeFileSync(join(bp, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(join(bp, 'runs', 'a.json'), '{"run_id":"a"}');
  return { root, home, bp, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const run = (p, args) =>
  execFileSync('node', [CLI, ...args], {
    env: { ...process.env, WALKDOWN_HOME: p.home },
    encoding: 'utf8',
  });

test('move relocates the files, records the choice, and edits no record @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  try {
    const dest = join(p.root, 'elsewhere', 'runs');
    const before = readFileSync(join(p.bp, 'runs', 'a.json'), 'utf8');
    run(p, ['move', 'runs', '--to', dest, '--dir', p.bp]);

    assert.ok(existsSync(join(dest, 'a.json')), 'the run moved');
    assert.equal(
      readFileSync(join(dest, 'a.json'), 'utf8'),
      before,
      'byte for byte — a move is not an edit',
    );
    assert.ok(!existsSync(join(p.bp, 'runs', 'a.json')), 'and is not left behind');

    const cfg = readFileSync(join(p.home, 'config.yml'), 'utf8');
    assert.match(cfg, /id: movable/);
    assert.match(cfg, new RegExp(`runs: ${dest.replace(/[/\\-]/g, '\\$&')}`));

    // And the resolver now agrees, which is the only thing that makes it real.
    const where = run(p, ['where', 'runs', '--dir', p.bp]).trim();
    assert.equal(where, dest);
  } finally {
    p.cleanup();
  }
});

/*
 * Two ledgers merged into one directory would be, in every way that matters,
 * an edit of both — which the append-only law forbids however the files got
 * there. So a non-empty destination is refused rather than merged.
 */
test('move refuses a destination that already holds records @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  try {
    const dest = join(p.root, 'occupied');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'someone-elses.json'), '{}');
    assert.throws(
      () => run(p, ['move', 'runs', '--to', dest, '--dir', p.bp]),
      (e) => e.status === 2,
      'refused, and loudly enough to fail a script',
    );
    assert.ok(existsSync(join(p.bp, 'runs', 'a.json')), 'and nothing moved');
  } finally {
    p.cleanup();
  }
});
