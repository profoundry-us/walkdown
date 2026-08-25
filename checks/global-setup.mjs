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
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CHECKSPACE = join(root, '.walkdown', 'checkspace');

export default function globalSetup() {
  rmSync(CHECKSPACE, { recursive: true, force: true });
  mkdirSync(CHECKSPACE, { recursive: true });
  cpSync(join(root, 'blueprint'), join(CHECKSPACE, 'blueprint'), { recursive: true });
  // Drafts are working state; a copied half-finished sitting would confuse a check.
  rmSync(join(CHECKSPACE, 'blueprint', 'drafts'), { recursive: true, force: true });
  if (!existsSync(join(CHECKSPACE, 'prototype')))
    symlinkSync(join(root, 'prototype'), join(CHECKSPACE, 'prototype'), 'dir');
}
