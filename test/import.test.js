/*
 * `walkdown blueprints import` — the one way a blueprint that already exists
 * reaches this machine's registry (ADR 0001, ADR 0003, ADR 0014 §8).
 *
 * Import takes what it is pointed at: one blueprint's folder registers that
 * one, and a repository is a list it asks about. The thing under test is as
 * much what it REFUSES as what it takes - nothing arrives by walking a tree,
 * so a project you have not named is invisible, and a repository holding
 * several is a question rather than a default.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const nm = (id) => String(id).replace(/^\d{4}-[a-z0-9]{2,3}-/, '');

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
 * The same command at a terminal, answering the question it asks with
 * `answer` once it has asked it. Python's pty gives the child a real
 * terminal and waits for the prompt before typing, the way a person would.
 */
const PTY = `
import os, pty, sys, time, select
answer, prompt, argv = sys.argv[1], sys.argv[2].encode(), sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
out, sent, deadline = b"", False, time.time() + 20
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.1)
    if r:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    if not sent and prompt in out:
        os.write(fd, (answer + "\\n").encode())
        sent = True
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.decode("utf8", "replace"))
sys.exit(os.waitstatus_to_exitcode(status))
`;
const atTerminal = (home, args, cwd, answer, prompt = 'Import which?') =>
  spawnSync('python3', ['-c', PTY, answer, prompt, process.execPath, CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, WALKDOWN_HOME: home, NO_COLOR: '1' },
  });

/** A repository with committed homes, as `blueprints new --commit spec` leaves them. */
function project(root, blueprints) {
  mkdirSync(join(root, '.git'), { recursive: true });
  blueprints.forEach((b, i) => {
    const home = join(root, '.walkdown', 'blueprints', b.folder ?? `000${i + 1}-${b.id}`);
    mkdirSync(join(home, 'features'), { recursive: true });
    writeFileSync(
      join(home, 'spec.yml'),
      `blueprint: ${b.id}\ndescription: ${b.description}\nrunner:\n  targets:\n    local: { base_url: ${b.origin} }\n`,
    );
    writeFileSync(
      join(home, 'storyboard.yml'),
      `screens:\n${b.paths.map((p, n) => `  - id: s${n}\n    title: Screen ${n}\n    app: { path: ${p} }\n`).join('')}`,
    );
    writeFileSync(
      join(home, 'features', 'a.yml'),
      'feature: a\nstories:\n  - id: a.s\n    rules:\n      - id: a.s.one\n        statement: One.\n        verify: [checks]\n',
    );
  });
  return root;
}

function scratch() {
  /*
   * Real, because the registry writes canonical paths and macOS hands out
   * /var/... for a directory the process knows as /private/var/... - a server
   * pointed at the uncanonical spelling then finds nothing declaring it.
   */
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-import-')));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: importer\n');
  return { root, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const registry = (home) =>
  existsSync(join(home, 'registry.yml'))
    ? (parse(readFileSync(join(home, 'registry.yml'), 'utf8'))?.blueprints ?? [])
    : [];

/** Every file under a folder, with its bytes, so "untouched" can be asserted. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p)] = `${statSync(p).mtimeMs}:${readFileSync(p, 'utf8')}`;
    }
  };
  walk(dir);
  return out;
}

test('a project nobody imported is invisible, and importing it makes it reachable', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      {
        id: 'checkout',
        description: 'Cart and payment.',
        origin: 'https://shop.test',
        paths: ['/cart'],
      },
    ]);
    // Standing somewhere else entirely: the clone exists on disk and walkdown
    // does not know it.
    const before = walkdown(s.home, ['blueprints'], s.root);
    assert.doesNotMatch(before.stdout, /checkout/);

    walkdown(s.home, ['blueprints', 'import', shop, '--all'], s.root);
    const after = walkdown(s.home, ['blueprints'], s.root);
    assert.match(after.stdout, /checkout/);

    // Written to the registry (ADR 0003), never to the profile: the row says
    // which project it is in, which checkout, and how it arrived.
    const row = registry(s.home).find((p) => nm(p.id) === 'checkout');
    assert.ok(row, 'registered');
    assert.match(row.id, /^0001-[a-z0-9]{2,3}-checkout$/, 'an ID from the registry counter');
    assert.equal(row.project, 'acme-shop', 'a project is a label');
    assert.ok(row.checkout?.endsWith('acme-shop'), 'and says which checkout');
    assert.equal(row.registered?.by, 'import', 'and how');
    assert.doesNotMatch(readFileSync(join(s.home, 'profile.yml'), 'utf8'), /checkout/);
  } finally {
    s.cleanup();
  }
});

test('import writes the claims index, so routing never loads a spec @rule:screens.ownership.routes-by-page', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      { id: 'checkout', description: 'Cart.', origin: 'https://shop.test', paths: ['/cart', '/'] },
    ]);
    walkdown(s.home, ['blueprints', 'import', shop, '--all'], s.root);

    // Under cache/: derived from the registry, rebuilt on demand (ADR 0003 §7).
    const index = JSON.parse(readFileSync(join(s.home, 'cache', 'claims.json'), 'utf8'));
    const bp = index.blueprints.find((b) => nm(b.id) === 'checkout');
    assert.ok(bp, 'the blueprint is in the index');
    assert.deepEqual(
      bp.claims.map((c) => c.path).sort(),
      ['/', '/cart'],
      'with every address it covers',
    );
    assert.ok(index.built, 'stamped, because it is a cache and staleness is the question');
  } finally {
    s.cleanup();
  }
});

test('a home by its path registers that one; a repository is a list it asks about @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      {
        id: 'checkout',
        folder: '0001-checkout',
        description: 'Cart.',
        origin: 'https://shop.test',
        paths: ['/cart'],
      },
      {
        id: 'admin',
        folder: 'back/202610-admin',
        description: 'Back office.',
        origin: 'https://shop.test',
        paths: ['/admin'],
      },
      {
        id: 'search',
        folder: '0003-search',
        description: 'Finding things.',
        origin: 'https://shop.test',
        paths: ['/search'],
      },
    ]);
    const homeOf = (f) => join(shop, '.walkdown', 'blueprints', f);

    // One home's path: that blueprint alone, with its ID and its project.
    const one = walkdown(s.home, ['blueprints', 'import', homeOf('0001-checkout')], s.root);
    assert.match(one.stdout, /\+ listed .*0001-checkout .*as `0001-[a-z0-9]+-checkout`/);
    assert.match(one.stdout, /in project `acme-shop`/);
    assert.deepEqual(
      registry(s.home).map((r) => nm(r.id)),
      ['checkout'],
    );
    const listedRow = JSON.stringify(registry(s.home)[0]);

    // The repository with no terminal: the list, every folder, the listed
    // one marked, and nothing registered until it is told which.
    const asked = walkdown(s.home, ['blueprints', 'import', shop], s.root, false);
    assert.equal(asked.status, 2);
    const said = asked.stdout + asked.stderr;
    assert.match(said, /0001-checkout.*already listed/);
    assert.match(said, /back\/202610-admin/, 'a folder at any depth, by its folder');
    assert.match(said, /0003-search/);
    assert.match(asked.stderr, /--all, or --only <folders>\. Nothing was imported\./);
    assert.equal(registry(s.home).length, 1, 'nothing registered unasked');

    // At a terminal, the person picks by number.
    const picked = atTerminal(s.home, ['blueprints', 'import', shop], s.root, '2');
    assert.equal(picked.status, 0, picked.stdout);
    assert.match(picked.stdout, /Import which\?/);
    assert.deepEqual(
      registry(s.home)
        .map((r) => nm(r.id))
        .sort(),
      ['checkout', 'search'],
    );

    // And --only names a folder.
    walkdown(s.home, ['blueprints', 'import', shop, '--only', 'back/202610-admin'], s.root);
    assert.deepEqual(
      registry(s.home)
        .map((r) => nm(r.id))
        .sort(),
      ['admin', 'checkout', 'search'],
    );

    // A home already listed is said, and its row is unchanged.
    const again = walkdown(s.home, ['blueprints', 'import', homeOf('0001-checkout')], s.root);
    assert.match(again.stdout, /already listed/);
    assert.equal(JSON.stringify(registry(s.home).find((r) => nm(r.id) === 'checkout')), listedRow);

    // One project, one code, for every blueprint in the checkout.
    assert.equal(new Set(registry(s.home).map((r) => r.code)).size, 1);
  } finally {
    s.cleanup();
  }
});

test('a path holding no home says so and registers nothing @rule:commands.blueprints.import-takes-what-it-is-pointed-at', () => {
  const s = scratch();
  try {
    const bare = join(s.root, 'not-a-project');
    mkdirSync(join(bare, '.git'), { recursive: true });
    const r = walkdown(s.home, ['blueprints', 'import', bare], s.root, false);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /is a blueprint/);
    assert.match(r.stderr, /walkdown blueprints new/);
    assert.equal(registry(s.home).length, 0);
  } finally {
    s.cleanup();
  }
});

test('two projects sharing a name are told apart by their labels', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'one', 'acme'), [
      { id: 'checkout', description: 'Cart.', origin: 'https://shop.test', paths: ['/cart'] },
    ]);
    const other = project(join(s.root, 'two', 'acme'), [
      {
        id: 'checkout',
        description: 'A different checkout entirely.',
        origin: 'https://acme.test',
        paths: ['/buy'],
      },
    ]);
    walkdown(s.home, ['blueprints', 'import', shop, '--all'], s.root);
    // The second checkout's default label is taken: it is asked for one,
    // never given the first project's.
    const refused = walkdown(s.home, ['blueprints', 'import', other, '--all'], s.root, false);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /label `acme` is another project's/);
    assert.match(refused.stderr, /--project <label>/);
    walkdown(
      s.home,
      ['blueprints', 'import', other, '--all', '--project', 'acme-2', '--code', 'ac2'],
      s.root,
    );
    const rows = registry(s.home);
    assert.deepEqual(rows.map((r) => r.project).sort(), ['acme', 'acme-2']);
    assert.notEqual(rows[0].code, rows[1].code);
    assert.notEqual(rows[0].id, rows[1].id, 'the counter keeps every ID apart');
  } finally {
    s.cleanup();
  }
});

test('the server routes across imported projects, and answers with all of them @rule:screens.ownership.routes-by-page', async () => {
  const s = scratch();
  try {
    /*
     * Two projects, two blueprints, one address between them - the case the
     * one-claimant constraint forbade until ADR 0001. The server must answer
     * with both and pick neither; picking is the person's, at the panel.
     */
    const shop = project(join(s.root, 'acme-shop'), [
      { id: 'checkout', description: 'Cart.', origin: 'https://shop.test', paths: ['/', '/cart'] },
    ]);
    const marketing = project(join(s.root, 'acme-marketing'), [
      { id: 'campaigns', description: 'Landing pages.', origin: 'https://shop.test', paths: ['/'] },
    ]);
    walkdown(s.home, ['blueprints', 'import', shop, '--all'], s.root);
    walkdown(s.home, ['blueprints', 'import', marketing, '--all'], s.root);

    process.env.WALKDOWN_HOME = s.home;
    const { createWalkdownServer } = await import('../lib/serve.js');
    const server = createWalkdownServer(join(shop, '.walkdown', 'blueprints', '0001-checkout'), {
      cwd: s.root,
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const both = await (
        await fetch(`${base}/api/whose?url=${encodeURIComponent('https://shop.test/')}`)
      ).json();
      assert.deepEqual(both.matches.map((m) => nm(m.id)).sort(), ['campaigns', 'checkout']);

      const one = await (
        await fetch(`${base}/api/whose?url=${encodeURIComponent('https://shop.test/cart')}`)
      ).json();
      assert.deepEqual(
        one.matches.map((m) => nm(m.id)),
        ['checkout'],
      );

      const none = await (
        await fetch(`${base}/api/whose?url=${encodeURIComponent('https://nobody.test/')}`)
      ).json();
      assert.deepEqual(none.matches, []);

      // And every blueprint says which project it is in, so the panel can
      // group by project without deriving directories in a browser.
      const payload = await (await fetch(`${base}/api/blueprint`)).json();
      const rows = Object.fromEntries(payload.blueprints.map((p) => [nm(p.id), p.project?.id]));
      assert.deepEqual(rows, { checkout: 'acme-shop', campaigns: 'acme-marketing' });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  } finally {
    s.cleanup();
  }
});

/*
 * A copy of a home standing where no project owns it is what `--ephemeral`
 * is for: registered, marked, belonging to no project, reached by its ID.
 */
test('a copy of a home imports with --ephemeral, marked a copy', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      { id: 'checkout', description: 'Cart.', origin: 'https://shop.test', paths: ['/cart'] },
    ]);
    const copy = join(s.root, 'scratch', '0001-checkout');
    cpSync(join(shop, '.walkdown', 'blueprints', '0001-checkout'), copy, { recursive: true });

    // Without the flag, a home outside any repository's .walkdown is refused.
    const bare = walkdown(s.home, ['blueprints', 'import', copy], s.root, false);
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /--ephemeral/);

    const said = walkdown(
      s.home,
      ['blueprints', 'import', copy, '--ephemeral', '--why', 'a look'],
      s.root,
    );
    assert.match(said.stdout, /listed/);
    const row = registry(s.home).find((p) => p.ephemeral);
    assert.ok(row, JSON.stringify(registry(s.home)));
    assert.equal(row.checkout, null, 'a copy is picked by its ID, never by standing somewhere');
    assert.equal(row.ephemeral.why, 'a look');
    assert.match(row.id, /^\d{4}-tmp-checkout$/);

    const where = walkdown(s.home, ['where', '--blueprint', row.id], s.root).stdout;
    assert.match(where, /scratch\/0001-checkout/);

    const again = walkdown(
      s.home,
      ['blueprints', 'import', copy, '--ephemeral', '--why', 'a look'],
      s.root,
    );
    assert.match(again.stdout, /already listed/);

    // And a project's own home is refused the flag: a copy means a copy.
    const own = walkdown(
      s.home,
      [
        'blueprints',
        'import',
        join(shop, '.walkdown', 'blueprints', '0001-checkout'),
        '--ephemeral',
      ],
      s.root,
      false,
    );
    assert.equal(own.status, 2);
    assert.match(own.stderr, /own blueprint/);
  } finally {
    s.cleanup();
  }
});

test('a project imported twice under two spellings of its path is one row', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      { id: 'checkout', description: 'Cart.', origin: 'https://shop.test', paths: ['/cart'] },
    ]);
    symlinkSync(shop, join(s.root, 'shop-link'));
    walkdown(s.home, ['blueprints', 'import', shop, '--all'], s.root);
    // Through the link: the same directory, canonicalised at add time (ADR
    // 0003 §3), so it is already there rather than registered a second time.
    const again = walkdown(
      s.home,
      ['blueprints', 'import', join(s.root, 'shop-link'), '--all'],
      s.root,
    );
    assert.match(again.stdout, /already listed/);
    const rows = registry(s.home);
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].home.includes('shop-link'), 'the real path, not the spelling typed');
  } finally {
    s.cleanup();
  }
});

test('forgetting a blueprint takes it off the list and touches none of its files @rule:commands.blueprints.forget-keeps-the-files', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      { id: 'checkout', description: 'Cart.', origin: 'https://shop.test', paths: ['/cart'] },
    ]);
    const committed = join(shop, '.walkdown', 'blueprints', '0001-checkout');
    for (const [kind, name, body] of [
      ['runs', '2026-01-01T00-00-00Z-local-01.json', '{"run_id":"a"}'],
      ['threads', 'n-0001.yml', 'id: n-0001\nstatus: open\n'],
    ]) {
      mkdirSync(join(committed, kind), { recursive: true });
      writeFileSync(join(committed, kind, name), body);
    }
    walkdown(s.home, ['blueprints', 'import', shop, '--all'], s.root);
    // A personal one, kept in no repository, in the same project.
    const made = walkdown(s.home, ['blueprints', 'new', 'notes', '--commit', 'none'], shop);
    assert.match(made.stdout, /listed/);
    const personal = registry(s.home).find((r) => nm(r.id) === 'notes');
    const personalDir = personal.home.replace(/^~/, process.env.HOME);
    for (const [kind, name, body] of [
      ['runs', '2026-01-01T00-00-00Z-local-01.json', '{"run_id":"b"}'],
      ['threads', 'n-0002.yml', 'id: n-0002\nstatus: open\n'],
    ]) {
      mkdirSync(join(personalDir, kind), { recursive: true });
      writeFileSync(join(personalDir, kind, name), body);
    }
    const before = { committed: snapshot(committed), personal: snapshot(personalDir) };

    const ids = registry(s.home).map((r) => r.id);
    const first = walkdown(
      s.home,
      ['blueprints', 'forget', ids.find((i) => nm(i) === 'checkout')],
      s.root,
    );
    assert.match(first.stdout, /forgotten/);
    assert.doesNotMatch(first.stdout, /rm -rf/, 'a committed home is still in its repository');
    const second = walkdown(s.home, ['blueprints', 'forget', 'notes'], shop);
    assert.match(second.stdout, /forgotten/);
    assert.match(
      second.stdout,
      /nothing else will mention it; `rm -rf .*notes`/,
      'the personal folder is named, with how to delete it',
    );

    assert.equal(registry(s.home).length, 0, 'neither is listed');
    assert.doesNotMatch(walkdown(s.home, ['blueprints'], s.root).stdout, /checkout|notes/);
    assert.deepEqual(
      snapshot(committed),
      before.committed,
      'every file in the committed home is as it was',
    );
    assert.deepEqual(snapshot(personalDir), before.personal, 'and in the personal one');
  } finally {
    s.cleanup();
  }
});
