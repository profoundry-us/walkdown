import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { collectRules, loadBlueprint } from './blueprint.js';
import { defaultActor } from './identity.js';
import { resolveLocations } from './locations.js';
import { writeRunRecord } from './run-record.js';

const RULE_TAG = /^@rule:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const RULE_IN_TITLE = /@rule:([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/**
 * Playwright reporter that appends a walkdown run record after every run.
 *
 *   // playwright.config.ts
 *   reporter: [['list'], ['walkdown/reporter']]
 *
 * Options (all optional): { dir, target, actor, baseUrl, evidenceDir }.
 * Env fallback: WALKDOWN_TARGET (default "local"), and APP_HOST for base_url.
 * Who it records under is "ci" under CI and the configured identity
 * otherwise — never an environment variable, and never a machine login name.
 * If no blueprint directory is found, the run is not recorded (a warning is
 * printed) — tests are never failed by the reporter.
 *
 * evidenceDir is where failure attachments are filed for good. Left unset it
 * is resolved from the environment when the run ends, which is right for an
 * adopter; a harness that re-points WALKDOWN_HOME at a throwaway home for the
 * duration of the run (as walkdown's own global-setup does) must resolve the
 * real one at config load and pass it here, or the copies land somewhere the
 * next run deletes — the fate of the test-results/ paths this replaces
 * (n-0136).
 */
export default class WalkdownReporter {
  constructor(options = {}) {
    this.options = options;
  }

  onBegin(config, suite) {
    this.suite = suite;
    this.baseUrl =
      this.options.baseUrl ?? config.projects?.[0]?.use?.baseURL ?? process.env.APP_HOST ?? null;
    const at = this.options.dir ? null : resolveLocations();
    this.dir = this.options.dir
      ? resolve(this.options.dir)
      : at.spec?.missing
        ? null
        : (at.spec?.path ?? null);
  }

  onEnd() {
    if (!this.dir) {
      console.error('walkdown reporter: no blueprint (walkdown.yml) found — run not recorded');
      return;
    }
    const blueprint = loadBlueprint(this.dir);
    const rulesById = new Map(
      collectRules(blueprint.features)
        .map(({ rule }) => /** @type {[string, object]} */ ([rule?.id, rule]))
        .filter(([id]) => id),
    );

    /*
     * Attachments are copied OUT of Playwright's output directory before the
     * record names them: that directory is emptied at the start of the next
     * run, and a record citing it holds evidence for exactly one run's
     * lifetime - the 2026-09-01T01-04-49Z fail's screenshot was already
     * unrecoverable by the time anyone asked why it failed (n-0136). Filed
     * under the home by logical key instead, the way the agent tier files
     * its screenshots, so the server can resolve them on any machine.
     * Resolved lazily: a green run has nothing to copy and claims nothing.
     */
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
    let evidenceRoot;
    const fileEvidence = (path) => {
      try {
        evidenceRoot ??= this.options.evidenceDir
          ? resolve(this.options.evidenceDir)
          : resolveLocations({ dir: this.dir }).evidence.path;
        const name = `${basename(dirname(path))}-${basename(path)}`;
        mkdirSync(join(evidenceRoot, stamp), { recursive: true });
        copyFileSync(path, join(evidenceRoot, stamp, name));
        return `runs/evidence/${stamp}/${name}`;
      } catch {
        return null; // the doomed path over nothing - it lives until the next run
      }
    };

    // Check refs name files in the CODE, which is no longer the blueprint's
    // parent once the spec lives outside the repository (issue #7). The
    // reporters write these refs and lint scans for them; they have to hang
    // off the same root or the two stop recognising each other.
    const codeRoot = blueprint.codeRoot ?? blueprint.projectRoot;

    const perTest = [];
    for (const test of this.suite.allTests()) {
      const tags = (test.tags ?? []).map((t) => t.match(RULE_TAG)?.[1]).filter(Boolean);
      if (!tags.length) for (const m of test.title.matchAll(RULE_IN_TITLE)) tags.push(m[1]);
      if (!tags.length) continue;

      const outcome = test.outcome(); // expected | unexpected | flaky | skipped
      const status = outcome === 'unexpected' ? 'fail' : outcome === 'skipped' ? 'skipped' : 'pass';
      const durationMs = test.results.reduce((ms, r) => ms + (r.duration ?? 0), 0);
      const check = test.location
        ? `${relative(codeRoot, test.location.file)}:${test.location.line}`
        : null;
      const evidence = (test.results.at(-1)?.attachments ?? [])
        .filter((a) => a.path)
        .map((a) => fileEvidence(a.path) ?? relative(codeRoot, a.path));

      for (const ruleId of tags) perTest.push({ ruleId, status, durationMs, check, evidence });
    }

    if (!perTest.length) {
      console.error('walkdown reporter: no tests tagged @rule:<id> — run not recorded');
      return;
    }

    const target = this.options.target ?? process.env.WALKDOWN_TARGET ?? 'local';
    const actor =
      this.options.actor ?? (process.env.CI ? 'ci' : defaultActor(this.dir).username);
    const { file, record } = writeRunRecord({
      blueprintDir: this.dir,
      target,
      baseUrl: this.baseUrl,
      actor,
      perTest,
      rulesById,
    });
    console.log(
      `walkdown: recorded ${record.results.length} rule result(s) → ${relative(process.cwd(), file)}`,
    );
  }

  printsToStdio() {
    return false;
  }
}
