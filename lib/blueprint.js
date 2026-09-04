import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from '../vendor/yaml.js';
import { canon, expand, readUserConfig, resolveLocations } from './locations.js';
import { TIERS } from './vocab.js';

function listFiles(dir, exts) {
  // `dir` can be null: an entry that names no path for a kind and no home to
  // derive one from. That is a misconfiguration lint errors on, but reading
  // is not where it should blow up - and `existsSync(null)` is deprecated.
  if (!dir || !existsSync(dir)) return [];
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
/**
 * @param {string} dir the spec directory
 * @param {{ cwd?: string }} [from] where to resolve its records from - the
 *   `.walkdown` that answers THERE is what declares them. Defaults to the
 *   process's own directory, which is right for every command; a reader
 *   holding a path to a blueprint declared elsewhere (a test, a tool) says
 *   where it would have been standing.
 */
export function loadBlueprint(dir, { cwd = process.cwd() } = {}) {
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
    ? (readYaml(join(dir, 'storyboard.yml')) ?? { screens: [] })
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
  const at = resolveLocations({ spec: dir, cwd });
  /*
   * Every blueprint walkdown reads is one somebody declared. A path nothing
   * declares used to load anyway, with its records looked for inside it -
   * the layout from before homes - and that is the door through which a
   * bare `blueprint/` directory kept being a thing. It is not: the resolver
   * answers with no spec and says why, and so does this.
   */
  if (!at.spec?.path) throw new Error(at.spec?.why ?? `nothing declares ${dir}`);
  const threads = listFiles(at.threads.path, ['.yml', '.yaml'])
    .map((file) => ({ file, data: readYaml(file) }))
    .filter((t) => t.data != null);
  const runs = listFiles(at.runs.path, ['.json'])
    .map((file) => ({ file, data: readJson(file) }))
    .filter((r) => r.data != null);

  return {
    dir,
    /*
     * TWO roots, because one field was answering two questions and they only
     * agreed while the spec lived in the repository (issue #7).
     *
     * `projectRoot` is what the BLUEPRINT sits beside - display ids, and the
     * relative names lint reports. It used to anchor proposals/ and
     * prototype.root too, and that held only while the spec sat at
     * <project>/blueprint. In a numbered home the spec's parent is the home,
     * and a design's prototype is in the CODE - so those resolve against
     * codeRoot, the same root authoring.location already used.
     *
     * `codeRoot` is where the CODE is - the cwd for runner commands and the
     * base every check ref hangs off. Once `init` began putting specs outside
     * the repository, dirname(spec) became the walkdown home, so `run` shelled
     * out in a directory with no test suite in it. `walkdown where` already
     * resolved this correctly; this is the rest of the CLI reading what that
     * row says.
     */
    projectRoot: dirname(dir),
    codeRoot: at.codeRoot ?? dirname(dir),
    config,
    storyboard,
    features,
    threads,
    runs,
    problems,
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
export function verifyList(rule) {
  const excused = new Set(Object.keys(rule?.unverifiable ?? {}));
  const declared = rule?.verify ? (Array.isArray(rule.verify) ? rule.verify : [rule.verify]) : [];
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

/**
 * Every blueprint this machine knows about, from the config — the repository's
 * committed list merged under the person's own (n-0140).
 *
 * This replaced a walk of the tree looking for `walkdown.yml`, which found
 * things nobody meant to offer and needed a hardcoded skip list for
 * `node_modules`, `fixture` and `fixtures` to stay tolerable. A written list
 * never has that problem: what is on it is what somebody declared.
 *
 * Ids are the config entry's own id now, not a path relative to whatever
 * directory the server happened to start in — so `?bp=example` rather than
 * `?bp=example/blueprint`, and the same id on every machine.
 */
export function listedBlueprints({ cwd = process.cwd() } = {}) {
  const { config } = readUserConfig({ cwd });
  const out = [];
  for (const entry of config.projects ?? []) {
    if (!entry?.id || !entry?.spec) continue;
    const dir = expand(entry.spec);
    if (!existsSync(join(dir, 'walkdown.yml'))) continue;
    let name = null;
    let description = null;
    try {
      const cfg = parse(readFileSync(join(dir, 'walkdown.yml'), 'utf8'));
      name = cfg?.project ?? null;
      description = cfg?.description ?? null;
    } catch {
      /* unnamed */
    }
    /*
     * `key` is what tells two listed blueprints apart when their ids do
     * not: mono/app committed at the root and mono/app/packs/app listed
     * personally are both `app`, and a chooser keyed by id served the
     * root's for either click (n-0173). The spec directory is unique by
     * construction - one directory, one blueprint.
     */
    out.push({ id: entry.id, key: canon(dir), dir, name: name ?? entry.id, description });
  }
  return out;
}
