/*
 * A worktree is the project's (ADR 0014 §10). Agents build in worktrees -
 * Claude Code's beside the checkout, Archon's from a clone of its own - and
 * what they make there belongs to the project the checkout is registered as.
 * The branch's spec and threads are read from the worktree, so a reworded
 * rule counts on its branch; the records git ignores are written where the
 * registry says, so deleting the worktree takes no ledger with it.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const RECORD = new URL('../lib/run-record.js', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-worktree-')));
after(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let n = 0;
function machine() {
  const home = join(root, `home-${++n}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: sam\n');
  const shop = join(root, `m${n}`, 'shop');
  mkdirSync(shop, { recursive: true });
  git(shop, 'init', '-q', '-b', 'main');
  git(shop, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git');
  writeFileSync(join(shop, 'README.md'), 'shop\n');
  const env = { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: home };
  const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  const made = cli(shop, 'blueprints', 'new', '--commit', 'spec', '--folder', 'shop');
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const home_ = join(shop, '.walkdown', 'blueprints', 'shop');
  writeFileSync(
    join(home_, 'features', 'cart.yml'),
    [
      'feature: cart',
      'stories:',
      '  - id: cart.add',
      '    rules:',
      '      - id: cart.add.one',
      '        statement: Adding an item puts one in the cart.',
      '        because: People count.',
      '        verify: [checks]',
      '',
    ].join('\n'),
  );
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'shop');
  return { home, shop, home_, env, cli, registry: () => parse(readFileSync(join(home, 'registry.yml'), 'utf8')) };
}

const json = (r) => {
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};

test('a worktree of a registered checkout answers as its project, by git or by origin @rule:locations.worktree.same-project', () => {
  const m = machine();
  const id = m.registry().blueprints[0].id;

  // Claude Code's: a git worktree inside the checkout, and one beside it.
  const cc = join(m.shop, '.claude', 'worktrees', 'cc');
  git(m.shop, 'worktree', 'add', '-q', '-b', 'cc-branch', cc);
  const beside = join(root, 'm1-beside');
  git(m.shop, 'worktree', 'add', '-q', '-b', 'beside-branch', beside);
  // Archon's: its own clone of the same origin, under its workspaces.
  const archon = join(root, 'archon', 'workspaces', 'acme', 'shop', 'worktrees', 'feature');
  mkdirSync(join(archon, '..'), { recursive: true });
  git(root, 'clone', '-q', m.shop, archon);
  git(archon, 'remote', 'set-url', 'origin', 'https://github.com/acme/shop.git');
  // And a clone of something else entirely.
  const other = join(root, 'other');
  mkdirSync(other, { recursive: true });
  git(other, 'init', '-q');
  git(other, 'remote', 'add', 'origin', 'https://github.com/acme/other.git');

  const rows = m.registry().blueprints.length;
  for (const [dir, how] of [
    [cc, /a git worktree of/],
    [beside, /a git worktree of/],
    [archon, /a clone of .*origin/],
  ]) {
    const where = json(m.cli(dir, 'where', '--json'));
    assert.equal(where.id, id, `${dir} answers as shop's blueprint`);
    assert.match(JSON.stringify(where), how, 'and where says which way it was matched');
    assert.equal(m.cli(dir, 'status').status, 0);
  }
  const lost = m.cli(other, 'where', '--json');
  assert.doesNotMatch(lost.stdout, new RegExp(id), 'the unrelated clone is not a project');
  assert.equal(m.registry().blueprints.length, rows, 'no worktree gets a registry row');

  // `blueprints new` in a worktree adds to shop, and makes the home in shop's place.
  const added = m.cli(cc, 'blueprints', 'new', 'search', '--folder', 'search');
  assert.equal(added.status, 0, added.stdout + added.stderr);
  const search = m.registry().blueprints.find((r) => r.id.endsWith('-search'));
  assert.ok(search, 'the new blueprint is registered');
  assert.equal(search.project, m.registry().blueprints[0].project, 'in shop');
  assert.ok(!m.registry().blueprints.some((r) => /worktrees|m1-beside/.test(String(r.checkout ?? '')) || String(r.home).includes('worktrees')), 'the worktree is no checkout');
  assert.ok(!existsSync(join(cc, '.walkdown', 'blueprints', 'search')), 'and nothing was made in the worktree');
});

for (const [layout, at] of [
  ['beside the checkout', (m) => join(root, `m${n}-wt`)],
  // Claude Code's own place for them: inside the repository.
  ['inside the checkout, as Claude Code makes them', (m) => join(m.shop, '.claude', 'worktrees', 'reword')],
])
test(`in a worktree ${layout} the branch spec and threads are read there, and ignored records go to the registered home @rule:locations.worktree.branch-spec-shared-records`, async () => {
  const m = machine();
  const wt = at(m);
  git(m.shop, 'worktree', 'add', '-q', '-b', 'reword', wt);
  assert.match(JSON.stringify(json(m.cli(wt, 'where', '--json'))), /a git worktree of/, 'where says how it was matched');
  const branchHome = join(wt, '.walkdown', 'blueprints', 'shop');

  // A branch that rewords a rule reads as the branch has it.
  const f = join(branchHome, 'features', 'cart.yml');
  writeFileSync(f, readFileSync(f, 'utf8').replace('puts one in the cart', 'puts exactly one in the cart'));
  const st = json(m.cli(wt, 'status', '--json'));
  assert.match(JSON.stringify(st), /puts exactly one in the cart/);
  assert.doesNotMatch(JSON.stringify(json(m.cli(m.shop, 'status', '--json'))), /exactly one/, 'and main still reads its own');

  // A thread lands in the worktree's tree.
  const filed = m.cli(wt, 'threads', 'new', '--rule', 'cart.add.one', '--body', 'Seen on the branch.', '--as-agent');
  assert.equal(filed.status, 0, filed.stdout + filed.stderr);
  assert.equal(readdirSync(join(branchHome, 'threads')).filter((x) => x.endsWith('.yml')).length, 1);
  assert.ok(!existsSync(join(m.home_, 'threads')) || !readdirSync(join(m.home_, 'threads')).some((x) => x.endsWith('.yml')));

  // A run lands in the registered checkout's runs, stamped with the worktree's commit and branch.
  writeFileSync(join(wt, 'change.txt'), 'x\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'branch work');
  const sha = git(wt, 'rev-parse', '--short', 'HEAD');
  const record = (dir) =>
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { writeRunRecord } from ${JSON.stringify(RECORD)};
         const { file, record } = writeRunRecord({ blueprintDir: ${JSON.stringify(dir)}, cwd: process.cwd(), target: 'local', actor: 'sam',
           results: [{ rule: 'cart.add.one', status: 'pass' }] });
         console.log(JSON.stringify({ file, record }));`,
      ],
      { cwd: dir === branchHome ? wt : m.shop, encoding: 'utf8', env: m.env },
    );
  const run = JSON.parse(record(branchHome));
  assert.ok(run.file.startsWith(join(m.home_, 'runs')), `${run.file} is in the registered home's runs`);
  assert.match(run.record.git_sha, new RegExp(`^${sha}`));
  assert.equal(run.record.branch, 'reword');

  // `serve` started in the worktree serves the branch's spec.
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { cwd: wt, env: m.env });
  try {
    const out = await new Promise((ok, no) => {
      let said = '';
      const timer = setTimeout(() => no(new Error(`no answer: ${said}`)), 10_000);
      const take = (d) => {
        said += d;
        if (/review:\s+http:\/\/localhost:\d+/.test(said)) {
          clearTimeout(timer);
          ok(said);
        }
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
    });
    const port = out.match(/localhost:(\d+)/)[1];
    for (const q of ['', `?bp=shop`]) {
      const body = await (await fetch(`http://localhost:${port}/api/blueprint${q}`)).text();
      assert.match(body, /puts exactly one in the cart/, `served${q || ' by default'} as the branch has it`);
      assert.equal(JSON.parse(body).key, m.home_, 'under the key the registry knows, which every write names');
    }
  } finally {
    child.kill();
  }

  // Deleting the worktree loses no run.
  git(m.shop, 'worktree', 'remove', '--force', wt);
  assert.ok(existsSync(run.file), 'the run outlived the worktree');
});

test('a blueprint that commits its runs writes them into the worktree @rule:locations.worktree.branch-spec-shared-records', () => {
  const m = machine();
  const all = m.cli(m.shop, 'blueprints', 'new', 'ledger', '--commit', 'all', '--folder', 'ledger');
  assert.equal(all.status, 0, all.stdout + all.stderr);
  git(m.shop, 'add', '-A');
  git(m.shop, 'commit', '-q', '-m', 'ledger');
  const wt = join(root, `m${n}-wt`);
  git(m.shop, 'worktree', 'add', '-q', '-b', 'more', wt);
  const id = m.registry().blueprints.find((r) => r.id.endsWith('-ledger')).id;
  const where = json(m.cli(wt, 'where', '--json', '--blueprint', id));
  assert.equal(where.runs.path, join(wt, '.walkdown', 'blueprints', 'ledger', 'runs'), JSON.stringify(where.runs));
});
