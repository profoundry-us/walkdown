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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parse, parseDocument } from '../vendor/yaml.js';

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
export const walkdownHome = () => process.env.WALKDOWN_HOME || join(homedir(), '.walkdown');

export const configPath = () => join(walkdownHome(), 'config.yml');

/*
 * Where an agent's personal skills live - not walkdown's home but the agent's,
 * because these are procedures the person carries between projects rather than
 * records this project owns.
 *
 * Honours CLAUDE_CONFIG_DIR, which is the agent's own way of saying its home
 * moved; a project that keeps skills in its repository instead never comes
 * here at all.
 */
export const skillsHome = () =>
  process.env.WALKDOWN_SKILLS_DIR ||
  join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills');

/*
 * The numbered home registry (thread n-0124). Every blueprint's out-of-tree
 * records live in a directory ALLOCATED to it - `blueprints/0001-walkdown/` -
 * never in one derived from a name, because names collide exactly where the
 * default-out design matters most: thirty monorepo packs all called by the
 * repository's basename, or two blueprints inside one pack. The index is the
 * allocation record; numbers are never reused.
 *
 * Reading the registry is free. Allocating writes, so it happens on CREATION -
 * init, or the first command that is about to put a record there - never on a
 * question. Until then a fresh project's paths are worded as tentative.
 */
export const registryDir = () => join(walkdownHome(), 'blueprints');
const registryIndex = () => join(registryDir(), 'index.yml');

/** The allocation record, or empty. Malformed reads as empty, like the config. */
export function readRegistry() {
  try {
    return parse(readFileSync(registryIndex(), 'utf8'))?.blueprints ?? [];
  } catch {
    return [];
  }
}

/*
 * The next free number considers directories as well as the index, because
 * evidence is written by hand from a printed path - a numbered directory can
 * exist that no index entry claims yet, and handing its number out twice
 * would be the collision this registry exists to end.
 */
function nextNumber(entries) {
  let n = 0;
  for (const e of entries) n = Math.max(n, Number(e?.name?.match(/^(\d+)-/)?.[1] ?? 0));
  try {
    for (const d of readdirSync(registryDir())) n = Math.max(n, Number(d.match(/^(\d+)-/)?.[1] ?? 0));
  } catch {}
  return n + 1;
}

const homeEntryFor = (entries, { spec, root }) =>
  (spec && entries.find((e) => e?.spec && expand(e.spec) === resolve(spec))) ||
  (!spec && root && entries.find((e) => e?.root && expand(e.root) === resolve(root))) ||
  null;

/**
 * Allocate a numbered home for one blueprint, idempotently. `spec` keys the
 * entry (`root` stands in while a fresh project has no spec yet); `makeDir`
 * false lets `walkdown migrate` rename a legacy directory into place instead.
 */
export function allocateHome({ spec, root, slug: hint }, { makeDir = true } = {}) {
  const entries = readRegistry();
  const existing = homeEntryFor(entries, { spec, root });
  if (existing) return { ...existing, path: join(registryDir(), existing.name) };
  const name = `${String(nextNumber(entries)).padStart(4, '0')}-${slug(hint ?? 'project')}`;
  const entry = {
    name,
    ...(spec ? { spec: resolve(spec) } : {}),
    ...(root ? { root: resolve(root) } : {}),
    created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  };
  mkdirSync(registryDir(), { recursive: true });
  writeFileSync(registryIndex(), REGISTRY_HEADER + stringifyRegistry([...entries, entry]));
  const path = join(registryDir(), name);
  if (makeDir) mkdirSync(path, { recursive: true });
  return { ...entry, path };
}

const REGISTRY_HEADER =
  '# Allocated homes, one per blueprint, numbered on creation. Numbers are\n' +
  '# never reused. See docs/08-locations.md.\n';

/*
 * Record (or re-point) the spec on an allocated entry. An entry carrying only
 * `root:` can be found by at most one blueprint per repository, and only by a
 * spec-less ask - a later `--dir <its own spec>` misses it and allocates the
 * same blueprint a SECOND home, stranding the first one's records (n-0129).
 * So the moment a home is known to hold or serve a spec, the index says which.
 */
export function setHomeSpec(name, spec) {
  const entries = readRegistry();
  const entry = entries.find((e) => e?.name === name);
  if (!entry || (entry.spec && expand(entry.spec) === resolve(spec))) return;
  entry.spec = resolve(spec);
  writeFileSync(registryIndex(), REGISTRY_HEADER + stringifyRegistry(entries));
}

const stringifyRegistry = (entries) =>
  `blueprints:\n${entries
    .map((e) =>
      [
        `  - name: ${e.name}`,
        ...(e.spec ? [`    spec: ${e.spec}`] : []),
        ...(e.root ? [`    root: ${e.root}`] : []),
        `    created: ${e.created}`,
      ].join('\n'),
    )
    .join('\n')}\n`;

/**
 * Make a tentative home real before the first write lands in it. A no-op for
 * every location that is not pending. When allocation hands out a different
 * number than the ask-time answer (something else was created in between),
 * the location paths are re-pointed and the caller uses what comes back.
 */
export function ensureAllocated(loc, kind) {
  const pending = loc?.pendingHome;
  if (!pending) return loc;
  const tentative = join(registryDir(), pending.name);
  if (kind && !loc[kind]?.path?.startsWith(tentative + '/') && loc[kind]?.path !== tentative)
    return loc;
  const entry = allocateHome(pending);
  if (entry.path !== tentative) {
    for (const k of [...KINDS, 'spec'])
      if (loc[k]?.path?.startsWith(tentative))
        loc[k] = { ...loc[k], path: entry.path + loc[k].path.slice(tentative.length) };
  }
  // The first write claims the number; if the spec resolves INSIDE this home
  // (init is about to put it there), claim that too - or the entry stays
  // findable only by root, and serving the spec it holds allocates a second
  // home for the same blueprint (n-0129).
  if (!entry.spec && loc.spec?.path?.startsWith(entry.path + '/'))
    setHomeSpec(entry.name, loc.spec.path);
  loc.pendingHome = null;
  return loc;
}

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

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
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
 * One resolved location: where, and the reason it was chosen there.
 * @typedef {{ path: string, why: string, missing?: boolean }} Location
 */
/**
 * Every path this project uses, each with the reason it was chosen.
 *
 * `dir` is the --dir flag, which names a blueprint outright and wins over
 * everything. `overrides` lets a caller pin one kind the same way.
 *
 * The record kinds are declared here rather than inferred because they are
 * assembled in a loop over KINDS - the checker cannot see past that, and the
 * callers' whole contract is these five keys.
 *
 * @param {{ cwd?: string, dir?: string | null, overrides?: Record<string, string> }} [where]
 * @returns {{ id: string, home: string,
 *   pendingHome: { name: string, spec: string | null, root: string | null, slug: string } | null,
 *   config: { path: string, exists: boolean, error: string | null, matched: boolean },
 *   code: { path: string | null, why: string },
 *   spec: Location, runs: Location, threads: Location,
 *   evidence: Location, drafts: Location }}
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
        const p = (config.projects ?? []).find(
          (x) => x.spec && expand(x.spec) === expand(dir, cwd),
        );
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
  const nearer =
    found &&
    matched?.root &&
    resolve(found, '..') !== matched.root &&
    resolve(found, '..').startsWith(matched.root + '/');
  if (nearer) project = null;

  if (dir) spec = { path: expand(dir, cwd), why: 'named on the command line' };
  else if (project?.spec)
    spec = {
      path: expand(project.spec),
      why: `this machine's config (${project.id ?? 'project'})`,
    };
  else if (found) spec = { path: resolve(found), why: 'found in the working tree' };

  const code = gitRoot(spec?.path ?? cwd) ?? gitRoot(cwd);
  const id = project?.id
    ? slug(project.id)
    : ((spec && declaredProject(spec.path)) ?? slug(basename(code ?? cwd)));

  const home = walkdownHome();
  /*
   * The out-of-tree home: the registry's allocated directory when this
   * blueprint has one; the legacy name-keyed `projects/<id>` while it still
   * exists (an existing ledger is a fact, and `walkdown migrate` renumbers
   * it, never a resolver); and for a blueprint seen for the first time, the
   * name the next allocation WOULD take - worded as tentative, because
   * answering must not write. Allocation happens on first write
   * (ensureAllocated), keyed by the spec path, or by the repository root
   * while a fresh project has no spec yet.
   */
  const entries = readRegistry();
  const specKey = spec?.path ? resolve(spec.path) : null;
  const homeEntry = homeEntryFor(entries, { spec: specKey, root: specKey ? null : code });
  const legacyHome = join(home, 'projects', id);
  const legacy = !homeEntry && existsSync(legacyHome);
  const homeDir = homeEntry
    ? join(registryDir(), homeEntry.name)
    : legacy
      ? legacyHome
      : join(registryDir(), `${String(nextNumber(entries)).padStart(4, '0')}-${slug(id)}`);
  const homeWhy = legacy
    ? 'the built-in default, outside the repository (legacy home — `walkdown migrate` renumbers it)'
    : homeEntry
      ? 'the built-in default, outside the repository'
      : 'the built-in default, outside the repository (allocated on first write)';
  const pendingHome =
    homeEntry || legacy
      ? null
      : { name: basename(homeDir), spec: specKey, root: code, slug: id };
  const builtIn = (kind) => join(homeDir, kind);

  if (!spec) {
    // Nothing in the tree and nothing configured: the default, which is out.
    const fromDefaults = defaults.spec && expand(String(defaults.spec).replace('{id}', id));
    spec = fromDefaults
      ? { path: fromDefaults, why: 'the config default, outside the repository' }
      : { path: builtIn('blueprint'), why: homeWhy };
    spec.missing = !existsSync(spec.path);
  }

  // ---- the records ---------------------------------------------------------
  const out = {};
  for (const kind of KINDS) {
    if (overrides[kind]) {
      out[kind] = { path: expand(overrides[kind], cwd), why: 'named on the command line' };
      continue;
    }
    if (project?.[kind]) {
      out[kind] = {
        path: expand(project[kind]),
        why: `this machine's config (${project.id ?? 'project'})`,
      };
      continue;
    }
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
        why: n
          ? `already in the blueprint (${n} file${n === 1 ? '' : 's'})`
          : 'already in the blueprint',
      };
      continue;
    }
    if (defaults[kind]) {
      out[kind] = {
        path: expand(String(defaults[kind]).replace('{id}', id)),
        why: 'the config default',
      };
      continue;
    }
    out[kind] = FOLLOWS_SPEC.has(kind)
      ? { path: join(spec.path, kind), why: 'beside the spec, as runs and threads follow it' }
      : { path: builtIn(kind), why: homeWhy };
  }

  const [runs, threads, evidence, drafts] = KINDS.map((k) => out[k]);
  /*
   * The code row reads the FINAL spec, not the early one that fed the id and
   * the home key - and it says which situation it is actually in. One fixed
   * string here claimed "the git repository the spec sits in" while the spec
   * sat in no repository at all - the DEFAULT shape for a new project - and
   * the same screen showed the spec elsewhere, so the report contradicted
   * itself exactly for the reader it exists to orient (n-0131).
   */
  const specRepo = spec?.path ? gitRoot(spec.path) : null;
  const codePath = specRepo ?? code;
  return {
    id,
    home,
    pendingHome,
    config: { path: cfgPath, exists: cfgExists, error: cfgError, matched: Boolean(project) },
    code: codePath
      ? {
          path: codePath,
          why: specRepo
            ? 'the git repository the spec sits in'
            : "the working directory's repository — the spec sits outside any repository",
        }
      : { path: null, why: 'no git repository — runs will carry no git_sha' },
    spec,
    runs,
    threads,
    evidence,
    drafts,
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
    projects.add(
      doc.createNode({
        id: loc.id,
        roots: [loc.code?.path ?? dirname(loc.spec.path)],
        spec: loc.spec.path,
      }),
    );
    entry = projects.items.at(-1);
  }
  entry.set(kind, to);
  writeFileSync(path, String(doc));
  return path;
}
