/*
 * What the agent tier found on its first sitting over ADR 0014 (n-0369 to
 * n-0378): the paths the first round of tests did not drive. Each case here
 * is one finding, tagged with the rule it failed.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'walkdown-judged-')));
after(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let n = 0;
function machine() {
  const home = join(root, `home-${++n}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: sam\n');
  const env = { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: home };
  const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  const repo = (name) => {
    const dir = join(root, `m${n}`, name);
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    return dir;
  };
  const rows = () => parse(readFileSync(join(home, 'registry.yml'), 'utf8')).blueprints;
  return { home, env, cli, repo, rows };
}
const ok = (r) => {
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r;
};

test('lint warns before a commit that a teammate has taken the folder name, and a refused commit leaves no lock @rule:commands.blueprints.commit-moves-the-home', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'beta', '--folder', '202610-beta'));
  // A teammate's commit of a home in the same folder arrives.
  mkdirSync(join(shop, '.walkdown', 'blueprints', '202610-beta'), { recursive: true });
  writeFileSync(join(shop, '.walkdown', 'blueprints', '202610-beta', 'spec.yml'), 'blueprint: beta\n');
  const id = m.rows()[0].id;

  const linted = m.cli(shop, 'lint', '--blueprint', id);
  assert.match(linted.stdout + linted.stderr, /already committed under the same folder name/);
  assert.match(linted.stdout + linted.stderr, /`walkdown blueprints rename .* --folder <folder>`/);

  const refused = m.cli(shop, 'blueprints', 'commit', 'spec', '--blueprint', id);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /already committed in this repository/);
  assert.ok(!existsSync(join(m.home, 'registry.yml.lock')), 'the refusal let go of the registry');
  ok(m.cli(shop, 'blueprints', 'new', 'gamma'));
});

test('a home moved back out of the repository drops walkdown\'s .gitignore @rule:commands.blueprints.commit-moves-the-home', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'alpha', '--commit', 'spec', '--folder', 'alpha'));
  ok(m.cli(shop, 'blueprints', 'commit', 'none', '--blueprint', 'alpha'));
  const home = m.rows()[0].home.replace(/^~/, process.env.HOME);
  assert.ok(existsSync(join(home, 'spec.yml')));
  assert.ok(!existsSync(join(home, '.gitignore')), 'a commit choice means nothing outside a repository');
});

test('an unimported home standing in a partly imported checkout is named, with the command that imports it @rule:locations.answer.declared-not-discovered', () => {
  const m = machine();
  const repo = m.repo('rp');
  for (const f of ['202610-one', '202610-two', '202610-three']) {
    mkdirSync(join(repo, '.walkdown', 'blueprints', f), { recursive: true });
    writeFileSync(join(repo, '.walkdown', 'blueprints', f, 'spec.yml'), `blueprint: ${f.slice(7)}\n`);
  }
  ok(m.cli(repo, 'blueprints', 'import', repo, '--only', '202610-one,202610-two'));
  const three = join(repo, '.walkdown', 'blueprints', '202610-three');

  const where = m.cli(three, 'where');
  assert.match(where.stdout, /202610-three is a blueprint this machine has not imported — `walkdown blueprints import .*202610-three` registers it/);
  assert.doesNotMatch(where.stdout, /0001-rp-one/, 'and the other two are not answered for it');
  assert.doesNotMatch(where.stdout, /no row for this project/);
  const named = m.cli(repo, 'status', '--blueprint', 'three');
  assert.equal(named.status, 2);
  assert.match(named.stderr, /not imported — `walkdown blueprints import/);
  // Standing in an imported one answers for that one alone.
  assert.match(m.cli(join(repo, '.walkdown', 'blueprints', '202610-one'), 'where').stdout, /0001-rp-one/);
});

test('a draft saved in a home committed whole stays committed @rule:locations.default.in-repo-on-request', async () => {
  const m = machine();
  const repo = m.repo('all');
  ok(m.cli(repo, 'blueprints', 'new', 'all', '--commit', 'all', '--folder', 'all'));
  const home = join(repo, '.walkdown', 'blueprints', 'all');
  const { writeDraft } = await import('../lib/draft.js');
  writeDraft(join(home, 'drafts'), { actor: 'sam', started: '2026-10-01T00:00:00Z', verdicts: {} });
  assert.ok(!existsSync(join(home, 'drafts', '.gitignore')), 'no ignore file of its own overrules the home');
  const linted = m.cli(repo, 'lint');
  assert.doesNotMatch(linted.stdout + linted.stderr, /git disagrees|keeps .*drafts out/);
});

test('the pointer is written once, and taking it out keeps the person\'s own lines @rule:locations.pointer.owns-only-its-block', () => {
  const m = machine();
  const repo = m.repo('pt');
  const claude = join(repo, 'CLAUDE.md');
  writeFileSync(claude, 'Above.\r\n\r\n');
  ok(m.cli(repo, 'blueprints', 'new', 'a', '--commit', 'spec', '--folder', 'a'));
  const placed = readFileSync(claude, 'utf8');
  assert.match(placed, /walkdown:begin/);
  // The person's own words below, ending in blank lines.
  writeFileSync(claude, `${placed}Below.\n\n\n`);
  const withBelow = readFileSync(claude, 'utf8');

  // A person who deletes the block after the first commit meant it.
  writeFileSync(claude, 'Above.\r\n\r\nBelow.\n\n\n');
  ok(m.cli(repo, 'blueprints', 'new', 'b', '--commit', 'spec', '--folder', 'b'));
  assert.equal(readFileSync(claude, 'utf8'), 'Above.\r\n\r\nBelow.\n\n\n', 'a second commit writes no paragraph');

  // Taking it out removes the block and nothing else - not the blank lines below.
  writeFileSync(claude, withBelow);
  ok(m.cli(repo, 'blueprints', 'commit', 'none', '--blueprint', 'a'));
  ok(m.cli(repo, 'blueprints', 'commit', 'none', '--blueprint', 'b'));
  const left = readFileSync(claude, 'utf8');
  assert.doesNotMatch(left, /walkdown:begin/);
  assert.equal(left, withBelow.replace(/<!-- walkdown:begin -->[\s\S]*<!-- walkdown:end -->\r?\n/, ''));
  assert.match(left, /Below\.\n\n\n$/);
});

test('a checkout that moved keeps its IDs when it is imported where it went @rule:locations.registry.ids-stay-here', () => {
  const m = machine();
  const repo = m.repo('hireart_main');
  ok(m.cli(repo, 'blueprints', 'new', 'search', '--commit', 'spec', '--folder', 'search'));
  ok(m.cli(repo, 'blueprints', 'new', 'jot', '--folder', 'jot'));
  const before = m.rows();

  const moved = join(root, `m${n}`, 'hireart_moved');
  renameSync(repo, moved);
  const imported = ok(m.cli(moved, 'blueprints', 'import', moved, '--all'));
  assert.match(imported.stdout, new RegExp(`~ moved .* as \`${before[0].id}\`, still`));
  const after_ = m.rows();
  assert.deepEqual(after_.map((r) => r.id), before.map((r) => r.id), 'every ID kept');
  for (const r of after_) {
    assert.equal(r.checkout.replace(/^~/, process.env.HOME), moved, `${r.id} names the new place`);
    assert.equal(r.project, before[0].project);
  }
  assert.equal(after_[0].home.replace(/^~/, process.env.HOME), join(moved, '.walkdown', 'blueprints', 'search'));
  assert.equal(after_[1].home, before[1].home, 'a personal home stays where it is');
  ok(m.cli(moved, 'status', '--blueprint', 'jot'));
});

test('in a worktree, records.yml\'s answer says the worktree shares the registered home\'s @rule:locations.answer.says-why', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'gamma', '--commit', 'spec', '--folder', 'gamma'));
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'g');
  const wt = join(shop, '.claude', 'worktrees', 'w');
  git(shop, 'worktree', 'add', '-q', '-b', 'w', wt);
  const where = JSON.parse(ok(m.cli(wt, 'where', '--json')).stdout);
  assert.match(where.runs.why, /records\.yml .*git ignores runs, so every worktree shares them/);
  assert.equal(where.runs.path, join(shop, '.walkdown', 'blueprints', 'gamma', 'runs'));
  assert.match(where.threads.why, /records\.yml/);
  assert.doesNotMatch(where.threads.why, /shares them/, 'threads are committed, and follow the branch');
  assert.match(ok(m.cli(shop, 'where')).stdout, /registered by blueprints new/);
});

/* ---- the second sitting (rejudge of n-0369 to n-0378) -------------------- */

test('a record citing a label two threads share is refused, not written with the label @rule:locations.threads.uuid-is-the-identity', async () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'a', '--commit', 'spec', '--folder', 'a'));
  const home = join(shop, '.walkdown', 'blueprints', 'a');
  mkdirSync(join(home, 'threads'), { recursive: true });
  for (const [uuid, at] of [['11111111-1111-4111-8111-111111111111', '01'], ['22222222-2222-4222-8222-222222222222', '02']])
    writeFileSync(join(home, 'threads', `${uuid}.yml`), `id: n-0006\nuuid: ${uuid}\nkind: note\nauthor: sam\ncreated: 2026-10-${at}T00:00:00Z\nanchor: {}\nstatus: open\nbody: Seen.\n`);
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { writeRunRecord } from ${JSON.stringify(new URL('../lib/run-record.js', import.meta.url).pathname)};
       writeRunRecord({ blueprintDir: ${JSON.stringify(home)}, cwd: process.cwd(), target: 'local', actor: 'sam', kind: 'walkdown', results: [{ rule: 'x', status: 'fail', threads: ['n-0006'] }] });`,
    ],
    { cwd: shop, encoding: 'utf8', env: m.env },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /n-0006 labels 2 threads .* cite the one you mean by its UUID; nothing was recorded/);
  assert.ok(!existsSync(join(home, 'runs')) || !readdirSync(join(home, 'runs')).some((f) => f.endsWith('.json')), 'and nothing was');
});

test('a worktree made before its home was committed reads the registered home, and says so @rule:locations.answer.says-why', () => {
  const m = machine();
  const shop = m.repo('shop');
  writeFileSync(join(shop, 'README.md'), 'shop\n');
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'first');
  const wt = join(shop, '.claude', 'worktrees', 'early');
  git(shop, 'worktree', 'add', '-q', '-b', 'early', wt);
  ok(m.cli(shop, 'blueprints', 'new', 'x2', '--commit', 'spec', '--folder', 'x2'));
  const where = JSON.parse(ok(m.cli(wt, 'where', '--json')).stdout);
  assert.equal(where.spec.path, join(shop, '.walkdown', 'blueprints', 'x2'), 'the branch has no copy, so the registered one');
  assert.doesNotMatch(where.runs.why, /this branch's copy/);
});

test('blueprints new in a worktree says what git keeps out where the home is @rule:locations.default.in-repo-on-request', () => {
  const m = machine();
  const shop = m.repo('shop');
  writeFileSync(join(shop, 'README.md'), 'shop\n');
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'first');
  ok(m.cli(shop, 'blueprints', 'new', 'one'));
  const wt = join(shop, '.claude', 'worktrees', 'w');
  git(shop, 'worktree', 'add', '-q', '-b', 'w', wt);
  const made = ok(m.cli(wt, 'blueprints', 'new', 'z3', '--commit', 'spec', '--folder', 'z3'));
  assert.ok(existsSync(join(shop, '.walkdown', 'blueprints', 'z3', '.gitignore')));
  assert.match(made.stdout, /tracked: the spec and its threads/);
  assert.doesNotMatch(made.stdout, /tracked: everything/);
});

test('blank lines the person put after the block at the end of the file are theirs @rule:locations.pointer.owns-only-its-block', () => {
  const m = machine();
  const repo = m.repo('pt2');
  const claude = join(repo, 'CLAUDE.md');
  writeFileSync(claude, '# Ours\n\nabove.\n');
  ok(m.cli(repo, 'blueprints', 'new', 'a', '--commit', 'spec', '--folder', 'a'));
  writeFileSync(claude, `${readFileSync(claude, 'utf8')}\n\n`);
  const before = readFileSync(claude, 'utf8');
  ok(m.cli(repo, 'blueprints', 'commit', 'none', '--blueprint', 'a'));
  assert.equal(readFileSync(claude, 'utf8'), before.replace(/<!-- walkdown:begin -->[\s\S]*<!-- walkdown:end -->\n/, ''));
});

test('a moved checkout whose blueprints are all kept on this machine keeps their IDs on import @rule:locations.registry.ids-stay-here', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'search', '--folder', 'search'));
  const before = m.rows();
  const moved = join(root, `m${n}`, 'elsewhere', 'shop');
  mkdirSync(join(moved, '..'), { recursive: true });
  renameSync(shop, moved);
  const r = ok(m.cli(moved, 'blueprints', 'import', moved));
  assert.match(r.stdout, new RegExp(`~ moved .*\`${before[0].id}\``));
  const after_ = m.rows();
  assert.equal(after_[0].id, before[0].id);
  assert.equal(after_[0].checkout.replace(/^~/, process.env.HOME), moved);
  assert.equal(after_[0].home, before[0].home);
  ok(m.cli(moved, 'status'));
});

test('a renamed checkout with no remote and only personal homes is re-pointed when the person names its project @rule:locations.registry.ids-stay-here', () => {
  const m = machine();
  const deli = m.repo('deli');
  ok(m.cli(deli, 'blueprints', 'new', 'search', '--folder', 'search'));
  const [row] = m.rows();
  const renamed = join(root, `m${n}`, 'deli2');
  renameSync(deli, renamed);
  const asked = m.cli(renamed, 'blueprints', 'import', '.');
  assert.equal(asked.status, 2);
  assert.match(asked.stderr, /`deli`'s checkout .* is gone — if this is it, `walkdown blueprints import \. --project deli` points it here/);
  assert.equal(m.rows()[0].checkout, row.checkout, 'nothing is guessed');
  const r = ok(m.cli(renamed, 'blueprints', 'import', '.', '--project', 'deli'));
  assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``));
  assert.equal(m.rows()[0].id, row.id);
  assert.equal(m.rows()[0].checkout.replace(/^~/, process.env.HOME), renamed);
});

test('a moved checkout keeps its IDs though something new now stands at its old path @rule:locations.registry.ids-stay-here', () => {
  const m = machine();
  // Committed: matched by the home that is gone from its place.
  const hire = m.repo('hire');
  ok(m.cli(hire, 'blueprints', 'new', 'search', '--commit', 'spec', '--folder', 'search'));
  const [row] = m.rows();
  const hire2 = join(root, `m${n}`, 'hire2');
  renameSync(hire, hire2);
  mkdirSync(hire);
  git(hire, 'init', '-q');
  assert.match(ok(m.cli(hire2, 'blueprints', 'import', '.', '--all')).stdout, new RegExp(`~ moved .*\`${row.id}\``));
  assert.equal(m.rows()[0].id, row.id);
  assert.equal(m.rows()[0].checkout.replace(/^~/, process.env.HOME), hire2);

  // Personal, no remote: the person names it, and it moves.
  const deli = m.repo('deli');
  ok(m.cli(deli, 'blueprints', 'new', 'menu', '--folder', 'menu'));
  const menu = m.rows().find((r) => r.id.endsWith('-menu'));
  const deli2 = join(root, `m${n}`, 'deli2');
  renameSync(deli, deli2);
  mkdirSync(deli);
  git(deli, 'init', '-q');
  ok(m.cli(deli2, 'blueprints', 'import', '.', '--project', 'deli'));
  assert.equal(m.rows().find((r) => r.id === menu.id).checkout.replace(/^~/, process.env.HOME), deli2);
  assert.match(ok(m.cli(deli2, 'blueprints', 'import', '.', '--project', 'deli')).stdout, /already listed/);
  assert.notEqual(m.cli(deli, 'status').status, 0, 'and the new repository at the old path is nobody\'s');
});

test('a moved checkout keeps its IDs when its origin is cloned back at the old path @rule:locations.registry.ids-stay-here', () => {
  const m = machine();
  const app = m.repo('app');
  git(app, 'remote', 'add', 'origin', 'https://example.com/acme/origin-app.git');
  writeFileSync(join(app, 'README.md'), 'app\n');
  git(app, 'add', '-A');
  git(app, 'commit', '-q', '-m', 'first');
  ok(m.cli(app, 'blueprints', 'new', 'search', '--commit', 'spec', '--folder', 'search'));
  const [row] = m.rows();
  const old = join(root, `m${n}`, 'app-old');
  renameSync(app, old);
  // The same origin, cloned back where the checkout was - without the unpushed home.
  mkdirSync(app);
  git(app, 'init', '-q');
  git(app, 'remote', 'add', 'origin', 'https://example.com/acme/origin-app.git');
  const r = ok(m.cli(old, 'blueprints', 'import', '.', '--all'));
  assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``));
  assert.equal(m.rows().length, 1, 'no second row');
  assert.equal(m.rows()[0].checkout.replace(/^~/, process.env.HOME), old);
});

test('inside a project, ?bp= takes the name alone though another project has one too @rule:locations.registry.ids-stay-here', async () => {
  const m = machine();
  const shop = m.repo('shop');
  const deli = m.repo('deli');
  ok(m.cli(shop, 'blueprints', 'new', 'search'));
  ok(m.cli(deli, 'blueprints', 'new', 'search'));
  const ours = m.rows().find((r) => r.project === 'shop');
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { cwd: shop, env: m.env });
  try {
    const out = await new Promise((yes, no) => {
      let said = '';
      const timer = setTimeout(() => no(new Error(`no answer: ${said}`)), 10_000);
      const take = (d) => {
        said += d;
        if (/review:\s+http:\/\/localhost:\d+/.test(said)) clearTimeout(timer), yes(said);
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
    });
    const port = out.match(/localhost:(\d+)/)[1];
    const r = await fetch(`http://localhost:${port}/api/blueprint?bp=search`);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).key, ours.home.replace(/^~/, process.env.HOME));
  } finally {
    child.kill();
  }
});

test('check source shows each check in full: past 40 lines, and not into the next @rule:panel.rules.evidence-visible', async () => {
  const { checkSnippet } = await import('../lib/api.js');
  const dir = join(root, 'snippet');
  mkdirSync(join(dir, 'checks'), { recursive: true });
  const long = Array.from({ length: 48 }, (_, i) => `  await step(${i});`);
  writeFileSync(
    join(dir, 'checks', 'a.spec.js'),
    ["test('long', async () => {", ...long, '});', '', '// the next check says why', "test('next', async () => {", '  await step();', '});', ''].join('\n'),
  );
  const first = checkSnippet(dir, 'checks/a.spec.js:1').source.split('\n');
  assert.equal(first.length, 50, 'opener, 48 lines and its close');
  assert.equal(first.at(-1), '});');
  const second = checkSnippet(dir, 'checks/a.spec.js:53').source;
  assert.equal(second, "test('next', async () => {\n  await step();\n});");
});

test('check source keeps a check whose opener spans lines, and an rspec example to its end @rule:panel.rules.evidence-visible', async () => {
  const { checkSnippet } = await import('../lib/api.js');
  const dir = join(root, 'snippet2');
  mkdirSync(join(dir, 'spec'), { recursive: true });
  writeFileSync(join(dir, 'spec', 'a.spec.js'), "test('x', {\n  tag: '@smoke',\n}, () => {\n  expect('}').ok();\n});\n\ntest('y', () => {});\n");
  assert.equal(checkSnippet(dir, 'spec/a.spec.js:1').source, "test('x', {\n  tag: '@smoke',\n}, () => {\n  expect('}').ok();\n});");
  writeFileSync(join(dir, 'spec', 'b.spec.js'), "test('z', () => {\n  expect(t).toMatch(/walkdown's \\(own\\)/);\n});\n\ntest('w', () => {});\n");
  assert.equal(checkSnippet(dir, 'spec/b.spec.js:1').source.split('\n').length, 3, 'a regex holding a quote and an escaped bracket');
  writeFileSync(join(dir, 'spec', 'a_spec.rb'), "  it 'works' do\n    expect(1).to eq 1\n  end\n\n  it 'next' do\n  end\n");
  assert.equal(checkSnippet(dir, 'spec/a_spec.rb:1').source, "  it 'works' do\n    expect(1).to eq 1\n  end");
});

test('a pushed home keeps its ID when its checkout moves and the origin is cloned at the old path @rule:locations.registry.ids-stay-here', () => {
  const m = machine();
  const base = join(root, `m${n}`);
  const origin = join(base, 'origin.git');
  mkdirSync(base, { recursive: true });
  git(base, 'init', '-q', '--bare', origin);
  const pub = join(base, 'pub');
  git(base, 'clone', '-q', origin, pub);
  ok(m.cli(pub, 'blueprints', 'new', 'site', '--folder', 'site', '--commit', 'spec'));
  const [row] = m.rows();
  // A run, which git ignores, so only this tree has it.
  const runs = join(pub, '.walkdown', 'blueprints', 'site', 'runs');
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, '2026-10-01T00-00-00Z-local-01.json'), '{}');
  git(pub, 'add', '-A');
  git(pub, 'commit', '-q', '-m', 'site');
  git(pub, 'push', '-q', 'origin', 'HEAD');
  const old = join(base, 'pub-old');
  renameSync(pub, old);
  git(base, 'clone', '-q', origin, pub);
  const r = ok(m.cli(old, 'blueprints', 'import', '.', '--all'));
  assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``));
  const [after_, ...more] = m.rows();
  assert.equal(more.length, 0, 'no second row');
  assert.equal(after_.checkout.replace(/^~/, process.env.HOME), old);
  assert.equal(after_.home.replace(/^~/, process.env.HOME), join(old, '.walkdown', 'blueprints', 'site'));
  // The fresh clone is the moved checkout's copy now, and reads its runs.
  const w = JSON.parse(ok(m.cli(pub, 'where', '--json')).stdout);
  assert.equal(w.runs.path, runs.replace(pub, old));
});

test('a moved checkout whose only records are a draft, or whose runs were moved, still keeps its ID @rule:locations.registry.ids-stay-here', () => {
  for (const variant of ['draft', 'runs-moved']) {
    const m = machine();
    const base = join(root, `m${n}`);
    mkdirSync(base, { recursive: true });
    const origin = join(base, 'origin.git');
    git(base, 'init', '-q', '--bare', origin);
    const app = join(base, 'app');
    git(base, 'clone', '-q', origin, app);
    ok(m.cli(app, 'blueprints', 'new', 'ui', '--folder', 'ui', '--commit', 'spec'));
    const home = join(app, '.walkdown', 'blueprints', 'ui');
    git(app, 'add', '-A');
    git(app, 'commit', '-q', '-m', 'ui');
    git(app, 'push', '-q', 'origin', 'HEAD');
    if (variant === 'draft') {
      mkdirSync(join(home, 'drafts'), { recursive: true });
      writeFileSync(join(home, 'drafts', 'local.json'), '{}');
    } else {
      ok(m.cli(app, 'records', 'move', 'runs', '--to', join(base, 'kept-runs')));
      mkdirSync(join(home, 'evidence', 'x'), { recursive: true });
      writeFileSync(join(home, 'evidence', 'x', 'a.txt'), 'seen');
    }
    const [row] = m.rows();
    const old = join(base, 'app-old');
    renameSync(app, old);
    git(base, 'clone', '-q', origin, app);
    const r = ok(m.cli(old, 'blueprints', 'import', '.', '--all'));
    assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``), variant);
    assert.equal(m.rows()[0].checkout.replace(/^~/, process.env.HOME), old, variant);
  }
});

test('a checkout moved with its runs moved into a folder inside it keeps its ledger @rule:locations.registry.ids-stay-here', () => {
  const m = machine();
  const inn = m.repo('inn');
  ok(m.cli(inn, 'blueprints', 'new', 'web', '--folder', 'web', '--commit', 'spec'));
  ok(m.cli(inn, 'records', 'move', 'runs', '--to', join(inn, 'wd-runs')));
  writeFileSync(join(inn, 'wd-runs', '2026-10-01T00-00-00Z-local-01.json'), '{}');
  const [row] = m.rows();
  const old = join(root, `m${n}`, 'inn-old');
  renameSync(inn, old);
  const r = ok(m.cli(old, 'blueprints', 'import', '.', '--all'));
  assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``));
  const [after_] = m.rows();
  assert.equal(after_.runs.replace(/^~/, process.env.HOME), join(old, 'wd-runs'), 'the runs folder came along');
  assert.equal(JSON.parse(ok(m.cli(old, 'where', '--json')).stdout).runs.path, join(old, 'wd-runs'));
});

test('runs moved inside the checkout follow a move past a fresh clone, and a path spelled another way still follows @rule:locations.registry.ids-stay-here', () => {
  // Re-cloned at the old path, with the runs in a folder inside the checkout.
  {
    const m = machine();
    const base = join(root, `m${n}`);
    mkdirSync(base, { recursive: true });
    const origin = join(base, 'origin.git');
    git(base, 'init', '-q', '--bare', origin);
    const ric = join(base, 'ric');
    git(base, 'clone', '-q', origin, ric);
    writeFileSync(join(ric, '.gitignore'), 'wd-runs/\n');
    ok(m.cli(ric, 'blueprints', 'new', 'web', '--folder', 'web', '--commit', 'spec'));
    ok(m.cli(ric, 'records', 'move', 'runs', '--to', join(ric, 'wd-runs')));
    writeFileSync(join(ric, 'wd-runs', '2026-10-01T00-00-00Z-local-01.json'), '{}');
    git(ric, 'add', '-A');
    git(ric, 'commit', '-q', '-m', 'web');
    git(ric, 'push', '-q', 'origin', 'HEAD');
    const [row] = m.rows();
    const old = join(base, 'ric-old');
    renameSync(ric, old);
    git(base, 'clone', '-q', origin, ric);
    const r = ok(m.cli(old, 'blueprints', 'import', '.', '--all'));
    assert.match(r.stdout, new RegExp(`~ moved .*\`${row.id}\``));
    assert.equal(m.rows()[0].runs.replace(/^~/, process.env.HOME), join(old, 'wd-runs'));
  }
  // A runs path through another spelling of the same folder: case, where the disk folds it.
  if (process.platform === 'darwin') {
    const m = machine();
    const caps = m.repo('Caps');
    ok(m.cli(caps, 'blueprints', 'new', 'web', '--folder', 'web', '--commit', 'spec'));
    const lower = join(root, `m${n}`, 'caps', 'wd-runs');
    ok(m.cli(caps, 'records', 'move', 'runs', '--to', lower));
    const old = join(root, `m${n}`, 'Caps-old');
    renameSync(caps, old);
    ok(m.cli(old, 'blueprints', 'import', '.', '--all'));
    assert.equal(m.rows()[0].runs.replace(/^~/, process.env.HOME), join(old, 'wd-runs'));
  }
});

test('rename --folder refuses a folder name a committed sibling already has @rule:commands.blueprints.rename', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'a', '--folder', '202610-a'));
  ok(m.cli(shop, 'blueprints', 'new', 'b', '--folder', '202610-search', '--commit', 'spec'));
  const before = readFileSync(join(m.home, 'registry.yml'), 'utf8');
  const r = m.cli(shop, 'blueprints', 'rename', 'a', 'a2', '--folder', '202610-search');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /already holds a blueprint of project `shop` under the folder name `202610-search`/);
  assert.equal(readFileSync(join(m.home, 'registry.yml'), 'utf8'), before, 'nothing was renamed');
  // And the other way: a committed home onto a folder name kept on this machine.
  const back = m.cli(shop, 'blueprints', 'rename', 'b', 'b2', '--folder', '202610-a');
  assert.equal(back.status, 2, back.stdout + back.stderr);
  ok(m.cli(shop, 'blueprints', 'rename', 'a', 'a2', '--folder', '202610-free'));
});

test('rename refuses a name shaped like an ID, makes a nested folder, and finds the personal root alone @rule:commands.blueprints.rename', () => {
  const m = machine();
  const shop = m.repo('shop');
  ok(m.cli(shop, 'blueprints', 'new', 'a', '--folder', '202610-a'));
  ok(m.cli(shop, 'blueprints', 'new', 'b', '--folder', '202610-b', '--commit', 'spec'));
  const a = m.rows().find((r) => r.id.endsWith('-a'));
  const idShaped = m.cli(shop, 'blueprints', 'rename', 'b', a.id);
  assert.equal(idShaped.status, 2, idShaped.stdout + idShaped.stderr);
  assert.match(idShaped.stderr, /reads as an ID/);
  // A folder below one that does not exist yet.
  ok(m.cli(shop, 'blueprints', 'rename', 'b', 'b', '--folder', 'teams/b'));
  assert.ok(existsSync(join(shop, '.walkdown', 'blueprints', 'teams', 'b', 'spec.yml')));

  // A lone committed home, and a folder of that name left in the personal root.
  const n2 = machine();
  const solo = n2.repo('solo');
  ok(n2.cli(solo, 'blueprints', 'new', 'c', '--folder', '202610-c', '--commit', 'spec'));
  const left = join(n2.home, 'projects', 'solo', 'blueprints', '202610-old');
  mkdirSync(left, { recursive: true });
  writeFileSync(join(left, 'spec.yml'), 'blueprint: old\n');
  const onto = n2.cli(solo, 'blueprints', 'rename', 'c', 'c', '--folder', '202610-old');
  assert.equal(onto.status, 2, onto.stdout + onto.stderr);
  assert.match(onto.stderr, /already holds a blueprint of project `solo`/);
});
