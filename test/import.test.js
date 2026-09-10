/*
 * `walkdown import` — the one way another project's blueprints reach this
 * machine (ADR 0001).
 *
 * The thing under test is as much what it REFUSES as what it takes: nothing
 * arrives by walking a tree, so a project you have not named is invisible,
 * and a project declaring several is a question rather than a default.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;

const walkdown = (home, args, cwd, ok = true) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, WALKDOWN_HOME: home, NO_COLOR: '1' },
  });
  if (ok) assert.equal(r.status, 0, r.stderr + r.stdout);
  return r;
};

/** A project as `init` leaves one: a .walkdown declaring homes under it. */
function project(root, blueprints) {
  mkdirSync(join(root, '.walkdown'), { recursive: true });
  const rows = blueprints
    .map(
      (b, i) =>
        `  - id: ${b.id}\n    roots: [.]\n    spec: .walkdown/blueprints/000${i + 1}-${b.id}/blueprint\n`,
    )
    .join('');
  writeFileSync(join(root, '.walkdown', 'config.yml'), `projects:\n${rows}`);
  blueprints.forEach((b, i) => {
    const spec = join(root, '.walkdown', 'blueprints', `000${i + 1}-${b.id}`, 'blueprint');
    mkdirSync(join(spec, 'features'), { recursive: true });
    writeFileSync(
      join(spec, 'walkdown.yml'),
      `project: ${b.id}\ndescription: ${b.description}\nrunner:\n  targets:\n    local: { base_url: ${b.origin} }\n`,
    );
    writeFileSync(
      join(spec, 'storyboard.yml'),
      `screens:\n${b.paths.map((p, n) => `  - id: s${n}\n    title: Screen ${n}\n    app: { path: ${p} }\n`).join('')}`,
    );
    writeFileSync(
      join(spec, 'features', 'a.yml'),
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
  writeFileSync(join(home, 'config.yml'), 'identity:\n  username: importer\n');
  return { root, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a project nobody imported is invisible, and importing it makes it reachable', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      { id: 'checkout', description: 'Cart and payment.', origin: 'https://shop.test', paths: ['/cart'] },
    ]);
    // Standing somewhere else entirely: the clone exists on disk and walkdown
    // does not know it.
    const before = walkdown(s.home, ['blueprints'], s.root);
    assert.doesNotMatch(before.stdout, /checkout/);

    walkdown(s.home, ['import', shop, '--all'], s.root);
    const after = walkdown(s.home, ['blueprints'], s.root);
    assert.match(after.stdout, /checkout/);

    // Written to the personal registry, with no roots: reachable by name and
    // by the server, shadowing nothing where a person stands.
    const cfg = parse(readFileSync(join(s.home, 'config.yml'), 'utf8'));
    const row = cfg.projects.find((p) => p.id === 'checkout');
    assert.ok(row, 'listed');
    assert.equal(row.roots, undefined);
    assert.ok(row.imported?.project?.endsWith('acme-shop'), 'says where it came from');
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
    walkdown(s.home, ['import', shop, '--all'], s.root);

    const index = JSON.parse(readFileSync(join(s.home, 'claims.json'), 'utf8'));
    const bp = index.blueprints.find((b) => b.id === 'checkout');
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

test('a project declaring several asks which, and takes nothing unasked', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      { id: 'checkout', description: 'Cart.', origin: 'https://shop.test', paths: ['/cart'] },
      { id: 'admin', description: 'Back office.', origin: 'https://shop.test', paths: ['/admin'] },
    ]);
    // Not a terminal, and nobody said which: it shows the list and stops
    // rather than helping itself to both.
    const asked = walkdown(s.home, ['import', shop], s.root, false);
    assert.equal(asked.status, 2);
    assert.match(asked.stdout + asked.stderr, /checkout/);
    assert.match(asked.stdout + asked.stderr, /admin/);
    assert.match(asked.stderr, /--all|--only/);
    assert.doesNotMatch(readFileSync(join(s.home, 'config.yml'), 'utf8'), /checkout/);

    walkdown(s.home, ['import', shop, '--only', 'admin'], s.root);
    const cfg = parse(readFileSync(join(s.home, 'config.yml'), 'utf8'));
    assert.deepEqual(cfg.projects.map((p) => p.id), ['admin'], 'only what was asked for');
  } finally {
    s.cleanup();
  }
});

test('importing twice is a no-op, and two projects sharing a name are told apart', () => {
  const s = scratch();
  try {
    const shop = project(join(s.root, 'acme-shop'), [
      { id: 'checkout', description: 'Cart.', origin: 'https://shop.test', paths: ['/cart'] },
    ]);
    const other = project(join(s.root, 'acme-marketing'), [
      { id: 'checkout', description: 'A different checkout entirely.', origin: 'https://acme.test', paths: ['/buy'] },
    ]);
    walkdown(s.home, ['import', shop, '--all'], s.root);
    const again = walkdown(s.home, ['import', shop, '--all'], s.root);
    assert.match(again.stdout, /already imported/);

    walkdown(s.home, ['import', other, '--all'], s.root);
    const cfg = parse(readFileSync(join(s.home, 'config.yml'), 'utf8'));
    // The project's directory disambiguates before a number does: a name that
    // says where it came from beats `checkout-2`, which says nothing.
    assert.deepEqual(cfg.projects.map((p) => p.id).sort(), ['acme-marketing-checkout', 'checkout']);
  } finally {
    s.cleanup();
  }
});

test('a directory declaring nothing is refused, and says how to start one', () => {
  const s = scratch();
  try {
    const bare = join(s.root, 'not-a-project');
    mkdirSync(bare, { recursive: true });
    const r = walkdown(s.home, ['import', bare], s.root, false);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /declares a blueprint/);
    assert.match(r.stderr, /walkdown init/);
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
    walkdown(s.home, ['import', shop, '--all'], s.root);
    walkdown(s.home, ['import', marketing, '--all'], s.root);

    process.env.WALKDOWN_HOME = s.home;
    const { createWalkdownServer } = await import('../lib/serve.js');
    const server = createWalkdownServer(
      join(shop, '.walkdown', 'blueprints', '0001-checkout', 'blueprint'),
      { cwd: s.root },
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const both = await (
        await fetch(`${base}/api/whose?url=${encodeURIComponent('https://shop.test/')}`)
      ).json();
      assert.deepEqual(both.matches.map((m) => m.id).sort(), ['campaigns', 'checkout']);

      const one = await (
        await fetch(`${base}/api/whose?url=${encodeURIComponent('https://shop.test/cart')}`)
      ).json();
      assert.deepEqual(one.matches.map((m) => m.id), ['checkout']);

      const none = await (
        await fetch(`${base}/api/whose?url=${encodeURIComponent('https://nobody.test/')}`)
      ).json();
      assert.deepEqual(none.matches, []);

      // And every blueprint says which project it is in, so the panel can
      // group by project without deriving directories in a browser.
      const payload = await (await fetch(`${base}/api/blueprint`)).json();
      const rows = Object.fromEntries(payload.blueprints.map((p) => [p.id, p.project?.id]));
      assert.deepEqual(rows, { checkout: 'acme-shop', campaigns: 'acme-marketing' });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  } finally {
    s.cleanup();
  }
});
