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
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse, parseDocument } from '../vendor/yaml.js';

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

const REPO_CONFIG_HEADER = `# This project's blueprints, committed.
#
# The shared half: which blueprints exist and where they sit relative to this
# repository, so a clone is a working project with nothing else to run. The
# personal half lives at ~/.walkdown/config.yml and wins wherever the two
# speak about the same thing. Identity is only ever read from there.
`;

/**
 * Write (or update) a project entry, so the thing just created is a project.
 *
 * Walkdown no longer finds blueprints by looking, which means `init` creating
 * one and saying nothing would leave a directory that is a blueprint by shape
 * and nothing by declaration - present on disk, absent from every command
 * (n-0133). The entry IS the adoption step, and writing it here is why there
 * is no adopt verb to remember.
 *
 * Into the repository's config when the spec lives in the repository, since
 * then it is a fact about the project that should travel with the clone; into
 * the person's own when it does not, since then it is a fact about this disk.
 * Existing keys are left exactly as found: somebody may have edited them, and
 * an entry is theirs once written.
 */
/*
 * Write down who is sitting here, once, if nobody has.
 *
 * Records are written under the config's identity and nothing else can name a
 * person any more, which makes an absent `identity:` block a wall rather than
 * a default: accepting work is refused on a machine that only has a git email
 * to go on. The block is therefore part of being set up, and setup is what
 * `init` is - a human ran it, and building the config around the human who
 * ran it is the point.
 *
 * Created, never corrected. An existing block is left exactly as found even
 * where git disagrees with it: it is a person's own statement about their
 * name, and the one thing an agent may not quietly change.
 *
 * The personal config only. A committed file naming a person would be wrong
 * on every machine but one.
 *
 * The guess is passed IN rather than read here, because the module that knows
 * how to make one reads the config through this one - asking it directly
 * would be a cycle.
 */
export function rememberIdentity({ username, name }) {
  const target = configPath();
  const doc = existsSync(target)
    ? parseDocument(readFileSync(target, 'utf8'))
    : parseDocument('');
  if (doc.get('identity')) return { path: target, action: 'kept' };
  const handle = username?.trim();
  if (!handle) return { path: target, action: 'unknown' };
  mkdirSync(dirname(target), { recursive: true });
  doc.set(
    'identity',
    doc.createNode({ username: handle, ...(name?.trim() ? { name: name.trim() } : {}) }),
  );
  writeFileSync(target, String(doc));
  return { path: target, action: 'written', username: handle };
}

/*
 * A NUMBERED HOME, ALLOCATED AGAINST ONE DIRECTORY'S OWN LISTING.
 *
 * `.walkdown/blueprints/0002-name/`. The number is what makes two blueprints
 * distinct; the name is only there so a person reading `ls` knows which is
 * which.
 *
 * Numbering is what the deleted registry did, and deleting the registry was
 * right - it was a second list to keep in step with the config by hand. What
 * should not have survived it was the DERIVATION that replaced it:
 * `blueprints/<id>`, where the id fell back to a blueprint's own `project:`
 * field or a directory's basename. Both are names, names collide, and so the
 * collision the numbering existed to prevent outlived the numbering
 * (n-0124, n-0129, n-0141, n-0145, n-0150, n-0153 - one per judging pass).
 *
 * This numbering works where the registry's could not, for a reason worth
 * stating: it allocates against the directory's own listing, and the listing
 * IS the record. There is nothing to keep in step, because the thing being
 * allocated and the thing recording it are the same directory. That also
 * fixes what defeated the previous two attempts - allocation only works when
 * every claimant can see the others' claims, and two committed configs in two
 * repositories cannot see each other, while a hand-written one never passes
 * through an allocator at all.
 *
 * Only a command that is already writing calls this. Asking where things live
 * still allocates nothing, because asking never comes through here.
 *
 * @param {{ name: string, walkdown: string }} ask
 * @returns {{ home: string, dir: string }}
 */
export function claimHome({ name, walkdown }) {
  const homes = join(walkdown, 'blueprints');
  mkdirSync(homes, { recursive: true });
  let max = 0;
  for (const d of readdirSync(homes)) {
    const m = d.match(/^(\d{4})-/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const home = `${String(max + 1).padStart(4, '0')}-${slug(name) || 'project'}`;
  const dir = join(homes, home);
  // Taking the number means taking the directory: the listing is the record,
  // so a claim that did not appear in it would not be a claim.
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}

export function rememberProject({ id, root, spec, inRepo = false, home = null }) {
  const target = inRepo ? join(root, '.walkdown', 'config.yml') : configPath();
  mkdirSync(dirname(target), { recursive: true });
  const doc = existsSync(target)
    ? parseDocument(readFileSync(target, 'utf8'))
    : parseDocument(inRepo ? REPO_CONFIG_HEADER : '');
  if (!doc.get('projects')) doc.set('projects', doc.createNode([]));
  const projects = doc.get('projects');
  /*
   * Listed already? Asked of the SPEC, not the id. The config merges entries
   * by id, so two entries sharing one are one entry - and the default id is
   * the repository's basename, which thirty monorepo packs called `app` all
   * have. Keyed by id this returned `kept` for a blueprint that had never been
   * written down, handing it the FIRST `app`'s spec and ledger.
   */
  const item = (it, k) => String(it.get?.(k) ?? '');
  const listed = (projects.items ?? []).find(
    (it) => item(it, 'spec') && expand(item(it, 'spec'), root) === expand(spec),
  );
  if (listed) return { path: target, action: 'kept', id: item(listed, 'id') || id };
  /*
   * A free id WITHIN THIS FILE. Homes no longer collide - they are numbered
   * against one directory - but two entries sharing an id in one config are
   * still one entry, because the reader merges by id. Two repositories both
   * called `app` listed in one personal config would otherwise become a single
   * project holding the second's spec and the first's records, which is
   * n-0124's collision arriving through the last door left open to it.
   *
   * Only within this file: two repositories that each declare `app` in their
   * OWN `.walkdown` are two different projects and may share the name freely,
   * since nothing they own is keyed by it.
   */
  const taken = new Set((projects.items ?? []).map((it) => item(it, 'id')).filter(Boolean));
  if (taken.has(id)) {
    const wanted = id;
    for (let n = 2; taken.has(id); n++) id = `${wanted}-${n}`;
  }
  // Relative to the repository in a committed file: it is read on machines
  // whose layouts have nothing in common.
  const rel = (p) => (inRepo ? (p === root ? '.' : relative(root, p)) : p);
  /*
   * `home` is the NAME of the numbered directory - `0002-thing` - not a path.
   *
   * It is read relative to whichever `.walkdown` the entry is written into,
   * which is what lets a committed config say where things are without
   * knowing anybody's disk layout. Evidence and drafts are then this entry's
   * alone by construction: no two entries in one `.walkdown/blueprints/` hold
   * the same number, and two different `.walkdown` directories are two
   * different projects' records (n-0155).
   *
   * The claim is made by the caller, before it builds into it. Choosing again
   * here is what split a project's records between two directories once: by
   * the time this ran, `init` had already scaffolded into the home it was
   * told about, and a second opinion moved on to the next name (n-0141).
   */
  projects.add(
    doc.createNode({
      id,
      roots: [rel(root)],
      spec: rel(spec),
      runs: rel(join(spec, 'runs')),
      threads: rel(join(spec, 'threads')),
      ...(home ? { home } : {}),
    }),
  );
  writeFileSync(target, String(doc));
  return { path: target, action: 'written', id };
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
function readConfigFile(path) {
  if (!existsSync(path)) return { exists: false, config: {}, error: null };
  try {
    return { exists: true, config: parse(readFileSync(path, 'utf8')) ?? {}, error: null };
  } catch (e) {
    return { exists: true, config: {}, error: e.message };
  }
}

/**
 * The repository config: `<repo>/.walkdown/config.yml`, found by walking up
 * from `cwd`. Null when there is none, which is most projects.
 *
 * This is the only thing walkdown looks for in a tree, and it is a different
 * act from the blueprint search it replaces: one filename in one known place,
 * and what it finds is a DECLARATION rather than a guess about which of
 * several blueprints somebody meant.
 */
export function walkdownRoot(start = process.cwd()) {
  /*
   * THE NEAREST ONE, AND THEN STOP (locations.answer.one-walkdown-answers).
   *
   * The walk used to continue to the git root, so a pack inside a monorepo
   * inherited the repository's declarations. A monorepo is several projects
   * that happen to share a checkout: pooling them lets one pack's board list,
   * serve and write to another pack's ledger, and the panel's blueprint
   * chooser offers it as a click. So the first `.walkdown` at or above you
   * answers and nothing above it is consulted.
   *
   * The DIRECTORY is the boundary, not the config file inside it. A
   * `.walkdown` holding blueprints but no config.yml still answers - walking
   * past it to a grandparent's config would attach this project's records to
   * somebody else's list.
   *
   * Two guards remain, both learned the hard way in the same minute. The walk
   * stops at the repository it started in, so a checkout cannot inherit from
   * whatever directory happens to contain it. And the personal home is never
   * mistaken for a project's: `$HOME` is an ancestor of nearly every checkout,
   * so an unbounded walk finds `~/.walkdown` and reads the person's own file
   * a second time as though a project had shipped it.
   */
  const personal = resolve(walkdownHome());
  let dir = resolve(start);
  for (let i = 0; i < 24; i++) {
    const mine = join(dir, '.walkdown');
    if (resolve(mine) !== personal && existsSync(mine)) return mine;
    if (existsSync(join(dir, '.git'))) return null; // the top of this repository
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** The config inside that `.walkdown`, when it has one. */
export function repoConfigPath(start = process.cwd()) {
  const root = walkdownRoot(start);
  const at = root && join(root, 'config.yml');
  return at && existsSync(at) ? at : null;
}

/*
 * Relative paths in a REPO config hang off the repository, never the working
 * directory. That file is committed and read on everybody's machine, so
 * `spec: blueprint/` has to mean the same thing from every directory anyone
 * ever runs a command in - the same mistake as issue #7 and `{results}`,
 * wearing a third costume.
 */
function anchorEntry(entry, base) {
  const fix = (v) =>
    typeof v === 'string' && v.trim() && !isAbsolute(expand(v, base)) ? join(base, v) : v;
  const out = { ...entry };
  for (const k of ['spec', ...KINDS]) if (out[k] != null) out[k] = expand(out[k], base);
  if (out.roots != null) out.roots = [out.roots].flat().map((r) => expand(r, base)).map(fix);
  return out;
}

/*
 * WHICH FILE SAID SO, key by key.
 *
 * The merge below flattens two files into one entry, and everything
 * downstream then reports what it found without being able to say where it
 * came from. `walkdown where` printed both files as separate rows - the whole
 * point of the command - and then credited the personal one for paths the
 * repository's committed config had supplied, because the only flag it had to
 * read was computed over the merged result (n-0144).
 *
 * So provenance travels WITH the entry, on a symbol: invisible to JSON, to
 * YAML, and to every `{...entry}` spread that would otherwise carry a stray
 * bookkeeping key into somebody's config file. Per key rather than per entry,
 * because the merge is per key - a repository declaring `spec:` and a person
 * overriding `evidence:` is the ordinary case, and one flag for the pair of
 * them could only ever be right about one of the rows.
 */
export const DECLARED_IN = Symbol('walkdown.declaredIn');

const marks = (keys, from, onto = {}) => {
  const where = { ...onto };
  for (const k of keys) where[k] = from;
  return where;
};
const withMarks = (entry, where) =>
  Object.defineProperty({ ...entry }, DECLARED_IN, { value: where, enumerable: false });
const stamp = (entry, from) => withMarks(entry, marks(Object.keys(entry), from));

/** Which file supplied one key of an entry: 'personal', 'repo', or null. */
export const declaredIn = (entry, key) => entry?.[DECLARED_IN]?.[key] ?? null;

/** Which files declare this entry at all - 'personal', 'repo', 'both', null. */
export function declaringFiles(entry) {
  const from = new Set(Object.values(entry?.[DECLARED_IN] ?? {}));
  if (from.has('personal') && from.has('repo')) return 'both';
  if (from.has('repo')) return 'repo';
  if (from.has('personal')) return 'personal';
  return null;
}

/**
 * The config, as the merge of the repository's and the person's.
 *
 * The repository half says which blueprints this project HAS - committed,
 * reviewed, the same for everyone who clones it. The personal half says where
 * they are on THIS disk and who is sitting here, and it wins wherever the two
 * speak about the same thing. Entries merge by id rather than replacing, so
 * overriding an evidence path does not cost you the spec path the repo
 * declared (n-0140).
 *
 * A team that wants no shared spec simply has no repository config, and
 * everyone works from their own. That is an arrangement they choose.
 */
export function readUserConfig({ cwd = process.cwd() } = {}) {
  const path = configPath();
  const personal = readConfigFile(path);
  const repoPath = repoConfigPath(cwd);
  if (!repoPath)
    return {
      path,
      exists: personal.exists,
      // Stamped even with nothing to merge against: a caller asking which file
      // said so must get 'personal', never a shrug that reads the same as an
      // unmerged entry from some other code path.
      config: {
        ...personal.config,
        ...(personal.config.projects
          ? { projects: personal.config.projects.map((p) => stamp(p ?? {}, 'personal')) }
          : {}),
      },
      error: personal.error,
      repo: null,
    };

  const repo = readConfigFile(repoPath);
  const base = dirname(dirname(repoPath));
  /*
   * Identity is never taken from the repository. A committed file naming who
   * you are would be wrong on every machine but one, and identity is a thing
   * you read rather than something a file you did not write can supply.
   */
  const { identity: _ignored, ...shared } = repo.config;
  const byId = new Map(
    (shared.projects ?? [])
      .map((p) => [p?.id, stamp(anchorEntry(p, base), 'repo')])
      .filter(([id]) => id),
  );
  for (const p of personal.config.projects ?? []) {
    if (!p?.id) continue;
    /*
     * Only the keys the PERSON wrote change hands. Re-stamping the whole
     * merged entry would credit the personal file for every key the
     * repository supplied - which is the bug, one layer down.
     */
    const prev = byId.get(p.id);
    byId.set(
      p.id,
      withMarks({ ...(prev ?? {}), ...p }, marks(Object.keys(p), 'personal', prev?.[DECLARED_IN])),
    );
  }
  const merged = {
    ...shared,
    ...personal.config,
    defaults: { ...(shared.defaults ?? {}), ...(personal.config.defaults ?? {}) },
    projects: [...byId.values()],
  };
  if (!Object.keys(merged.defaults).length) delete merged.defaults;
  /*
   * Every field in this cell describes the file `path` names - the personal
   * one - and the repository's config answers for itself under `repo`. Two
   * files, two answers, no field computed across both.
   *
   * `error` was the last exception, and it cost exactly what the others did:
   * `personal.error ?? repo.error` put a REPOSITORY parse failure on the
   * personal file's row, so a reader was sent hunting a syntax error in
   * ~/.walkdown/config.yml that was not there, on a file that parsed cleanly
   * and had answered (n-0146, one field over from n-0144). A caller asking
   * whether anything is broken asks both, which is one `||` at the asking and
   * cannot be wrong about which file it means.
   */
  return {
    path,
    exists: personal.exists,
    config: merged,
    error: personal.error,
    repo: { path: repoPath, exists: repo.exists, error: repo.error },
  };
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
/*
 * The reason a path was chosen, naming the file that chose it.
 *
 * "this machine's config" is the phrase docs/08-locations.md reserves for the
 * personal file, and a repository's committed config is a different author
 * making a different kind of decision - shared, reviewed, true on everybody's
 * disk. Reporting the second under the first's name is not a wording nicety:
 * it tells a reader to go edit a file that has nothing to say about the path
 * they are looking at (n-0144).
 */
const configWhy = (project, key, tail = '') =>
  `${declaredIn(project, key) === 'repo' ? "this repository's config" : "this machine's config"} (${project?.id ?? 'project'})${tail}`;

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
 * @param {{ cwd?: string, project?: string | null, spec?: string | null,
 *   overrides?: Record<string, string> }} [where]
 * @returns {{ id: string, home: string,
 *   config: { path: string, exists: boolean, error: string | null, matched: boolean,
 *     matchedIn: 'personal' | 'repo' | 'both' | null,
 *     repo: { path: string, exists: boolean, error: string | null, matched: boolean } | null },
 *   code: { path: string | null, why: string }, codeRoot: string | null,
 *   spec: Location, runs: Location, threads: Location,
 *   evidence: Location, drafts: Location }}
 */
export function resolveLocations({
  cwd = process.cwd(),
  project: want = null,
  spec: at = null,
  overrides = {},
} = {}) {
  /*
   * A repository config is looked for from where the caller is - or from
   * beside the blueprint when one was named outright, since `--dir` may point
   * at a project the caller is not standing in.
   */
  const from = cwd;
  const {
    path: cfgPath,
    exists: cfgExists,
    config,
    error: cfgError,
    repo: cfgRepo,
  } = readUserConfig({ cwd: from });
  // The `.walkdown` that answers for where we are standing - the nearest one,
  // and never a second (locations.answer.one-walkdown-answers). Homes declared
  // by its config are read against it.
  const wdRoot = walkdownRoot(from);
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
  /*
   * Which project. By id when one was asked for, otherwise the entry whose
   * roots claim the directory you are standing in.
   *
   * There used to be a `--dir <blueprint>` that named a path outright, and it
   * was the second way to reach a blueprint - so a blueprint could be answered
   * for without being declared, which meant it had no entry, which meant its
   * home had to be derived from a NAME. That derivation is the ancestor of
   * every collision this module has had. One way in now: everything walkdown
   * answers for is written down, and `walkdown project add` is how something
   * gets written down that `init` did not create (n-0156).
   */
  const matched = want
    ? (() => {
        const p = (config.projects ?? []).find((x) => x?.id === want);
        return p ? { project: p, root: null } : null;
      })()
    : at
      ? (() => {
          /*
           * From a spec path, for the readers and writers INSIDE walkdown that
           * already hold a loaded blueprint and need its records. Not a second
           * way in for a person - it answers only for a blueprint that is
           * declared, and a path nothing declares resolves to nothing here
           * exactly as it does anywhere else.
           */
          const want_ = expand(at, cwd);
          const p = (config.projects ?? []).find((x) => x?.spec && expand(x.spec) === want_);
          return p ? { project: p, root: null } : null;
        })()
      : projectFor(cwd, config);
  const project = matched?.project ?? null;

  // ---- the spec ------------------------------------------------------------
  /*
   * Two answers, and no search.
   *
   * Walkdown used to walk UP from the working directory looking for any
   * `walkdown.yml`, and then had to arbitrate between what it found and what
   * the config said - a contest with its own rule, its own exception for
   * monorepo siblings, and a silent disagreement where `where` reported one
   * project and `lint` read another. Every blueprint is written down now, so
   * there is nothing to find and nothing to arbitrate (n-0133, q-0138).
   *
   * What remains: a blueprint named outright on the command line, or the
   * entry that claims the directory you are standing in.
   */
  let spec;
  if (project?.spec) spec = { path: expand(project.spec), why: configWhy(project, 'spec') };

  const code = gitRoot(spec?.path ?? cwd) ?? gitRoot(cwd);
  const id = project?.id
    ? slug(project.id)
    : ((spec && declaredProject(spec.path)) ?? slug(basename(code ?? cwd)));

  const home = walkdownHome();
  /*
   * THE OUT-OF-TREE HOME, AND THE ONE KEY IT MAY BE DERIVED FROM.
   *
   * There used to be a registry here - a second file handing out numbered
   * directories, consulted on every resolve and kept in step with the config
   * by hand. It existed because walkdown could not assume a project had been
   * written down, and because a PERSON maintained the config and should not
   * have to do allocation bookkeeping. Neither premise survives: every
   * blueprint is declared and `init` writes the declaration, so the entry
   * carries its own home. Deleting the registry was right.
   *
   * What was kept, and should not have been, was deriving a home for a
   * blueprint that has no entry - `join(home, 'blueprints', slug(id))`, where
   * `id` fell back to the blueprint's own `project:` field or the repository's
   * basename. Both of those are names, and names collide: that is the whole
   * reason the registry allocated numbers. So the collision the registry
   * existed to prevent outlived the registry, on the READ path, where no
   * guard on `init` could ever reach it (n-0150). Two blueprints resolved to
   * one drafts directory and a sitting could be overwritten by an unrelated
   * project; standing in an unlisted repository answered with a listed
   * project's spec, ledger and threads, and a note filed there landed in
   * somebody else's conversation.
   *
   * The rule now: a home may only be keyed by an id the CONFIG ALLOCATED.
   * `claimHome` hands those out and makes them unique; a blueprint's own
   * `project:` field and a directory's basename are not unique and never
   * were. A blueprint nobody listed therefore gets NO home - which is not a
   * gap but the honest answer, and the one q-0138 already implied when it
   * made the config the only list. Answering still writes nothing: there is
   * simply nothing to answer with.
   *
   * The legacy name-keyed directory still answers where it exists, because an
   * existing ledger is a fact and only a person moves one - and it is reached
   * only through an allocated id now, so it inherits the same uniqueness.
   */
  /*
   * The blueprint's home is the numbered directory its entry names, read
   * against the `.walkdown` that declared it - the project's own when the
   * committed config said so, the personal one otherwise. Which file declared
   * a key is already recorded per key (n-0144), so this is a lookup rather
   * than a guess.
   *
   * No entry, or an entry that names no home, means NO home. Nothing is
   * derived from a name: that derivation is what let two blueprints share a
   * directory through six separate routes, and there is no cleverer name to
   * derive - only a number allocated where every claimant can see it.
   */
  const homeFor = (() => {
    if (!project?.home) return null;
    const root = declaredIn(project, 'home') === 'repo' ? wdRoot : home;
    if (!root) return null;
    return {
      dir: join(root, 'blueprints', String(project.home)),
      why:
        declaredIn(project, 'home') === 'repo'
          ? `this project's \`.walkdown\`, beside the code and outside git`
          : "this machine's `~/.walkdown`",
    };
  })();
  const builtIn = (kind) => homeFor && join(homeFor.dir, kind);

  /*
   * A `defaults:` value is a path the person WROTE DOWN, so it is not
   * discovery and stays available to a blueprint with no entry - that is what
   * `locations.keeping.moving-is-a-decision` rests on. Only its `{id}` is
   * unsafe: with no entry the sole id available is a basename or a
   * blueprint's own `project:` field, which is the non-unique key this whole
   * change exists to keep out of a path. So `{id}` is substitutable exactly
   * when the config allocated an id to substitute, and a default that needs
   * one without it simply does not answer.
   */
  const fromDefault = (v) => {
    const raw = String(v);
    if (!raw.includes('{id}')) return expand(raw);
    return project?.id ? expand(raw.replace('{id}', slug(project.id))) : null;
  };

  if (!spec) {
    /*
     * No entry and nothing named on the command line. There is nothing to
     * report and nothing to invent: this directory is not a project.
     *
     * `defaults.spec` is deliberately not consulted here either. It reads
     * `{id}`, and with no entry the only id available is a basename - the
     * same non-unique key, wearing a preference as a costume.
     */
    if (at)
      spec = { path: expand(at, cwd), why: 'the blueprint this reader already holds' };
    else if (!homeFor)
      spec = {
        path: null,
        why: want
          ? `no project \`${want}\` — \`walkdown projects\` lists them`
          : 'nothing declares this directory — `walkdown init` starts a project, or `walkdown project add` lists an existing one',
      };
    else {
      const fromDefaults = defaults.spec && fromDefault(defaults.spec);
      spec = fromDefaults
        ? { path: fromDefaults, why: 'the config default, outside the repository' }
        : { path: builtIn('blueprint'), why: homeFor.why };
      spec.missing = !existsSync(spec.path);
    }
  }

  // ---- the records ---------------------------------------------------------
  const out = {};
  for (const kind of KINDS) {
    if (overrides[kind]) {
      out[kind] = { path: expand(overrides[kind], cwd), why: 'named on the command line' };
      continue;
    }
    if (project?.[kind]) {
      out[kind] = { path: expand(project[kind]), why: configWhy(project, kind) };
      continue;
    }
    if (!spec.path) {
      // Not a project: no spec, so no records either. Every answer below is
      // relative to a blueprint, and there is not one. Saying so is the
      // answer; naming a path would be inventing one.
      out[kind] = { path: null, why: 'nothing declares this directory' };
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
      const at = fromDefault(defaults[kind]);
      if (at) {
        out[kind] = { path: at, why: 'the config default' };
        continue;
      }
    }
    if (FOLLOWS_SPEC.has(kind)) {
      out[kind] = { path: join(spec.path, kind), why: 'beside the spec, as runs and threads follow it' };
      continue;
    }
    /*
     * Evidence and drafts normally live OUT of the tree - they are big and
     * neither is a claim, so neither belongs in a diff. That needs a home,
     * and a blueprint reached by `--dir` with no entry has none. Beside the
     * spec is then the only answer that is certainly this blueprint's own:
     * the path was named outright, so it cannot collide with anybody else's
     * the way a name-keyed home could (n-0150).
     */
    out[kind] = homeFor
      ? { path: builtIn(kind), why: homeFor.why }
      : {
          path: join(spec.path, kind),
          why: 'beside the blueprint you named, which nothing has claimed a home for',
        };
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
  const entryRoot = project?.roots ? [project.roots].flat().map((r) => expand(r))[0] : null;
  const codePath = entryRoot ?? specRepo ?? code;
  /*
   * Where the CODE is, for anything that runs a command or resolves a path
   * into the codebase - a different question from `code` above, which answers
   * the looser "which repository is in play" for the report and for git_sha.
   *
   * Two answers, in this order, and deliberately no third.
   *
   * The entry's `roots` leads: it is the one answer somebody wrote down, it
   * says which tree this project's code is, and it is true from any directory
   * rather than only from inside one. It is also the ONLY thing that can
   * answer for a spec kept outside the code, which is the shape `init` now
   * produces by default and the shape issue #7 was filed from.
   *
   * Otherwise the spec's own parent, by the convention every in-tree project
   * follows: <project>/blueprint/walkdown.yml, so <project> is the code.
   *
   * Neither the repository the spec sits in nor the one you are standing in
   * belongs here, though both are fine answers for `code`. A repository is
   * too coarse - walkdown's own example/ is a project inside this one, and
   * resolving its checks against the outer repository looked for its suite in
   * the wrong tree. And the working directory is not an answer at all, merely
   * a place: handing it to spawnSync would run a project's tests inside
   * whatever checkout the caller happened to be in.
   */
  const codeRootPath = entryRoot ?? (spec?.path ? dirname(spec.path) : null);
  const declaredBy = project ? declaringFiles(project) : null;
  return {
    id,
    home,
    /*
     * `matched` is the merged answer - is this a project at all - and it is
     * deliberately kept, because that is the question most callers ask. What
     * it cannot answer is WHICH file said so, and a report printing both
     * files as separate rows needs exactly that, per file (n-0144).
     */
    config: {
      path: cfgPath,
      exists: cfgExists,
      error: cfgError,
      matched: Boolean(project),
      matchedIn: declaredBy,
      repo: cfgRepo && { ...cfgRepo, matched: declaredBy === 'repo' || declaredBy === 'both' },
    },
    code: codePath
      ? {
          path: codePath,
          why: entryRoot
            ? configWhy(project, 'roots', ', which says where the code is')
            : specRepo
              ? 'the git repository the spec sits in'
              : "the working directory's repository — the spec sits outside any repository",
        }
      : { path: null, why: 'no git repository — runs will carry no git_sha' },
    codeRoot: codeRootPath,
    spec,
    runs,
    threads,
    evidence,
    drafts,
  };
}

/*
 * Fold the homes an older layout left behind into the config, and move
 * nothing.
 *
 * This was `walkdown migrate`, and before that it RENAMED directories: homes
 * were keyed by project name, names collided across monorepo packs, and
 * migrating meant renumbering each one and re-pointing the config at its new
 * address (n-0124). That is the one act one-home-per-blueprint says a tool may
 * not perform on its own.
 *
 * There is no registry to renumber into any more. The config entry carries its
 * own home, so the whole job is to write down where each existing home already
 * is - the old index's `blueprints:` entries, and the older name-keyed
 * `projects/<id>` directories beside them. An existing ledger is a fact, and
 * the safest migration is the one that only writes a sentence about it.
 *
 * It decides and it writes; it prints nothing. `walkdown where --fix` turns
 * the plan below into a report, which is the only thing an interface should
 * have been doing with it all along.
 *
 * @returns {{ home: string, index: string | null,
 *   found: Array<{ path: string, act: 'recorded' | 'already' | 'left', why: string }>,
 *   written: number }}
 */
export function foldLegacyHomes() {
  const home = walkdownHome();
  const indexPath = join(home, 'blueprints', 'index.yml');
  const legacyRoot = join(home, 'projects');
  const index = existsSync(indexPath) ? indexPath : null;

  /** Every home this machine holds, however it came to hold it. */
  const homes = [];
  if (index) {
    let entries;
    try {
      entries = parse(readFileSync(index, 'utf8'))?.blueprints ?? [];
    } catch (e) {
      throw new Error(`Could not read ${index} — fix or remove it, then run this again.`, {
        cause: e,
      });
    }
    for (const e of entries)
      if (e?.name) homes.push({ path: join(home, 'blueprints', e.name), spec: e.spec ?? null });
  }
  if (existsSync(legacyRoot))
    for (const id of readdirSync(legacyRoot).filter((d) => !d.startsWith('.')))
      homes.push({ path: join(legacyRoot, id), spec: null, id });

  const found = [];
  if (!homes.length) return { home, index, found, written: 0 };

  const { config } = readUserConfig();
  const doc = existsSync(configPath())
    ? parseDocument(readFileSync(configPath(), 'utf8'))
    : parseDocument('');
  if (!doc.get('projects')) doc.set('projects', doc.createNode([]));
  const projects = doc.get('projects');
  /*
   * One home per entry, even here. Two old layouts could each hold records for
   * the same project - a home the index recorded by spec, and an older
   * name-keyed one beside it - and writing both into one entry left that
   * blueprint with its evidence in one directory and its drafts in another,
   * which is the split this rule exists to prevent (n-0141). The first is
   * written down; the second is reported for a person to settle, because which
   * of two ledgers is the real one is not a guess a tool should make.
   */
  const spokenFor = new Set();
  let written = 0;

  for (const h of homes) {
    /*
     * Which entry does this home belong to? Its spec, when the index recorded
     * one; otherwise the entry whose id matches the directory's name, which is
     * exactly what the name-keyed layout meant. A home nothing claims is
     * reported and left alone - guessing is the mistake this replaces.
     */
    const entry = (config.projects ?? []).find((p) =>
      h.spec ? p?.spec && expand(p.spec) === expand(h.spec) : p?.id === h.id,
    );
    if (!entry) {
      found.push({
        path: h.path,
        act: 'left',
        why: 'no config entry claims it — add one, or delete the directory',
      });
      continue;
    }
    if (spokenFor.has(entry.id)) {
      found.push({
        path: h.path,
        act: 'left',
        why: `\`${entry.id}\` already has a home recorded — say which is the real one`,
      });
      continue;
    }
    const item = (projects.items ?? []).find((it) => String(it.get?.('id') ?? '') === entry.id);
    if (!item) continue;
    let touched = false;
    for (const kind of ['evidence', 'drafts']) {
      const at = join(h.path, kind);
      if (item.get(kind) || !existsSync(at)) continue;
      item.set(kind, at);
      touched = true;
    }
    spokenFor.add(entry.id);
    if (!touched) {
      found.push({ path: h.path, act: 'already', why: 'already named by the config' });
      continue;
    }
    written++;
    found.push({
      path: h.path,
      act: 'recorded',
      why: `now named by entry \`${entry.id}\` — nothing moved`,
    });
  }

  if (written) writeFileSync(configPath(), String(doc));
  return { home, index, found, written };
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
