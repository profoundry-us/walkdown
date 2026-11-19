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
import { fixturesFor } from './fixtures.js';
import { peopleOf, userSetup } from './personas.js';
import { stepFixtures } from './setup.js';

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

/** The five marks a story can carry, in the order they are counted (ADR 0018 §5). */
export const STORY_MARKS = ['failing', 'not-built', 'you', 'agent', 'passing'];

/**
 * Where each story stands, rolled up from its live rules: the first of the
 * five that holds (ADR 0018 §5). A story with no live rule has no mark.
 *
 * @param {any[]} rows       deriveStatus's rows
 * @param {any[]} attention  deriveStatus's queue
 * @returns {Map<string, string>}
 */
export function storyMarks(rows, attention) {
  const person = new Set();
  for (const a of attention ?? []) if (a?.who === 'human' && a.rule) person.add(a.rule);
  const by = new Map();
  for (const row of rows ?? []) {
    if (!row?.story) continue;
    if (!by.has(row.story)) by.set(row.story, []);
    by.get(row.story).push(row);
  }
  const marks = new Map();
  for (const [story, mine] of by) {
    let mark = 'passing';
    if (mine.some((r) => r.verdict === 'fail')) mark = 'failing';
    else if (mine.some((r) => !r.built)) mark = 'not-built';
    else if (mine.some((r) => person.has(r.rule))) mark = 'you';
    else if (mine.some((r) => r.verdict !== 'pass')) mark = 'agent';
    marks.set(story, mark);
  }
  return marks;
}

const listOf = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/**
 * What the Personas mode lists (ADR 0018 §7): the groups that have a persona,
 * each persona with its users, its stories by where they stand and the boards
 * it is on, and the systems. The people are the blueprint's own or the ones
 * `personas_from:` names; the stories, boards and fixtures are this one's.
 *
 * @param {any} blueprint
 * @param {{ rows?: any[], attention?: any[], boards?: any[] }} [status]
 */
export function readPeople(blueprint, { rows = [], attention = [], boards = [] } = {}) {
  const people = peopleOf(blueprint);
  // Somebody else's people that this machine cannot read: said, and not passed off as none.
  if (!people.known)
    return { groups: [], personas: [], systems: [], targets: [], unread: people.from ?? null };
  const config = blueprint.config ?? {};
  const targets = Object.keys(config.runner?.targets ?? {});
  if (!targets.length) targets.push('local');
  const values = new Map(
    targets.map((t) => [t, fixturesFor(config, blueprint.at?.id ?? null, t).values]),
  );
  const marks = storyMarks(rows, attention);
  // Who each story is as, and so which stories and boards a persona has.
  const actors = new Map();
  for (const { data } of blueprint.features ?? [])
    for (const story of data?.stories ?? [])
      if (story?.id && marks.has(story.id)) actors.set(story.id, listOf(story.as).map(String));
  const personas = listOf(people.personas)
    .filter((p) => p && typeof p === 'object' && p.id)
    .map((p) => {
      const id = String(p.id);
      const stories = [...actors].filter(([, as]) => as.includes(id)).map(([story]) => story);
      const counts = Object.fromEntries(
        STORY_MARKS.map((m) => [m, stories.filter((s2) => marks.get(s2) === m).length]),
      );
      return {
        id,
        title: p.title ?? id,
        of: p.of ?? null,
        group: p.group != null ? String(p.group) : null,
        blurb: p.blurb ?? null,
        uses: p.uses ?? null,
        users: listOf(p.users)
          .filter((u) => u?.id)
          .map((u) => {
            const setup = userSetup(u, people);
            const keys =
              setup.kind === 'steps' && !setup.missingRecipe ? stepFixtures(setup.steps) : [];
            return {
              id: String(u.id),
              title: u.title ?? String(u.id),
              fixtures: keys,
              // Whether this user has an account on each target: every key it signs in with has a value.
              targets: keys.length
                ? targets.map((t) => ({
                    target: t,
                    set: keys.every((k) => values.get(t)?.[k] !== undefined),
                  }))
                : [],
            };
          }),
        stories: { total: stories.length, ...counts },
        boards: boards
          .filter((b) => b.cards.some((c) => c.story && stories.includes(c.story)))
          .map((b) => ({ id: b.id, title: b.title })),
      };
    });
  const used = new Set(personas.map((p) => p.group));
  return {
    groups: listOf(people.groups)
      .filter((g) => g?.id && used.has(String(g.id)))
      .map((g) => ({ id: String(g.id), title: g.title ?? String(g.id) })),
    personas,
    systems: listOf(people.systems)
      .filter((s2) => s2?.id)
      .map((s2) => ({
        id: String(s2.id),
        title: s2.title ?? String(s2.id),
        outside: s2.outside === true,
      })),
    targets,
  };
}
