/*
 * THE REGISTRY IS THE ONLY DOOR (ADR 0003).
 *
 * This file replaces repo-config.test.js, which held the two-config merge to
 * its promises: a committed list, a personal one layered over it, and a
 * report crediting whichever file supplied each key. That arrangement is
 * gone. A checkout's `.walkdown/config.yml` is a manifest that `walkdown
 * import` reads once; `~/.walkdown/registry.yml` is what every reader
 * consults; and `~/.walkdown/config.yml` is the person's - identity and
 * defaults - and registers nothing.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { readRegistry, readUserConfig, resolveLocations } from '../lib/locations.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const prevHome = process.env.WALKDOWN_HOME;
const roots = [];
after(() => {
  if (prevHome === undefined) delete process.env.WALKDOWN_HOME;
  else process.env.WALKDOWN_HOME = prevHome;
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/*
 * A checkout as a clone arrives: a manifest naming a numbered home, the home
 * standing where it says, and nothing on this machine that has met it.
 */
function clone({ personalYaml = null, registryYaml = null } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-registry-')));
  roots.push(root);
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;
  if (personalYaml !== null) writeFileSync(join(home, 'config.yml'), personalYaml);
  if (registryYaml !== null) writeFileSync(join(home, 'registry.yml'), registryYaml);

  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const homeDir = join(repo, '.walkdown', 'blueprints', '0001-shared');
  mkdirSync(join(homeDir, 'blueprint', 'features'), { recursive: true });
  for (const k of ['threads', 'runs', 'evidence', 'drafts']) mkdirSync(join(homeDir, k), { recursive: true });
  writeFileSync(join(homeDir, 'blueprint', 'walkdown.yml'), 'blueprint: shared\n');
  writeFileSync(join(homeDir, 'blueprint', 'features', 'a.yml'), 'feature: a\nstories: []\n');
  writeFileSync(join(repo, '.walkdown', 'config.yml'), 'blueprints:\n  - id: shared\n    home: 0001-shared\n');
  mkdirSync(join(repo, 'deep', 'nested'), { recursive: true });
  return { root, home, repo, homeDir };
}

const walkdown = (home, args, cwd) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, WALKDOWN_HOME: home, NO_COLOR: '1' },
  });

test('a manifest registers nothing; import does, and the row answers from any depth @rule:locations.answer.declared-not-discovered', () => {
  const { home, repo, homeDir } = clone();
  const before = resolveLocations({ cwd: repo });
  assert.equal(before.blueprint, null, 'the clone declares it, and this machine has not met it');
  assert.match(before.spec.why, /nothing registered contains this directory/);
  assert.match(before.spec.why, /declares `shared`/, 'the manifest is named');
  assert.match(before.spec.why, /walkdown import/, 'and so is the door');

  const r = walkdown(home, ['import', '.'], repo);
  assert.equal(r.status, 0, r.stderr);
  const row = readRegistry().rows.find((x) => x.id === 'shared');
  assert.equal(row.project, repo);
  assert.equal(row.home, homeDir);
  assert.equal(row.registered.by, 'import');

  const fromRoot = resolveLocations({ cwd: repo });
  const fromDeep = resolveLocations({ cwd: join(repo, 'deep', 'nested') });
  assert.equal(fromRoot.id, 'shared');
  assert.equal(fromDeep.spec.path, join(homeDir, 'blueprint'), 'the same answer from anywhere in it');
  assert.equal(fromDeep.codeRoot, repo);
  assert.equal(fromDeep.config.matchedIn, 'registry');
  assert.match(fromDeep.config.registry.registeredBy, /^import on \d{4}-/);
  assert.match(fromDeep.spec.why, /registry/);
});

test('identity comes from the personal config, never from a manifest', () => {
  const { repo, home } = clone({ personalYaml: 'identity:\n  username: me\n' });
  writeFileSync(
    join(repo, '.walkdown', 'config.yml'),
    'identity:\n  username: committed-person\nblueprints:\n  - id: shared\n    home: 0001-shared\n',
  );
  walkdown(home, ['import', '.'], repo);
  assert.equal(readUserConfig().config.identity?.username, 'me');
  const bare = clone();
  walkdown(bare.home, ['import', '.'], bare.repo);
  assert.equal(readUserConfig().config.identity, undefined, 'and with none said, none is taken');
});

test('a parse failure is reported against the file that has it @rule:locations.answer.declared-not-discovered', () => {
  const broken = clone({
    personalYaml: 'identity:\n  username: me\n',
    registryYaml: 'blueprints:\n  - id: shared\n   home: nope\n',
  });
  const cfg = readUserConfig();
  assert.equal(cfg.error, null, 'the personal file parses, and says so');
  assert.ok(cfg.registry.error, 'the registry does not, and says so');
  const loc = resolveLocations({ cwd: broken.repo });
  assert.equal(loc.config.error, null);
  assert.ok(loc.config.registry.error);

  const report = execFileSync(process.execPath, [CLI, 'where'], {
    cwd: broken.repo,
    encoding: 'utf8',
    env: { ...process.env, WALKDOWN_HOME: broken.home, NO_COLOR: '1' },
  });
  // Each file's verdict is the line UNDER its path, so the two are told
  // apart by position rather than by counting.
  const lines = report.split('\n');
  const under = (path) => lines[lines.findIndex((l) => l.includes(path)) + 1] ?? '';
  assert.doesNotMatch(under(join(broken.home, 'config.yml')), /unreadable/, 'the file that parsed is not blamed');
  assert.match(under(join(broken.home, 'registry.yml')), /unreadable/, 'the one that did not, is');

  // And a registry that does not parse refuses to be written to, rather
  // than being read as empty and appended over.
  const r = walkdown(broken.home, ['import', '.'], broken.repo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not parse/);
});
