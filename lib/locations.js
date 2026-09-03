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
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
  const seen = (d) => {
    const m = String(d).match(/^(\d{4})-/);
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const d of readdirSync(homes)) seen(d);
  /*
   * And every number the config beside it still names, whether or not the
   * directory is there. Abandoning a default project is deleting its home,
   * and re-minting that number for the next same-named repository handed
   * the abandoned entry a blueprint it never claimed - the old checkout
   * answered with the new spec and filed threads into it (n-0170). A stale
   * entry keeps its number; the listing shows it gone.
   */
  const cfg = readConfigFile(join(walkdown, 'config.yml'));
  const base = walkdown === walkdownHome() ? walkdown : dirname(walkdown);
  for (const p of cfg.config.projects ?? []) {
    if (p?.home) seen(p.home);
    const spec = p?.spec ? expand(String(p.spec), base) : null;
    if (spec && within(spec, homes)) seen(relative(homes, spec).split('/')[0]);
  }
  const home = `${String(max + 1).padStart(4, '0')}-${slug(name) || 'project'}`;
  const dir = join(homes, home);
  // Taking the number means taking the directory: the listing is the record,
  // so a claim that did not appear in it would not be a claim.
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}

/*
 * THE SHAPE OF A HOME. One layout, wherever the home sits:
 *
 *     blueprints/0001-name/
 *       blueprint/     the spec - walkdown.yml, storyboard.yml, features/
 *       threads/       the conversation about it
 *       runs/          what a machine or a sitting said about a build
 *       evidence/      the screenshots those runs point at
 *       drafts/        one person's half-finished sitting
 *
 * Five siblings, never nested. Runs and threads used to sit INSIDE the spec
 * directory (`blueprint/runs`), a habit inherited from the days when the spec
 * was the only directory a project had; the committed config then had to say
 * `.walkdown/blueprints/0001-app/blueprint/runs` while evidence sat one level
 * up, and a reader had two shapes to learn. Now a home is a directory that can
 * be moved between `~/.walkdown/blueprints/` and `<repo>/.walkdown/blueprints/`
 * as a unit, and a `.gitignore` beside it names the three siblings git does not
 * get.
 */
export const HOME_LAYOUT = Object.freeze({
  spec: 'blueprint',
  threads: 'threads',
  runs: 'runs',
  evidence: 'evidence',
  drafts: 'drafts',
});

/** Every path inside one home, by kind. */
export const homePaths = (dir) =>
  Object.fromEntries(Object.entries(HOME_LAYOUT).map(([k, rel]) => [k, join(dir, rel)]));

/* `/Users/me/...` written as `~/...` in a file a person reads and edits. */
const tilde = (p) => (p.startsWith(homedir() + '/') ? '~' + p.slice(homedir().length) : p);

/**
 * @param {{ id: string, root: string | null, spec?: string | null, homeDir?: string | null,
 *   inRepo?: boolean, home?: string | null, records?: Record<string, string>,
 *   extra?: Record<string, any>, base?: string | null }} entry
 */
export function rememberProject({
  id,
  root,
  spec = null,
  homeDir = null,
  inRepo = false,
  home = null,
  records = {},
  extra = {},
  base = null,
}) {
  /*
   * `base` is the repository a committed entry is relative to; `root` is the
   * directory the entry is ABOUT. They coincide for init and differ for
   * `project add` inside a monorepo, where the root is the pack and the
   * file sits at the top.
   */
  base ??= root;
  const target = inRepo ? join(base, '.walkdown', 'config.yml') : configPath();
  mkdirSync(dirname(target), { recursive: true });
  const doc = existsSync(target)
    ? parseDocument(readFileSync(target, 'utf8'))
    : parseDocument(inRepo ? REPO_CONFIG_HEADER : '');
  if (!doc.get('projects')) doc.set('projects', doc.createNode([]));
  const projects = doc.get('projects');
  /*
   * A numbered home, or a blueprint standing on its own. `homeDir` means the
   * layout above and every path follows from it. Without one this is adopting
   * a blueprint that predates homes - runs and threads inside the spec, which
   * is where such a blueprint keeps them.
   */
  /*
   * The home implies every record path; a `spec` given beside it is a
   * blueprint that already stands elsewhere and is being LISTED, its records
   * in the home it just claimed (project add). `records` names the kinds a
   * legacy blueprint keeps inside itself, and those win.
   */
  const paths = {
    ...(homeDir ? homePaths(homeDir) : { spec, runs: join(spec, 'runs'), threads: join(spec, 'threads') }),
    ...(homeDir && spec ? { spec } : {}),
    ...records,
  };
  /*
   * Listed already? Asked of the SPEC, not the id. The config merges entries
   * by id, so two entries sharing one are one entry - and the default id is
   * the repository's basename, which thirty monorepo packs called `app` all
   * have. Keyed by id this returned `kept` for a blueprint that had never been
   * written down, handing it the FIRST `app`'s spec and ledger.
   */
  const item = (it, k) => String(it.get?.(k) ?? '');
  const rootsOf = (it) => {
    const r = it.get?.('roots');
    return (r?.items ? r.items.map((x) => x.value ?? x) : r ? [r] : []).map((x) => canon(expand(String(x), base ?? undefined)));
  };
  const listed = (projects.items ?? []).find(
    (it) =>
      item(it, 'spec') &&
      expand(item(it, 'spec'), base ?? undefined) === expand(paths.spec) &&
      (!root || !rootsOf(it).length || rootsOf(it).includes(canon(root))),
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
  /*
   * Relative to the repository in a committed file: it is read on machines
   * whose layouts have nothing in common. Under `~` in the personal one, for
   * the person who reads it.
   */
  const rel = (p) => (inRepo ? (p === base ? '.' : relative(base, p)) : tilde(p));
  if (inRepo)
    for (const [k, v] of Object.entries({ ...paths, ...(root ? { roots: root } : {}) }))
      if (!within(v, base))
        throw new Error(
          `${k}: ${v} lies outside ${base}, and a committed config cannot name a path outside its repository — list it personally instead`,
        );
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
   *
   * Every path is written out even though the home implies them. The config
   * is the one place that says where things are, and a person reading it
   * should not have to know the layout to know where their runs went.
   */
  /*
   * Block style, whatever the sequence was parsed as. A list emptied by a
   * relocation is written back as `projects: []`, which yaml reads as FLOW
   * style and keeps, so the next entry came out as `[ { id: acme, ... } ]`
   * in a file a person is meant to read and edit (n-0165).
   */
  projects.flow = false;
  projects.add(
    doc.createNode({
      id,
      // An ephemeral copy has no root: it is not about any checkout.
      ...(root ? { roots: [rel(root)] } : {}),
      ...Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, rel(v)])),
      ...(home ? { home } : {}),
      ...extra,
    }),
  );
  writeFileSync(target, String(doc));
  return { path: target, action: 'written', id };
}


/*
 * One spelling for one directory. A checkout reached through a symlink - and
 * on macOS everything under /var is - has two names, and `roots: [/var/x]`
 * must still claim a process whose cwd reports /private/var/x. Compared
 * canonically, never stored canonically: the config keeps the name the person
 * wrote.
 */
export function canon(p) {
  try {
    return realpathSync(p);
  } catch {
    /*
     * Not there yet - a records directory the first write will create. Its
     * nearest existing ancestor still has a real name, and a path under
     * /var compared against a root under /private/var is the same directory
     * (n-0169 tripped on exactly this while listing a home not yet built).
     */
    const abs = resolve(p);
    const parent = dirname(abs);
    return parent === abs ? abs : join(canon(parent), basename(abs));
  }
}

/** Is `dir` at or under `root`, whichever names either goes by. */
export function within(dir, root) {
  const d = canon(dir);
  const r = canon(root);
  return d === r || d.startsWith(r + '/');
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

/*
 * WHICH FILES DECLARE THIS ENTRY AT ALL - a fact of its own, not a sum.
 *
 * It used to be computed from the per-key marks above, and that is a
 * different question wearing the same answer: a personal entry restating
 * every key the repository declared left no key marked 'repo', so the report
 * said the committed file had no entry for a project it was the only reason
 * for (n-0151). Whether a file declared an entry is decided when the file is
 * read, and carried beside the marks rather than inferred from them.
 */
export const DECLARED_BY = Symbol('walkdown.declaredBy');

const declaredBy = (entry, files) =>
  Object.defineProperty(entry, DECLARED_BY, { value: files, enumerable: false });

/** Which files declare this entry at all - 'personal', 'repo', 'both', null. */
export function declaringFiles(entry) {
  const by = entry?.[DECLARED_BY];
  if (!by) return null;
  if (by.personal && by.repo) return 'both';
  if (by.repo) return 'repo';
  if (by.personal) return 'personal';
  return null;
}

/**
 * The config, as the merge of the repository's and the person's.
 *
 * The repository half says which blueprints this project HAS - committed,
 * reviewed, the same for everyone who clones it. The personal half says where
 * they are on THIS disk and who is sitting here, and it wins wherever the two
 * speak about the same thing. Entries merge rather than replacing, so
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
  const mine = (p) =>
    declaredBy(withMarks(p, marks(Object.keys(p), 'personal')), { personal: true, repo: false });
  /*
   * A RELATIVE PATH IN THE PERSONAL FILE MEANS NOTHING.
   *
   * The repository's entries are anchored at the repository (anchorEntry);
   * the personal file sits in ~/.walkdown and is about every project on the
   * disk, so there is no base a relative `roots: [gamma]` could honestly be
   * resolved against. It used to be resolved against wherever the command
   * ran, which made a personal `roots: [.]` claim every directory you stood
   * in - alpha's board printed from inside gamma, a thread filed there in
   * alpha's ledger (n-0167). Such keys are set aside and named on the
   * report, so a copied entry is an override of what it did not spell out
   * rather than a project that follows you around.
   */
  const ignored = [];
  const anchored = (p) => {
    if (!p || typeof p !== 'object') return {};
    const rel = (v) => v && String(v).trim() && !String(v).trim().startsWith('~') && !isAbsolute(String(v).trim());
    const out = { ...p };
    const roots = [p.roots ?? []].flat().filter(Boolean);
    const kept = roots.filter((r) => !rel(r));
    for (const r of roots) if (rel(r)) ignored.push({ id: p.id ?? null, key: 'roots', value: String(r) });
    if (roots.length !== kept.length) {
      if (kept.length) out.roots = kept;
      else delete out.roots;
    }
    for (const k of ['spec', ...KINDS])
      if (rel(p[k])) {
        ignored.push({ id: p.id ?? null, key: k, value: String(p[k]) });
        delete out[k];
      }
    return out;
  };
  const personalProjects = (personal.config.projects ?? []).map(anchored);
  if (!repoPath)
    return {
      path,
      exists: personal.exists,
      // Stamped even with nothing to merge against: a caller asking which file
      // said so must get 'personal', never a shrug that reads the same as an
      // unmerged entry from some other code path.
      config: {
        ...personal.config,
        ...(personal.config.projects ? { projects: personalProjects.map((p) => mine(p)) } : {}),
      },
      error: personal.error,
      repo: null,
      shadowed: [],
      ignored,
      repoRooted: false,
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
      .map((p) => [
        p?.id,
        declaredBy(stamp(anchorEntry(p, base), 'repo'), { personal: false, repo: true }),
      ])
      .filter(([id]) => id),
  );
  /*
   * WHICH PERSONAL ENTRY IS ABOUT WHICH REPOSITORY ENTRY.
   *
   * By id - and by nothing else - two checkouts both called `app` on one disk
   * became one project the moment one of them was listed personally: the
   * personal `app` merged into whichever repository `app` you were standing
   * in, and `thread new` in one checkout filed into the other's ledger
   * (n-0160). An id is a name, and a name is not a coordinate.
   *
   * So a personal entry overrides a repository's only when it is ABOUT THIS
   * CHECKOUT - it shares the id and one of its `roots` lies inside the
   * repository the `.walkdown` answers for. A personal entry with the same id
   * rooted somewhere else is a different project that happens to share the
   * name; here it is shadowed by the repository's, and reachable from its own
   * checkout exactly as before. A personal entry with no roots at all - an
   * ephemeral copy - is never an override of anything.
   */
  const about = (p, prev) => {
    const roots = [p.roots ?? []].flat().filter(Boolean);
    /*
     * No roots and no spec of its own: a pure override - `evidence:` and a
     * port, the documented minimal shape - and it is about whichever
     * repository declares the id. No roots but a `spec`: a blueprint of its
     * own, an ephemeral copy, never an override of the real thing.
     */
    if (!roots.length) return !p.spec;
    /*
     * With roots: about the SAME checkout, which means one of its roots IS
     * one of the repository row's roots - not merely somewhere inside the
     * repository. "Inside" let a nested directory sharing the name
     * (mono/app/packs/app, given a plain init) merge over the committed
     * `app` rooted at the top, and the root's own records were stranded
     * (n-0170). Two rows rooted at two directories are two projects.
     */
    const theirs = [prev.roots ?? []].flat().filter(Boolean).map((r) => canon(expand(r, base)));
    return roots.some((r) => expand(r) && theirs.includes(canon(expand(r))));
  };
  const shadowed = [];
  const own = [];
  for (const p of personalProjects) {
    if (!p?.id) continue;
    const prev = byId.get(p.id);
    if (!prev) {
      own.push(mine(p));
      continue;
    }
    if (!about(p, prev)) {
      /*
       * Not this checkout's. A row rooted elsewhere still answers from its
       * own root (projectFor picks the longest root), so it is carried as
       * its own project; it is only shadowed where the repository's row
       * covers the same ground. Either way it never merges into the
       * repository's.
       */
      shadowed.push(p.id);
      own.push(mine(p));
      continue;
    }
    /*
     * Only the keys the PERSON wrote change hands. Re-stamping the whole
     * merged entry would credit the personal file for every key the
     * repository supplied - which is the bug, one layer down.
     */
    byId.set(
      p.id,
      declaredBy(
        withMarks({ ...prev, ...p }, marks(Object.keys(p), 'personal', prev[DECLARED_IN])),
        { personal: true, repo: true },
      ),
    );
  }
  const merged = {
    ...shared,
    ...personal.config,
    defaults: { ...(shared.defaults ?? {}), ...(personal.config.defaults ?? {}) },
    projects: [...byId.values(), ...own],
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
  /*
   * Whether the COMMITTED file roots an entry at the working directory - read
   * from that file's own entries, not from whichever project ended up
   * selected. A personal override that broke selection used to make the
   * repository's row deny an entry that was plainly there (n-0167).
   */
  const repoRooted = [...byId.values()].some(
    (p) => p[DECLARED_BY]?.repo && [p.roots ?? []].flat().some((r) => expand(r) && within(cwd, expand(r))),
  );
  return {
    path,
    exists: personal.exists,
    config: merged,
    error: personal.error,
    repo: { path: repoPath, exists: repo.exists, error: repo.error },
    shadowed,
    ignored,
    repoRooted,
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
  let best = null;
  for (const p of config.projects ?? []) {
    for (const root of [p.roots ?? []].flat()) {
      const r = expand(root);
      if (!r || !within(cwd, r)) continue;
      if (!best || canon(r).length > canon(best.root).length) best = { project: p, root: r };
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
 *   walkdown: { path: string | null, why: string },
 *   project: Record<string, any> | null, homeDir: string | null,
 *   standard: { name: string, why: string, rules?: string[] } | null,
 *   config: { path: string, exists: boolean, error: string | null, matched: boolean,
 *     matchedIn: 'personal' | 'repo' | 'both' | null,
 *     ignored: { id: string | null, key: string, value: string }[],
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
    ignored: cfgIgnored,
    repoRooted,
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
        /*
         * By id - and where two entries share it, the one about the checkout
         * you are standing in, then the repository's, then whichever came
         * first. Two checkouts called `app` can both be listed personally, and
         * `--project app` from inside one of them means that one (n-0160).
         */
        const named = (config.projects ?? []).filter((x) => x?.id === want);
        const p =
          named.find((x) => projectFor(cwd, { projects: [x] })) ??
          named.find((x) => declaringFiles(x) !== 'personal') ??
          named[0];
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
  const builtIn = (kind) => homeFor && homePaths(homeFor.dir)[kind];

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
        : { path: builtIn('spec'), why: homeFor.why };
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
    /*
     * A home answers with its layout: the five siblings, whichever kind. A
     * blueprint with no home - one a reader holds by path, nothing claiming
     * it - keeps everything inside the spec, the shape such a blueprint has
     * always had. The path was named outright, so it cannot collide with
     * anybody else's the way a name-keyed home could (n-0150).
     */
    out[kind] = homeFor
      ? { path: builtIn(kind), why: homeFor.why }
      : {
          path: join(spec.path, kind),
          why: 'inside the blueprint this reader holds, which nothing has claimed a home for',
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
  /*
   * WHAT VERSION CONTROL SEES, read off the tree rather than remembered.
   *
   * There is no flag recording which commit standard a project chose, and
   * that is the point: `init` used to write ignore rules once and could not
   * be asked to write them again, so changing your mind printed success and
   * changed nothing (n-0158). Now the tree IS the answer. A home under the
   * personal `~/.walkdown` is never git's business; a home under the
   * repository's `.walkdown` is git's except for whatever the `.gitignore`
   * beside it keeps out; and no `.gitignore` there means all of it.
   */
  const standard = (() => {
    if (!project) return null;
    const dir = homeFor?.dir ?? spec?.path;
    if (!dir) return null;
    if (dir === home || dir.startsWith(home + '/'))
      return { name: 'none', why: 'the home is in `~/.walkdown`, which git never sees' };
    if (!wdRoot) return null;
    const ignore = join(wdRoot, '.gitignore');
    if (!existsSync(ignore)) return { name: 'all', why: `no .gitignore in ${wdRoot} — everything there is git's` };
    const rules = readFileSync(ignore, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    return {
      name: 'spec',
      why: `${ignore} keeps out ${rules.join(', ') || 'nothing'} — delete it to commit everything`,
      rules,
    };
  })();
  return {
    id,
    home,
    /*
     * The `.walkdown` that answered, carried out with the answer. A server
     * that recomputed it from wherever the served blueprint happened to sit
     * offered a pack's whole list from a root-started server, and wrote to it
     * (n-0159). Whoever needs the scope asks this, not the path.
     */
    walkdown: wdRoot
      ? { path: wdRoot, why: 'the nearest `.walkdown` at or above the working directory' }
      : { path: null, why: 'no `.walkdown` between here and the top of the repository — only the personal config answers' },
    project,
    homeDir: homeFor?.dir ?? null,
    standard,
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
      // Keys the personal file wrote that mean nothing there, named so the
      // row can say why an entry did not do what its author expected.
      ignored: cfgIgnored,
      repo: cfgRepo && {
        ...cfgRepo,
        matched: declaredBy === 'repo' || declaredBy === 'both' || repoRooted,
      },
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
 *
 * It writes to THE ENTRY THAT RESOLVED and to no other. Selecting by
 * `loc.id` alone - a basename when nothing declared the directory - rewrote an
 * unrelated listed project's drafts key from inside a repository that merely
 * shared its name, and stranded that project's sitting (n-0153, n-0160). A
 * directory nothing declares has no entry to remember a choice in, and that is
 * refused by the caller, not guessed at here.
 */
export function rememberLocation(loc, kind, to) {
  const entry = loc.project;
  if (!entry) throw new Error('nothing declares this directory — there is no entry to write to');
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const doc = existsSync(path)
    ? parseDocument(readFileSync(path, 'utf8'))
    : parseDocument('# walkdown, personal configuration. See docs/08-locations.md.\n');

  if (!doc.has('projects')) doc.set('projects', doc.createNode([]));
  const projects = doc.get('projects');
  const items = projects.items ?? [];
  /*
   * The personal row for this entry: same id, and about this checkout - a
   * root inside the code, or the very spec, so that a second `app` listed
   * for another checkout is never the one written to.
   */
  const code = loc.code?.path ?? dirname(loc.spec.path);
  const inside = (r) => {
    const at = expand(String(r));
    return at && (within(code, at) || within(at, code));
  };
  let item = items.find((it) => {
    if (String(it.get?.('id') ?? '') !== String(entry.id)) return false;
    const roots = it.get('roots');
    const listed = roots?.items ? roots.items.map((r) => r.value ?? r) : roots ? [roots] : [];
    if (listed.length) return listed.some(inside);
    // A rootless row is either a pure override of this id - the row to write
    // into, or `move` appends a second row for the same project (n-0170) -
    // or an ephemeral copy, which is only this project if it is this spec.
    const spec = String(it.get('spec') ?? '');
    return spec ? expand(spec) === loc.spec.path : true;
  });
  if (!item) {
    /*
     * A repository-declared entry the person has never overridden: the
     * override row is created for it, rooted at this checkout so it merges
     * with that entry and nothing else. createNode, not a bare object: `add`
     * would insert plain JS that has no `set`.
     */
    projects.add(doc.createNode({ id: entry.id, roots: [tilde(code)] }));
    item = projects.items.at(-1);
  }
  item.set(kind, tilde(to));
  writeFileSync(path, String(doc));
  return path;
}
