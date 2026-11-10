/*
 * WHAT DIFFERS BY MACHINE (ADR 0017 §3).
 *
 * A screen's setup and path name records by key - `{fixtures.expense_submitted}`
 * - and each target says which record that is. The values come from two
 * places: `runner.targets.<t>.fixtures` in spec.yml, committed, for ids that
 * are the same for everyone; and what `walkdown fixtures set` kept on this
 * machine, which wins. The kept values live in the personal home, never in
 * the blueprint's: they are the machine's, like the registry (ADR 0014).
 *
 * walkdown never makes the records and never runs the app's code to make
 * them. It keeps what it is handed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from '../vendor/yaml.js';
import { walkdownHome } from './locations.js';

/** Where this machine keeps one blueprint's fixtures for one target. */
export const keptFixturesPath = (blueprintId, target) =>
  join(walkdownHome(), 'fixtures', String(blueprintId), `${target}.yml`);

/** A value a path or a form field can carry: it has a text form. */
export const isFixtureValue = (v) =>
  (typeof v === 'string' && v !== '') ||
  (typeof v === 'number' && Number.isFinite(v)) ||
  typeof v === 'boolean';

/**
 * The values kept on this machine, or null when none were ever set.
 *
 * @returns {Record<string, string | number | boolean> | null}
 */
export function readKeptFixtures(blueprintId, target) {
  const file = keptFixturesPath(blueprintId, target);
  if (!blueprintId || !existsSync(file)) return null;
  try {
    const data = parse(readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/**
 * Keep values, merged key by key: a key handed in replaces that key's value,
 * and a key not handed in is kept.
 *
 * @returns {{ file: string, all: Record<string, string | number | boolean> }}
 */
export function keepFixtures(blueprintId, target, values) {
  const file = keptFixturesPath(blueprintId, target);
  const all = { ...(readKeptFixtures(blueprintId, target) ?? {}), ...values };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringify(all));
  return { file, all };
}

/** What spec.yml gives one target, with anything that is not a value left out. */
export function specFixtures(config, target) {
  const raw = config?.runner?.targets?.[target]?.fixtures;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => isFixtureValue(v)));
}

/**
 * One target's fixtures as a screen sees them: spec.yml's, with the kept ones
 * winning.
 *
 * @returns {{ values: Record<string, string | number | boolean>, kept: boolean }}
 */
export function fixturesFor(config, blueprintId, target) {
  const kept = readKeptFixtures(blueprintId, target);
  return { values: { ...specFixtures(config, target), ...(kept ?? {}) }, kept: kept !== null };
}
