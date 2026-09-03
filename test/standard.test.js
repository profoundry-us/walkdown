/*
 * The doors the 2026-09-02 judging found still keyed by a name, each driven
 * from the outside: the config merge (n-0160), a server's list (n-0159), the
 * per-file provenance (n-0151), and `move` (n-0153.1). One shape - a fact
 * recomputed at a second site instead of looked up - four places.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from '../vendor/yaml.js';
import { createWalkdownServer } from '../lib/serve.js';
import { declaringFiles, readUserConfig, resolveLocations } from '../lib/locations.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'wd-std-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;
  process.env.WALKDOWN_SKILLS_DIR = join(root, 'skills');
  writeFileSync(join(home, 'config.yml'), 'identity:\n  username: std-person\n');
  return { root, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function blueprint(at, project = 'demo') {
  mkdirSync(join(at, 'features'), { recursive: true });
  writeFileSync(join(at, 'walkdown.yml'), `project: ${project}\n`);
  writeFileSync(join(at, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(
    join(at, 'features', 'a.yml'),
    'feature: a\nstories:\n  - id: a.s\n    rules:\n      - id: a.s.one\n        statement: One.\n        verify: [checks]\n',
  );
  return at;
}

const walkdown = (home, args, cwd, ok = true) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, WALKDOWN_HOME: home, NO_COLOR: '1' },
  });
  if (ok) assert.equal(r.status, 0, r.stderr + r.stdout);
  return r;
};

/*
 * THE MERGE IS SCOPED, NOT NAMED. A personal entry overrides a repository's
 * only when it is about that checkout: same id, and a root inside it, or no
 * blueprint of its own at all. Two checkouts called `app`, one listed
 * personally, used to become one project - `thread new` in one filed into the
 * other's ledger (n-0160).
 */
test('a personal entry rooted in another checkout never merges into this repository’s @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const one = join(s.root, 'one', 'app');
    const two = join(s.root, 'two', 'app');
    for (const r of [one, two]) mkdirSync(join(r, '.git'), { recursive: true });
    // `one` is a personal project (the default); `two` commits its spec.
    walkdown(s.home, ['init'], one);
    walkdown(s.home, ['init', '--commit', 'spec'], two);

    const locOne = resolveLocations({ cwd: one });
    const locTwo = resolveLocations({ cwd: two });
    assert.equal(locOne.id, 'app');
    assert.equal(locTwo.id, 'app', 'both are called app, and that is allowed');
    assert.notEqual(locOne.spec.path, locTwo.spec.path);
    assert.ok(locTwo.spec.path.startsWith(join(two, '.walkdown') + '/'), 'two answers with its own');
    assert.equal(declaringFiles(locTwo.project), 'repo', 'and the personal `app` is not merged into it');
    assert.deepEqual(readUserConfig({ cwd: two }).shadowed, ['app'], 'it is reported as shadowed here');

    // The write door: a note filed standing in `two` lands in `two`.
    const filed = walkdown(s.home, ['thread', 'new', '--rule', 'a.s.one', '--body', 'here', '--as-agent'], two, false);
    // (`thread new` may refuse for reasons of its own on an empty scaffold;
    // what matters is that nothing landed in `one`.)
    assert.equal(existsSync(join(locOne.threads.path)), false, `one's ledger untouched: ${filed.stdout}`);
  } finally {
    s.cleanup();
  }
});

test('a rootless personal entry with a spec of its own is a different project, not an override @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    const copy = blueprint(join(s.root, 'elsewhere', 'blueprint'), 'copy');
    // An ephemeral copy that happens to take the same id.
    walkdown(s.home, ['project', 'add', copy, '--id', 'repo', '--ephemeral', '--why', 'a sitting'], s.root);

    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.spec.path, join(repo, '.walkdown', 'blueprints', '0001-repo', 'blueprint'));
    assert.equal(declaringFiles(loc.project), 'repo');
  } finally {
    s.cleanup();
  }
});

test('a personal entry with no blueprint of its own is the override it always was', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    writeFileSync(
      join(s.home, 'config.yml'),
      `identity:\n  username: std-person\nprojects:\n  - id: repo\n    evidence: ${join(s.root, 'ev')}\n`,
    );
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.evidence.path, join(s.root, 'ev'));
    assert.equal(declaringFiles(loc.project), 'both');
  } finally {
    s.cleanup();
  }
});

/*
 * WHICH FILE DECLARED IT is a fact of its own. Computed from the per-key
 * marks, a personal entry restating every key the repository declared left
 * no key marked 'repo', and the report denied the committed file had an entry
 * it was the only reason for (n-0151).
 */
test('restating every key personally does not erase the repository’s declaration @rule:locations.answer.declared-not-discovered', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    const committed = parse(readFileSync(join(repo, '.walkdown', 'config.yml'), 'utf8')).projects[0];
    const restated = Object.fromEntries(
      Object.entries(committed).map(([k, v]) => [
        k,
        k === 'roots' ? [repo] : k === 'home' || k === 'id' ? v : join(repo, v),
      ]),
    );
    writeFileSync(
      join(s.home, 'config.yml'),
      'identity:\n  username: std-person\nprojects:\n  - ' +
        Object.entries(restated)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
          .join('\n    ') +
        '\n',
    );
    const loc = resolveLocations({ cwd: repo });
    assert.equal(declaringFiles(loc.project), 'both');
    assert.equal(loc.config.repo.matched, true, 'the committed file still names it');
    const said = walkdown(s.home, ['where'], repo).stdout;
    assert.match(said, /names this project too/);
  } finally {
    s.cleanup();
  }
});

/*
 * A SERVER'S LIST IS THE CWD'S. Computed from the served blueprint's parent,
 * a server started at a repository's root over a spec declared inside a pack
 * offered the pack's whole list, served it, wrote to it, and refused the
 * root's own project (n-0159).
 */
test('a server offers what the .walkdown where it was started declares, wherever the served spec sits @rule:locations.answer.one-walkdown-answers', async () => {
  const s = scratch();
  try {
    const mono = join(s.root, 'mono');
    mkdirSync(join(mono, '.git'), { recursive: true });
    blueprint(join(mono, 'blueprint'), 'root-proj');
    const alpha = join(mono, 'packs', 'alpha');
    blueprint(join(alpha, 'blueprint'), 'alpha');
    blueprint(join(alpha, 'blueprint2'), 'alpha-two');
    mkdirSync(join(mono, '.walkdown'), { recursive: true });
    writeFileSync(
      join(mono, '.walkdown', 'config.yml'),
      'projects:\n  - id: root-proj\n    roots: [.]\n    spec: blueprint\n  - id: reach\n    roots: [packs/alpha]\n    spec: packs/alpha/blueprint\n',
    );
    mkdirSync(join(alpha, '.walkdown'), { recursive: true });
    writeFileSync(
      join(alpha, '.walkdown', 'config.yml'),
      'projects:\n  - id: alpha\n    roots: [.]\n    spec: blueprint\n  - id: alpha-two\n    roots: [.]\n    spec: blueprint2\n',
    );

    const server = createWalkdownServer(join(alpha, 'blueprint'), { cwd: mono });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const home = await (await fetch(`${base}/api/blueprint`)).json();
      /*
       * `reach` is a hand-written committed entry naming a spec the pack's
       * own `.walkdown` answers for. Lint reports it; and since q-0176 it
       * is not read either, so the server never lists, serves or writes to
       * it while it stands - the report and the behaviour agree.
       */
      assert.deepEqual(home.projects.map((p) => p.id).sort(), ['root-proj']);
      assert.equal((await fetch(`${base}/api/blueprint?bp=reach`)).status, 404, 'a refused entry is not on offer');
      assert.equal((await fetch(`${base}/api/blueprint?bp=alpha-two`)).status, 404, 'the pack\'s own is not on offer');
      assert.equal((await fetch(`${base}/api/blueprint?bp=root-proj`)).status, 200);
      const write = await fetch(`${base}/api/threads?bp=alpha-two`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'note', body: 'x', author: 'tester' }),
      });
      assert.equal(write.status, 404, 'and cannot be written to');
      assert.equal(existsSync(join(alpha, 'blueprint2', 'threads')), false);
    } finally {
      server.close();
    }
  } finally {
    s.cleanup();
  }
});

/*
 * `move` WRITES TO THE ENTRY THAT RESOLVED. Standing in a directory nothing
 * declares, it used to find an entry by the directory's name and rewrite an
 * unrelated project's key (n-0153.1, n-0160).
 */
test('move refuses a directory nothing declares, and touches nobody else’s entry @rule:locations.keeping.moving-is-a-decision', () => {
  const s = scratch();
  try {
    const listed = join(s.root, 'one', 'app');
    const stranger = join(s.root, 'two', 'app');
    for (const r of [listed, stranger]) mkdirSync(join(r, '.git'), { recursive: true });
    walkdown(s.home, ['init'], listed);
    const before = readFileSync(join(s.home, 'config.yml'), 'utf8');

    const r = walkdown(s.home, ['move', 'drafts', '--to', join(stranger, 'dr')], stranger, false);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /Nothing declares this directory/);
    assert.equal(readFileSync(join(s.home, 'config.yml'), 'utf8'), before, 'the listed project is untouched');
    assert.equal(existsSync(join(stranger, 'dr')), false);

    // And from inside the listed one, it moves the listed one's.
    const ok = walkdown(s.home, ['move', 'drafts', '--to', join(s.root, 'dr')], listed);
    assert.match(ok.stdout, /moved drafts/);
    assert.equal(resolveLocations({ cwd: listed }).drafts.path, join(s.root, 'dr'));
  } finally {
    s.cleanup();
  }
});
