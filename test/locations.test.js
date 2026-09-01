import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { formatHash, specFiles, specHash } from '../lib/hash.js';
import { ensureAllocated, KINDS, readUserConfig, resolveLocations } from '../lib/locations.js';
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
const declare = (home, { id = 'demo', roots, spec, ...rest }) =>
  configure(
    home,
    ['projects:', `  - id: ${id}`, `    roots: [${roots}]`, `    spec: ${spec}`,
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
    assert.equal(resolveLocations({ cwd: stray }).spec.missing, true);
  } finally {
    s.cleanup();
  }
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
    const bp = blueprint(join(repo, 'blueprint')); // no subdirectories at all
    declare(s.home, { roots: repo, spec: bp });
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.runs.path, join(bp, 'runs'));
    assert.equal(loc.threads.path, join(bp, 'threads'));
    assert.match(loc.threads.why, /beside the spec/);
    assert.equal(loc.evidence.path, join(s.home, 'blueprints', '0001-demo', 'evidence'));
    assert.equal(loc.drafts.path, join(s.home, 'blueprints', '0001-demo', 'drafts'));
    assert.match(loc.evidence.why, /outside the repository/);
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

test('--dir beats every configured answer', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'));
    const other = blueprint(join(s.root, 'other'), { project: 'other' });
    configure(
      s.home,
      `projects:\n  - id: pinned\n    roots: [${repo}]\n    spec: ${join(repo, 'blueprint')}\n`,
    );
    const loc = resolveLocations({ cwd: repo, dir: other });
    assert.equal(loc.spec.path, other);
    assert.equal(loc.spec.why, 'named on the command line');
  } finally {
    s.cleanup();
  }
});

/*
 * `--dir` scopes the whole answer, not just the spec. The entry matching where
 * you are STANDING describes a different project, and letting it keep applying
 * reported one project's spec beside another's ledger.
 */
test('--dir does not inherit the ledger of whichever project you are standing in @rule:locations.answer.declared-not-discovered', () => {
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
        `    runs: ${join(s.home, 'mine-runs')}`,
        '',
      ].join('\n'),
    );

    const standing = resolveLocations({ cwd: repo });
    assert.equal(
      standing.runs.path,
      join(s.home, 'mine-runs'),
      'the entry applies where it matches',
    );

    const named = resolveLocations({ cwd: repo, dir: other });
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
    assert.equal(loc.spec.missing, true, 'an unreadable config resolves nothing');
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
test('a fresh project gets nothing in its tree but conventions and a pointer @rule:locations.default.nothing-in-the-tree', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'app.js'), '// theirs\n');
    walkdown(s.home, ['init', '--dir', repo]);

    assert.deepEqual(
      tree(repo),
      ['CLAUDE.md', 'src', 'src/app.js'],
      'one file: the pointer. Not a directory of walkdown furniture, not even the skills',
    );
    assert.ok(existsSync(join(s.skills, 'walkdown-judge', 'SKILL.md')), 'which went to the person');

    // And everything it will write is under the personal home, filed by project.
    const loc = resolveLocations({ cwd: repo });
    for (const kind of ['spec', ...KINDS])
      assert.ok(loc[kind].path.startsWith(s.home + '/'), `${kind} went to ${loc[kind].path}`);
  } finally {
    s.cleanup();
  }
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
      `projects:\n  - id: demo\n    roots: [${repo}]\n    spec: ${join(repo, 'blueprint')}\n    evidence: ${join(s.home, 'ev')}\n`,
    );
    const loc = resolveLocations({ cwd: repo });

    for (const kind of ['spec', ...KINDS])
      assert.ok(loc[kind].why?.length > 8, `${kind} gave no reason: ${loc[kind].why}`);
    // And the reasons name WHICH decision, so a person knows what to argue with.
    assert.match(loc.spec.why, /config/);
    assert.match(loc.runs.why, /already in the blueprint/);
    assert.match(loc.threads.why, /beside the spec/);
    assert.match(loc.evidence.why, /config/);
    assert.match(loc.drafts.why, /built-in default/);

    const said = walkdown(s.home, ['where', '--dir', join(repo, 'blueprint')]);
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
    const said = walkdown(s.home, ['where', '--dir', join(repo, 'blueprint')]);
    walkdown(s.home, ['where', 'evidence', '--dir', join(repo, 'blueprint')]);

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
 * The numbered home registry (thread n-0124). A name-keyed home collides
 * exactly where the default-out design matters most - thirty monorepo packs
 * all called by the repository's basename - so a home is ALLOCATED, and the
 * only thing a name does in its path is help a person read the directory list.
 */
test('two repositories with one basename get homes of their own @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const a = join(s.root, 'one', 'app');
    const b = join(s.root, 'two', 'app');
    blueprint(join(a, 'blueprint'), { project: 'app' });
    blueprint(join(b, 'blueprint'), { project: 'app' });
    // Both declared, since a blueprint nobody wrote down is not a project.
    // Their IDS collide on purpose - that is the case this rule is about.
    configure(
      s.home,
      [
        'projects:',
        '  - id: app',
        `    roots: [${a}]`,
        `    spec: ${join(a, 'blueprint')}`,
        '  - id: app',
        `    roots: [${b}]`,
        `    spec: ${join(b, 'blueprint')}`,
        '',
      ].join('\n'),
    );
    // Asking is free: both answers are tentative and nothing was written.
    const askA = resolveLocations({ cwd: a });
    assert.match(askA.evidence.why, /allocated on first write/);
    assert.equal(existsSync(join(s.home, 'blueprints')), false, 'asking allocated nothing');
    // The first write claims each home; the numbers disambiguate the name.
    const locA = ensureAllocated(resolveLocations({ cwd: a }), 'evidence');
    const locB = ensureAllocated(resolveLocations({ cwd: b }), 'evidence');
    assert.equal(locA.evidence.path, join(s.home, 'blueprints', '0001-app', 'evidence'));
    assert.equal(locB.evidence.path, join(s.home, 'blueprints', '0002-app', 'evidence'));
    // Settled: asking again answers with the allocation, not a guess.
    const again = resolveLocations({ cwd: b });
    assert.equal(again.evidence.path, locB.evidence.path);
    assert.doesNotMatch(again.evidence.why, /allocated on first write/);
  } finally {
    s.cleanup();
  }
});

test('a legacy name-keyed home keeps answering until migrate renumbers it @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    blueprint(join(repo, 'blueprint'), { project: 'demo' });
    declare(s.home, { roots: repo, spec: join(repo, 'blueprint') });
    mkdirSync(join(s.home, 'projects', 'demo', 'evidence'), { recursive: true });
    writeFileSync(join(s.home, 'projects', 'demo', 'evidence', 'shot.png'), 'x');
    const loc = resolveLocations({ cwd: repo });
    // An existing ledger is a fact; a resolver never moves one on its own.
    assert.equal(loc.evidence.path, join(s.home, 'projects', 'demo', 'evidence'));
    assert.match(loc.evidence.why, /legacy home/);
    assert.match(loc.evidence.why, /walkdown migrate/);
  } finally {
    s.cleanup();
  }
});

test('migrate renumbers a config-claimed home and re-points the config @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    const bp = blueprint(join(repo, 'blueprint'), { project: 'demo' });
    mkdirSync(join(s.home, 'projects', 'demo', 'evidence'), { recursive: true });
    writeFileSync(join(s.home, 'projects', 'demo', 'evidence', 'shot.png'), 'x');
    mkdirSync(join(s.home, 'projects', 'orphan'), { recursive: true });
    configure(
      s.home,
      [
        'projects:',
        '  - id: demo',
        `    roots: [${repo}]`,
        `    spec: ${bp}`,
        `    evidence: ${join(s.home, 'projects', 'demo', 'evidence')}`,
        '',
      ].join('\n'),
    );
    const out = execFileSync(
      process.execPath,
      [new URL('../bin/walkdown.js', import.meta.url).pathname, 'migrate'],
      { cwd: s.root, encoding: 'utf8', env: { ...process.env, WALKDOWN_HOME: s.home, NO_COLOR: '1' } },
    );
    assert.match(out, /moved/);
    assert.ok(
      existsSync(join(s.home, 'blueprints', '0001-demo', 'evidence', 'shot.png')),
      'the records moved with the home',
    );
    assert.equal(existsSync(join(s.home, 'projects', 'demo')), false);
    const cfg = readUserConfig({ cwd: s.root }).config;
    assert.equal(
      cfg.projects[0].evidence,
      join(s.home, 'blueprints', '0001-demo', 'evidence'),
      'the config now speaks the new address',
    );
    // The home nobody claimed is reported and left standing, never guessed at.
    assert.match(out, /no config entry claims it/);
    assert.ok(existsSync(join(s.home, 'projects', 'orphan')));
    // And the resolver now answers from the allocation.
    const loc = resolveLocations({ cwd: repo });
    assert.equal(loc.evidence.path, join(s.home, 'blueprints', '0001-demo', 'evidence'));
  } finally {
    s.cleanup();
  }
});

/*
 * n-0129: an index entry carrying only `root:` can never be found by a
 * spec-keyed ask, so `--dir <its own spec>` allocated the same blueprint a
 * second home and stranded the first one's records. The moment a home is
 * known to hold a spec, the index must say which.
 */
test('migrate records the spec a moved home holds, so the blueprint is never homed twice @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    // The old default-out shape: the spec LIVES in the legacy home, and the
    // config entry claims it implicitly - id and roots, nothing else.
    blueprint(join(s.home, 'projects', 'demo', 'blueprint'), { project: 'demo' });
    mkdirSync(join(s.home, 'projects', 'demo', 'evidence'), { recursive: true });
    writeFileSync(join(s.home, 'projects', 'demo', 'evidence', 'shot.png'), 'x');
    configure(s.home, ['projects:', '  - id: demo', `    roots: [${repo}]`, ''].join('\n'));
    execFileSync(
      process.execPath,
      [new URL('../bin/walkdown.js', import.meta.url).pathname, 'migrate'],
      { cwd: s.root, encoding: 'utf8', env: { ...process.env, WALKDOWN_HOME: s.home, NO_COLOR: '1' } },
    );
    const spec = join(s.home, 'blueprints', '0001-demo', 'blueprint');
    const index = readFileSync(join(s.home, 'blueprints', 'index.yml'), 'utf8');
    assert.match(index, new RegExp(`spec: ${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    // One home, whichever way it is asked for.
    const fromRepo = resolveLocations({ cwd: repo });
    assert.equal(fromRepo.evidence.path, join(s.home, 'blueprints', '0001-demo', 'evidence'));
    assert.equal(fromRepo.pendingHome, null);
    const byDir = resolveLocations({ dir: spec });
    assert.equal(byDir.evidence.path, join(s.home, 'blueprints', '0001-demo', 'evidence'));
    assert.equal(byDir.pendingHome, null, 'a spec-keyed ask finds the SAME home, never a second');
  } finally {
    s.cleanup();
  }
});

test('a home claimed before its spec exists owns the spec written into it @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    const repo = join(s.root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    // What init does: claim the home for the spec it is about to write.
    const loc = ensureAllocated(resolveLocations({ cwd: repo }), 'spec');
    const index = readFileSync(join(s.home, 'blueprints', 'index.yml'), 'utf8');
    assert.match(index, /spec: /, 'the claim already names the spec the home will hold');
    blueprint(loc.spec.path, { project: 'repo' });
    // What serve --dir does next: ask by the spec path outright.
    const byDir = resolveLocations({ dir: loc.spec.path });
    assert.equal(byDir.drafts.path, join(s.home, 'blueprints', '0001-repo', 'drafts'));
    assert.equal(byDir.pendingHome, null, 'serving the spec finds the claimed home, never 0002');
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
    const bySpec = resolveLocations({ dir: join(repo, 'blueprint') });
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
      resolveLocations({ dir: away }).codeRoot,
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
      const loc = resolveLocations({ dir: loose, cwd: standing });
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
 * The orphan clause, probed the hard way (n-0129, second judging): a legacy
 * home no config entry claims stays put even when it happens to CONTAIN a
 * spec - contents are not a claim, and migrate moved two such homes on the
 * strength of theirs.
 */
test('migrate never moves an unclaimed home, spec inside or not @rule:locations.default.one-home-per-blueprint', () => {
  const s = scratch();
  try {
    // An orphan that self-describes: full blueprint inside, no config entry.
    blueprint(join(s.home, 'projects', 'orphanapp', 'blueprint'), { project: 'orphanapp' });
    configure(s.home, 'projects: []\n');
    const out = execFileSync(
      process.execPath,
      [new URL('../bin/walkdown.js', import.meta.url).pathname, 'migrate'],
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
