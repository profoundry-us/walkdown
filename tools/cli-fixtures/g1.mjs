/*
 * Fixtures for group g1's cli screens: the plugin link and the skills
 * folder around it, test suites that file where walkdown says, and the
 * homes a records move or a rules move starts from.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const REPORTER = join(REPO, 'lib', 'node-test-reporter.js');

/* Claude Code's skills folder on the machine: ~/.claude/skills, as the harness names it. */
const skillsDir = (m) => join(m.root, 'claude', 'skills');

/* A node suite in ~/shop/tests, one test per [name, rule] pair, and every blueprint told to run it. */
function suite(m, tests, ids) {
  mkdirSync(join(m.shop, 'tests'), { recursive: true });
  writeFileSync(
    join(m.shop, 'tests', 'shop.test.js'),
    [
      "import { test } from 'node:test';",
      ...tests.map(([name, rule]) => `test('${name} @rule:${rule}', () => {});`),
      '',
    ].join('\n'),
  );
  const command = `node --test --test-reporter=${REPORTER} --test-reporter-destination=stdout tests/shop.test.js`;
  for (const id of ids) {
    const file = join(m.specOf(id), 'spec.yml');
    const text = readFileSync(file, 'utf8').replace(
      /^ {2}run_all: .*$/m,
      `  run_all: "${command}"`,
    );
    writeFileSync(file, text);
  }
}

export default {
  /* walkdown's link already in Claude Code's skills folder. */
  'g1-plugin-linked'(m) {
    m.ok(['skills', '--into', '../claude/skills']);
  },
  /*
   * Claude Code's skills folder holding walkdown's own link, and two of
   * somebody else's at names walkdown would use: walkdown-incorporate, a link
   * to a skill of theirs, and walkdown-judge, whose SKILL.md is a link to
   * their notes.
   */
  'g1-someone-elses-links'(m) {
    m.ok(['skills', '--into', '../claude/skills']);
    const theirs = join(m.root, 'their-skills');
    mkdirSync(join(theirs, 'incorporate'), { recursive: true });
    writeFileSync(
      join(theirs, 'incorporate', 'SKILL.md'),
      '---\nname: walkdown-incorporate\n---\nTheir own way of folding answers in.\n',
    );
    writeFileSync(
      join(theirs, 'judge.md'),
      '---\nname: walkdown-judge\n---\nTheir own judging notes.\n',
    );
    symlinkSync(join(theirs, 'incorporate'), join(skillsDir(m), 'walkdown-incorporate'), 'dir');
    mkdirSync(join(skillsDir(m), 'walkdown-judge'), { recursive: true });
    symlinkSync(join(theirs, 'judge.md'), join(skillsDir(m), 'walkdown-judge', 'SKILL.md'));
  },
  /*
   * Claude Code's skills folder as walkdown 0.1.0 left it: walkdown-judge
   * exactly as that release shipped it, and walkdown-setup as its person
   * since edited it.
   */
  'g1-old-copies'(m) {
    const show = (path) =>
      execFileSync('git', ['show', `v0.1.0:${path}`], { cwd: REPO, encoding: 'utf8' });
    const write = (name, text) => {
      mkdirSync(join(skillsDir(m), name), { recursive: true });
      writeFileSync(join(skillsDir(m), name, 'SKILL.md'), text);
    };
    write('walkdown-judge', show('lib/skills/walkdown-judge.md'));
    write(
      'walkdown-setup',
      `${show('lib/skills/walkdown-setup.md')}\nAlways set up with --commit spec here.\n`,
    );
  },
  /* `checkout` and `search` sharing one node suite, with a test tagged for a rule neither holds. */
  'g1-shared-suite'(m, h) {
    h.fixtures['two-blueprints'](m);
    suite(
      m,
      [
        ['a card payment goes through', 'checkout.basics.pays'],
        ['a search finds the product', 'search.basics.finds'],
        ['a refund goes back to the card', 'checkout.basics.refunds'],
      ],
      ['checkout', 'search'],
    );
  },
  /* `checkout`, its home outside the repository as `blueprints new` keeps it, and a node suite in the code. */
  'g1-suite-outside'(m, h) {
    m.ok(['blueprints', 'new', 'checkout']);
    bare(m, 'checkout');
    h.feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
    suite(m, [['a card payment goes through', 'checkout.basics.pays']], ['checkout']);
  },
  /* `checkout`, and a folder its evidence could go to that already holds somebody's records. */
  'g1-records-taken'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    const dir = join(m.root, 'evidence-kept', '2026-09-01T00-00-00Z');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'app-search.png'), '');
  },
  /* `checkout` with a prototype folder beside its spec, and `prototype.root` naming it. */
  'g1-prototype-beside'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    const spec = m.specOf('checkout');
    const file = join(spec, 'spec.yml');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        '# prototype:\n#   root: prototype/',
        'prototype:\n  root: prototype/',
      ),
    );
    mkdirSync(join(spec, 'prototype', 'screens'), { recursive: true });
    writeFileSync(
      join(spec, 'prototype', 'screens', 'pay.html'),
      '<!doctype html><title>Pay</title>\n',
    );
    // The code has one too, as a repository that keeps its design does.
    mkdirSync(join(m.shop, 'prototype'), { recursive: true });
  },
  /*
   * `checkout` and `search` sharing one suite: it tags a rule of each and
   * one neither holds, a recorded run has seen it, and two of search's rules
   * came from threads - one checkout's n-0001, one nobody's.
   */
  'g1-lint-across'(m, h) {
    m.ok(['blueprints', 'new', 'checkout']);
    m.ok(['blueprints', 'new', 'search']);
    bare(m, 'checkout');
    bare(m, 'search');
    h.feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.pays',
      '--body',
      'Search should find what was just bought.',
      '--blueprint',
      'checkout',
    ]);
    writeFileSync(
      join(m.specOf('search'), 'features', 'search.yml'),
      [
        'feature: search',
        'stories:',
        '  - id: search.basics',
        '    title: The basics of search',
        '    statement: As a shopper I use search.',
        '    rules:',
        '      - id: search.basics.finds',
        '        statement: A search for a product finds it.',
        '        origin: thread:n-0001',
        '        verify: [checks]',
        '        steps:',
        '          then: [It does]',
        '      - id: search.basics.recent',
        '        statement: Recent searches are listed first.',
        '        origin: thread:n-0099',
        '        verify: []',
        '        steps:',
        '          then: [It does]',
        '',
      ].join('\n'),
    );
    m.ok(['hash', '--write', '--blueprint', 'search']);
    suite(
      m,
      [
        ['a card payment goes through', 'checkout.basics.pays'],
        ['a search finds the product', 'search.basics.finds'],
        ['a refund goes back to the card', 'checkout.basics.refunds'],
      ],
      ['checkout', 'search'],
    );
    m.ok(['run']);
  },
  /* `checkout` and `search`; checkout's story has a thread, a recorded run and a picture behind it. */
  'g1-before-move'(m, h) {
    h.fixtures['two-blueprints'](m);
    m.ok([
      'threads',
      'new',
      '--rule',
      'checkout.basics.totals',
      '--body',
      'The total leaves out the shipping.',
      '--blueprint',
      'checkout',
    ]);
    suite(
      m,
      [
        ['a card payment goes through', 'checkout.basics.pays'],
        ['the total adds up', 'checkout.basics.totals'],
        ['a search finds the product', 'search.basics.finds'],
      ],
      ['checkout', 'search'],
    );
    m.ok(['run']);
  },
  /*
   * `checkout`, committed, with an agent's pass on file citing a picture by
   * its key - and the evidence since moved out of the repository.
   */
  'g1-evidence-moved'(m, h) {
    h.fixtures['committed-spec'](m);
    const spec = m.specOf('checkout');
    bare(m, 'checkout');
    h.feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
    agentPass(m, spec, 'checkout.basics.pays', [
      'runs/evidence/2026-10-02T00-00-00Z/app-checkout.png',
    ]);
    mkdirSync(join(spec, 'evidence', '2026-10-02T00-00-00Z'), { recursive: true });
    writeFileSync(join(spec, 'evidence', '2026-10-02T00-00-00Z', 'app-checkout.png'), '');
    m.ok(['records', 'move', 'evidence', '--to', '../evidence-kept', '--blueprint', 'checkout']);
  },
  /* `checkout`, committed, a recorded pass on it, and then two commits that touch neither. */
  'g1-later-commits'(m, h) {
    h.fixtures['committed-spec'](m);
    bare(m, 'checkout');
    h.feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
    suite(m, [['a card payment goes through', 'checkout.basics.pays']], ['checkout']);
    h.git(m, m.shop, 'add', '-A');
    h.git(m, m.shop, 'commit', '-q', '-m', 'checkout and its suite');
    m.ok(['run', '--blueprint', 'checkout']);
    for (const [file, text] of [
      ['README.md', '# shop\n\nA shop.\n'],
      ['CHANGELOG.md', '# Changes\n'],
    ]) {
      writeFileSync(join(m.shop, file), text);
      h.git(m, m.shop, 'add', '-A');
      h.git(m, m.shop, 'commit', '-q', '-m', `${file}`);
    }
  },
};

/* A blueprint with none of the example features `blueprints new` writes. */
function bare(m, id) {
  const dir = join(m.specOf(id), 'features');
  for (const f of readdirSync(dir)) rmSync(join(dir, f));
}

/* An agent's pass on one rule, written as `walkdown judge` lays the record out. */
function agentPass(m, spec, rule, evidence) {
  const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const runId = `${created.replaceAll(':', '-')}-local-01`;
  const text = readFileSync(join(spec, 'features', 'checkout.yml'), 'utf8');
  const hash = text.match(/statement_hash: (\S+)/)[1];
  mkdirSync(join(spec, 'runs'), { recursive: true });
  writeFileSync(
    join(spec, 'runs', `${runId}.json`),
    `${JSON.stringify(
      {
        run_id: runId,
        created,
        actor: 'agent',
        kind: 'walkdown',
        target: 'local',
        base_url: 'http://localhost:3000',
        results: [
          {
            rule,
            status: 'pass',
            statement_hash: hash,
            evidence,
            reasoning: 'Paid with the test card; the receipt showed.',
            threads: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}
