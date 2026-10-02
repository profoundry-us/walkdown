/*
 * THE OTHER BLUEPRINTS IN A BLUEPRINT'S PROJECT (ADR 0013).
 *
 * Several blueprints registered for one project share its test suite and its
 * thread numbering, and cite each other's threads. A reader that knows only
 * its own blueprint calls a sibling's check "a rule that does not exist" and
 * numbers a thread its sibling already used. This is the one place that asks
 * the registry who the siblings are.
 */
import { existsSync, readdirSync } from 'node:fs';
import { canon, expand, readRegistry, resolveLocations } from './locations.js';

/**
 * Every other blueprint registered for the project this spec belongs to,
 * with where its spec and threads are. None for a blueprint with no project
 * (a scratch copy) or one alone in its project.
 *
 * @param {string} specDir
 * @returns {{ id: string, dir: string, threads: string | null }[]}
 */
export function siblingsOf(specDir) {
  const me = resolveLocations({ spec: specDir });
  const project = me.blueprint?.project;
  if (!project) return [];
  const mine = canon(specDir);
  const out = [];
  for (const r of readRegistry().rows) {
    if (!r?.registered || !r.home || r.ephemeral || !r.project) continue;
    if (canon(expand(String(r.project))) !== canon(project)) continue;
    const loc = resolveLocations({ blueprint: String(r.id), cwd: project });
    if (!loc.spec?.path || canon(loc.spec.path) === mine || !existsSync(loc.spec.path)) continue;
    out.push({ id: String(r.id), dir: loc.spec.path, threads: loc.threads?.path ?? null });
  }
  return out;
}

/** The thread ids held in a threads directory, from the file names alone. */
export function threadIdsIn(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^([nq]-\d+)\.ya?ml$/)?.[1])
    .filter(Boolean);
}
