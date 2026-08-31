import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { runHashCommand } from '../lib/hash-cmd.js';
import { formatHash } from '../lib/hash.js';
import { lint } from '../lib/lint.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-test-'));
after(() => rmSync(root, { recursive: true, force: true }));

function writeFixture(dir, { goodHash = true, badScreen = false, threads = [] } = {}) {
  const bp = join(dir, 'blueprint');
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'threads'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: fixture\n');
  writeFileSync(
    join(bp, 'storyboard.yml'),
    [
      'screens:',
      '  - id: home',
      '    prototype: /home.html',
      '    app: { path: / }',
      '    anchors: [home.cta]',
    ].join('\n'),
  );
  const statement = 'The visitor can do the thing.';
  const hash = goodHash ? formatHash(statement) : 'sha256:000000000000';
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.thing',
      `        statement: ${statement}`,
      '        verify: [agent]',
      `        screens: [${badScreen ? 'nope' : 'home'}]`,
      '        steps:',
      `          statement_hash: "${hash}"`,
      '          when: [Click anchor `home.cta`]',
    ].join('\n'),
  );
  threads.forEach((t, i) => writeFileSync(join(bp, 'threads', `t-${i}.yml`), t));
  return bp;
}

test('clean fixture lints with no findings', () => {
  const bp = writeFixture(join(root, 'clean'));
  const { findings, exitCode } = lint(loadBlueprint(bp), { checks: false });
  assert.deepEqual(findings, []);
  assert.equal(exitCode, 0);
});

test('stale hash and unknown screen are errors', () => {
  const bp = writeFixture(join(root, 'broken'), { goodHash: false, badScreen: true });
  const { findings, exitCode } = lint(loadBlueprint(bp), { checks: false });
  const categories = findings.map((f) => `${f.level}:${f.category}`).sort();
  assert.ok(categories.includes('error:stale-steps'), `got ${categories}`);
  assert.ok(categories.includes('error:storyboard'), `got ${categories}`);
  assert.equal(exitCode, 1);
});

test('answered question warns; waived without waived_by errors', () => {
  const bp = writeFixture(join(root, 'threads'), {
    threads: [
      'id: q-1\nkind: question\nstatus: answered\nanchor: { rule: demo.main.thing, screen: home }\nbody: x\n',
      'id: n-1\nkind: note\nstatus: waived\nanchor: { rule: demo.main.thing }\nbody: x\n',
    ],
  });
  const { findings } = lint(loadBlueprint(bp), { checks: false });
  assert.ok(
    findings.some(
      (f) => f.level === 'warn' && f.subject === 'q-1' && /not incorporated/.test(f.message),
    ),
  );
  assert.ok(
    findings.some((f) => f.level === 'error' && f.subject === 'n-1' && /waived_by/.test(f.message)),
  );
});

test('hash --write repairs a stale hash and lint then passes', () => {
  const bp = writeFixture(join(root, 'repair'), { goodHash: false });
  const first = runHashCommand(loadBlueprint(bp), { write: false });
  assert.equal(first.exitCode, 1);
  const wrote = runHashCommand(loadBlueprint(bp), { write: true });
  assert.equal(wrote.changedFiles, 1);
  assert.ok(
    readFileSync(join(bp, 'features', 'demo.yml'), 'utf8').includes(
      formatHash('The visitor can do the thing.'),
    ),
  );
  const { exitCode } = lint(loadBlueprint(bp), { checks: false });
  assert.equal(exitCode, 0);
});

test('two screens claiming one address on a surface: the loser of the tie is named', () => {
  const bp = writeFixture(join(root, 'tie'));
  const sb = readFileSync(join(bp, 'storyboard.yml'), 'utf8');
  // A state of the same page: its own design, no address of its own.
  writeFileSync(
    join(bp, 'storyboard.yml'),
    sb + '\n  - id: home-empty\n    prototype: /home.html#empty\n    app: { path: / }\n',
  );
  const { findings } = lint(loadBlueprint(bp), { checks: false });
  const tie = findings.filter(
    (f) => f.category === 'storyboard' && /already claimed/.test(f.message),
  );
  // The app path collides; the prototype refs differ by fragment, so they do not.
  assert.equal(tie.length, 1);
  assert.equal(tie[0].subject, 'home-empty');
  assert.match(tie[0].message, /app ref "\/" is already claimed by screen `home`/);
  assert.equal(tie[0].level, 'warn');
});

test('an undesigned screen without a design-request thread warns; with one it passes @rule:ownership.drift.design-requests-required', () => {
  const bp = writeFixture(join(root, 'drift'));
  const sb = readFileSync(join(bp, 'storyboard.yml'), 'utf8');
  writeFileSync(
    join(bp, 'storyboard.yml'),
    sb + '\n  - id: specborn\n    prototype: null\n    app: { path: /x }\n',
  );
  let { findings } = lint(loadBlueprint(bp), { checks: false });
  assert.ok(
    findings.some(
      (f) =>
        f.category === 'drift' &&
        f.subject === 'specborn' &&
        /no open design-request/.test(f.message),
    ),
  );

  writeFileSync(
    join(bp, 'threads', 'req.yml'),
    'id: q-9\nkind: question\nstatus: open\nanchor: { rule: demo.main.thing, screen: specborn }\nbody: design this\n',
  );
  ({ findings } = lint(loadBlueprint(bp), { checks: false }));
  assert.deepEqual(
    findings.filter((f) => f.category === 'drift'),
    [],
  );

  const feat = readFileSync(join(bp, 'features', 'demo.yml'), 'utf8');
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    feat.replace('        statement:', '        origin: thread:nope\n        statement:'),
  );
  ({ findings } = lint(loadBlueprint(bp), { checks: false }));
  assert.ok(
    findings.some((f) => f.category === 'drift' && /unknown thread "nope"/.test(f.message)),
  );
});

test('the in-repo example blueprint lints clean (without runner)', () => {
  const bp = new URL('../example/blueprint', import.meta.url).pathname;
  const { findings, exitCode } = lint(loadBlueprint(bp), { checks: false });
  /*
   * One warning stands on purpose. waitlist-confirm and waitlist-already are
   * the same page told apart by a query, and a query is not identity
   * (screens.identity.query-is-not-identity) - so on the app surface they are
   * one address and the second can never win the match. The example keeps the
   * honest spelling rather than the one that navigates nowhere, and the
   * warning names the cost until a state can say it is not URL-addressable
   * (issue #1). Everything else must stay clean.
   */
  const known = (f) =>
    f.category === 'storyboard' && /already claimed by screen `waitlist-confirm`/.test(f.message);
  assert.deepEqual(
    findings.filter((f) => !known(f)),
    [],
    JSON.stringify(findings, null, 2),
  );
  assert.equal(findings.filter(known).length, 1);
  assert.equal(exitCode, 0);
});

/*
 * The schema lint for the inverted evidence model. Each of these writes a rule
 * with one thing wrong with it and asks what lint says - a fixture per case,
 * because a rule carrying three mistakes at once cannot show which finding
 * belongs to which.
 */
function ruleFixture(dir, body) {
  const bp = join(dir, 'blueprint');
  mkdirSync(join(bp, 'features'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: fixture\n');
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.thing',
      '        statement: The visitor can do the thing.',
      ...body,
    ].join('\n'),
  );
  return lint(loadBlueprint(bp), { checks: false }).findings;
}
const REAL_EXCUSE = 'The control is the browser toolbar, which no tool an agent drives can reach.';

test('a signoff list that omits eng is flagged as a file that lies @rule:status.acceptance.signoff-defaults-to-eng', () => {
  // signoffList adds eng regardless, so the rule is fine and the FILE is not:
  // it describes a rule that engineering does not sign, and no such rule can
  // exist. The reader is the one misled, which is why lint says so rather
  // than repairing it quietly.
  const findings = ruleFixture(join(root, 'signoff-no-eng'), ['        signoff: [product]']);
  const f = findings.filter((x) => x.category === 'signoff');
  assert.equal(f.length, 1, JSON.stringify(findings));
  assert.equal(f[0].level, 'warn');
  assert.match(f[0].message, /omits eng/);

  // A list that names eng is silent, in either order.
  assert.deepEqual(
    ruleFixture(join(root, 'signoff-ok'), ['        signoff: [eng, product]']).filter(
      (x) => x.category === 'signoff',
    ),
    [],
  );

  // A role no run can be recorded under can never be satisfied - the rule
  // would wait forever for a signature the ledger cannot accept.
  const bogus = ruleFixture(join(root, 'signoff-bogus'), [
    '        signoff: [eng, marketing]',
  ]).filter((x) => x.category === 'signoff');
  assert.equal(bogus.length, 1);
  assert.match(bogus[0].message, /not a role a run can be recorded under/);
});

test('a thin excuse is worse than none @rule:status.evidence.excuse-must-argue', () => {
  // "n/a" is the silence the old schema allowed, wearing a key. An excuse
  // exists to be argued with, and nobody can argue with a shrug.
  const thin = ruleFixture(join(root, 'excuse-thin'), [
    '        unverifiable:',
    '          agent: n/a',
  ]).filter((x) => x.category === 'evidence');
  assert.equal(thin.length, 1, JSON.stringify(thin));
  assert.equal(thin[0].level, 'warn');
  assert.match(thin[0].message, /too thin to argue with/);

  // A sentence passes.
  assert.deepEqual(
    ruleFixture(join(root, 'excuse-real'), [
      '        unverifiable:',
      `          agent: ${REAL_EXCUSE}`,
    ]).filter((x) => x.category === 'evidence'),
    [],
  );

  // An excuse filed against something that is not a tier removes nothing, so
  // the rule silently still owes the evidence it thinks it has been let off.
  const wrongTier = ruleFixture(join(root, 'excuse-tier'), [
    '        unverifiable:',
    `          human: ${REAL_EXCUSE}`,
  ]).filter((x) => x.category === 'evidence');
  assert.equal(wrongTier.length, 1);
  assert.match(wrongTier[0].message, /which is not a tier/);
  // And it says where acceptance went, because that is the mistake being made.
  assert.match(wrongTier[0].message, /signoff/);
});

test('a rule excusing both tiers is flagged, legitimately @rule:status.evidence.excuse-must-argue', () => {
  // Nothing verifies this rule but a signature. That is sometimes the honest
  // answer - walkdown's own two extension rules are exactly this - and it
  // should stay a decision somebody made rather than one that accumulated.
  const findings = ruleFixture(join(root, 'excuse-both'), [
    '        unverifiable:',
    `          checks: ${REAL_EXCUSE}`,
    `          agent: ${REAL_EXCUSE}`,
  ]).filter((x) => x.category === 'evidence');
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].level, 'warn');
  assert.match(findings[0].message, /both tiers are excused/);
});

test('verify no longer knows the word human @rule:status.acceptance.signoff-defaults-to-eng', () => {
  // It used to mean "a person accepts this". It now means nothing at all, and
  // a rule carrying it reads as asking for a signature it is not asking for.
  const findings = ruleFixture(join(root, 'verify-human'), [
    '        verify: [checks, human]',
  ]).filter((x) => x.category === 'schema');
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].level, 'warn');
  assert.match(findings[0].message, /acceptance is `signoff/);

  // A word that was never a tier is still an error, not a nudge.
  const junk = ruleFixture(join(root, 'verify-junk'), ['        verify: [vibes]']).filter(
    (x) => x.category === 'schema',
  );
  assert.equal(junk.length, 1);
  assert.equal(junk[0].level, 'error');
});

test('a run signed under a role that does not exist is named @rule:status.acceptance.roles-recorded-on-the-run', () => {
  const bp = join(root, 'run-roles', 'blueprint');
  mkdirSync(join(bp, 'runs'), { recursive: true });
  ruleFixture(join(root, 'run-roles'), []);
  writeFileSync(
    join(bp, 'runs', 'r.json'),
    JSON.stringify({
      run_id: 'r',
      created: '2026-01-01T00:00:00Z',
      actor: 'topher',
      roles: ['eng', 'marketing'],
      kind: 'walkdown',
      target: 'local',
      results: [{ rule: 'demo.main.thing', status: 'pass' }],
    }),
  );
  const findings = lint(loadBlueprint(bp), { checks: false }).findings.filter(
    (f) => f.category === 'runs',
  );
  // The write paths refuse this, so a record carrying it was hand-edited or
  // came from a walkdown that knew a role this one does not - either way the
  // rule it meant to accept is silently still waiting, and only lint can say
  // so. A warning, never an error: history is not corrected by refusing to
  // read it.
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].level, 'warn');
  assert.match(findings[0].message, /signed under "marketing"/);
});
