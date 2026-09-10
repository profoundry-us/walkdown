import { declareProject } from '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
    run(p, ['move', 'runs', '--to', dest, '--blueprint', declareProject(p.home, p.bp, 'movable')]);

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
    const where = run(p, ['where', 'runs', '--blueprint', declareProject(p.home, p.bp, 'movable')]).trim();
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
      () => run(p, ['move', 'runs', '--to', dest, '--blueprint', declareProject(p.home, p.bp, 'movable')]),
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

    run(p, ['move', 'runs', '--to', dest, '--blueprint', declareProject(p.home, p.bp, 'movable')]);

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

/*
 * The copy path must be as faithful as the rename it stands in for.
 *
 * cpSync resolves symlinks unless told not to, so a relative link arrived
 * pointing at an absolute path back into the directory it had just left, and
 * no longer resolved - a file rewritten to suit its new address, which is what
 * the second THEN forbids (n-0195). The dotfile destination is how a unit test
 * reaches that branch; a second volume is the same branch and cannot be built
 * portably here.
 */
test('a relative link is still relative on the other side @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  try {
    writeFileSync(join(p.runs, 'real.json'), '{"run_id":"real"}');
    symlinkSync('real.json', join(p.runs, 'link.json'));
    const dest = join(p.root, 'elsewhere', 'runs');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, '.DS_Store'), 'finder'); // forces the copy path

    run(p, ['move', 'runs', '--to', dest, '--blueprint', declareProject(p.home, p.bp, 'movable')]);

    assert.equal(readlinkSync(join(dest, 'link.json')), 'real.json', 'the link reads as it was written');
    assert.equal(
      readFileSync(join(dest, 'link.json'), 'utf8'),
      '{"run_id":"real"}',
      'and still resolves where it landed',
    );
  } finally {
    p.cleanup();
  }
});

/*
 * Two destinations that are not destinations. Neither loses anything - they
 * used to arrive as a raw ENOTDIR and a raw EINVAL - but a command that
 * refuses in a sentence everywhere else should not answer these with a crash.
 */
test('a destination that is not a directory is refused in words @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  try {
    const file = join(p.root, 'not-a-dir');
    writeFileSync(file, 'i am a file');
    assert.throws(
      () => run(p, ['move', 'runs', '--to', file, '--blueprint', declareProject(p.home, p.bp, 'movable')]),
      (e) => e.status === 2 && /is not a directory/.test(e.stderr),
    );

    const inside = join(p.runs, 'deeper');
    assert.throws(
      () => run(p, ['move', 'runs', '--to', inside, '--blueprint', declareProject(p.home, p.bp, 'movable')]),
      (e) => e.status === 2 && /inside/.test(e.stderr),
    );

    assert.ok(existsSync(join(p.runs, 'a.json')), 'and nothing moved either time');
  } finally {
    p.cleanup();
  }
});


/*
 * The copy path's own failures. moveDir catches EXDEV/ENOTEMPTY/EEXIST to
 * CHOOSE the copy and used to catch nothing the copy itself raised, so a volume
 * that filled or a record it could not read died as a stack trace and left a
 * half-copied ledger at the destination - and the obvious retry was then
 * refused by the debris of the attempt that failed (n-0196).
 *
 * Driven with an unreadable record rather than a full volume: a RAM disk cannot
 * be built portably in a unit test, and both take the same branch.
 */
test('a copy that stops part way is a refusal, and leaves no debris behind @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  const locked = join(p.runs, 'locked.json');
  try {
    writeFileSync(locked, '{"run_id":"locked"}');
    chmodSync(locked, 0o000);
    // A dotfile at the destination forces the copy path, the way a second
    // volume would: the guard ignores it, and rename then will not.
    const dest = join(p.root, 'elsewhere', 'runs');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, '.DS_Store'), 'finder');

    let out;
    try {
      run(p, ['move', 'runs', '--to', dest, '--blueprint', declareProject(p.home, p.bp, 'movable')]);
      assert.fail('the move should have been refused');
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      assert.equal(e.status, 2, 'a worded refusal, not a stack trace');
    }
    assert.match(out, /stopped part way/);
    assert.match(out, /Nothing was lost/);
    assert.ok(!/at Object\.|node:internal/.test(out), 'no stack trace');

    // The ledger is exactly where it was.
    assert.ok(existsSync(join(p.runs, 'a.json')), 'the records stayed');
    assert.equal(readFileSync(join(dest, '.DS_Store'), 'utf8'), 'finder', 'theirs untouched');
    // And the destination holds nothing of ours, so a retry is not refused by
    // the wreckage of this attempt.
    assert.ok(!existsSync(join(dest, 'a.json')), 'no half-copied record left behind');
  } finally {
    try {
      chmodSync(locked, 0o600);
    } catch {}
    p.cleanup();
  }
});

/*
 * n-0201: a move that cannot be written down must not happen.
 *
 * `walkdown move` relocated the directory first and wrote the choice after, so
 * a personal config it could not write left the records at the new address
 * with the config still naming the old one — which no longer existed, and
 * `walkdown where` named a directory that was gone. `relocateHome` has read
 * both files up front since n-0172, with a standing comment saying exactly
 * this; this door never inherited it.
 */
test('a config that will not write back is refused before anything moves @rule:locations.keeping.moving-is-a-decision', () => {
  /*
   * n-0206: the precheck asked whether the personal config could be READ and
   * the writer asked whether it could be WRITTEN, and the yaml document
   * answers those differently - it collects parse errors rather than throwing,
   * so `.toJS()` reads a damaged file quite happily and `String(doc)` refuses
   * it. The move went through, the write then died with a raw stack trace,
   * and the records sat at an address the config still did not name.
   *
   * The blueprint is declared in the REPOSITORY's config here, because that
   * is the only arrangement where the question arises: a personal file too
   * damaged to parse takes its projects down with it and the move is refused
   * far earlier, for a different reason. Committed declaration, damaged
   * personal file - that is the shape that used to move first and fail after.
   */
  const root = mkdtempSync(join(tmpdir(), 'wd-move-'));
  try {
    const home = join(root, 'home');
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    mkdirSync(home, { recursive: true });
    const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
    git('init');
    const cli = (args, opts = {}) =>
      execFileSync('node', [CLI, ...args], {
        cwd: repo,
        env: { ...process.env, WALKDOWN_HOME: home, WALKDOWN_SKILLS_DIR: join(root, 'skills') },
        encoding: 'utf8',
        ...opts,
      });
    cli(['init', '--commit', 'spec']);
    const cfg = join(home, 'config.yml');
    // A key said twice: the parser collects the error and hands back a
    // document, and only stringifying it refuses.
    writeFileSync(
      cfg,
      `${existsSync(cfg) ? readFileSync(cfg, 'utf8') : ''}identity:\n  username: one\nidentity:\n  username: two\n`,
    );
    const runs = join(repo, '.walkdown', 'blueprints', '0001-repo', 'runs');
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, 'a.json'), '{"run_id":"a"}');

    const dest = join(root, 'elsewhere', 'runs');
    let out;
    try {
      cli(['move', 'runs', '--to', dest]);
      assert.fail('a move that cannot be written down must be refused');
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      assert.equal(e.status, 2, `a worded refusal, not a stack trace: ${out}`);
    }
    assert.match(out, /cannot be written back/);
    assert.ok(!/cannot be stringified/.test(out), 'a raw yaml error is not a sentence');
    assert.ok(!/at Object\.|node:internal/.test(out), 'no stack trace');

    assert.ok(existsSync(join(runs, 'a.json')), 'the records stayed');
    assert.ok(!existsSync(dest), 'and the destination was never made');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a move that cannot be recorded is refused before anything moves @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  const cfg = join(p.home, 'config.yml');
  try {
    const id = declareProject(p.home, p.bp, 'movable');
    const before = readFileSync(cfg, 'utf8');
    chmodSync(cfg, 0o400);

    const dest = join(p.root, 'elsewhere', 'runs');
    let out;
    try {
      run(p, ['move', 'runs', '--to', dest, '--blueprint', id]);
      assert.fail('a move that cannot be written down must be refused');
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      assert.equal(e.status, 2, 'a worded refusal, not a stack trace');
    }
    assert.match(out, /cannot be written/);
    assert.ok(!/at Object\.|node:internal/.test(out), 'no stack trace');

    // Nothing moved, and the ledger is still where the config says it is.
    assert.ok(existsSync(join(p.runs, 'a.json')), 'the records stayed');
    assert.ok(!existsSync(dest), 'and the destination was never made');
    assert.equal(readFileSync(cfg, 'utf8'), before, 'the config is untouched');
  } finally {
    try {
      chmodSync(cfg, 0o600);
    } catch {}
    p.cleanup();
  }
});

test('a destination parent running through a file is refused in words @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  try {
    const blocker = join(p.root, 'blocker');
    writeFileSync(blocker, 'not a directory');
    let out;
    try {
      run(p, [
        'move',
        'runs',
        '--to',
        join(blocker, 'deeper', 'runs'),
        '--blueprint',
        declareProject(p.home, p.bp, 'movable'),
      ]);
      assert.fail('should have been refused');
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      assert.equal(e.status, 2);
    }
    assert.match(out, /cannot be made a directory/);
    assert.ok(existsSync(join(p.runs, 'a.json')), 'nothing moved');
  } finally {
    p.cleanup();
  }
});

/*
 * And a destination that is a symlink TO a directory. The occupied-guard
 * follows the link and sees a directory, quite rightly; renameSync then will
 * not have it, and used to die with a raw ENOTDIR.
 */
test('a destination that is a link is refused, naming what it points at @rule:locations.keeping.moving-is-a-decision', () => {
  const p = project();
  try {
    const real = join(p.root, 'elsewhere', 'real');
    mkdirSync(real, { recursive: true });
    const link = join(p.root, 'elsewhere', 'link');
    symlinkSync(real, link);
    const before = readFileSync(join(p.runs, 'a.json'), 'utf8');

    let out;
    try {
      run(p, ['move', 'runs', '--to', link, '--blueprint', declareProject(p.home, p.bp, 'movable')]);
      assert.fail('should have been refused');
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      assert.equal(e.status, 2);
    }
    assert.match(out, /is a link, not a directory/);
    assert.match(out, /Name the directory itself/);
    // Refused BEFORE anything is attempted - so no "stopped part way" about a
    // copy that never started, and the records are exactly where they were.
    assert.doesNotMatch(out, /stopped part way/);
    assert.equal(readFileSync(join(p.runs, 'a.json'), 'utf8'), before, 'nothing moved');
    assert.deepEqual(readdirSync(real), [], 'and nothing arrived through the link');
  } finally {
    p.cleanup();
  }
});
