/*
 * A PROJECT HOLDS SEVERAL BLUEPRINTS (ADR 0011, issue #20, ADR 0014).
 *
 * `blueprints new <name>` gives a project another blueprint in a home of its
 * own; reads standing in the project cover every one, each under its ID;
 * and anything that writes refuses until `--blueprint` says which.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const nm = (id) => String(id).replace(/^\d{4}-[a-z0-9]{2,3}-/, '');
const ID = (name) => new RegExp(`^\\d{4}-[a-z0-9]{2,3}-${name}$`);
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
  // Personal homes, under the project's label (ADR 0014 §4).
  const personal = join(home, 'projects', 'proj', 'blueprints');
  const homes = () => (existsSync(personal) ? readdirSync(personal).sort() : []);
  const rows = () => parse(readFileSync(join(home, 'registry.yml'), 'utf8')).blueprints;
  const homeOf = (name) => rows().find((r) => nm(r.id) === name).home;
  return { root, home, proj, wd, homes, rows, homeOf };
}

/* A project holding `proj` and `b`. */
function twoBlueprints() {
  const m = machine();
  assert.equal(m.wd(['blueprints', 'new']).status, 0);
  assert.equal(m.wd(['blueprints', 'new', 'b']).status, 0);
  return m;
}

test('blueprints new <name> gives a project a second blueprint in a home of its own, and again changes nothing @rule:locations.several.new-makes-another', () => {
  const m = machine();
  assert.equal(m.wd(['blueprints', 'new']).status, 0);
  assert.equal(m.homes().length, 1);

  const first = m.wd(['blueprints', 'new', 'b']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(m.homes().length, 2, 'a new home for b');
  assert.match(m.homes().find((h) => h.endsWith('-b')), /^\d{6}-b$/, 'in a folder named for this month');
  assert.match(first.stdout, /listed .* as `\d{4}-[a-z0-9]+-b`/, 'registered with an ID');
  assert.match(first.stdout, /added to `proj`, beside `proj`/, 'and says which project it joined');

  const again = m.wd(['blueprints', 'new', 'b']);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /created|another/, 'everything up to date');
  assert.doesNotMatch(again.stdout, /kept/, "its own spec.yml reads as up to date, not as somebody's edit");
  assert.equal(m.homes().length, 2);

  // No name means the name `blueprints new` would give the project anyway: proj.
  const bare = m.wd(['blueprints', 'new']);
  assert.equal(bare.status, 0, bare.stderr);
  assert.doesNotMatch(bare.stdout, /created/);
  assert.equal(m.homes().length, 2);

  // Committing with several needs --blueprint, from either door.
  const commit = m.wd(['blueprints', 'new', '--commit', 'spec']);
  assert.equal(commit.status, 2);
  assert.match(commit.stderr, /several blueprints \(proj, b\).*blueprints commit/s);
  assert.match(commit.stderr, /--blueprint <id>/);
  const moved = m.wd(['blueprints', 'commit', 'spec']);
  assert.equal(moved.status, 2);
  assert.match(moved.stderr, /several blueprints \(proj, b\)/);
  assert.match(moved.stderr, /--blueprint <id>/);
  assert.equal(m.homes().length, 2, 'and neither moved');

  // Another project may have a `b` of its own: the registry's counter keeps
  // their IDs apart, and nothing of proj's is touched.
  const other = join(m.root, 'other');
  mkdirSync(join(other, '.git'), { recursive: true });
  const theirs = m.wd(['blueprints', 'new', 'b'], other);
  assert.equal(theirs.status, 0, theirs.stderr);
  const bs = m.rows().filter((r) => nm(r.id) === 'b');
  assert.equal(bs.length, 2);
  assert.notEqual(bs[0].id, bs[1].id);
  assert.deepEqual(bs.map((r) => r.project).sort(), ['other', 'proj']);
  assert.equal(m.homes().length, 2, 'and nothing of proj changed');

  // Named for its name, not for the project.
  assert.match(readFileSync(join(m.homeOf('b'), 'spec.yml'), 'utf8'), /^blueprint: b$/m);

  // Both claim one page: claims reports both, and serve's list holds both.
  for (const h of ['proj', 'b'])
    writeFileSync(join(m.homeOf(h), 'storyboard.yml'), 'screens:\n  - id: home\n    app: { path: /index.html }\n');
  const claims = m.wd(['claims', '--url', 'http://localhost:3000/index.html', '--json']);
  assert.equal(claims.status, 0, claims.stderr);
  assert.deepEqual(JSON.parse(claims.stdout).matches.map((x) => nm(x.id)).sort(), ['b', 'proj']);
  const listed = m.wd(['blueprints']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /-proj\b/);
  assert.match(listed.stdout, /-b\b/);
});

test('a bare blueprints new refuses where several blueprints stand and none has the default name @rule:locations.several.new-makes-another', () => {
  const m = machine();
  assert.equal(m.wd(['blueprints', 'new', 'a']).status, 0);
  assert.equal(m.wd(['blueprints', 'new', 'b']).status, 0);
  const bare = m.wd(['blueprints', 'new']);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /several blueprints \(a, b\) and none is `proj`/);
  assert.equal(m.homes().length, 2);
});

test("committing one blueprint leaves the other's files as they are @rule:locations.default.in-repo-on-request", () => {
  const m = machine();
  assert.equal(m.wd(['blueprints', 'new', 'a', '--commit', 'spec']).status, 0);
  const aHome = m.homeOf('a');
  assert.ok(aHome.startsWith(join(m.proj, '.walkdown', 'blueprints') + '/'), 'the home sits under the repository');
  const ignore = join(aHome, '.gitignore');
  assert.match(readFileSync(ignore, 'utf8'), /^runs\/$/m, 'spec committed: the home keeps runs out');
  const theirs = `${readFileSync(ignore, 'utf8')}# and ours\n`;
  writeFileSync(ignore, theirs);

  const all = m.wd(['blueprints', 'new', 'b', '--commit', 'all']);
  assert.equal(all.status, 0, all.stderr);
  assert.equal(existsSync(join(m.homeOf('b'), '.gitignore')), false, 'everything committed: b has no .gitignore');
  assert.equal(readFileSync(ignore, 'utf8'), theirs, "a's own .gitignore is a's");
  assert.equal(existsSync(join(m.proj, '.walkdown', '.gitignore')), false, 'and none is shared between them');

  // Nothing again: b moves out whole, and a is still as it was.
  const none = m.wd(['blueprints', 'commit', 'none', '--blueprint', 'b']);
  assert.equal(none.status, 0, none.stderr);
  assert.ok(!m.homeOf('b').startsWith(m.proj), 'b left the repository');
  assert.equal(readFileSync(ignore, 'utf8'), theirs);
});

test('reads report on every blueprint, each under its ID, and on one when named @rule:locations.several.reads-cover-all', () => {
  const m = twoBlueprints();
  for (const cmd of [['status'], ['lint'], ['threads'], ['where']]) {
    const r = m.wd(cmd);
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
    const heads = [...r.stdout.matchAll(/━━ (\S+) ━━/g)].map((x) => x[1]);
    assert.equal(heads.length, 2, `${cmd}: one section each`);
    assert.match(heads[0], ID('proj'), `${cmd} sections, in registration order, by ID`);
    assert.match(heads[1], ID('b'));

    const json = m.wd([...cmd, '--json']);
    assert.equal(json.status, 0, `${cmd} --json: ${json.stderr}`);
    const answer = JSON.parse(json.stdout);
    assert.deepEqual(Object.keys(answer), ['blueprints']);
    assert.deepEqual(answer.blueprints.map((b) => nm(b.id)), ['proj', 'b']);

    const one = m.wd([...cmd, '--blueprint', 'b']);
    assert.equal(one.status, 0);
    assert.doesNotMatch(one.stdout, /━━/, `${cmd} --blueprint b is b alone`);
    const oneJson = JSON.parse(m.wd([...cmd, '--blueprint', 'b', '--json']).stdout);
    assert.ok(!('blueprints' in (Array.isArray(oneJson) ? {} : oneJson)), 'the single answer, as before');
  }
  // where <kind>: one line each, the ID and the path.
  const ev = m.wd(['where', 'evidence']).stdout.trim().split('\n');
  assert.deepEqual(ev.map((l) => nm(l.split('\t')[0])), ['proj', 'b']);
  assert.match(ev[1], /-b\/evidence$/);
});

test('a project with one blueprint prints what it printed before @rule:locations.several.reads-cover-all', () => {
  const m = machine();
  assert.equal(m.wd(['blueprints', 'new']).status, 0);
  for (const cmd of [['status'], ['lint'], ['threads'], ['where']]) {
    const r = m.wd(cmd);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /━━/, `${cmd}: no sections`);
    const json = JSON.parse(m.wd([...cmd, '--json']).stdout);
    assert.ok(Array.isArray(json) || !('blueprints' in json), `${cmd} --json is the single answer`);
  }
});

test('writes refuse until --blueprint names one, and the refusal lists the IDs @rule:locations.several.writes-name-one', () => {
  const m = twoBlueprints();
  // `run` is not among them: it runs the project's suite and files each
  // result by rule (several-project.test.js).
  const writes = [
    ['hash', '--write'],
    ['threads', 'new', '--screen', 'x', '--body', 'hello'],
    ['judge', 'some.rule'],
    ['sweep', '--why', 'because'],
    ['records', 'move', 'evidence', '--to', join(m.root, 'elsewhere')],
  ];
  for (const cmd of writes) {
    const r = m.wd(cmd);
    assert.equal(r.status, 2, `${cmd[0]} exits 2`);
    assert.match(r.stderr, /Several blueprints are registered for .*: \d{4}-[a-z0-9]+-proj, \d{4}-[a-z0-9]+-b\./, `${cmd[0]} names them`);
    assert.match(r.stderr, /Choose one with `--blueprint <id>` \(e\.g\. `--blueprint [\w-]+`\)/);
    assert.doesNotMatch(r.stderr, /No blueprint here/);
  }

  // With --blueprint b, a write acts on b alone.
  const filed = m.wd(['threads', 'new', '--blueprint', 'b', '--rule', 'x', '--body', 'hi']);
  assert.equal(filed.status, 2, 'b has no rule x - refused by b, not by the several');
  assert.match(filed.stderr, /No rule "x"/);
  const sweep = m.wd(['sweep', '--blueprint', 'b', '--why', 'because', '--tiers', 'agent']);
  assert.equal(sweep.status, 0, sweep.stderr);
  assert.equal(readdirSync(join(m.homeOf('b'), 'runs')).length, 1, 'the sweep landed in b');
  const projRuns = join(m.homeOf('proj'), 'runs');
  assert.ok(!existsSync(projRuns) || readdirSync(projRuns).length === 0, 'and not in proj');
});

test('a thread id only one blueprint holds is changed without --blueprint @rule:locations.several.writes-name-one', () => {
  const m = twoBlueprints();
  // A design request on a screen of b's own.
  writeFileSync(join(m.homeOf('b'), 'storyboard.yml'), 'screens:\n  - id: home\n    app: { path: /index.html }\n');
  const opened = m.wd(['threads', 'new', '--blueprint', 'b', '--screen', 'home', '--body', 'please draw this', '--json']);
  assert.equal(opened.status, 0, opened.stderr);
  const id = JSON.parse(opened.stdout).id;

  const reply = m.wd(['threads', 'reply', id, 'on it']);
  assert.equal(reply.status, 0, reply.stderr);
  const shown = JSON.parse(m.wd(['threads', 'show', id, '--json']).stdout);
  assert.equal(shown.replies.at(-1).body, 'on it');
});

test('"No blueprint here" is said only where none is registered @rule:locations.several.writes-name-one', () => {
  const m = machine();
  const none = m.wd(['status']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /No blueprint here/);
});
