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
  assert.ok(m.homes().includes('b'), 'in a folder named after the blueprint');
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
  assert.match(moved.stderr, /`walkdown blueprints commit spec` acts on one blueprint.*This project's blueprints are \d{4}-[a-z0-9]+-proj, \d{4}-[a-z0-9]+-b\./s);
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
  assert.match(ev[1], /\/b\/evidence$/);
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

/* Every file under the machine's home and the project, by path: what a refused write must leave as it was. */
function snapshot(m) {
  const files = {};
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files[p] = readFileSync(p, 'utf8');
    }
  };
  walk(m.home);
  walk(m.proj);
  return files;
}

/* Every command that writes into a blueprint or acts on one, with no --blueprint. */
const writes = (m, thread) => [
  ['hash', '--write'],
  ['threads', 'new', '--screen', 'home', '--body', 'hello'],
  ['threads', 'reply', thread, 'on it'],
  ['threads', 'set', thread, '--status', 'addressed'],
  ['threads', 'relabel', thread, '--yes'],
  ['judge', 'some.rule'],
  ['sweep', '--why', 'because'],
  ['records', 'move', 'evidence', '--to', join(m.root, 'elsewhere')],
  ['rules', 'rename', 'some.rule', 'some.other'],
  ['rules', 'move', 'some.rule', '--to', 'b'],
  ['blueprints', 'commit', 'none'],
];

/* Each of `writes` run at `cwd` is refused, lists `names`, and changes nothing. */
function refusedEverywhere(m, thread, cwd, names) {
  const listed = names.map((n) => `\\d{4}-[a-z0-9]+-${n}`).join(', ');
  const said = names.length === 1 ? `This project's blueprint is ${listed}\\.` : `This project's blueprints are ${listed}\\.`;
  for (const cmd of writes(m, thread)) {
    const before = snapshot(m);
    const r = m.wd(cmd, cwd);
    const what = cmd.slice(0, 2).join(' ');
    assert.equal(r.status, 2, `${what} exits 2: ${r.stderr}${r.stdout}`);
    assert.match(r.stderr, /acts on one blueprint, and does not choose it for you\./, `${what} says it acts on one`);
    assert.match(r.stderr, new RegExp(said), `${what} lists the project's blueprints`);
    assert.match(r.stderr, /Choose one with `--blueprint <id>` \(e\.g\. `--blueprint [\w-]+`\)/, `${what} says --blueprint picks one`);
    assert.doesNotMatch(r.stderr, /No blueprint here/, `${what}: blueprints are registered here`);
    assert.deepEqual(snapshot(m), before, `${what} changed nothing`);
  }
}

/* A project holding `a`, committed into the repository so it has a folder there, and `b`. */
function aInTheRepo() {
  const m = machine();
  assert.equal(m.wd(['blueprints', 'new', 'a', '--commit', 'spec']).status, 0);
  assert.equal(m.wd(['blueprints', 'new', 'b']).status, 0);
  writeFileSync(join(m.homeOf('b'), 'storyboard.yml'), 'screens:\n  - id: home\n    app: { path: /index.html }\n');
  const opened = m.wd(['threads', 'new', '--blueprint', 'b', '--screen', 'home', '--body', 'please draw this', '--json']);
  assert.equal(opened.status, 0, opened.stderr);
  return { ...m, thread: JSON.parse(opened.stdout).id };
}

test('writes refuse until --blueprint names one, at the root and inside a blueprint, and the refusal lists the IDs @rule:locations.several.writes-name-one', () => {
  const m = aInTheRepo();
  const aDir = m.homeOf('a');
  assert.ok(aDir.startsWith(m.proj + '/'), "a's folder is inside the repository");
  // `run` is not among them: it runs the project's suite and files each
  // result by rule (several-project.test.js).
  refusedEverywhere(m, m.thread, m.proj, ['a', 'b']);
  // Standing in a's folder does not choose a.
  refusedEverywhere(m, m.thread, aDir, ['a', 'b']);
  refusedEverywhere(m, m.thread, join(aDir, 'features'), ['a', 'b']);

  // With --blueprint b, a write acts on b alone.
  const filed = m.wd(['threads', 'new', '--blueprint', 'b', '--rule', 'x', '--body', 'hi']);
  assert.equal(filed.status, 2, 'b has no rule x - refused by b, not for want of --blueprint');
  assert.match(filed.stderr, /No rule "x"/);
  const sweep = m.wd(['sweep', '--blueprint', 'b', '--why', 'because', '--tiers', 'agent'], aDir);
  assert.equal(sweep.status, 0, sweep.stderr);
  assert.equal(readdirSync(join(m.homeOf('b'), 'runs')).length, 1, 'the sweep landed in b, though run inside a');
  const aRuns = join(aDir, 'runs');
  assert.ok(!existsSync(aRuns) || readdirSync(aRuns).length === 0, 'and not in a');
});

test('a project of one blueprint refuses a write without --blueprint too, naming it @rule:locations.several.writes-name-one', () => {
  const m = machine();
  assert.equal(m.wd(['blueprints', 'new', 'c']).status, 0);
  writeFileSync(join(m.homeOf('c'), 'storyboard.yml'), 'screens:\n  - id: home\n    app: { path: /index.html }\n');
  const opened = m.wd(['threads', 'new', '--blueprint', 'c', '--screen', 'home', '--body', 'please draw this', '--json']);
  assert.equal(opened.status, 0, opened.stderr);
  refusedEverywhere(m, JSON.parse(opened.stdout).id, m.proj, ['c']);
});

test('blueprints commit --blueprint works from anywhere below the checkout, and from inside a home kept in the personal home @rule:locations.several.writes-name-one', () => {
  const m = twoBlueprints();
  const deep = join(m.proj, 'sub', 'deep');
  mkdirSync(deep, { recursive: true });
  const repoHomes = join(m.proj, '.walkdown', 'blueprints');

  // From a folder two levels below the checkout, by the short name.
  const fromDeep = m.wd(['blueprints', 'commit', 'spec', '--blueprint', 'b'], deep);
  assert.equal(fromDeep.status, 0, fromDeep.stderr + fromDeep.stdout);
  assert.doesNotMatch(fromDeep.stderr, /No blueprint `b` in this project/);
  assert.ok(m.homeOf('b').startsWith(repoHomes + '/'), 'b moved into the repository');

  // From inside proj's own home, which is still in the personal home.
  const personal = m.homeOf('proj');
  assert.ok(personal.startsWith(m.home + '/'), 'proj is kept outside the repository');
  const fromHome = m.wd(['blueprints', 'commit', 'spec', '--blueprint', 'proj'], personal);
  assert.equal(fromHome.status, 0, fromHome.stderr + fromHome.stdout);
  assert.ok(m.homeOf('proj').startsWith(repoHomes + '/'), 'proj moved into the repository');

  // And back out again, from below the checkout.
  const out = m.wd(['blueprints', 'commit', 'none', '--blueprint', 'b'], deep);
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.ok(m.homeOf('b').startsWith(m.home + '/'), 'b left the repository');
});

test('inside a home kept in the personal home, a write without --blueprint lists the project, and a short name resolves @rule:locations.several.writes-name-one', () => {
  const m = aInTheRepo();
  const bHome = m.homeOf('b');
  assert.ok(bHome.startsWith(join(m.home, 'projects', 'proj', 'blueprints') + '/'), "b's home is in the personal home");
  // Refused as a write among a and b, never "No blueprint here".
  refusedEverywhere(m, m.thread, bHome, ['a', 'b']);
  refusedEverywhere(m, m.thread, join(bHome, 'features'), ['a', 'b']);

  // --blueprint by the short name reaches each from there.
  const reply = m.wd(['threads', 'reply', m.thread, 'from inside b', '--blueprint', 'b'], bHome);
  assert.equal(reply.status, 0, reply.stderr);
  const sweep = m.wd(['sweep', '--blueprint', 'a', '--why', 'because', '--tiers', 'agent'], bHome);
  assert.equal(sweep.status, 0, sweep.stderr);
  assert.equal(readdirSync(join(m.homeOf('a'), 'runs')).length, 1, 'the sweep landed in a, though run inside b');
});

test('a thread id only one blueprint holds is not enough without --blueprint; with it the change lands there @rule:locations.several.writes-name-one', () => {
  const m = aInTheRepo();
  const before = snapshot(m);
  const bare = m.wd(['threads', 'reply', m.thread, 'on it']);
  assert.equal(bare.status, 2, 'only b holds it, and still b is not chosen');
  assert.match(bare.stderr, /`walkdown threads reply` acts on one blueprint/);
  assert.deepEqual(snapshot(m), before, 'and nothing changed');

  // Reading it still finds it, wherever it is.
  const shown = m.wd(['threads', 'show', m.thread, '--json']);
  assert.equal(shown.status, 0, shown.stderr);

  const reply = m.wd(['threads', 'reply', m.thread, 'on it', '--blueprint', 'b']);
  assert.equal(reply.status, 0, reply.stderr);
  const after = JSON.parse(m.wd(['threads', 'show', m.thread, '--json']).stdout);
  assert.equal(after.replies.at(-1).body, 'on it');
});

test('"No blueprint here" is said only where none is registered @rule:locations.several.writes-name-one', () => {
  const m = machine();
  const none = m.wd(['status']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /No blueprint here/);
});
