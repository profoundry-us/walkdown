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

test('two projects from one template are two repositories, though they share a first commit @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('one-template');
  const starter = m.repo('starter');
  const project = (name) => {
    const at = join(m.home, name);
    execFileSync('git', ['clone', '-q', starter, at]);
    execFileSync('git', ['remote', 'set-url', 'origin', `https://example.com/acme/${name}.git`], {
      cwd: at,
    });
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
  const a = m.cli(moved, 'blueprints', 'import', '.', '--all');
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, new RegExp(`~ moved .*\`${row.id}\``), a.stdout);
});

test('a template sibling with no remote never takes a project whose origin it does not name @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('bare-sibling');
  const starter = m.repo('starter');
  const project = (name, origin) => {
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
  const alpha = project('alpha', 'https://example.com/acme/alpha.git');
  assert.equal(m.cli(alpha, 'blueprints', 'import', '.', '--all').status, 0);
  rmSync(alpha, { recursive: true, force: true });
  const gamma = project('gamma', null);
  const r = m.cli(gamma, 'blueprints', 'import', '.', '--all');
  assert.doesNotMatch(r.stdout, /moved/, r.stdout);
  assert.equal(m.rows().find((row) => row.project === 'alpha')?.checkout, '~/alpha', 'n-0545');
});

test('a template sibling at a moved checkout’s old path does not hold its rows there @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  // Another origin at the old path, or no remote at all (n-0546).
  for (const [n, other] of [
    [1, 'git@github.com:zed/site.git'],
    [2, null],
  ]) {
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

test('a clone where a gone project stood is never filed under that project @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('clone-into-gone');
  const app = m.repo('app');
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], { cwd: app });
  mkdirSync(join(app, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(app, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  execFileSync('git', ['add', '-A'], { cwd: app });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: app,
  });
  assert.equal(m.cli(app, 'blueprints', 'import', '.', '--all').status, 0);
  rmSync(app, { recursive: true, force: true });
  const other = m.repo('other');
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/other.git'], {
    cwd: other,
  });
  mkdirSync(join(other, '.walkdown', 'blueprints', 'docs'), { recursive: true });
  writeFileSync(join(other, '.walkdown', 'blueprints', 'docs', 'spec.yml'), 'blueprint: docs\n');
  execFileSync('git', ['add', '-A'], { cwd: other });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'o'], {
    cwd: other,
  });
  execFileSync('git', ['clone', '-q', other, app]);
  execFileSync('git', ['remote', 'set-url', 'origin', 'git@github.com:acme/other.git'], {
    cwd: app,
  });
  const r = m.cli(app, 'blueprints', 'import', '.', '--all');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(m.rows().find((x) => String(x.id).endsWith('-docs'))?.project, 'other', 'n-0548');
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
});
