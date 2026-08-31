import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { installSkills, placePointer, pointerBlock, scaffold, skillFiles } from '../lib/init.js';
import { lint } from '../lib/lint.js';
import { runChecks } from '../lib/run-cmd.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-initrun-'));

/* Every path in a tree, so a test can say "and nothing else appeared". */
const tree = (dir, prefix = '') =>
  readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => [
      prefix + e.name,
      ...(e.isDirectory() ? tree(join(dir, e.name), prefix + e.name + '/') : []),
    ]);
after(() => rmSync(root, { recursive: true, force: true }));

test('init scaffolds a lint-clean blueprint with agent conventions', () => {
  const proj = join(root, 'fresh');
  mkdirSync(proj);
  const results = scaffold(proj);
  const actionOf = (rs, path) => rs.find((r) => r.path === path)?.action;
  for (const path of ['blueprint/walkdown.yml', 'blueprint/AGENTS.md', 'CLAUDE.md'])
    assert.equal(actionOf(results, path), 'created', path);
  for (const skill of ['walkdown-judge', 'walkdown-incorporate', 'walkdown-formulate']) {
    assert.equal(actionOf(results, `.claude/skills/${skill}/SKILL.md`), 'created', skill);
    const content = readFileSync(join(proj, '.claude', 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp(`^---\\nname: ${skill}\\ndescription: .+`));
  }
  assert.match(readFileSync(join(proj, 'blueprint/walkdown.yml'), 'utf8'), /project: fresh/);
  // The pointer names wherever the spec actually went, which is not
  // necessarily inside the repository any more.
  const pointer = readFileSync(join(proj, 'CLAUDE.md'), 'utf8');
  assert.match(pointer, /walkdown blueprint in `blueprint\/`/);
  assert.match(pointer, /AGENTS\.md/);
  assert.equal(actionOf(results, join(proj, 'blueprint')), 'spec-in-repo');

  const { findings, exitCode } = lint(loadBlueprint(join(proj, 'blueprint')), { checks: false });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  assert.equal(exitCode, 0);
});

test('init is idempotent: rerun no-ops, customizations kept, --force updates owned docs only', () => {
  const proj = join(root, 'fresh'); // scaffolded by the previous test
  const actionOf = (rs, path) => rs.find((r) => r.path === path)?.action;
  const rerun = scaffold(proj);
  // Every file is up to date; the last two entries only report where the spec
  // and the skills went.
  assert.ok(
    rerun.every(
      (r) =>
        r.action === 'up-to-date' || r.action.startsWith('spec-') || r.action.startsWith('skills-'),
    ),
    JSON.stringify(rerun),
  );

  writeFileSync(join(proj, 'blueprint', 'walkdown.yml'), 'project: customized\n');
  writeFileSync(join(proj, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'customized');
  const third = scaffold(proj);
  assert.equal(actionOf(third, 'blueprint/walkdown.yml'), 'kept');
  assert.equal(actionOf(third, '.claude/skills/walkdown-judge/SKILL.md'), 'kept-differs');
  assert.equal(
    readFileSync(join(proj, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'utf8'),
    'customized',
  );

  const forced = scaffold(proj, { force: true });
  assert.equal(actionOf(forced, 'blueprint/walkdown.yml'), 'kept'); // user-owned: --force never touches it
  assert.equal(actionOf(forced, '.claude/skills/walkdown-judge/SKILL.md'), 'updated');
  assert.match(
    readFileSync(join(proj, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'utf8'),
    /^---\nname: walkdown-judge/,
  );
  assert.equal(
    readFileSync(join(proj, 'blueprint', 'walkdown.yml'), 'utf8'),
    'project: customized\n',
  );
});

test('init appends a pointer to an existing CLAUDE.md exactly once', () => {
  const proj = join(root, 'existing');
  mkdirSync(proj);
  writeFileSync(join(proj, 'CLAUDE.md'), '# My project\n');
  const actionOf = (rs, path) => rs.find((r) => r.path === path)?.action;
  assert.equal(actionOf(scaffold(proj), 'CLAUDE.md'), 'pointer-appended');
  assert.equal(actionOf(scaffold(proj), 'CLAUDE.md'), 'up-to-date');
  const content = readFileSync(join(proj, 'CLAUDE.md'), 'utf8');
  assert.match(content, /^# My project/);
  assert.equal(content.match(/walkdown:begin/g).length, 1);
});

/*
 * A project that keeps agent conventions in more than one file has already
 * made a choice walkdown cannot read. Writing into all of them is noise and
 * picking one is a guess, so init names them and leaves the tree alone.
 */
test('several agent files: init writes no pointer and says which they are @rule:locations.pointer.placed-where-agents-read', () => {
  const proj = join(root, 'ambiguous');
  mkdirSync(proj);
  writeFileSync(join(proj, 'CLAUDE.md'), '# Mine\n');
  writeFileSync(join(proj, 'AGENTS.md'), '# Also mine\n');
  const results = scaffold(proj);
  const undecided = results.find((r) => r.action === 'pointer-undecided');
  assert.ok(undecided, 'the choice is reported');
  assert.match(undecided.path, /CLAUDE\.md.*AGENTS\.md/);
  for (const f of ['CLAUDE.md', 'AGENTS.md'])
    assert.doesNotMatch(readFileSync(join(proj, f), 'utf8'), /walkdown:begin/, f);

  // And the person (or the wizard) settles it by naming one.
  assert.equal(
    placePointer(join(proj, 'AGENTS.md'), pointerBlock('blueprint/')),
    'pointer-appended',
  );
  assert.match(
    readFileSync(join(proj, 'AGENTS.md'), 'utf8'),
    /walkdown blueprint in `blueprint\/`/,
  );
});

test('a project with only an AGENTS.md gets the pointer there, not in a new CLAUDE.md @rule:locations.pointer.placed-where-agents-read', () => {
  const proj = join(root, 'agents-only');
  mkdirSync(proj);
  writeFileSync(join(proj, 'AGENTS.md'), '# Conventions\n');
  const results = scaffold(proj);
  assert.equal(results.find((r) => r.path === 'AGENTS.md')?.action, 'pointer-appended');
  assert.equal(
    existsSync(join(proj, 'CLAUDE.md')),
    false,
    'no second file competing for the same job',
  );
});

/*
 * The pointer names where the spec is, and a spec can move. A block left
 * saying `blueprint/` after the spec moved out is worse than no block at all,
 * because an agent believes it and goes looking.
 */
test('a moved spec rewrites its own block and nothing around it @rule:locations.pointer.owns-only-its-block', () => {
  const proj = join(root, 'moved');
  mkdirSync(proj);
  const file = join(proj, 'CLAUDE.md');
  writeFileSync(file, '# Head\n\n' + pointerBlock('blueprint/') + '\n## Tail\n');
  assert.equal(placePointer(file, pointerBlock('/elsewhere/spec')), 'pointer-updated');
  const after = readFileSync(file, 'utf8');
  assert.match(after, /blueprint in `\/elsewhere\/spec`/);
  assert.doesNotMatch(after, /`blueprint\/`/);
  assert.equal(after.match(/walkdown:begin/g).length, 1, 'replaced, not appended');
  assert.match(after, /^# Head/);
  assert.match(after, /## Tail\n$/, "the person's own words survive on both sides");
});

/*
 * Skills are procedures a person carries between projects, not records this
 * project owns - so by default they go to the person, and the repository of
 * somebody merely trying walkdown gains nothing but the pointer.
 */
test('skills follow the spec: outside it by default, committed when it is @rule:locations.default.skills-are-yours-by-default', () => {
  const home = join(root, 'skills-home');
  const proj = join(root, 'skills-out');
  mkdirSync(proj, { recursive: true });
  const outside = join(root, 'away', 'blueprint');
  scaffold(proj, { specDir: outside, skills: home });

  assert.ok(existsSync(join(home, 'walkdown-judge', 'SKILL.md')), 'the person got them');
  assert.equal(existsSync(join(proj, '.claude')), false, 'and the repository did not');
  assert.deepEqual(tree(proj), ['CLAUDE.md'], 'one file, which is the pointer');

  // Committed spec, committed procedures - they should arrive with a clone.
  const shared = join(root, 'skills-in');
  mkdirSync(shared, { recursive: true });
  const results = scaffold(shared, { specDir: join(shared, 'blueprint') });
  assert.ok(existsSync(join(shared, '.claude', 'skills', 'walkdown-judge', 'SKILL.md')));
  assert.equal(results.find((r) => r.action.startsWith('skills-'))?.action, 'skills-in-repo');
});

test('a skill whose harness only walkdown has is not shipped @rule:locations.default.skills-are-yours-by-default', () => {
  const names = skillFiles().map((s) => s.name);
  assert.ok(names.includes('walkdown-judge') && names.includes('walkdown-setup'));
  assert.ok(
    !names.includes('walkdown-sitting'),
    'it drives tools/sitting.mjs, which an adopting project does not have',
  );
});

test('an edited skill is kept unless forced @rule:locations.default.skills-are-yours-by-default', () => {
  const into = join(root, 'skills-edited');
  installSkills(into);
  const mine = join(into, 'walkdown-judge', 'SKILL.md');
  writeFileSync(mine, '# mine now\n');
  assert.equal(installSkills(into).find((r) => r.path === mine).action, 'kept-differs');
  assert.equal(readFileSync(mine, 'utf8'), '# mine now\n', 'a procedure somebody edited was meant');
  assert.equal(installSkills(into, { force: true }).find((r) => r.path === mine).action, 'updated');
  assert.match(readFileSync(mine, 'utf8'), /^---\nname: walkdown-judge/);
});

test('run substitutes {id}, injects target env and WALKDOWN_TARGET, propagates exit code', () => {
  const proj = join(root, 'runner');
  mkdirSync(join(proj, 'blueprint'), { recursive: true });
  const probe = `node -e "require('fs').writeFileSync('probe.txt', process.env.WALKDOWN_TARGET + ':' + process.env.APP_HOST + ':' + (process.env.RULE_ARG || ''))"`;
  writeFileSync(
    join(proj, 'blueprint', 'walkdown.yml'),
    [
      'project: runner',
      'runner:',
      `  run_all: "${probe.replaceAll('"', '\\"')}"`,
      `  run_for_rule: "RULE_ARG={id} ${probe.replaceAll('"', '\\"')}"`,
      '  targets:',
      '    staging: { env: { APP_HOST: "https://stage.example" } }',
    ].join('\n'),
  );
  const blueprint = loadBlueprint(join(proj, 'blueprint'));

  const all = runChecks(blueprint, { target: 'staging', stdio: 'pipe' });
  assert.equal(all.code, 0);
  assert.equal(readFileSync(join(proj, 'probe.txt'), 'utf8'), 'staging:https://stage.example:');

  const one = runChecks(blueprint, { target: 'staging', rule: 'a.b.c', stdio: 'pipe' });
  assert.equal(one.code, 0);
  assert.equal(
    readFileSync(join(proj, 'probe.txt'), 'utf8'),
    'staging:https://stage.example:a.b.c',
  );

  assert.throws(() => runChecks(blueprint, { target: 'nope', stdio: 'pipe' }), /unknown target/);

  writeFileSync(
    join(proj, 'blueprint', 'walkdown.yml'),
    'project: runner\nrunner: { run_all: "node -e \\"process.exit(3)\\"" }\n',
  );
  const failing = runChecks(loadBlueprint(join(proj, 'blueprint')), { stdio: 'pipe' });
  assert.equal(failing.code, 3);
});
