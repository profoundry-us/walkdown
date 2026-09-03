import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { parse } from '../vendor/yaml.js';
import { formatHash, specFiles, specHash } from '../lib/hash.js';
import { canon, expand, KINDS, readUserConfig, rememberProject, resolveLocations } from '../lib/locations.js';
import { deriveStatus } from '../lib/status.js';

/*
 * Every case builds its own tree and points WALKDOWN_HOME at a scratch
 * directory, so nothing here can read - or write - the machine's real config.
 */
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'wd-loc-'));
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

function blueprint(at, { project = 'demo', dirs = [] } = {}) {
  mkdirSync(join(at, 'features'), { recursive: true });
  writeFileSync(join(at, 'walkdown.yml'), `project: ${project}\n`);
  writeFileSync(join(at, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(join(at, 'features', 'a.yml'), 'feature: a\nstories: []\n');
  for (const d of dirs) mkdirSync(join(at, d), { recursive: true });
  return at;
}

/*
 * Declare a blueprint the way every project now must: walkdown stopped
 * walking the tree for `walkdown.yml`, so a blueprint nobody wrote down is
 * not a project (n-0133). Most of these tests used to lean on that walk.
 */
/*
 * `home` is the numbered directory inside the declaring `.walkdown`, not a
 * path - the entry carries the NAME and the resolver reads it against the
 * file that declared it, which is what makes two projects' records distinct
 * without either config having to know about the other (n-0155).
 */
const declare = (home, { id = 'demo', roots, spec, at = `0001-${id}`, ...rest }) =>
  configure(
    home,
    ['projects:', `  - id: ${id}`, `    roots: [${roots}]`, `    spec: ${spec}`,
     ...(at ? [`    home: ${at}`] : []),
     ...Object.entries(rest).map(([k, v]) => `    ${k}: ${v}`), ''].join('\n'),
  );

const configure = (home, yaml) => writeFileSync(join(home, 'config.yml'), yaml);

/*
  * This test used to be called "with no config, a blueprint in the tree wins".
  * It does not any more, and that reversal is the whole of n-0133: a
  * blueprint nobody declared is not a project, and the records of one that
  * IS declared still stay where they already are.
  */
test('a declared blueprint answers, and its existing records stay put', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { dirs: ['runs', 'threads'] });
    declare(s.home, { roots: repo, spec: join(repo, 'blueprint') });
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.id, 'demo');
    assert.equal(loc.spec.path, join(repo, 'blueprint'));
    assert.equal(loc.runs.path, join(repo, 'blueprint', 'runs'));
    assert.match(loc.runs.why, /already in the blueprint/);

    // And an undeclared one is nothing at all, however much it looks like a
    // project from the outside.
    const stray = join(s.root, 'stray');
    blueprint(join(stray, 'blueprint'), { project: 'stray' });
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
test('a home holds the spec and its four records as siblings @rule:locations.default.records-follow-the-spec', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    const home = join(s.home, 'blueprints', '0001-demo');
    const bp = blueprint(join(home, 'blueprint')); // no subdirectories at all
    declare(s.home, { roots: repo, spec: bp });
    const loc = resolveLocations({ cwd: repo });
    /*
     * One layout. Runs and threads used to sit INSIDE the spec directory and
     * evidence beside it, so a config had two shapes to say and a reader two
     * to learn; now the five are siblings and a home moves as one directory.
     */
    for (const kind of KINDS) assert.equal(loc[kind].path, join(home, kind), kind);
    assert.equal(dirname(loc.spec.path), home);
    assert.match(loc.threads.why, /walkdown/, 'the home its entry names');
    assert.match(loc.evidence.why, /\.walkdown/, 'in the blueprint’s own home');
  } finally {
    s.cleanup();
  }
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
  } finally {
    s.cleanup();
  }
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
    configure(
      s.home,
      `defaults:\n  runs: ${join(s.home, 'elsewhere', '{id}')}\nprojects:\n  - id: demo\n    roots: [${repo}]\n    spec: ${join(repo, 'blueprint')}\n`,
    );
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.runs.path, join(repo, 'blueprint', 'runs'));
    assert.match(loc.runs.why, /already in the blueprint \(1 file\)/);
  } finally {
    s.cleanup();
  }
});

test('a project entry outranks the tree, and {id} expands in defaults', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { dirs: ['runs'] });
    const away = join(s.root, 'away', 'blueprint');
    blueprint(away, { project: 'away-spec' });
    configure(
      s.home,
      [
        'defaults:',
        `  evidence: ${join(s.home, 'ev', '{id}')}`,
        'projects:',
        '  - id: pinned',
        `    roots: [${repo}]`,
        `    spec: ${away}`,
        '',
      ].join('\n'),
    );
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.id, 'pinned');
    assert.equal(loc.spec.path, away);
    assert.match(loc.spec.why, /this machine's config/);
    // Runs follow the spec wherever the config put it...
    assert.equal(loc.runs.path, join(away, 'runs'));
    // ...and evidence does not, taking the configured default with {id}
    // resolved to the entry's id rather than the blueprint's own name.
    assert.equal(loc.evidence.path, join(s.home, 'ev', 'pinned'));
  } finally {
    s.cleanup();
  }
});

/*
 * `--project <id>` replaced `--dir <path>`, and the difference is the point.
 * A path named on the command line reached a blueprint that no config knew
 * about - so it had no entry, so its home had to be derived from a name, and
 * that derivation is the ancestor of every collision this file tests for
 * (n-0156). An id can only name something already written down.
 */
test('--project selects a declared blueprint, and an unknown id is nothing at all', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    const other = blueprint(join(s.root, 'other'), { project: 'other' });
    configure(
      s.home,
      [
        'projects:',
        '  - id: pinned',
        `    roots: [${repo}]`,
        `    spec: ${join(repo, 'blueprint')}`,
        '    home: 0001-pinned',
        '  - id: other',
        `    spec: ${other}`,
        '    home: 0002-other',
        '',
      ].join('\n'),
    );
    const loc = resolveLocations({ cwd: repo, project: 'other' });
    assert.equal(loc.spec.path, other);
    assert.match(loc.spec.why, /config \(other\)/);

    // And a path is not a way in any more, however much it looks like one.
    const nobody = resolveLocations({ cwd: repo, project: other });
    assert.equal(nobody.spec.path, null);
    assert.match(nobody.spec.why, /no project/);
  } finally {
    s.cleanup();
  }
});

/*
 * `--dir` scopes the whole answer, not just the spec. The entry matching where
 * you are STANDING describes a different project, and letting it keep applying
 * reported one project's spec beside another's ledger.
 */
test('--project does not inherit the ledger of whichever project you are standing in @rule:locations.answer.declared-not-discovered', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { project: 'mine', dirs: ['runs'] });
    const other = blueprint(join(s.root, 'other'), { project: 'theirs', dirs: ['runs'] });
    configure(
      s.home,
      [
        'projects:',
        '  - id: mine',
        `    roots: [${repo}]`,
        `    spec: ${join(repo, 'blueprint')}`,
        `    runs: ${join(s.home, 'mine-runs')}`,
        '  - id: theirs',
        `    spec: ${other}`,
        '    home: 0002-theirs',
        '',
      ].join('\n'),
    );

    const standing = resolveLocations({ cwd: repo });
    assert.equal(
      standing.runs.path,
      join(s.home, 'mine-runs'),
      'the entry applies where it matches',
    );

    const named = resolveLocations({ cwd: repo, project: 'theirs' });
    assert.equal(named.id, 'theirs');
    assert.equal(named.spec.path, other);
    assert.equal(
      named.runs.path,
      join(other, 'runs'),
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
    blueprint(join(repo, 'blueprint'), { project: 'outer' });
    const inner = blueprint(join(repo, 'example', 'blueprint'), {
      project: 'inner',
      dirs: ['runs'],
    });
    configure(
      s.home,
      [
        'projects:',
        '  - id: outer',
        `    roots: [${repo}]`,
        `    spec: ${join(repo, 'blueprint')}`,
        '  - id: inner',
        `    roots: [${join(repo, 'example')}]`,
        `    spec: ${inner}`,
        '',
      ].join('\n'),
    );

    const outside = resolveLocations({ cwd: repo });
    assert.equal(outside.id, 'outer', 'at the root, the outer entry answers');

    const within = resolveLocations({ cwd: join(repo, 'example') });
    assert.equal(within.id, 'inner', 'the more specific entry answers inside it');
    assert.equal(within.spec.path, inner);
    assert.equal(within.runs.path, join(inner, 'runs'), "and never the outer project's ledger");

    /*
     * And a third pack nobody wrote down does not quietly become a project.
     * It sits inside the outer entry's roots, so the outer entry answers for
     * it - where the old tree walk would have found its `walkdown.yml` and
     * handed it a project of its own that no one had declared.
     */
    const undeclared = join(repo, 'ghost');
    blueprint(join(undeclared, 'blueprint'), { project: 'ghost' });
    const ghost = resolveLocations({ cwd: undeclared });
    assert.equal(ghost.id, 'outer', 'claimed by the entry whose roots contain it');
    assert.notEqual(ghost.spec.path, join(undeclared, 'blueprint'));
  } finally {
    s.cleanup();
  }
});

test('a more specific entry beats a broader one', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { project: 'outer' });
    const inner = blueprint(join(repo, 'sub', 'blueprint'), { project: 'inner' });
    configure(
      s.home,
      [
        'projects:',
        `  - id: outer\n    roots: [${repo}]\n    spec: ${join(repo, 'blueprint')}`,
        `  - id: pinned-inner\n    roots: [${join(repo, 'sub')}]\n    spec: ${inner}` +
          `\n    evidence: ${join(s.home, 'inner-ev')}`,
        '',
      ].join('\n'),
    );
    const loc = resolveLocations({ cwd: join(repo, 'sub') });
    assert.equal(loc.id, 'pinned-inner');
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
    const away = blueprint(join(s.home, 'projects', 'away', 'blueprint'), { project: 'away' });
    configure(s.home, `projects:\n  - id: away\n    roots: [${repo}]\n    spec: ${away}\n`);
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
    configure(s.home, 'projects: [oops\n');
    const loc = resolveLocations({ cwd: repo });
    assert.ok(loc.config.error, 'the parse failure is carried, not swallowed');
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
    const said = walkdown(s.home, ['init', '--dir', repo]);

    /*
     * "Without altering the repository" means without altering it: no
     * `.walkdown/`, no pointer. The pointer was the one file default `init`
     * put in front of git, carrying an absolute path that was wrong on every
     * other machine (n-0161).
     */
    assert.deepEqual(tree(repo), before, 'the tree is exactly as it was found');
    assert.ok(existsSync(join(s.skills, 'walkdown-judge', 'SKILL.md')), 'the skills went to the person');

    // Everything walkdown made is in the person's own home, in one numbered
    // directory, laid out as every home is.
    const loc = resolveLocations({ cwd: repo });
    const home = join(s.home, 'blueprints', '0001-repo');
    assert.equal(loc.spec.path, join(home, 'blueprint'));
    for (const kind of KINDS) assert.equal(loc[kind].path, join(home, kind), kind);
    assert.equal(loc.standard.name, 'none');
    assert.match(said, /git never sees/);
    assert.match(said, /walkdown pointer --into/, 'and says how to get a pointer if you want one');

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
    const said = walkdown(s.home, ['init', '--dir', repo, '--commit', 'spec']);

    const loc = () => resolveLocations({ cwd: repo });
    const home = join(repo, '.walkdown', 'blueprints', '0001-repo');
    assert.equal(loc().spec.path, join(home, 'blueprint'));
    for (const kind of KINDS) assert.equal(loc()[kind].path, join(home, kind), kind);

    const ignore = join(repo, '.walkdown', '.gitignore');
    const rules = () =>
      readFileSync(ignore, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    assert.deepEqual(rules(), ['blueprints/*/runs/', 'blueprints/*/evidence/', 'blueprints/*/drafts/']);
    assert.equal(loc().standard.name, 'spec');
    assert.match(said, /Committed: the spec and its threads/);
    assert.match(said, /delete it to commit everything/, 'and how to change its mind');
    assert.match(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), /in `\.walkdown\/blueprints\/0001-repo\/blueprint\/`/, 'the pointer is relative');

    // A record, so the round trip below can be seen to carry it.
    mkdirSync(join(home, 'runs'), { recursive: true });
    writeFileSync(join(home, 'runs', 'r.json'), '{"kind":"walkdown","results":[]}\n');

    // spec -> all: the file goes away, and the command says so.
    const all = walkdown(s.home, ['init', '--dir', repo, '--commit', 'all']);
    assert.equal(existsSync(ignore), false, 'no .gitignore is what "all" IS');
    assert.equal(loc().standard.name, 'all');
    assert.match(all, /- removed/);
    assert.match(all, /in full/);

    // all -> spec: written back.
    walkdown(s.home, ['init', '--dir', repo, '--commit', 'spec']);
    assert.equal(loc().standard.name, 'spec');
    assert.ok(existsSync(join(home, 'runs', 'r.json')), 'nothing moved for a file to change');

    // spec -> none: the home leaves the repository whole, and so does the pointer.
    const out = walkdown(s.home, ['init', '--dir', repo, '--commit', 'none']);
    assert.match(out, /→ moved/);
    assert.equal(existsSync(join(repo, '.walkdown')), false, 'the repository has nothing of walkdown\'s');
    assert.equal(existsSync(join(repo, 'CLAUDE.md')), false, 'not even the pointer walkdown made');
    const personal = join(s.home, 'blueprints', '0001-repo');
    assert.equal(loc().spec.path, join(personal, 'blueprint'));
    assert.ok(existsSync(join(personal, 'runs', 'r.json')), 'the record came along, unedited');
    assert.equal(loc().standard.name, 'none');
    assert.equal(parse(readFileSync(join(s.home, 'config.yml'), 'utf8')).projects.length, 1, 'one entry, rewritten');

    // none -> spec: back in, numbered against the repository's own listing.
    walkdown(s.home, ['init', '--dir', repo, '--commit', 'spec']);
    assert.equal(loc().spec.path, join(home, 'blueprint'));
    assert.ok(existsSync(join(home, 'runs', 'r.json')));
    assert.equal(existsSync(personal), false, 'and not left behind');
    assert.equal(loc().standard.name, 'spec');
    assert.equal(
      (parse(readFileSync(join(s.home, 'config.yml'), 'utf8')).projects ?? []).length,
      0,
      'the personal config no longer declares what the repository does',
    );
  } finally {
    s.cleanup();
  }
});

/*
 * A committed spec's .gitignore is itself committable, and so is the config
 * beside it: the standard is a file a clone receives. A bare `*` could not be
 * (q-0162).
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
    walkdown(s.home, ['init', '--dir', repo, '--commit', 'spec']);
    const home = join(repo, '.walkdown', 'blueprints', '0001-repo');
    for (const kind of ['runs', 'evidence', 'drafts']) {
      mkdirSync(join(home, kind), { recursive: true });
      writeFileSync(join(home, kind, 'x'), 'x');
    }
    mkdirSync(join(home, 'threads'), { recursive: true });
    writeFileSync(join(home, 'threads', 'n-0001.yml'), 'id: n-0001\n');
    if (!git) return;
    const staged = execFileSync('git', ['add', '-A', '--dry-run'], { cwd: repo, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(/^add '|'$/g, ''));
    const under = (p) => staged.filter((f) => f.startsWith(p));
    assert.ok(staged.includes('.walkdown/.gitignore'), staged.join('\n'));
    assert.ok(staged.includes('.walkdown/config.yml'));
    assert.ok(under('.walkdown/blueprints/0001-repo/blueprint/').length);
    assert.ok(under('.walkdown/blueprints/0001-repo/threads/').length);
    for (const kind of ['runs', 'evidence', 'drafts'])
      assert.deepEqual(under(`.walkdown/blueprints/0001-repo/${kind}/`), [], `${kind} stays out`);
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
    walkdown(s.home, ['init', '--commit', 'all'], repo);
    const home = join(repo, '.walkdown', 'blueprints', '0001-repo');
    mkdirSync(join(home, 'runs', 'evidence', 'x'), { recursive: true });
    writeFileSync(join(home, 'runs', 'r.json'), '{}');
    writeFileSync(join(home, 'runs', 'evidence', 'x', 'shot.png'), 'png');
    git('add', '-A');
    git('commit', '-q', '-m', 'everything');
    const out = walkdown(s.home, ['init', '--commit', 'spec'], repo);
    assert.match(out, /still tracked: 2 file\(s\)/, out);
    assert.match(out, /git rm --cached/);
    assert.match(out, /runs\/r\.json/);
    // Nothing new under those directories is staged, but the two stay in the index.
    assert.ok(git('ls-files').includes('.walkdown/blueprints/0001-repo/runs/r.json'));

    assert.ok(existsSync(join(repo, '.claude', 'skills', 'walkdown-judge', 'SKILL.md')), 'skills went with the spec');
    writeFileSync(join(repo, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'mine now\n');
    const left = walkdown(s.home, ['init', '--commit', 'none'], repo);
    assert.ok(!existsSync(join(repo, '.claude', 'skills', 'walkdown-sitting')), 'an unedited skill leaves with the spec');
    assert.equal(readFileSync(join(repo, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'utf8'), 'mine now\n');
    assert.match(left, /kept \(edited.*walkdown-judge/, left);
    assert.ok(!existsSync(join(repo, '.walkdown')));
    const personal = readFileSync(join(s.home, 'config.yml'), 'utf8');
    assert.match(personal, /^projects:\n  - /m, personal);
    assert.doesNotMatch(personal, /\[\s*\{/, 'block style, not flow');
  } finally {
    s.cleanup();
  }
});

test('a relative path in the personal file is set aside and named, never resolved where you stand @rule:locations.answer.declared-not-discovered', () => {
  /*
   * n-0167: personal entries were resolved against the working directory,
   * so the committed entry copied verbatim into the personal file (the most
   * literal way to restate every key) denied the project from inside it, and
   * a personal `roots: [.]` claimed whatever directory you stood in - alpha's
   * board from inside gamma. A relative path has no base in ~/.walkdown; it
   * is set aside, the report says so, and the repository's row is read from
   * the repository's own file.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.walkdown'), { recursive: true });
    blueprint(join(repo, 'alpha', 'blueprint'), { project: 'alpha' });
    blueprint(join(repo, 'gamma', 'blueprint'), { project: 'gamma' });
    writeFileSync(
      join(repo, '.walkdown', 'config.yml'),
      'projects:\n  - id: alpha\n    roots: [alpha]\n    spec: alpha/blueprint\n  - id: gamma\n    roots: [gamma]\n    spec: gamma/blueprint\n',
    );
    const gamma = join(repo, 'gamma');
    configure(s.home, 'projects:\n  - id: gamma\n    roots: [gamma]\n    spec: gamma/blueprint\n');
    const j = JSON.parse(walkdown(s.home, ['where', '--json'], gamma));
    assert.equal(j.id, 'gamma');
    assert.equal(j.config.matchedIn, 'both');
    assert.equal(j.config.repo.matched, true);
    assert.ok(j.spec.path.endsWith('/repo/gamma/blueprint'), j.spec.path);
    assert.deepEqual(
      j.config.ignored.map((i) => `${i.id}:${i.key}=${i.value}`),
      ['gamma:roots=gamma', 'gamma:spec=gamma/blueprint'],
    );
    const text = walkdown(s.home, ['where'], gamma);
    assert.match(text, /ignores `roots: gamma` in entry `gamma`/);
    assert.match(text, /names this project too/);

    configure(s.home, `projects:\n  - id: alpha\n    roots: [.]\n    spec: ${join(repo, 'alpha', 'blueprint')}\n`);
    assert.equal(JSON.parse(walkdown(s.home, ['where', '--json'], gamma)).id, 'gamma');
    const ghost = join(repo, 'ghost');
    mkdirSync(ghost);
    assert.throws(() => walkdown(s.home, ['status'], ghost), 'a dot root claims nothing');
    // The repository's row is its own file's answer even when nothing is selected.
    const g = JSON.parse(walkdown(s.home, ['where', '--json'], ghost));
    assert.equal(g.config.repo.matched, false);
  } finally {
    s.cleanup();
  }
});

test('project add writes the entry the way init does: relative in the repository, records in the home @rule:locations.default.records-follow-the-spec', () => {
  /*
   * n-0169: from inside a pack, `project add` wrote absolute paths into the
   * committed config - wrong on every other machine - and sent runs and
   * threads to the blueprint's parent while naming a home nothing wrote to.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    blueprint(join(repo, 'second', 'blueprint'), { project: 'second' });
    const out = walkdown(s.home, ['project', 'add', 'second/blueprint', '--id', 'two'], repo);
    assert.match(out, /listed/);
    const cfg = parse(readFileSync(join(repo, '.walkdown', 'config.yml'), 'utf8'));
    const two = cfg.projects.find((p) => p.id === 'two');
    assert.deepEqual(two.roots, ['second']);
    assert.equal(two.spec, 'second/blueprint');
    assert.equal(two.home, '0002-two');
    for (const k of ['runs', 'threads', 'evidence', 'drafts'])
      assert.equal(two[k], `.walkdown/blueprints/0002-two/${k}`, k);
    for (const v of Object.values(two)) assert.ok(!String(v).startsWith('/'), `${v} is not absolute`);
    const loc = JSON.parse(walkdown(s.home, ['where', '--json'], join(repo, 'second')));
    assert.equal(loc.id, 'two');
    assert.ok(loc.threads.path.endsWith('/.walkdown/blueprints/0002-two/threads'), loc.threads.path);

    // A legacy blueprint keeping threads inside itself says so.
    blueprint(join(repo, 'old', 'blueprint'), { project: 'old', dirs: ['threads'] });
    walkdown(s.home, ['project', 'add', 'old/blueprint', '--id', 'old'], repo);
    const old = parse(readFileSync(join(repo, '.walkdown', 'config.yml'), 'utf8')).projects.find((p) => p.id === 'old');
    assert.equal(old.threads, 'old/blueprint/threads');
    assert.equal(old.runs, '.walkdown/blueprints/0003-old/runs');

    // A blueprint whose own checkout already declares it is refused from outside (q-0168).
    assert.throws(() => walkdown(s.home, ['project', 'add', join(repo, 'second', 'blueprint')], s.root), /lies under/);
    assert.ok(!existsSync(join(s.home, 'config.yml')) || !readFileSync(join(s.home, 'config.yml'), 'utf8').includes('second'));
    assert.ok(!existsSync(join(s.home, 'blueprints', '0001-second')));
    // Outside the repository, a committed entry is refused, not written wrong.
    const elsewhere = blueprint(join(s.root, 'elsewhere', 'blueprint'), { project: 'else' });
    assert.throws(() => walkdown(s.home, ['project', 'add', elsewhere], repo), /outside/);
    assert.ok(!existsSync(join(repo, '.walkdown', 'blueprints', '0004-else')));
    // Personally, it is spelled in full and has no root.
    walkdown(s.home, ['project', 'add', elsewhere, '--ephemeral', '--why', 'a copy'], repo);
    const mine = parse(readFileSync(join(s.home, 'config.yml'), 'utf8')).projects.find((p) => p.id === 'elsewhere');
    assert.ok(mine, 'listed personally');
    assert.equal(mine.roots, undefined);
    assert.equal(mine.ephemeral, true);
    assert.ok(mine.spec.startsWith('/') || mine.spec.startsWith('~'), mine.spec);
  } finally {
    s.cleanup();
  }
});

test('a nested directory sharing the name is its own project, never a merge into the root’s @rule:locations.default.one-home-per-blueprint', () => {
  /*
   * n-0170 (1): the merge joined a personal row to a committed row when they
   * shared an id and the personal root lay ANYWHERE inside the repository.
   * mono/app committed its spec; mono/app/packs/app got a plain init; the
   * personal `app` merged over the committed `app`, and the root's own
   * records were stranded. Same id, different root: two projects.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'app');
    const pack = join(repo, 'packs', 'app');
    mkdirSync(pack, { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    walkdown(s.home, ['init'], pack);
    const top = JSON.parse(walkdown(s.home, ['where', '--json'], repo));
    assert.equal(top.id, 'app');
    assert.ok(top.spec.path.endsWith('/app/.walkdown/blueprints/0001-app/blueprint'), top.spec.path);
    assert.equal(top.config.matchedIn, 'repo');
    const inner = JSON.parse(walkdown(s.home, ['where', '--json'], pack));
    assert.ok(inner.spec.path.includes('/home/blueprints/'), inner.spec.path);
    assert.notEqual(inner.spec.path, top.spec.path);
    // Both answer from the root's `.walkdown`, so a thread filed at the top lands at the top.
    writeFileSync(
      join(repo, '.walkdown', 'blueprints', '0001-app', 'blueprint', 'features', 'a.yml'),
      'feature: a\nstories:\n  - id: a.s\n    rules:\n      - id: a.s.one\n        statement: One.\n        verify: [checks]\n',
    );
    walkdown(s.home, ['thread', 'new', '--rule', 'a.s.one', '--body', 'at the top'], repo);
    assert.ok(existsSync(join(repo, '.walkdown', 'blueprints', '0001-app', 'threads', 'n-0001.yml')));
    assert.ok(!existsSync(join(inner.threads.path, 'n-0001.yml')));
  } finally {
    s.cleanup();
  }
});

test('a number the config still names is never minted again @rule:locations.default.one-home-per-blueprint', () => {
  /*
   * n-0170 (2): abandoning a default project is deleting its home. The next
   * same-named repository was handed the same number, the stale entry
   * matched it by spec path, and the abandoned checkout answered with a
   * blueprint it never claimed.
   */
  const s = scratch();
  try {
    const one = join(s.root, 'a', 'app');
    const two = join(s.root, 'b', 'app');
    mkdirSync(one, { recursive: true });
    mkdirSync(two, { recursive: true });
    walkdown(s.home, ['init'], one);
    rmSync(join(s.home, 'blueprints', '0001-app'), { recursive: true });
    const out = walkdown(s.home, ['init'], two);
    assert.match(out, /0002-app/, out);
    assert.match(out, /listed/, out);
    const second = JSON.parse(walkdown(s.home, ['where', '--json'], two));
    assert.ok(second.spec.path.endsWith('/0002-app/blueprint'), second.spec.path);
    const first = JSON.parse(walkdown(s.home, ['where', '--json'], one));
    assert.ok(first.spec.path.endsWith('/0001-app/blueprint'), first.spec.path);
    assert.ok(!existsSync(first.spec.path), 'the abandoned checkout answers with its own gone home, not with the new one');
    assert.throws(() => walkdown(s.home, ['status'], one));
  } finally {
    s.cleanup();
  }
});

test('move writes into a pure-override row rather than beside it @rule:locations.keeping.moving-is-a-decision', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    configure(s.home, `projects:\n  - id: repo\n    evidence: ${join(s.root, 'ev')}\n`);
    walkdown(s.home, ['move', 'drafts', '--to', join(s.root, 'drafts')], repo);
    const rows = parse(readFileSync(join(s.home, 'config.yml'), 'utf8')).projects.filter((p) => p.id === 'repo');
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.ok(rows[0].drafts.endsWith('/drafts'));
    assert.ok(rows[0].evidence.endsWith('/ev'));
  } finally {
    s.cleanup();
  }
});

test('a committed entry never reaches under another .walkdown @rule:locations.answer.one-walkdown-answers', () => {
  /*
   * q-0168: a root entry whose spec lies inside a pack that carries its own
   * `.walkdown` is the boundary crossing the rule forbids, written by hand.
   * The pack's `.walkdown` answers for it; from the root it is refused, and
   * only --ephemeral may name it from outside.
   */
  const s = scratch();
  try {
    const repo = join(s.root, 'mono');
    const pack = join(repo, 'packs', 'gamma');
    mkdirSync(pack, { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    walkdown(s.home, ['init', '--commit', 'spec'], pack);
    const spec = join(pack, '.walkdown', 'blueprints', '0001-gamma', 'blueprint');
    const before = readFileSync(join(repo, '.walkdown', 'config.yml'), 'utf8');
    assert.throws(() => walkdown(s.home, ['project', 'add', spec, '--id', 'reach'], repo), /lies under/);
    assert.equal(readFileSync(join(repo, '.walkdown', 'config.yml'), 'utf8'), before, 'nothing written');
    assert.ok(!existsSync(join(repo, '.walkdown', 'blueprints', '0002-reach')), 'no home minted');
    // The same shape written by hand is a lint error naming both files.
    writeFileSync(
      join(repo, '.walkdown', 'config.yml'),
      before + `  - id: reach\n    roots: [packs/gamma]\n    spec: packs/gamma/.walkdown/blueprints/0001-gamma/blueprint\n`,
    );
    let out = '';
    try {
      execFileSync(process.execPath, [CLI, 'lint'], {
        cwd: repo,
        env: { ...process.env, WALKDOWN_HOME: s.home, NO_COLOR: '1' },
        encoding: 'utf8',
      });
      assert.fail('lint exits non-zero on an error');
    } catch (e) {
      out = String(e.stdout ?? '');
    }
    assert.match(out, /reach/, out);
    assert.match(out, /packs\/gamma\/\.walkdown/, out);
    assert.match(out, /error/, out);
    // And while it stands it is not READ either: not a project here, not
    // served, not listed - the report names it and says why (q-0176).
    const where = walkdown(s.home, ['where'], repo);
    assert.match(where, /refuses `reach`/, where);
    assert.match(where, /packs\/gamma\/\.walkdown/, where);
    assert.doesNotMatch(walkdown(s.home, ['projects'], repo), /reach/);
    assert.match(walkdown(s.home, ['where', '--project', 'reach'], repo), /no project `reach`/);
    /*
     * A copy means a copy (q-0176). --ephemeral used to accept the pack's
     * live spec, and an ephemeral entry's records follow its spec, so the
     * "throwaway copy" was the pack's own ledger under a second name.
     */
    assert.throws(
      () => walkdown(s.home, ['project', 'add', spec, '--ephemeral', '--why', 'a look'], repo),
      /own blueprint.*throwaway COPY/s,
    );
    assert.ok(!existsSync(join(s.home, 'config.yml')) || !readFileSync(join(s.home, 'config.yml'), 'utf8').includes('ephemeral'));
    const copy = join(repo, '.walkdown', 'tmp', 'look', 'blueprint');
    cpSync(spec, copy, { recursive: true });
    walkdown(s.home, ['project', 'add', copy, '--ephemeral', '--why', 'a look'], repo);
    assert.ok(readFileSync(join(s.home, 'config.yml'), 'utf8').includes('ephemeral: true'));
  } finally {
    s.cleanup();
  }
});

/* ---- asking ------------------------------------------------------------- */

test('every path is reported with the decision that chose it @rule:locations.answer.says-why', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { dirs: ['runs'] });
    configure(
      s.home,
      `projects:\n  - id: demo\n    roots: [${repo}]\n    spec: ${join(repo, 'blueprint')}\n    home: 0001-demo\n    evidence: ${join(s.home, 'ev')}\n`,
    );
    const loc = resolveLocations({ cwd: repo });

    for (const kind of ['spec', ...KINDS])
      assert.ok(loc[kind].why?.length > 8, `${kind} gave no reason: ${loc[kind].why}`);
    // And the reasons name WHICH decision, so a person knows what to argue with.
    assert.match(loc.spec.why, /config/);
    assert.match(loc.runs.why, /already in the blueprint/);
    assert.match(loc.threads.why, /walkdown/, 'the home its entry names');
    assert.match(loc.evidence.why, /config/);
    assert.match(loc.drafts.why, /walkdown/, 'the home its entry names');

    const said = walkdown(s.home, ['where', '--project', 'demo'], repo);
    for (const kind of ['spec', ...KINDS]) assert.match(said, new RegExp(`\\b${kind}\\b`), kind);
    assert.match(said, /already in the blueprint/);
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
    const said = walkdown(s.home, ['where', '--project', 'demo'], repo);
    walkdown(s.home, ['where', 'evidence', '--project', 'demo'], repo);

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
 * One home per blueprint (thread n-0124), now settled by the config entry
 * rather than by a registry. A home used to be ALLOCATED - a second file
 * handing out `0001-app`, `0002-app` - because walkdown could not assume a
 * blueprint had been written down. Every blueprint is declared now (n-0133),
 * so the entry carries its own home and the only question left is whether
 * writing an entry can ever hand two blueprints the same one.
 */
test('two repositories with one basename get homes of their own @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const a = join(s.root, 'one', 'app');
    const b = join(s.root, 'two', 'app');
    blueprint(join(a, 'blueprint'), { project: 'app' });
    blueprint(join(b, 'blueprint'), { project: 'app' });

    // `init` names a project after its repository, and both are called `app`.
    const first = rememberProject({ id: 'app', root: a, spec: join(a, 'blueprint') });
    const second = rememberProject({ id: 'app', root: b, spec: join(b, 'blueprint') });
    assert.equal(first.action, 'written');
    assert.equal(second.action, 'written', 'the second was written down, not mistaken for the first');
    assert.equal(first.id, 'app');
    assert.equal(
      second.id,
      'app-2',
      'and it took the next name free — two entries in ONE config still need two ids',
    );

    const locA = resolveLocations({ cwd: a });
    const locB = resolveLocations({ cwd: b });
    assert.notEqual(locA.evidence.path, locB.evidence.path);
    assert.equal(locA.spec.path, join(a, 'blueprint'));
    assert.equal(locB.spec.path, join(b, 'blueprint'), 'each answers with its OWN spec');

    // Listing the same blueprint again is not a second project.
    assert.equal(
      rememberProject({ id: 'app', root: a, spec: join(a, 'blueprint') }).action,
      'kept',
    );
    assert.equal(readUserConfig({ cwd: a }).config.projects.length, 2);
  } finally {
    s.cleanup();
  }
});

/** What `walkdown init` really does, since that is where the two answers met. */
const init = (dir, home, extra = []) =>
  execFileSync(
    process.execPath,
    [new URL('../bin/walkdown.js', import.meta.url).pathname, 'init', '--dir', dir, ...extra],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, WALKDOWN_HOME: home, NO_COLOR: '1' } },
  );

/*
 * The three shapes n-0141 found, each driven through the real `init` rather
 * than through the function that chooses names - because the bug was never in
 * that function. It was that the name was chosen TWICE, half a command apart,
 * and the two answers disagreed.
 */
test('two repositories with one basename never share a home or a ledger @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const a = join(s.root, 'one', 'app');
    const b = join(s.root, 'two', 'app');
    for (const r of [a, b]) mkdirSync(join(r, '.git'), { recursive: true });

    const first = init(a, s.home);
    const second = init(b, s.home);
    assert.match(first, /\+ listed/);
    assert.match(second, /\+ listed/, 'the second is a project too, and says so');

    /*
     * Each repository declares its own project in its own `.walkdown`, so
     * "two entries" is now two FILES rather than two rows in one - and the
     * question the rule asks is about the resolved answer, which is what is
     * asserted here rather than the config's internal shape.
     *
     * One home apiece is the visible half; one LEDGER apiece is the half that
     * mattered. A note filed while standing in the first repository was
     * listed by `walkdown threads` while standing in the second, because both
     * resolved to the same spec.
     */
    const locA = resolveLocations({ cwd: a });
    const locB = resolveLocations({ cwd: b });
    assert.notEqual(locA.spec.path, locB.spec.path, 'the second did not adopt the first’s blueprint');
    for (const l of [locA, locB]) assert.ok(existsSync(join(l.spec.path, 'walkdown.yml')));
    for (const kind of KINDS) assert.notEqual(locA[kind].path, locB[kind].path);
  } finally {
    s.cleanup();
  }
});

test('a project keeps its spec and its records in ONE home @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'solo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    init(repo, s.home);
    /*
     * The entry used to carry a spec under `blueprints/solo` and evidence
     * under `blueprints/solo-2`: init scaffolded the derived home, and the
     * uniqueness loop that ran afterwards saw the directory init had just
     * made and skipped past it. One decision, made first, cannot do that.
     */
    const loc = resolveLocations({ cwd: repo });
    const home = dirname(loc.spec.path);
    assert.equal(dirname(loc.evidence.path), home);
    assert.equal(dirname(loc.drafts.path), home, 'spec, evidence and drafts in one home');
    assert.match(home, /blueprints\/\d{4}-solo$/, 'and it is numbered');
  } finally {
    s.cleanup();
  }
});

test('two packs in one repository each get their own home @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'mono');
    mkdirSync(join(repo, '.git'), { recursive: true });
    for (const pack of ['one', 'two']) mkdirSync(join(repo, 'packs', pack), { recursive: true });
    init(join(repo, 'packs', 'one'), s.home);
    init(join(repo, 'packs', 'two'), s.home);

    /*
     * Each pack carries its own `.walkdown`, so each answers for itself and
     * neither sees the other's - which is the property the pack layout needs
     * and the thing a shared home could never give it
     * (locations.answer.one-walkdown-answers).
     */
    const locs = ['one', 'two'].map((pack) =>
      resolveLocations({ cwd: join(repo, 'packs', pack) }),
    );
    assert.deepEqual(locs.map((l) => l.id).sort(), ['one', 'two']);
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
test('a home claimed from a config the next one cannot see is still taken @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'twins');
    mkdirSync(join(repo, '.git'), { recursive: true });
    const packs = [join(repo, 'packs', 'app'), join(repo, 'other', 'app')];
    for (const p of packs) mkdirSync(p, { recursive: true });
    for (const p of packs) init(p, s.home, ['--commit', 'spec']);

    /*
     * This case used to need a claim visible ACROSS configs, because two
     * packs wrote into two committed configs that could not see each other
     * and both derived the same name-keyed home. Neither derivation nor
     * cross-config arbitration exists now: each pack's records are under its
     * OWN `.walkdown`, so distinctness is a property of the path rather than
     * of an allocator getting it right (n-0155).
     */
    const evidence = packs.map((p) => resolveLocations({ cwd: p }).evidence.path);
    assert.notEqual(evidence[0], evidence[1], 'one pack’s evidence is not the other’s');
    for (const [i, e] of evidence.entries())
      assert.ok(e.startsWith(join(packs[i], '.walkdown') + '/'), 'and it is inside its own pack');
  } finally {
    s.cleanup();
  }
});

test('asking where records go writes nothing at all @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    declare(s.home, { roots: repo, spec: join(repo, 'blueprint') });
    const before = readdirSync(s.home).sort();

    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.evidence.path, join(s.home, 'blueprints', '0001-demo', 'evidence'));
    // Derived rather than allocated: the answer exists, the directory does not.
    assert.equal(existsSync(join(s.home, 'blueprints')), false);
    assert.deepEqual(readdirSync(s.home).sort(), before, 'the home is exactly as it was');

    // And asking twice answers the same, which a guess would not.
    assert.equal(resolveLocations({ cwd: repo }).evidence.path, loc.evidence.path);
  } finally {
    s.cleanup();
  }
});

test('a legacy name-keyed home keeps answering until a person moves it @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    const old = join(s.home, 'projects', 'demo', 'evidence');
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
    assert.match(loc.evidence.why, /config/);
  } finally {
    s.cleanup();
  }
});

/*
 * And what `walkdown where --fix` does about that. It was `walkdown migrate`,
 * and before that it RENAMED - allocate a number, move the records into it,
 * re-point the config - which is the one thing the rule says a tool may not do
 * on its own. There is nothing to allocate any more, so the whole job is the
 * sentence: the config learns where the records already are, and the disk is
 * left alone.
 */
test('--fix writes down where the records already are, and moves nothing @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    const bp = blueprint(join(repo, 'blueprint'));
    const old = join(s.home, 'projects', 'demo', 'evidence');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'shot.png'), 'x');
    mkdirSync(join(s.home, 'projects', 'orphan'), { recursive: true });
    declare(s.home, { roots: repo, spec: bp });

    const out = execFileSync(
      process.execPath,
      [new URL('../bin/walkdown.js', import.meta.url).pathname, 'where', '--fix'],
      { cwd: s.root, encoding: 'utf8', env: { ...process.env, WALKDOWN_HOME: s.home, NO_COLOR: '1' } },
    );
    assert.match(out, /nothing moved/);
    assert.ok(existsSync(join(old, 'shot.png')), 'the records are where they were');

    const cfg = readUserConfig({ cwd: s.root }).config;
    assert.equal(cfg.projects[0].evidence, old, 'and the config now says so outright');
    assert.equal(resolveLocations({ cwd: repo }).evidence.path, old);

    // The home nobody claimed is reported and left standing, never guessed at.
    assert.match(out, /no config entry claims it/);
    assert.ok(existsSync(join(s.home, 'projects', 'orphan')));
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
    assert.match(inTree.code.why, /config \(demo\)/);

    // An entry that names a spec but no roots still gets a truthful answer,
    // from the repository the spec itself sits in.
    configure(s.home, `projects:\n  - id: demo\n    spec: ${join(repo, 'blueprint')}\n`);
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
    blueprint(spec2, { project: 'demo2' });
    configure(s.home, `projects:\n  - id: demo2\n    roots: [${bare}]\n    spec: ${spec2}\n`);
    const outside = resolveLocations({ cwd: bare });
    assert.equal(outside.code.path, bare);
    assert.match(outside.code.why, /config \(demo2\)/);
    assert.match(outside.code.why, /where the code is/);
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
    blueprint(away, { project: 'named' });
    configure(s.home, `projects:\n  - id: named\n    roots: [${repo}]\n    spec: ${away}\n`);
    assert.equal(resolveLocations({ cwd: repo }).codeRoot, repo, 'the entry says where the code is');
    assert.equal(
      resolveLocations({ spec: away }).codeRoot,
      repo,
      'and still says so when the blueprint is named outright from elsewhere',
    );

    // No entry, spec outside any repository: the spec's own parent, NOT the
    // repository the caller happens to be standing in.
    const s2 = scratch();
    try {
      const loose = join(s2.root, 'loose', 'blueprint');
      blueprint(loose, { project: 'loose' });
      const standing = join(s2.root, 'unrelated');
      mkdirSync(join(standing, '.git'), { recursive: true });
      const loc = resolveLocations({ spec: loose, cwd: standing });
      assert.equal(loc.codeRoot, join(s2.root, 'loose'));
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
test('init twice in one repository keeps the home it already claimed @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const root = join(s.root, 'app');
    mkdirSync(join(root, '.git'), { recursive: true });
    init(root, s.home);
    const first = readUserConfig({ cwd: root }).config.projects;
    init(root, s.home);
    init(root, s.home);

    const after = readUserConfig({ cwd: root }).config.projects;
    assert.equal(after.length, 1, 'one project, however many times it is set up');
    assert.deepEqual(after[0].spec, first[0].spec, 'and the same blueprint, not a fresh one');
    assert.deepEqual(
      readdirSync(join(s.home, 'blueprints')).sort(),
      ['0001-app'],
      'one home on disk — a second would be a blueprint nothing reads',
    );

    // The neighbouring behaviour the change must not cost: a DIFFERENT
    // repository of the same name gets its own — the next number in the same
    // listing, so the two cannot be the same directory whatever either is
    // called.
    const other = join(s.root, 'elsewhere', 'app');
    mkdirSync(join(other, '.git'), { recursive: true });
    init(other, s.home);
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
test('init --commit spec twice keeps one entry too @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const root = join(s.root, 'pack');
    mkdirSync(join(root, '.git'), { recursive: true });
    init(root, s.home, ['--commit', 'spec']);
    init(root, s.home, ['--commit', 'spec']);
    const listed = parse(readFileSync(join(root, '.walkdown', 'config.yml'), 'utf8')).projects;
    assert.equal(listed.length, 1);
  } finally {
    s.cleanup();
  }
});

/*
 * THE LAW THIS RULE RESTS ON (n-0150): a home is only ever keyed by an id the
 * CONFIG ALLOCATED.
 *
 * `claimHome` hands those out and makes them unique. A blueprint's own
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
test('an undeclared blueprint never resolves to a declared one\u2019s home @rule:locations.default.one-home-per-blueprint', () => {
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
    blueprint(join(stray, 'blueprint'), { project: 'app' });

    // Standing in it, it is not a project - rather than being answered with
    // the listed one's paths.
    const standing = resolveLocations({ cwd: stray });
    assert.equal(standing.spec.path, null, 'no spec is invented');
    for (const kind of KINDS) assert.equal(standing[kind].path, null, `no ${kind} either`);

    // And named outright, it answers for ITSELF: runs and threads beside the
    // spec as always, and evidence and drafts beside it too, because the path
    // was named and so cannot collide with anybody else's.
    const named = resolveLocations({ spec: join(stray, 'blueprint') });
    assert.equal(named.spec.path, join(stray, 'blueprint'));
    for (const kind of KINDS) {
      assert.ok(
        named[kind].path.startsWith(join(stray, 'blueprint')),
        `${kind} stays inside the blueprint that was named, not in a shared home`,
      );
      assert.notEqual(named[kind].path, mine[kind].path, `${kind} is not the listed project's`);
    }

    // The listed project is untouched by any of it.
    const still = resolveLocations({ cwd: listed });
    assert.equal(still.spec.path, mine.spec.path);
    assert.equal(still.drafts.path, mine.drafts.path);
  } finally {
    s.cleanup();
  }
});

/*
 * `walkdown migrate` is the old spelling and still works. The name promised a
 * great deal more than it did from the day it stopped renaming directories -
 * folding four addresses into a config is `where` finishing its own sentence,
 * not a migration - but it is a published command name and somebody's notes
 * still say to run it, so it says where it went rather than answering old
 * advice with a usage error.
 */
test('the old migrate spelling still works and says where it went', () => {
  const s = scratch();
  try {
    configure(s.home, 'projects: []\n');
    const out = execFileSync(
      process.execPath,
      [new URL('../bin/walkdown.js', import.meta.url).pathname, 'migrate'],
      { cwd: s.root, encoding: 'utf8', env: { ...process.env, WALKDOWN_HOME: s.home, NO_COLOR: '1' } },
    );
    assert.match(out, /walkdown where --fix/);
  } finally {
    s.cleanup();
  }
});

/*
 * The orphan clause, probed the hard way (n-0129, second judging): a legacy
 * home no config entry claims stays put even when it happens to CONTAIN a
 * spec - contents are not a claim, and the old migrate moved two such homes
 * on the strength of theirs.
 */
test('--fix never moves an unclaimed home, spec inside or not @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    // An orphan that self-describes: full blueprint inside, no config entry.
    blueprint(join(s.home, 'projects', 'orphanapp', 'blueprint'), { project: 'orphanapp' });
    configure(s.home, 'projects: []\n');
    const out = execFileSync(
      process.execPath,
      [new URL('../bin/walkdown.js', import.meta.url).pathname, 'where', '--fix'],
      { cwd: s.root, encoding: 'utf8', env: { ...process.env, WALKDOWN_HOME: s.home, NO_COLOR: '1' } },
    );
    assert.match(out, /no config entry claims it/);
    assert.ok(existsSync(join(s.home, 'projects', 'orphanapp')), 'left standing');
    assert.equal(
      existsSync(join(s.home, 'blueprints')),
      false,
      'and nothing was allocated on its behalf',
    );
  } finally {
    s.cleanup();
  }
});

/* ---- the third judging round: writers and selectors that still keyed by id (n-0171..n-0178) ---- */

/* A personal row edited by hand, the way a person adds a port override: the
 * lines go under the row for `id`, wherever init left it in the file. */
const appendToRow = (home, id, lines) => {
  const file = join(home, 'config.yml');
  const text = readFileSync(file, 'utf8').split('\n');
  const at = text.findIndex((l) => l.trim() === `- id: ${id}`);
  assert.ok(at >= 0, `no row for ${id}`);
  let end = at + 1;
  while (end < text.length && text[end].startsWith('    ')) end++;
  text.splice(end, 0, ...lines.replace(/\n$/, '').split('\n'));
  writeFileSync(file, text.join('\n'));
};
const rowsOf = (home, id) => parse(readFileSync(join(home, 'config.yml'), 'utf8')).projects.filter((p) => p.id === id);
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
    walkdown(s.home, ['init'], repo);
    appendToRow(s.home, 'beta', '    targets:\n      local:\n        base_url: http://localhost:4999\n');
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    const reduced = rowsOf(s.home, 'beta');
    assert.equal(reduced.length, 1);
    assert.ok(!reduced[0].spec && reduced[0].targets, JSON.stringify(reduced));
    const out = walkdown(s.home, ['init', '--commit', 'none'], repo);
    assert.match(out, /listed .* as `beta`/, out);
    assert.doesNotMatch(out, /beta-2/);
    const rows = parse(readFileSync(join(s.home, 'config.yml'), 'utf8')).projects;
    assert.deepEqual(rows.map((p) => p.id), ['beta'], JSON.stringify(rows));
    assert.ok(rows[0].spec && rows[0].targets?.local?.base_url === 'http://localhost:4999', 'the override survived the round trip');
    const loc = JSON.parse(walkdown(s.home, ['where', '--json'], repo));
    assert.ok(loc.spec.path.includes('/home/blueprints/'), loc.spec.path);
    assert.equal(loc.standard.name, 'none');
    assert.equal(loc.project.targets.local.base_url, 'http://localhost:4999');
    // And back in again: no blueprint scaffolded into the tree, the home moves.
    const again = walkdown(s.home, ['init', '--commit', 'spec'], repo);
    assert.doesNotMatch(again, /did not land/);
    assert.ok(!existsSync(join(repo, 'blueprint')), 'nothing scaffolded at <repo>/blueprint');
    assert.ok(existsSync(join(repo, '.walkdown', 'blueprints', '0001-beta', 'blueprint', 'walkdown.yml')));
  } finally {
    s.cleanup();
  }
});

test('init refuses an entry that resolves to no spec instead of scaffolding into the tree @rule:locations.default.in-repo-on-request', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    configure(s.home, `projects:\n  - id: repo\n    roots: [${repo}]\n    targets: { local: { base_url: http://localhost:4998 } }\n`);
    const before = readFileSync(join(s.home, 'config.yml'), 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'init'], { cwd: repo, env: { ...process.env, WALKDOWN_HOME: s.home }, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /names no spec and no home/);
    assert.ok(!existsSync(join(repo, 'blueprint')));
    assert.ok(!existsSync(join(repo, '.walkdown')));
    assert.equal(readFileSync(join(s.home, 'config.yml'), 'utf8'), before, 'the config was not touched');
    assert.ok(!existsSync(join(s.home, 'blueprints')) || readdirSync(join(s.home, 'blueprints')).length === 0, 'no home claimed');
  } finally {
    s.cleanup();
  }
});

test('an unreadable personal config stops init before anything is claimed or moved @rule:locations.default.in-repo-on-request', () => {
  /* n-0172: read as empty, a broken personal file made a listed project look unlisted. */
  const s = scratch();
  try {
    const repo = join(s.root, 'theta');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['init'], repo);
    const good = readFileSync(join(s.home, 'config.yml'), 'utf8');
    writeFileSync(join(s.home, 'config.yml'), good.replace('projects:', 'projects:\n   - broken: [\n'));
    const r = spawnSync(process.execPath, [CLI, 'init', '--commit', 'spec'], { cwd: repo, env: { ...process.env, WALKDOWN_HOME: s.home }, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /does not parse/);
    assert.ok(!existsSync(join(repo, '.walkdown')), 'no second home minted in the repository');
    assert.ok(existsSync(join(s.home, 'blueprints', '0001-theta', 'blueprint', 'walkdown.yml')), 'the real home is where it was');
  } finally {
    s.cleanup();
  }
});

test('--project from inside a nested same-named pack answers the pack, and projects does not call it shadowed @rule:locations.default.one-home-per-blueprint', () => {
  /* n-0173 (1): the first same-id row whose roots contained cwd was the root's. */
  const s = scratch();
  try {
    const repo = join(s.root, 'app');
    const pack = join(repo, 'packs', 'app');
    mkdirSync(pack, { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    walkdown(s.home, ['init'], pack);
    const bare = JSON.parse(walkdown(s.home, ['where', '--json'], pack));
    const named = JSON.parse(walkdown(s.home, ['where', '--project', 'app', '--json'], pack));
    assert.equal(named.spec.path, bare.spec.path, 'one flag away from the bare command answers the same project');
    assert.ok(named.spec.path.includes('/home/blueprints/'), named.spec.path);
    rule(bare.spec.path);
    walkdown(s.home, ['thread', 'new', '--project', 'app', '--rule', 'a.s.one', '--body', 'in the pack'], pack);
    assert.ok(existsSync(join(bare.threads.path, 'n-0001.yml')));
    assert.ok(!existsSync(join(repo, '.walkdown', 'blueprints', '0001-app', 'threads', 'n-0001.yml')));
    assert.doesNotMatch(walkdown(s.home, ['projects'], pack), /shadowed/);
    assert.match(walkdown(s.home, ['projects'], repo), /shadowed here by this repository's: app/);
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
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    walkdown(s.home, ['init'], pack);
    const packEvidence = JSON.parse(walkdown(s.home, ['where', '--json'], pack)).evidence.path;
    const to = join(s.root, 'root-evidence');
    walkdown(s.home, ['move', 'evidence', '--to', to], repo);
    const rows = rowsOf(s.home, 'app');
    const packRow = rows.find((p) => [p.roots].flat().some((r) => canon(expand(r)) === canon(pack)));
    const rootRow = rows.find((p) => [p.roots].flat().some((r) => canon(expand(r)) === canon(repo)));
    assert.ok(packRow && canon(expand(packRow.evidence)) === canon(packEvidence), JSON.stringify(rows));
    assert.ok(rootRow && rootRow.evidence === to, JSON.stringify(rows));
    assert.equal(walkdown(s.home, ['where', 'evidence'], repo).trim(), to);
    assert.equal(walkdown(s.home, ['where', 'evidence'], pack).trim(), packEvidence);
  } finally {
    s.cleanup();
  }
});

test('relocation writes into the personal row a move already made, and keeps what it moved @rule:locations.default.one-home-per-blueprint', () => {
  /* n-0173 (4) and F2: a move row got `repo-2` beside it, and the override was dropped on the way in. */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    const mine = join(s.root, 'my-evidence');
    walkdown(s.home, ['move', 'evidence', '--to', mine], repo);
    writeFileSync(join(mine, 'shot.png'), 'x');
    walkdown(s.home, ['init', '--commit', 'none'], repo);
    let rows = rowsOf(s.home, 'repo');
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.ok(rows[0].spec?.includes('/home/blueprints/'), JSON.stringify(rows));
    assert.equal(rows[0].evidence, mine, 'the moved evidence is still named');
    assert.equal(walkdown(s.home, ['where', 'evidence'], repo).trim(), mine);
    assert.ok(!existsSync(join(repo, 'blueprint')));
    assert.match(walkdown(s.home, ['where'], repo), /names this project/);
    // And the other direction keeps it too.
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    rows = rowsOf(s.home, 'repo');
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0].evidence, mine, 'dropPaths leaves a path outside the home alone');
    assert.equal(walkdown(s.home, ['where', 'evidence'], repo).trim(), mine);
    assert.ok(existsSync(join(mine, 'shot.png')));
  } finally {
    s.cleanup();
  }
});

test('a personal home: on an override of a committed entry is set aside, and tracked follows the records @rule:locations.answer.declared-not-discovered', () => {
  /* n-0174: `home:` is a name, not a path, and a verbatim copy carried it past the relative guard. */
  const s = scratch();
  try {
    const repo = join(s.root, 'gamma');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], repo);
    const spec = join(repo, '.walkdown', 'blueprints', '0001-gamma', 'blueprint');
    configure(s.home, `projects:\n  - id: gamma\n    roots: [${repo}]\n    spec: ${spec}\n    home: 0001-gamma\n`);
    const loc = JSON.parse(walkdown(s.home, ['where', '--json'], repo));
    assert.equal(loc.config.matchedIn, 'both');
    assert.deepEqual(loc.config.ignored.map((i) => `${i.id}:${i.key}`), ['gamma:home']);
    assert.equal(canon(loc.threads.path), canon(join(repo, '.walkdown', 'blueprints', '0001-gamma', 'threads')));
    assert.equal(loc.standard.name, 'spec', 'tracked follows where the records are');
    assert.match(walkdown(s.home, ['where'], repo), /ignores `home: 0001-gamma`/);
    rule(spec);
    walkdown(s.home, ['thread', 'new', '--rule', 'a.s.one', '--body', 'one ledger'], repo);
    assert.ok(existsSync(join(repo, '.walkdown', 'blueprints', '0001-gamma', 'threads', 'n-0001.yml')));
    assert.ok(!existsSync(join(s.home, 'blueprints', '0001-gamma')), 'no second ledger under ~/.walkdown');
  } finally {
    s.cleanup();
  }
});

test('the repository’s row is read from the committed file, defaults and stray roots are set aside, and --project names the id @rule:locations.answer.declared-not-discovered', () => {
  /* n-0175, four smaller doors of the same family. */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.walkdown'), { recursive: true });
    blueprint(join(repo, 'alpha', 'blueprint'), { project: 'alpha' });
    blueprint(join(repo, 'gamma', 'blueprint'), { project: 'gamma' });
    mkdirSync(join(repo, 'gamma2'));
    writeFileSync(
      join(repo, '.walkdown', 'config.yml'),
      'projects:\n  - id: alpha\n    roots: [alpha]\n    spec: alpha/blueprint\n  - id: gamma\n    roots: [gamma, gamma2]\n    spec: gamma/blueprint\n',
    );
    const gamma = join(repo, 'gamma');
    // (a) a personal override narrowing roots must not make the committed row deny its own entry
    configure(s.home, `projects:\n  - id: gamma\n    roots: [${gamma}]\n`);
    const fromTwo = JSON.parse(walkdown(s.home, ['where', '--json'], join(repo, 'gamma2')));
    assert.equal(fromTwo.config.repo.matched, true, 'the committed file plainly roots gamma there');
    // (b) a relative personal default is set aside, and drafts do not depend on where you stand
    configure(s.home, 'defaults:\n  drafts: tmp/drafts-{id}\n');
    const inGamma = JSON.parse(walkdown(s.home, ['where', '--json'], gamma));
    const inSpec = JSON.parse(walkdown(s.home, ['where', '--json'], join(gamma, 'blueprint')));
    assert.deepEqual(inGamma.config.ignored.map((i) => i.key), ['defaults.drafts']);
    assert.equal(inGamma.drafts.path, inSpec.drafts.path);
    assert.doesNotMatch(inGamma.drafts.path, /tmp\/drafts/);
    // (c) a blank root and a `~name` are not paths, and claim nothing
    const ghost = join(repo, 'ghost');
    mkdirSync(ghost);
    configure(s.home, `projects:\n  - id: alpha\n    roots: ['  ', '~alpha']\n    spec: ${join(repo, 'alpha', 'blueprint')}\n`);
    const fromGhost = JSON.parse(walkdown(s.home, ['where', '--json'], ghost));
    assert.equal(fromGhost.spec.path, null, JSON.stringify(fromGhost.spec));
    assert.deepEqual(fromGhost.config.ignored.map((i) => `${i.key}=${i.value.trim()}`), ['roots=', 'roots=~alpha']);
    assert.match(walkdown(s.home, ['where'], ghost), /is blank, not a path/);
    // (d) asked by id, the repository row is about the id, not the directory
    configure(s.home, '');
    const text = walkdown(s.home, ['where', '--project', 'ghost'], join(repo, 'alpha'));
    assert.match(text, /no project `ghost`/);
    assert.match(text, /no entry for this project/);
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
    const pack = join(s.root, 'mono', 'packs', 'gamma');
    mkdirSync(pack, { recursive: true });
    walkdown(s.home, ['init', '--commit', 'spec'], pack);
    const spec = join(pack, '.walkdown', 'blueprints', '0001-gamma', 'blueprint');
    const before = readFileSync(join(pack, '.walkdown', 'config.yml'), 'utf8');
    assert.notEqual(canon(spec), spec, 'the scratch root is reached through a symlink, which is the point');
    assert.match(walkdown(s.home, ['project', 'add', spec], pack), /already listed/);
    assert.match(walkdown(s.home, ['project', 'add', '.walkdown/blueprints/0001-gamma/blueprint'], pack), /already listed/);
    assert.equal(readFileSync(join(pack, '.walkdown', 'config.yml'), 'utf8'), before);
    assert.deepEqual(readdirSync(join(pack, '.walkdown', 'blueprints')), ['0001-gamma']);
  } finally {
    s.cleanup();
  }
});

test('--fix says an entry names its records elsewhere rather than claiming the old home is already named @rule:locations.default.one-home-per-blueprint', () => {
  /* n-0173 G: "already named by the config" about a directory the config did not name. */
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(repo, { recursive: true });
    walkdown(s.home, ['init'], repo);
    const old = join(s.home, 'projects', 'repo', 'evidence');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'shot.png'), 'x');
    const out = execFileSync(process.execPath, [CLI, 'where', '--fix'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, WALKDOWN_HOME: s.home, NO_COLOR: '1' },
    });
    assert.match(out, /already names evidence elsewhere/, out);
    assert.doesNotMatch(out, /already named by the config/);
    assert.ok(existsSync(join(old, 'shot.png')));
  } finally {
    s.cleanup();
  }
});
