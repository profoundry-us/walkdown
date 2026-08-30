import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveLocations, KINDS } from '../lib/locations.js';
import { formatHash, specFiles, specHash } from '../lib/hash.js';
import { deriveStatus } from '../lib/status.js';
import { readUserConfig } from '../lib/locations.js';

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

/*
 * Runs and threads are the same KIND of thing the spec is - claims the team
 * makes together - so they go where it goes. Evidence and drafts are not, so
 * they never do. That is what makes opting in one decision instead of four.
 */
test('runs and threads follow the spec; evidence and drafts never do @rule:locations.default.records-follow-the-spec', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    const bp = blueprint(join(repo, 'blueprint'));   // no subdirectories at all
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.runs.path, join(bp, 'runs'));
    assert.equal(loc.threads.path, join(bp, 'threads'));
    assert.match(loc.threads.why, /beside the spec/);
    assert.equal(loc.evidence.path, join(s.home, 'projects', 'demo', 'evidence'));
    assert.equal(loc.drafts.path, join(s.home, 'projects', 'demo', 'drafts'));
    assert.match(loc.evidence.why, /outside the repository/);
  } finally { s.cleanup(); }
});

test('a spec kept outside the repository takes its runs and threads with it @rule:locations.default.records-follow-the-spec', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    const away = blueprint(join(s.home, 'projects', 'demo', 'blueprint'));
    configure(s.home, `projects:\n  - id: demo\n    roots: [${repo}]\n    spec: ${away}\n`);
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.spec.path, away);
    assert.equal(loc.runs.path, join(away, 'runs'), 'out with the spec, not back in the repo');
    assert.equal(loc.threads.path, join(away, 'threads'));
  } finally { s.cleanup(); }
});

/*
 * The rule that keeps an upgrade from being a data loss: a blanket default is
 * a preference, an existing ledger is a fact, and a preference must never
 * silently point past one.
 */
test('a blanket default never orphans a ledger the blueprint already holds @rule:locations.keeping.existing-outranks-preference', () => {
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
    // Runs follow the spec wherever the config put it...
    assert.equal(loc.runs.path, join(away, 'runs'));
    // ...and evidence does not, taking the configured default with {id}
    // resolved to the entry's id rather than the blueprint's own name.
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
test('--dir does not inherit the ledger of whichever project you are standing in @rule:locations.answer.nearest-blueprint-wins', () => {
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

/*
 * A repository can hold several blueprints - this one holds walkdown and
 * walkdown-example. An entry rooted at the whole tree must not answer for a
 * sibling inside it, or standing in one project reports another's ledger.
 */
test('the nearest blueprint wins over an entry rooted at the whole tree @rule:locations.answer.nearest-blueprint-wins', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { project: 'outer' });
    const inner = blueprint(join(repo, 'example', 'blueprint'), { project: 'inner', dirs: ['runs'] });
    configure(s.home, [
      'projects:',
      '  - id: outer',
      `    roots: [${repo}]`,
      `    spec: ${join(repo, 'blueprint')}`,
      '',
    ].join('\n'));

    const outside = resolveLocations({ cwd: repo });
    assert.equal(outside.id, 'outer', 'at the root, the entry answers');

    const within = resolveLocations({ cwd: join(repo, 'example') });
    assert.equal(within.id, 'inner');
    assert.equal(within.spec.path, inner);
    assert.equal(within.runs.path, join(inner, 'runs'), 'and never the outer project\'s ledger');
  } finally { s.cleanup(); }
});

test('a more specific entry beats a broader one', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { project: 'outer' });
    const inner = blueprint(join(repo, 'sub', 'blueprint'), { project: 'inner' });
    configure(s.home, [
      'projects:',
      `  - id: outer\n    roots: [${repo}]\n    spec: ${join(repo, 'blueprint')}`,
      `  - id: pinned-inner\n    roots: [${join(repo, 'sub')}]\n    spec: ${inner}`
      + `\n    evidence: ${join(s.home, 'inner-ev')}`,
      '',
    ].join('\n'));
    const loc = resolveLocations({ cwd: join(repo, 'sub') });
    assert.equal(loc.id, 'pinned-inner');
    assert.equal(loc.evidence.path, join(s.home, 'inner-ev'));
  } finally { s.cleanup(); }
});

test('an entry still answers where the tree has no blueprint to offer', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });      // no blueprint anywhere
    const away = blueprint(join(s.home, 'projects', 'away', 'blueprint'), { project: 'away' });
    configure(s.home, `projects:\n  - id: away\n    roots: [${repo}]\n    spec: ${away}\n`);
    const loc = resolveLocations({ cwd: join(repo, 'src') });
    assert.equal(loc.spec.path, away, 'which is what an out-of-tree spec is for');
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

test('the spec hash covers the spec and nothing the spec produces @rule:locations.travel.judged-against-a-spec', () => {
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

test('the same words in a different feature file are a different spec @rule:locations.travel.judged-against-a-spec', () => {
  const s = scratch();
  try {
    const a = blueprint(join(s.root, 'a'));
    const b = blueprint(join(s.root, 'b'));
    rmSync(join(b, 'features', 'a.yml'));
    writeFileSync(join(b, 'features', 'z.yml'), 'feature: a\nstories: []\n');
    assert.notEqual(specHash(a), specHash(b));
  } finally { s.cleanup(); }
});

/* ---- what a project gets by default ------------------------------------- */

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const walkdown = (home, args) =>
  execFileSync(process.execPath, [CLI, ...args], { env: { ...process.env, WALKDOWN_HOME: home } }).toString();

/* Every path in the tree, so a test can say "and nothing else appeared". */
function tree(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix + e.name;
    out.push(rel);
    if (e.isDirectory()) out.push(...tree(join(dir, e.name), rel + '/'));
  }
  return out;
}

/*
 * The promise adopting walkdown makes: try it, and your repository is as you
 * left it. Anything that fails this makes the tool something a person has to
 * ask permission to evaluate.
 */
test('a fresh project gets nothing in its tree but conventions and a pointer @rule:locations.default.nothing-in-the-tree', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'app.js'), '// theirs\n');
    walkdown(s.home, ['init', '--dir', repo]);

    const paths = tree(repo);
    assert.deepEqual(paths.filter((p) => !p.startsWith('.claude/') && !p.startsWith('src/')),
      ['.claude', 'CLAUDE.md', 'src'],
      'the pointer and the skills, and not one directory of walkdown furniture');
    assert.ok(!paths.some((p) => /^(blueprint|runs|threads|drafts)/.test(p)), paths.join(' '));

    // And everything it will write is under the personal home, filed by project.
    const loc = resolveLocations({ cwd: repo });
    for (const kind of ['spec', ...KINDS])
      assert.ok(loc[kind].path.startsWith(s.home + '/'), `${kind} went to ${loc[kind].path}`);
  } finally { s.cleanup(); }
});

test('--in-repo commits the spec and takes its conversations with it @rule:locations.default.in-repo-on-request', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    const said = walkdown(s.home, ['init', '--dir', repo, '--in-repo']);

    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.spec.path, join(repo, 'blueprint'));
    assert.equal(loc.runs.path, join(repo, 'blueprint', 'runs'), 'runs follow it in');
    assert.equal(loc.threads.path, join(repo, 'blueprint', 'threads'));
    for (const kind of ['evidence', 'drafts'])
      assert.ok(loc[kind].path.startsWith(s.home + '/'), `${kind} stayed out`);
    // Said out loud, because a spec filed somewhere the person did not look is
    // the whole failure this sentence exists to prevent.
    assert.match(said, /spec: .*repo\/blueprint/);
    assert.match(said, /In the repository/);
  } finally { s.cleanup(); }
});

/* ---- asking ------------------------------------------------------------- */

test('every path is reported with the decision that chose it @rule:locations.answer.says-why', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { dirs: ['runs'] });
    configure(s.home, `projects:\n  - id: demo\n    roots: [${repo}]\n    evidence: ${join(s.home, 'ev')}\n`);
    const loc = resolveLocations({ cwd: repo });

    for (const kind of ['spec', ...KINDS])
      assert.ok(loc[kind].why?.length > 8, `${kind} gave no reason: ${loc[kind].why}`);
    // And the reasons name WHICH decision, so a person knows what to argue with.
    assert.match(loc.spec.why, /working tree/);
    assert.match(loc.runs.why, /already in the blueprint/);
    assert.match(loc.threads.why, /beside the spec/);
    assert.match(loc.evidence.why, /config/);
    assert.match(loc.drafts.why, /built-in default/);

    const said = walkdown(s.home, ['where', '--dir', join(repo, 'blueprint')]);
    for (const kind of ['spec', ...KINDS]) assert.match(said, new RegExp(`\\b${kind}\\b`), kind);
    assert.match(said, /already in the blueprint/);
  } finally { s.cleanup(); }
});

/*
 * The command a confused person reaches for first must not be able to change
 * what they were confused about.
 */
test('asking where things live creates nothing at all @rule:locations.answer.asking-writes-nothing', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));            // no runs, threads or drafts
    const before = tree(s.root);

    const loc = resolveLocations({ cwd: repo });
    const said = walkdown(s.home, ['where', '--dir', join(repo, 'blueprint')]);
    walkdown(s.home, ['where', 'evidence', '--dir', join(repo, 'blueprint')]);

    assert.match(said, new RegExp(loc.evidence.path), 'it names a directory that is not there');
    assert.ok(!existsSync(loc.evidence.path), 'and did not create it on being asked twice');
    assert.deepEqual(tree(s.root), before, 'the disk is exactly as it was found');
    assert.equal(readUserConfig().exists, false, 'including the personal config');
  } finally { s.cleanup(); }
});

/* ---- provenance --------------------------------------------------------- */

/*
 * git_sha says where to LOOK, never whether a verdict still counts. Currency is
 * answered per cell - the statement, the check that still claims it, a sweep -
 * so a board must not turn grey because unrelated commits happened.
 */
test('a run made at another commit still counts @rule:locations.travel.provenance-not-currency', () => {
  const statement = 'The visitor can do the thing.';
  const bp = {
    config: { runner: { targets: { local: {} } } },
    features: [{
      file: 'features/demo.yml',
      data: { feature: 'demo', stories: [{ id: 'demo.main', rules: [{ id: 'demo.main.thing', statement, verify: ['checks'] }] }] },
    }],
    threads: [],
    runs: [{
      file: 'runs/r-0.json',
      data: {
        created: '2026-01-01T00:00:00Z', kind: 'checks', target: 'local', actor: 'agent',
        run_id: 'r-0', git_sha: 'deadbee', tree_hash: 'sha256:aaaaaaaaaaaa',
        spec_hash: 'sha256:bbbbbbbbbbbb',
        results: [{ rule: 'demo.main.thing', status: 'pass', statement_hash: formatHash(statement) }],
      },
    }],
  };
  const cell = (b) => deriveStatus(b).rows[0].cells.local;
  assert.equal(cell(bp).state, 'pass');

  // Whatever those provenance fields say - a sha nobody can resolve, a hash of
  // a working tree long gone - the cell reads the same.
  const moved = structuredClone(bp);
  moved.runs[0].data.git_sha = 'c0ffee1-dirty';
  moved.runs[0].data.tree_hash = 'sha256:cccccccccccc';
  assert.equal(cell(moved).state, 'pass', 'an unrelated commit is not an expiry');

  const none = structuredClone(bp);
  delete none.runs[0].data.git_sha;
  delete none.runs[0].data.tree_hash;
  assert.equal(cell(none).state, 'pass', 'and their absence is not one either');

  // What DOES expire is the statement the verdict was made against.
  const reworded = structuredClone(bp);
  reworded.features[0].data.stories[0].rules[0].statement = 'The visitor can do something else.';
  assert.equal(cell(reworded).state, 'stale');
});
