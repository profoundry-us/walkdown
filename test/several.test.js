/*
 * A PROJECT HOLDS SEVERAL BLUEPRINTS (ADR 0011, issue #20).
 *
 * `init --id` gives a project another blueprint in a home of its own; reads
 * standing in the project cover every one, each under its id; and anything
 * that writes refuses until `--blueprint` says which.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/* A home of its own, and a git project called `proj` in it. */
function machine() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-several-')));
  roots.push(root);
  const home = join(root, 'home');
  const proj = join(root, 'proj');
  mkdirSync(join(proj, '.git'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const wd = (args, cwd = proj) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, WALKDOWN_HOME: home, WALKDOWN_SKILLS_DIR: join(home, 'skills'), NO_COLOR: '1' },
    });
  const homes = () => readdirSync(join(home, 'blueprints')).sort();
  return { root, home, proj, wd, homes };
}

/* A project holding `proj` and `b`, each with one rule and one thread. */
function twoBlueprints() {
  const m = machine();
  assert.equal(m.wd(['init']).status, 0);
  assert.equal(m.wd(['init', '--id', 'b']).status, 0);
  return m;
}

test('init --id gives a project a second blueprint in its own numbered folder, and again changes nothing @rule:locations.several.init-makes-another', () => {
  const m = machine();
  assert.equal(m.wd(['init']).status, 0);
  assert.deepEqual(m.homes(), ['0001-proj']);

  const first = m.wd(['init', '--id', 'b']);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(m.homes(), ['0001-proj', '0002-b'], 'a new numbered home for b');
  assert.match(first.stdout, /`b` is another blueprint for this project, beside `proj`/);

  const again = m.wd(['init', '--id', 'b']);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /created|another/, 'everything up to date');
  assert.deepEqual(m.homes(), ['0001-proj', '0002-b']);

  // No --id means the id init would give the project anyway: proj.
  const bare = m.wd(['init']);
  assert.equal(bare.status, 0, bare.stderr);
  assert.doesNotMatch(bare.stdout, /created/);
  assert.deepEqual(m.homes(), ['0001-proj', '0002-b']);

  // --commit with several needs --id.
  const commit = m.wd(['init', '--commit', 'spec']);
  assert.equal(commit.status, 2);
  assert.match(commit.stderr, /several blueprints \(proj, b\).*--commit/s);
  assert.match(commit.stderr, /--id <id>/);

  // An id another project holds is refused, not suffixed.
  const other = join(m.root, 'other');
  mkdirSync(join(other, '.git'), { recursive: true });
  const taken = m.wd(['init', '--id', 'b'], other);
  assert.equal(taken.status, 2);
  assert.match(taken.stderr, /`b` is already registered for .*proj — choose another id/);
  assert.deepEqual(m.homes(), ['0001-proj', '0002-b'], 'and nothing claimed');

  // Named for its id, not for the project.
  assert.match(readFileSync(join(m.home, 'blueprints', '0002-b', 'blueprint', 'walkdown.yml'), 'utf8'), /^blueprint: b$/m);

  // Both claim one page: claims reports both, and serve's list holds both.
  for (const h of ['0001-proj', '0002-b'])
    writeFileSync(join(m.home, 'blueprints', h, 'blueprint', 'storyboard.yml'), 'screens:\n  - id: home\n    app: { path: /index.html }\n');
  const claims = m.wd(['claims', '--url', 'http://localhost:3000/index.html', '--json']);
  assert.equal(claims.status, 0, claims.stderr);
  assert.deepEqual(JSON.parse(claims.stdout).matches.map((x) => x.id).sort(), ['b', 'proj']);
  const listed = m.wd(['blueprints']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /\bproj\b/);
  assert.match(listed.stdout, /\bb\b/);
});

test('bare init refuses where several blueprints stand and none has the default id @rule:locations.several.init-makes-another', () => {
  const m = machine();
  assert.equal(m.wd(['init', '--id', 'a']).status, 0);
  assert.equal(m.wd(['init', '--id', 'b']).status, 0);
  const bare = m.wd(['init']);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /several blueprints \(a, b\) and none is `proj`/);
  assert.deepEqual(m.homes(), ['0001-a', '0002-b']);
});

test('reads report on every blueprint, each under its id, and on one when named @rule:locations.several.reads-cover-all', () => {
  const m = twoBlueprints();
  for (const cmd of [['status'], ['lint'], ['threads'], ['where']]) {
    const r = m.wd(cmd);
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
    const heads = [...r.stdout.matchAll(/━━ (\S+) ━━/g)].map((x) => x[1]);
    assert.deepEqual(heads, ['proj', 'b'], `${cmd} sections, in registration order`);

    const json = m.wd([...cmd, '--json']);
    assert.equal(json.status, 0, `${cmd} --json: ${json.stderr}`);
    const answer = JSON.parse(json.stdout);
    assert.deepEqual(Object.keys(answer), ['blueprints']);
    assert.deepEqual(answer.blueprints.map((b) => b.id), ['proj', 'b']);

    const one = m.wd([...cmd, '--blueprint', 'b']);
    assert.equal(one.status, 0);
    assert.doesNotMatch(one.stdout, /━━/, `${cmd} --blueprint b is b alone`);
    const oneJson = JSON.parse(m.wd([...cmd, '--blueprint', 'b', '--json']).stdout);
    assert.ok(!('blueprints' in (Array.isArray(oneJson) ? {} : oneJson)), 'the single answer, as before');
  }
  // where <kind>: one line each, the id and the path.
  const ev = m.wd(['where', 'evidence']).stdout.trim().split('\n');
  assert.deepEqual(ev.map((l) => l.split('\t')[0]), ['proj', 'b']);
  assert.match(ev[1], /0002-b\/evidence$/);
});

test('a project with one blueprint prints what it printed before @rule:locations.several.reads-cover-all', () => {
  const m = machine();
  assert.equal(m.wd(['init']).status, 0);
  for (const cmd of [['status'], ['lint'], ['threads'], ['where']]) {
    const r = m.wd(cmd);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /━━/, `${cmd}: no sections`);
    const json = JSON.parse(m.wd([...cmd, '--json']).stdout);
    assert.ok(Array.isArray(json) || !('blueprints' in json), `${cmd} --json is the single answer`);
  }
});

test('writes refuse until --blueprint names one, and the refusal lists the ids @rule:locations.several.writes-name-one', () => {
  const m = twoBlueprints();
  // `run` is not among them: it runs the project's suite and files each
  // result by rule (several-project.test.js).
  const writes = [
    ['hash', '--write'],
    ['thread', 'new', '--screen', 'x', '--body', 'hello'],
    ['judge', 'some.rule'],
    ['sweep', '--why', 'because'],
    ['move', 'evidence', '--to', join(m.root, 'elsewhere')],
  ];
  for (const cmd of writes) {
    const r = m.wd(cmd);
    assert.equal(r.status, 2, `${cmd[0]} exits 2`);
    assert.match(r.stderr, /Several blueprints are registered for .*: proj, b\./, `${cmd[0]} names them`);
    assert.match(r.stderr, /`--blueprint <id>` says which/);
    assert.doesNotMatch(r.stderr, /No blueprint here/);
  }

  // With --blueprint b, a write acts on b alone.
  const filed = m.wd(['thread', 'new', '--blueprint', 'b', '--rule', 'x', '--body', 'hi']);
  assert.equal(filed.status, 2, 'b has no rule x - refused by b, not by the several');
  assert.match(filed.stderr, /No rule "x"/);
  const sweep = m.wd(['sweep', '--blueprint', 'b', '--why', 'because', '--tiers', 'agent']);
  assert.equal(sweep.status, 0, sweep.stderr);
  assert.equal(readdirSync(join(m.home, 'blueprints', '0002-b', 'runs')).length, 1, 'the sweep landed in b');
  const projRuns = join(m.home, 'blueprints', '0001-proj', 'runs');
  assert.ok(!existsSync(projRuns) || readdirSync(projRuns).length === 0, 'and not in proj');
});

test('a thread id only one blueprint holds is changed without --blueprint @rule:locations.several.writes-name-one', () => {
  const m = twoBlueprints();
  // A design request on a screen of b's own.
  const sb = join(m.home, 'blueprints', '0002-b', 'blueprint', 'storyboard.yml');
  spawnSync('sh', ['-c', `printf 'screens:\\n  - id: home\\n    app: { path: /index.html }\\n' > "${sb}"`]);
  const opened = m.wd(['thread', 'new', '--blueprint', 'b', '--screen', 'home', '--body', 'please draw this', '--json']);
  assert.equal(opened.status, 0, opened.stderr);
  const id = JSON.parse(opened.stdout).id;

  const reply = m.wd(['thread', id, '--reply', 'on it']);
  assert.equal(reply.status, 0, reply.stderr);
  const shown = JSON.parse(m.wd(['thread', id, '--json']).stdout);
  assert.equal(shown.replies.at(-1).body, 'on it');
});

test('"No blueprint here" is said only where none is registered @rule:locations.several.writes-name-one', () => {
  const m = machine();
  const none = m.wd(['status']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /No blueprint here/);
});
