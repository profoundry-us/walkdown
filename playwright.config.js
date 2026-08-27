/*
 * walkdown's browser checks — the tier that verifies what a person actually
 * sees and does. The node:test suite next door verifies the ledger's own laws;
 * neither can stand in for the other (see ownership.evidence.same-surface).
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { parse } from 'yaml';

/*
 * Two ways to run these, because they are used two ways.
 *
 * OF RECORD (`walkdown run`, or CI): appends a run record.
 * WHILE BUILDING (`npm run checks:dev`): records nothing, so a developer or an
 * agent can run the suite as often as they like without appending
 * half-finished verdicts to the project's history.
 *
 * NEITHER binds 4700. That port is where a person keeps `walkdown serve`
 * running to review with, and these checks WRITE - threads, drafts, run
 * records - so they must never be pointed at the server holding the real
 * blueprint. They bring their own, on their own port, over a throwaway copy.
 *
 * The address they RECORD is a different thing from the port they bind, and
 * deliberately so: a run record names the system that was verified, and for
 * walkdown that is the address its own blueprint declares for the local
 * target. The human path already works this way - finishing a walkdown records
 * the configured base_url whatever port the server happens to be on - so
 * declaring it here keeps one meaning of "where" across both tiers, and keeps
 * a harness detail from invalidating a person's verdicts.
 */
const RECORD = process.env.WALKDOWN_RECORD !== '0';
const WD_PORT = Number(process.env.WALKDOWN_CHECK_PORT ?? (RECORD ? 4701 : 4713));
const FIXTURE_PORT = WD_PORT + 12;
export const WD_ORIGIN = `http://localhost:${WD_PORT}`;
/*
 * The panel has one delivery: it frames the page it reviews. The fixture is the
 * extension's shape - a host page that publishes __walkdownConfig and loads
 * panel.js - pointed at the blueprint's own review screen. `docked.html` was the
 * other delivery's fixture and went with it on 2026-08-26.
 */
export const FIXTURE = `http://localhost:${FIXTURE_PORT}/extension.html?wd=${
  encodeURIComponent(WD_ORIGIN)}&frame=${encodeURIComponent(WD_ORIGIN + '/stand-in/review')}`;

/*
 * The address the blueprint declares — one source of truth, read from it.
 *
 * It is what a run RECORDS, and it is also what the panel NAVIGATES to when it
 * swaps to the app surface: an app screen lives at `base_url + app.path`
 * (lib/serve.js `appBase`). Recording it is right; reaching for it over the
 * network is not, because nothing this suite starts is listening there — so
 * checks that swapped surfaces were quietly served by whatever `walkdown serve`
 * a person had left up, and passed or failed on whether anyone had (n-0112).
 * The checks resolve this address to the server the run actually started; see
 * `declaredResolvesHere` in checks/panel.spec.js. It is exported for that.
 */
export const DECLARED = parse(readFileSync(new URL('./blueprint/walkdown.yml', import.meta.url), 'utf8'))
  ?.runner?.targets?.local?.base_url ?? WD_ORIGIN;

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
  reporter: RECORD ? [['list'], ['./lib/playwright-reporter.js', { baseUrl: DECLARED }]] : [['list']],
  use: {
    /*
     * The system under test is walkdown itself, so this is walkdown's own
     * address — the one blueprint/walkdown.yml declares for the local target.
     * The reporter stamps it onto every run, and a run made against some other
     * address is evidence about some other system (verdict-belongs-to-a-place).
     * Fixture pages are navigated to by absolute URL; they are the host that
     * carries the panel, not the thing being verified.
     */
    baseURL: process.env.APP_HOST ?? WD_ORIGIN,
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-testid',
  },
  // Two servers: walkdown itself, serving the disposable blueprint copy, and a
  // plain static host for the fixture pages that carry the panel.
  webServer: [
    {
      // Our own server, on our own port, over the disposable copy. Never reuse
      // an existing one: whatever is already listening is somebody else's, and
      // these checks write.
      command: `node bin/walkdown.js serve --dir .walkdown/checkspace/blueprint --port ${WD_PORT}`,
      url: `${WD_ORIGIN}/api/blueprint`,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: `python3 -m http.server ${FIXTURE_PORT} --directory checks/fixtures`,
      url: `http://localhost:${FIXTURE_PORT}/extension.html`,
      reuseExistingServer: false,
    },
    /*
     * The example project's own app, at the address its blueprint declares.
     * Some rules are only visible when a page belongs to a project that is NOT
     * the one this server serves by default.
     */
    {
      command: 'python3 -m http.server 4310 --directory example/app',
      url: 'http://localhost:4310/index.html',
      reuseExistingServer: true,
    },
  ],
});
