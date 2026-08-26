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
    ['screens:', '  - id: home', '    prototype: /home.html', '    app: { path: / }', '    anchors: [home.cta]'].join('\n')
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
    ].join('\n')
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
  assert.ok(findings.some((f) => f.level === 'warn' && f.subject === 'q-1' && /not incorporated/.test(f.message)));
  assert.ok(findings.some((f) => f.level === 'error' && f.subject === 'n-1' && /waived_by/.test(f.message)));
});

test('hash --write repairs a stale hash and lint then passes', () => {
  const bp = writeFixture(join(root, 'repair'), { goodHash: false });
  const first = runHashCommand(loadBlueprint(bp), { write: false });
  assert.equal(first.exitCode, 1);
  const wrote = runHashCommand(loadBlueprint(bp), { write: true });
  assert.equal(wrote.changedFiles, 1);
  assert.ok(readFileSync(join(bp, 'features', 'demo.yml'), 'utf8').includes(formatHash('The visitor can do the thing.')));
  const { exitCode } = lint(loadBlueprint(bp), { checks: false });
  assert.equal(exitCode, 0);
});

test('two screens claiming one address on a surface: the loser of the tie is named', () => {
  const bp = writeFixture(join(root, 'tie'));
  const sb = readFileSync(join(bp, 'storyboard.yml'), 'utf8');
  // A state of the same page: its own design, no address of its own.
  writeFileSync(join(bp, 'storyboard.yml'),
    sb + '\n  - id: home-empty\n    prototype: /home.html#empty\n    app: { path: / }\n');
  const { findings } = lint(loadBlueprint(bp), { checks: false });
  const tie = findings.filter((f) => f.category === 'storyboard' && /already claimed/.test(f.message));
  // The app path collides; the prototype refs differ by fragment, so they do not.
  assert.equal(tie.length, 1);
  assert.equal(tie[0].subject, 'home-empty');
  assert.match(tie[0].message, /app ref "\/" is already claimed by screen `home`/);
  assert.equal(tie[0].level, 'warn');
});

test('an undesigned screen without a design-request thread warns; with one it passes @rule:ownership.drift.design-requests-required', () => {
  const bp = writeFixture(join(root, 'drift'));
  const sb = readFileSync(join(bp, 'storyboard.yml'), 'utf8');
  writeFileSync(join(bp, 'storyboard.yml'), sb + '\n  - id: specborn\n    prototype: null\n    app: { path: /x }\n');
  let { findings } = lint(loadBlueprint(bp), { checks: false });
  assert.ok(findings.some((f) => f.category === 'drift' && f.subject === 'specborn' && /no open design-request/.test(f.message)));

  writeFileSync(join(bp, 'threads', 'req.yml'),
    'id: q-9\nkind: question\nstatus: open\nanchor: { rule: demo.main.thing, screen: specborn }\nbody: design this\n');
  ({ findings } = lint(loadBlueprint(bp), { checks: false }));
  assert.deepEqual(findings.filter((f) => f.category === 'drift'), []);

  const feat = readFileSync(join(bp, 'features', 'demo.yml'), 'utf8');
  writeFileSync(join(bp, 'features', 'demo.yml'), feat.replace('        statement:', '        origin: thread:nope\n        statement:'));
  ({ findings } = lint(loadBlueprint(bp), { checks: false }));
  assert.ok(findings.some((f) => f.category === 'drift' && /unknown thread "nope"/.test(f.message)));
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
  const known = (f) => f.category === 'storyboard' && /already claimed by screen `waitlist-confirm`/.test(f.message);
  assert.deepEqual(findings.filter((f) => !known(f)), [], JSON.stringify(findings, null, 2));
  assert.equal(findings.filter(known).length, 1);
  assert.equal(exitCode, 0);
});
