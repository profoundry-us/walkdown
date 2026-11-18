/*
 * A blueprint's boards and personas, as the panel's Boards and Personas
 * modes are handed them (ADR 0018 §§2, 4, 7).
 *
 * This reads what the mode switch needs and no more: which boards there
 * are, what each is called, its cards in file order, and the personas the
 * storyboard declares. Lanes, arrows, marks and pictures belong to the
 * board's own rules, which are not written yet, and nothing here guesses
 * at them. A file that cannot be read is left out: lint is where a broken
 * board is said, not a page that is trying to draw the others.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../vendor/yaml.js';

/** `<home>/boards/*.yml`, in file-name order. */
export function readBoards(blueprint) {
  const dir = join(blueprint.dir, 'boards');
  if (!existsSync(dir)) return [];
  const titles = new Map();
  for (const { data } of blueprint.features ?? [])
    for (const story of data?.stories ?? []) if (story?.id) titles.set(story.id, story.title);
  const boards = [];
  for (const file of readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(file)) continue;
    let data;
    try {
      data = parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (!data || typeof data !== 'object') continue;
    const id = String(data.board ?? file.replace(/\.ya?ml$/, ''));
    boards.push({
      id,
      title: data.title ?? id,
      phases: Array.isArray(data.phases) ? data.phases.map(String) : [],
      cards: (Array.isArray(data.cards) ? data.cards : [])
        .filter((c) => c && typeof c === 'object' && (c.story || c.id))
        .map((c) => ({
          id: String(c.id ?? c.story),
          story: c.story ? String(c.story) : null,
          title: c.title ?? titles.get(c.story) ?? String(c.story ?? c.id),
          phase: c.phase != null ? String(c.phase) : null,
        })),
    });
  }
  return boards;
}

/** The storyboard's `personas:`, in its order, with each one's users named. */
export function readPersonas(blueprint) {
  const list = blueprint.storyboard?.personas;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p === 'object' && p.id)
    .map((p) => ({
      id: String(p.id),
      title: p.title ?? String(p.id),
      of: p.of ?? null,
      blurb: p.blurb ?? null,
      uses: p.uses ?? null,
      users: (Array.isArray(p.users) ? p.users : [])
        .filter((u) => u?.id)
        .map((u) => ({ id: String(u.id), title: u.title ?? String(u.id) })),
    }));
}
