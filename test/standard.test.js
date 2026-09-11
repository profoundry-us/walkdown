/*
 * The doors the 2026-09-02 judging found still keyed by a name, each driven
 * from the outside: the config merge (n-0160), a server's list (n-0159), the
 * per-file provenance (n-0151), and `move` (n-0153.1). One shape - a fact
 * recomputed at a second site instead of looked up - four places.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWalkdownServer } from '../lib/serve.js';
import { readRegistry, resolveLocations } from '../lib/locations.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;

function scratch() {
  // Real, because the registry writes canonical paths (ADR 0003 §3) and macOS
  // spells a temp directory two ways; a test comparing the other spelling
  // against what the registry wrote would fail on the spelling alone.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-std-')));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;
  process.env.WALKDOWN_SKILLS_DIR = join(root, 'skills');
  writeFileSync(join(home, 'config.yml'), 'identity:\n  username: std-person\n');
  return { root, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function blueprint(at, project = 'demo') {
  mkdirSync(join(at, 'features'), { recursive: true });
  writeFileSync(join(at, 'walkdown.yml'), `blueprint: ${project}\n`);
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
 * TWO CHECKOUTS, ONE NAME, TWO ROWS. Two checkouts called `app` used to
 * become one project through the merge - `thread new` in one filed into the
 * other's ledger (n-0160). The registry keys nothing by name: each checkout
 * is a row with its own project, standing in one reaches that one, and the
 * second `app` takes the next free id on this machine (ADR 0003).
 */
test('two checkouts sharing a name are two rows, and each answers for itself @rule:locations.default.one-home-per-blueprint', () => {
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
    assert.match(locTwo.id, /^app/, 'both are called app, and the registry tells them apart');
    assert.notEqual(locOne.id, locTwo.id);
    assert.notEqual(locOne.spec.path, locTwo.spec.path);
    assert.ok(locTwo.spec.path.startsWith(join(two, '.walkdown') + '/'), 'two answers with its own');
    assert.equal(readRegistry().rows.filter((r) => r.project === one || r.project === two).length, 2);

    // The write door: a note filed standing in `two` lands in `two`.
    const filed = walkdown(s.home, ['thread', 'new', '--rule', 'a.s.one', '--body', 'here', '--as-agent'], two, false);
    // (`thread new` may refuse for reasons of its own on an empty scaffold;
    // what matters is that nothing landed in `one`.)
    assert.equal(existsSync(join(locOne.threads.path)), false, `one's ledger untouched: ${filed.stdout}`);
  } finally {
    s.cleanup();
  }
});

test('an ephemeral copy taking a registered id is a different row, not an override @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    const copy = blueprint(join(s.root, 'elsewhere', 'blueprint'), 'copy');
    // An ephemeral copy that asks for the same id, and gets the next one.
    const said = walkdown(s.home, ['import', copy, '--id', 'repo', '--ephemeral', '--why', 'a sitting'], s.root).stdout;
    assert.match(said, /as `repo-2`/);

    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.spec.path, join(repo, '.walkdown', 'blueprints', '0001-repo', 'blueprint'));
    assert.equal(loc.config.registry.matched, true);
    assert.equal(resolveLocations({ cwd: repo, blueprint: 'repo-2' }).spec.path, copy);
  } finally {
    s.cleanup();
  }
});

/*
 * CONFIG.YML REGISTERS NOTHING (ADR 0003 §4). A `blueprints:` row there -
 * the override shape `walkdown move` used to write, or a hand-written entry
 * from before the registry - is set aside and named, never merged: the
 * registry row is the only row, and a moved kind is a key on it.
 */
test('a blueprints row in config.yml is set aside and named; the registry row carries the override', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    writeFileSync(
      join(s.home, 'config.yml'),
      `identity:\n  username: std-person\nblueprints:\n  - id: repo\n    evidence: ${join(s.root, 'ev')}\n`,
    );
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.evidence.path, join(repo, '.walkdown', 'blueprints', '0001-repo', 'evidence'), 'the row is not read');
    assert.ok(loc.config.ignored.some((ig) => ig.key === 'blueprints' && /registers nothing/.test(ig.why)));
    const said = walkdown(s.home, ['where'], repo).stdout;
    assert.match(said, /registers nothing/);

    // The same decision made through the door that exists lands on the row.
    walkdown(s.home, ['move', 'evidence', '--to', join(s.root, 'ev')], repo);
    assert.equal(resolveLocations({ cwd: repo }).evidence.path, join(s.root, 'ev'));
    const row = readRegistry().rows.find((r) => r.project === repo);
    assert.equal(row.evidence, join(s.root, 'ev'));
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
    const alpha = join(mono, 'packs', 'alpha');
    blueprint(join(alpha, 'blueprint2'), 'alpha-two');
    // Registered: mono's own blueprint, and alpha's. Nothing registers the
    // second blueprint in alpha, and nothing reaches it by standing above it.
    walkdown(s.home, ['init'], mono);
    walkdown(s.home, ['init'], alpha);

    const server = createWalkdownServer(join(alpha, 'blueprint2'), { cwd: mono });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      /*
       * The served spec is one nothing registered: a misconfiguration, said
       * outright on the request rather than by the server dying on it.
       */
      const dflt = await fetch(`${base}/api/blueprint`);
      assert.equal(dflt.status, 409);
      assert.match((await dflt.json()).error, /nothing registered/);
      /*
       * And the LIST is the registry's (ADR 0003): what this machine knows
       * about, whatever directory the server was started in - and nothing
       * else, so an unregistered blueprint is never listed, served or
       * written to.
       */
      const home = await (await fetch(`${base}/api/blueprint?bp=mono`)).json();
      assert.deepEqual(home.blueprints.map((p) => p.id).sort(), ['alpha', 'mono']);
      assert.equal((await fetch(`${base}/api/blueprint?bp=reach`)).status, 404, 'an unregistered id is not on offer');
      assert.equal((await fetch(`${base}/api/blueprint?bp=alpha-two`)).status, 404, 'the unregistered blueprint is not on offer');
      assert.equal((await fetch(`${base}/api/blueprint?bp=mono`)).status, 200);
      const write = await fetch(`${base}/api/threads?bp=alpha-two`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'note', body: 'x', author: 'tester' }),
      });
      assert.equal(write.status, 404, 'and cannot be written to');
      assert.equal(existsSync(join(alpha, 'blueprint2', 'threads')), false);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  } finally {
    s.cleanup();
  }
});

/*
 * THE FOLDER IT SAYS IT IS SERVING IS THE ONE THE LIST CAME FROM.
 *
 * `root` is the sentence above the blueprint list - "Serving X, every
 * blueprint under it is listed below" - and it was taken from the served
 * spec's parent while the list was taken from the cwd's `.walkdown`. Those
 * only agree while the spec sits beside the project. In a numbered home they
 * do not, and the panel named a directory holding one of the blueprints it
 * was listing (n-0263).
 */
test('the folder a server says it serves is the place its list came from @rule:panel.start.open-a-folder', async () => {
  const s = scratch();
  try {
    const proj = join(s.root, 'proj');
    mkdirSync(join(proj, '.git'), { recursive: true });
    // The spec in a numbered home, which is where `init` puts it, and a
    // second blueprint elsewhere in the project so the list has two.
    const home = join(proj, '.walkdown', 'blueprints', '0001-proj');
    blueprint(join(home, 'blueprint'), 'proj');
    blueprint(join(proj, 'other', 'blueprint'), 'other');
    walkdown(s.home, ['import', home], s.root);
    walkdown(s.home, ['import', join(proj, 'other'), '--ephemeral', '--why', 'a second on the list'], s.root);

    const server = createWalkdownServer(join(home, 'blueprint'), { cwd: proj });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const payload = await (await fetch(`${base}/api/blueprint`)).json();
      assert.deepEqual(payload.blueprints.map((p) => p.id).sort(), ['other', 'proj']);
      assert.equal(payload.root, proj, 'the project, not the numbered home the spec sits in');
      assert.ok(
        !payload.root.includes('0001-proj'),
        'a directory holding one of two listed blueprints cannot be what holds them',
      );
    } finally {
      server.closeAllConnections();
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
    const before = readFileSync(join(s.home, 'registry.yml'), 'utf8');

    const r = walkdown(s.home, ['move', 'drafts', '--to', join(stranger, 'dr')], stranger, false);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /Nothing registered contains this directory/);
    assert.equal(readFileSync(join(s.home, 'registry.yml'), 'utf8'), before, 'the listed project is untouched');
    assert.equal(existsSync(join(stranger, 'dr')), false);

    // And from inside the listed one, it moves the listed one's.
    const ok = walkdown(s.home, ['move', 'drafts', '--to', join(s.root, 'dr')], listed);
    assert.match(ok.stdout, /moved drafts/);
    assert.equal(resolveLocations({ cwd: listed }).drafts.path, join(s.root, 'dr'));
  } finally {
    s.cleanup();
  }
});
