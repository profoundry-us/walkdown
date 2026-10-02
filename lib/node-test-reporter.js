import { fileRun, filingLines } from './filing.js';
import { defaultActor } from './identity.js';

const RULE_REF = /@rule:([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/**
 * node:test reporter that appends a walkdown run record — the third emitter,
 * alongside the Playwright reporter and the RSpec formatter. Tag a test by
 * putting " @rule:<id>" in its name, then run:
 *
 *   node --test --test-reporter=walkdown/node-reporter --test-reporter-destination=stdout
 *
 * Untagged tests are ignored. With no blueprint or no tagged tests, nothing
 * is recorded and the test run is unaffected.
 */
export default async function* walkdownReporter(source) {
  const perTest = [];
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { name = '', file, line, details, skip, todo } = event.data ?? {};
    const rules = [...name.matchAll(RULE_REF)].map((m) => m[1]);
    if (!rules.length) continue;
    const status = skip || todo ? 'skipped' : event.type === 'test:fail' ? 'fail' : 'pass';
    yield `${{ pass: '✓', fail: '✗', skipped: '–' }[status]} ${name}\n`;
    for (const ruleId of rules)
      perTest.push({
        ruleId,
        status,
        durationMs: Math.round(details?.duration_ms ?? 0),
        // Kept absolute here and relativised once the blueprint is loaded:
        // a check ref hangs off the CODE root, and the cwd is only the same
        // directory when you happen to have run from the repository root.
        checkFile: file ?? null,
        checkLine: line ?? null,
        evidence: [],
      });
  }

  if (!perTest.length) return void (yield 'walkdown: no @rule-tagged tests — run not recorded\n');
  /*
   * Where the record goes, when the suite runs under a throwaway home. A
   * suite that makes homes of its own pins WALKDOWN_HOME at a scratch
   * directory for the run, and the reporter, reading the same pin, then
   * finds no blueprint there and records nothing - which is how four rules
   * verified only by unit tests read as unbuilt for weeks. WALKDOWN_RECORD_HOME
   * names the home the record belongs to (empty: the default one); the pin
   * is put back afterwards. The Playwright reporter's `home` option is the
   * same answer to the same problem.
   */
  const pinned = process.env.WALKDOWN_HOME;
  if ('WALKDOWN_RECORD_HOME' in process.env) {
    if (process.env.WALKDOWN_RECORD_HOME) process.env.WALKDOWN_HOME = process.env.WALKDOWN_RECORD_HOME;
    else delete process.env.WALKDOWN_HOME;
  }
  try {
    yield* recordRun(perTest);
  } finally {
    if (pinned === undefined) delete process.env.WALKDOWN_HOME;
    else process.env.WALKDOWN_HOME = pinned;
  }
}

/*
 * Filed by rule (lib/filing.js): with several blueprints in the project,
 * each result goes to the one that holds its rule. WALKDOWN_SPEC, which
 * `walkdown run --blueprint` passes, narrows it to that one.
 */
async function* recordRun(perTest) {
  const filed = fileRun({
    perTest,
    target: process.env.WALKDOWN_TARGET ?? 'local',
    actor: (dir) => (process.env.CI ? 'ci' : defaultActor(dir).username),
    dir: process.env.WALKDOWN_SPEC || null,
  });
  for (const line of filingLines(filed)) yield `${line}\n`;
}
