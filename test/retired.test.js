import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { deriveStatus } from '../lib/status.js';
import { lint } from '../lib/lint.js';
import { formatHash } from '../lib/hash.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-retired-'));
after(() => rmSync(root, { recursive: true, force: true }));

function fixture() {
  const bp = join(root, 'blueprint');
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'runs'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: retired-fixture\n');
  const live = 'The visitor can do the thing.';
  const gone = 'The visitor could do the old thing.';
  writeFileSync(join(bp, 'features', 'demo.yml'), [
    'feature: demo', 'stories:', '  - id: demo.main', '    rules:',
    '      - id: demo.main.live', `        statement: ${live}`,
    '        verify: [checks]', '        steps:', `          statement_hash: "${formatHash(live)}"`,
    '      - id: demo.main.gone',
    '        retired: The layout it described was withdrawn.',
    `        statement: ${gone}`, '        verify: [checks, human]',
    '        screens: [a-screen-that-does-not-exist]',
  ].join('\n'));
  // A run that judged both, the way the ledger actually looks after a retirement.
  writeFileSync(join(bp, 'runs', '2026-01-01T00-00-00Z-local-01.json'), JSON.stringify({
    run_id: '2026-01-01T00-00-00Z-local-01', created: '2026-01-01T00:00:00Z',
    actor: 'agent', kind: 'checks', target: 'local',
    results: [{ rule: 'demo.main.live', status: 'pass' }, { rule: 'demo.main.gone', status: 'pass' }],
  }));
  return bp;
}

test('a retired rule leaves the report but keeps its id resolvable', () => {
  const bp = fixture();
  const { rows } = deriveStatus(loadBlueprint(bp));
  assert.deepEqual(rows.map((r) => r.rule), ['demo.main.live']);

  const { findings, exitCode } = lint(loadBlueprint(bp), { checks: false });
  assert.equal(exitCode, 0);
  // The verdict recorded against it is still a verdict about a rule that exists.
  assert.equal(findings.filter((f) => /unknown rule/.test(f.message)).length, 0);
  // And nothing is asked of it: no screen, no coverage, no fresh hash.
  assert.deepEqual(findings.filter((f) => f.subject === 'demo.main.gone'), []);
});

test('the CLI answers for a retired rule instead of calling it unknown', async () => {
  const bp = fixture();
  const { execFileSync } = await import('node:child_process');
  const cli = new URL('../bin/walkdown.js', import.meta.url).pathname;
  const run = (args) => execFileSync(process.execPath, [cli, ...args, '--dir', bp], { encoding: 'utf8' });

  // Retiring and deleting must not look the same from the command line.
  const one = run(['status', 'demo.main.gone', '--json']);
  assert.equal(JSON.parse(one).state, 'retired');
  assert.match(JSON.parse(one).retired, /withdrawn/);

  const all = JSON.parse(run(['status', '--retired', '--json']));
  assert.deepEqual(all.map((r) => r.rule), ['demo.main.gone']);

  // A rule that never existed is still an error, not a shrug.
  assert.throws(() => run(['status', 'demo.main.never']), /status/);
});

test('a retired screen leaves the surfaces but keeps the threads anchored to it valid', () => {
  const bp = fixture();
  writeFileSync(join(bp, 'storyboard.yml'),
    ['screens:', '  - id: live', '    prototype: /live.html', '    app: { path: /live }',
     '  - id: gone', '    retired: The layout it described was withdrawn.',
     '    prototype: /gone.html'].join('\n'));
  // A thread saying something about a screen we later stopped meaning. The
  // record is still true; only the screen is gone.
  mkdirSync(join(bp, 'threads'), { recursive: true });
  writeFileSync(join(bp, 'threads', 'n-1.yml'),
    'id: n-1\nkind: note\nstatus: open\nanchor: { screen: gone }\nbody: said about it at the time\n');

  const { findings, exitCode } = lint(loadBlueprint(bp), { checks: false });
  assert.equal(exitCode, 0);
  // Not "anchored to unknown screen" — the id still resolves.
  assert.deepEqual(findings.filter((f) => /unknown screen/.test(f.message)), []);
  // And a retired screen with no design is not a missing design request.
  assert.deepEqual(findings.filter((f) => f.subject === 'gone'), []);

  const { drift } = deriveStatus(loadBlueprint(bp));
  assert.deepEqual(drift.design.map((d) => d.screen), []);
});

test('retired must say why', () => {
  const bp = fixture();
  const path = join(bp, 'features', 'demo.yml');
  writeFileSync(path, readFileSync(path, 'utf8').replace(
    '        retired: The layout it described was withdrawn.', '        retired: true'));
  const { findings } = lint(loadBlueprint(bp), { checks: false });
  assert.ok(findings.some((f) => f.subject === 'demo.main.gone' && /retired must say why/.test(f.message)));
});
