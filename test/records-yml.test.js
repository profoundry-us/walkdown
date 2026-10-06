/*
 * records.yml says where a blueprint's records usually live (ADR 0014 §6).
 * It is committed, so a team agrees on it once; a machine that keeps one
 * kind elsewhere says so on its own registry row, and nobody's disk decides
 * for anybody else's.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-records-yml-')));
after(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function machine(name) {
  const home = join(root, name);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.yml'), `identity:\n  username: ${name}\n`);
  const env = { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: home };
  return (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
}

test('records.yml says where records usually live, and a registry row may say otherwise @rule:locations.default.records-yml-informs', () => {
  // A committed home whose records.yml sends evidence to ../evidence.
  const first = machine('first');
  const repo = join(root, 'shop');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  assert.equal(first(repo, 'blueprints', 'new', '--commit', 'spec', '--folder', 'shop').status, 0);
  const home = join(repo, '.walkdown', 'blueprints', 'shop');
  const said = readFileSync(join(home, 'records.yml'), 'utf8').replace(/^evidence: .*$/m, 'evidence: ../evidence');
  writeFileSync(join(home, 'records.yml'), said);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'shop');

  // The same repository, checked out on a second machine.
  const second = machine('second');
  const clone = join(root, 'elsewhere', 'shop');
  git(root, 'clone', '-q', repo, clone);
  const imported = second(clone, 'blueprints', 'import', clone, '--all');
  assert.equal(imported.status, 0, imported.stdout + imported.stderr);

  const where = (cli, cwd) => {
    const r = cli(cwd, 'where', '--json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout).evidence;
  };

  // The first files evidence where records.yml says.
  const a = where(first, repo);
  assert.equal(a.path, join(repo, '.walkdown', 'blueprints', 'evidence'));
  assert.match(a.why, /records\.yml/);

  // The second moves its evidence, and files it where its registry row says.
  const kept = join(root, 'second-evidence');
  const moved = second(clone, 'records', 'move', 'evidence', '--to', kept);
  assert.equal(moved.status, 0, moved.stdout + moved.stderr);
  const b = where(second, clone);
  assert.equal(b.path, kept);
  assert.match(b.why, /registry/, '`where` names the row as the reason');
  assert.doesNotMatch(b.why, /records\.yml/);

  // records move never edits records.yml, so the first machine is unchanged.
  assert.equal(readFileSync(join(clone, '.walkdown', 'blueprints', 'shop', 'records.yml'), 'utf8'), said);
  assert.equal(git(clone, 'status', '--porcelain', '--', '.walkdown').trim(), '', 'nothing in the repository changed');
  assert.equal(where(first, repo).path, a.path);
});
