import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { loadBlueprint } from './blueprint.js';
import { defaultActor } from './identity.js';
import { resolveLocations } from './locations.js';
import { fileRun, filingLines } from './filing.js';

const RULE_TAG = /^@rule:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const RULE_IN_TITLE = /@rule:([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/**
 * Playwright reporter that appends a walkdown run record after every run.
 *
 *   // playwright.config.ts
 *   reporter: [['list'], ['walkdown/reporter']]
 *
 * Options (all optional): { dir, target, actor, baseUrl, evidenceDir, home }.
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
 * next run deletes — the fate of the test-results/ paths this replaces.
 *
 * `home` is the same concern one step further: the registry the run is filed
 * through lives in the walkdown home (ADR 0003), and a harness that pins the
 * home at a throwaway copy for the run has pinned the reporter at a registry
 * that does not name the blueprint of record. Passing `home` (a path, or
 * null for the default ~/.walkdown) makes the reporter file the run under
 * that home and put the pin back afterwards.
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
    // Narrowed when told: the option, or the spec `walkdown run --blueprint`
    // passes. Otherwise every blueprint in the project, each result filed by
    // its rule (lib/filing.js).
    this.dir = this.options.dir ? resolve(this.options.dir) : process.env.WALKDOWN_SPEC || null;
  }

  onEnd() {
    const pinned = process.env.WALKDOWN_HOME;
    if ('home' in this.options) {
      if (this.options.home == null) delete process.env.WALKDOWN_HOME;
      else process.env.WALKDOWN_HOME = String(this.options.home);
    }
    try {
      this.record();
    } finally {
      if (pinned === undefined) delete process.env.WALKDOWN_HOME;
      else process.env.WALKDOWN_HOME = pinned;
    }
  }

  record() {
    /*
     * Attachments are copied OUT of Playwright's output directory before the
     * record names them: that directory is emptied at the start of the next
     * run, and a record citing it holds evidence for exactly one run's
     * lifetime - the 2026-09-01T01-04-49Z fail's screenshot was already
     * unrecoverable by the time anyone asked why it failed (n-0136). Filed
     * under the home by logical key instead, the way the agent tier files
     * its screenshots, so the server can resolve them on any machine.
     * Into the home of the blueprint that holds the rule - which is only
     * known once the run is being filed, so it happens in `prepare`.
     */
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
    const fileEvidence = (path, blueprintDir) => {
      try {
        const root = this.options.evidenceDir
          ? resolve(this.options.evidenceDir)
          : resolveLocations({ spec: blueprintDir }).evidence.path;
        const name = `${basename(dirname(path))}-${basename(path)}`;
        mkdirSync(join(root, stamp), { recursive: true });
        copyFileSync(path, join(root, stamp, name));
        return `runs/evidence/${stamp}/${name}`;
      } catch {
        return null; // the doomed path over nothing - it lives until the next run
      }
    };

    const perTest = [];
    for (const test of this.suite.allTests()) {
      const tags = (test.tags ?? []).map((t) => t.match(RULE_TAG)?.[1]).filter(Boolean);
      if (!tags.length) for (const m of test.title.matchAll(RULE_IN_TITLE)) tags.push(m[1]);
      if (!tags.length) continue;

      const outcome = test.outcome(); // expected | unexpected | flaky | skipped
      const status = outcome === 'unexpected' ? 'fail' : outcome === 'skipped' ? 'skipped' : 'pass';
      const durationMs = test.results.reduce((ms, r) => ms + (r.duration ?? 0), 0);
      const attachments = (test.results.at(-1)?.attachments ?? []).filter((a) => a.path).map((a) => a.path);
      for (const ruleId of tags)
        perTest.push({
          ruleId,
          status,
          durationMs,
          checkFile: test.location?.file ?? null,
          checkLine: test.location?.line ?? null,
          attachments,
        });
    }

    if (!perTest.length) {
      console.error('walkdown reporter: no tests tagged @rule:<id> — run not recorded');
      return;
    }

    const filed = fileRun({
      perTest,
      target: this.options.target ?? process.env.WALKDOWN_TARGET ?? 'local',
      baseUrl: this.baseUrl,
      actor: (dir) => this.options.actor ?? (process.env.CI ? 'ci' : defaultActor(dir).username),
      dir: this.dir,
      // Check refs name files in the CODE, which is no longer the blueprint's
      // parent once the spec lives outside the repository (issue #7); filing
      // relativises them against the holding blueprint's code root.
      prepare: ({ attachments, ...entry }, blueprintDir) => {
        const codeRoot = loadBlueprint(blueprintDir).codeRoot ?? process.cwd();
        return {
          ...entry,
          evidence: attachments.map((p) => fileEvidence(p, blueprintDir) ?? relative(codeRoot, p)),
        };
      },
    });
    for (const line of filingLines(filed)) (filed.none ? console.error : console.log)(line.replace('walkdown:', filed.none ? 'walkdown reporter:' : 'walkdown:'));
  }

  printsToStdio() {
    return false;
  }
}
