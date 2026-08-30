import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from '../vendor/yaml.js';
import { findBlueprintDir, resolveLocations } from './locations.js';

/*
 * `findBlueprintDir` lives in locations.js now - finding a blueprint is a
 * question about where things are, and keeping it here would have made
 * blueprint.js and locations.js import each other. Re-exported because half
 * the CLI reaches for it from this module.
 */
export { findBlueprintDir };

function listFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile())
    .sort();
}

/**
 * Load every blueprint artifact under `dir`. Parse failures never throw; they
 * are collected as { file, message } in `problems` so lint can report them.
 */
export function loadBlueprint(dir) {
  const problems = [];
  const readYaml = (file) => {
    try {
      return parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push({ file, message: `YAML parse error: ${err.message.split('\n')[0]}` });
      return null;
    }
  };
  const readJson = (file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push({ file, message: `JSON parse error: ${err.message}` });
      return null;
    }
  };

  const config = readYaml(join(dir, 'walkdown.yml')) ?? {};
  const storyboard = existsSync(join(dir, 'storyboard.yml'))
    ? readYaml(join(dir, 'storyboard.yml')) ?? { screens: [] }
    : { screens: [] };

  const features = listFiles(join(dir, 'features'), ['.yml', '.yaml'])
    .map((file) => ({ file, data: readYaml(file) }))
    .filter((f) => f.data != null);
  /*
   * Threads and runs are read from wherever this machine keeps them, which is
   * beside the spec unless somebody said otherwise. Composing the paths here
   * would have made every reader in the project disagree with `walkdown where`
   * the moment anything moved.
   */
  const at = resolveLocations({ dir });
  const threads = listFiles(at.threads.path, ['.yml', '.yaml'])
    .map((file) => ({ file, data: readYaml(file) }))
    .filter((t) => t.data != null);
  const runs = listFiles(at.runs.path, ['.json'])
    .map((file) => ({ file, data: readJson(file) }))
    .filter((r) => r.data != null);

  return {
    dir, projectRoot: dirname(dir), config, storyboard, features, threads, runs, problems,
    at,
  };
}

/** Flatten features into [{ file, feature, story, rule }]. */
export function collectRules(features) {
  const rules = [];
  for (const { file, data } of features) {
    for (const story of data?.stories ?? []) {
      for (const rule of story?.rules ?? []) {
        rules.push({ file, feature: data, story, rule });
      }
    }
  }
  return rules;
}

/** A rule's required evidence types; the documented default is [checks]. */
/*
 * Which evidence tiers a rule asks for.
 *
 * This used to read a `verify` list, and the default was ['checks'] - so a
 * rule got the cheapest tier unless somebody remembered to type the others,
 * and skipping the agent was silent. Inverted now: every tier is assumed, and
 * a rule that cannot honestly be checked at one says so in `unverifiable`,
 * with a reason a person can read and argue with. The vision's "cheapest tier
 * that can honestly check it" is a rule of the schema rather than a habit.
 *
 * `verify` is still honoured where it appears, because the runner contract
 * documents it and other projects' blueprints carry it. Where both are
 * present the excuses win, since they are the more specific statement.
 */
export const TIERS = ['checks', 'agent'];

export function verifyList(rule) {
  const excused = new Set(Object.keys(rule?.unverifiable ?? {}));
  const declared = rule?.verify
    ? (Array.isArray(rule.verify) ? rule.verify : [rule.verify])
    : [];
  /*
   * A tier that must be AUTHORED is opt-in; a tier that costs only a run is
   * assumed. That is the line, and it is why the two are treated differently
   * rather than inconsistently: a check is engineering work somebody
   * schedules and reviews, so a rule says when it wants one. An agent
   * walkdown is a run - there is nothing to write - so every rule gets one
   * unless it cannot honestly have one, and saying so costs a reason.
   *
   * `human` used to appear here and no longer does: who accepts a rule is
   * signoffList's business, because acceptance is a set of people rather than
   * a kind of evidence.
   */
  const tiers = declared.filter((t) => t === 'checks');
  if (!excused.has('agent')) tiers.push('agent');
  return tiers.filter((t) => !excused.has(t));
}

/*
 * Why a tier is absent, or null if it is not. Read by the panel and the CLI so
 * an excuse is visible where the evidence would have been - an excuse nobody
 * can read is one nobody can argue with, which is the whole reason it is
 * written down rather than implied by an omission.
 */
export function excuseFor(rule, tier) {
  const why = rule?.unverifiable?.[tier];
  return typeof why === 'string' && why.trim() ? why.trim() : null;
}

/*
 * The roles that must accept this rule. Engineering always signs - somebody
 * has to own that the thing was built right, and a rule nobody accepts is a
 * rule nobody owns (docs/00-vision.md, problem 7). Product signs the rules it
 * asked for; other roles join the list as a team needs them.
 */
export function signoffList(rule) {
  const s = rule?.signoff ?? ['eng'];
  const roles = (Array.isArray(s) ? s : [s]).map((r) => String(r).trim()).filter(Boolean);
  return roles.includes('eng') ? roles : ['eng', ...roles];
}
