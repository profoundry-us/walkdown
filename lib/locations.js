/*
 * Where this project's pieces live, and why.
 *
 * One answer, computed once, so that every command agrees about it and a
 * person can ask the same question the tool asks (`walkdown where`). The
 * design and the reasoning are in docs/08-locations.md; this is the resolver.
 *
 * The principle it implements: the blueprint declares what the project needs,
 * and ~/.walkdown/config.yml declares where this machine puts things and who
 * is sitting at it. A personal config may move files and name ports. It may
 * never change what a rule means, or `walkdown status` would say two different
 * things on two laptops.
 *
 * Nothing here writes. Resolving a location is a question, and asking it must
 * be free of consequences - `walkdown where` on a project with no config at
 * all should leave the disk exactly as it found it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parse, parseDocument } from 'yaml';

/**
 * Locate the blueprint directory: `dir` itself if it holds walkdown.yml,
 * a `blueprint/` child, or the same probed on ancestors (up to 6 levels).
 */
export function findBlueprintDir(start = process.cwd()) {
  let dir = resolve(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'walkdown.yml'))) return dir;
    if (existsSync(join(dir, 'blueprint', 'walkdown.yml'))) return join(dir, 'blueprint');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Overridable so checks can point the whole scheme at a scratch directory. */
export const walkdownHome = () =>
  process.env.WALKDOWN_HOME || join(homedir(), '.walkdown');

export const configPath = () => join(walkdownHome(), 'config.yml');

/** `~/x` and relative paths resolved the way a person means them. */
export function expand(p, from = process.cwd()) {
  if (!p) return null;
  const s = String(p).trim();
  if (s === '~') return homedir();
  if (s.startsWith('~/')) return join(homedir(), s.slice(2));
  return isAbsolute(s) ? s : resolve(from, s);
}

/**
 * The personal config, or an empty one. A malformed config is reported rather
 * than thrown past: a file the person can fix should not stop them running the
 * command that would tell them it is broken.
 */
export function readUserConfig() {
  const path = configPath();
  if (!existsSync(path)) return { path, exists: false, config: {}, error: null };
  try {
    return { path, exists: true, config: parse(readFileSync(path, 'utf8')) ?? {}, error: null };
  } catch (e) {
    return { path, exists: true, config: {}, error: e.message };
  }
}

/*
 * How many records a directory holds, ignoring housekeeping files. Only ever
 * used to WORD the answer - whether a legacy directory counts is decided by
 * whether it exists, not by whether anything has been written to it yet.
 */
function records(dir) {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

/** The working tree a path sits in, for the sha that says what code ran. */
export function gitRoot(from) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = resolve(dir, '..');
    if (up === dir) return null;
    dir = up;
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'project';

/*
 * The project entry whose `roots` contain this directory - the most specific
 * one, when several do. A repository can hold more than one blueprint, so an
 * entry rooted at a subdirectory has to beat one rooted at the whole tree, or
 * the outer project answers for its own siblings.
 */
function projectFor(cwd, config) {
  const here = resolve(cwd);
  let best = null;
  for (const p of config.projects ?? []) {
    for (const root of [p.roots ?? []].flat()) {
      const r = expand(root);
      if (!r || !(here === r || here.startsWith(r + '/'))) continue;
      if (!best || r.length > best.root.length) best = { project: p, root: r };
    }
  }
  return best;
}

/** What a blueprint calls itself, which is the best id it can have. */
function declaredProject(specDir) {
  try {
    const y = parse(readFileSync(join(specDir, 'walkdown.yml'), 'utf8'));
    return y?.project ? slug(y.project) : null;
  } catch {
    return null;
  }
}

/*
 * Where each kind of record sits inside a blueprint that already holds it.
 * These are what every project used before locations were configurable, and
 * they are still what most projects use.
 */
const LEGACY = {
  runs: (spec) => join(spec, 'runs'),
  threads: (spec) => join(spec, 'threads'),
  drafts: (spec) => join(spec, 'drafts'),
  evidence: (spec) => join(spec, 'runs', 'evidence'),
};

export const KINDS = ['runs', 'threads', 'evidence', 'drafts'];

/*
 * Which kinds live beside the spec when nothing says otherwise.
 *
 * Runs and threads do, because they are the same KIND of thing the spec is: a
 * claim the team makes together, worth reviewing, worth `git blame`. Putting
 * the spec in a repository and leaving its conversations outside would let a
 * second person clone a project and find no record of why anything was decided.
 * Following the spec also makes opting in one decision instead of four.
 *
 * Evidence and drafts do not. Evidence is binary, unreviewable and was 135x
 * everything else in this project put together; drafts are one person's
 * half-finished sitting. Neither is a claim, and neither belongs in a diff.
 */
const FOLLOWS_SPEC = new Set(['runs', 'threads']);

/**
 * Every path this project uses, each with the reason it was chosen.
 *
 * `dir` is the --dir flag, which names a blueprint outright and wins over
 * everything. `overrides` lets a caller pin one kind the same way.
 */
export function resolveLocations({ cwd = process.cwd(), dir = null, overrides = {} } = {}) {
  const { path: cfgPath, exists: cfgExists, config, error: cfgError } = readUserConfig();
  const defaults = config.defaults ?? {};
  /*
   * Which project entry applies. Normally the one whose `roots` contain the
   * working directory - but `--dir` names a blueprint outright, and then the
   * entry matching where you happen to be STANDING describes a different
   * project entirely. Letting it keep applying reported one project's spec
   * beside another's ledger, which is worse than reporting nothing: it named
   * a runs directory that has no relationship to the rules above it.
   *
   * So a named blueprint is answered by the entry that owns THAT blueprint, or
   * by no entry at all.
   */
  const matched = dir
    ? (() => {
        const p = (config.projects ?? []).find((x) => x.spec && expand(x.spec) === expand(dir, cwd));
        return p ? { project: p, root: null } : null;
      })()
    : projectFor(cwd, config);
  let project = matched?.project ?? null;

  // ---- the spec ------------------------------------------------------------
  let spec;
  const found = dir ? null : findBlueprintDir(cwd);
  /*
   * The NEAREST blueprint wins.
   *
   * A repository can hold several - this one holds walkdown and
   * walkdown-example - and an entry rooted at the whole tree would otherwise
   * answer for every sibling in it: standing in example/ and being told the
   * outer project's spec, its runs and its threads. So a blueprint found in
   * the tree beats a configured entry when it sits deeper than the root that
   * entry matched on. An entry still wins where the tree has nothing to say,
   * which is the case a spec kept outside the repository is entirely about.
   */
  const nearer = found && matched?.root
    && resolve(found, '..') !== matched.root
    && resolve(found, '..').startsWith(matched.root + '/');
  if (nearer) project = null;

  if (dir) spec = { path: expand(dir, cwd), why: 'named on the command line' };
  else if (project?.spec) spec = { path: expand(project.spec), why: `this machine's config (${project.id ?? 'project'})` };
  else if (found) spec = { path: resolve(found), why: 'found in the working tree' };

  const code = gitRoot(spec?.path ?? cwd) ?? gitRoot(cwd);
  const id = project?.id ? slug(project.id)
    : (spec && declaredProject(spec.path))
    ?? slug(basename(code ?? cwd));

  const home = walkdownHome();
  const builtIn = (kind) => join(home, 'projects', id, kind);

  if (!spec) {
    // Nothing in the tree and nothing configured: the default, which is out.
    const fromDefaults = defaults.spec && expand(String(defaults.spec).replace('{id}', id));
    spec = fromDefaults
      ? { path: fromDefaults, why: 'the config default, outside the repository' }
      : { path: builtIn('blueprint'), why: 'the built-in default, outside the repository' };
    spec.missing = !existsSync(spec.path);
  }

  // ---- the records ---------------------------------------------------------
  const out = {};
  for (const kind of KINDS) {
    if (overrides[kind]) { out[kind] = { path: expand(overrides[kind], cwd), why: 'named on the command line' }; continue; }
    if (project?.[kind]) { out[kind] = { path: expand(project[kind]), why: `this machine's config (${project.id ?? 'project'})` }; continue; }
    /*
     * A blueprint that already has the directory keeps it, and this
     * deliberately outranks `defaults`. Defaults are a blanket preference; an
     * existing ledger is a fact, and a preference should never silently orphan
     * one. Moving it is a decision somebody makes.
     *
     * The test is EXISTS, not "holds records", and that matters: `drafts` is
     * created empty but for a .gitignore, and the writers still write there. A
     * resolver that reported a location nothing writes to would be worse than
     * no resolver, because `walkdown where` would be confidently wrong.
     */
    const legacy = LEGACY[kind](spec.path);
    if (existsSync(legacy)) {
      const n = records(legacy);
      out[kind] = {
        path: legacy,
        why: n ? `already in the blueprint (${n} file${n === 1 ? '' : 's'})` : 'already in the blueprint',
      };
      continue;
    }
    if (defaults[kind]) {
      out[kind] = { path: expand(String(defaults[kind]).replace('{id}', id)), why: 'the config default' };
      continue;
    }
    out[kind] = FOLLOWS_SPEC.has(kind)
      ? { path: join(spec.path, kind), why: 'beside the spec, as runs and threads follow it' }
      : { path: builtIn(kind), why: 'the built-in default, outside the repository' };
  }

  return {
    id,
    home,
    config: { path: cfgPath, exists: cfgExists, error: cfgError, matched: Boolean(project) },
    code: code ? { path: code, why: 'the git repository the spec sits in' }
                : { path: null, why: 'no git repository — runs will carry no git_sha' },
    spec,
    ...out,
  };
}

/*
 * Write a location choice into the personal config, creating it if need be.
 *
 * Deliberately surgical: it reads the file, changes the one key, and writes it
 * back with `yaml`'s own formatter. A config is a person's file - comments and
 * ordering in it are theirs - so a rewrite that reflowed the whole document
 * would be taking more than it was given. `yaml`'s document API preserves
 * comments, which a parse-and-dump round trip would not.
 */
export function rememberLocation(loc, kind, to) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const doc = existsSync(path)
    ? parseDocument(readFileSync(path, 'utf8'))
    : parseDocument('# walkdown, personal configuration. See docs/08-locations.md.\n');

  if (!doc.has('projects')) doc.set('projects', []);
  const projects = doc.get('projects');
  const items = projects.items ?? [];
  let entry = items.find((it) => String(it.get?.('id') ?? '') === loc.id);
  if (!entry) {
    // createNode, not a bare object: `add` would insert plain JS that has no
    // `set`, and the entry has to stay editable for the line below.
    projects.add(doc.createNode({
      id: loc.id,
      roots: [loc.code?.path ?? dirname(loc.spec.path)],
      spec: loc.spec.path,
    }));
    entry = projects.items.at(-1);
  }
  entry.set(kind, to);
  writeFileSync(path, String(doc));
  return path;
}
