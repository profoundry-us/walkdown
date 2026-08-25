/*
 * walkdown's browser checks — the tier that verifies what a person actually
 * sees and does. The node:test suite next door verifies the ledger's own laws;
 * neither can stand in for the other (see ownership.evidence.same-surface).
 */
import { defineConfig } from '@playwright/test';

/*
 * Two ways to run these, because they are used two ways.
 *
 * OF RECORD (`walkdown run`, or CI): binds the address blueprint/walkdown.yml
 * declares for the local target and appends a run record. Evidence has to be
 * about the declared address or the ledger will not count it, so this refuses
 * to start when something else holds the port — the something else is serving
 * the REAL blueprint, and these checks write.
 *
 * WHILE BUILDING (`npm run checks:dev`): binds a throwaway port and records
 * nothing, so a developer or agent can run the suite as often as they like
 * beside their own running server without appending half-finished verdicts to
 * the project's history.
 */
const RECORD = process.env.WALKDOWN_RECORD !== '0';
const WD_PORT = Number(process.env.WALKDOWN_CHECK_PORT ?? (RECORD ? 4700 : 4713));
const FIXTURE_PORT = WD_PORT + 12;
export const WD_ORIGIN = `http://localhost:${WD_PORT}`;
export const FIXTURE = `http://localhost:${FIXTURE_PORT}/docked.html?wd=${encodeURIComponent(WD_ORIGIN)}`;

export default defineConfig({
  testDir: './checks',
  /*
   * One worker, on purpose. These checks drive one walkdown server over one
   * blueprint, and several of them WRITE to it — a pin filed, a sitting
   * finished. Run in parallel they read each other's half-finished ledger and
   * fail for reasons that have nothing to do with the rules they check. The
   * whole suite is a few seconds; determinism is worth more than the seconds.
   */
  workers: 1,
  fullyParallel: false,
  globalSetup: './checks/global-setup.mjs',
  // Adopters write ['walkdown/reporter']; inside the package itself that alias
  // cannot self-resolve from Playwright's own module scope, so point at the file.
  reporter: RECORD ? [['list'], ['./lib/playwright-reporter.js']] : [['list']],
  use: {
    /*
     * The system under test is walkdown itself, so this is walkdown's own
     * address — the one blueprint/walkdown.yml declares for the local target.
     * The reporter stamps it onto every run, and a run made against some other
     * address is evidence about some other system (verdict-belongs-to-a-place).
     * Fixture pages are navigated to by absolute URL; they are the host the
     * panel docks into, not the thing being verified.
     */
    baseURL: process.env.APP_HOST ?? WD_ORIGIN,
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-testid',
  },
  // Two servers: walkdown itself, serving the disposable blueprint copy, and a
  // plain static host for the fixture pages that carry the panel.
  webServer: [
    {
      // The declared port, serving the disposable copy. Never reuse an existing
      // server: one already on 4700 is serving the REAL blueprint, and these
      // checks write. Failing to start beats writing verdicts into the project.
      command: `node bin/walkdown.js serve --dir .walkdown/checkspace/blueprint --port ${WD_PORT}`,
      url: `${WD_ORIGIN}/api/blueprint`,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: `python3 -m http.server ${FIXTURE_PORT} --directory checks/fixtures`,
      url: `http://localhost:${FIXTURE_PORT}/docked.html`,
      reuseExistingServer: false,
    },
  ],
});
