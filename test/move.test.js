import { declareProject } from '../tools/test-home.mjs';
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
  const runs = join(root, 'repo', 'runs');
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(runs, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: movable\n');
  writeFileSync(join(bp, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(join(runs, 'a.json'), '{"run_id":"a"}');
  return { root, home, bp, runs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
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
    const before = readFileSync(join(p.runs, 'a.json'), 'utf8');
    run(p, ['move', 'runs', '--to', dest, '--project', declareProject(p.home, p.bp, 'movable')]);

    assert.ok(existsSync(join(dest, 'a.json')), 'the run moved');
    assert.equal(
      readFileSync(join(dest, 'a.json'), 'utf8'),
      before,
      'byte for byte — a move is not an edit',
    );
    assert.ok(!existsSync(join(p.runs, 'a.json')), 'and is not left behind');

    const cfg = readFileSync(join(p.home, 'config.yml'), 'utf8');
    assert.match(cfg, /id: movable/);
    assert.match(cfg, new RegExp(`runs: ${dest.replace(/[/\\-]/g, '\\$&')}`));

    // And the resolver now agrees, which is the only thing that makes it real.
    const where = run(p, ['where', 'runs', '--project', declareProject(p.home, p.bp, 'movable')]).trim();
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
      () => run(p, ['move', 'runs', '--to', dest, '--project', declareProject(p.home, p.bp, 'movable')]),
      (e) => e.status === 2,
      'refused, and loudly enough to fail a script',
    );
    assert.ok(existsSync(join(p.runs, 'a.json')), 'and nothing moved');
  } finally {
    p.cleanup();
  }
});

/*
 * The destination the guard above deliberately allows.
 *
 * `held()` ignores dotfiles, which is right - refusing a move because Finder
 * left a .DS_Store there would be absurd - and then `renameSync` refused it
 * anyway with a raw ENOTEMPTY, because rename does not care what kind of entry
 * is in the way. The same fallback carries EXDEV, which is the half of n-0185
 * that matters most in practice: an external drive or a mounted share is the
 * most plausible place for records leaving a repository, and it cannot be
 * built portably in a unit test. Both take this branch.
 */
test('a destination holding only the dotfiles the guard ignores is still moved into @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  try {
    const dest = join(p.root, 'elsewhere', 'runs');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, '.DS_Store'), 'finder');
    const before = readFileSync(join(p.runs, 'a.json'), 'utf8');

    run(p, ['move', 'runs', '--to', dest, '--project', declareProject(p.home, p.bp, 'movable')]);

    assert.equal(readFileSync(join(dest, 'a.json'), 'utf8'), before, 'the record arrived unchanged');
    assert.ok(!existsSync(join(p.runs, 'a.json')), 'and did not stay behind');
    assert.equal(
      readFileSync(join(dest, '.DS_Store'), 'utf8'),
      'finder',
      'what was already there is merged with, never cleared',
    );
  } finally {
    p.cleanup();
  }
});

