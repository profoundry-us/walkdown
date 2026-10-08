/*
 * RULES MOVE BETWEEN A PROJECT'S BLUEPRINTS WITH THEIR HISTORY (ADR 0013 §5).
 *
 * A story of two rules in `a` - checked, judged by the agent with evidence,
 * signed, swept, and argued over in threads with a picture - moves to `b`.
 * Afterwards b shows each rule exactly as a did, and a's run records are
 * byte for byte what they were.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { threadAt } from '../tools/test-home.mjs';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

function fixture({ commit = 'none' } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wd-move-')));
  roots.push(root);
  const home = join(root, 'home');
  const shop = join(root, 'shop');
  mkdirSync(shop, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = (...a) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
      cwd: shop,
      encoding: 'utf8',
    });
  git('init', '-q');
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: topher\n');
  const env = {
    ...process.env,
    WALKDOWN_HOME: home,
    WALKDOWN_SKILLS_DIR: join(home, 'skills'),
    NO_COLOR: '1',
  };
  delete env.WALKDOWN_SPEC;
  const wd = (args, cwd = shop) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  for (const id of ['a', 'b'])
    assert.equal(
      wd(['blueprints', 'new', id, ...(commit === 'none' ? [] : ['--commit', commit])]).status,
      0,
    );
  const at = (id) => JSON.parse(wd(['where', '--blueprint', id, '--json']).stdout);
  const A = at('a');
  const B = at('b');
  writeFileSync(
    join(A.spec.path, 'features', 'shop.yml'),
    [
      '# The shop, as a shopper meets it.',
      'feature: shop',
      'stories:',
      '  - id: shop.cart',
      '    title: A cart',
      '    statement: As a shopper I keep things in a cart.',
      '    rules:',
      '      # The first thing anyone tries.',
      '      - id: shop.cart.add',
      '        statement: Adding an item puts it in the cart.',
      '        verify: [checks, agent]',
      '        signoff: [eng]',
      '        steps:',
      '          then: [It is in the cart]',
      '      - id: shop.cart.remove',
      '        statement: Removing an item takes it out.',
      '        verify: [checks]',
      '        signoff: [eng]',
      '        steps:',
      '          then: [It is gone]',
      '  - id: shop.pay',
      '    title: Paying',
      '    statement: As a shopper I pay.',
      '    rules:',
      '      - id: shop.pay.card',
      '        statement: A card payment goes through, whichever card it is, and the receipt names the card it went through on, by its last four digits.',
      '        verify: [checks]',
      '        steps:',
      '          then: [It is paid]',
      '',
    ].join('\n'),
  );
  assert.equal(wd(['hash', '--write', '--blueprint', 'a']).status, 0);
  const hash = (rule) =>
    JSON.parse(wd(['status', rule, '--blueprint', 'a', '--json']).stdout).statement_hash ?? null;
  const hashes = Object.fromEntries(
    ['shop.cart.add', 'shop.cart.remove', 'shop.pay.card'].map((r) => {
      const text = readFileSync(join(A.spec.path, 'features', 'shop.yml'), 'utf8');
      const m = text.split(`- id: ${r}`)[1].match(/statement_hash: (sha256:[0-9a-f]+)/);
      return [r, m?.[1] ?? hash(r)];
    }),
  );
  // The history: a checks run over all three, the agent's pass with a
  // picture, a signature, and a sweep.
  mkdirSync(A.runs.path, { recursive: true });
  const put = (name, record) =>
    writeFileSync(
      join(A.runs.path, `${name}.json`),
      `${JSON.stringify({ run_id: name, ...record }, null, 2)}\n`,
    );
  put('2026-10-01T10-00-00Z-local-01', {
    created: '2026-10-01T10:00:00Z',
    actor: 'topher',
    kind: 'checks',
    target: 'local',
    results: ['shop.cart.add', 'shop.cart.remove', 'shop.pay.card'].map((rule) => ({
      rule,
      status: 'pass',
      statement_hash: hashes[rule],
      checks: ['t.js:1'],
    })),
  });
  put('2026-10-01T11-00-00Z-local-01', {
    created: '2026-10-01T11:00:00Z',
    actor: 'agent',
    kind: 'walkdown',
    target: 'local',
    results: [
      {
        rule: 'shop.cart.add',
        status: 'pass',
        statement_hash: hashes['shop.cart.add'],
        evidence: ['runs/evidence/2026-10-01T11-00-00Z/cart.png'],
        reasoning: 'Seen in the cart.',
      },
    ],
  });
  mkdirSync(join(A.evidence.path, '2026-10-01T11-00-00Z'), { recursive: true });
  writeFileSync(join(A.evidence.path, '2026-10-01T11-00-00Z', 'cart.png'), PNG);
  put('2026-10-01T12-00-00Z-local-01', {
    created: '2026-10-01T12:00:00Z',
    actor: 'topher',
    kind: 'walkdown',
    target: 'local',
    signatures: [{ role: 'eng', signer: 'topher' }],
    results: [{ rule: 'shop.cart.add', status: 'pass', statement_hash: hashes['shop.cart.add'] }],
  });
  put('2026-10-01T13-00-00Z-local-01', {
    created: '2026-10-01T13:00:00Z',
    actor: 'topher',
    kind: 'sweep',
    target: 'local',
    tiers: ['checks'],
    why: 'every check again',
    results: [],
  });
  // Threads: one on a moving rule with a picture, one on the rule that stays.
  const pic = join(root, 'seen.png');
  writeFileSync(pic, PNG);
  const t1 = wd([
    'threads',
    'new',
    '--blueprint',
    'a',
    '--rule',
    'shop.cart.add',
    '--body',
    'The badge is late.',
    '--attach',
    pic,
    '--json',
  ]);
  assert.equal(t1.status, 0, t1.stderr);
  assert.equal(
    wd([
      'threads',
      'new',
      '--blueprint',
      'a',
      '--rule',
      'shop.pay.card',
      '--body',
      'Declines are quiet.',
    ]).status,
    0,
  );
  if (commit !== 'none') {
    git('add', '-A');
    git('commit', '-qm', 'fixture');
  }
  const runsOf = (loc) =>
    existsSync(loc.runs.path)
      ? readdirSync(loc.runs.path)
          .filter((f) => f.endsWith('.json'))
          .sort()
      : [];
  const snapshot = () =>
    Object.fromEntries(runsOf(A).map((f) => [f, readFileSync(join(A.runs.path, f), 'utf8')]));
  const row = (bp, rule) => {
    const r = JSON.parse(wd(['status', '--blueprint', bp, '--json']).stdout).rows.find(
      (x) => x.rule === rule,
    );
    return (
      r && {
        verdict: r.verdict,
        checks: r.cells.local?.state,
        agent: r.agent.state,
        acceptance: r.acceptance.map((x) => [x.role, x.state]),
      }
    );
  };
  return {
    root,
    home,
    shop,
    wd,
    git,
    A,
    B,
    runsOf,
    snapshot,
    row,
    thread: JSON.parse(t1.stdout).id,
  };
}

test('a story moves with its threads, and its verdicts and signatures read the same in the new blueprint @rule:locations.several.rules-move', () => {
  const f = fixture();
  const before = {
    add: f.row('a', 'shop.cart.add'),
    remove: f.row('a', 'shop.cart.remove'),
    yaml: readFileSync(join(f.A.spec.path, 'features', 'shop.yml'), 'utf8'),
  };
  // The fixture reads as intended: the sweep made the checks stale, the
  // agent's pass and the signature stand.
  assert.equal(before.add.checks, 'stale');
  assert.equal(before.add.agent, 'pass');
  const ledger = f.snapshot();

  const dry = f.wd(['rules', 'move', 'shop.cart', '--blueprint', 'a', '--to', 'b', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /2 rule\(s\) from `a` to `b`: shop\.cart\.add, shop\.cart\.remove/);
  assert.match(dry.stdout, /1 thread\(s\) moved, keeping their ids: n-0001/);
  assert.match(
    dry.stdout,
    /3 run record\(s\) copied, holding only these rules' results, and 1 sweep\(s\)/,
  );
  assert.match(dry.stdout, /1 piece\(s\) of evidence copied/);
  assert.match(dry.stdout, /Nothing was changed/);
  assert.deepEqual(f.runsOf(f.B), [], 'the dry run changed nothing');
  assert.ok(
    readFileSync(join(f.A.spec.path, 'features', 'shop.yml'), 'utf8').includes('shop.cart.add'),
  );

  const moved = f.wd(['rules', 'move', 'shop.cart', '--blueprint', 'a', '--to', 'b']);
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(moved.stdout, /✓ moved 2 rule\(s\)/);

  // The YAML: out of a, into b's shop.yml, node for node - comment and hash.
  const aYaml = readFileSync(join(f.A.spec.path, 'features', 'shop.yml'), 'utf8');
  const bYaml = readFileSync(join(f.B.spec.path, 'features', 'shop.yml'), 'utf8');
  assert.doesNotMatch(aYaml, /shop\.cart/);
  assert.match(aYaml, /shop\.pay\.card/);
  // Written as it was written: every line left in a, and every line that
  // arrived in b, is a line of a's file before - none re-wrapped or re-padded.
  for (const line of [...aYaml.split('\n'), ...bYaml.split('\n')].filter(
    (l) => l.trim() && !/^(feature|stories):/.test(l),
  ))
    assert.ok(
      before.yaml.includes(`${line}\n`),
      `a line as it was written: ${JSON.stringify(line)}`,
    );
  assert.match(bYaml, /verify: \[checks, agent\]/);
  assert.match(bYaml, /^feature: shop$/m);
  assert.match(bYaml, /# The first thing anyone tries\.\n\s+- id: shop\.cart\.add/);
  assert.equal((bYaml.match(/statement_hash: sha256:/g) ?? []).length, 2);
  assert.equal(
    f.wd(['hash', '--blueprint', 'b']).stdout.includes('stale'),
    false,
    'hashes still match their words',
  );

  // Threads moved, ids kept, the picture with them; the other stayed.
  assert.ok(existsSync(threadAt(f.B.threads.path, f.thread)));
  assert.equal(existsSync(threadAt(f.A.threads.path, f.thread)), false);
  const pic = readFileSync(threadAt(f.B.threads.path, f.thread), 'utf8').match(
    /attachments\/[\w.-]+/,
  )[0];
  assert.ok(existsSync(join(f.B.threads.path, pic)));
  assert.ok(existsSync(threadAt(f.A.threads.path, 'n-0002')));

  // Copied records: only the moved rules' results, saying whence.
  const copies = f.runsOf(f.B).map((n) => JSON.parse(readFileSync(join(f.B.runs.path, n), 'utf8')));
  assert.equal(copies.length, 4);
  for (const c of copies) assert.deepEqual(c.copied_from.blueprint, 'a');
  const checks = copies.find((c) => c.kind === 'checks');
  assert.deepEqual(
    checks.results.map((r) => r.rule),
    ['shop.cart.add', 'shop.cart.remove'],
  );
  assert.equal(checks.run_id, '2026-10-01T10-00-00Z-local-01');
  assert.equal(checks.created, '2026-10-01T10:00:00Z');
  assert.equal(checks.actor, 'topher');
  assert.ok(existsSync(join(f.B.evidence.path, '2026-10-01T11-00-00Z', 'cart.png')));

  // a's ledger is exactly what it was.
  assert.deepEqual(f.snapshot(), ledger);

  // And b reads them as a did.
  assert.deepEqual(f.row('b', 'shop.cart.add'), before.add);
  assert.deepEqual(f.row('b', 'shop.cart.remove'), before.remove);
  assert.equal(f.row('a', 'shop.cart.add'), undefined);
});

test('one rule moves into a story of the same id, created for it @rule:locations.several.rules-move', () => {
  const f = fixture();
  const out = f.wd(['rules', 'move', 'shop.pay.card', '--blueprint', 'a', '--to', 'b']);
  assert.equal(out.status, 0, out.stderr);
  const bYaml = readFileSync(join(f.B.spec.path, 'features', 'shop.yml'), 'utf8');
  assert.match(
    bYaml,
    /- id: shop\.pay\n\s+title: Paying\n\s+statement: As a shopper I pay\.\n\s+rules:\n\s+- id: shop\.pay\.card/,
  );
  assert.doesNotMatch(
    readFileSync(join(f.A.spec.path, 'features', 'shop.yml'), 'utf8'),
    /shop\.pay/,
    'a story left empty goes',
  );
});

test('several selections move as one, and a later move copies each run once more, naming in its sweep only the rules it carried @rule:locations.several.rules-move', () => {
  const f = fixture();
  const one = f.wd(['rules', 'move', 'shop.cart.add', 'shop.pay', '--blueprint', 'a', '--to', 'b']);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /2 rule\(s\) from `a` to `b`: shop\.cart\.add, shop\.pay\.card/);
  const later = f.wd(['rules', 'move', 'shop.cart.remove', '--blueprint', 'a', '--to', 'b']);
  assert.equal(later.status, 0, later.stderr);
  const copies = f.runsOf(f.B).map((n) => JSON.parse(readFileSync(join(f.B.runs.path, n), 'utf8')));
  // Each move's copy names the rules that move carried, none twice (q-0528).
  assert.deepEqual(
    copies
      .filter((c) => c.kind === 'sweep')
      .map((c) => c.rules)
      .sort(),
    [['shop.cart.add', 'shop.pay.card'], ['shop.cart.remove']],
  );
  assert.equal(f.row('b', 'shop.cart.add').checks, 'stale', 'still under the sweep');
  const checks = copies.filter((c) => c.run_id === '2026-10-01T10-00-00Z-local-01');
  assert.deepEqual(checks.map((c) => c.results.map((r) => r.rule)).sort(), [
    ['shop.cart.add', 'shop.pay.card'],
    ['shop.cart.remove'],
  ]);
  assert.equal(f.row('b', 'shop.cart.remove').checks, 'stale', 'still under the sweep');
});

test('a move is refused, and nothing moves, when the rule is already there, the blueprint is not in the project, its targets would strand a verdict, or features are uncommitted @rule:locations.several.rules-move', () => {
  const f = fixture({ commit: 'spec' });
  const unchanged = () => readFileSync(join(f.A.spec.path, 'features', 'shop.yml'), 'utf8');
  const was = unchanged();

  writeFileSync(
    join(f.B.spec.path, 'features', 'clash.yml'),
    'feature: clash\nstories:\n  - id: x\n    rules:\n      - id: shop.cart.add\n        statement: Another.\n',
  );
  f.git('add', '-A');
  f.git('commit', '-qm', 'clash');
  const clash = f.wd(['rules', 'move', 'shop.cart', '--blueprint', 'a', '--to', 'b']);
  assert.equal(clash.status, 2, clash.stderr + clash.stdout);
  assert.match(clash.stderr, /`b` already has a rule `shop\.cart\.add`/);
  assert.match(clash.stderr, /Nothing was moved/);

  // A verdict recorded at a place b's target does not point at would read
  // as never in b: refused until the targets agree.
  writeFileSync(
    join(f.A.runs.path, '2026-10-01T14-00-00Z-local-01.json'),
    JSON.stringify({
      run_id: '2026-10-01T14-00-00Z-local-01',
      created: '2026-10-01T14:00:00Z',
      actor: 'agent',
      kind: 'walkdown',
      target: 'local',
      base_url: 'http://localhost:3000',
      results: [{ rule: 'shop.pay.card', status: 'pass' }],
    }),
  );
  const bCfg = join(f.B.spec.path, 'spec.yml');
  writeFileSync(
    bCfg,
    readFileSync(bCfg, 'utf8').replace(
      'base_url: http://localhost:3000',
      'base_url: http://localhost:4999',
    ),
  );
  f.git('add', '-A');
  f.git('commit', '-qm', 'elsewhere');
  const astray = f.wd(['rules', 'move', 'shop.pay', '--blueprint', 'a', '--to', 'b']);
  assert.equal(astray.status, 2, astray.stdout);
  assert.match(
    astray.stderr,
    /1 verdict\(s\) were recorded at http:\/\/localhost:3000, but `b`'s target `local` points at http:\/\/localhost:4999 — they would read as never there/,
  );

  const elsewhere = f.wd(['rules', 'move', 'shop.pay', '--blueprint', 'a', '--to', 'nowhere']);
  assert.equal(elsewhere.status, 2);
  assert.match(elsewhere.stderr, /`nowhere` is not a blueprint of this project/);

  writeFileSync(join(f.A.spec.path, 'features', 'shop.yml'), `${was}# an edit nobody committed\n`);
  const dirty = f.wd(['rules', 'move', 'shop.pay', '--blueprint', 'a', '--to', 'b']);
  assert.equal(dirty.status, 2);
  assert.match(dirty.stderr, /`a` has uncommitted changes to its features/);
  assert.equal(unchanged(), `${was}# an edit nobody committed\n`);
  assert.equal(existsSync(join(f.B.spec.path, 'features', 'shop.yml')), false);
});

test("a sweep a move copies sweeps only the rules it came with, and the destination's own rules keep their verdicts @rule:locations.several.rules-move", () => {
  const f = fixture();
  // b's own rule, passed before a's sweep was declared, never swept in b.
  writeFileSync(
    join(f.B.spec.path, 'features', 'ship.yml'),
    [
      'feature: ship',
      'stories:',
      '  - id: ship.track',
      '    title: Tracking',
      '    statement: As a shopper I follow my parcel.',
      '    rules:',
      '      - id: ship.track.link',
      '        statement: The receipt links to the parcel.',
      '        verify: [checks]',
      '        steps:',
      '          then: [It links]',
      '',
    ].join('\n'),
  );
  assert.equal(f.wd(['hash', '--write', '--blueprint', 'b']).status, 0);
  const hash = JSON.parse(
    f.wd(['status', 'ship.track.link', '--blueprint', 'b', '--json']).stdout,
  ).statement_hash;
  mkdirSync(f.B.runs.path, { recursive: true });
  writeFileSync(
    join(f.B.runs.path, '2026-10-01T12-30-00Z-local-01.json'),
    `${JSON.stringify({
      run_id: '2026-10-01T12-30-00Z-local-01',
      created: '2026-10-01T12:30:00Z',
      actor: 'topher',
      kind: 'checks',
      target: 'local',
      results: [
        { rule: 'ship.track.link', status: 'pass', statement_hash: hash, checks: ['t.js:2'] },
      ],
    })}\n`,
  );
  assert.equal(f.row('b', 'ship.track.link').checks, 'pass');
  const r = f.wd(['rules', 'move', 'shop.cart.add', '--blueprint', 'a', '--to', 'b']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.row('b', 'shop.cart.add').checks, 'stale', 'the moved rule is still swept');
  assert.equal(
    f.row('b', 'ship.track.link').checks,
    'pass',
    "b's own rule was never swept (q-0528)",
  );
  const sweeps = JSON.parse(f.wd(['status', '--blueprint', 'b', '--json']).stdout).sweeps;
  const checks = sweeps.filter((x) => x.tier === 'checks');
  assert.deepEqual(
    checks.map((x) => [x.of, x.owed]),
    [[1, ['shop.cart.add']]],
  );
});
