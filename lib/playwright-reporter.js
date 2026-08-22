import { userInfo } from 'node:os';
import { relative, resolve } from 'node:path';
import { collectRules, findBlueprintDir, loadBlueprint } from './blueprint.js';
import { writeRunRecord } from './run-record.js';

const RULE_TAG = /^@rule:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const RULE_IN_TITLE = /@rule:([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/**
 * Playwright reporter that appends a walkdown run record after every run.
 *
 *   // playwright.config.ts
 *   reporter: [['list'], ['walkdown/reporter']]
 *
 * Options (all optional): { dir, target, actor, baseUrl }.
 * Env fallbacks: WALKDOWN_TARGET (default "local"), WALKDOWN_ACTOR
 * (default "ci" under CI, else the OS username), APP_HOST for base_url.
 * If no blueprint directory is found, the run is not recorded (a warning is
 * printed) — tests are never failed by the reporter.
 */
export default class WalkdownReporter {
  constructor(options = {}) {
    this.options = options;
  }

  onBegin(config, suite) {
    this.suite = suite;
    this.baseUrl =
      this.options.baseUrl ?? config.projects?.[0]?.use?.baseURL ?? process.env.APP_HOST ?? null;
    this.dir = this.options.dir ? resolve(this.options.dir) : findBlueprintDir(process.cwd());
  }

  onEnd() {
    if (!this.dir) {
      console.error('walkdown reporter: no blueprint (walkdown.yml) found — run not recorded');
      return;
    }
    const blueprint = loadBlueprint(this.dir);
    const rulesById = new Map(
      collectRules(blueprint.features).map(({ rule }) => [rule?.id, rule]).filter(([id]) => id)
    );

    const perTest = [];
    for (const test of this.suite.allTests()) {
      const tags = (test.tags ?? [])
        .map((t) => t.match(RULE_TAG)?.[1])
        .filter(Boolean);
      if (!tags.length)
        for (const m of test.title.matchAll(RULE_IN_TITLE)) tags.push(m[1]);
      if (!tags.length) continue;

      const outcome = test.outcome(); // expected | unexpected | flaky | skipped
      const status =
        outcome === 'unexpected' ? 'fail' : outcome === 'skipped' ? 'skipped' : 'pass';
      const durationMs = test.results.reduce((ms, r) => ms + (r.duration ?? 0), 0);
      const check = test.location
        ? `${relative(blueprint.projectRoot, test.location.file)}:${test.location.line}`
        : null;
      const evidence = (test.results.at(-1)?.attachments ?? [])
        .filter((a) => a.path)
        .map((a) => relative(blueprint.projectRoot, a.path));

      for (const ruleId of tags) perTest.push({ ruleId, status, durationMs, check, evidence });
    }

    if (!perTest.length) {
      console.error('walkdown reporter: no tests tagged @rule:<id> — run not recorded');
      return;
    }

    const target = this.options.target ?? process.env.WALKDOWN_TARGET ?? 'local';
    const actor =
      this.options.actor ??
      process.env.WALKDOWN_ACTOR ??
      (process.env.CI ? 'ci' : userInfo().username);
    const { file, record } = writeRunRecord({
      blueprintDir: this.dir,
      target,
      baseUrl: this.baseUrl,
      actor,
      perTest,
      rulesById,
    });
    console.log(
      `walkdown: recorded ${record.results.length} rule result(s) → ${relative(process.cwd(), file)}`
    );
  }

  printsToStdio() {
    return false;
  }
}
