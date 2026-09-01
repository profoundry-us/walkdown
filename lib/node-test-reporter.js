import { relative } from 'node:path';
import { collectRules, loadBlueprint } from './blueprint.js';
import { defaultActor } from './identity.js';
import { resolveLocations } from './locations.js';
import { writeRunRecord } from './run-record.js';

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
  const at = resolveLocations();
  const dir = at.spec?.missing ? null : (at.spec?.path ?? null);
  if (!dir) return void (yield 'walkdown: no blueprint (walkdown.yml) found — run not recorded\n');

  const blueprint = loadBlueprint(dir);
  /*
   * file:line, against the code root - the viewer's disclosure opens at the
   * test itself, not the imports, and lint scans for these same refs. Both
   * sides have to measure from the same place (issue #7).
   */
  const codeRoot = blueprint.codeRoot ?? blueprint.projectRoot;
  for (const t of perTest) {
    t.check = t.checkFile
      ? relative(codeRoot, t.checkFile) + (t.checkLine ? `:${t.checkLine}` : '')
      : null;
    delete t.checkFile;
    delete t.checkLine;
  }
  const rulesById = new Map(
    collectRules(blueprint.features).map(
      ({ rule }) => /** @type {[string, object]} */ ([rule?.id, rule]),
    ),
  );
  const { file, record } = writeRunRecord({
    blueprintDir: dir,
    target: process.env.WALKDOWN_TARGET ?? 'local',
    actor: process.env.CI ? 'ci' : defaultActor(dir).username,
    perTest,
    rulesById,
  });
  yield `walkdown: recorded ${record.results.length} rule result(s) → ${relative(process.cwd(), file)}\n`;
}
