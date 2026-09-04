import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The unfinished session, on disk.
 *
 * A run record is history: written once, at Finish, never edited. But the
 * judging that leads to one takes a sitting, and until it is sealed it lived
 * only in a browser — invisible to `walkdown status`, to agents, and to any
 * other window, and gone with the profile. A draft is that work-in-progress
 * kept in the project instead: one file per target, rewritten on every
 * verdict, and deleted the moment the session becomes a run.
 *
 * It is deliberately NOT a run: it lives in drafts/, carries no run_id, and
 * nothing derives verification from it. That is what keeps the ledger
 * append-only while the work behind it is still durable.
 */

/*
 * Drafts never follow the spec into a repository: a half-finished sitting is
 * one person's working state at one moment, and committing one would put a
 * verdict nobody has finished giving in front of everybody.
 */
/*
 * Resolved and ALLOCATED: a draft is a write, so a fresh project's tentative
 * numbered home is made real here - and asking twice cannot then disagree,
 * which it briefly could when the tentative answer was recomputed mid-write.
 */
/*
 * Every function here takes the DRAFTS DIRECTORY, not a blueprint directory.
 *
 * It used to take the blueprint and ask `resolveLocations({ spec })` for the
 * rest - which resolves from `process.cwd()`, so a server or a reporter
 * standing anywhere but the project's own tree silently asked a different
 * `.walkdown` where the drafts go, and got null once a blueprint had to be
 * declared to resolve at all. Every caller already holds a loaded blueprint,
 * and a loaded blueprint already knows: `blueprint.at.drafts.path`. One
 * resolution, made where the tree is known.
 */
export const draftPath = (drafts, target = 'local') =>
  join(drafts, `${String(target).replace(/[^\w.-]/g, '-')}.json`);

/** The draft for a target, or null. Unreadable or corrupt reads as none. */
export function readDraft(drafts, target = 'local') {
  const file = draftPath(drafts, target);
  if (!existsSync(file)) return null;
  try {
    const draft = JSON.parse(readFileSync(file, 'utf8'));
    return draft?.verdicts ? draft : null;
  } catch {
    return null;
  }
}

/** Every draft session in this blueprint, newest first. */
export function listDrafts(drafts) {
  if (!drafts || !existsSync(drafts)) return [];
  return readdirSync(drafts)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readDraft(drafts, f.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')));
}

/**
 * Write (or overwrite) the draft for a target. `verdicts` is rule → status,
 * `threads` is rule → thread ids filed for it during the sitting.
 */
export function writeDraft(
  drafts,
  { target = 'local', actor, started, verdicts, threads = {} },
) {
  mkdirSync(drafts, { recursive: true });
  // A directory of unfinished sittings is working state, not history — the
  // repo should no more track it than an editor's swap file.
  const ignore = join(drafts, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n!.gitignore\n');
  const draft = {
    draft: true,
    target,
    actor: actor ?? null,
    started: started ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    updated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    verdicts,
    ...(Object.keys(threads).length && { threads }),
  };
  writeFileSync(draftPath(drafts, target), JSON.stringify(draft, null, 2) + '\n');
  return draft;
}

/** Drop the draft — the session became a run, or was discarded. */
export function clearDraft(drafts, target = 'local') {
  rmSync(draftPath(drafts, target), { force: true });
}
