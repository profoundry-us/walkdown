/*
 * What `blueprints new` says when a project's label or code is refused, and
 * what a bare `--blueprint` name means outside its project: each refusal is
 * true, and the command it suggests works as printed.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-project-codes-')));
after(() => rmSync(root, { recursive: true, force: true }));

/** A fresh machine: a HOME, a WALKDOWN_HOME with a profile, and a runner. */
function machine(name) {
  const home = join(root, name);
  const wd = join(home, '.walkdown');
  mkdirSync(wd, { recursive: true });
  writeFileSync(join(wd, 'profile.yml'), 'username: sam\nname: Sam\n');
  const env = { ...process.env, HOME: home, WALKDOWN_HOME: wd, NO_COLOR: '1' };
  const repo = (dir) => {
    const at = join(home, dir);
    mkdirSync(at, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: at });
    execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '--allow-empty', '-m', 'i'], { cwd: at });
    return at;
  };
  const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env, input: '' });
  const rows = () => parse(readFileSync(join(wd, 'registry.yml'), 'utf8'))?.blueprints ?? [];
  return { home, wd, repo, cli, rows };
}

test('a code-taken refusal keeps the label the person gave, and its command works as printed @rule:locations.registry.projects-are-labels', () => {
  const m = machine('keeps-label');
  m.cli(m.repo('ws'), 'blueprints', 'new', 'a');
  const q = m.repo('q');
  const r = m.cli(q, 'blueprints', 'new', 'b', '--project', 'mine', '--code', 'ws');
  assert.equal(r.status, 2, r.stderr);
  const cmd = r.stderr.match(/`walkdown (blueprints new [^`]+)`/)?.[1];
  assert.match(cmd, /--project mine --code \w+$/, 'the suggestion keeps --project mine');
  const again = m.cli(q, ...cmd.split(' '));
  assert.equal(again.status, 0, again.stderr);
  assert.equal(m.rows().find((row) => String(row.id).endsWith('-b'))?.project, 'mine');
});

test('a code that is no code is refused before anything is made, so the next try is not blocked @rule:locations.registry.projects-are-labels', () => {
  const m = machine('bad-code');
  const q = m.repo('q');
  const r = m.cli(q, 'blueprints', 'new', 'c', '--project', 'rr', '--code', 'shop');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /`shop` is not a project code — two or three lowercase letters or digits\. Nothing was made\./);
  assert.equal(existsSync(join(m.wd, 'projects', 'rr')), false, 'no home was made');
  assert.equal(m.cli(q, 'blueprints', 'new', 'c', '--project', 'rr', '--code', 'rr').status, 0);
});

test('outside its project a bare name is refused with the ID that reaches it, never as unregistered @rule:locations.answer.says-why', () => {
  const m = machine('bare-name');
  m.cli(m.repo('shop'), 'blueprints', 'new', 'checkout');
  const id = String(m.rows()[0].id);
  for (const args of [['where', 'spec', '--blueprint', 'checkout'], ['status', '--blueprint', 'checkout']]) {
    const r = m.cli(m.home, ...args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.doesNotMatch(r.stderr, /no registered blueprint|nothing registered it/, args.join(' '));
    assert.match(r.stderr, new RegExp(`name it by its ID: \`--blueprint ${id}\``), args.join(' '));
  }
  assert.equal(m.cli(m.home, 'where', 'spec', '--blueprint', id).status, 0, 'and the ID works there');
});
