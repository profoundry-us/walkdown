/*
 * The checks drive a real walkdown server, and the panel WRITES — threads,
 * drafts, run records. Pointing that at blueprint/ would mean a check run
 * appending notes and verdicts to the project's own ledger, which is exactly
 * the thing this tool exists to keep honest.
 *
 * So the suite serves a disposable copy. blueprint/ is copied into
 * tmp/checkspace/ before the run - from playwright.config.js, at import, because
 * Playwright launches the web servers from the config BEFORE globalSetup runs,
 * and a server started in a checkspace that does not exist yet fails with an
 * ENOENT on its cwd. It worked for months only because a previous run had left
 * the directory behind; a fresh clone never had one.
 *
 * Guarded by an environment variable rather than a module flag: Playwright's
 * workers re-import the config, and a worker that rebuilt the checkspace would
 * pull the directory out from under the running server. The main process
 * prepares once and the workers inherit the mark. and the prototype directory is linked
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CHECKSPACE = join(root, 'tmp', 'checkspace');
/** walkdown's own home, relative to either root. */
export const HOME = join('.walkdown', 'blueprints', '0001-walkdown');
/** The example's home, relative to example/. */
export const EXAMPLE_HOME = join('.walkdown', 'blueprints', '0001-example');

/**
 * @param {{ exampleDeclared: string, exampleOrigin: string }} addresses
 *   the example blueprint's declared address and the one this run serves it on
 */
export function prepare({ exampleDeclared: EXAMPLE_DECLARED, exampleOrigin: EXAMPLE_ORIGIN }) {
  if (process.env.WALKDOWN_CHECKSPACE === CHECKSPACE) return;
  process.env.WALKDOWN_CHECKSPACE = CHECKSPACE;

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
  const realEvidence = resolveLocations({ spec: join(root, HOME, 'blueprint') }).evidence.path;
  process.env.WALKDOWN_HOME = pinned ?? join(CHECKSPACE, 'home');

  rmSync(CHECKSPACE, { recursive: true, force: true });
  mkdirSync(join(CHECKSPACE, 'home'), { recursive: true });
  mkdirSync(CHECKSPACE, { recursive: true });
  /*
   * The home, as it is laid out - blueprint/ threads/ runs/ - into a
   * .walkdown of the checkspace's own, so the copy has the same shape as the
   * real thing and the same shape as any adopter's.
   */
  for (const part of ['blueprint', 'threads', 'runs'])
    cpSync(join(root, HOME, part), join(CHECKSPACE, HOME, part), { recursive: true });
  /*
   * A sibling, so the server holds more than one project. Some rules are only
   * visible with a choice to make — which blueprint a page belongs to, and what
   * the panel does when you pick one that is about somewhere else.
   */
  /*
   * Copied FLAT - spec with runs and threads inside it, at example/blueprint -
   * rather than as the pack-with-its-own-.walkdown it really is. The
   * checkspace's one config declares both projects so one server offers both,
   * and a pack's .walkdown would hide it from that server by design. The flat
   * shape is the legacy one the resolver still answers for (rule 3), which
   * this copy also exercises.
   */
  const exHome = join(root, 'example', EXAMPLE_HOME);
  cpSync(join(exHome, 'blueprint'), join(CHECKSPACE, 'example', 'blueprint'), { recursive: true });
  for (const part of ['runs', 'threads'])
    cpSync(join(exHome, part), join(CHECKSPACE, 'example', 'blueprint', part), { recursive: true });
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
  if (!existsSync(join(CHECKSPACE, 'prototype')))
    symlinkSync(join(root, 'prototype'), join(CHECKSPACE, 'prototype'), 'dir');
  /*
   * Evidence, linked rather than copied. It no longer lives in the repository,
   * so copying `blueprint/` no longer brings it - and one check opens a
   * screenshot and asserts the picture actually loaded, because a count of
   * pictures nobody can see is not evidence. Linked because it is 97MB and
   * this runs before every suite.
   */
  const evLink = join(CHECKSPACE, HOME, 'evidence');
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
  /*
   * And who is sitting at this machine. Records are written under the config's
   * identity now, and accepting work is refused outright where nobody has
   * written one down (n-0143) - so without this the suite is a machine that
   * cannot verify anything, and half the panel's checks fail on a refusal
   * that is correct.
   */
  writeFileSync(
    join(process.env.WALKDOWN_HOME, 'config.yml'),
    ['identity:', '  username: checks-person', '  name: A Checks Person', ''].join('\n'),
  );

  mkdirSync(join(CHECKSPACE, '.walkdown'), { recursive: true });
  writeFileSync(
    join(CHECKSPACE, '.walkdown', 'config.yml'),
    [
      'projects:',
      '  - id: blueprint',
      '    roots: [.]',
      `    spec: ${HOME}/blueprint`,
      `    threads: ${HOME}/threads`,
      `    runs: ${HOME}/runs`,
      `    evidence: ${HOME}/evidence`,
      `    drafts: ${HOME}/drafts`,
      '    home: 0001-walkdown',
      '  - id: example/blueprint',
      '    roots: [example]',
      '    spec: example/blueprint',
      '',
    ].join('\n'),
  );

  const sb = join(CHECKSPACE, HOME, 'blueprint', 'storyboard.yml');
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
