/*
 * walkdown's browser checks — the tier that verifies what a person actually
 * sees and does. The node:test suite next door verifies the ledger's own laws;
 * neither can stand in for the other (see ownership.evidence.same-surface).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './checks',
  globalSetup: './checks/global-setup.mjs',
  // Adopters write ['walkdown/reporter']; inside the package itself that alias
  // cannot self-resolve from Playwright's own module scope, so point at the file.
  reporter: [['list'], ['./lib/playwright-reporter.js']],
  use: {
    /*
     * The system under test is walkdown itself, so this is walkdown's own
     * address — the one blueprint/walkdown.yml declares for the local target.
     * The reporter stamps it onto every run, and a run made against some other
     * address is evidence about some other system (verdict-belongs-to-a-place).
     * Fixture pages are navigated to by absolute URL; they are the host the
     * panel docks into, not the thing being verified.
     */
    baseURL: process.env.APP_HOST ?? 'http://localhost:4700',
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
      command: 'node bin/walkdown.js serve --dir .walkdown/checkspace/blueprint --port 4700',
      url: 'http://localhost:4700/api/blueprint',
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: 'python3 -m http.server 4712 --directory checks/fixtures',
      url: 'http://localhost:4712/docked.html',
      reuseExistingServer: false,
    },
  ],
});
