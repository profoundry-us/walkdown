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
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-import-moves-')));
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

test('a moved checkout reports every row the move re-pointed as moved, not as already listed @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('moved-three');
  const repo = m.repo('repo');
  for (const n of ['alpha', 'beta', 'gamma'])
    assert.equal(m.cli(repo, 'blueprints', 'new', n, '--commit', 'spec').status, 0);
  const moved = join(m.home, 'repo2');
  execFileSync('mv', [repo, moved]);
  const r = m.cli(moved, 'blueprints', 'import', '.', '--all');
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/~ moved/g) ?? []).length, 3, r.stdout);
  assert.doesNotMatch(r.stdout, /already listed/);
  // Pointed at one home after a move, the rows that moved with it are said too.
  const again = join(m.home, 'repo3');
  execFileSync('mv', [moved, again]);
  const one = m.cli(again, 'blueprints', 'import', join('.walkdown', 'blueprints', 'beta'));
  assert.equal(one.status, 0, one.stderr);
  assert.equal((one.stdout.match(/~ moved/g) ?? []).length, 3, one.stdout);
});

test('after a move, a checkout with only some homes registered takes the rest, and keeps the one it had @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('moved-partly');
  const repo = m.repo('shop');
  for (const n of ['checkout', 'search', 'billing']) {
    mkdirSync(join(repo, '.walkdown', 'blueprints', n), { recursive: true });
    writeFileSync(join(repo, '.walkdown', 'blueprints', n, 'spec.yml'), `blueprint: ${n}\n`);
  }
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
    cwd: repo,
  });
  const first = m.cli(repo, 'blueprints', 'import', join('.walkdown', 'blueprints', 'billing'));
  assert.equal(first.status, 0, first.stderr);
  const id = String(m.rows()[0].id);
  const moved = join(m.home, 'shop-moved');
  execFileSync('mv', [repo, moved]);
  // The one home it was pointed at, which happens to sort before the registered one (n-0533).
  const r = m.cli(moved, 'blueprints', 'import', join('.walkdown', 'blueprints', 'checkout'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`~ moved .*keeps its ID \`${id}\``));
  assert.equal(new Set(m.rows().map((row) => row.project)).size, 1, 'one project, not two');
});

test('a gone checkout is never taken over by an unrelated repository that shares its folder layout @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('unrelated-layout');
  const make = (dir, origin) => {
    const at = m.repo(dir);
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: at });
    for (const n of ['cart', 'billing']) {
      mkdirSync(join(at, '.walkdown', 'blueprints', n), { recursive: true });
      writeFileSync(join(at, '.walkdown', 'blueprints', n, 'spec.yml'), `blueprint: ${n}\n`);
    }
    return at;
  };
  const shop = make('shop', 'https://example.com/acme/shop.git');
  assert.equal(
    m.cli(shop, 'blueprints', 'import', join('.walkdown', 'blueprints', 'cart')).status,
    0,
  );
  rmSync(shop, { recursive: true, force: true });
  const outlet = make('outlet', 'https://example.com/acme/outlet.git');
  const r = m.cli(outlet, 'blueprints', 'import', join('.walkdown', 'blueprints', 'billing'));
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /moved/, r.stdout);
  const rows = m.rows();
  assert.equal(rows.find((row) => String(row.id).endsWith('-cart'))?.project, 'shop');
  assert.match(String(rows.find((row) => String(row.id).endsWith('-cart'))?.home), /shop/);
  assert.equal(rows.find((row) => String(row.id).endsWith('-billing'))?.project, 'outlet');
});

test('a checkout still standing, at a commit from before its homes, is never taken over @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('still-standing');
  const make = (dir) => {
    const at = m.repo(dir);
    for (const n of ['cart', 'billing']) {
      mkdirSync(join(at, '.walkdown', 'blueprints', n), { recursive: true });
      writeFileSync(join(at, '.walkdown', 'blueprints', n, 'spec.yml'), `blueprint: ${n}\n`);
    }
    execFileSync('git', ['add', '-A'], { cwd: at });
    execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
      cwd: at,
    });
    return at;
  };
  const shop = make('shop');
  assert.equal(m.cli(shop, 'blueprints', 'import', '.', '--only', 'cart,billing').status, 0);
  execFileSync('git', ['checkout', '-q', 'HEAD~1'], { cwd: shop });
  const outlet = make('outlet');
  const r = m.cli(outlet, 'blueprints', 'import', join('.walkdown', 'blueprints', 'billing'));
  assert.doesNotMatch(r.stdout, /moved|no longer exists/, r.stdout);
  for (const row of m.rows().filter((row) => row.project === 'shop'))
    assert.match(String(row.home), /\/shop\//, `${row.id} still at shop (n-0538)`);
});

test('a gone checkout is not taken over by another owner’s repository of the same name @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('same-name');
  const make = (dir, origin) => {
    const at = m.repo(dir);
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: at });
    mkdirSync(join(at, '.walkdown', 'blueprints', 'cart'), { recursive: true });
    writeFileSync(join(at, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
    return at;
  };
  const acme = make('acme-shop', 'https://example.com/acme/shop.git');
  assert.equal(m.cli(acme, 'blueprints', 'import', '.', '--all').status, 0);
  const home = String(m.rows()[0].home);
  rmSync(acme, { recursive: true, force: true });
  const zed = make('zed-shop', 'https://example.com/zed/shop.git');
  const r = m.cli(zed, 'blueprints', 'import', '.', '--all');
  assert.doesNotMatch(r.stdout, /moved/, r.stdout);
  assert.equal(String(m.rows()[0].home), home, 'acme/shop’s row is not re-pointed (n-0538)');
});

test('--only naming a folder already listed says so and imports the rest @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('only-listed');
  const repo = m.repo('shop');
  for (const n of ['cart', 'billing']) {
    mkdirSync(join(repo, '.walkdown', 'blueprints', n), { recursive: true });
    writeFileSync(join(repo, '.walkdown', 'blueprints', n, 'spec.yml'), `blueprint: ${n}\n`);
  }
  assert.equal(m.cli(repo, 'blueprints', 'import', '.', '--only', 'cart').status, 0);
  const r = m.cli(repo, 'blueprints', 'import', '.', '--only', 'cart,billing');
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/already listed/g) ?? []).length, 1, r.stdout);
  assert.match(r.stdout, /already listed\s+cart/);
  assert.equal(m.rows().length, 2, 'billing registered (n-0538)');
  const json = m.cli(repo, 'blueprints', 'import', '.', '--only', 'cart', '--json');
  assert.equal(JSON.parse(json.stdout).listed.length, 1, json.stdout);
});

test('a checkout still standing on another branch, or registered by an older walkdown, is never taken over @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const m = machine('other-branch');
  const make = (dir) => {
    const at = m.repo(dir);
    for (const n of ['cart', 'billing']) {
      mkdirSync(join(at, '.walkdown', 'blueprints', n), { recursive: true });
      writeFileSync(join(at, '.walkdown', 'blueprints', n, 'spec.yml'), `blueprint: ${n}\n`);
    }
    execFileSync('git', ['add', '-A'], { cwd: at });
    execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'h'], {
      cwd: at,
    });
    return at;
  };
  const shop = make('shop');
  assert.equal(m.cli(shop, 'blueprints', 'import', '.', '--all').status, 0);
  // As an older walkdown wrote it: no root, no origin (n-0540).
  const reg = join(m.wd, 'registry.yml');
  writeFileSync(reg, readFileSync(reg, 'utf8').replace(/^\s+root: .*\n/gm, ''));
  execFileSync('git', ['checkout', '-q', '--orphan', 'pages'], { cwd: shop });
  execFileSync('git', ['rm', '-rqf', '.'], { cwd: shop });
  execFileSync(
    'git',
    ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '--allow-empty', '-m', 'p'],
    { cwd: shop },
  );
  const outlet = make('outlet');
  const r = m.cli(outlet, 'blueprints', 'import', join('.walkdown', 'blueprints', 'billing'));
  assert.doesNotMatch(r.stdout, /moved|no longer exists/, r.stdout);
  for (const row of m.rows().filter((row) => row.project === 'shop'))
    assert.match(String(row.home), /\/shop\//, `${row.id} still at shop`);
});

test('a checkout spelled in another case is the one already listed, on a disk that ignores case @rule:commands.blueprints.import-takes-what-it-is-pointed-at', (t) => {
  const m = machine('case-spelling');
  const repo = m.repo('Shop');
  mkdirSync(join(repo, '.walkdown', 'blueprints', 'cart'), { recursive: true });
  writeFileSync(join(repo, '.walkdown', 'blueprints', 'cart', 'spec.yml'), 'blueprint: cart\n');
  if (!existsSync(join(m.home, 'shop'))) return t.skip('this disk keeps case apart');
  assert.equal(m.cli(repo, 'blueprints', 'import', '.', '--all').status, 0);
  const r = m.cli(m.home, 'blueprints', 'import', join(m.home, 'shop'), '--all');
  assert.doesNotMatch(r.stdout, /\+ listed/, r.stdout);
  assert.equal(m.rows().length, 1, 'one row, not two (n-0541)');
});
