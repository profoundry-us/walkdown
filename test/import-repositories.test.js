/*
 * What `blueprints import` takes when it is pointed at a checkout that moved,
 * one that did not, or one that only looks like it: the IDs a move keeps, and
 * the rows nothing else may take. Split from project-codes.test.js, and
 * again into import-repositories.test.js, to keep each file inside the edit
 * hook's budget.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-import-repositories-')));
after(() => rmSync(root, { recursive: true, force: true }));

/** A fresh machine: a HOME, a WALKDOWN_HOME with a profile, and a runner. */
function machine(name) {
  const home = join(root, name);
  const wd = join(home, '.walkdown');
  mkdirSync(wd, { recursive: true });
  writeFileSync(join(wd, 'profile.yml'), 'identity:\n  username: sam\n  name: Sam\n');
  const env = { ...process.env, HOME: home, WALKDOWN_HOME: wd, NO_COLOR: '1' };
  const repo = (dir) => {
    const at = join(home, dir);
    mkdirSync(at, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: at });
    execFileSync(
      'git',
      // Named for its folder: two empty first commits made in one second are
      // one commit, and two repositories would share a first commit.
      ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '--allow-empty', '-m', at],
      { cwd: at },
    );
    return at;
  };
  const cli = (cwd, ...args) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env, input: '' });
  const rows = () => parse(readFileSync(join(wd, 'registry.yml'), 'utf8'))?.blueprints ?? [];
  return { home, wd, repo, cli, rows };
}

test('another repository at a moved checkout’s old path, holding the same home, does not keep its rows @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('other-at-old-path');
  const make = (dir, origin, msg) => {
    // Its own first commit: two empty ones made in one second are one commit.
    const at = join(m.home, dir);
    mkdirSync(at, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: at });
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: at });
    mkdirSync(join(at, '.walkdown', 'blueprints', 'cart'), { recursive: true });
    writeFileSync(join(at, '.walkdown', 'blueprints', 'cart', 'spec.yml'), `blueprint: ${msg}\n`);
    execFileSync('git', ['add', '-A'], { cwd: at });
    execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', msg], {
      cwd: at,
    });
    return at;
  };
  const shop = make('shop', 'https://example.com/acme/shop.git', 'acme');
  assert.equal(m.cli(shop, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  mkdirSync(join(m.home, 'work'));
  const moved = join(m.home, 'work', 'shop');
  execFileSync('mv', [shop, moved]);
  make('shop', 'https://example.com/zed/shop.git', 'zed');
  const r = m.cli(moved, 'blueprints', 'import', join('.walkdown', 'blueprints', 'cart'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``), r.stdout);
});

test('a shallow clone registered, deepened and moved keeps its IDs @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('shallow');
  const src = m.repo('src');
  mkdirSync(join(src, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(src, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: src });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: src,
  });
  const shop = join(m.home, 'shop');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${src}`, shop]);
  assert.equal(m.cli(shop, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  execFileSync('git', ['fetch', '-q', '--unshallow'], { cwd: shop });
  const moved = join(m.home, 'shop-moved');
  execFileSync('mv', [shop, moved]);
  const r = m.cli(moved, 'blueprints', 'import', join('.walkdown', 'blueprints', 'cart'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``), r.stdout);
});

test('--only and --json say the same whether or not anything is unlisted @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('only-alike');
  const repo = m.repo('shop');
  mkdirSync(join(repo, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(repo, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  assert.equal(m.cli(repo, 'blueprints', 'import', '.', '--all').status, 0);
  assert.equal(m.cli(repo, 'blueprints', 'import', '.', '--only', 'nope').status, 2);
  const listed = m.cli(repo, 'blueprints', 'import', '.', '--only', 'cart', '--json');
  assert.equal(JSON.parse(listed.stdout).listed.length, 1, listed.stdout);
  mkdirSync(join(repo, '.walkdown', 'blueprints', 'search'), { recursive: true });
  writeFileSync(join(repo, '.walkdown', 'blueprints', 'search', 'spec.yml'), 'blueprint: s\n');
  const bare = m.cli(repo, 'blueprints', 'import', '.', '--json');
  assert.equal(bare.status, 2);
  assert.equal(bare.stdout.trim(), '', 'stdout stays JSON or empty (n-0541)');
});

test('a checkout still standing keeps its rows when its origin is respelled or becomes a fork @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('fork');
  const src = m.repo('src');
  mkdirSync(join(src, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(src, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: src });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: src,
  });
  const shop = join(m.home, 'shop');
  execFileSync('git', ['clone', '-q', `file://${src}`, shop]);
  assert.equal(m.cli(shop, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  for (const url of [`file://${src}/`, 'https://example.com/me/shop.git']) {
    // A fork as `gh repo fork` leaves it: the old origin kept as upstream.
    if (url.startsWith('https')) {
      execFileSync('git', ['remote', 'rename', 'origin', 'upstream'], { cwd: shop });
      execFileSync('git', ['remote', 'add', 'origin', url], { cwd: shop });
    } else execFileSync('git', ['remote', 'set-url', 'origin', url], { cwd: shop });
    const review = join(m.home, `review-${url.length}`);
    execFileSync('git', ['clone', '-q', `file://${src}`, review]);
    const r = m.cli(review, 'blueprints', 'import', join('.walkdown', 'blueprints', 'cart'));
    assert.doesNotMatch(r.stdout, /moved|no longer exists/, `${url}: ${r.stdout}`);
    assert.equal(String(m.rows().find((x) => x.id === row.id).checkout), '~/shop', `n-0542 ${url}`);
  }
});

test('a home only a worktree holds is refused, and the worktree never becomes a project @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('worktree-only');
  const shop = m.repo('shop');
  mkdirSync(join(shop, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(shop, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: shop });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: shop,
  });
  assert.equal(m.cli(shop, 'blueprints', 'import', '.', '--all').status, 0);
  const wt = join(m.home, 'shop-wt');
  execFileSync('git', ['worktree', 'add', '-q', wt, '-b', 'feature'], { cwd: shop });
  mkdirSync(join(wt, '.walkdown', 'blueprints', 'promo'), { recursive: true });
  writeFileSync(join(wt, '.walkdown', 'blueprints', 'promo', 'spec.yml'), 'blueprint: promo\n');
  const one = m.cli(wt, 'blueprints', 'import', join('.walkdown', 'blueprints', 'promo'));
  assert.equal(one.status, 2, one.stdout);
  assert.match(one.stderr, /never registered/);
  const all = m.cli(wt, 'blueprints', 'import', '.', '--all');
  assert.doesNotMatch(all.stdout, /\+ listed/, all.stdout);
  assert.equal(m.rows().length, 1, 'only the checkout’s cart (n-0542)');
});

test('a worktree of a checkout not yet imported registers the checkout, never itself @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('worktree-first');
  const shop = m.repo('shop');
  for (const n of ['cart', 'billing']) {
    mkdirSync(join(shop, '.walkdown', 'blueprints', n), { recursive: true });
    writeFileSync(join(shop, '.walkdown', 'blueprints', n, 'spec.yml'), `blueprint: ${n}\n`);
  }
  execFileSync('git', ['add', '-A'], { cwd: shop });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: shop,
  });
  const wt = join(shop, '.claude', 'worktrees', 'x');
  execFileSync('git', ['worktree', 'add', '-q', wt, '-b', 'x'], { cwd: shop });
  const r = m.cli(wt, 'blueprints', 'import', join('.walkdown', 'blueprints', 'cart'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(m.rows()[0].checkout, '~/shop', 'the checkout, not the worktree (n-0543)');
  assert.equal(m.rows()[0].project, 'shop');
  const all = m.cli(wt, 'blueprints', 'import', '.', '--all');
  assert.equal(all.status, 0, all.stderr);
  assert.ok(
    m.rows().every((row) => row.checkout === '~/shop'),
    JSON.stringify(m.rows()),
  );
});

test('a checkout retargeted to a fork and then moved keeps its IDs @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('fork-moved');
  const shop = m.repo('shop');
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/acme/shop.git'], {
    cwd: shop,
  });
  mkdirSync(join(shop, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(shop, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: shop });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: shop,
  });
  assert.equal(m.cli(shop, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  execFileSync('git', ['remote', 'rename', 'origin', 'upstream'], { cwd: shop });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/me/shop.git'], {
    cwd: shop,
  });
  mkdirSync(join(m.home, 'code'));
  const moved = join(m.home, 'code', 'shop');
  execFileSync('mv', [shop, moved]);
  const r = m.cli(moved, 'blueprints', 'import', '.', '--all');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``), r.stdout);
  assert.equal(m.rows().length, 1, 'no new IDs (n-0543)');
});

test('a repository that only looks like a gone project is never told it moved: a template sibling, with a remote or none; the project itself is @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('one-template');
  const starter = m.repo('starter');
  // The table in repository.test.js holds every case; this is one real
  // sibling, sharing the first commit, to keep what import prints honest.
  const project = (name, origin = `https://example.com/acme/${name}.git`) => {
    const at = join(m.home, name);
    execFileSync('git', ['clone', '-q', starter, at]);
    if (origin) execFileSync('git', ['remote', 'set-url', 'origin', origin], { cwd: at });
    else execFileSync('git', ['remote', 'remove', 'origin'], { cwd: at });
    mkdirSync(join(at, '.walkdown', 'blueprints', 'web'), { recursive: true });
    writeFileSync(join(at, '.walkdown', 'blueprints', 'web', 'spec.yml'), 'blueprint: web\n');
    execFileSync('git', ['add', '-A'], { cwd: at });
    execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', name], {
      cwd: at,
    });
    return at;
  };
  const alpha = project('alpha');
  assert.equal(m.cli(alpha, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  mkdirSync(join(m.home, 'code'));
  const moved = join(m.home, 'code', 'alpha');
  execFileSync('mv', [alpha, moved]);
  const beta = project('beta');
  const b = m.cli(beta, 'blueprints', 'import', '.', '--all');
  assert.doesNotMatch(b.stdout, /moved/, b.stdout);
  assert.equal(String(m.rows().find((r) => r.id === row.id).checkout), '~/alpha', 'n-0544');
  assert.ok(
    m.rows().some((r) => r.project === 'beta'),
    'beta is a project of its own',
  );
  const gamma = project('gamma', null);
  const g = m.cli(gamma, 'blueprints', 'import', '.', '--all');
  assert.doesNotMatch(g.stdout, /moved/, g.stdout);
  assert.equal(String(m.rows().find((r) => r.id === row.id).checkout), '~/alpha', 'n-0545');
  const a = m.cli(moved, 'blueprints', 'import', '.', '--all');
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, new RegExp(`~ moved .*\`${row.id}\``), a.stdout);
});

test('a template sibling at a moved checkout’s old path does not hold its rows there @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  // Another origin at the old path; no remote at all is in the table.
  for (const [n, other] of [[1, 'git@github.com:zed/site.git']]) {
    const m = machine(`sibling-at-old-path-${n}`);
    const starter = m.repo('starter');
    const clone = (at, origin) => {
      mkdirSync(join(at, '..'), { recursive: true });
      execFileSync('git', ['clone', '-q', starter, at]);
      if (origin) execFileSync('git', ['remote', 'set-url', 'origin', origin], { cwd: at });
      else execFileSync('git', ['remote', 'remove', 'origin'], { cwd: at });
      mkdirSync(join(at, '.walkdown', 'blueprints', 'web'), { recursive: true });
      writeFileSync(join(at, '.walkdown', 'blueprints', 'web', 'spec.yml'), 'blueprint: web\n');
      execFileSync('git', ['add', '-A'], { cwd: at });
      execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', at], {
        cwd: at,
      });
      return at;
    };
    const site = clone(join(m.home, 'clients', 'site'), 'git@github.com:acme/site.git');
    assert.equal(m.cli(site, 'blueprints', 'import', '.', '--all').status, 0);
    const [row] = m.rows();
    const archived = join(m.home, 'archive', 'site');
    mkdirSync(join(archived, '..'), { recursive: true });
    execFileSync('mv', [site, archived]);
    clone(site, other);
    const r = m.cli(archived, 'blueprints', 'import', '.', '--all');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``), `${n}: ${r.stdout}`);
  }
});

test('a sibling standing where a deleted project stood is refused, not claimed under its IDs @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('sibling-claimed');
  const tpl = m.repo('tpl');
  mkdirSync(join(tpl, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(tpl, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: tpl });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: tpl,
  });
  const app = join(m.home, 'app');
  const clone = (origin) => {
    execFileSync('git', ['clone', '-q', tpl, app]);
    execFileSync('git', ['remote', 'set-url', 'origin', origin], { cwd: app });
  };
  clone('git@github.com:acme/app.git');
  assert.equal(m.cli(app, 'blueprints', 'import', '.', '--all').status, 0);
  rmSync(app, { recursive: true, force: true });
  clone('git@github.com:acme/shop.git');
  const r = m.cli(app, 'blueprints', 'import', '.', '--all');
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /another repository/);
  assert.match(r.stderr, /blueprints forget/);
  assert.doesNotMatch(r.stdout, /already listed/, 'n-0547');
});

test('a repository with no commits never takes a project that had one @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('no-commits');
  const notes = m.repo('notes');
  mkdirSync(join(notes, '.walkdown', 'blueprints', 'billing'), { recursive: true });
  writeFileSync(join(notes, '.walkdown', 'blueprints', 'billing', 'spec.yml'), 'blueprint: b\n');
  assert.equal(m.cli(notes, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  rmSync(notes, { recursive: true, force: true });
  const fresh = join(m.home, 'fresh');
  mkdirSync(join(fresh, '.walkdown', 'blueprints', 'billing'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: fresh });
  writeFileSync(join(fresh, '.walkdown', 'blueprints', 'billing', 'spec.yml'), 'blueprint: b\n');
  const r = m.cli(fresh, 'blueprints', 'import', '.', '--all');
  assert.doesNotMatch(r.stdout, /moved/, r.stdout);
  assert.equal(m.rows().find((x) => x.id === row.id).checkout, '~/notes', 'n-0547');
});

test('a checkout that stays put and only changes its remote is still the one listed @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('remote-in-place');
  const app = m.repo('app');
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], { cwd: app });
  mkdirSync(join(app, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(app, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: app });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: app,
  });
  assert.equal(m.cli(app, 'blueprints', 'import', '.', '--all').status, 0);
  for (const step of [
    ['remote', 'set-url', 'origin', 'git@github.com:neworg/app.git'],
    ['remote', 'remove', 'origin'],
  ]) {
    execFileSync('git', step, { cwd: app });
    const r = m.cli(app, 'blueprints', 'import', '.', '--all');
    assert.equal(r.status, 0, `${step.join(' ')}: ${r.stderr}`);
    assert.match(r.stdout, /already listed/, 'n-0548');
  }
});

test('a checkout that never moved stays listed after an amend and a gc, and after a re-clone missing a local commit @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('amend-gc');
  const bare = join(m.home, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  const app = join(m.home, 'app');
  execFileSync('git', ['clone', '-q', bare, app]);
  const commit = (msg, ...extra) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=s',
        '-c',
        'user.email=s@x',
        'commit',
        '-q',
        '--allow-empty',
        ...extra,
        '-m',
        msg,
      ],
      { cwd: app },
    );
  mkdirSync(join(app, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(app, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: app });
  commit('h');
  execFileSync('git', ['push', '-q', 'origin', 'HEAD'], { cwd: app });
  commit('local only');
  assert.equal(m.cli(app, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  commit('reworded', '--amend');
  execFileSync('git', ['reflog', 'expire', '--expire-unreachable=now', '--all'], { cwd: app });
  execFileSync('git', ['gc', '-q', '--prune=now'], { cwd: app });
  const amended = m.cli(app, 'blueprints', 'import', '.', '--all');
  assert.equal(amended.status, 0, amended.stderr);
  assert.match(amended.stdout, /already listed/, 'n-0549: amend and gc');
  rmSync(app, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', bare, app]);
  const recloned = m.cli(app, 'blueprints', 'import', '.', '--all');
  assert.equal(recloned.status, 0, recloned.stderr);
  assert.match(recloned.stdout, new RegExp(`already listed|\`${row.id}\``), 'n-0549: re-clone');
  assert.equal(m.rows().length, 1);
  // The re-clone's rows learnt its .git, so a remote changed in place later
  // is the same checkout still (n-0551).
  execFileSync('git', ['remote', 'set-url', 'origin', 'git@github.com:acme-inc/app.git'], {
    cwd: app,
  });
  const renamed = m.cli(app, 'blueprints', 'import', '.', '--all');
  assert.equal(renamed.status, 0, renamed.stderr);
  assert.match(renamed.stdout, /already listed/, 'n-0551');
});

test('a checkout whose only commit was amended and collected, then moved, keeps its IDs without --project @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('amend-then-move');
  const app = join(m.home, 'shop');
  mkdirSync(join(app, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: app });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/shop.git'], { cwd: app });
  writeFileSync(join(app, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: app });
  const commit = (...extra) =>
    execFileSync(
      'git',
      ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', ...extra, '-m', 'h'],
      { cwd: app },
    );
  commit();
  assert.equal(m.cli(app, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  commit('--amend', '--date', '2001-01-01T00:00:00');
  execFileSync('git', ['reflog', 'expire', '--expire-unreachable=now', '--all'], { cwd: app });
  execFileSync('git', ['gc', '-q', '--prune=now'], { cwd: app });
  mkdirSync(join(m.home, 'code'));
  const moved = join(m.home, 'code', 'shop');
  execFileSync('mv', [app, moved]);
  const r = m.cli(moved, 'blueprints', 'import', '.', '--all');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``), r.stdout);
});

test('another repository renamed into a moved project’s path, older than its registration, does not keep its rows @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('swap');
  const make = (dir, origin) => {
    const at = m.repo(dir);
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: at });
    mkdirSync(join(at, '.walkdown', 'blueprints', 'cart'), { recursive: true });
    writeFileSync(join(at, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
    execFileSync('git', ['add', '-A'], { cwd: at });
    execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', dir], {
      cwd: at,
    });
    return at;
  };
  const app = make('app', 'git@github.com:acme/app.git');
  const v2 = make('app-v2', 'git@github.com:acme/app-v2.git');
  assert.equal(m.cli(app, 'blueprints', 'import', '.', '--all').status, 0);
  const [row] = m.rows();
  const old = join(m.home, 'app-old');
  execFileSync('mv', [app, old]);
  execFileSync('mv', [v2, app]);
  const r = m.cli(old, 'blueprints', 'import', '.', '--all');
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    new RegExp(`~ moved .*\`${row.id}\`.*another repository stands now`),
    'n-0550',
  );
});

test('a row kept before the birth time was learns it on import, and --project vouches for it once no fact can @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('legacy-git');
  const app = m.repo('app');
  mkdirSync(join(app, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(app, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  assert.equal(m.cli(app, 'blueprints', 'import', '.', '--all').status, 0);
  const born = String(m.rows()[0].git);
  if (born.split(':').length < 3) return; // a disk that keeps no birth time
  // As 1d16c3d^ wrote it: device and inode only (n-0552).
  const reg = join(m.wd, 'registry.yml');
  const legacy = () =>
    writeFileSync(reg, readFileSync(reg, 'utf8').replace(/(git: \d+:\d+):\d+/, '$1'));
  legacy();
  const learnt = m.cli(app, 'blueprints', 'import', '.', '--all');
  assert.match(learnt.stdout, /already listed/, learnt.stdout);
  assert.equal(String(m.rows()[0].git), born, 'its first commit vouched, it learns its birth time');
  // Rewritten and collected before any import: nothing tells it from another
  // repository on a reused inode, so the person says (n-0553).
  legacy();
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', ...args], { cwd: app });
  git('commit', '-q', '--amend', '--allow-empty', '-m', 'r');
  git('reflog', 'expire', '--expire-unreachable=now', '--all');
  git('gc', '-q', '--prune=now');
  const refused = m.cli(app, 'blueprints', 'import', '.', '--all');
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stderr, /`--project app` says so and keeps its IDs/);
  const [row] = m.rows();
  const vouched = m.cli(app, 'blueprints', 'import', '.', '--all', '--project', 'app');
  assert.equal(vouched.status, 0, vouched.stderr);
  assert.match(vouched.stdout, /already listed/, vouched.stdout);
  assert.equal(m.rows()[0].id, row.id);
  assert.equal(String(m.rows()[0].git), born);
  assert.equal(m.cli(app, 'blueprints', 'import', '.', '--all').status, 0, 'asked once');
});

test('a home kept on this machine, imported by its path from another repository at its checkout, is refused: only the person vouches @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('kept-unasked');
  const shop = m.repo('shop');
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/shop.git'], { cwd: shop });
  mkdirSync(join(shop, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(shop, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: shop });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'c'], {
    cwd: shop,
  });
  assert.equal(m.cli(shop, 'blueprints', 'import', '.', '--all').status, 0);
  const made = m.cli(shop, 'blueprints', 'new', 'billing');
  assert.equal(made.status, 0, made.stderr);
  const before = readFileSync(join(m.wd, 'registry.yml'), 'utf8').replace(/^built: .*\n/m, '');
  const kept = String(m.rows().find((r) => String(r.id).endsWith('-billing'))?.home);
  assert.match(kept, /projects/, 'billing is kept on this machine');
  rmSync(shop, { recursive: true, force: true });
  const site = m.repo('website');
  execFileSync('git', ['clone', '-q', site, shop]);
  execFileSync('git', ['remote', 'set-url', 'origin', 'git@github.com:other/website.git'], {
    cwd: shop,
  });
  const r = m.cli(shop, 'blueprints', 'import', kept.replace(/^~/, m.home));
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /another repository/);
  const after = readFileSync(join(m.wd, 'registry.yml'), 'utf8').replace(/^built: .*\n/m, '');
  assert.equal(after, before, 'no row learnt the other repository (n-0554)');
});
