import { userInfo } from 'node:os';
import { relative } from 'node:path';
import { collectRules, findBlueprintDir, loadBlueprint } from './blueprint.js';
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
        // file:line — the viewer's disclosure opens at the test itself, not the imports.
        check: file ? relative(process.cwd(), file) + (line ? `:${line}` : '') : null,
        evidence: [],
      });
  }

  if (!perTest.length) return void (yield 'walkdown: no @rule-tagged tests — run not recorded\n');
  const dir = findBlueprintDir(process.cwd());
  if (!dir) return void (yield 'walkdown: no blueprint (walkdown.yml) found — run not recorded\n');

  const blueprint = loadBlueprint(dir);
  const rulesById = new Map(
    collectRules(blueprint.features).map(
      ({ rule }) => /** @type {[string, object]} */ ([rule?.id, rule]),
    ),
  );
  const { file, record } = writeRunRecord({
    blueprintDir: dir,
    target: process.env.WALKDOWN_TARGET ?? 'local',
    actor: process.env.WALKDOWN_ACTOR ?? (process.env.CI ? 'ci' : userInfo().username),
    perTest,
    rulesById,
  });
  yield `walkdown: recorded ${record.results.length} rule result(s) → ${relative(process.cwd(), file)}\n`;
}
