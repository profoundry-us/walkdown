import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import test from 'node:test';
import { threadAt } from '../tools/test-home.mjs';
import { parse } from '../vendor/yaml.js';
import { loadBlueprint } from '../lib/blueprint.js';
import { formatHash, specFiles, specHash } from '../lib/hash.js';
import { Refused } from '../lib/refusal.js';
import { canon, expand, KINDS, readRegistry, readUserConfig, register as registerRow, resolveLocations } from '../lib/locations.js';
import { deriveStatus } from '../lib/status.js';

/*
 * Every case builds its own tree and points WALKDOWN_HOME at a scratch
 * directory, so nothing here can read - or write - the machine's real config.
 */
function scratch() {
  // Real, because the registry writes canonical paths (ADR 0003 §3) and macOS
  // spells a temp directory two ways; a test comparing the other spelling
  // against what the registry wrote would fail on the spelling alone.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-loc-')));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.WALKDOWN_HOME = home;
  /*
   * And the SKILLS home, which is a second door to the same room: skills
   * install to the person's own ~/.claude/skills by default, so a test that
   * pinned only WALKDOWN_HOME still wrote five directories into whoever ran
   * it. Observed, not theorised - it happened here on 2026-08-30.
   */
  const skills = join(root, 'skills');
  process.env.WALKDOWN_SKILLS_DIR = skills;
  return { root, home, skills, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function blueprint(at, { name = 'demo', dirs = [] } = {}) {
  mkdirSync(join(at, 'features'), { recursive: true });
  writeFileSync(join(at, 'spec.yml'), `blueprint: ${name}\n`);
  writeFileSync(join(at, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(join(at, 'features', 'a.yml'), 'feature: a\nstories: []\n');
  for (const d of dirs) mkdirSync(join(at, d), { recursive: true });
  return at;
}

/*
 * Register a blueprint the way every reader now finds one: a row in the
 * personal registry (ADR 0003). walkdown stopped walking the tree for a spec
 * long ago (n-0133), and stopped reading lists out of config files with the
 * ADR - a blueprint nobody registered is not a project, wherever it stands.
 *
 * `spec` is the home itself (ADR 0014 §5: spec.yml beside its records); the
 * row carries it. `roots` is the checkout the row belongs to, or nothing for
 * a scratch copy, which is reached by its ID only. Each distinct checkout is
 * a project with a label and code of its own, and every row gets an ID of
 * the registry's shape, `NNNN-<code>-<id>`. Anything else lands on the row as
 * written - `evidence:` moved out, a `targets:` override. The IDs come back,
 * in order.
 */
const declare = (home, { id = 'demo', roots = null, spec, ...rest }) =>
  register(home, [{ id, roots, spec, ...rest }])[0];

const register = (home, rows) => {
  const projects = new Map();
  const ids = [];
  const lines = rows.flatMap(({ id, roots = null, spec, home: h, ...rest }, i) => {
    let label = null;
    let code = 'tmp';
    if (roots) {
      if (!projects.has(String(roots))) projects.set(String(roots), projects.size);
      const k = projects.get(String(roots));
      label = `fx${k || ''}`;
      code = `f${k}`;
    }
    const rid = `${String(i + 1).padStart(4, '0')}-${code}-${id}`;
    ids.push(rid);
    return [
      `  - id: ${rid}`,
      `    project: ${label ?? 'null'}`,
      `    code: ${code}`,
      `    checkout: ${roots ? String(roots) : 'null'}`,
      `    home: ${h ?? spec}`,
      "    registered: { by: import, at: '2026-01-01T00:00:00Z' }",
      ...(roots ? [] : ["    ephemeral: { why: 'a copy' }"]),
      ...Object.entries(rest).map(([k, v]) => `    ${k}: ${v}`),
    ];
  });
  writeFileSync(join(home, 'registry.yml'), [`next: ${rows.length + 1}`, 'blueprints:', ...lines, ''].join('\n'));
  return ids;
};

/* The name an ID ends with: `demo` in `0001-fx-demo`. */
const nm = (id) => String(id).replace(/^\d{4}-[a-z0-9]{2,3}-/, '');

/* A personal home, where `blueprints new` makes one (ADR 0014 §4). */
const personal = (s, folder, label = 'repo') => join(s.home, 'projects', label, 'blueprints', folder);

/* The one home folder under a directory of homes, whatever month named it. */
const onlyHome = (dir, name) => {
  const found = existsSync(dir) ? readdirSync(dir).filter((d) => new RegExp(`^\\d{6}-${name}$`).test(d)) : [];
  assert.equal(found.length, 1, `one ${name} home in ${dir}: ${found.join(' ')}`);
  return join(dir, found[0]);
};

const configure = (home, yaml) => writeFileSync(join(home, 'profile.yml'), yaml);

/*
  * This test used to be called "with no config, a blueprint in the tree wins".
  * It does not any more, and that reversal is the whole of n-0133: a
  * blueprint nobody declared is not a project.
  *
  * The second half used to read "and its existing records stay put" - runs
  * found INSIDE the spec, outranking everything. That was the layout before
  * homes and nothing reads it now: the entry names a home, and the home is
  * where every record is.
  */
test('a declared blueprint answers from its home; an undeclared one is nothing at all', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    const home = personal(s, 'demo');
    blueprint(home);
    declare(s.home, { roots: repo, spec: home });
    const loc = resolveLocations({ cwd: repo });
    assert.equal(nm(loc.id), 'demo');
    assert.equal(loc.spec.path, home, 'the spec is the home itself');
    assert.equal(loc.runs.path, join(home, 'runs'), 'beside the spec, in the home');
    assert.equal(loc.threads.path, join(home, 'threads'));

    // And an undeclared one is nothing at all, however much it looks like a
    // project from the outside.
    const stray = join(s.root, 'stray');
    blueprint(stray, { name: 'stray' });
    // `path: null`, not "a path that happens not to exist": an undeclared
    // directory has no spec to name, and naming one was how a stray blueprint
    // came to be answered with a listed project's paths (n-0150).
    assert.equal(resolveLocations({ cwd: stray }).spec.path, null);
  } finally {
    s.cleanup();
  }
});

/*
 * Runs and threads are the same KIND of thing the spec is - claims the team
 * makes together - so they go where it goes. Evidence and drafts are not, so
 * they never do. That is what makes opting in one decision instead of four.
 */
test('a home holds the spec and its four records as siblings @rule:locations.default.home-is-one-folder', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    const home = personal(s, 'demo');
    const bp = blueprint(home); // no subdirectories at all
    declare(s.home, { roots: repo, spec: bp });
    const loc = resolveLocations({ cwd: repo });
    /*
     * One layout. Runs and threads used to sit INSIDE the spec directory and
     * evidence beside it, so a config had two shapes to say and a reader two
     * to learn; now the five are siblings and a home moves as one directory.
     * And there is no `blueprint/` between: the spec is the home (ADR 0014 §5).
     */
    for (const kind of KINDS) assert.equal(loc[kind].path, join(home, kind), kind);
    assert.equal(loc.spec.path, home);
    assert.match(loc.threads.why, /registered/, 'the home its row names');
    assert.match(loc.evidence.why, /home/, 'in the blueprint’s own home');
  } finally {
    s.cleanup();
  }
});

test('a spec kept outside the repository takes its runs and threads with it @rule:locations.default.home-is-one-folder', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    const home = personal(s, 'demo');
    const away = blueprint(home);
    declare(s.home, { roots: repo, spec: away });
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.spec.path, away);
    // Out with the spec, in the spec's own home - never back in the repo.
    assert.equal(loc.runs.path, join(home, 'runs'));
    assert.equal(loc.threads.path, join(home, 'threads'));
  } finally {
    s.cleanup();
  }
});

test('a project entry outranks the tree, and {id} expands in defaults', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    const awayHome = join(s.root, 'away', 'pinned');
    const away = blueprint(awayHome, { name: 'away-spec' });
    configure(s.home, ['defaults:', `  evidence: ${join(s.home, 'ev', '{id}')}`, ''].join('\n'));
    declare(s.home, { id: 'pinned', roots: repo, spec: away, runs: join(awayHome, 'runs') });
    const loc = resolveLocations({ cwd: repo });
    assert.equal(nm(loc.id), 'pinned');
    assert.equal(loc.spec.path, away);
    assert.match(loc.spec.why, /this machine's registry/);
    // Runs go where the entry says, which is with the spec...
    assert.equal(loc.runs.path, join(awayHome, 'runs'));
    // ...and evidence does not, taking the configured default with {id}
    // resolved to the name the entry's ID ends with rather than the
    // blueprint's own name.
    assert.equal(loc.evidence.path, join(s.home, 'ev', 'pinned'));
  } finally {
    s.cleanup();
  }
});

/*
 * `--blueprint <id>` replaced `--dir <path>`, and the difference is the point.
 * A path named on the command line reached a blueprint that no config knew
 * about - so it had no entry, so its home had to be derived from a name, and
 * that derivation is the ancestor of every collision this file tests for
 * (n-0156). An id can only name something already written down.
 */
test('--blueprint selects a declared blueprint, and an unknown id is nothing at all', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    const other = blueprint(join(s.root, 'other'), { name: 'other' });
    // A copy belongs to no checkout, so outside one it is named by its ID.
    const [, otherId] = register(s.home, [
      { id: 'pinned', roots: repo, spec: join(repo, 'blueprint') },
      { id: 'other', spec: other },
    ]);
    const loc = resolveLocations({ cwd: repo, blueprint: otherId });
    assert.equal(loc.spec.path, other);
    assert.match(loc.spec.why, new RegExp(`registry \\(${otherId}\\)`));

    // And a path is not a way in any more, however much it looks like one.
    const nobody = resolveLocations({ cwd: repo, blueprint: other });
    assert.equal(nobody.spec.path, null);
    assert.match(nobody.spec.why, /no registered blueprint/);
  } finally {
    s.cleanup();
  }
});

/*
 * `--dir` scopes the whole answer, not just the spec. The entry matching where
 * you are STANDING describes a different project, and letting it keep applying
 * reported one project's spec beside another's ledger.
 */
test('--blueprint does not inherit the ledger of whichever project you are standing in @rule:locations.answer.declared-not-discovered', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { name: 'mine', dirs: ['runs'] });
    const theirs = personal(s, 'theirs', 'theirs');
    const other = blueprint(theirs, { name: 'theirs' });
    const [, theirsId] = register(s.home, [
      { id: 'mine', roots: repo, spec: join(repo, 'blueprint'), runs: join(s.home, 'mine-runs') },
      { id: 'theirs', spec: other },
    ]);

    const standing = resolveLocations({ cwd: repo });
    assert.equal(
      standing.runs.path,
      join(s.home, 'mine-runs'),
      'the entry applies where it matches',
    );

    const named = resolveLocations({ cwd: repo, blueprint: theirsId });
    assert.equal(named.id, theirsId);
    assert.equal(named.spec.path, other);
    assert.equal(
      named.runs.path,
      join(theirs, 'runs'),
      'and never lends its ledger to another spec',
    );
  } finally {
    s.cleanup();
  }
});

/*
 * A repository can hold several blueprints - this one holds walkdown and
 * walkdown-example. An entry rooted at the whole tree must not answer for a
 * sibling inside it, or standing in one project reports another's ledger.
 */
test('two packs in one repository each answer for themselves @rule:locations.answer.declared-not-discovered', () => {
  const s = scratch();
  try {
    /*
     * This used to be "the nearest blueprint wins over an entry rooted at the
     * whole tree" - the tree beating the config for a monorepo sibling. There
     * is no contest now: each pack is declared, so each simply answers, and
     * the one nobody declared is not a project (q-0138).
     */
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { name: 'outer' });
    const innerHome = join(repo, 'example', '.walkdown', 'blueprints', 'inner');
    const inner = blueprint(innerHome, { name: 'inner' });
    register(s.home, [
      { id: 'outer', roots: repo, spec: join(repo, 'blueprint') },
      { id: 'inner', roots: join(repo, 'example'), spec: inner, runs: join(innerHome, 'runs') },
    ]);

    const outside = resolveLocations({ cwd: repo });
    assert.equal(nm(outside.id), 'outer', 'at the root, the outer entry answers');

    const within = resolveLocations({ cwd: join(repo, 'example') });
    assert.equal(nm(within.id), 'inner', 'the more specific entry answers inside it');
    assert.equal(within.spec.path, inner);
    assert.equal(within.runs.path, join(innerHome, 'runs'), "and never the outer project's ledger");

    /*
     * And a third pack nobody wrote down does not quietly become a project.
     * It sits inside the outer entry's roots, so the outer entry answers for
     * it - where the old tree walk would have found its `walkdown.yml` and
     * handed it a project of its own that no one had declared.
     */
    const undeclared = join(repo, 'ghost');
    blueprint(undeclared, { name: 'ghost' });
    const ghost = resolveLocations({ cwd: undeclared });
    assert.equal(nm(ghost.id), 'outer', 'claimed by the entry whose checkout contains it');
    assert.notEqual(ghost.spec.path, undeclared);
  } finally {
    s.cleanup();
  }
});

test('a more specific entry beats a broader one', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { name: 'outer' });
    const inner = blueprint(join(repo, 'sub', 'blueprint'), { name: 'inner' });
    register(s.home, [
      { id: 'outer', roots: repo, spec: join(repo, 'blueprint') },
      { id: 'pinned-inner', roots: join(repo, 'sub'), spec: inner, evidence: join(s.home, 'inner-ev') },
    ]);
    const loc = resolveLocations({ cwd: join(repo, 'sub') });
    assert.equal(nm(loc.id), 'pinned-inner');
    assert.equal(loc.evidence.path, join(s.home, 'inner-ev'));
  } finally {
    s.cleanup();
  }
});

test('an entry still answers where the tree has no blueprint to offer', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true }); // no blueprint anywhere
    const away = blueprint(personal(s, 'away'), { name: 'away' });
    declare(s.home, { id: 'away', roots: repo, spec: away });
    const loc = resolveLocations({ cwd: join(repo, 'src') });
    assert.equal(loc.spec.path, away, 'which is what an out-of-tree spec is for');
  } finally {
    s.cleanup();
  }
});

test('a broken config is reported, not thrown past', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    writeFileSync(join(s.home, 'registry.yml'), 'blueprints: [oops\n');
    const loc = resolveLocations({ cwd: repo });
    assert.ok(loc.config.registry.error, 'the parse failure is carried, not swallowed');
    /*
     * And nothing is invented in its place. The tree used to rescue a broken
     * config by answering from it; a config nobody can read is now a project
     * nobody can resolve, which is the honest report rather than a silent
     * fallback to something that merely looks right (n-0133).
     */
    assert.equal(loc.spec.path, null, 'an unreadable config resolves nothing');
  } finally {
    s.cleanup();
  }
});

/* ---- spec_hash ----------------------------------------------------------- */

test('the spec hash covers the spec and nothing the spec produces @rule:locations.travel.judged-against-a-spec', () => {
  const s = scratch();
  try {
    const bp = blueprint(join(s.root, 'bp'), { dirs: ['runs', 'threads'] });
    const before = specHash(bp);
    assert.match(before, /^sha256:[0-9a-f]{12}$/);
    assert.deepEqual(specFiles(bp), ['features/a.yml', 'spec.yml', 'storyboard.yml']);

    // A run, a thread and a draft are what the spec PRODUCES.
    writeFileSync(join(bp, 'runs', 'r.json'), '{"run_id":"x"}');
    writeFileSync(join(bp, 'threads', 't.yml'), 'id: t\n');
    assert.equal(specHash(bp), before, 'recording a verdict does not change the spec');

    // Cosmetic churn does not move it; a word does.
    writeFileSync(join(bp, 'features', 'a.yml'), 'feature: a  \r\nstories: []\r\n\n\n');
    assert.equal(specHash(bp), before, 'line endings and trailing space are not the spec');
    writeFileSync(join(bp, 'features', 'a.yml'), 'feature: b\nstories: []\n');
    assert.notEqual(specHash(bp), before, 'a changed word is');
  } finally {
    s.cleanup();
  }
});

test('a spec file that cannot be read is named, not an errno @rule:locations.travel.judged-against-a-spec', () => {
  /*
   * The twin of n-0198. specFiles learned to stat before believing a name,
   * and specHash kept reading whatever survived that filter with no guard at
   * all - so a spec file the process could see but not open came back as a
   * bare EACCES stack from under writeRunRecord, which hashes on every write
   * (n-0215). The reader's next move is to look at the file, so the sentence
   * has to say which one.
   */
  const s = scratch();
  try {
    const bp = blueprint(join(s.root, 'bp'));
    const shut = join(bp, 'features', 'a.yml');
    chmodSync(shut, 0o000);
    try {
      readFileSync(shut, 'utf8');
      return; // running as root, where nothing is unreadable: nothing to test
    } catch {
      /* good: the file really is shut */
    }
    assert.throws(
      () => specHash(bp),
      (e) =>
        e instanceof Refused &&
        e.message.includes('features/a.yml') &&
        e.message.includes(bp) &&
        e.message.includes('cannot be read'),
      'the refusal names the file, relative to the blueprint that owns it',
    );
    chmodSync(shut, 0o644);
    assert.match(specHash(bp), /^sha256:[0-9a-f]{12}$/, 'and reading it again is a hash');

    // And the same question of the directory, which comes out of the loader
    // rather than the hash and so reaches every command, not only the ones
    // that stamp (n-0217).
    const dir = join(bp, 'features');
    chmodSync(dir, 0o000);
    assert.throws(
      () => loadBlueprint(bp),
      (e) => e instanceof Refused && e.message.includes(dir) && e.message.includes('cannot be listed'),
      'a spec directory that cannot be listed is named too',
    );
    chmodSync(dir, 0o755);
  } finally {
    s.cleanup();
  }
});

test('a directory that happens to be named .yml is not a spec file @rule:locations.travel.judged-against-a-spec', () => {
  /*
   * n-0198: the loader has always filtered `.isFile()` and specFiles counted
   * anything whose NAME ended in .yml, so a directory called
   * `features/thing.yml` was invisible to one reader and a file to the other,
   * and readFileSync threw EISDIR. Everything that stamps provenance calls
   * specHash, so one mistyped `mkdir` took down writeRunRecord, writeSweep and
   * `walkdown judge` at once, with a stack trace rather than a sentence.
   */
  const s = scratch();
  try {
    const bp = blueprint(join(s.root, 'bp'));
    const before = specHash(bp);
    mkdirSync(join(bp, 'features', 'thing.yml'), { recursive: true });
    assert.deepEqual(specFiles(bp), ['features/a.yml', 'spec.yml', 'storyboard.yml']);
    assert.equal(specHash(bp), before, 'a directory is not part of the spec');

    // And at the top level, where the same mistake reaches the two named files.
    rmSync(join(bp, 'storyboard.yml'));
    mkdirSync(join(bp, 'storyboard.yml'));
    assert.deepEqual(specFiles(bp), ['features/a.yml', 'spec.yml']);
    assert.match(specHash(bp), /^sha256:[0-9a-f]{12}$/);

    /*
     * And a link to nothing, which is the same question asked of the loader
     * (n-0211): `statSync` threw ENOENT out of lint, status and judge alike,
     * so no run could be recorded at all. A name ending in .yml is not a
     * promise that anything is there.
     */
    symlinkSync(join(bp, 'features', 'gone.yml'), join(bp, 'features', 'dangling.yml'));
    assert.deepEqual(specFiles(bp), ['features/a.yml', 'spec.yml']);
    assert.match(specHash(bp), /^sha256:[0-9a-f]{12}$/);
    // The loader's half of the same question is exercised through lint, in
    // test/lint.test.js, where a blueprint is declared and can be loaded.
  } finally {
    s.cleanup();
  }
});

test('the same words in a different feature file are a different spec @rule:locations.travel.judged-against-a-spec', () => {
  const s = scratch();
  try {
    const a = blueprint(join(s.root, 'a'));
    const b = blueprint(join(s.root, 'b'));
    rmSync(join(b, 'features', 'a.yml'));
    writeFileSync(join(b, 'features', 'z.yml'), 'feature: a\nstories: []\n');
    assert.notEqual(specHash(a), specHash(b));
  } finally {
    s.cleanup();
  }
});

/* ---- what a project gets by default ------------------------------------- */

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
/*
 * `cwd` matters as much as the home now: a repository config is found by
 * walking up from where the command RUNS, so a subprocess left in walkdown's
 * own checkout would read walkdown's committed config while claiming to be a
 * scratch project somewhere else. Defaults beside the pinned home.
 */
const walkdown = (home, args, cwd = dirname(home)) =>
  execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, WALKDOWN_HOME: home },
  }).toString();
// WALKDOWN_SKILLS_DIR rides along in process.env, pinned by scratch().

/* Every path in the tree, so a test can say "and nothing else appeared". */
function tree(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
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
test('a fresh project gets nothing in its tree at all @rule:locations.default.nothing-in-the-tree', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'app.js'), '// theirs\n');
    const before = tree(repo);
    const said = walkdown(s.home, ['blueprints', 'new', '--dir', repo]);

    /*
     * "Without altering the repository" means without altering it: no
     * `.walkdown/`, no pointer. The pointer was the one file default `init`
     * put in front of git, carrying an absolute path that was wrong on every
     * other machine (n-0161).
     */
    assert.deepEqual(tree(repo), before, 'the tree is exactly as it was found');
    // The skills are the machine's business now (`walkdown init`, ADR 0012).
    assert.equal(existsSync(join(s.skills, 'walkdown')), false, 'a blueprint installs nothing for the person');

    // Everything walkdown made is in the person's own home, one folder under
    // `projects/<label>/blueprints/` (ADR 0014 §4), laid out as every home is.
    const loc = resolveLocations({ cwd: repo });
    const home = onlyHome(join(s.home, 'projects', 'repo', 'blueprints'), 'repo');
    assert.equal(loc.spec.path, home);
    for (const kind of KINDS) assert.equal(loc[kind].path, join(home, kind), kind);
    assert.equal(loc.standard.name, 'none');
    assert.match(said, /git never sees/);
    assert.match(said, /walkdown blueprints commit spec/, 'and says how to commit it if you want it in the tree');

    // Abandoning it is deleting that one directory.
    rmSync(home, { recursive: true, force: true });
    assert.deepEqual(tree(repo), before);
  } finally {
    s.cleanup();
  }
});

/*
 * What git sees is not remembered anywhere; it is READ off the tree
 * (lib/standard.js). So changing your mind is a filesystem act - a home moving,
 * a file written or deleted - and `init --commit` performs it, in every
 * direction, on a project that already exists. It used to write the ignore
 * rules once and print success ever after (n-0158).
 */
test('--commit spec and --commit all are one .gitignore apart, and changing your mind changes the tree @rule:locations.default.in-repo-on-request', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    const said = walkdown(s.home, ['blueprints', 'new', '--commit', 'spec', '--dir', repo]);

    const loc = () => resolveLocations({ cwd: repo });
    const home = onlyHome(join(repo, '.walkdown', 'blueprints'), 'repo');
    assert.equal(loc().spec.path, home);
    for (const kind of KINDS) assert.equal(loc()[kind].path, join(home, kind), kind);

    // The home's own .gitignore, one per blueprint (ADR 0014 §5).
    const ignore = join(home, '.gitignore');
    const rules = () =>
      readFileSync(ignore, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    assert.deepEqual(rules(), ['runs/', 'evidence/', 'drafts/']);
    assert.ok(!existsSync(join(repo, '.walkdown', '.gitignore')), 'and no shared one beside the homes');
    assert.equal(loc().standard.name, 'spec');
    assert.match(said, /Committed: the spec and its threads/);
    assert.match(said, /delete it to commit everything/, 'and how to change its mind');
    // The pointer names where to look, never a blueprint or a path off this disk.
    const pointer = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    assert.match(pointer, /under `\.walkdown\/blueprints\/`/, 'the pointer is relative');
    assert.ok(!pointer.includes(s.root), 'and carries no absolute path');

    // A record, so the round trip below can be seen to carry it.
    mkdirSync(join(home, 'runs'), { recursive: true });
    writeFileSync(join(home, 'runs', 'r.json'), '{"kind":"walkdown","results":[]}\n');

    // spec -> all: the file goes away, and the command says so.
    const all = walkdown(s.home, ['blueprints', 'new', '--commit', 'all', '--dir', repo]);
    assert.equal(existsSync(ignore), false, 'no .gitignore is what "all" IS');
    assert.equal(loc().standard.name, 'all');
    assert.match(all, /- removed/);
    assert.match(all, /in full/);

    // all -> spec: written back.
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec', '--dir', repo]);
    assert.equal(loc().standard.name, 'spec');
    assert.ok(existsSync(join(home, 'runs', 'r.json')), 'nothing moved for a file to change');

    // spec -> none: the home leaves the repository whole, and so does the pointer.
    const out = walkdown(s.home, ['blueprints', 'new', '--commit', 'none', '--dir', repo]);
    assert.match(out, /→ moved/);
    assert.equal(existsSync(join(repo, '.walkdown')), false, 'the repository has nothing of walkdown\'s');
    assert.equal(existsSync(join(repo, 'CLAUDE.md')), false, 'not even the pointer walkdown made');
    // Moved whole, keeping its folder name (ADR 0014 §4).
    const away = join(s.home, 'projects', 'repo', 'blueprints', basename(home));
    assert.equal(loc().spec.path, away);
    assert.ok(existsSync(join(away, 'runs', 'r.json')), 'the record came along, unedited');
    assert.equal(loc().standard.name, 'none');
    assert.equal(parse(readFileSync(join(s.home, 'registry.yml'), 'utf8')).blueprints.length, 1, 'one row, rewritten');

    // none -> spec: back in, under the same folder name it left with.
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec', '--dir', repo]);
    assert.equal(loc().spec.path, home);
    assert.ok(existsSync(join(home, 'runs', 'r.json')));
    assert.equal(existsSync(away), false, 'and not left behind');
    assert.equal(loc().standard.name, 'spec');
    const profile = join(s.home, 'profile.yml');
    assert.equal(
      ((existsSync(profile) && parse(readFileSync(profile, 'utf8'))?.blueprints) || []).length,
      0,
      'the profile declares nothing the registry does',
    );
  } finally {
    s.cleanup();
  }
});

/*
 * A committed spec's .gitignore is itself committable: the standard is a file
 * a clone receives, inside the home it rules. A bare `*` could not be
 * (q-0162). There is no manifest beside it any more (ADR 0014 §1).
 */
test('the spec standard is a file git can see @rule:locations.default.in-repo-on-request', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    let git = true;
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
    } catch {
      git = false;
    }
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec', '--dir', repo]);
    const home = onlyHome(join(repo, '.walkdown', 'blueprints'), 'repo');
    const rel = `.walkdown/blueprints/${basename(home)}`;
    for (const kind of ['runs', 'evidence', 'drafts']) {
      mkdirSync(join(home, kind), { recursive: true });
      writeFileSync(join(home, kind, 'x'), 'x');
    }
    mkdirSync(join(home, 'threads'), { recursive: true });
    writeFileSync(threadAt(home, 'threads', 'n-0001'), 'id: n-0001\n');
    if (!git) return;
    const staged = execFileSync('git', ['add', '-A', '--dry-run'], { cwd: repo, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(/^add '|'$/g, ''));
    const under = (p) => staged.filter((f) => f.startsWith(p));
    assert.ok(staged.includes(`${rel}/.gitignore`), staged.join('\n'));
    assert.ok(!staged.includes('.walkdown/config.yml'), 'no manifest is written');
    assert.ok(staged.includes(`${rel}/spec.yml`));
    assert.ok(under(`${rel}/features/`).length);
    assert.ok(under(`${rel}/threads/`).length);
    for (const kind of ['runs', 'evidence', 'drafts'])
      assert.deepEqual(under(`${rel}/${kind}/`), [], `${kind} stays out`);
  } finally {
    s.cleanup();
  }
});

test('tightening to spec says what git still tracks, and leaving takes the skills and the flow style with it @rule:locations.default.in-repo-on-request @rule:locations.default.skills-are-yours-by-default', () => {
  /*
   * Three things the second judging of in-repo-on-request found (n-0164,
   * n-0165, n-0166), driven through the real CLI with git watching. An ignore
   * file rules only what git has not met, so a run committed under `all` is
   * still tracked after `--commit spec`, and the command has to say so rather
   * than "keeps runs out". Leaving the repository takes the skills it put
   * there. And the personal config it writes on the way out is block style.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
    } catch {
      return;
    }
    const git = (...args) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd: repo, encoding: 'utf8' });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'all'], repo);
    const home = onlyHome(join(repo, '.walkdown', 'blueprints'), 'repo');
    mkdirSync(join(home, 'runs', 'evidence', 'x'), { recursive: true });
    writeFileSync(join(home, 'runs', 'r.json'), '{}');
    writeFileSync(join(home, 'runs', 'evidence', 'x', 'shot.png'), 'png');
    git('add', '-A');
    git('commit', '-q', '-m', 'everything');
    const out = walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    assert.match(out, /still tracked: 2 file\(s\)/, out);
    assert.match(out, /git rm --cached/);
    assert.match(out, /runs\/r\.json/);
    // Nothing new under those directories is staged, but the two stay in the index.
    assert.ok(git('ls-files').includes(`.walkdown/blueprints/${basename(home)}/runs/r.json`));

    // A committed spec is not a reason to vendor the procedures beside it
    // (n-0239): they are the person's, and the repository stays clean of them.
    assert.equal(existsSync(join(repo, '.claude')), false, 'skills did not follow the spec in');

    // And a copy somebody put there on purpose is theirs, so leaving the
    // repository does not take it away - init never wrote it.
    mkdirSync(join(repo, '.claude', 'skills', 'walkdown-judge'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'mine now\n');
    walkdown(s.home, ['blueprints', 'new', '--commit', 'none'], repo);
    assert.equal(readFileSync(join(repo, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'utf8'), 'mine now\n');
    assert.ok(!existsSync(join(repo, '.walkdown')));
    const registry = readFileSync(join(s.home, 'registry.yml'), 'utf8');
    assert.match(registry, /^blueprints:\n  - /m, registry);
    assert.doesNotMatch(registry, /\[\s*\{/, 'block style, not flow');
  } finally {
    s.cleanup();
  }
});

test('import registers a home the registry does not yet name, and refuses what is not a home @rule:locations.default.home-is-one-folder', () => {
  /*
   * n-0169: from inside a pack, `project add` wrote absolute paths into the
   * committed config - wrong on every other machine - and sent runs and
   * threads to the blueprint's parent while naming a home nothing wrote to.
   * Since ADR 0003 nothing is written into the checkout at all: the row goes
   * in this machine's registry, spelled in full.
   *
   * What it takes is a HOME - one folder holding spec.yml, with threads,
   * runs, evidence and drafts beside it (ADR 0014 §5) - under some
   * project's `.walkdown/blueprints/`, at any depth and with any name. It
   * used to accept a bare `<dir>/blueprint` and derive a home for it; that
   * was the layout from before homes.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);

    // A home that arrived rather than one `new` made: a copy, a clone's, or
    // one somebody moved in. It exists on disk; nothing names it yet.
    const two = join(repo, '.walkdown', 'blueprints', '0002-two');
    blueprint(two, { name: 'second' });
    const out = walkdown(s.home, ['blueprints', 'import', two], repo);
    assert.match(out, /listed/);
    const rows = () => parse(readFileSync(join(s.home, 'registry.yml'), 'utf8')).blueprints;
    const row = rows().find((p) => nm(p.id) === 'two');
    assert.ok(row, JSON.stringify(rows()));
    assert.equal(row.checkout, repo);
    assert.equal(row.project, 'repo', 'the project is a label, beside the checkout it names');
    assert.equal(row.home, two);
    assert.equal(row.registered.by, 'import');
    assert.equal(resolveLocations({ cwd: repo, blueprint: 'two' }).runs.path, join(two, 'runs'));
    // Asking again, by another spelling of the same folder, lists it once.
    assert.match(walkdown(s.home, ['blueprints', 'import', `${two}/`], repo), /already listed/);
    assert.equal(rows().filter((p) => p.home === two).length, 1);

    // A directory with no blueprint in it at all is refused with the shape
    // spelled out, rather than being taken for a home and half-built.
    const notOne = join(repo, 'notes');
    mkdirSync(notOne, { recursive: true });
    assert.throws(() => walkdown(s.home, ['blueprints', 'import', notOne], repo), /no spec\.yml there/);

    // And a home-shaped directory standing outside any `.walkdown/blueprints/`
    // is a copy, whatever it holds.
    const bare = join(repo, 'old');
    blueprint(bare, { name: 'old' });
    assert.throws(() => walkdown(s.home, ['blueprints', 'import', bare], repo), /not under any repository's \.walkdown\/blueprints\//);
    const elsewhere = join(s.root, 'elsewhere', 'else');
    blueprint(elsewhere, { name: 'else' });
    assert.throws(() => walkdown(s.home, ['blueprints', 'import', elsewhere], repo), /not under any repository's \.walkdown\/blueprints\//);
    assert.equal(readdirSync(join(repo, '.walkdown', 'blueprints')).length, 2, 'nothing was copied in');

    // A copy is what --ephemeral lists: in the registry, spelled in full,
    // with no project - it is nobody's home, which is the point of a
    // throwaway (ADR 0003), and it is reached by its ID.
    walkdown(s.home, ['blueprints', 'import', elsewhere, '--ephemeral', '--why', 'a copy'], repo);
    const mine = rows().find((p) => p.ephemeral);
    assert.ok(mine, `registered: ${JSON.stringify(rows())}`);
    assert.equal(mine.project, null);
    assert.equal(mine.checkout, null);
    assert.equal(mine.ephemeral.why, 'a copy');
    assert.ok(mine.home.startsWith('/') || mine.home.startsWith('~'), mine.home);
    // And the checkout is given no manifest by any of it (ADR 0014 §1).
    assert.ok(!existsSync(join(repo, '.walkdown', 'config.yml')));
  } finally {
    s.cleanup();
  }
});

test('a nested directory sharing the name is its own project, never a merge into the root’s @rule:locations.registry.projects-are-labels', () => {
  /*
   * n-0170 (1): the merge joined a personal row to a committed row when they
   * shared an id and the personal root lay ANYWHERE inside the repository.
   * mono/app committed its spec; mono/app/packs/app got a plain init; the
   * personal `app` merged over the committed `app`, and the root's own
   * records were stranded. Same name, different checkout: two projects -
   * and since a project is a label (ADR 0014 §3), the second is asked for a
   * label of its own before anything is registered.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'app');
    const pack = join(repo, 'packs', 'app');
    mkdirSync(pack, { recursive: true });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    const refused = cli(s.home, ['blueprints', 'new'], pack);
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /label `app` is another checkout's/);
    assert.equal(readRegistry().rows.length, 1, 'nothing registered until it has a label of its own');
    walkdown(s.home, ['blueprints', 'new', '--project', 'app-pack', '--code', 'ap2'], pack);

    const top = JSON.parse(walkdown(s.home, ['where', '--json'], repo));
    assert.equal(nm(top.id), 'app');
    assert.match(top.spec.path, /\/app\/\.walkdown\/blueprints\/\d{6}-app$/);
    assert.equal(top.config.matchedIn, 'registry');
    const inner = JSON.parse(walkdown(s.home, ['where', '--json'], pack));
    assert.ok(inner.spec.path.includes('/home/projects/app-pack/blueprints/'), inner.spec.path);
    assert.notEqual(inner.spec.path, top.spec.path);
    assert.equal(nm(inner.id), 'app', 'both are called app, and their IDs tell them apart');
    assert.notEqual(inner.id, top.id);
    // A thread filed at the top lands at the top.
    writeFileSync(
      join(top.spec.path, 'features', 'a.yml'),
      'feature: a\nstories:\n  - id: a.s\n    rules:\n      - id: a.s.one\n        statement: One.\n        verify: [checks]\n',
    );
    walkdown(s.home, ['threads', 'new', '--rule', 'a.s.one', '--body', 'at the top'], repo);
    assert.ok(existsSync(threadAt(top.threads.path, 'n-0001')));
    assert.ok(!existsSync(threadAt(inner.threads.path, 'n-0001')));
  } finally {
    s.cleanup();
  }
});

test('a blueprint made one directory too deep says plainly that it is a new project', () => {
  /*
   * Two packs in one repository each answering for themselves is deliberate,
   * so this is not a refusal - the finding was the silence. `init` from a
   * subdirectory of an inited repository printed a first-ever init word for
   * word, and the person got a working second project rather than a
   * correction; the two only diverge later, when the outer keeps its ledger
   * and the inner starts empty (n-0214).
   *
   * (Untagged: the rule this was filed under, one-home-per-blueprint, is
   * retired.)
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, 'app', 'web'), { recursive: true });
    execFileSync('git', ['init', '-q', '.'], { cwd: repo });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);

    const deep = walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], join(repo, 'app', 'web'));
    assert.match(deep, /`web`, a new project on this machine/, deep);
    assert.match(deep, /`0001-rp-repo` already answers for this directory/, 'the outer blueprint is named, by its ID');
    assert.match(deep, /two blueprints in two projects/, 'and what the person now has is said plainly');

    // And an unrelated repository says none of it.
    const other = join(s.root, 'other');
    mkdirSync(other, { recursive: true });
    execFileSync('git', ['init', '-q', '.'], { cwd: other });
    assert.doesNotMatch(walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], other), /already answers/);

    // Still a second project, because that is the deliberate case.
    const where = JSON.parse(walkdown(s.home, ['where', '--json'], join(repo, 'app', 'web')));
    assert.equal(nm(where.id), 'web', 'the inner one answers where it was made');
    assert.match(where.spec.path, /\/app\/web\/\.walkdown\/blueprints\/\d{6}-web$/);
    assert.equal(nm(JSON.parse(walkdown(s.home, ['where', '--json'], repo)).id), 'repo', 'and the outer one where it was');
  } finally {
    s.cleanup();
  }
});

test('a number once given is never given again @rule:locations.registry.ids-stay-here', () => {
  /*
   * n-0170 (2): abandoning a default project is deleting its home. The next
   * same-named repository was handed the same number, the stale entry
   * matched it by spec path, and the abandoned checkout answered with a
   * blueprint it never claimed.
   *
   * The number is the registry's own counter now (ADR 0014 §2), so it
   * climbs whatever happens on disk - a home deleted, or its row forgotten.
   */
  const s = scratch();
  try {
    const one = join(s.root, 'a', 'app');
    const two = join(s.root, 'b', 'app');
    const three = join(s.root, 'c', 'app');
    for (const d of [one, two, three]) mkdirSync(d, { recursive: true });
    walkdown(s.home, ['blueprints', 'new'], one);
    const firstId = readRegistry().rows[0].id;
    assert.match(firstId, /^0001-/);
    rmSync(readRegistry().rows[0].home, { recursive: true });
    const out = walkdown(s.home, ['blueprints', 'new', '--project', 'app-b', '--code', 'ab'], two);
    assert.match(out, /0002-ab-app/, out);
    assert.match(out, /listed/, out);
    const second = JSON.parse(walkdown(s.home, ['where', '--json'], two));
    assert.match(second.spec.path, /\/projects\/app-b\/blueprints\/\d{6}-app$/);
    const first = JSON.parse(walkdown(s.home, ['where', '--json'], one));
    assert.equal(first.id, firstId);
    assert.ok(!existsSync(first.spec.path), 'the abandoned checkout answers with its own gone home, not with the new one');
    assert.throws(() => walkdown(s.home, ['status'], one));

    // And forgetting the row does not hand its number out again.
    walkdown(s.home, ['blueprints', 'forget', firstId], one);
    assert.match(walkdown(s.home, ['blueprints', 'new'], three), /0003-[a-z0-9]{2,3}-app/);
  } finally {
    s.cleanup();
  }
});

/*
 * Racers for the concurrency cases below: each is its own process, because
 * the failure is BETWEEN processes - inside one, the writes are serialised by
 * the event loop and the bug is invisible. Each waits on a barrier file
 * before running `blueprints new`, because node takes long enough to start
 * that the spawns would otherwise finish in turn and race nothing at all.
 * Every racer prints OK or REFUSED and the first line it was refused with.
 */
async function race(s, asks) {
  const go = join(s.root, 'go');
  const runner = join(s.root, 'racer.mjs');
  writeFileSync(
    runner,
    `import { existsSync } from 'node:fs';\n` +
      `import { execFileSync } from 'node:child_process';\n` +
      `while (!existsSync(${JSON.stringify(go)})) {}\n` +
      `try {\n` +
      `  execFileSync(process.execPath, [${JSON.stringify(CLI)}, 'blueprints', 'new', ...JSON.parse(process.argv[2])], { stdio: 'pipe', cwd: process.argv[3] });\n` +
      `  process.stdout.write('OK');\n` +
      `} catch (e) { process.stdout.write('REFUSED ' + String(e.stderr).split('\\n')[0]); }\n`,
  );
  const racers = asks.map(({ args, cwd }) =>
    spawn(process.execPath, [runner, JSON.stringify(args), cwd], { env: { ...process.env, WALKDOWN_HOME: s.home, NO_COLOR: '1' } }),
  );
  const settled = racers.map(
    (p) =>
      new Promise((done, fail) => {
        let out = '';
        p.stdout.on('data', (x) => (out += x));
        p.on('error', fail);
        p.on('close', () => done(out.trim()));
      }),
  );
  // Let them all reach the spin, then release them together.
  await new Promise((r) => setTimeout(r, 400));
  writeFileSync(go, '');
  return Promise.all(settled);
}

/* Every home folder under the personal projects, as `<label>/<folder>`. */
const personalHomes = (s) => {
  const top = join(s.home, 'projects');
  if (!existsSync(top)) return [];
  return readdirSync(top).flatMap((label) => {
    const dir = join(top, label, 'blueprints');
    return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
  });
};

test('blueprints made at the same moment under one name are one blueprint', async () => {
  /*
   * The race itself, run for real. Eight processes released together used to
   * produce seven homes for eight blueprints - two of them sharing a spec,
   * threads and runs. Homes were allocated then, by number, under
   * `claimHome`; that is gone with ADR 0014, and a home is a folder the
   * registry names. So the question becomes: eight `blueprints new app` at
   * once in one checkout are one blueprint, in one home, on one row - and
   * whoever could not have that was told so in words.
   * (Untagged: one-home-per-blueprint, which this was filed under, is retired.)
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    const results = await race(s, Array.from({ length: 8 }, () => ({ args: ['app'], cwd: repo })));
    const homes = personalHomes(s);
    const rows = readRegistry().rows;
    assert.equal(homes.length, 1, `eight asks for one blueprint, ${homes.length} homes: ${homes.join(' ')}`);
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0].home, homes[0], 'and the row names the home that stands');
    for (const r of results.filter((r) => r.startsWith('REFUSED')))
      assert.match(r, /another walkdown is writing/, r);
    assert.ok(results.some((r) => r === 'OK'), results.join(' | '));
  } finally {
    s.cleanup();
  }
});

test('racers with different names never share a number — the loser is refused in words @rule:locations.registry.ids-stay-here', async () => {
  /*
   * n-0210: racers with DIFFERENT names once all landed at the same number,
   * and two blueprints ended up with a permanently split ledger.
   *
   * The answer taken (Topher, 2026-09-06) is to refuse rather than
   * serialise. The number is the registry's counter now (ADR 0014 §2) and
   * the registry has one writer at a time: whoever finds it held is told to
   * run again. What must never happen is a number shared in silence.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    const results = await race(s, Array.from({ length: 8 }, (_, i) => ({ args: [`r${i}`], cwd: repo })));

    const rows = readRegistry().rows;
    const numbers = rows.map((r) => String(r.id).slice(0, 4));
    assert.equal(new Set(numbers).size, numbers.length, `two blueprints wearing one number: ${numbers.join(' ')}`);
    // Every refusal says so in words, and names the retry.
    for (const r of results.filter((r) => r.startsWith('REFUSED')))
      assert.match(r, /another walkdown is writing/, r);
    // And the winners are exactly the rows written, and the homes standing.
    assert.equal(results.filter((r) => r === 'OK').length, rows.length, results.join(' | '));
    assert.equal(personalHomes(s).length, rows.length, personalHomes(s).join(' '));
  } finally {
    s.cleanup();
  }
});

test('a blueprint in the personal home answers, whatever sits above that home @rule:locations.answer.one-walkdown-answers', () => {
  /*
   * n-0213. The crossing guard asked walkdownRoot() which .walkdown answers
   * for a spec, and walkdownRoot never returns the personal home — so a
   * blueprint living IN the personal home was attributed to whatever
   * .walkdown happened to sit above it, and the exemption the rule's own
   * step describes was unreachable. It only looked like it held because the
   * default ~/.walkdown has nothing above it.
   *
   * Put WALKDOWN_HOME inside a checkout — which is what this repo's own test
   * runner does — and `init --commit none` made a project its own checkout
   * could not see: init said "+ listed … as other" and everything after said
   * nothing claims this directory. The tool contradicted itself in two
   * commands.
   */
  const s = scratch();
  try {
    const app = join(s.root, 'app');
    const other = join(s.root, 'other');
    mkdirSync(app, { recursive: true });
    mkdirSync(other, { recursive: true });
    execFileSync('git', ['init', '-q', '.'], { cwd: app });
    // The personal home lives INSIDE a checkout that declares its own.
    const home = join(app, 'tmp-home');
    walkdown(home, ['blueprints', 'new', '--commit', 'spec'], app);

    walkdown(home, ['blueprints', 'new', '--commit', 'none'], other);
    const listed = walkdown(home, ['blueprints'], other);
    assert.match(listed, /-other\b/, 'the blueprint new said it listed is listed');

    const where = walkdown(home, ['where'], other);
    assert.doesNotMatch(where, /nothing declares|lies under/, where);
    assert.match(where, /tmp-home\/projects\/other\/blueprints\/\d{6}-other/, 'and its home is the one under the personal home');

    // And a pack inside the checkout is its own row: `blueprints` lists every
    // one this machine knows about (ADR 0003), and standing somewhere picks
    // the deepest registered project containing it.
    const pack = join(app, 'packs', 'gamma');
    mkdirSync(pack, { recursive: true });
    walkdown(home, ['blueprints', 'new', '--commit', 'spec'], pack);
    assert.match(walkdown(home, ['blueprints'], app), /-gamma\b/);
    assert.equal(nm(JSON.parse(walkdown(home, ['where', '--json'], app)).id), 'app');
    assert.equal(nm(JSON.parse(walkdown(home, ['where', '--json'], pack)).id), 'gamma');
  } finally {
    s.cleanup();
  }
});

test('a home nothing claims is reported, and never guessed at', () => {
  /*
   * "A home nothing claims is reported and left standing, never guessed at
   * and never moved" was a step of one-home-per-blueprint (retired with ADR
   * 0014, so untagged here), and only the standing half was true: an
   * unclaimed home appeared in no output anywhere. That is what made the
   * config's unserialised read-modify-write invisible — concurrent inits
   * made more homes than rows, every process exited 0 naming its own, and
   * nothing afterwards mentioned the ones with no row (n-0219).
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', '.'], { cwd: repo });
    walkdown(s.home, ['blueprints', 'new'], repo);

    const before = walkdown(s.home, ['blueprints'], repo);
    assert.doesNotMatch(before, /no registry row names/, 'nothing to report yet');

    // A home standing with records in it and no row anywhere — what a lost
    // registry write leaves behind. A home is a folder holding spec.yml.
    const stranded = blueprint(personal(s, 'stranded'), { name: 'stranded' });
    mkdirSync(join(stranded, 'threads'), { recursive: true });
    writeFileSync(threadAt(stranded, 'threads', 'n-0001'), 'id: n-0001\nstatus: open\n');

    const after = walkdown(s.home, ['blueprints'], repo);
    assert.match(after, /no registry row names/, after);
    assert.match(after, /blueprints\/stranded/, 'the home itself is named');
    assert.match(after, /not guessed at/, 'and it says it will not be adopted');

    // Reported, never adopted: the registry is untouched by the reporting.
    assert.doesNotMatch(readFileSync(join(s.home, 'registry.yml'), 'utf8'), /stranded/);
  } finally {
    s.cleanup();
  }
});

test('concurrent blueprints new never loses a row: every home on disk is one the registry names', async () => {
  /*
   * n-0219 / the surviving half of n-0208. The homes were always distinct —
   * that is the n-0210 guard — but config.yml was an unlocked
   * read-modify-write, so six inits at once made six homes and three rows,
   * every process exiting 0 and naming the home it thought it had listed.
   * Three checkouts were left with records in a home no row mentioned, and
   * `init` there would then mint a second one.
   *
   * The answer is the one already taken for the number: refuse rather than
   * serialise. So the invariant is not "everybody succeeds" — it is that a
   * home standing on disk is always a home the registry names, and anybody
   * who could not have that is told so. Each checkout is given a code of
   * its own, so the only thing racing is the registry.
   * (Untagged: one-home-per-blueprint, which this was filed under, is retired.)
   */
  const s = scratch();
  try {
    const dirs = Array.from({ length: 6 }, (_, i) => join(s.root, `proj${i}`));
    for (const d of dirs) mkdirSync(d, { recursive: true });
    const results = await race(
      s,
      dirs.map((d) => ({ args: ['--dir', d], cwd: d })),
    );

    const homes = personalHomes(s);
    const rows = readRegistry().rows;
    const named = new Set(rows.map((r) => String(r.home ?? '')).filter(Boolean));

    // The invariant: nothing is left standing that no row names.
    assert.deepEqual(
      homes.filter((h) => !named.has(h)),
      [],
      `homes with no row: ${homes.filter((h) => !named.has(h)).join(' ')} (rows: ${[...named].join(' ')})`,
    );
    // And what succeeded is what got a row — nobody exited 0 on a lost write.
    assert.equal(results.filter((r) => r === 'OK').length, homes.length, results.join(' | '));
    assert.ok(homes.length >= 1, 'at least one racer gets through');
  } finally {
    s.cleanup();
  }
});

test('a profile row about a checkout is never read, and a move writes the one registry row @rule:locations.keeping.moving-is-a-decision', () => {
  /*
   * The pure-override shape - `{id, evidence}` in the person's file, what
   * `move` used to write - is a row from before the registry. It used to be
   * folded into the first registry row written about the same checkout;
   * with ADR 0014 the old files are moved by `walkdown upgrade` and never
   * read in place, so the profile's row is set aside and named, and nothing
   * of it reaches the registry. A move is the door that exists, and it
   * writes onto the one row.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    configure(s.home, `blueprints:\n  - id: repo\n    evidence: ${join(s.root, 'ev')}\n`);
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    const rows = () => readRegistry().rows.filter((p) => nm(p.id) === 'repo');
    assert.equal(rows().length, 1, JSON.stringify(rows()));
    assert.equal(rows()[0].evidence, undefined, 'the profile row did not come along');
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.evidence.path, join(rows()[0].home, 'evidence'), 'and is not read');
    assert.ok(loc.config.ignored.some((ig) => ig.key === 'blueprints' && /registers nothing/.test(ig.why)));

    walkdown(s.home, ['records', 'move', 'drafts', '--to', join(s.root, 'drafts')], repo);
    assert.equal(rows().length, 1, JSON.stringify(rows()));
    assert.ok(rows()[0].drafts.endsWith('/drafts'));
    assert.equal(rows()[0].evidence, undefined, 'and nothing else on the row changed');
  } finally {
    s.cleanup();
  }
});

test('a pack is reached by standing in it, and its original is never listed as a copy @rule:locations.answer.one-walkdown-answers', () => {
  /*
   * q-0168 was a root entry whose spec lay inside a pack carrying its own
   * `.walkdown` - a boundary crossing written by hand into a committed
   * config. There is no such entry to write now: `import <home>` registers
   * the pack's home under the pack, whoever asks, and standing in the pack
   * is what reaches it (ADR 0003 §3). What is left of the guard is the copy
   * rule: an original is never listed as ephemeral (q-0176).
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'mono');
    const pack = join(repo, 'packs', 'gamma');
    mkdirSync(pack, { recursive: true });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], pack);
    const spec = onlyHome(join(pack, '.walkdown', 'blueprints'), 'gamma');
    const before = readFileSync(join(s.home, 'registry.yml'), 'utf8');
    // Importing the pack's home from the root registers nothing new: it is
    // already the pack's row, and nothing is written.
    assert.match(walkdown(s.home, ['blueprints', 'import', spec], repo), /already listed/);
    assert.equal(readFileSync(join(s.home, 'registry.yml'), 'utf8'), before, 'nothing written');
    assert.deepEqual(readdirSync(join(repo, '.walkdown', 'blueprints')).filter((f) => !/-mono$/.test(f)), [], 'no home minted');
    assert.match(walkdown(s.home, ['where', '--blueprint', 'reach'], repo), /no registered blueprint `reach`/);
    assert.equal(nm(JSON.parse(walkdown(s.home, ['where', '--json'], repo)).id), 'mono');
    assert.equal(nm(JSON.parse(walkdown(s.home, ['where', '--json'], pack)).id), 'gamma');
    /*
     * A copy means a copy (q-0176). --ephemeral used to accept the pack's
     * live spec, and an ephemeral entry's records follow its spec, so the
     * "throwaway copy" was the pack's own ledger under a second name.
     */
    assert.throws(
      () => walkdown(s.home, ['blueprints', 'import', spec, '--ephemeral', '--why', 'a look'], repo),
      /own blueprint.*throwaway COPY/s,
    );
    assert.ok(!readFileSync(join(s.home, 'registry.yml'), 'utf8').includes('ephemeral'));
    const copy = join(repo, '.walkdown', 'tmp', 'look');
    cpSync(spec, copy, { recursive: true });
    walkdown(s.home, ['blueprints', 'import', copy, '--ephemeral', '--why', 'a look'], repo);
    assert.ok(readFileSync(join(s.home, 'registry.yml'), 'utf8').includes('ephemeral:'));
  } finally {
    s.cleanup();
  }
});

/* ---- asking ------------------------------------------------------------- */

test('every path is reported with the decision that chose it @rule:locations.answer.says-why', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    const home = personal(s, 'demo');
    blueprint(home);
    declare(s.home, { roots: repo, spec: home, evidence: join(s.home, 'ev') });
    const loc = resolveLocations({ cwd: repo });

    for (const kind of ['spec', ...KINDS])
      assert.ok(loc[kind].why?.length > 8, `${kind} gave no reason: ${loc[kind].why}`);
    // And the reasons name WHICH decision, so a person knows what to argue with.
    assert.match(loc.spec.why, /registry/);
    assert.match(loc.runs.why, /home this machine registered/, 'the home its row names');
    assert.match(loc.threads.why, /home this machine registered/, 'the home its row names');
    assert.match(loc.evidence.why, /registry/, 'the move written on the row');
    assert.match(loc.drafts.why, /home this machine registered/, 'the home its row names');

    const said = walkdown(s.home, ['where', '--blueprint', 'demo'], repo);
    for (const kind of ['spec', ...KINDS]) assert.match(said, new RegExp(`\\b${kind}\\b`), kind);
  } finally {
    s.cleanup();
  }
});

/*
 * The command a confused person reaches for first must not be able to change
 * what they were confused about.
 */
test('asking where things live creates nothing at all @rule:locations.answer.asking-writes-nothing', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint')); // no runs, threads or drafts
    declare(s.home, { roots: repo, spec: join(repo, 'blueprint') });
    const before = tree(s.root);

    const loc = resolveLocations({ cwd: repo });
    const said = walkdown(s.home, ['where', '--blueprint', 'demo'], repo);
    walkdown(s.home, ['where', 'evidence', '--blueprint', 'demo'], repo);

    assert.match(said, new RegExp(loc.evidence.path), 'it names a directory that is not there');
    assert.ok(!existsSync(loc.evidence.path), 'and did not create it on being asked twice');
    assert.deepEqual(tree(s.root), before, 'the disk is exactly as it was found');
    // Nothing about the personal config either — the tree comparison above
    // covers the whole scratch, home included, byte for byte.
  } finally {
    s.cleanup();
  }
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
    features: [
      {
        file: 'features/demo.yml',
        data: {
          feature: 'demo',
          stories: [
            { id: 'demo.main', rules: [{ id: 'demo.main.thing', statement, verify: ['checks'] }] },
          ],
        },
      },
    ],
    threads: [],
    runs: [
      {
        file: 'runs/r-0.json',
        data: {
          created: '2026-01-01T00:00:00Z',
          kind: 'checks',
          target: 'local',
          actor: 'agent',
          run_id: 'r-0',
          git_sha: 'deadbee',
          tree_hash: 'sha256:aaaaaaaaaaaa',
          spec_hash: 'sha256:bbbbbbbbbbbb',
          results: [
            { rule: 'demo.main.thing', status: 'pass', statement_hash: formatHash(statement) },
          ],
        },
      },
    ],
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

/*
 * One home per blueprint (thread n-0124). A home used to be ALLOCATED -
 * `0001-app`, `0002-app` - because walkdown could not assume a blueprint had
 * been written down. Every blueprint is registered now (n-0133), its row
 * names its home, and a home is a folder that cannot collide with itself;
 * what tells two same-named blueprints apart is the ID the registry gives
 * each (ADR 0014 §2).
 */
test('two repositories with one basename get IDs of their own @rule:locations.registry.ids-stay-here', () => {
  const s = scratch();
  try {
    const a = join(s.root, 'one', 'app');
    const b = join(s.root, 'two', 'app');
    for (const r of [a, b]) mkdirSync(r, { recursive: true });
    // A home apiece, which is what `blueprints new` lays out; the row names
    // it and every record path derives from it.
    const homeA = blueprint(join(s.home, 'projects', 'app', 'blueprints', 'app'), { name: 'app' });
    const homeB = blueprint(join(s.home, 'projects', 'app-two', 'blueprints', 'app'), { name: 'app' });

    // A project is named after its repository, and both are called `app`: the
    // second is told the label is taken, and nothing is written until it has
    // one of its own (ADR 0014 §3).
    const first = registerRow({ checkout: a, homeDir: homeA, name: 'app' });
    assert.equal(first.action, 'written');
    assert.equal(registerRow({ checkout: b, homeDir: homeB, name: 'app' }).action, 'label-taken');
    const second = registerRow({ checkout: b, homeDir: homeB, name: 'app', project: 'app-two', code: 'a2' });
    assert.equal(second.action, 'written', 'the second was written down, not mistaken for the first');
    assert.match(first.id, /^0001-[a-z0-9]{2,3}-app$/);
    assert.equal(second.id, '0002-a2-app', 'and its ID has the next number and its own project code');

    const locA = resolveLocations({ cwd: a });
    const locB = resolveLocations({ cwd: b });
    assert.notEqual(locA.evidence.path, locB.evidence.path);
    assert.equal(locA.spec.path, homeA);
    assert.equal(locB.spec.path, homeB, 'each answers with its OWN spec');

    // Listing the same blueprint again is not a second project.
    assert.equal(registerRow({ checkout: a, homeDir: homeA, name: 'app' }).action, 'kept');
    assert.equal(readUserConfig().config.blueprints.length, 2);
  } finally {
    s.cleanup();
  }
});

/** What `walkdown init` really does, since that is where the two answers met. */
const init = (dir, home, extra = []) =>
  execFileSync(
    process.execPath,
    [new URL('../bin/walkdown.js', import.meta.url).pathname, 'blueprints', 'new', '--dir', dir, ...extra],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, WALKDOWN_HOME: home, NO_COLOR: '1' } },
  );

/*
 * The three shapes n-0141 found, each driven through the real `init` rather
 * than through the function that chooses names - because the bug was never in
 * that function. It was that the name was chosen TWICE, half a command apart,
 * and the two answers disagreed.
 */
test('two repositories with one basename never share a home or a ledger @rule:locations.registry.projects-are-labels', () => {
  const s = scratch();
  try {
    const a = join(s.root, 'one', 'app');
    const b = join(s.root, 'two', 'app');
    for (const r of [a, b]) mkdirSync(join(r, '.git'), { recursive: true });

    const first = init(a, s.home);
    assert.match(first, /\+ listed/);
    // The second asks for the label the first has, and is told so with no
    // terminal to ask; given one of its own, it is a project too.
    assert.throws(() => init(b, s.home), /label `app` is another checkout's/);
    const second = init(b, s.home, ['--project', 'app-two', '--code', 'a2']);
    assert.match(second, /\+ listed/, 'the second is a project too, and says so');

    /*
     * The question the rule asks is about the resolved answer, which is what
     * is asserted here rather than the registry's internal shape.
     *
     * One home apiece is the visible half; one LEDGER apiece is the half that
     * mattered. A note filed while standing in the first repository was
     * listed by `walkdown threads` while standing in the second, because both
     * resolved to the same spec.
     */
    const locA = resolveLocations({ cwd: a });
    const locB = resolveLocations({ cwd: b });
    assert.notEqual(locA.spec.path, locB.spec.path, 'the second did not adopt the first’s blueprint');
    for (const l of [locA, locB]) assert.ok(existsSync(join(l.spec.path, 'spec.yml')));
    for (const kind of KINDS) assert.notEqual(locA[kind].path, locB[kind].path);
  } finally {
    s.cleanup();
  }
});

test('a project keeps its spec and its records in ONE home @rule:locations.default.home-is-one-folder', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'solo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    init(repo, s.home);
    /*
     * The entry used to carry a spec under `blueprints/solo` and evidence
     * under `blueprints/solo-2`: init scaffolded the derived home, and the
     * uniqueness loop that ran afterwards saw the directory init had just
     * made and skipped past it. One decision, made first, cannot do that -
     * and the spec is the home now, so there is one folder to agree on.
     */
    const loc = resolveLocations({ cwd: repo });
    const home = loc.spec.path;
    assert.equal(dirname(loc.evidence.path), home);
    assert.equal(dirname(loc.drafts.path), home, 'spec, evidence and drafts in one home');
    assert.match(home, /projects\/solo\/blueprints\/\d{6}-solo$/, 'named for this month and the blueprint');
  } finally {
    s.cleanup();
  }
});

test('two packs in one repository each get their own home @rule:locations.answer.declared-not-discovered', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'mono');
    mkdirSync(join(repo, '.git'), { recursive: true });
    for (const pack of ['one', 'two']) mkdirSync(join(repo, 'packs', pack), { recursive: true });
    init(join(repo, 'packs', 'one'), s.home);
    init(join(repo, 'packs', 'two'), s.home);

    /*
     * Each pack is a project of its own, so each answers for itself and
     * neither sees the other's - which is the property the pack layout needs
     * and the thing a shared home could never give it.
     */
    const locs = ['one', 'two'].map((pack) =>
      resolveLocations({ cwd: join(repo, 'packs', pack) }),
    );
    assert.deepEqual(locs.map((l) => nm(l.id)).sort(), ['one', 'two']);
    for (const kind of KINDS) assert.notEqual(locs[0][kind].path, locs[1][kind].path);
  } finally {
    s.cleanup();
  }
});

/*
 * The quietest costume, and the one a config-only check cannot catch: two
 * packs adopted with --in-repo write their entries into two SEPARATE
 * committed configs, so neither claim can see the other's id. Both picked the
 * same name and the same evidence home, and one pack overwrote the other's
 * screenshots. The disk is the one thing both claims share, so claiming a
 * name means taking the directory.
 */
test('two committed packs of one name keep their records in their own trees', () => {
  /*
   * The quietest costume, and the one a config-only check could not catch:
   * two packs adopted with --in-repo wrote their entries into two SEPARATE
   * committed configs, so neither claim could see the other's id. Both
   * picked the same name and the same evidence home, and one pack
   * overwrote the other's screenshots.
   *
   * Neither derivation nor cross-config arbitration exists now: each pack's
   * home is under its OWN `.walkdown`, so distinctness is a property of the
   * path rather than of an allocator getting it right (n-0155). The second
   * pack is asked for a label of its own (ADR 0014 §3). (Untagged: the rule
   * this was filed under, one-home-per-blueprint, is retired.)
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'twins');
    mkdirSync(join(repo, '.git'), { recursive: true });
    const packs = [join(repo, 'packs', 'app'), join(repo, 'other', 'app')];
    for (const p of packs) mkdirSync(p, { recursive: true });
    init(packs[0], s.home, ['--commit', 'spec']);
    init(packs[1], s.home, ['--commit', 'spec', '--project', 'app-other', '--code', 'ao']);

    const evidence = packs.map((p) => resolveLocations({ cwd: p }).evidence.path);
    assert.notEqual(evidence[0], evidence[1], 'one pack’s evidence is not the other’s');
    for (const [i, e] of evidence.entries())
      assert.ok(e.startsWith(join(packs[i], '.walkdown') + '/'), 'and it is inside its own pack');
  } finally {
    s.cleanup();
  }
});

test('asking where records go writes nothing at all @rule:locations.answer.asking-writes-nothing', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    const home = blueprint(join(repo, '.walkdown', 'blueprints', 'demo'));
    declare(s.home, { roots: repo, spec: home });
    const before = readdirSync(s.home).sort();

    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.evidence.path, join(home, 'evidence'), 'beside the spec, in the home the row names');
    // Derived rather than allocated: the answer exists, the directory does not.
    assert.equal(existsSync(join(home, 'evidence')), false);
    assert.deepEqual(readdirSync(s.home).sort(), before, 'the home is exactly as it was');

    // And asking twice answers the same, which a guess would not.
    assert.equal(resolveLocations({ cwd: repo }).evidence.path, loc.evidence.path);
  } finally {
    s.cleanup();
  }
});

test('a legacy name-keyed home keeps answering until a person moves it @rule:locations.default.records-yml-informs', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    const old = join(s.home, 'blueprints', 'demo', 'evidence');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'shot.png'), 'x');
    /*
     * Named by the config, which is how a legacy home is reached now. It used
     * to be FOUND, by deriving `projects/<id>` from a name - and a derived
     * path is exactly what two blueprints can both derive (n-0150, n-0153).
     * `walkdown where --fix` is what writes an old address down; once written,
     * an existing ledger keeps answering and no resolver moves it.
     */
    declare(s.home, { roots: repo, spec: join(repo, 'blueprint'), evidence: old });
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.evidence.path, old);
    assert.match(loc.evidence.why, /registry/);
  } finally {
    s.cleanup();
  }
});

/*
 * n-0131: the code row printed one fixed reason - "the git repository the
 * spec sits in" - even when the spec sat in no repository at all, which is
 * the DEFAULT shape for a new project. The row now says which situation it
 * is actually in.
 */
test('the code row says which repository actually answered @rule:locations.answer.says-why', () => {
  const s = scratch();
  try {
    // Spec inside a repository, declared with roots: the entry named the
    // code, and the report says that rather than implying it was discovered.
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    blueprint(join(repo, 'blueprint'));
    declare(s.home, { roots: repo, spec: join(repo, 'blueprint') });
    const inTree = resolveLocations({ cwd: repo });
    assert.equal(inTree.code.path, repo);
    assert.match(inTree.code.why, /registry/);

    // A row that names a home but no project still gets a truthful answer,
    // from the repository the spec itself sits in.
    declare(s.home, { spec: join(repo, 'blueprint') });
    const bySpec = resolveLocations({ spec: join(repo, 'blueprint') });
    assert.equal(bySpec.code.path, repo);
    assert.match(bySpec.code.why, /the spec sits in/);

    // The default shape for a fresh project: a repo, no spec anywhere yet.
    const bare = join(s.root, 'bare');
    mkdirSync(join(bare, '.git'), { recursive: true });
    const fresh = resolveLocations({ cwd: bare });
    assert.equal(fresh.code.path, bare, 'code still answers from the working directory');
    assert.match(fresh.code.why, /working directory/, 'and names that decision');
    assert.match(fresh.code.why, /outside any repository/, 'instead of a claim the screen contradicts');

    /*
     * A configured spec outside any repository lands on the same directory,
     * but for a better reason: the entry's `roots` NAMED it. Saying "the
     * working directory's repository" there was true by accident - it would
     * have said the same thing standing anywhere else with a repo in it.
     */
    const spec2 = join(s.root, 'elsewhere', 'blueprint');
    blueprint(spec2, { name: 'demo2' });
    declare(s.home, { id: 'demo2', roots: bare, spec: spec2 });
    const outside = resolveLocations({ cwd: bare });
    assert.equal(outside.code.path, bare);
    assert.match(outside.code.why, /registry/);
    assert.match(outside.code.why, /which checkout the blueprint belongs to/);
  } finally {
    s.cleanup();
  }
});

/*
 * `codeRoot` is a different question from `code`, and the difference is the
 * last resort. Issue #7: with the spec outside the repository, dirname(spec)
 * became the walkdown home and `walkdown run` shelled out where there was no
 * suite. Falling back to the cwd's repository would fix that by guessing -
 * and would run a project's tests inside whatever checkout you were standing
 * in. This is the chain that refuses to guess.
 */
test('the code root is named or inferred from the spec, never guessed from the working directory @rule:locations.answer.says-why', () => {
  const s = scratch();
  try {
    // Named by the entry: true from anywhere, not just from inside the repo.
    const repo = join(s.root, 'work');
    mkdirSync(join(repo, '.git'), { recursive: true });
    const away = join(s.root, 'away', 'blueprint');
    blueprint(away, { name: 'named' });
    declare(s.home, { id: 'named', roots: repo, spec: away });
    assert.equal(resolveLocations({ cwd: repo }).codeRoot, repo, 'the row says where the code is');
    assert.equal(
      resolveLocations({ spec: away }).codeRoot,
      repo,
      'and still says so when the blueprint is named outright from elsewhere',
    );

    /*
     * An entry with no `roots:`, its spec outside any repository: the spec's
     * own home, NOT the repository the caller happens to be standing in.
     *
     * This case used to be spelled "no entry at all" - a blueprint reached by
     * path - which is the door that closed when every blueprint had to be
     * declared. What it was really pinning survives: the code root comes from
     * the spec, never from where you are standing.
     */
    const s2 = scratch();
    try {
      const looseHome = join(s2.root, 'loose', 'loose');
      const loose = blueprint(looseHome, { name: 'loose' });
      declare(s2.home, { id: 'loose', spec: loose });
      const standing = join(s2.root, 'unrelated');
      mkdirSync(join(standing, '.git'), { recursive: true });
      const loc = resolveLocations({ spec: loose, cwd: standing });
      assert.equal(loc.codeRoot, looseHome);
      assert.notEqual(loc.codeRoot, standing, 'never the checkout you happen to be in');
    } finally {
      s2.cleanup();
    }
  } finally {
    s.cleanup();
  }
});

/*
 * And the same mistake in the shape n-0141 did not reach: init run TWICE in
 * one repository, in init's default out-of-tree shape.
 *
 * The claim's already-listed test was by spec, and out of the tree the spec
 * lives inside the home - so it does not exist to be matched on when the home
 * is chosen, the test could never fire, and the uniqueness loop then bumped
 * past the existing home BECAUSE that directory was there, which is the first
 * run's claim doing exactly its job. Two entries with the same roots, and the
 * second blueprint read by nothing while init told the person to fill it in.
 */
test('blueprints new twice in one repository keeps the home it already made @rule:locations.several.new-makes-another', () => {
  const s = scratch();
  try {
    const root = join(s.root, 'app');
    mkdirSync(join(root, '.git'), { recursive: true });
    init(root, s.home);
    const first = readUserConfig().config.blueprints;
    init(root, s.home);
    init(root, s.home);

    const after = readUserConfig().config.blueprints;
    assert.equal(after.length, 1, 'one blueprint, however many times it is set up');
    assert.deepEqual(after[0].spec, first[0].spec, 'and the same blueprint, not a fresh one');
    assert.equal(after[0].id, first[0].id, 'under the same ID');
    const homes = readdirSync(join(s.home, 'projects', 'app', 'blueprints'));
    assert.equal(homes.length, 1, `one home on disk — a second would be a blueprint nothing reads: ${homes.join(' ')}`);
    assert.match(homes[0], /^\d{6}-app$/);

    // The neighbouring behaviour the change must not cost: a DIFFERENT
    // repository of the same name gets its own, once it has a label of its
    // own, so the two cannot be the same directory whatever either is called.
    const other = join(s.root, 'elsewhere', 'app');
    mkdirSync(join(other, '.git'), { recursive: true });
    init(other, s.home, ['--project', 'app-elsewhere', '--code', 'ae']);
    assert.notEqual(
      resolveLocations({ cwd: root }).evidence.path,
      resolveLocations({ cwd: other }).evidence.path,
      'two projects, two homes',
    );
  } finally {
    s.cleanup();
  }
});

/*
 * And with the spec committed, which is a different ignore file and the same
 * layout - asserted from the outside so the two cannot drift apart again.
 */
test('blueprints new --commit spec twice keeps one row and one home too @rule:locations.several.new-makes-another', () => {
  const s = scratch();
  try {
    const root = join(s.root, 'pack');
    mkdirSync(join(root, '.git'), { recursive: true });
    init(root, s.home, ['--commit', 'spec']);
    const second = init(root, s.home, ['--commit', 'spec']);
    assert.doesNotMatch(second, /\+ (listed|created)/, second);
    assert.equal(readRegistry().rows.length, 1);
    assert.equal(readdirSync(join(root, '.walkdown', 'blueprints')).length, 1);
    assert.ok(!existsSync(join(root, '.walkdown', 'config.yml')), 'and no manifest is written beside them');
  } finally {
    s.cleanup();
  }
});

/*
 * THE LAW THIS RESTS ON (n-0150): a home is only ever reached through a row
 * the REGISTRY WROTE.
 *
 * The registry's IDs are unique on this machine. A blueprint's own
 * `project:` field and a directory's basename are not unique and never were -
 * which is exactly why the deleted registry allocated numbers in the first
 * place. Deriving a home from either put the registry's collision back on the
 * READ path, where no guard on `init` could reach it: two blueprints resolved
 * to one drafts directory, and standing in an unlisted repository answered
 * with a listed project's spec, ledger and threads.
 *
 * So an undeclared blueprint gets no home at all. Not a fallback, not a guess:
 * nothing declares it, so there is nothing to answer with.
 */
test('an undeclared blueprint never resolves to a declared one\u2019s home @rule:locations.answer.declared-not-discovered', () => {
  const s = scratch();
  try {
    const listed = join(s.root, 'one', 'app');
    mkdirSync(join(listed, '.git'), { recursive: true });
    init(listed, s.home);
    const mine = resolveLocations({ cwd: listed });

    // A second blueprint that looks exactly like the first from the outside:
    // same basename, and its walkdown.yml declares the same `project:`.
    const stray = join(s.root, 'two', 'app');
    mkdirSync(join(stray, '.git'), { recursive: true });
    blueprint(join(stray, 'blueprint'), { name: 'app' });

    // Standing in it, it is not a project - rather than being answered with
    // the listed one's paths.
    const standing = resolveLocations({ cwd: stray });
    assert.equal(standing.spec.path, null, 'no spec is invented');
    for (const kind of KINDS) assert.equal(standing[kind].path, null, `no ${kind} either`);

    /*
     * And named OUTRIGHT it is still nothing - which is the half that
     * changed. Naming the path used to make it answer for itself, with runs
     * and threads inside the blueprint; that was the door through which a
     * blueprint nobody had written down became a project, and it is closed.
     * What matters is what it never does: borrow the listed project's home.
     */
    const named = resolveLocations({ spec: join(stray, 'blueprint') });
    assert.equal(named.spec.path, null, 'a path is not a declaration');
    assert.match(named.spec.why, /nothing registered/);
    assert.match(named.spec.why, /walkdown blueprints import/, 'and it says how to register one');
    for (const kind of KINDS)
      assert.notEqual(named[kind].path, mine[kind].path, `${kind} is not the listed project's`);

    // The listed project is untouched by any of it.
    const still = resolveLocations({ cwd: listed });
    assert.equal(still.spec.path, mine.spec.path);
    assert.equal(still.drafts.path, mine.drafts.path);
  } finally {
    s.cleanup();
  }
});

/* ---- the third judging round: writers and selectors that still keyed by id (n-0171..n-0178) ---- */

/* A registry row given a machine-local key, the way a port override is
 * kept: the lines go under the row whose ID ends with `name`, wherever
 * `blueprints new` left it in the file. */
const appendToRow = (home, name, lines) => {
  const file = join(home, 'registry.yml');
  const text = readFileSync(file, 'utf8').split('\n');
  const at = text.findIndex((l) => l.trim().startsWith('- id: ') && nm(l.trim().slice(6)) === name);
  assert.ok(at >= 0, `no row for ${name}`);
  let end = at + 1;
  while (end < text.length && text[end].startsWith('    ')) end++;
  text.splice(end, 0, ...lines.replace(/\n$/, '').split('\n'));
  writeFileSync(file, text.join('\n'));
};
/* The registry rows whose IDs end with `name`. */
const rowsOf = (home, name) => parse(readFileSync(join(home, 'registry.yml'), 'utf8')).blueprints.filter((p) => nm(p.id) === name);
const rule = (spec, id = 'a.s.one') =>
  writeFileSync(
    join(spec, 'features', 'a.yml'),
    `feature: a\nstories:\n  - id: a.s\n    rules:\n      - id: ${id}\n        statement: One.\n        verify: [checks]\n`,
  );

test('leaving the repository with a port override kept writes the home back into that row @rule:locations.default.in-repo-on-request', () => {
  /*
   * n-0171: after --commit spec the personal row is reduced to {id, roots,
   * targets} - the override shape, kept on purpose - and --commit none, matching
   * by spec, could not see it, appended `beta-2` at the same root, and the
   * checkout answered with neither. Then the next init scaffolded a fresh
   * blueprint into the tree over an entry that resolved to null.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'beta');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['blueprints', 'new'], repo);
    const id = rowsOf(s.home, 'beta')[0].id;
    appendToRow(s.home, 'beta', '    targets:\n      local:\n        base_url: http://localhost:4999\n');
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    // One registry row, re-pointed at the committed home and still carrying
    // the port and its ID (ADR 0003, ADR 0014 §2).
    const moved = rowsOf(s.home, 'beta');
    assert.equal(moved.length, 1);
    assert.equal(moved[0].id, id);
    assert.ok(/\/\.walkdown\/blueprints\/\d{6}-beta$/.test(moved[0].home ?? '') && moved[0].targets, JSON.stringify(moved));
    const out = walkdown(s.home, ['blueprints', 'new', '--commit', 'none'], repo);
    assert.match(out, /→ moved/, out);
    assert.match(out, /the ID kept/, out);
    assert.doesNotMatch(out, /\+ listed/, 'not listed a second time');
    const rows = parse(readFileSync(join(s.home, 'registry.yml'), 'utf8')).blueprints;
    assert.deepEqual(rows.map((p) => p.id), [id], JSON.stringify(rows));
    assert.ok(rows[0].home?.includes('/home/projects/beta/blueprints/') && rows[0].targets?.local?.base_url === 'http://localhost:4999', 'the override survived the round trip');
    const loc = JSON.parse(walkdown(s.home, ['where', '--json'], repo));
    assert.ok(loc.spec.path.includes('/home/projects/beta/blueprints/'), loc.spec.path);
    assert.equal(loc.standard.name, 'none');
    assert.equal(loc.blueprint.targets.local.base_url, 'http://localhost:4999');
    // And back in again: no blueprint scaffolded into the tree, the home moves.
    const again = walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    assert.doesNotMatch(again, /did not land/);
    assert.ok(!existsSync(join(repo, 'spec.yml')), 'nothing scaffolded at the repository root');
    assert.ok(existsSync(join(repo, '.walkdown', 'blueprints', basename(rows[0].home), 'spec.yml')));
  } finally {
    s.cleanup();
  }
});

// Deleted 'init folds a config.yml row holding only overrides': ADR 0014 removed folding profile rows into the registry (`walkdown upgrade` moves old files once).

test('an unreadable registry stops blueprints new before anything is made or moved @rule:locations.default.in-repo-on-request', () => {
  /* n-0172: read as empty, a broken personal file made a listed project look unlisted. */
  const s = scratch();
  try {
    const repo = join(s.root, 'theta');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['blueprints', 'new'], repo);
    const home = rowsOf(s.home, 'theta')[0].home;
    // The rows live in the registry now (ADR 0003), so that is the file whose
    // breakage would make a listed project look unlisted.
    const good = readFileSync(join(s.home, 'registry.yml'), 'utf8');
    writeFileSync(join(s.home, 'registry.yml'), good.replace('blueprints:', 'blueprints:\n   - broken: [\n'));
    const r = spawnSync(process.execPath, [CLI, 'blueprints', 'new', '--commit', 'spec'], { cwd: repo, env: { ...process.env, WALKDOWN_HOME: s.home }, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /does not parse/);
    assert.ok(!existsSync(join(repo, '.walkdown')), 'no second home made in the repository');
    assert.ok(existsSync(join(home, 'spec.yml')), 'the real home is where it was');
  } finally {
    s.cleanup();
  }
});

test('a nested same-named pack gets an ID of its own, and naming either reaches that one @rule:locations.registry.ids-stay-here', () => {
  /*
   * n-0173 (1): the first same-id row whose roots contained cwd was the
   * root's. Every row has an ID of its own now (ADR 0014 §2) - the pack's
   * carries its own number and project code - so there is no first-match
   * to get wrong: the bare command answers the deepest registered project,
   * the name answers within the project you stand in, and the full ID
   * answers from anywhere.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'app');
    const pack = join(repo, 'packs', 'app');
    mkdirSync(pack, { recursive: true });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    walkdown(s.home, ['blueprints', 'new', '--project', 'app-pack', '--code', 'ap2'], pack);
    const rootId = rowsOf(s.home, 'app').find((r) => r.checkout === repo).id;
    const packId = rowsOf(s.home, 'app').find((r) => r.checkout === pack).id;
    assert.notEqual(rootId, packId);
    const bare = JSON.parse(walkdown(s.home, ['where', '--json'], pack));
    assert.equal(bare.id, packId);
    assert.ok(bare.spec.path.includes('/home/projects/app-pack/blueprints/'), bare.spec.path);
    const named = JSON.parse(walkdown(s.home, ['where', '--blueprint', 'app', '--json'], pack));
    assert.equal(named.spec.path, bare.spec.path, 'one flag away from the bare command answers the same project');
    const byId = JSON.parse(walkdown(s.home, ['where', '--blueprint', packId, '--json'], pack));
    assert.equal(byId.spec.path, bare.spec.path, 'and so does its ID');
    const root = JSON.parse(walkdown(s.home, ['where', '--blueprint', rootId, '--json'], pack));
    assert.match(root.spec.path, /\/app\/\.walkdown\/blueprints\/\d{6}-app$/, 'and the other ID is the other row');
    rule(bare.spec.path);
    walkdown(s.home, ['threads', 'new', '--blueprint', packId, '--rule', 'a.s.one', '--body', 'in the pack'], pack);
    assert.ok(existsSync(threadAt(bare.threads.path, 'n-0001')));
    assert.ok(!existsSync(threadAt(root.threads.path, 'n-0001')));
    const listed = walkdown(s.home, ['blueprints'], pack);
    assert.doesNotMatch(listed, /shadowed/);
    assert.ok(listed.includes(packId) && listed.includes(rootId), listed);
  } finally {
    s.cleanup();
  }
});

test('move at the root records on the root’s row, never on the nested pack’s @rule:locations.keeping.moving-is-a-decision', () => {
  /* n-0173 (3): rememberLocation matched by containment in either direction. */
  const s = scratch();
  try {
    const repo = join(s.root, 'app');
    const pack = join(repo, 'packs', 'app');
    mkdirSync(pack, { recursive: true });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    walkdown(s.home, ['blueprints', 'new', '--project', 'app-pack', '--code', 'ap2'], pack);
    const packEvidence = JSON.parse(walkdown(s.home, ['where', '--json'], pack)).evidence.path;
    const to = join(s.root, 'root-evidence');
    walkdown(s.home, ['records', 'move', 'evidence', '--to', to], repo);
    const rows = parse(readFileSync(join(s.home, 'registry.yml'), 'utf8')).blueprints;
    const packRow = rows.find((p) => p.checkout && canon(expand(p.checkout)) === canon(pack));
    const rootRow = rows.find((p) => p.checkout && canon(expand(p.checkout)) === canon(repo));
    // The pack's row is untouched: its evidence is still the one its home implies.
    assert.ok(packRow && packRow.evidence === undefined, JSON.stringify(rows));
    assert.ok(rootRow && rootRow.evidence === to, JSON.stringify(rows));
    assert.equal(walkdown(s.home, ['where', 'evidence'], repo).trim(), to);
    assert.equal(walkdown(s.home, ['where', 'evidence'], pack).trim(), packEvidence);
  } finally {
    s.cleanup();
  }
});

test('relocation writes into the row a move already made, and keeps what it moved and the ID @rule:locations.registry.ids-stay-here', () => {
  /* n-0173 (4) and F2: a move row got `repo-2` beside it, and the override was dropped on the way in. */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    const id = rowsOf(s.home, 'repo')[0].id;
    const mine = join(s.root, 'my-evidence');
    walkdown(s.home, ['records', 'move', 'evidence', '--to', mine], repo);
    writeFileSync(join(mine, 'shot.png'), 'x');
    walkdown(s.home, ['blueprints', 'new', '--commit', 'none'], repo);
    let rows = rowsOf(s.home, 'repo');
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0].id, id, 'un-committing changes the path on the row and keeps the ID');
    assert.ok(rows[0].home?.includes('/home/projects/repo/blueprints/'), JSON.stringify(rows));
    assert.equal(rows[0].evidence, mine, 'the moved evidence is still named');
    assert.equal(walkdown(s.home, ['where', 'evidence'], repo).trim(), mine);
    assert.ok(!existsSync(join(repo, '.walkdown')));
    assert.match(walkdown(s.home, ['where'], repo), /names this project/);
    // And the other direction keeps it too.
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    rows = rowsOf(s.home, 'repo');
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0].id, id, 'and committing again keeps it');
    assert.equal(rows[0].evidence, mine, 'a path outside the home is left alone');
    assert.equal(walkdown(s.home, ['where', 'evidence'], repo).trim(), mine);
    assert.ok(existsSync(join(mine, 'shot.png')));
  } finally {
    s.cleanup();
  }
});

test('a profile row restating a registered blueprint is set aside whole, and tracked follows the records @rule:locations.answer.declared-not-discovered', () => {
  /*
   * n-0174 was `home:` on a personal override carried past the relative
   * guard - a name read as a path. There is no per-key guard to carry
   * anything past now: a `blueprints:` row in the profile is not read at
   * all (ADR 0003 §4), whatever it restates, and the report says so.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'gamma');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    const spec = onlyHome(join(repo, '.walkdown', 'blueprints'), 'gamma');
    configure(s.home, `blueprints:\n  - id: gamma\n    roots: [${repo}]\n    spec: ${spec}\n    home: ${basename(spec)}\n`);
    const loc = JSON.parse(walkdown(s.home, ['where', '--json'], repo));
    assert.equal(loc.config.matchedIn, 'registry');
    assert.deepEqual(loc.config.ignored.map((i) => `${i.id}:${i.key}`), ['gamma:blueprints']);
    assert.equal(canon(loc.threads.path), canon(join(spec, 'threads')));
    assert.equal(loc.standard.name, 'spec', 'tracked follows where the records are');
    assert.match(walkdown(s.home, ['where'], repo), /ignores `blueprints: gamma`.*registers nothing/);
    rule(spec);
    walkdown(s.home, ['threads', 'new', '--rule', 'a.s.one', '--body', 'one ledger'], repo);
    assert.ok(existsSync(threadAt(spec, 'threads', 'n-0001')));
    assert.ok(!existsSync(join(s.home, 'projects')), 'no second ledger under ~/.walkdown');
  } finally {
    s.cleanup();
  }
});

test('a relative personal default is set aside, and a name asks about the name, not the directory @rule:locations.answer.declared-not-discovered', () => {
  /* n-0175, the two of its four doors that survive the registry. */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'alpha', 'blueprint'), { name: 'alpha' });
    blueprint(join(repo, 'gamma', 'blueprint'), { name: 'gamma' });
    const gamma = join(repo, 'gamma');
    register(s.home, [
      { id: 'alpha', roots: join(repo, 'alpha'), spec: join(repo, 'alpha', 'blueprint') },
      { id: 'gamma', roots: gamma, spec: join(gamma, 'blueprint') },
    ]);
    // (b) a relative personal default is set aside, and drafts do not depend on where you stand
    configure(s.home, 'defaults:\n  drafts: tmp/drafts-{id}\n');
    const inGamma = JSON.parse(walkdown(s.home, ['where', '--json'], gamma));
    const inSpec = JSON.parse(walkdown(s.home, ['where', '--json'], join(gamma, 'blueprint')));
    assert.deepEqual(inGamma.config.ignored.map((i) => i.key), ['defaults.drafts']);
    assert.equal(inGamma.drafts.path, inSpec.drafts.path);
    assert.doesNotMatch(inGamma.drafts.path, /tmp\/drafts/);
    // (d) asked by id, the answer is about the id, not the directory
    configure(s.home, '');
    const text = walkdown(s.home, ['where', '--blueprint', 'ghost'], join(repo, 'alpha'));
    assert.match(text, /no registered blueprint `ghost`/);
    assert.doesNotMatch(text, /no row for this project/, "the project has rows; the answer is about the name");
    assert.doesNotMatch(text, /names this project/);
  } finally {
    s.cleanup();
  }
});

test('a pack’s own blueprint named through another spelling of its path is already listed, not refused @rule:locations.answer.one-walkdown-answers', () => {
  /*
   * n-0177 and n-0178. `own` was walked from the spelling typed and compared to
   * process.cwd() as strings (/var vs /private/var on macOS), so a pack refused
   * its own blueprint as lying under itself; and from inside the checkout the
   * relative spelling was expanded against the .walkdown directory and never
   * matched, so it was listed a second time with an empty second home.
   */
  const s = scratch();
  try {
    // The scratch root is real now (the registry writes real paths), so the
    // second spelling is made on purpose: a link beside the checkout.
    mkdirSync(join(s.root, 'mono', 'packs', 'gamma'), { recursive: true });
    symlinkSync(join(s.root, 'mono'), join(s.root, 'mono-link'));
    const pack = join(s.root, 'mono-link', 'packs', 'gamma');
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], pack);
    const folder = readdirSync(join(pack, '.walkdown', 'blueprints'))[0];
    const spec = join(pack, '.walkdown', 'blueprints', folder);
    const before = readFileSync(join(s.home, 'registry.yml'), 'utf8');
    assert.notEqual(canon(spec), spec, 'the pack is reached through a symlink, which is the point');
    assert.match(walkdown(s.home, ['blueprints', 'import', spec], pack), /already listed/);
    assert.match(walkdown(s.home, ['blueprints', 'import', `.walkdown/blueprints/${folder}`], pack), /already listed/);
    assert.equal(readFileSync(join(s.home, 'registry.yml'), 'utf8'), before);
    assert.deepEqual(readdirSync(join(pack, '.walkdown', 'blueprints')), [folder]);
  } finally {
    s.cleanup();
  }
});

/* A git repository under the scratch root, with a committer configured. */
const gitRepo = (dir) => {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd: dir, encoding: 'utf8' });
};
const cli = (home, args, cwd) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, WALKDOWN_HOME: home }, encoding: 'utf8' });

test('leaving the repository after committing everything says what git now holds as deletions @rule:locations.default.in-repo-on-request', () => {
  /* n-0179: "Nothing was added" was printed over eight files git still tracked. */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    const git = gitRepo(repo);
    walkdown(s.home, ['blueprints', 'new', '--commit', 'all'], repo);
    const home = onlyHome(join(repo, '.walkdown', 'blueprints'), 'repo');
    mkdirSync(join(home, 'runs'), { recursive: true });
    writeFileSync(join(home, 'runs', 'r.json'), '{}');
    git('add', '-A');
    git('commit', '-q', '-m', 'everything');
    const tracked = git('ls-files', '.walkdown').split('\n').filter(Boolean).length;
    const out = walkdown(s.home, ['blueprints', 'new', '--commit', 'none'], repo);
    assert.match(out, new RegExp(`${tracked} file\\(s\\) git tracked under the home that left are now deletions to commit`), out);
    assert.ok(!existsSync(join(repo, '.walkdown')));
    // And git agrees: every one of them is a pending deletion, not a quiet "nothing was added".
    assert.equal(git('ls-files', '--deleted', '--', '.walkdown').split('\n').filter(Boolean).length, tracked);
  } finally {
    s.cleanup();
  }
});

test('a root .gitignore hiding .walkdown/ makes the tracked row say so, and lint refuses it @rule:locations.default.in-repo-on-request', () => {
  /* n-0180: the tree said "the spec and its threads" while git ignored all of it. */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    gitRepo(repo);
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    const home = onlyHome(join(repo, '.walkdown', 'blueprints'), 'repo');
    const rel = `.walkdown/blueprints/${basename(home)}`;
    assert.match(walkdown(s.home, ['where'], repo), /tracked\s+the spec and its threads/);
    assert.equal(cli(s.home, ['lint', '--no-checks'], repo).status, 0);

    writeFileSync(join(repo, '.gitignore'), '.walkdown/\n');
    const where = walkdown(s.home, ['where'], repo);
    assert.match(where, /tracked\s+nothing — \.gitignore:1 `\.walkdown\/` hides the spec from git/, where);
    const lint = cli(s.home, ['lint', '--no-checks'], repo);
    assert.notEqual(lint.status, 0, lint.stdout);
    assert.ok(lint.stdout.includes(`hides ${rel} from git — a clone will not get the spec`), lint.stdout);
    assert.match(lint.stdout, /\[tracking\]/);
    // blueprints new reports the same, in colour, rather than "Committed".
    const again = walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    assert.match(again, /tracked: nothing — \.gitignore:1/);
    assert.match(again, /a clone will not get the spec/);

    // An ignore file somebody emptied is a promise that keeps nothing: lint says so.
    unlinkSync(join(repo, '.gitignore'));
    writeFileSync(join(home, '.gitignore'), '# nothing\n');
    const empty = cli(s.home, ['lint', '--no-checks'], repo);
    assert.notEqual(empty.status, 0, empty.stdout);
    assert.ok(empty.stdout.includes(`${rel}/.gitignore is present and keeps nothing out — git will commit runs, evidence and drafts`), empty.stdout);
    assert.match(walkdown(s.home, ['where'], repo), /tracked\s+everything/);
  } finally {
    s.cleanup();
  }
});

test('the ignore file beside a .walkdown does not answer for a blueprint standing elsewhere in the tree @rule:locations.default.in-repo-on-request', () => {
  /* n-0181: the tracked row quoted rules that never reached the blueprint's own records. */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    gitRepo(repo);
    walkdown(s.home, ['blueprints', 'new', '--commit', 'spec'], repo);
    const pack = join(repo, 'packs', 'x');
    const spec = join(pack, 'blueprint');
    mkdirSync(join(spec, 'runs'), { recursive: true });
    writeFileSync(join(spec, 'spec.yml'), 'blueprint: x\n');
    writeFileSync(join(spec, 'runs', 'r.json'), '{}');
    // Registered with its records inside the blueprint, the legacy shape.
    declare(s.home, {
      id: 'x',
      roots: pack,
      spec,
      runs: join(spec, 'runs'),
      threads: join(spec, 'threads'),
      evidence: join(spec, 'evidence'),
      drafts: join(spec, 'drafts'),
    });
    const where = walkdown(s.home, ['where'], pack);
    assert.match(where, /tracked\s+everything/, where);
    assert.match(where, /no rule keeps any of it out/);
    // The home sits under no `.walkdown`, so the repository's ignore file is
    // not its promise and lint has nothing to hold it to: git's answer is
    // the whole story, and it is "everything".
    assert.match(where, /the home sits under no `\.walkdown`/, where);
    const lint = cli(s.home, ['lint', '--no-checks'], pack);
    assert.equal(lint.status, 0, lint.stdout);
    assert.doesNotMatch(lint.stdout, /does not reach this home/);
  } finally {
    s.cleanup();
  }
});


test('a config.yml from before the profile makes an upgrade due, and nothing is filed past it @rule:locations.keeping.upgrade-moves-once', () => {
  /*
   * GitHub issue #18: the config.yml an earlier walkdown wrote - a
   * `projects:` list with the checkout's targets on it, and per-kind
   * defaults spelled for the layout before numbered homes - was left
   * standing by `init`, and nine questions went to a directory the home's
   * own readers never looked in.
   *
   * That file used to be folded in, line by line, by whichever command met
   * it first. ADR 0014 moves old layouts once, on purpose: a `config.yml`
   * in the personal home is an upgrade due, every command that loads a
   * blueprint says so and stops, and nothing is changed until a person runs
   * `walkdown upgrade` (upgrade-moves-once replaces old-config-never-misfiles).
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'hireart_main');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['blueprints', 'new'], repo);
    const old = join(s.home, 'blueprints');
    const legacy = [
      'defaults:',
      `  runs: ${old}/{id}/blueprint/runs`,
      `  threads: ${old}/{id}/blueprint/threads`,
      'projects:',
      '  - id: hireart',
      `    roots: [${repo}]`,
      `    spec: ${old}/0001-hireart/blueprint`,
      '    targets:',
      '      local: { base_url: http://localhost:3000 }',
      '',
    ].join('\n');
    writeFileSync(join(s.home, 'config.yml'), legacy);
    const before = tree(s.root);

    const r = cli(s.home, ['status'], repo);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /An upgrade is due/);
    assert.match(r.stderr, /config\.yml becomes profile\.yml/);
    assert.match(r.stderr, /`walkdown upgrade`/, 'and it names the command that moves it');
    assert.match(r.stderr, /Nothing was changed/);
    assert.deepEqual(tree(s.root), before, 'and nothing was');
    assert.equal(readFileSync(join(s.home, 'config.yml'), 'utf8'), legacy);
    assert.ok(!existsSync(old), 'no record was filed where the old defaults pointed');

    // And `where` - a question, not a load - still answers, and says the same.
    const at = resolveLocations({ cwd: repo });
    assert.ok(at.upgrade.some((d) => /profile\.yml/.test(d)), JSON.stringify(at.upgrade));
    assert.equal(at.threads.path, join(at.homeDir, 'threads'), 'threads stay in the home');
  } finally {
    s.cleanup();
  }
});
