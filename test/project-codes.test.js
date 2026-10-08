/*
 * What `blueprints new` says when a project's label or code is refused, and
 * what a bare `--blueprint` name means outside its project: each refusal is
 * true, and the command it suggests works as printed.
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
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-project-codes-')));
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
      ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '--allow-empty', '-m', 'i'],
      { cwd: at },
    );
    return at;
  };
  const cli = (cwd, ...args) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env, input: '' });
  const rows = () => parse(readFileSync(join(wd, 'registry.yml'), 'utf8'))?.blueprints ?? [];
  return { home, wd, repo, cli, rows };
}

test('a code-taken refusal keeps the label the person gave, and its command works as printed @rule:locations.registry.projects-are-labels', () => {
  const m = machine('keeps-label');
  m.cli(m.repo('ws'), 'blueprints', 'new', 'a');
  const q = m.repo('q');
  const r = m.cli(q, 'blueprints', 'new', 'b', '--project', 'mine', '--code', 'ws');
  assert.equal(r.status, 2, r.stderr);
  const cmd = r.stderr.match(/`walkdown (blueprints new [^`]+)`/)?.[1];
  assert.match(cmd, /--project mine --code \w+$/, 'the suggestion keeps --project mine');
  const again = m.cli(q, ...cmd.split(' '));
  assert.equal(again.status, 0, again.stderr);
  assert.equal(m.rows().find((row) => String(row.id).endsWith('-b'))?.project, 'mine');
});

test('a code that is no code is refused before anything is made, so the next try is not blocked @rule:locations.registry.projects-are-labels', () => {
  const m = machine('bad-code');
  const q = m.repo('q');
  const r = m.cli(q, 'blueprints', 'new', 'c', '--project', 'rr', '--code', 'shop');
  assert.equal(r.status, 2, r.stderr);
  assert.match(
    r.stderr,
    /`shop` is not a project code — two or three lowercase letters or digits\. Nothing was made\./,
  );
  assert.equal(existsSync(join(m.wd, 'projects', 'rr')), false, 'no home was made');
  assert.equal(m.cli(q, 'blueprints', 'new', 'c', '--project', 'rr', '--code', 'rr').status, 0);
});

test('outside its project a bare name is refused with the ID that reaches it, never as unregistered @rule:locations.answer.says-why', () => {
  const m = machine('bare-name');
  m.cli(m.repo('shop'), 'blueprints', 'new', 'checkout');
  const id = String(m.rows()[0].id);
  for (const args of [
    ['where', 'spec', '--blueprint', 'checkout'],
    ['status', '--blueprint', 'checkout'],
  ]) {
    const r = m.cli(m.home, ...args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.doesNotMatch(r.stderr, /no registered blueprint|nothing registered it/, args.join(' '));
    assert.match(r.stderr, new RegExp(`name it by its ID: \`--blueprint ${id}\``), args.join(' '));
  }
  assert.equal(
    m.cli(m.home, 'where', 'spec', '--blueprint', id).status,
    0,
    'and the ID works there',
  );
});

test('serve started in a project with several blueprints names them, and never calls it unregistered @rule:locations.answer.serve-starts-anywhere', async () => {
  const m = machine('serve-several');
  const p = m.repo('shop');
  m.cli(p, 'blueprints', 'new', 'a');
  m.cli(p, 'blueprints', 'new', 'b');
  const ids = m.rows().map((r) => String(r.id));
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], {
    cwd: p,
    env: { ...process.env, HOME: m.home, WALKDOWN_HOME: m.wd, NO_COLOR: '1' },
  });
  const out = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`no banner: ${text}`)), 10000);
    child.stdout.on('data', (d) => {
      text += d;
      if (text.includes('Ctrl-C')) {
        clearTimeout(timer);
        resolve(text);
      }
    });
  });
  try {
    assert.doesNotMatch(out, /outside a registered project/);
    assert.match(out, new RegExp(`a project with several blueprints \\(${ids.join(', ')}\\)`));
    // And an API call naming no blueprint is refused truthfully too (n-0523).
    const port = out.match(/localhost:(\d+)\//)[1];
    const res = await fetch(`http://localhost:${port}/api/threads`);
    assert.equal(res.status, 404);
    const { error } = await res.json();
    assert.doesNotMatch(error, /outside any registered project/);
    assert.match(error, /name one with \?bp=<id>/);
  } finally {
    child.kill();
  }
});

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
  assert.match(r.stdout, /already listed\s+cart/);
  assert.equal(m.rows().length, 2, 'billing registered (n-0538)');
});
