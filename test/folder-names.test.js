/*
 * A home is any folder under .walkdown/blueprints/ holding a spec.yml, at
 * any depth and by any name (ADR 0014 §4), and the ID a machine gives it
 * stays in that machine's registry (§2). The team arranges its repository;
 * walkdown reads no number or date out of a folder name and writes none of
 * its own numbers into anything the team commits.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-folder-names-')));
after(() => rmSync(root, { recursive: true, force: true }));

function files(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === '.git') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}
const folders = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) if (statSync(join(d, n)).isDirectory()) out.push(relative(dir, join(d, n))), walk(join(d, n));
  };
  walk(dir);
  return out.sort();
};

test('any folder holding a spec.yml is a home, whatever it is called @rule:locations.default.folder-names-are-yours @rule:locations.registry.ids-stay-here', () => {
  const wd = join(root, 'home');
  mkdirSync(wd, { recursive: true });
  writeFileSync(join(wd, 'profile.yml'), 'identity:\n  username: sam\n');
  const repo = join(root, 'shop');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const bps = join(repo, '.walkdown', 'blueprints');
  for (const [folder, name] of [
    ['202610-search', 'search'],
    ['0002-search', 'search-old'],
    ['billing/api/invoices', 'invoices'],
    ['202610-search/inner', 'inner'],
  ]) {
    mkdirSync(join(bps, folder), { recursive: true });
    writeFileSync(join(bps, folder, 'spec.yml'), `blueprint: ${name}\n`);
  }
  mkdirSync(join(bps, 'billing/api/invoices', 'features'));
  writeFileSync(
    join(bps, 'billing/api/invoices', 'features', 'x.yml'),
    'feature: x\nstories:\n  - id: x.y\n    rules:\n      - id: x.y.z\n        statement: It bills.\n        because: Money.\n',
  );
  const env = { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: wd };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env });
  const before = folders(bps);

  // The three homes are found and offered, each under its own folder.
  const offered = cli('blueprints', 'import', repo);
  assert.equal(offered.status, 2, 'with no terminal it lists them and asks for --all');
  for (const f of ['202610-search', '0002-search', 'billing/api/invoices']) assert.match(offered.stdout, new RegExp(`\\d\\. ${f}\\b`));
  // The home inside another is refused, and both folders are named.
  assert.match(offered.stderr, /202610-search\/inner is a blueprint inside .*202610-search/);
  assert.doesNotMatch(offered.stdout, /\d\. 202610-search\/inner/);

  const taken = cli('blueprints', 'import', repo, '--all');
  assert.equal(taken.status, 0, taken.stdout + taken.stderr);
  const rows = () => parse(readFileSync(join(wd, 'registry.yml'), 'utf8')).blueprints;
  assert.deepEqual(rows().map((r) => relative(bps, r.home.replace(/^~/, process.env.HOME))).sort(), ['0002-search', '202610-search', 'billing/api/invoices']);
  // No number is read out of a folder name: 0002-search is not ID number 2.
  for (const r of rows()) assert.match(r.id, /^000[1-3]-[a-z0-9]{2,3}-/);

  // `blueprints new` suggests a folder named after the blueprint, and takes any other name.
  const suggested = cli('blueprints', 'new', 'checkout', '--commit', 'spec');
  assert.equal(suggested.status, 0, suggested.stdout + suggested.stderr);
  assert.ok(readdirSync(bps).includes('checkout'), readdirSync(bps).join(', '));
  const named = cli('blueprints', 'new', 'cart', '--commit', 'spec', '--folder', 'teams/cart');
  assert.equal(named.status, 0, named.stdout + named.stderr);
  assert.ok(statSync(join(bps, 'teams', 'cart', 'spec.yml')).isFile());

  // No folder is renumbered or renamed to suit walkdown.
  for (const f of before) assert.ok(folders(bps).includes(f), `${f} is where it was`);

  // A thread and a run in a home, by the name alone inside the project.
  const filed = cli('threads', 'new', '--blueprint', 'invoices', '--rule', 'x.y.z', '--body', 'Seen.', '--as-agent');
  assert.equal(filed.status, 0, filed.stdout + filed.stderr);
  // Nothing walkdown wrote in the repository holds an ID this machine gave.
  const ids = rows().map((r) => r.id);
  for (const [file, text] of Object.entries(files(repo)))
    for (const id of ids) assert.ok(!text.includes(id), `${file} holds ${id}`);
});

test('a home inside a home is refused by its path, as the scan refuses it, and the outer one alone is registered @rule:locations.default.folder-names-are-yours', () => {
  const wd = join(root, 'home-nested');
  mkdirSync(wd, { recursive: true });
  const repo = join(root, 'nested');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const outer = join(repo, '.walkdown', 'blueprints', '202610-search');
  const inner = join(outer, 'inner');
  mkdirSync(inner, { recursive: true });
  writeFileSync(join(outer, 'spec.yml'), 'blueprint: search\n');
  writeFileSync(join(inner, 'spec.yml'), 'blueprint: inner\n');
  const env = { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: wd };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env });
  const rows = () => {
    try {
      return parse(readFileSync(join(wd, 'registry.yml'), 'utf8'))?.blueprints ?? [];
    } catch {
      return [];
    }
  };

  const r = cli('blueprints', 'import', inner);
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /a home inside a home is refused\. Nothing was registered\./);
  assert.deepEqual(rows(), [], 'the registry holds no row');
  // The outer one is a home like any other, as `import <repo> --all` treats it: one row, never two nested.
  const o = cli('blueprints', 'import', outer);
  assert.equal(o.status, 0, `${o.stdout}${o.stderr}`);
  assert.equal(rows().length, 1);
  assert.equal(cli('blueprints', 'import', inner).status, 2, 'still refused once its outer home is registered');
  assert.equal(rows().length, 1);
});
