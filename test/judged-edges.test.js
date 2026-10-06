/*
 * What the agent tier found on its first sitting over ADR 0014 (n-0369 to
 * n-0378): the paths the first round of tests did not drive. Each case here
 * is one finding, tagged with the rule it failed.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-judged-')));
after(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let n = 0;
function machine() {
  const home = join(root, `home-${++n}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: sam\n');
  const env = { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: home };
  const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  const repo = (name) => {
    const dir = join(root, `m${n}`, name);
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    return dir;
  };
  const rows = () => parse(readFileSync(join(home, 'registry.yml'), 'utf8')).blueprints;
  return { home, env, cli, repo, rows };
}
const ok = (r) => {
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r;
};

test('lint warns before a commit that a teammate has taken the folder name, and a refused commit leaves no lock @rule:commands.blueprints.commit-moves-the-home', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'beta', '--folder', '202610-beta'));
  // A teammate's commit of a home in the same folder arrives.
  mkdirSync(join(shop, '.walkdown', 'blueprints', '202610-beta'), { recursive: true });
  writeFileSync(join(shop, '.walkdown', 'blueprints', '202610-beta', 'spec.yml'), 'blueprint: beta\n');
  const id = m.rows()[0].id;

  const linted = m.cli(shop, 'lint', '--blueprint', id);
  assert.match(linted.stdout + linted.stderr, /already committed under the same folder name/);
  assert.match(linted.stdout + linted.stderr, /`walkdown blueprints rename .* --folder <folder>`/);

  const refused = m.cli(shop, 'blueprints', 'commit', 'spec', '--blueprint', id);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /already committed in this repository/);
  assert.ok(!existsSync(join(m.home, 'registry.yml.lock')), 'the refusal let go of the registry');
  ok(m.cli(shop, 'blueprints', 'new', 'gamma'));
});

test('a home moved back out of the repository drops walkdown\'s .gitignore @rule:commands.blueprints.commit-moves-the-home', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'alpha', '--commit', 'spec', '--folder', 'alpha'));
  ok(m.cli(shop, 'blueprints', 'commit', 'none', '--blueprint', 'alpha'));
  const home = m.rows()[0].home.replace(/^~/, process.env.HOME);
  assert.ok(existsSync(join(home, 'spec.yml')));
  assert.ok(!existsSync(join(home, '.gitignore')), 'a commit choice means nothing outside a repository');
});

test('an unimported home standing in a partly imported checkout is named, with the command that imports it @rule:locations.answer.declared-not-discovered', () => {
  const m = machine();
  const repo = m.repo('rp');
  for (const f of ['202610-one', '202610-two', '202610-three']) {
    mkdirSync(join(repo, '.walkdown', 'blueprints', f), { recursive: true });
    writeFileSync(join(repo, '.walkdown', 'blueprints', f, 'spec.yml'), `blueprint: ${f.slice(7)}\n`);
  }
  ok(m.cli(repo, 'blueprints', 'import', repo, '--only', '202610-one,202610-two'));
  const three = join(repo, '.walkdown', 'blueprints', '202610-three');

  const where = m.cli(three, 'where');
  assert.match(where.stdout, /202610-three is a blueprint this machine has not imported — `walkdown blueprints import .*202610-three` registers it/);
  assert.doesNotMatch(where.stdout, /0001-rp-one/, 'and the other two are not answered for it');
  assert.doesNotMatch(where.stdout, /no row for this project/);
  const named = m.cli(repo, 'status', '--blueprint', 'three');
  assert.equal(named.status, 2);
  assert.match(named.stderr, /not imported — `walkdown blueprints import/);
  // Standing in an imported one answers for that one alone.
  assert.match(m.cli(join(repo, '.walkdown', 'blueprints', '202610-one'), 'where').stdout, /0001-rp-one/);
});

test('a draft saved in a home committed whole stays committed @rule:locations.default.in-repo-on-request', async () => {
  const m = machine();
  const repo = m.repo('all');
  ok(m.cli(repo, 'blueprints', 'new', 'all', '--commit', 'all', '--folder', 'all'));
  const home = join(repo, '.walkdown', 'blueprints', 'all');
  const { writeDraft } = await import('../lib/draft.js');
  writeDraft(join(home, 'drafts'), { actor: 'sam', started: '2026-10-01T00:00:00Z', verdicts: {} });
  assert.ok(!existsSync(join(home, 'drafts', '.gitignore')), 'no ignore file of its own overrules the home');
  const linted = m.cli(repo, 'lint');
  assert.doesNotMatch(linted.stdout + linted.stderr, /git disagrees|keeps .*drafts out/);
});

test('the pointer is written once, and taking it out keeps the person\'s own lines @rule:locations.pointer.owns-only-its-block', () => {
  const m = machine();
  const repo = m.repo('pt');
  const claude = join(repo, 'CLAUDE.md');
  writeFileSync(claude, 'Above.\r\n\r\n');
  ok(m.cli(repo, 'blueprints', 'new', 'a', '--commit', 'spec', '--folder', 'a'));
  const placed = readFileSync(claude, 'utf8');
  assert.match(placed, /walkdown:begin/);
  // The person's own words below, ending in blank lines.
  writeFileSync(claude, `${placed}Below.\n\n\n`);
  const withBelow = readFileSync(claude, 'utf8');

  // A person who deletes the block after the first commit meant it.
  writeFileSync(claude, 'Above.\r\n\r\nBelow.\n\n\n');
  ok(m.cli(repo, 'blueprints', 'new', 'b', '--commit', 'spec', '--folder', 'b'));
  assert.equal(readFileSync(claude, 'utf8'), 'Above.\r\n\r\nBelow.\n\n\n', 'a second commit writes no paragraph');

  // Taking it out removes the block and nothing else - not the blank lines below.
  writeFileSync(claude, withBelow);
  ok(m.cli(repo, 'blueprints', 'commit', 'none', '--blueprint', 'a'));
  ok(m.cli(repo, 'blueprints', 'commit', 'none', '--blueprint', 'b'));
  const left = readFileSync(claude, 'utf8');
  assert.doesNotMatch(left, /walkdown:begin/);
  assert.equal(left, withBelow.replace(/<!-- walkdown:begin -->[\s\S]*<!-- walkdown:end -->\r?\n/, ''));
  assert.match(left, /Below\.\n\n\n$/);
});

test('a checkout that moved keeps its IDs when it is imported where it went @rule:locations.registry.ids-stay-here', () => {
  const m = machine();
  const repo = m.repo('hireart_main');
  ok(m.cli(repo, 'blueprints', 'new', 'search', '--commit', 'spec', '--folder', 'search'));
  ok(m.cli(repo, 'blueprints', 'new', 'jot', '--folder', 'jot'));
  const before = m.rows();

  const moved = join(root, `m${n}`, 'hireart_moved');
  renameSync(repo, moved);
  const imported = ok(m.cli(moved, 'blueprints', 'import', moved, '--all'));
  assert.match(imported.stdout, new RegExp(`~ moved .* as \`${before[0].id}\`, still`));
  const after_ = m.rows();
  assert.deepEqual(after_.map((r) => r.id), before.map((r) => r.id), 'every ID kept');
  for (const r of after_) {
    assert.equal(r.checkout.replace(/^~/, process.env.HOME), moved, `${r.id} names the new place`);
    assert.equal(r.project, before[0].project);
  }
  assert.equal(after_[0].home.replace(/^~/, process.env.HOME), join(moved, '.walkdown', 'blueprints', 'search'));
  assert.equal(after_[1].home, before[1].home, 'a personal home stays where it is');
  ok(m.cli(moved, 'status', '--blueprint', 'jot'));
});

test('in a worktree, records.yml\'s answer says the worktree shares the registered home\'s @rule:locations.answer.says-why', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'gamma', '--commit', 'spec', '--folder', 'gamma'));
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'g');
  const wt = join(shop, '.claude', 'worktrees', 'w');
  git(shop, 'worktree', 'add', '-q', '-b', 'w', wt);
  const where = JSON.parse(ok(m.cli(wt, 'where', '--json')).stdout);
  assert.match(where.runs.why, /records\.yml .*git ignores runs, so every worktree shares them/);
  assert.equal(where.runs.path, join(shop, '.walkdown', 'blueprints', 'gamma', 'runs'));
  assert.match(where.threads.why, /records\.yml/);
  assert.doesNotMatch(where.threads.why, /shares them/, 'threads are committed, and follow the branch');
  assert.match(ok(m.cli(shop, 'where')).stdout, /registered by blueprints new/);
});
