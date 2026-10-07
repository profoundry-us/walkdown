/*
 * `walkdown upgrade` (ADR 0014 §11). A layout changes once, on purpose,
 * when a person runs the command - never half-moved by whichever command
 * happened to run first. Every folder name and every verdict survives it,
 * and run again it has nothing to do.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-upgrade-')));
after(() => rmSync(root, { recursive: true, force: true }));

/** Every file under `dir`, with its contents, so "nothing changed" is checkable. */
function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (n === '.git') continue;
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const write = (file, text) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};

/** An old home: blueprint/ holding the spec, with threads/ and runs/ beside it. */
function oldHome(home, name, rule) {
  write(
    join(home, 'blueprint', 'walkdown.yml'),
    `blueprint: ${name}\nrunner:\n  targets:\n    local: { base_url: http://localhost:3000 }\n`,
  );
  write(join(home, 'blueprint', 'storyboard.yml'), 'screens: []\n');
  write(
    join(home, 'blueprint', 'features', 'f.yml'),
    `feature: f\nstories:\n  - id: ${name}.s\n    rules:\n      - id: ${rule}\n        statement: It works.\n        because: It should.\n        verify: [checks]\n`,
  );
  write(
    join(home, 'threads', 'n-0001.yml'),
    `id: n-0001\nkind: note\nauthor: sam\ncreated: 2026-09-01T00:00:00Z\nanchor: { rule: ${rule} }\nstatus: open\nbody: Seen.\n`,
  );
  write(
    join(home, 'runs', '2026-09-01T00-00-00Z-local-01.json'),
    JSON.stringify({
      run_id: '2026-09-01T00-00-00Z-local-01',
      created: '2026-09-01T00:00:00Z',
      actor: 'sam',
      kind: 'checks',
      target: 'local',
      results: [{ rule, status: 'pass' }],
    }),
  );
}

test('upgrade moves the old layout once, keeping every folder name and verdict @rule:locations.keeping.upgrade-moves-once', () => {
  const wd = join(root, 'home');
  const repo = join(root, 'shop');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });

  // The machine, as walkdown left it before ADR 0014.
  write(join(wd, 'config.yml'), 'identity:\n  username: sam\n');
  oldHome(join(wd, 'blueprints', '0003-shop'), 'shop', 'shop.s.works');
  // The repository: a manifest, a shared .gitignore, and a committed home.
  write(join(repo, '.walkdown', 'config.yml'), 'blueprints:\n  - id: app\n    home: 0001-app\n');
  write(
    join(repo, '.walkdown', '.gitignore'),
    'blueprints/*/runs/\nblueprints/*/evidence/\nblueprints/*/drafts/\n',
  );
  oldHome(join(repo, '.walkdown', 'blueprints', '0001-app'), 'app', 'app.s.works');
  write(
    join(wd, 'registry.yml'),
    [
      'blueprints:',
      '  - id: shop',
      `    project: ${repo}`,
      `    home: ${join(wd, 'blueprints', '0003-shop')}`,
      "    registered: { by: init, at: '2026-09-01T00:00:00Z' }",
      '  - id: app',
      `    project: ${repo}`,
      `    home: ${join(repo, '.walkdown', 'blueprints', '0001-app')}`,
      "    registered: { by: import, at: '2026-09-01T00:00:00Z' }",
      '',
    ].join('\n'),
  );
  const env = { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: wd };
  const cli = (...args) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env });

  // `status` says an upgrade is due, names the command, and changes nothing.
  const before = { wd: tree(wd), repo: tree(repo) };
  const due = cli('status');
  assert.equal(due.status, 2, due.stdout + due.stderr);
  assert.match(due.stderr, /An upgrade is due/);
  assert.match(due.stderr, /`walkdown upgrade`/);
  assert.deepEqual({ wd: tree(wd), repo: tree(repo) }, before, 'and nothing was');

  const up = cli('upgrade');
  assert.equal(up.status, 0, up.stdout + up.stderr);

  // config.yml becomes profile.yml.
  assert.ok(!existsSync(join(wd, 'config.yml')));
  assert.equal(readFileSync(join(wd, 'profile.yml'), 'utf8'), 'identity:\n  username: sam\n');

  // The personal home moves under its project, keeping its name, and is flattened.
  const personal = join(wd, 'projects', 'shop', 'blueprints', '0003-shop');
  const committed = join(repo, '.walkdown', 'blueprints', '0001-app');
  assert.ok(!existsSync(join(wd, 'blueprints')), 'the old personal folder is gone');
  for (const home of [personal, committed]) {
    assert.ok(!existsSync(join(home, 'blueprint')), `${home} has no blueprint/ folder`);
    assert.match(
      readFileSync(join(home, 'spec.yml'), 'utf8'),
      /^blueprint: /,
      'walkdown.yml became spec.yml',
    );
    assert.ok(
      existsSync(join(home, 'storyboard.yml')) && existsSync(join(home, 'features', 'f.yml')),
    );
    assert.ok(existsSync(join(home, 'records.yml')), 'each home gets a records.yml');
    // Each thread gets a UUID, and its file is renamed to it, keeping its label.
    const [file, ...more] = readdirSync(join(home, 'threads'));
    assert.equal(more.length, 0);
    const t = parse(readFileSync(join(home, 'threads', file), 'utf8'));
    assert.equal(t.id, 'n-0001');
    assert.equal(file, `${t.uuid}.yml`);
  }
  // The committed home gets its own .gitignore; the repository's two files go.
  assert.match(readFileSync(join(committed, '.gitignore'), 'utf8'), /^runs\/$/m);
  assert.ok(!existsSync(join(repo, '.walkdown', 'config.yml')));
  assert.ok(!existsSync(join(repo, '.walkdown', '.gitignore')));

  // Registry rows get IDs and project labels.
  const rows = parse(readFileSync(join(wd, 'registry.yml'), 'utf8')).blueprints;
  for (const r of rows) {
    assert.match(r.id, /^\d{4}-[a-z0-9]{2,3}-(shop|app)$/);
    assert.equal(r.project, 'shop');
    assert.equal(r.checkout, repo.replace(process.env.HOME, '~'));
  }

  // `status` then shows every verdict it showed before: each rule's pass.
  const st = cli('status', '--json');
  assert.equal(st.status, 0, st.stdout + st.stderr);
  const cells = JSON.stringify(JSON.parse(st.stdout));
  for (const rule of ['shop.s.works', 'app.s.works'])
    assert.match(
      cells,
      new RegExp(`"rule":"${rule.replace(/\./g, '\\.')}"[^{}]*?"verdict"`),
      `${rule} is read`,
    );
  assert.equal((cells.match(/"state":"pass"/g) ?? []).length, 2, 'both passes survive');

  // Run again, it reports nothing to do, and moves nothing.
  const after_ = { wd: tree(wd), repo: tree(repo) };
  const again = cli('upgrade');
  assert.equal(again.status, 0);
  assert.match(again.stdout + again.stderr, /[Nn]othing to (do|upgrade)/);
  assert.deepEqual({ wd: tree(wd), repo: tree(repo) }, after_);
});

test('an ID from before the upgrade still reaches its blueprint, from inside its project or out (n-0511) @rule:locations.keeping.upgrade-moves-once', () => {
  const wd = join(root, 'home-formerly');
  const repo = join(root, 'shop_main');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  write(join(wd, 'config.yml'), 'identity:\n  username: sam\n');
  oldHome(join(wd, 'blueprints', '0002-shop-main'), 'shop_main', 'shop.s.works');
  write(
    join(wd, 'registry.yml'),
    `blueprints:\n  - id: shop_main\n    project: ${repo}\n    home: ${join(wd, 'blueprints', '0002-shop-main')}\n    registered: { by: init, at: '2026-09-01T00:00:00Z' }\n`,
  );
  const env = { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: wd };
  const cli = (cwd, ...args) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  assert.equal(cli(repo, 'upgrade').status, 0);
  const [row] = parse(readFileSync(join(wd, 'registry.yml'), 'utf8')).blueprints;
  assert.notEqual(row.id, 'shop_main', 'the underscore does not survive into the new ID');
  assert.equal(row.formerly, 'shop_main');

  for (const cwd of [repo, root]) {
    const where = cli(cwd, 'where', 'spec', '--blueprint', 'shop_main');
    assert.equal(where.status, 0, `${cwd}: ${where.stderr}`);
    assert.equal(
      where.stdout.trim(),
      cli(cwd, 'where', 'spec', '--blueprint', row.id).stdout.trim(),
    );
    assert.equal(cli(cwd, 'status', '--blueprint', 'shop_main').status, 0, cwd);
  }
});
