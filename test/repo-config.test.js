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
import { execFileSync } from 'node:child_process';
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

/*
 * Two files, two rows, two answers - and each row answers for its own file.
 *
 * n-0144: both rows read one flag, computed over the MERGE, so a repository
 * declaring the project printed "names this project" against a personal
 * config that had never heard of it, and every path in the report was
 * credited to the file that did not supply it. The wording "this machine's
 * config" is docs/08-locations.md's phrase for the personal file; pointing a
 * reader at it for a path the committed config chose sends them to edit a
 * file with nothing to say about it.
 */
test('the report credits the config that actually answered @rule:locations.answer.declared-not-discovered', () => {
  const { repo, home } = project({
    repoYaml:
      'projects:\n  - id: alpha\n    roots: [alpha]\n    spec: alpha/blueprint\n  - id: beta\n    roots: [beta]\n    spec: beta/blueprint\n',
  });
  for (const id of ['alpha', 'beta'])
    mkdirSync(join(repo, id, 'blueprint'), { recursive: true });
  // The personal config exists and names beta and a project elsewhere - but
  // has no entry at all for alpha, which is the case that used to be misread.
  writeFileSync(
    join(home, 'config.yml'),
    `projects:\n  - id: beta\n    roots: [${join(repo, 'beta')}]\n  - id: solo\n    roots: [/nowhere]\n`,
  );

  const alpha = resolveLocations({ cwd: join(repo, 'alpha') });
  assert.equal(alpha.config.matched, true, 'it is a project');
  assert.equal(alpha.config.matchedIn, 'repo', 'declared by the repository, not by this machine');
  assert.equal(alpha.config.repo.matched, true);
  assert.match(alpha.spec.why, /this repository's config/);

  const beta = resolveLocations({ cwd: join(repo, 'beta') });
  assert.equal(beta.config.matchedIn, 'both');
  assert.equal(beta.config.repo.matched, true);

  // A project only this machine knows about leaves the shared row saying so.
  const solo = resolveLocations({ cwd: repo });
  assert.equal(solo.config.repo.matched, false, 'the repo config has no entry rooted here');

  const report = execFileSync(
    process.execPath,
    [new URL('../bin/walkdown.js', import.meta.url).pathname, 'where'],
    { cwd: join(repo, 'alpha'), encoding: 'utf8', env: { ...process.env, WALKDOWN_HOME: home } },
  );
  assert.match(report, /present, no entry for this project/, "the personal file says it did not");
  assert.match(report, /shared — names this project/, 'and the committed one says it did');
  assert.doesNotMatch(report, /this machine's config \(alpha\)/);
});

/*
 * Provenance is per KEY, not per entry, because the merge is per key: a
 * repository declaring `spec:` beside a person overriding `roots:` is the
 * ordinary two-config arrangement, and one flag for the pair could only ever
 * be right about one of the rows.
 */
test('each path row names the file that supplied that key', () => {
  const { repo, home } = project({
    repoYaml: 'projects:\n  - id: shared\n    roots: [.]\n    spec: blueprint\n',
    personalYaml: `projects:\n  - id: shared\n    evidence: ${join('/tmp', 'mine')}\n`,
  });
  const loc = resolveLocations({ cwd: repo });
  assert.match(loc.spec.why, /this repository's config \(shared\)/, 'the repo declared the spec');
  assert.match(loc.evidence.why, /this machine's config \(shared\)/, 'the person moved evidence');
  assert.ok(home);
});

/*
 * The last field that was computed across both files (n-0146).
 *
 * `error: personal.error ?? repo.error` put a REPOSITORY parse failure on the
 * personal file's row, and where.js's error branch outranks the wording that
 * says which file answered - so the reader was told the file that answered was
 * unreadable, and sent to hunt a syntax error that was not there. The same
 * mistake as n-0144, one field over, which is why the fix is the shape rather
 * than the field: every key in that cell now describes the file it names.
 */
test('a parse failure is reported against the file that has it @rule:locations.answer.declared-not-discovered', () => {
  const broken = project({
    repoYaml: 'projects:\n  - id: alpha\n   roots: [alpha]\n',
    personalYaml: 'projects:\n  - id: solo\n    roots: [/nowhere]\n',
  });
  const cfg = readUserConfig({ cwd: broken.repo });
  assert.equal(cfg.error, null, 'the personal file parses, and says so');
  assert.ok(cfg.repo.error, 'the repository file does not, and says so');

  const loc = resolveLocations({ cwd: broken.repo });
  assert.equal(loc.config.error, null);
  assert.ok(loc.config.repo.error);

  const report = execFileSync(
    process.execPath,
    [new URL('../bin/walkdown.js', import.meta.url).pathname, 'where'],
    {
      cwd: broken.repo,
      encoding: 'utf8',
      env: { ...process.env, WALKDOWN_HOME: broken.home, NO_COLOR: '1' },
    },
  );
  // Each file's verdict is the line UNDER its path, so the two are told apart
  // by position rather than by counting - one "unreadable" in the report says
  // nothing about which of the two rows it landed on, which was the bug.
  const lines = report.split('\n');
  const under = (path) => lines[lines.findIndex((l) => l.includes(path)) + 1] ?? '';
  assert.doesNotMatch(under(broken.home), /unreadable/, 'the file that parsed is not blamed');
  assert.match(under(join(broken.repo, '.walkdown')), /unreadable/, 'the one that did not, is');

  // The control, which is the direction that always worked and is exactly why
  // the other one went unnoticed.
  const other = project({
    repoYaml: 'projects: []\n',
    personalYaml: 'projects: [oops\n',
  });
  const flip = readUserConfig({ cwd: other.repo });
  assert.ok(flip.error);
  assert.equal(flip.repo.error, null);
});
