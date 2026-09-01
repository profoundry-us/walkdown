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

export function rememberProject({ id, root, spec, inRepo = false }) {
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
  // A different blueprint holding this name gets the name; this one takes the
  // next one free, here and in the other config both.
  const names = new Set([
    ...(projects.items ?? []).map((it) => item(it, 'id')),
    ...(readUserConfig({ cwd: root }).config.projects ?? []).map((p) => p?.id).filter(Boolean),
  ]);
  const wanted = id;
  for (let n = 2; names.has(id); n++) id = `${wanted}-${n}`;
  // Relative to the repository in a committed file: it is read on machines
  // whose layouts have nothing in common.
  const rel = (p) => (inRepo ? (p === root ? '.' : relative(root, p)) : p);
  /*
   * The home this project's out-of-tree records live in, chosen ONCE and
   * written into the entry. There used to be a second file for this - a
   * registry that handed out numbered directories - on the premise that a
   * project might not be written down and that a person was maintaining the
   * config by hand. Both are gone: every blueprint is declared, and an agent
   * writes the declaration, so the entry can simply carry its own home
   * (n-0133). Evidence and drafts stay out of the tree even for an in-repo
   * spec, so these are absolute in both shapes.
   *
   * Uniqueness is settled here rather than by an allocator: the name is the
   * id, and a suffix is added while anything already listed has claimed it.
   */
  const taken = new Set(
    (projects.items ?? []).flatMap((it) =>
      ['evidence', 'drafts'].map((k) => String(it.get?.(k) ?? '')).filter(Boolean),
    ),
  );
  const homes = join(walkdownHome(), 'blueprints');
  let name = slug(id);
  for (let n = 2; existsSync(join(homes, name)) || taken.has(join(homes, name, 'evidence')); n++)
    name = `${slug(id)}-${n}`;
  const home = join(homes, name);
  projects.add(
    doc.createNode({
      id,
      roots: [rel(root)],
      spec: rel(spec),
      runs: rel(join(spec, 'runs')),
      threads: rel(join(spec, 'threads')),
      evidence: join(home, 'evidence'),
      drafts: join(home, 'drafts'),
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
export function repoConfigPath(start = process.cwd()) {
  /*
   * Two guards, both learned the hard way in the same minute.
   *
   * The walk stops at the repository it started in: a repo config belongs to
   * a repository, and continuing past the top would let a checkout inherit a
   * declaration from whatever directory happens to contain it.
   *
   * And the personal config is never mistaken for a repository one. The
   * walkdown home is `~/.walkdown`, and `$HOME` is an ancestor of nearly
   * every checkout - so an unbounded walk finds `~/.walkdown/config.yml` and
   * reads the person's own file twice, once as though a project had shipped
   * it.
   */
  const home = resolve(walkdownHome());
  let dir = resolve(start);
  for (let i = 0; i < 24; i++) {
    const mine = join(dir, '.walkdown');
    if (resolve(mine) !== home && existsSync(join(mine, 'config.yml')))
      return join(mine, 'config.yml');
    if (existsSync(join(dir, '.git'))) return null; // the top of this repository
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
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
    return { path, exists: personal.exists, config: personal.config, error: personal.error, repo: null };

  const repo = readConfigFile(repoPath);
  const base = dirname(dirname(repoPath));
  /*
   * Identity is never taken from the repository. A committed file naming who
   * you are would be wrong on every machine but one, and identity is a thing
   * you read rather than something a file you did not write can supply.
   */
  const { identity: _ignored, ...shared } = repo.config;
  const byId = new Map(
    (shared.projects ?? []).map((p) => [p?.id, anchorEntry(p, base)]).filter(([id]) => id),
  );
  for (const p of personal.config.projects ?? []) {
    if (!p?.id) continue;
    byId.set(p.id, { ...(byId.get(p.id) ?? {}), ...p });
  }
  const merged = {
    ...shared,
    ...personal.config,
    defaults: { ...(shared.defaults ?? {}), ...(personal.config.defaults ?? {}) },
    projects: [...byId.values()],
  };
  if (!Object.keys(merged.defaults).length) delete merged.defaults;
  return {
    path,
    // Describes the file `path` names - the personal one. The repository's
    // config answers for itself under `repo`, because a caller asking "does
    // this person have a config yet" must not be told yes by somebody else's
    // committed file.
    exists: personal.exists,
    config: merged,
    error: personal.error ?? repo.error,
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
 *   config: { path: string, exists: boolean, error: string | null, matched: boolean,
 *     repo: { path: string, exists: boolean, error: string | null } | null },
 *   code: { path: string | null, why: string }, codeRoot: string | null,
 *   spec: Location, runs: Location, threads: Location,
 *   evidence: Location, drafts: Location }}
 */
export function resolveLocations({ cwd = process.cwd(), dir = null, overrides = {} } = {}) {
  /*
   * A repository config is looked for from where the caller is - or from
   * beside the blueprint when one was named outright, since `--dir` may point
   * at a project the caller is not standing in.
   */
  const {
    path: cfgPath,
    exists: cfgExists,
    config,
    error: cfgError,
    repo: cfgRepo,
  } = readUserConfig({ cwd: dir ? expand(dir, cwd) : cwd });
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
  if (dir) spec = { path: expand(dir, cwd), why: 'named on the command line' };
  else if (project?.spec)
    spec = {
      path: expand(project.spec),
      why: `this machine's config (${project.id ?? 'project'})`,
    };

  const code = gitRoot(spec?.path ?? cwd) ?? gitRoot(cwd);
  const id = project?.id
    ? slug(project.id)
    : ((spec && declaredProject(spec.path)) ?? slug(basename(code ?? cwd)));

  const home = walkdownHome();
  /*
   * The out-of-tree home, when the entry did not name one.
   *
   * There used to be a registry here - a second file handing out numbered
   * directories, consulted on every resolve, kept in sync with the config by
   * hand and by `walkdown migrate`. It existed because walkdown could not
   * assume a project had been written down, and because a PERSON maintained
   * the config and should not have to do allocation bookkeeping. Neither
   * premise survives: every blueprint is declared, and `init` writes the
   * declaration, so the entry carries its own home and this is only the
   * answer for a blueprint reached some other way - `--dir` at a directory
   * nobody has listed.
   *
   * Derived, never allocated: answering must not write, and there is nothing
   * left to write to. The legacy name-keyed directory still answers where it
   * exists, because an existing ledger is a fact and only a person moves one.
   */
  const legacyHome = join(home, 'projects', id);
  const legacy = existsSync(legacyHome);
  const homeDir = legacy ? legacyHome : join(home, 'blueprints', slug(id));
  const homeWhy = legacy
    ? 'the built-in default, outside the repository (legacy home — `walkdown migrate` folds it into the config)'
    : 'the built-in default, outside the repository';
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
  return {
    id,
    home,
    config: {
      path: cfgPath,
      exists: cfgExists,
      error: cfgError,
      matched: Boolean(project),
      repo: cfgRepo,
    },
    code: codePath
      ? {
          path: codePath,
          why: entryRoot
            ? `this machine's config (${project?.id ?? 'project'}), which says where the code is`
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
