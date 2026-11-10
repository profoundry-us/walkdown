/*
 * A SCREEN'S SETUP, READ ONCE (ADR 0017 §§1, 3, 4).
 *
 * `app.setup` is prose, a list of steps, or `{ recipe: <name> }` naming steps
 * declared under the storyboard's `recipes:`. Lint reads it to refuse what the
 * panel cannot run, the server reads it to hand the panel steps with their
 * fixtures filled in, and both read it to say when two screens are one state.
 * If they read it differently a setup lint passed would fail in the panel, so
 * the reading lives here.
 *
 * Nothing here touches the disk: where a machine keeps its fixtures is
 * lib/fixtures.js's to know.
 */

/** The steps the panel can run, each a navigation of the app's own frame. */
export const STEP_KINDS = ['visit', 'post', 'wait_for'];

const FIXTURE = /\{fixtures\.([A-Za-z0-9_-]+)\}/g;

/** The kind of one step, or the first key it has when that is no kind at all. */
export function stepKind(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
  return STEP_KINDS.find((k) => k in step) ?? Object.keys(step)[0] ?? null;
}

/**
 * What a screen's setup is.
 *
 * @returns {{ kind: 'none' } | { kind: 'prose', prose: string }
 *   | { kind: 'steps', steps: Record<string, any>[], recipe: string | null, missingRecipe?: boolean }}
 */
export function setupOf(screen, storyboard) {
  const raw = screen?.app?.setup;
  if (raw === undefined || raw === null || raw === '') return { kind: 'none' };
  if (typeof raw === 'string') return { kind: 'prose', prose: raw };
  if (Array.isArray(raw)) return { kind: 'steps', steps: raw, recipe: null };
  if (typeof raw === 'object' && 'recipe' in raw) {
    const name = String(raw.recipe);
    const steps = storyboard?.recipes?.[name];
    return Array.isArray(steps)
      ? { kind: 'steps', steps, recipe: name }
      : { kind: 'steps', steps: [], recipe: name, missingRecipe: true };
  }
  return { kind: 'steps', steps: [raw], recipe: null };
}

/** Every string a step holds that a fixture may fill in. */
function stepStrings(step) {
  const kind = stepKind(step);
  const out = [];
  if (kind && typeof step[kind] === 'string') out.push(step[kind]);
  if (kind === 'post' && step.fields && typeof step.fields === 'object')
    for (const v of Object.values(step.fields)) if (typeof v === 'string') out.push(v);
  return out;
}

/** The fixture keys a string names, in the order it names them. */
export function fixtureKeys(text) {
  return [...String(text ?? '').matchAll(FIXTURE)].map((m) => m[1]);
}

/**
 * The fixtures a screen needs, each with where it is used: `setup` wins over
 * `path` when a key is in both, because setup runs first.
 *
 * @returns {{ key: string, where: 'setup' | 'path' }[]}
 */
export function usedFixtures(screen, storyboard) {
  const seen = new Map();
  const setup = setupOf(screen, storyboard);
  if (setup.kind === 'steps')
    for (const step of setup.steps)
      for (const s of stepStrings(step))
        for (const key of fixtureKeys(s)) if (!seen.has(key)) seen.set(key, 'setup');
  for (const key of fixtureKeys(screen?.app?.path)) if (!seen.has(key)) seen.set(key, 'path');
  return [...seen].map(([key, where]) => ({ key, where }));
}

/**
 * A string with its fixtures filled in. A key with no value is left as it was
 * written and named in `missing`.
 *
 * @param {string} text
 * @param {Record<string, string | number | boolean>} values
 */
export function fill(text, values = {}) {
  const missing = [];
  const out = String(text ?? '').replace(FIXTURE, (whole, key) => {
    if (key in values) return String(values[key]);
    if (!missing.includes(key)) missing.push(key);
    return whole;
  });
  return { text: out, missing };
}

/**
 * A screen's steps and path as the panel runs them on one target: every
 * fixture filled in, and the keys that had no value.
 */
export function resolveSetup(screen, storyboard, values = {}) {
  const setup = setupOf(screen, storyboard);
  const missing = new Set();
  const filled = (text) => {
    const r = fill(text, values);
    for (const k of r.missing) missing.add(k);
    return r.text;
  };
  const steps =
    setup.kind === 'steps'
      ? setup.steps.map((step) => {
          const kind = stepKind(step);
          const out = { kind, value: typeof step?.[kind] === 'string' ? filled(step[kind]) : '' };
          if (kind === 'post')
            out.fields = Object.fromEntries(
              Object.entries(step.fields ?? {}).map(([k, v]) => [
                k,
                typeof v === 'string' ? filled(v) : String(v),
              ]),
            );
          return out;
        })
      : [];
  const path = screen?.app?.path ? filled(screen.app.path) : null;
  return {
    kind: setup.kind,
    prose: setup.kind === 'prose' ? setup.prose : null,
    recipe: setup.kind === 'steps' ? setup.recipe : null,
    steps,
    path,
    missing: [...missing],
  };
}

/**
 * A setup as one string, for telling two screens apart (ADR 0017 §4). Two
 * setups that run the same steps are the same, however they were written: a
 * recipe and its steps written out compare equal. Prose is not run, so it
 * tells nothing apart, and reads the same as no setup.
 */
export function setupSignature(screen, storyboard) {
  const setup = setupOf(screen, storyboard);
  if (setup.kind !== 'steps') return '';
  if (setup.missingRecipe) return `recipe:${setup.recipe}`;
  return JSON.stringify(
    setup.steps.map((step) => {
      const kind = stepKind(step);
      return kind === 'post'
        ? [kind, step[kind], Object.entries(step.fields ?? {}).sort()]
        : [kind, step?.[kind]];
    }),
  );
}

/** A setup as its author wrote it, for a message: `{ recipe: name }`, or a count of steps. */
export function describeSetup(screen, storyboard) {
  const setup = setupOf(screen, storyboard);
  if (setup.kind !== 'steps') return 'no setup';
  if (setup.recipe) return `setup { recipe: ${setup.recipe} }`;
  return `setup of ${setup.steps.length} step${setup.steps.length === 1 ? '' : 's'}`;
}
