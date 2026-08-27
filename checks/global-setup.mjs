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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CHECKSPACE = join(root, '.walkdown', 'checkspace');

export default function globalSetup() {
  rmSync(CHECKSPACE, { recursive: true, force: true });
  mkdirSync(CHECKSPACE, { recursive: true });
  cpSync(join(root, 'blueprint'), join(CHECKSPACE, 'blueprint'), { recursive: true });
  /*
   * A sibling, so the server holds more than one project. Some rules are only
   * visible with a choice to make — which blueprint a page belongs to, and what
   * the panel does when you pick one that is about somewhere else.
   */
  cpSync(join(root, 'example', 'blueprint'), join(CHECKSPACE, 'example', 'blueprint'), { recursive: true });
  rmSync(join(CHECKSPACE, 'example', 'blueprint', 'drafts'), { recursive: true, force: true });
  // Drafts are working state; a copied half-finished sitting would confuse a check.
  rmSync(join(CHECKSPACE, 'blueprint', 'drafts'), { recursive: true, force: true });
  if (!existsSync(join(CHECKSPACE, 'prototype')))
    symlinkSync(join(root, 'prototype'), join(CHECKSPACE, 'prototype'), 'dir');
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
  const sb = join(CHECKSPACE, 'blueprint', 'storyboard.yml');
  writeFileSync(sb, readFileSync(sb, 'utf8') +
    ['', '  - id: fixture-app', '    title: The application under review (browser checks only)',
     '    prototype: /screens/review.html', '    app: { path: /app.html }',
     '    anchors:', '      - host.title', '      - host.cta', '      - host.card',
     '      - host.second', ''].join('\n'));
}
