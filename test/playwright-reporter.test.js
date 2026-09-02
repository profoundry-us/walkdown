/*
 * The Playwright reporter's evidence handling (n-0136). Playwright's output
 * directory is emptied at the start of every run, so a run record citing
 * paths inside it holds its fail evidence for exactly one run's lifetime.
 * The reporter copies attachments under the home and records logical keys -
 * the same shape the agent tier files, resolved by the server per machine
 * (locations.travel.evidence-by-key).
 *
 * The home is pinned at a scratch for the whole file: this reporter claims an
 * evidence home when it files, and a test that claimed one in the operator's
 * real registry would be the n-0137 disease with a test tag on it.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import WalkdownReporter from '../lib/playwright-reporter.js';
import { resolveLocations } from '../lib/locations.js';

const home = mkdtempSync(join(tmpdir(), 'wd-reporter-home-'));
const prevHome = process.env.WALKDOWN_HOME;
process.env.WALKDOWN_HOME = home;

const root = mkdtempSync(join(tmpdir(), 'wd-reporter-'));
const bp = join(root, 'blueprint');
mkdirSync(join(bp, 'features'), { recursive: true });
writeFileSync(join(bp, 'walkdown.yml'), 'project: reporter-fixture\n');
writeFileSync(
  join(bp, 'features', 'd.yml'),
  'feature: d\nstories:\n  - id: d.s\n    rules:\n      - id: d.s.thing\n        statement: The thing.\n        verify: [checks]\n',
);

after(() => {
  if (prevHome === undefined) delete process.env.WALKDOWN_HOME;
  else process.env.WALKDOWN_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

// Concatenated so the project's own coverage scan never reads this fixture
// tag as a check claiming a rule that does not exist.
const TAG = '@rule' + ':d.s.thing';

const fakeTest = (attachments) => ({
  tags: [TAG],
  title: 'a failing check',
  outcome: () => 'unexpected',
  results: [{ duration: 7, attachments }],
  location: { file: join(root, 'checks', 'x.spec.js'), line: 3 },
});

const record = (reporter, tests) => {
  reporter.onBegin({}, { allTests: () => tests });
  reporter.onEnd();
  const file = readdirSync(join(bp, 'runs')).sort().at(-1);
  return JSON.parse(readFileSync(join(bp, 'runs', file), 'utf8'));
};

test('a failure attachment outlives the output directory: copied under the home, recorded by key @rule:locations.travel.evidence-by-key', () => {
  // The attachment as Playwright leaves it: inside a per-test slug directory
  // that the next run deletes.
  const slugDir = join(root, 'out', 'panel-the-thing-fails');
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(join(slugDir, 'test-failed-1.png'), 'the-picture-bytes');

  const rec = record(new WalkdownReporter({ dir: bp }), [
    fakeTest([{ name: 'screenshot', path: join(slugDir, 'test-failed-1.png') }]),
  ]);

  const [key] = rec.results[0].evidence;
  assert.match(
    key,
    /^runs\/evidence\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\/panel-the-thing-fails-test-failed-1\.png$/,
  );
  // The key resolves the way every reader will resolve it - through the
  // home's evidence root - and the picture is really there, byte for byte.
  const evidenceRoot = resolveLocations({ spec: bp }).evidence.path;
  const copied = join(evidenceRoot, key.slice('runs/evidence/'.length));
  assert.equal(readFileSync(copied, 'utf8'), 'the-picture-bytes');
});

test('an uncopyable attachment falls back to the path - it lives until the next run, which beats nothing', () => {
  const rec = record(new WalkdownReporter({ dir: bp }), [
    fakeTest([{ name: 'screenshot', path: join(root, 'gone', 'x.png') }]),
  ]);
  const [ref] = rec.results[0].evidence;
  assert.doesNotMatch(ref, /^runs\/evidence\//);
  assert.match(ref, /gone[/\\]x\.png$/);
});

test('evidenceDir overrides resolution, for a harness whose run-time home is a throwaway', () => {
  const pinned = join(root, 'pinned-evidence');
  const slugDir = join(root, 'out', 'another-fail');
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(join(slugDir, 'error-context.md'), 'what went wrong');

  const rec = record(new WalkdownReporter({ dir: bp, evidenceDir: pinned }), [
    fakeTest([{ name: 'error-context', path: join(slugDir, 'error-context.md') }]),
  ]);

  const [key] = rec.results[0].evidence;
  assert.match(key, /^runs\/evidence\/.+\/another-fail-error-context\.md$/);
  const copied = join(pinned, key.slice('runs/evidence/'.length));
  assert.equal(readFileSync(copied, 'utf8'), 'what went wrong');
});
