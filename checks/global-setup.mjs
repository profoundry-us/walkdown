/*
 * The checks drive a real walkdown server, and the panel WRITES — threads,
 * drafts, run records. Pointing that at blueprint/ would mean a check run
 * appending notes and verdicts to the project's own ledger, which is exactly
 * the thing this tool exists to keep honest.
 *
 * So the suite serves a disposable copy. blueprint/ is copied into
 * .walkdown/checkspace/ before the run and the prototype directory is linked
 * beside it, because `prototype.root` resolves against the blueprint's parent.
 * Anything the checks write lands there and is thrown away next run.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocations } from '../lib/locations.js';
import { EXAMPLE_DECLARED, EXAMPLE_ORIGIN } from '../playwright.config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CHECKSPACE = join(root, '.walkdown', 'checkspace');

export default function globalSetup() {
  /*
   * Pin the personal-config home at a scratch directory inside the checkspace.
   * Locations are resolved from ~/.walkdown/config.yml, and a suite that read
   * the developer's own would pass or fail depending on whose laptop ran it -
   * the one thing a check may never depend on. Pinned rather than merely
   * unset, because unset means the real home.
   */
  /*
   * Where this machine really keeps evidence, asked BEFORE the home is pinned -
   * the pin is what makes the suite reproducible, and it would otherwise
   * answer with the empty scratch home instead of the place the screenshots
   * actually are.
   */
  const pinned = process.env.WALKDOWN_HOME;
  delete process.env.WALKDOWN_HOME;
  const realEvidence = resolveLocations({ dir: join(root, 'blueprint') }).evidence.path;
  process.env.WALKDOWN_HOME = pinned ?? join(CHECKSPACE, 'home');

  rmSync(CHECKSPACE, { recursive: true, force: true });
  mkdirSync(join(CHECKSPACE, 'home'), { recursive: true });
  mkdirSync(CHECKSPACE, { recursive: true });
  cpSync(join(root, 'blueprint'), join(CHECKSPACE, 'blueprint'), { recursive: true });
  /*
   * A sibling, so the server holds more than one project. Some rules are only
   * visible with a choice to make — which blueprint a page belongs to, and what
   * the panel does when you pick one that is about somewhere else.
   */
  cpSync(join(root, 'example', 'blueprint'), join(CHECKSPACE, 'example', 'blueprint'), {
    recursive: true,
  });
  rmSync(join(CHECKSPACE, 'example', 'blueprint', 'drafts'), { recursive: true, force: true });
  /*
   * And point the copy's declared address at the port this run serves the
   * example app on. A pin filed on a page that names no project is routed to
   * one BY ITS ADDRESS, so the address the copy declares has to be the address
   * the page is really at. The real blueprint keeps saying 4310 — that is a
   * person's review server and this suite must neither adopt nor kill it. Safe
   * to rewrite here and nowhere else: the checkspace is thrown away every run,
   * and no check in it reads an example verdict, which is the thing moving a
   * target would invalidate (lib/status.js `inPlace`).
   */
  const exCfg = join(CHECKSPACE, 'example', 'blueprint', 'walkdown.yml');
  writeFileSync(exCfg, readFileSync(exCfg, 'utf8').replaceAll(EXAMPLE_DECLARED, EXAMPLE_ORIGIN));
  // Drafts are working state; a copied half-finished sitting would confuse a check.
  rmSync(join(CHECKSPACE, 'blueprint', 'drafts'), { recursive: true, force: true });
  if (!existsSync(join(CHECKSPACE, 'prototype')))
    symlinkSync(join(root, 'prototype'), join(CHECKSPACE, 'prototype'), 'dir');
  /*
   * Evidence, linked rather than copied. It no longer lives in the repository,
   * so copying `blueprint/` no longer brings it - and one check opens a
   * screenshot and asserts the picture actually loaded, because a count of
   * pictures nobody can see is not evidence. Linked because it is 97MB and
   * this runs before every suite.
   */
  const evLink = join(CHECKSPACE, 'blueprint', 'runs', 'evidence');
  if (realEvidence && existsSync(realEvidence) && !existsSync(evLink)) {
    mkdirSync(dirname(evLink), { recursive: true });
    symlinkSync(realEvidence, evLink, 'dir');
  }
  /*
   * And the two check suites, for the same reason: `authoring.location`
   * resolves against the blueprint's parent, so without them the copy is a
   * project whose rules have no checks anywhere. That makes the panel's
   * check-source disclosure unverifiable here - it would have no source to
   * show - and it quietly disables the coverage staleness the real project
   * has. Linked, not copied: they are what the run is testing.
   */
  for (const dir of ['checks', 'test'])
    if (!existsSync(join(CHECKSPACE, dir)))
      symlinkSync(join(root, dir), join(CHECKSPACE, dir), 'dir');
  /*
   * The embed checks need what an adopter has and walkdown itself does not: an
   * application page that is a storyboard screen, carrying anchors, long enough
   * to scroll. checks/fixtures/app.html is that page, and this is what makes it
   * a screen - without which the panel has no pins to push into the frame and
   * a pin placed there would vanish the moment it was filed.
   */
  /*
   * Declare the copies. The server used to WALK the checkspace for
   * `walkdown.yml` files; it reads a config now (n-0133), and without one
   * here the walk upward finds walkdown's OWN committed config instead - so
   * the panel would list the real blueprint beside the disposable one and
   * `?bp=` could select the ledger this suite exists not to touch.
   *
   * Ids match what the discovery used to produce, because the fixture page
   * defaults `data-bp` to `blueprint`.
   */
  mkdirSync(join(CHECKSPACE, '.walkdown'), { recursive: true });
  writeFileSync(
    join(CHECKSPACE, '.walkdown', 'config.yml'),
    [
      'projects:',
      '  - id: blueprint',
      '    roots: [.]',
      '    spec: blueprint',
      '  - id: example/blueprint',
      '    roots: [example]',
      '    spec: example/blueprint',
      '',
    ].join('\n'),
  );

  const sb = join(CHECKSPACE, 'blueprint', 'storyboard.yml');
  writeFileSync(
    sb,
    readFileSync(sb, 'utf8') +
      [
        '',
        '  - id: fixture-app',
        '    title: The application under review (browser checks only)',
        '    prototype: /screens/review.html',
        '    app: { path: /app.html }',
        '    anchors:',
        '      - host.title',
        '      - host.cta',
        '      - host.card',
        '      - host.second',
        '',
      ].join('\n'),
  );
}
