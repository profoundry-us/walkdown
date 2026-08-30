import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveLocations } from '../lib/locations.js';
import { specFiles, specHash } from '../lib/hash.js';

/*
 * Every case builds its own tree and points WALKDOWN_HOME at a scratch
 * directory, so nothing here can read - or write - the machine's real config.
 */
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'wd-loc-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;
  return { root, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function blueprint(at, { project = 'demo', dirs = [] } = {}) {
  mkdirSync(join(at, 'features'), { recursive: true });
  writeFileSync(join(at, 'walkdown.yml'), `project: ${project}\n`);
  writeFileSync(join(at, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(join(at, 'features', 'a.yml'), 'feature: a\nstories: []\n');
  for (const d of dirs) mkdirSync(join(at, d), { recursive: true });
  return at;
}

const configure = (home, yaml) => writeFileSync(join(home, 'config.yml'), yaml);

test('with no config, a blueprint in the tree wins and its records stay put', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { dirs: ['runs', 'threads'] });
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.id, 'demo');
    assert.equal(loc.spec.path, join(repo, 'blueprint'));
    assert.equal(loc.runs.path, join(repo, 'blueprint', 'runs'));
    assert.match(loc.runs.why, /already in the blueprint/);
    // Nothing was written to find that out.
    assert.equal(loc.config.exists, false);
  } finally { s.cleanup(); }
});

test('a kind the blueprint does not already hold defaults outside the repository', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { dirs: ['runs'] });   // no threads dir
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.runs.path, join(repo, 'blueprint', 'runs'));
    assert.equal(loc.threads.path, join(s.home, 'projects', 'demo', 'threads'));
    assert.match(loc.threads.why, /outside the repository/);
  } finally { s.cleanup(); }
});

/*
 * The rule that keeps an upgrade from being a data loss: a blanket default is
 * a preference, an existing ledger is a fact, and a preference must never
 * silently point past one.
 */
test('a blanket default never orphans a ledger the blueprint already holds', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { dirs: ['runs'] });
    writeFileSync(join(repo, 'blueprint', 'runs', 'r.json'), '{}');
    configure(s.home, `defaults:\n  runs: ${join(s.home, 'elsewhere', '{id}')}\n`);
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.runs.path, join(repo, 'blueprint', 'runs'));
    assert.match(loc.runs.why, /already in the blueprint \(1 file\)/);
  } finally { s.cleanup(); }
});

test('a project entry outranks the tree, and {id} expands in defaults', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { dirs: ['runs'] });
    const away = join(s.root, 'away', 'blueprint');
    blueprint(away, { project: 'away-spec' });
    configure(s.home, [
      'defaults:',
      `  evidence: ${join(s.home, 'ev', '{id}')}`,
      'projects:',
      '  - id: pinned',
      `    roots: [${repo}]`,
      `    spec: ${away}`,
      '',
    ].join('\n'));
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.id, 'pinned');
    assert.equal(loc.spec.path, away);
    assert.match(loc.spec.why, /this machine's config/);
    // The away spec has no runs dir of its own, so the default applies...
    assert.equal(loc.runs.path, join(s.home, 'projects', 'pinned', 'runs'));
    // ...and {id} is the resolved id, not the blueprint's own name.
    assert.equal(loc.evidence.path, join(s.home, 'ev', 'pinned'));
  } finally { s.cleanup(); }
});

test('--dir beats every configured answer', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    const other = blueprint(join(s.root, 'other'), { project: 'other' });
    configure(s.home, `projects:\n  - id: pinned\n    roots: [${repo}]\n    spec: ${join(repo, 'blueprint')}\n`);
    const loc = resolveLocations({ cwd: repo, dir: other });
    assert.equal(loc.spec.path, other);
    assert.equal(loc.spec.why, 'named on the command line');
  } finally { s.cleanup(); }
});

/*
 * `--dir` scopes the whole answer, not just the spec. The entry matching where
 * you are STANDING describes a different project, and letting it keep applying
 * reported one project's spec beside another's ledger.
 */
test('--dir does not inherit the ledger of whichever project you are standing in', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { project: 'mine', dirs: ['runs'] });
    const other = blueprint(join(s.root, 'other'), { project: 'theirs', dirs: ['runs'] });
    configure(s.home, [
      'projects:',
      '  - id: mine',
      `    roots: [${repo}]`,
      `    runs: ${join(s.home, 'mine-runs')}`,
      '',
    ].join('\n'));

    const standing = resolveLocations({ cwd: repo });
    assert.equal(standing.runs.path, join(s.home, 'mine-runs'), 'the entry applies where it matches');

    const named = resolveLocations({ cwd: repo, dir: other });
    assert.equal(named.id, 'theirs');
    assert.equal(named.spec.path, other);
    assert.equal(named.runs.path, join(other, 'runs'), "and never lends its ledger to another spec");
  } finally { s.cleanup(); }
});

test('a broken config is reported, not thrown past', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    configure(s.home, 'projects: [oops\n');
    const loc = resolveLocations({ cwd: repo });
    assert.ok(loc.config.error, 'the parse failure is carried, not swallowed');
    assert.equal(loc.spec.path, join(repo, 'blueprint'), 'and the tree still answers');
  } finally { s.cleanup(); }
});

/* ---- spec_hash ----------------------------------------------------------- */

test('the spec hash covers the spec and nothing the spec produces', () => {
  const s = scratch();
  try {
    const bp = blueprint(join(s.root, 'bp'), { dirs: ['runs', 'threads'] });
    const before = specHash(bp);
    assert.match(before, /^sha256:[0-9a-f]{12}$/);
    assert.deepEqual(specFiles(bp), ['features/a.yml', 'storyboard.yml', 'walkdown.yml']);

    // A run, a thread and a draft are what the spec PRODUCES.
    writeFileSync(join(bp, 'runs', 'r.json'), '{"run_id":"x"}');
    writeFileSync(join(bp, 'threads', 't.yml'), 'id: t\n');
    assert.equal(specHash(bp), before, 'recording a verdict does not change the spec');

    // Cosmetic churn does not move it; a word does.
    writeFileSync(join(bp, 'features', 'a.yml'), 'feature: a  \r\nstories: []\r\n\n\n');
    assert.equal(specHash(bp), before, 'line endings and trailing space are not the spec');
    writeFileSync(join(bp, 'features', 'a.yml'), 'feature: b\nstories: []\n');
    assert.notEqual(specHash(bp), before, 'a changed word is');
  } finally { s.cleanup(); }
});

test('the same words in a different feature file are a different spec', () => {
  const s = scratch();
  try {
    const a = blueprint(join(s.root, 'a'));
    const b = blueprint(join(s.root, 'b'));
    rmSync(join(b, 'features', 'a.yml'));
    writeFileSync(join(b, 'features', 'z.yml'), 'feature: a\nstories: []\n');
    assert.notEqual(specHash(a), specHash(b));
  } finally { s.cleanup(); }
});
