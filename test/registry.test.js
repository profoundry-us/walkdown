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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

/*
 * n-0275, turned around. A link created OUTSIDE a pack, pointing at the
 * pack's home, and a row written by hand naming the link: the walk used to
 * follow the link on the read side while the writer refused the same path,
 * so a second board listed, served and wrote to the pack's ledger with
 * nobody having imported anything. There is no walk now, and a row nothing
 * wrote is not a door: the only moment a path is looked at is the add, and
 * the add canonicalises.
 */
test('a hand-written row naming a symlink is set aside, and import through the link registers the real path once @rule:locations.answer.registry-is-the-only-door', async () => {
  const { home, root } = clone();
  const mono = join(root, 'mono');
  const pack = join(mono, 'packs', 'pack');
  mkdirSync(join(mono, '.git'), { recursive: true });
  mkdirSync(pack, { recursive: true });
  assert.equal(walkdown(home, ['init', '--commit', 'spec'], mono).status, 0);
  assert.equal(walkdown(home, ['init', '--commit', 'spec'], pack).status, 0);
  const packHome = join(pack, '.walkdown', 'blueprints', '0001-pack');
  writeFileSync(
    join(packHome, 'blueprint', 'features', 'a.yml'),
    'feature: a\nstories:\n  - id: a.s\n    rules:\n      - id: a.s.one\n        statement: One.\n        verify: [checks]\n',
  );
  const lab = join(root, 'lab');
  mkdirSync(lab, { recursive: true });
  const link = join(lab, 'linkpack');
  symlinkSync(packHome, link, 'dir');

  // The row, by hand: no `registered:`, and the home spelled through the link.
  const registry = join(home, 'registry.yml');
  writeFileSync(registry, readFileSync(registry, 'utf8') + `  - id: viasymlink\n    project: ${lab}\n    home: ${link}\n`);

  // Set aside on read, and named under the file it is in.
  const where = walkdown(home, ['where'], mono).stdout;
  assert.match(where, /ignores `registry: viasymlink`.*written by hand/, where);
  const byName = walkdown(home, ['where', '--blueprint', 'viasymlink'], mono);
  assert.match(byName.stdout + byName.stderr, /no registered blueprint `viasymlink`/);
  assert.equal(JSON.parse(walkdown(home, ['where', '--json'], mono).stdout).config.ignored.map((i) => i.id).join(), 'viasymlink');
  // Nothing goes through it: not a status, not a thread, and the pack's ledger is untouched.
  assert.notEqual(walkdown(home, ['status', '--blueprint', 'viasymlink'], mono).status, 0);
  const filed = walkdown(home, ['thread', 'new', '--blueprint', 'viasymlink', '--rule', 'a.s.one', '--body', 'through the link', '--as-agent'], mono);
  assert.notEqual(filed.status, 0, filed.stdout);
  assert.ok(!existsSync(join(packHome, 'threads', 'n-0001.yml')), 'nothing landed in the pack');
  // And standing in the lab, where the row's project would contain you, it is still nothing.
  assert.equal(resolveLocations({ cwd: lab }).blueprint, null);

  // A server at the root lists what is registered - both rows - and never the link's.
  const { createWalkdownServer } = await import('../lib/serve.js');
  const server = createWalkdownServer(join(mono, '.walkdown', 'blueprints', '0001-mono', 'blueprint'), { cwd: mono });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const payload = await (await fetch(`${base}/api/blueprint`)).json();
    assert.deepEqual(payload.blueprints.map((p) => p.id).sort(), ['mono', 'pack']);
    assert.equal((await fetch(`${base}/api/blueprint?bp=viasymlink`)).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
  }

  // Standing in the pack reaches the pack's row; at the root, the root's.
  assert.equal(resolveLocations({ cwd: pack }).id, 'pack');
  assert.equal(resolveLocations({ cwd: mono }).id, 'mono');

  // Through the link, import is the one add - and it is the pack's home,
  // canonicalised, already listed once.
  const again = walkdown(home, ['import', link], lab);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already listed/);
  const rows = readRegistry().rows.filter((r) => r.registered && r.home);
  assert.equal(rows.filter((r) => realpathSync(r.home) === realpathSync(packHome)).length, 1, JSON.stringify(rows));
  assert.ok(rows.every((r) => !String(r.home).includes('linkpack')), 'no row names the link');
});
