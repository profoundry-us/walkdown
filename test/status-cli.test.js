/*
 * The terminal report, run as a person runs it.
 *
 * `walkdown status` is a surface somebody reads, but it is not a page - so it
 * is checked here, by running the binary and reading what came out, rather
 * than in checks/ where the browser lives. The rules it answers to are about
 * what the report SAYS, so asserting on the derived object instead would miss
 * the whole point: the derivation has been right the entire time the column
 * said "pending".
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { formatHash } from '../lib/hash.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'walkdown-status-cli-'));
after(() => rmSync(root, { recursive: true, force: true }));

const WAITING = 'The visitor can do the thing.';
const EXCUSED = 'The extension adds nothing to a page until its toolbar button is clicked.';
const AGENT_EXCUSE =
  "The control is the browser's own toolbar button - browser chrome rather than " +
  'part of the page, and no tool an agent drives reaches it.';
const CHECKS_EXCUSE =
  'The same button, for the same reason - a test that drives a page cannot ' +
  'click something that is not in the page.';

function fixture(name) {
  const bp = join(root, name, 'blueprint');
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'runs'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: cli-fixture\n');
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.waiting',
      `        statement: ${WAITING}`,
      '        verify: [checks]',
      '        signoff: [eng, product]',
      '      - id: demo.main.excused',
      `        statement: ${EXCUSED}`,
      '        unverifiable:',
      `          agent: ${AGENT_EXCUSE}`,
      `          checks: ${CHECKS_EXCUSE}`,
    ].join('\n'),
  );
  // Checks green, engineering signed, product has not been asked yet.
  writeFileSync(
    join(bp, 'runs', '2026-01-01T00-00-00Z-local-01.json'),
    JSON.stringify({
      run_id: '2026-01-01T00-00-00Z-local-01',
      created: '2026-01-01T00:00:00Z',
      actor: 'agent',
      kind: 'checks',
      target: 'local',
      results: [{ rule: 'demo.main.waiting', status: 'pass', statement_hash: formatHash(WAITING) }],
    }),
  );
  writeFileSync(
    join(bp, 'runs', '2026-01-02T00-00-00Z-local-01.json'),
    JSON.stringify({
      run_id: '2026-01-02T00-00-00Z-local-01',
      created: '2026-01-02T00:00:00Z',
      actor: 'topher',
      roles: ['eng'],
      kind: 'walkdown',
      target: 'local',
      results: [{ rule: 'demo.main.waiting', status: 'pass', statement_hash: formatHash(WAITING) }],
    }),
  );
  return bp;
}

const run = (bp, args) =>
  execFileSync(process.execPath, [CLI, 'status', ...args, '--dir', bp], { encoding: 'utf8' });

test('the report names the role a rule is waiting on @rule:status.attention.names-the-role', () => {
  const out = run(fixture('waiting'), []);
  // Both halves of the answer on one line: engineering has signed, product
  // has not. "Pending" would have said neither, and a reader would still have
  // to go and find out whose afternoon this is.
  const row = out.split('\n').find((l) => l.includes('demo.main.waiting'));
  assert.match(row, /✓ eng/);
  assert.match(row, /○ product/);
  // The column says what it holds, rather than "HUMAN", which this has not
  // been since acceptance became a set of people.
  assert.match(out, /ACCEPTED/);
  // And the queue names the role rather than merely a person.
  assert.match(out, /product has not accepted it yet/);
});

test('an excused tier reads as excused, never as an empty cell @rule:status.evidence.excuse-says-why', () => {
  const bp = fixture('excused');
  const table = run(bp, []);
  const row = table.split('\n').find((l) => l.includes('demo.main.excused'));
  // A dot means "does not apply here". An excuse is a decision somebody made,
  // and a report where the two look identical would look exactly the same if
  // somebody had simply forgotten.
  assert.match(row, /excused/);

  // And the reason itself, in full, where the verdict would have been - an
  // excuse nobody can read is one nobody can argue with.
  const detail = run(bp, ['demo.main.excused']);
  assert.match(detail, /agent\s+· excused/);
  assert.match(detail, /checks\s+· excused/);
  assert.ok(detail.includes(AGENT_EXCUSE), detail);
  assert.ok(detail.includes(CHECKS_EXCUSE), detail);
});

test('the rule detail says who has signed and who has not @rule:status.acceptance.verdict-needs-every-role', () => {
  const detail = run(fixture('detail'), ['demo.main.waiting']);
  assert.match(detail, /ACCEPTANCE/);
  // Named with its provenance, so a signature can be traced to the sitting
  // that gave it.
  assert.match(detail, /eng\s+✓ signed by topher/);
  assert.match(detail, /2026-01-02T00-00-00Z-local-01/);
  // And the absence is listed too: a rule waiting on product and a rule
  // waiting on nobody look identical if only signatures are printed.
  assert.match(detail, /product\s+○ not yet/);
  // Every tier green and one role short is pending, not verified.
  assert.match(detail, /demo\.main\.waiting · pending/);
});
