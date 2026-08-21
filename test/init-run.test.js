import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { scaffold } from '../lib/init.js';
import { lint } from '../lib/lint.js';
import { runChecks } from '../lib/run-cmd.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-initrun-'));
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
  assert.match(readFileSync(join(proj, 'CLAUDE.md'), 'utf8'), /blueprint\/AGENTS\.md/);

  const { findings, exitCode } = lint(loadBlueprint(join(proj, 'blueprint')), { checks: false });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  assert.equal(exitCode, 0);
});

test('init is idempotent: rerun no-ops, customizations kept, --force updates owned docs only', () => {
  const proj = join(root, 'fresh'); // scaffolded by the previous test
  const actionOf = (rs, path) => rs.find((r) => r.path === path)?.action;
  const rerun = scaffold(proj);
  assert.ok(rerun.every((r) => r.action === 'up-to-date'), JSON.stringify(rerun));

  writeFileSync(join(proj, 'blueprint', 'walkdown.yml'), 'project: customized\n');
  writeFileSync(join(proj, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'customized');
  const third = scaffold(proj);
  assert.equal(actionOf(third, 'blueprint/walkdown.yml'), 'kept');
  assert.equal(actionOf(third, '.claude/skills/walkdown-judge/SKILL.md'), 'kept-differs');
  assert.equal(readFileSync(join(proj, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'utf8'), 'customized');

  const forced = scaffold(proj, { force: true });
  assert.equal(actionOf(forced, 'blueprint/walkdown.yml'), 'kept'); // user-owned: --force never touches it
  assert.equal(actionOf(forced, '.claude/skills/walkdown-judge/SKILL.md'), 'updated');
  assert.match(readFileSync(join(proj, '.claude', 'skills', 'walkdown-judge', 'SKILL.md'), 'utf8'), /^---\nname: walkdown-judge/);
  assert.equal(readFileSync(join(proj, 'blueprint', 'walkdown.yml'), 'utf8'), 'project: customized\n');
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

test('run substitutes {id}, injects target env and WALKDOWN_TARGET, propagates exit code', () => {
  const proj = join(root, 'runner');
  mkdirSync(join(proj, 'blueprint'), { recursive: true });
  const probe = `node -e "require('fs').writeFileSync('probe.txt', process.env.WALKDOWN_TARGET + ':' + process.env.APP_HOST + ':' + (process.env.RULE_ARG || ''))"`;
  writeFileSync(
    join(proj, 'blueprint', 'walkdown.yml'),
    ['project: runner', 'runner:', `  run_all: "${probe.replaceAll('"', '\\"')}"`,
      `  run_for_rule: "RULE_ARG={id} ${probe.replaceAll('"', '\\"')}"`,
      '  targets:', '    staging: { env: { APP_HOST: "https://stage.example" } }'].join('\n')
  );
  const blueprint = loadBlueprint(join(proj, 'blueprint'));

  const all = runChecks(blueprint, { target: 'staging', stdio: 'pipe' });
  assert.equal(all.code, 0);
  assert.equal(readFileSync(join(proj, 'probe.txt'), 'utf8'), 'staging:https://stage.example:');

  const one = runChecks(blueprint, { target: 'staging', rule: 'a.b.c', stdio: 'pipe' });
  assert.equal(one.code, 0);
  assert.equal(readFileSync(join(proj, 'probe.txt'), 'utf8'), 'staging:https://stage.example:a.b.c');

  assert.throws(() => runChecks(blueprint, { target: 'nope', stdio: 'pipe' }), /unknown target/);

  writeFileSync(join(proj, 'blueprint', 'walkdown.yml'),
    'project: runner\nrunner: { run_all: "node -e \\"process.exit(3)\\"" }\n');
  const failing = runChecks(loadBlueprint(join(proj, 'blueprint')), { stdio: 'pipe' });
  assert.equal(failing.code, 3);
});
