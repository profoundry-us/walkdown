import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { installSkills, skillFiles } from '../lib/init.js';

/*
 * The clone is a Claude Code plugin (ADR 0010). What Claude Code itself does
 * with it - loading it, listing /walkdown:judge - is the agent tier's to
 * judge, because CI has no Claude Code; these hold the shape it loads from
 * and the installer that links it.
 */

const CLONE = realpathSync(new URL('..', import.meta.url).pathname);
const root = mkdtempSync(join(tmpdir(), 'walkdown-plugin-'));
const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const json = (path) => JSON.parse(readFileSync(join(CLONE, path), 'utf8'));
const byPath = (rows, path) => rows.find((r) => r.path === path)?.action;

test('the clone is one plugin named walkdown, carrying its skills and two commands and nothing else @rule:delivery.plugin.named-for-walkdown', () => {
  const plugin = json('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'walkdown');
  assert.equal(
    plugin.version,
    json('package.json').version,
    "the plugin is at the clone's version",
  );
  const market = json('.claude-plugin/marketplace.json');
  assert.deepEqual(
    market.plugins.map((p) => [p.name, p.source]),
    [['walkdown', './']],
    'the repository is its own marketplace, of one plugin',
  );

  const skills = readdirSync(join(CLONE, 'skills')).sort();
  assert.deepEqual(skills, ['backlog', 'formulate', 'incorporate', 'judge', 'setup']);
  for (const short of skills) {
    const head = readFileSync(join(CLONE, 'skills', short, 'SKILL.md'), 'utf8')
      .split('\n')
      .slice(0, 3);
    assert.equal(head[0], '---');
    assert.equal(
      head[1],
      `name: ${short}`,
      'named without a prefix, so it reads walkdown:' + short,
    );
    assert.match(head[2], /^description: .+/);
  }
  assert.deepEqual(readdirSync(join(CLONE, 'commands')).sort(), ['lint.md', 'status.md']);
  for (const cmd of ['lint', 'status'])
    assert.match(
      readFileSync(join(CLONE, 'commands', `${cmd}.md`), 'utf8'),
      new RegExp(`node "\\$\\{CLAUDE_PLUGIN_ROOT\\}/bin/walkdown\\.js" ${cmd}\\b`),
      `${cmd} runs the clone's own CLI`,
    );

  // Nothing else a plugin could carry, and the repository-only skill stays
  // in this repository's .claude, which the plugin never reads.
  for (const other of ['agents', 'hooks', '.mcp.json', '.lsp.json'])
    assert.equal(existsSync(join(CLONE, other)), false, other);
  assert.equal(existsSync(join(CLONE, 'skills', 'sitting')), false);
  assert.ok(existsSync(join(CLONE, '.claude', 'skills', 'walkdown-sitting', 'SKILL.md')));
});

/* A throwaway clone: a git repository with a skills/ folder in it. */
function fakeClone(name) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'skills', 'judge'), { recursive: true });
  writeFileSync(
    join(dir, 'skills', 'judge', 'SKILL.md'),
    '---\nname: judge\ndescription: one\n---\nv1\n',
  );
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v1');
  return { dir, git };
}

test('Claude Code gets one link to the clone, and updating the clone updates the skills @rule:delivery.plugin.one-link', () => {
  const into = join(root, 'one-link');
  const clone = fakeClone('clone-a');
  const at = join(into, 'walkdown');

  const first = installSkills(into, { link: true, clone: clone.dir, released: new Map() });
  assert.deepEqual(first, [{ path: at, action: 'linked', target: clone.dir }], 'one link, said');
  assert.ok(lstatSync(at).isSymbolicLink());
  assert.equal(realpathSync(at), realpathSync(clone.dir));
  assert.deepEqual(readdirSync(into), ['walkdown'], 'and nothing else in the folder');

  const again = installSkills(into, { link: true, clone: clone.dir, released: new Map() });
  assert.equal(byPath(again, at), 'up-to-date');

  // Another version checked out: read through the link, it is that version,
  // with nothing run in between.
  writeFileSync(
    join(clone.dir, 'skills', 'judge', 'SKILL.md'),
    '---\nname: judge\ndescription: two\n---\nv2\n',
  );
  clone.git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'v2');
  clone.git('checkout', '-q', 'HEAD~1');
  assert.match(readFileSync(join(at, 'skills', 'judge', 'SKILL.md'), 'utf8'), /v1/);
  clone.git('checkout', '-q', '-');
  assert.match(readFileSync(join(at, 'skills', 'judge', 'SKILL.md'), 'utf8'), /v2/);

  // An edit through the link is an edit to the clone, and git says so.
  writeFileSync(join(at, 'skills', 'judge', 'SKILL.md'), 'mine now\n');
  assert.match(clone.git('status', '--porcelain'), /skills\/judge\/SKILL\.md/);
});

test('the installer never writes through a link, and leaves alone links it did not make @rule:delivery.plugin.never-through-a-link', () => {
  const into = join(root, 'links');
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(join(elsewhere, 'pack'), { recursive: true });
  writeFileSync(join(elsewhere, 'pack', 'SKILL.md'), 'theirs\n');
  writeFileSync(join(elsewhere, 'judge.md'), 'also theirs\n');
  mkdirSync(join(into, 'walkdown-judge'), { recursive: true });
  symlinkSync(join(elsewhere, 'pack'), join(into, 'walkdown'));
  symlinkSync(join(elsewhere, 'judge.md'), join(into, 'walkdown-judge', 'SKILL.md'));
  const before = () => [
    readFileSync(join(elsewhere, 'pack', 'SKILL.md'), 'utf8'),
    readFileSync(join(elsewhere, 'judge.md'), 'utf8'),
  ];
  const was = before();

  for (const force of [false, true]) {
    const rows = installSkills(into, { link: true, force, released: new Map() });
    assert.equal(byPath(rows, join(into, 'walkdown')), 'someone-elses-link', `force=${force}`);
    assert.equal(
      byPath(rows, join(into, 'walkdown-judge')),
      'someone-elses-link',
      `force=${force}`,
    );
    assert.equal(
      realpathSync(join(into, 'walkdown')),
      realpathSync(join(elsewhere, 'pack')),
      'the link still points where it did',
    );
  }
  assert.deepEqual(before(), was, 'every file a link points at is unchanged');

  // Walkdown's own link, beside them, is up to date.
  const mine = join(root, 'links-mine');
  installSkills(mine, { link: true, released: new Map() });
  assert.equal(
    byPath(installSkills(mine, { link: true, released: new Map() }), join(mine, 'walkdown')),
    'up-to-date',
  );

  // And copies, for another agent, refuse a link the same way.
  const copies = join(root, 'links-copies');
  mkdirSync(join(copies, 'walkdown-judge'), { recursive: true });
  symlinkSync(join(elsewhere, 'judge.md'), join(copies, 'walkdown-judge', 'SKILL.md'));
  const rows = installSkills(copies, { link: false, force: true });
  assert.equal(byPath(rows, join(copies, 'walkdown-judge', 'SKILL.md')), 'someone-elses-link');
  assert.deepEqual(before(), was);
});

test('--force removes the copies an earlier walkdown left, and keeps an edited one @rule:delivery.plugin.old-copies-make-way', () => {
  const into = join(root, 'old-copies');
  const older = '---\nname: walkdown-judge\ndescription: as 0.1.0 shipped it\n---\nold\n';
  const current = skillFiles().find((s) => s.name === 'walkdown-judge').content;
  // Released: an OLDER judge than today's, and today's setup.
  const released = new Map([
    ['walkdown-judge', new Set([sha(older)])],
    [
      'walkdown-setup',
      new Set([sha(skillFiles().find((s) => s.name === 'walkdown-setup').content)]),
    ],
  ]);
  for (const [name, text] of [
    ['walkdown-judge', older],
    ['walkdown-setup', 'edited by its person\n'],
  ]) {
    mkdirSync(join(into, name), { recursive: true });
    writeFileSync(join(into, name, 'SKILL.md'), text);
  }
  assert.notEqual(
    older,
    current,
    'the copy matches a released version that is not the current one',
  );

  const plain = installSkills(into, { link: true, released });
  assert.equal(byPath(plain, join(into, 'walkdown')), 'linked', 'the link is made either way');
  assert.equal(byPath(plain, join(into, 'walkdown-judge')), 'duplicate');
  assert.equal(byPath(plain, join(into, 'walkdown-setup')), 'duplicate-edited');
  assert.ok(existsSync(join(into, 'walkdown-judge')), 'nothing removed without --force');

  const forced = installSkills(into, { link: true, force: true, released });
  assert.equal(byPath(forced, join(into, 'walkdown-judge')), 'removed');
  assert.equal(byPath(forced, join(into, 'walkdown-setup')), 'kept-edited');
  assert.equal(existsSync(join(into, 'walkdown-judge')), false);
  assert.equal(
    readFileSync(join(into, 'walkdown-setup', 'SKILL.md'), 'utf8'),
    'edited by its person\n',
  );
});

test('the duplicate warning gives the command that removes them @rule:delivery.plugin.old-copies-make-way', () => {
  const personal = join(root, 'cli-personal');
  mkdirSync(join(personal, 'walkdown-judge'), { recursive: true });
  writeFileSync(join(personal, 'walkdown-judge', 'SKILL.md'), 'edited\n');
  const out = execFileSync(
    'node',
    [join(CLONE, 'bin', 'walkdown.js'), 'skills', '--into', personal],
    {
      encoding: 'utf8',
      env: { ...process.env, WALKDOWN_SKILLS_DIR: personal, NO_COLOR: '1' },
    },
  );
  assert.match(out, /linked .*walkdown/);
  assert.match(out, /duplicate .*walkdown-judge/);
  assert.match(out, /`walkdown skills --force`/);
});

test('another agent gets copies named walkdown-<name> in the folder named @rule:locations.default.skills-are-yours-by-default', () => {
  const into = join(root, 'other-agent');
  const rows = installSkills(into);
  assert.ok(rows.every((r) => r.action === 'created'));
  assert.deepEqual(readdirSync(into).sort(), [
    'walkdown-backlog',
    'walkdown-formulate',
    'walkdown-incorporate',
    'walkdown-judge',
    'walkdown-setup',
  ]);
  assert.match(
    readFileSync(join(into, 'walkdown-judge', 'SKILL.md'), 'utf8'),
    /^---\nname: walkdown-judge\n/,
  );
  assert.equal(existsSync(join(into, 'walkdown')), false, "no link outside Claude Code's folder");
});
