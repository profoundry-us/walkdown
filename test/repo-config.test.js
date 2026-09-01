/*
 * Two configs, and which one a team uses IS the decision about whether the
 * spec is shared (n-0140).
 *
 * `<repo>/.walkdown/config.yml` is committed: the list of blueprints this
 * project has, the same for everyone who clones it. `~/.walkdown/config.yml`
 * is personal: where things are on THIS disk, and who is sitting here. The
 * personal one wins wherever they speak about the same thing.
 *
 * A team that wants no shared spec simply has no repository config, which is
 * an arrangement they choose rather than one they discover.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { readUserConfig, repoConfigPath, resolveLocations } from '../lib/locations.js';

const prevHome = process.env.WALKDOWN_HOME;
const roots = [];
after(() => {
  if (prevHome === undefined) delete process.env.WALKDOWN_HOME;
  else process.env.WALKDOWN_HOME = prevHome;
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function project({ repoYaml = null, personalYaml = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wd-twocfg-'));
  roots.push(root);
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;

  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'blueprint', 'features'), { recursive: true });
  writeFileSync(join(repo, 'blueprint', 'walkdown.yml'), 'project: shared\n');
  writeFileSync(join(repo, 'blueprint', 'features', 'a.yml'), 'feature: a\nstories: []\n');
  mkdirSync(join(repo, 'deep', 'nested'), { recursive: true });

  if (repoYaml !== null) {
    mkdirSync(join(repo, '.walkdown'), { recursive: true });
    writeFileSync(join(repo, '.walkdown', 'config.yml'), repoYaml);
  }
  if (personalYaml !== null) writeFileSync(join(home, 'config.yml'), personalYaml);
  return { root, home, repo };
}

test('the repository config carries the list, and a clone needs nothing else', () => {
  const { repo } = project({
    repoYaml: 'projects:\n  - id: shared\n    roots: [.]\n    spec: blueprint\n',
  });
  const loc = resolveLocations({ cwd: repo });
  assert.equal(loc.id, 'shared');
  assert.equal(loc.spec.path, join(repo, 'blueprint'));
  // Nobody ran an adopt command; the list arrived with the checkout.
  assert.equal(loc.config.matched, true);
});

/*
 * The path this file is committed at is read on machines whose directory
 * layouts have nothing in common, so a relative value hangs off the
 * REPOSITORY - the same mistake as issue #7 in a third costume.
 */
test('relative paths in the repository config resolve against the repository', () => {
  const { repo } = project({
    repoYaml: 'projects:\n  - id: shared\n    roots: [.]\n    spec: blueprint\n',
  });
  const fromRoot = resolveLocations({ cwd: repo });
  const fromDeep = resolveLocations({ cwd: join(repo, 'deep', 'nested') });
  assert.equal(fromDeep.spec.path, fromRoot.spec.path, 'the same answer from anywhere in it');
  assert.equal(fromDeep.spec.path, join(repo, 'blueprint'));
  assert.equal(fromDeep.codeRoot, repo);
});

test('the personal config wins, and merges into the entry rather than replacing it', () => {
  const { repo, home } = project({
    repoYaml: 'projects:\n  - id: shared\n    roots: [.]\n    spec: blueprint\n',
    personalYaml: `projects:\n  - id: shared\n    evidence: ${join('/tmp', 'my-evidence')}\n`,
  });
  const loc = resolveLocations({ cwd: repo });
  assert.equal(loc.evidence.path, join('/tmp', 'my-evidence'), 'the person overrides');
  assert.equal(
    loc.spec.path,
    join(repo, 'blueprint'),
    'and the repo still supplies what the person did not mention',
  );
  assert.ok(home);
});

test('identity is never taken from the repository config', () => {
  const { repo } = project({
    repoYaml: 'identity:\n  username: committed-person\n  name: Committed Person\nprojects: []\n',
    personalYaml: 'identity:\n  username: me\n',
  });
  const { config } = readUserConfig({ cwd: repo });
  assert.equal(config.identity?.username, 'me');

  // And with no personal identity at all, the committed one still does not leak.
  const bare = project({
    repoYaml: 'identity:\n  username: committed-person\nprojects: []\n',
  });
  assert.equal(readUserConfig({ cwd: bare.repo }).config.identity, undefined);
});

test('with no repository config, only the personal one answers', () => {
  const { repo } = project({ personalYaml: 'projects: []\n' });
  const { repo: found } = readUserConfig({ cwd: repo });
  assert.equal(found, null, 'a team that shares nothing has nothing to find');
});

/*
 * Two guards on the search, both of which failed on the first attempt.
 * $HOME is an ancestor of nearly every checkout, so an unbounded walk finds
 * ~/.walkdown/config.yml and reads the person's own file as though a project
 * had shipped it.
 */
test('the search stops at the repository and never mistakes the personal config for a shared one', () => {
  const { repo, home } = project({});
  // The personal config exists, at the walkdown home, above this repository.
  writeFileSync(join(home, 'config.yml'), 'projects: []\n');
  assert.equal(repoConfigPath(join(repo, 'deep', 'nested')), null);

  // A config ABOVE the repository is out of reach: the walk stops at the top
  // of the checkout it started in.
  const outer = join(repo, '..');
  mkdirSync(join(outer, '.walkdown'), { recursive: true });
  writeFileSync(join(outer, '.walkdown', 'config.yml'), 'projects: []\n');
  assert.equal(repoConfigPath(join(repo, 'deep', 'nested')), null, 'not the parent directory’s');

  // But the repository's own is found from any depth inside it.
  mkdirSync(join(repo, '.walkdown'), { recursive: true });
  writeFileSync(join(repo, '.walkdown', 'config.yml'), 'projects: []\n');
  assert.equal(
    repoConfigPath(join(repo, 'deep', 'nested')),
    join(repo, '.walkdown', 'config.yml'),
  );
});
