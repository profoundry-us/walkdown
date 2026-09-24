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
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse, parseDocument } from '../vendor/yaml.js';
import { Refused } from './refusal.js';

/** Overridable so checks can point the whole scheme at a scratch directory. */
export const walkdownHome = () => process.env.WALKDOWN_HOME || join(homedir(), '.walkdown');

export const configPath = () => join(walkdownHome(), 'config.yml');
/*
 * THE REGISTRY (ADR 0003). Every blueprint this machine knows about, in one
 * file walkdown writes and a person reads. Beside config.yml, which stays the
 * person's own - identity, defaults - and registers nothing. Not under
 * cache/: after ADR 0003 this is the only record of what the machine knows,
 * and a directory called cache says it is safe to delete.
 */
export const registryPath = () => join(walkdownHome(), 'registry.yml');
/** Derived files - rebuilt on demand, deletable without loss. */
export const cacheDir = () => join(walkdownHome(), 'cache');

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
 * Write (or update) a blueprint entry, so the thing just created is declared.
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
  /*
   * Counting and claiming must be ONE step, and they were two.
   *
   * The listing is the record, so a claim that did not appear in it would not
   * be a claim - that was always the intent, and `mkdirSync(dir, { recursive:
   * true })` quietly broke it: recursive succeeds on a directory that is
   * already there, so two `init`s that read the listing at the same moment
   * both computed the same number and both "claimed" it. Eight repositories
   * released together against one home produced seven homes for eight
   * blueprints, two of them sharing a blueprint/, threads/ and runs/ - the
   * one thing this rule says unconditionally never happens (n-0208).
   *
   * A non-recursive mkdir is the whole fix: it is the filesystem's own
   * compare-and-swap, throwing EEXIST for whoever came second. Count, try to
   * take it, and on EEXIST count again - the winner's directory is in the
   * listing by then, so the next number is the next number.
   */
  for (let attempt = 0; ; attempt += 1) {
    const { home, dir } = nextNumber({ name, walkdown, homes });
    try {
      mkdirSync(dir);
      /*
       * And the swap is on the NAME, while what must be unique is the NUMBER.
       * Two racers with the same repository name do collide and one counts
       * again — which is why eight repositories all called `twin` came out
       * 0001-twin..0008-twin. Two racers with DIFFERENT names that counted the
       * same max+1 both mkdir successfully, because 0005-r1 and 0005-r4 are
       * different directories: no EEXIST, no retry, one number for two
       * blueprints and a permanently split ledger (n-0210).
       *
       * So look again, after the swap, for a stranger wearing this number.
       * Each racer reads only after its own mkdir has landed, so the two
       * cannot both find themselves alone: whoever reads last sees the other,
       * and if both read late both refuse. Refusing is the whole answer here
       * rather than serialising — Topher's call, 2026-09-06 — because every
       * design that makes concurrent init SUCCEED has to write a spent number
       * down somewhere, and a permanent marker in the tree is exactly what
       * `nothing-in-the-tree` and `in-repo-on-request` promise is not there.
       * Concurrent init is rare; a person retries and it works.
       */
      const twin = readdirSync(homes).find(
        (d) => d !== basename(dir) && d.startsWith(`${basename(dir).slice(0, 4)}-`),
      );
      if (twin) {
        // Ours, and only ours: made a moment ago, still empty.
        try {
          rmdirSync(dir);
        } catch {
          /* left standing rather than risk removing somebody's records */
        }
        throw new Refused(
          `another \`walkdown init\` claimed ${basename(dir).slice(0, 4)} at the same moment (it is ${twin}).\n` +
            'Nothing was written down and no home was made. Run init again — ' +
            'two inits at the same instant is the one case walkdown refuses rather than guesses at.',
        );
      }
      return { home, dir };
    } catch (e) {
      if (e instanceof Refused) throw e;
      // Anything else - a read-only home, a file standing where the directory
      // should go - is the caller's to hear about, unchanged.
      if (e.code !== 'EEXIST') throw e;
      /*
       * Bounded, because a loop that cannot fail is a loop that hangs. Fifty
       * is far past any real contention (the worst measured race was eight),
       * so reaching it means something other than a race - a listing that
       * does not reflect what mkdir sees, say - and saying so beats spinning.
       */
      if (attempt >= 50)
        throw new Error(
          `could not claim a home under ${homes} after ${attempt + 1} tries — ` +
            'every number counted was already taken by the time it was claimed',
        );
    }
  }
}

/*
 * The next free number, counted from the listing and from every number the
 * config still names. Split out of claimHome so the claim can count again
 * after losing a race, and so it is one expression with no side effects.
 */
function nextNumber({ name, walkdown, homes }) {
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
  for (const p of cfg.config.blueprints ?? []) {
    if (p?.home) seen(p.home);
    const spec = p?.spec ? expand(String(p.spec), base) : null;
    if (spec && within(spec, homes)) seen(relative(homes, spec).split('/')[0]);
  }
  // The registry names the personal homes now (ADR 0003), and its memory of
  // a number is the same memory: a row whose home has gone keeps its number.
  if (walkdown === walkdownHome())
    for (const r of readRegistry().rows) {
      const dir = r?.home ? expand(String(r.home)) : null;
      if (dir && within(dir, homes)) seen(relative(homes, dir).split('/')[0]);
    }
  const home = `${String(max + 1).padStart(4, '0')}-${slug(name) || 'project'}`;
  return { home, dir: join(homes, home) };
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
/** A path as a person reads it: their own home shortened to `~`. */
export const tilde = (p) => (p.startsWith(homedir() + '/') ? '~' + p.slice(homedir().length) : p);

/** A yaml row's `roots`, canonical, read against the file's base. */
function rowRoots(it, base) {
  const r = it.get?.('roots');
  const raw = r?.items ? r.items.map((x) => x.value ?? x) : r ? [r] : [];
  return raw
    .map((x) => expand(String(x), base ?? undefined))
    .filter(Boolean)
    .map((x) => canon(x));
}

/**
 * THE ROW ABOUT THIS CHECKOUT, in a config document - the writers' half of
 * the question the merge asks (readUserConfig, `about`).
 *
 * Same id, and one of: a root canon-equal to `root`; no roots and no spec,
 * the pure-override shape, which is about whichever project carries the id;
 * or no roots and this very `spec`, an ephemeral copy of it. A row rooted
 * anywhere else is a different project that shares the name, and a rootless
 * row with some other spec is a different blueprint. Containment in either
 * direction is deliberately not asked: it is what let a move at a
 * repository's root record its evidence on the nested pack's row (n-0173).
 *
 * @param {any[]} items
 * @param {{ id: string, root: string | null, spec?: string | null, base?: string | null }} of
 */
function rowAbout(items, { id, root, spec = null, base = null }) {
  const at = root ? canon(root) : null;
  return (
    items.find((it) => {
      if (String(it.get?.('id') ?? '') !== String(id)) return false;
      const roots = rowRoots(it, base);
      if (roots.length) return Boolean(at) && roots.includes(at);
      const own = String(it.get?.('spec') ?? '');
      if (!own) return true;
      return Boolean(spec) && canon(expand(own, base ?? undefined)) === canon(spec);
    }) ?? null
  );
}

const REGISTRY_HEADER = [
  "# walkdown's registry - every blueprint this machine knows about (ADR 0003).",
  '#',
  '# Written by `walkdown import` and `walkdown init`. Not intended for manual',
  '# editing: a row written by hand carries no `registered:` and is not read.',
  '# Paths are real paths, canonicalised when the row was written, spelled with',
  '# ~ for reading. `walkdown blueprints` lists what is here; `walkdown blueprint',
  '# forget <id>` takes a row out.',
  '',
].join('\n');

/**
 * The registry as written: rows in the shape ADR 0003 draws - `id`, the
 * `project` the blueprint came from (null for one kept out of any
 * repository), its `home`, `registered: { by, at }`, `ephemeral: { why }` on
 * a scratch copy, and any machine-local overrides (`evidence:`, `targets:`)
 * as plain keys beside them.
 *
 * @returns {{ exists: boolean, rows: Record<string, any>[], error: string | null }}
 */
export function readRegistry() {
  const path = registryPath();
  if (!existsSync(path)) return { exists: false, rows: [], error: null };
  try {
    const parsed = parse(readFileSync(path, 'utf8')) ?? {};
    const rows = Array.isArray(parsed.blueprints) ? parsed.blueprints : [];
    return { exists: true, rows: rows.filter((r) => r && typeof r === 'object'), error: null };
  } catch (e) {
    return { exists: true, rows: [], error: e.message };
  }
}

/** Write the rows back, under the header, in block style, stamped. */
export function writeRegistry(rows) {
  const target = registryPath();
  mkdirSync(dirname(target), { recursive: true });
  const doc = parseDocument(REGISTRY_HEADER);
  doc.set('built', new Date().toISOString());
  const list = doc.createNode(rows);
  list.flow = false;
  doc.set('blueprints', list);
  writeFileSync(target, String(doc));
  return target;
}

/**
 * A registry row as the rest of this file reads an entry: every record path
 * spelled out from the home, `roots` from the project, and the older
 * provenance keys the listings and the crossing exemption still look for.
 * Translation is one way; nothing downstream writes these back.
 *
 * A scratch copy gets no roots on purpose - it is never picked by standing
 * somewhere (ADR 0003 §3), which is what `--ephemeral` has always meant.
 */
export function registryEntry(raw) {
  const homeDir = raw.home ? canon(expand(String(raw.home))) : null;
  const project = raw.project ? canon(expand(String(raw.project))) : null;
  const { home: _h, project: _p, registered, ephemeral, ...rest } = raw;
  const at = registered?.at ?? null;
  return {
    id: raw.id,
    // The spec is the home's; the other kinds are the home's too unless the
    // row spells one out (a `walkdown move`), which `rest` carries through.
    ...(homeDir ? { spec: join(homeDir, HOME_LAYOUT.spec) } : {}),
    ...rest,
    homeDir,
    project,
    ...(project && !ephemeral ? { roots: [project] } : {}),
    ...(homeDir && /^\d{4}-/.test(basename(homeDir)) ? { home: basename(homeDir) } : {}),
    ...(registered?.by === 'import' && !ephemeral && project
      ? { imported: { project: tilde(project), at } }
      : {}),
    ...(ephemeral ? { ephemeral: true, declared: at, why: ephemeral?.why ?? '' } : {}),
    registered: registered ?? null,
  };
}

/**
 * Write a row into the registry - the personal half of rememberBlueprint,
 * which used to be a list inside config.yml. Same questions as the committed
 * writer asks, on plain objects rather than a yaml document: listed already
 * (by home, never by id); a row already about this checkout (same id, same
 * project), written INTO rather than beside (n-0171); a free id within the
 * file; and then a new row.
 */
function rememberInRegistry({ id, root, homeDir, moved = {}, extra = {}, by = 'import', ephemeral = null }) {
  const target = registryPath();
  mkdirSync(dirname(target), { recursive: true });
  const release = lockConfig(target);
  try {
    const { rows, error } = readRegistry();
    if (error) throw new Error(`${target} does not parse (${error}) — fix it first; nothing was written.`);
    const home = canon(homeDir);
    const same = (a, b) =>
      Boolean(a) && Boolean(b) && canon(expand(String(a))) === canon(expand(String(b)));
    // Only rows a writer stamped count as listed or as this checkout's row;
    // a hand-written one is set aside on read and must not block the write
    // that would replace it (n-0278).
    const listed = rows.find(
      (r) => r.registered && r.home && same(r.home, home) && (!root || !r.project || same(r.project, root)),
    );
    if (listed) return { path: target, action: 'kept', id: String(listed.id ?? id) };
    const at = new Date().toISOString();
    const overrides = Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, tilde(v)]));
    const mine = root
      ? rows.find((r) => r.registered && String(r.id) === String(id) && r.project && same(r.project, root))
      : null;
    if (mine) {
      mine.home = tilde(home);
      for (const k of KINDS) delete mine[k];
      Object.assign(mine, overrides, extra);
      mine.registered ??= { by, at };
      writeRegistry(rows);
      return { path: target, action: 'written', id: String(mine.id) };
    }
    /*
     * A row about this checkout still in config.yml - the pure-override
     * shape, a port and an evidence path, or one from before the registry -
     * is this project's row, and two rows about one checkout is n-0171.
     * Its keys fold into the registry row and it leaves config.yml: that
     * file registers nothing now, and the person asked for this write.
     */
    const fold = root && !ephemeral ? foldFromConfig({ id, root, spec: join(home, HOME_LAYOUT.spec) }) : null;
    const folded = fold?.values ?? {};
    const taken = new Set(rows.map((r) => String(r.id ?? '')).filter(Boolean));
    if (taken.has(id)) {
      const wanted = id;
      for (let n = 2; taken.has(id); n++) id = `${wanted}-${n}`;
    }
    rows.push({
      id,
      project: root ? tilde(canon(root)) : null,
      home: tilde(home),
      registered: { by, at },
      ...(ephemeral ? { ephemeral: { why: ephemeral.why ?? '' } } : {}),
      ...folded,
      ...overrides,
      ...extra,
    });
    writeRegistry(rows);
    // What came out of config.yml, for the report to name: a row taken out of
    // a file the person edits by hand is a thing they should hear about (#18).
    return { path: target, action: 'written', id, ...(fold ? { folded: fold } : {}) };
  } finally {
    release();
  }
}

/*
 * The config.yml row about this checkout, taken out and its machine-local
 * keys handed back for the registry row to carry. Paths it spelled out are
 * kept only where they point OUTSIDE the home - a moved evidence directory,
 * say - since the home implies the rest.
 *
 * Returns { values, from, id, path } - the keys the registry row takes, the
 * list the row came out of, its id there, and the file - or null for none.
 */
function foldFromConfig({ id, root, spec }) {
  const path = configPath();
  if (!existsSync(path)) return null;
  const release = lockConfig(path);
  try {
    const doc = parseDocument(readFileSync(path, 'utf8'));
    if (doc.errors.length) return null;
    /*
     * Either list from before the registry. A `projects:` row predates ids
     * anyone chose - `init` names the checkout afresh - so there the row is
     * found by its roots alone, which is what it was about (#18).
     */
    let key = 'blueprints';
    let rows = doc.get(key);
    let row = rows?.items?.length ? rowAbout(rows.items, { id, root, spec }) : null;
    if (!row && root) {
      key = 'projects';
      rows = doc.get(key);
      const at = canon(root);
      row = rows?.items?.find((it) => rowRoots(it, null).includes(at)) ?? null;
    }
    if (!row) return null;
    const out = {};
    for (const pair of row.items ?? []) {
      const k = String(pair.key?.value ?? pair.key);
      if (['id', 'roots', 'spec', 'home'].includes(k)) continue;
      const v = pair.value?.toJSON ? pair.value.toJSON() : pair.value?.value;
      if (KINDS.includes(k)) {
        const p = typeof v === 'string' ? expand(v) : null;
        if (!p || within(p, dirname(spec))) continue;
        out[k] = tilde(p);
        continue;
      }
      out[k] = v;
    }
    rows.delete(rows.items.indexOf(row));
    rows.flow = false;
    // A list with nothing left in it goes too: config.yml registers nothing,
    // and `blueprints: []` standing there reads as a place to put one.
    const was = String(row.get?.('id') ?? '');
    if (!rows.items.length) doc.delete(key);
    writeFileSync(path, String(doc));
    return { values: out, from: key, id: was, path };
  } finally {
    release();
  }
}

/**
 * THE REGISTRY'S OWN ANSWER for a directory (ADR 0003 §4), computed beside
 * the walk's and compared with it - not yet the answer. It looks at nothing
 * but the rows it is handed: the registered rows whose `project` contains
 * `cwd`, the deepest of them winning where a pack is registered inside its
 * repository, and a question where several are registered for one project.
 * A scratch copy is never picked by standing somewhere. Named outright, the
 * row with that id - and among several, the one whose project contains cwd.
 *
 * At step 3 of the ADR this becomes what resolveLocations answers with, and
 * "no row" becomes the prompt to import. Until then `where` shows both and
 * says where they differ, which is how a disagreement is a finding before
 * it is a change.
 *
 * @param {string} cwd
 * @param {Record<string, any>[]} rows raw registry rows
 * @param {string | null} [want] a blueprint id named outright
 * @returns {{ candidates: string[], picked: Record<string, any> | null, why: string }}
 */
export function registryPick(cwd, rows, want = null) {
  const here = canon(cwd);
  const projectOf = (r) => (r.project ? canon(expand(String(r.project))) : null);
  const registered = rows.filter((r) => r?.registered && r.home);
  if (want) {
    const named = registered.filter((r) => String(r.id) === String(want));
    if (!named.length) return { candidates: [], picked: null, why: `no registered blueprint \`${want}\`` };
    const here_ = named.filter((r) => projectOf(r) && within(here, projectOf(r)));
    const pick = here_.length === 1 ? here_[0] : named.length === 1 ? named[0] : null;
    return {
      candidates: named.map((r) => String(r.id)),
      picked: pick,
      why: pick
        ? `registered as \`${want}\`${projectOf(pick) ? `, from ${tilde(projectOf(pick))}` : ''}`
        : `${named.length} blueprints are registered as \`${want}\` and none of their projects contains this directory`,
    };
  }
  const contain = registered.filter((r) => !r.ephemeral && projectOf(r) && within(here, projectOf(r)));
  if (!contain.length)
    return { candidates: [], picked: null, why: 'no registered project contains this directory' };
  const deepest = Math.max(...contain.map((r) => projectOf(r).length));
  const inner = contain.filter((r) => projectOf(r).length === deepest);
  if (inner.length === 1)
    return {
      candidates: [String(inner[0].id)],
      picked: inner[0],
      why: `registered project ${tilde(projectOf(inner[0]))} contains this directory`,
    };
  return {
    candidates: inner.map((r) => String(r.id)),
    picked: null,
    why: `${inner.length} blueprints are registered for ${tilde(projectOf(inner[0]))} (${inner
      .map((r) => r.id)
      .join(', ')}) — --blueprint says which`,
  };
}

/** Take out of the registry every row whose home is this directory, or this id. */
export function forgetFromRegistry({ homeDir = null, id = null }) {
  const { rows, error } = readRegistry();
  if (error) throw new Error(`${registryPath()} does not parse (${error}) — fix it first.`);
  const keep = rows.filter((r) => {
    if (id !== null && String(r.id) === String(id)) return false;
    if (homeDir && r.home && canon(expand(String(r.home))) === canon(homeDir)) return false;
    return true;
  });
  if (keep.length === rows.length) return false;
  writeRegistry(keep);
  return true;
}

/**
 * Write a project's entry: its id, where its code is, and the home every
 * record path derives from.
 *
 * `homeDir` is required and there is no `records` any more. A blueprint
 * keeping runs and threads INSIDE itself was the layout before homes, and
 * nothing reads it; `moved` carries only the kinds a person deliberately put
 * somewhere else with `walkdown move`, which ride along when the home changes
 * hands (relocateHome).
 *
 * @param {{ id: string, root: string | null, homeDir: string,
 *   inRepo?: boolean, home?: string | null, moved?: Record<string, string>,
 *   extra?: Record<string, any>, base?: string | null,
 *   by?: 'import' | 'init' | 'move', ephemeral?: { why?: string } | null }} entry
 */
/*
 * One writer at a time on a config file, or a refusal.
 *
 * A lock somebody WAITS on is serialising, and this project's answer to two
 * inits at once is to refuse (Topher, 2026-09-06, on n-0210). So this is the
 * same sentence the number allocator gives, one file down: whoever finds the
 * lock held is told to run again rather than queued behind it.
 *
 * It goes stale on its own. A refusal that outlived a crashed process would
 * wedge a person out of their own config forever, which is a far worse
 * failure than the lost row it is here to prevent — so a lock older than
 * LOCK_STALE_MS is taken rather than obeyed. Ten seconds is orders of
 * magnitude longer than the read-modify-write it guards.
 */
const LOCK_STALE_MS = 10_000;

/*
 * Re-entrant within one process, because init takes this lock around the
 * whole of claim + scaffold + write and rememberBlueprint then asks for it
 * again from inside. Without that, init deadlocks against itself — and the
 * outer take is the one that matters: a racer refused at the config write
 * has already made a home by then, which is the stranded home this whole
 * fix exists to prevent (measured, n-0219).
 */
const held = new Set();

export function lockConfig(target) {
  const lock = `${target}.lock`;
  if (held.has(lock)) return () => {};
  // The config's own directory may not exist yet — init locks before it
  // scaffolds, which is the whole point. Making it here costs nothing: every
  // caller is about to write the config that lives in it.
  mkdirSync(dirname(lock), { recursive: true });
  const release = () => {
    held.delete(lock);
    try {
      unlinkSync(lock);
    } catch {
      /* somebody took it as stale; the write itself already landed */
    }
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // 'wx' is the filesystem's compare-and-swap, the same primitive the
      // home allocator uses one directory up.
      writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
      held.add(lock);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Number.POSITIVE_INFINITY;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        /* it went away between the failed create and the stat: try again */
        continue;
      }
      if (age > LOCK_STALE_MS) {
        try {
          unlinkSync(lock);
        } catch {
          /* somebody else cleared it first, which is just as good */
        }
        continue;
      }
      throw new Refused(
        `another walkdown is writing ${target} right now.\n` +
          'Nothing was written down. Run the command again — two writes to one config at the ' +
          'same instant is the case walkdown refuses rather than guesses at.',
      );
    }
  }
  throw new Refused(
    `${target} is locked by a write that keeps reappearing. Nothing was written down.\n` +
      `If no other walkdown is running, remove ${target}.lock and try again.`,
  );
}

export function rememberBlueprint({
  id,
  root,
  homeDir,
  inRepo = false,
  home = null,
  moved = {},
  extra = {},
  base = null,
  by = 'import',
  ephemeral = null,
}) {
  if (!homeDir) throw new Error('every blueprint lives in a home — rememberBlueprint needs the directory the layout derives from');
  /*
   * Personal rows go to the registry (ADR 0003 step 1). The committed file
   * below is a manifest: what a project declares, read on every machine.
   */
  if (!inRepo) return rememberInRegistry({ id, root, homeDir, moved, extra, by, ephemeral });
  /*
   * `base` is the repository a committed entry is relative to; `root` is the
   * directory the entry is ABOUT. They coincide for init and differ for
   * `project add` inside a monorepo, where the root is the pack and the
   * file sits at the top.
   */
  base ??= root;
  /*
   * Relative to the repository in a committed file: it is read on machines
   * whose layouts have nothing in common. Under `~` in the personal one, for
   * the person who reads it.
   */
  const rel = (p) => (inRepo ? (p === base ? '.' : relative(base, p)) : tilde(p));
  const target = inRepo ? join(base, '.walkdown', 'config.yml') : configPath();
  mkdirSync(dirname(target), { recursive: true });
  /*
   * And now nobody else, until this write has landed.
   *
   * The read-modify-write above and below is a lost update waiting to
   * happen: six concurrent inits made six homes and three rows, every
   * process exiting 0 and naming the home it thought it had listed, and
   * three checkouts left with records in a home no row mentioned
   * (n-0208's surviving half, measured again as n-0219).
   *
   * The answer is the one already taken for the number this row carries:
   * refuse concurrent init rather than serialise it (Topher, 2026-09-06,
   * n-0210). A lock somebody has to WAIT on is serialising; a lock that
   * refuses is the same sentence the number allocator gives. It lives
   * beside the config rather than in a repository tree, so it costs
   * `nothing-in-the-tree` nothing, and it goes stale on its own — a lock
   * that outlived a crashed process must never be able to wedge a person
   * out of their own config forever.
   */
  const release = lockConfig(target);
  try {
    const doc = existsSync(target)
      ? parseDocument(readFileSync(target, 'utf8'))
      : parseDocument(inRepo ? REPO_CONFIG_HEADER : '');
    if (!doc.get('blueprints')) doc.set('blueprints', doc.createNode([]));
    const rows = doc.get('blueprints');
    /*
     * The home implies every record path. `moved` names the kinds a person has
     * already moved OUTSIDE it - `walkdown move evidence --to ~/x` - which is a
     * declared decision that rides along when the home changes hands
     * (relocateHome). Nothing else overrides the layout: a blueprint keeping
     * runs inside itself was the layout before homes, and it is not read any
     * more.
     */
    const paths = /** @type {Record<string, string>} */ ({ ...homePaths(homeDir), ...moved });
    /*
     * Listed already? Asked of the SPEC, not the id. The config merges entries
     * by id, so two entries sharing one are one entry - and the default id is
     * the repository's basename, which thirty monorepo packs called `app` all
     * have. Keyed by id this returned `kept` for a blueprint that had never been
     * written down, handing it the FIRST `app`'s spec and ledger.
     */
    const item = (it, k) => String(it.get?.(k) ?? '');
    const rootsOf = (it) => rowRoots(it, base);
    /*
     * A spec inside this `.walkdown`'s own homes is listed by the entry that
     * names it, whatever root that entry carries: the home was allocated by
     * this file, so the spec cannot be anybody else's. Asking for the root too
     * let `project add .walkdown/blueprints/0001-x/blueprint` from inside the
     * checkout list its own blueprint a second time, rooted at the numbered
     * home, and mint an empty second home for it (n-0178).
     */
    const ownHome = base && within(paths.spec, join(base, '.walkdown', 'blueprints'));
    const listed = (rows.items ?? []).find(
      (it) =>
        item(it, 'spec') &&
        canon(expand(item(it, 'spec'), base ?? undefined)) === canon(paths.spec) &&
        (ownHome || !root || !rootsOf(it).length || rootsOf(it).includes(canon(root))),
    );
    if (listed) return { path: target, action: 'kept', id: item(listed, 'id') || id };
    if (inRepo) {
      for (const [k, v] of Object.entries({ ...paths, ...(root ? { roots: root } : {}) }))
        if (!within(v, base))
          throw new Error(
            `${k}: ${v} lies outside ${base}, and a committed config cannot name a path outside its repository — list it personally instead`,
          );
    }
    /*
     * A row already ABOUT THIS CHECKOUT - same id, rooted at this directory, or
     * the rootless pure-override shape - is this project's row, and the home's
     * paths are written INTO it rather than beside it. Two rows once came out
     * of every move back out of a repository: the personal row was reduced to
     * `{id, roots, targets}` on the way in and the writer, matching by spec,
     * could not see it on the way out, so it appended `beta-2` at the same
     * root and the checkout answered with neither (n-0171, n-0173). The
     * writer asks the question the merge asks (readUserConfig, `about`), and
     * a row rooted elsewhere is a different project even under the same name.
     */
    const mine = root ? rowAbout(rows.items ?? [], { id, root, base }) : null;
    if (mine) {
      for (const [k, v] of Object.entries(paths)) mine.set(k, rel(v));
      if (home) mine.set('home', home);
      else if (mine.has('home')) mine.delete('home');
      if (!mine.has('roots')) mine.set('roots', [rel(root)]);
      for (const [k, v] of Object.entries(extra)) mine.set(k, v);
      writeFileSync(target, String(doc));
      return { path: target, action: 'written', id: item(mine, 'id') || id };
    }
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
    const taken = new Set((rows.items ?? []).map((it) => item(it, 'id')).filter(Boolean));
    if (taken.has(id)) {
      const wanted = id;
      for (let n = 2; taken.has(id); n++) id = `${wanted}-${n}`;
    }
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
     * relocation is written back as `blueprints: []`, which yaml reads as FLOW
     * style and keeps, so the next entry came out as `[ { id: acme, ... } ]`
     * in a file a person is meant to read and edit (n-0165).
     */
    rows.flow = false;
    rows.add(
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
  } finally {
    release();
  }
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

/**
 * Symlinks under `root` whose target lies outside it, as
 * `{ path, target, resolved }`.
 *
 * Reading through a link is harmless and supported: the panel serves a linked
 * screenshot, and a scratch copy shares the real evidence directory by linking
 * each entry into it (n-0193). Every link walkdown itself makes points inward.
 *
 * A link pointing OUT is the one that costs something, because the writers
 * here write THROUGH it. `blueprint/AGENTS.md` was a link into `lib/templates`
 * so the two could not drift; `init --force` rewrote the blueprint copy and
 * truncated the template it was linked to, and every check in the repo stayed
 * green (n-0186's second half).
 *
 * Reported, never followed: a linked directory is named and not descended, so
 * a cycle is impossible and a door out of the tree is not a way to walk the
 * whole disk. A broken link resolves to where it points, not to where it sits.
 */
export function escapingLinks(root) {
  const top = canon(root);
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable is somebody else's complaint
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isSymbolicLink()) {
        let target;
        try {
          target = readlinkSync(abs);
        } catch {
          continue;
        }
        const resolved = canon(resolve(dir, target));
        if (!within(resolved, top)) out.push({ path: abs, target, resolved });
        continue; // named, not descended
      }
      if (e.isDirectory()) walk(abs);
    }
  };
  walk(top);
  return out;
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
 * The config, as this machine keeps it (ADR 0003).
 *
 * Two files, two authors. `config.yml` is the person's: identity and
 * defaults, edited by hand, registering nothing. `registry.yml` is
 * walkdown's: every blueprint this machine knows about, written by `import`
 * and `init`, and the only list any reader consults. There is no committed
 * half to merge any more - a repository's `.walkdown/config.yml` is a
 * manifest that `import` reads once - so there is no merge, no override
 * shape, and nothing found by standing somewhere.
 *
 * A `blueprints:` list still sitting in config.yml is from before the
 * registry. It is not read: a row there is hand-written by definition now,
 * and each is named on the report with the command that registers it.
 */
export function readUserConfig() {
  const path = configPath();
  const personal = readConfigFile(path);
  const registry = readRegistry();
  const ignored = [];
  const setAside = (id, key, value, why) => ignored.push({ id, key, value: String(value), why });
  /*
   * Why a value in the personal file is not a path it can resolve, or null
   * when it is one. Blank, and `~name` with no slash, used to pass as "not
   * relative" - a `defaults: { evidence: '  ' }` expanded to wherever the
   * command ran (n-0175).
   */
  const stray = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return 'is blank, not a path';
    if (s === '~' || s.startsWith('~/')) return null;
    if (s.startsWith('~')) return 'is not a path this file resolves — write it in full';
    if (!isAbsolute(s)) return 'a relative path means nothing in this file; write it in full';
    return null;
  };
  for (const p of personal.config.blueprints ?? [])
    setAside(
      p?.id ?? null,
      'blueprints',
      p?.id ?? '?',
      'config.yml registers nothing since ADR 0003 — `walkdown import <project>` registers it, and this row can go',
    );
  /*
   * And `projects:`, the shape before `blueprints:` - the same list under an
   * older name, which fell through unread and unnamed, so nothing said a
   * checkout's targets were sitting in a block nobody consulted (#18).
   */
  for (const p of personal.config.projects ?? [])
    setAside(
      p?.id ?? null,
      'projects',
      p?.id ?? '?',
      'config.yml registers nothing since ADR 0003 — the first `walkdown init` or `import` of this checkout folds this row in, and it can go',
    );
  const defaults = { ...(personal.config.defaults ?? {}) };
  for (const [k, v] of Object.entries(defaults))
    if (!KINDS.includes(k)) {
      // `defaults.spec` and the like: an older config's line for something the
      // registry row decides now. Nothing reads it, so it is named (#18).
      setAside(null, `defaults.${k}`, v, `a ${k} is never a default — the registry row names the home, and this line can go`);
      delete defaults[k];
    } else if (stray(v)) {
      setAside(null, `defaults.${k}`, v, stray(v));
      delete defaults[k];
    }
  /*
   * And a registry row nothing wrote - no `registered:` - is set aside the
   * same way (ADR 0003 §5). The writers all stamp it; a row without it is a
   * hand edit, and the only path question walkdown asks is at add time, so
   * a path nobody added through that door is not consulted at all.
   */
  const rows = [];
  for (const r of registry.rows) {
    if (r?.registered && r.home) rows.push(r);
    else
      setAside(
        r?.id ?? null,
        'registry',
        r?.id ?? '?',
        r?.home
          ? 'written by hand — no `registered:` says how it arrived; `walkdown import <home>` registers it, and this row can go'
          : 'names no home — nothing to answer with; `walkdown import <home>` registers one',
      );
  }
  const { blueprints: _legacy, projects: _older, ...rest } = personal.config;
  const config = { ...rest, blueprints: rows.map(registryEntry) };
  if (Object.keys(defaults).length) config.defaults = defaults;
  else delete config.defaults;
  return {
    path,
    exists: personal.exists,
    config,
    error: personal.error,
    registry: { path: registryPath(), exists: registry.exists, error: registry.error },
    ignored,
  };
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

/** What a blueprint calls itself, which is the best id it can have. */
function declaredName(specDir) {
  try {
    const y = parse(readFileSync(join(specDir, 'walkdown.yml'), 'utf8'));
    return y?.blueprint ? slug(y.blueprint) : null;
  } catch {
    return null;
  }
}

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
  `${project?.[key] ? "this machine's registry" : "the home this machine registered"} (${project?.id ?? 'project'})${tail}`;

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
 * @param {{ cwd?: string, blueprint?: string | null, spec?: string | null,
 *   overrides?: Record<string, string> }} [where]
 * @returns {{ id: string, home: string,
 *   walkdown: { path: string | null, why: string },
 *   blueprint: Record<string, any> | null, homeDir: string | null,
 *   standard: { name: string, why: string, rules?: string[] } | null,
 *   ambiguous: boolean,
 *   config: { path: string, exists: boolean, error: string | null, matched: boolean,
 *     matchedIn: 'registry' | null,
 *     ignored: { id: string | null, key: string, value: string, why: string }[],
 *     registry: { path: string, exists: boolean, error: string | null, matched: boolean,
 *       registeredBy: string | null, candidates: string[] },
 *     repo: null,
 *     refused: never[] },
 *   code: { path: string | null, why: string }, codeRoot: string | null,
 *   spec: Location, runs: Location, threads: Location,
 *   evidence: Location, drafts: Location }}
 */
export function resolveLocations({
  cwd = process.cwd(),
  blueprint: want = null,
  spec: at = null,
  overrides = {},
} = {}) {
  const { path: cfgPath, exists: cfgExists, config, error: cfgError, registry: cfgRegistry, ignored: cfgIgnored } =
    readUserConfig();
  const rows = readRegistry().rows;
  const defaults = config.defaults ?? {};
  const home = walkdownHome();
  const ignored = [...(cfgIgnored ?? [])];

  /*
   * WHICH BLUEPRINT (ADR 0003 §4). By id when one was named; by the spec
   * path for the readers inside walkdown that hold a loaded blueprint and
   * need its records; otherwise the registered row whose project contains
   * the working directory. Nothing is found on disk: a directory no row
   * contains is not a project, however much it looks like one, and the
   * answer says how to register it rather than guessing.
   */
  let raw = null;
  let why = null;
  let ambiguous = false;
  if (at) {
    const want_ = canon(expand(at, cwd));
    raw =
      rows.find(
        (r) =>
          r?.registered &&
          r.home &&
          canon(join(expand(String(r.home)), HOME_LAYOUT.spec)) === want_,
      ) ?? null;
    if (!raw)
      why = `nothing registered at ${expand(at, cwd)} — every blueprint walkdown answers for is in the registry; \`walkdown import <home>\` registers one`;
  } else {
    const pick = registryPick(cwd, rows, want);
    raw = pick.picked;
    if (!raw) {
      ambiguous = pick.candidates.length > 1;
      why = ambiguous
        ? pick.why
        : want
          ? `no registered blueprint \`${want}\` — \`walkdown blueprints\` lists them`
          : unregisteredHere(cwd);
    }
  }
  const entry = raw ? registryEntry(raw) : null;
  const homeDir = entry?.homeDir ?? null;

  // ---- the spec ------------------------------------------------------------
  let spec;
  if (entry) {
    spec = { path: entry.spec, why: `this machine's registry (${entry.id})` };
    spec.missing = !existsSync(spec.path);
  } else spec = { path: null, why };

  const code = gitRoot(spec?.path ?? cwd) ?? gitRoot(cwd);
  const id = entry?.id
    ? slug(entry.id)
    : ((spec.path && declaredName(spec.path)) ?? slug(basename(code ?? cwd)));

  /*
   * A `defaults:` value is a path the person WROTE DOWN. Its `{id}` is
   * substitutable exactly when a row allocated an id to substitute.
   */
  const fromDefault = (v) => {
    const raw_ = String(v);
    if (!raw_.includes('{id}')) return expand(raw_);
    return entry?.id ? expand(raw_.replace('{id}', slug(entry.id))) : null;
  };

  // ---- the records ---------------------------------------------------------
  const out = {};
  for (const kind of KINDS) {
    if (overrides[kind]) {
      out[kind] = { path: expand(overrides[kind], cwd), why: 'named on the command line' };
      continue;
    }
    if (entry?.[kind]) {
      // Written on the row: a move this machine made (`walkdown move`).
      out[kind] = { path: expand(entry[kind]), why: configWhy(entry, kind) };
      continue;
    }
    if (!spec.path) {
      out[kind] = { path: null, why: 'nothing is registered for this directory' };
      continue;
    }
    if (defaults[kind]) {
      const at_ = fromDefault(defaults[kind]);
      /*
       * A default that lands in walkdown's own `blueprints/` but outside the
       * home this row registered is the layout from before numbered homes -
       * `~/.walkdown/blueprints/{id}/runs` beside `0002-{id}/`, not in it.
       * Honoured, it filed nine questions where the home's own reader never
       * looked, and nothing said so (#18). A default aimed anywhere else -
       * all evidence on another disk - is a choice, and stands.
       */
      if (at_ && homeDir && within(at_, join(home, 'blueprints')) && !within(at_, homeDir)) {
        ignored.push({
          id: entry?.id ?? null,
          key: `defaults.${kind}`,
          value: String(defaults[kind]),
          why: `lands beside this blueprint's home, not in it (${tilde(at_)}) — the layout before numbered homes; ${tilde(join(homeDir, HOME_LAYOUT[kind]))} answers instead, and this line can go`,
        });
      } else if (at_) {
        out[kind] = { path: at_, why: 'the config default' };
        continue;
      }
    }
    // A home answers with its layout: the five siblings, whichever kind.
    out[kind] = { path: homePaths(homeDir)[kind], why: configWhy(entry, kind) };
  }
  const [runs, threads, evidence, drafts] = KINDS.map((k) => out[k]);

  /*
   * Where the CODE is. The row's project leads - the one answer somebody
   * wrote down, true from any directory, and the only thing that can answer
   * for a spec kept outside the code. Otherwise the spec's own parent, by
   * the convention every in-tree project follows.
   */
  const specRepo = spec?.path ? gitRoot(spec.path) : null;
  const entryRoot = entry?.project ?? null;
  const codePath = entryRoot ?? specRepo ?? code;
  const codeRootPath = entryRoot ?? (spec?.path ? dirname(spec.path) : null);

  /*
   * THE `.walkdown` THE HOME SITS IN, read off the path rather than found by
   * walking. A numbered home lives under `<something>/.walkdown/blueprints/`;
   * that `.walkdown` is where the ignore file beside it lives and what the
   * tracking report reads. A scratch copy under `.walkdown/tmp/` has none.
   */
  const wdRoot = (() => {
    if (!homeDir) return null;
    const up = dirname(homeDir);
    if (basename(up) !== 'blueprints') return null;
    const wd = dirname(up);
    return basename(wd) === '.walkdown' || canon(wd) === canon(home) ? wd : null;
  })();

  /*
   * WHAT VERSION CONTROL SEES, read off the tree rather than remembered
   * (n-0158). A home under the personal `~/.walkdown` is never git's
   * business; a home under a repository's `.walkdown` is git's except for
   * whatever the `.gitignore` beside it keeps out; no `.gitignore` there
   * means all of it.
   */
  const standard = (() => {
    if (!entry || !homeDir) return null;
    if (within(homeDir, home))
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
    walkdown: wdRoot
      ? { path: wdRoot, why: 'the `.walkdown` the registered home sits in' }
      : { path: null, why: entry ? 'the home sits under no `.walkdown`' : 'nothing is registered for this directory' },
    blueprint: entry,
    homeDir,
    standard,
    ambiguous,
    config: {
      path: cfgPath,
      exists: cfgExists,
      error: cfgError,
      matched: Boolean(entry),
      matchedIn: entry ? 'registry' : null,
      ignored,
      registry: {
        ...cfgRegistry,
        matched: Boolean(entry),
        registeredBy: entry?.registered
          ? `${entry.registered.by ?? 'walkdown'} on ${String(entry.registered.at ?? '').slice(0, 10)}`
          : null,
        candidates: ambiguous ? registryPick(cwd, rows, want).candidates : [],
      },
      repo: null,
      refused: [],
    },
    code: codePath
      ? {
          path: codePath,
          why: entryRoot
            ? "this machine's registry, which says which project the blueprint came from"
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
 * What to say where no registered project contains the working directory. A
 * manifest nearby is the one path question asked here, and it is asked for
 * the message only: it names what `import` would register, never answers
 * for it.
 */
function unregisteredHere(cwd) {
  const top = gitRoot(cwd) ?? canon(cwd);
  let dir = canon(cwd);
  for (let i = 0; i < 24; i++) {
    const manifest = join(dir, '.walkdown', 'config.yml');
    if (existsSync(manifest)) {
      let ids = [];
      try {
        ids = (parse(readFileSync(manifest, 'utf8'))?.blueprints ?? []).map((b) => b?.id).filter(Boolean);
      } catch {
        /* unreadable: still worth naming */
      }
      return `nothing registered contains this directory — ${tilde(dir)} declares ${
        ids.length ? ids.map((x) => `\`${x}\``).join(', ') : 'a blueprint'
      } in ${tilde(manifest)}; \`walkdown import ${tilde(dir)}\` registers it`;
    }
    if (canon(dir) === canon(top)) break;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return 'nothing registered contains this directory — `walkdown init` starts a blueprint here, `walkdown import <project>` registers one that exists';
}

/*
 * Can the choice be written down AT ALL - asked before anything moves.
 *
 * `relocateHome` reads both config files before it relocates a thing, with a
 * standing comment from n-0172 saying a move that cannot be written down is a
 * move that does not happen. `walkdown move` never inherited that: it
 * relocated first and wrote after, so a personal config that would not parse,
 * or that could not be written, left the records at the new address with the
 * config still naming the old one - which no longer exists (n-0201).
 *
 * Throws the sentence the caller should print. Returns nothing: it is a
 * question, and asking must write nothing.
 */
export function canRemember(loc) {
  if (!loc.blueprint)
    throw new Error('nothing registered contains this directory — there is no row to write to');
  /*
   * Both files the write touches (ADR 0003): the registry, where the row
   * goes, and config.yml, from which a row about this checkout is folded on
   * the way. Either one unwritable is the move not made.
   */
  for (const path of [registryPath(), configPath()]) {
    if (!existsSync(path)) {
      if (path === registryPath()) checkWritable(dirname(path));
      continue;
    }
    /*
     * Ask the question the WRITER asks, not a neighbouring one.
     *
     * This used to check the file by calling `.toJS()` on it, which reads a
     * damaged document quite happily - the parser collects its errors rather
     * than throwing. `rememberLocation` writes with `String(doc)`, and THAT
     * refuses: "Document with errors cannot be stringified". So a tab used
     * for indentation, an unquoted colon in a value, an unterminated flow
     * sequence - all of them sailed through the precheck, the records moved,
     * and the write then died with a raw stack trace, leaving the ledger at
     * an address the config still did not name (n-0206). The precheck for a
     * write must be the write's own test: `doc.errors`, which is the thing
     * `toString` consults.
     */
    let doc;
    try {
      doc = parseDocument(readFileSync(path, 'utf8'));
    } catch (e) {
      doc = { errors: [e] };
    }
    if (doc.errors?.length)
      // The parser's message carries the offending line and a caret under it,
      // which is useful in a file report and noise in one sentence. The first
      // line is the complaint; the rest is the pointing.
      throw new Error(
        `${path} cannot be written back (${String(doc.errors[0].message).split('\n')[0]}). ` +
          'The move is not made: a choice that cannot be written down is not a choice. Fix that file first.',
      );
    checkWritable(path);
  }
}

function checkWritable(target) {
  try {
    accessSync(target, constants.W_OK);
  } catch {
    throw new Error(
      `${target} cannot be written. ` +
        'The move is not made: the records would end up somewhere nothing declares.',
    );
  }
}

export function rememberLocation(loc, kind, to) {
  const entry = loc.blueprint;
  if (!entry) throw new Error('nothing registered contains this directory — there is no row to write to');
  /*
   * Written on the registry row for this blueprint (ADR 0003 §6): a moved
   * record kind is a fact about this disk, and the registry is where this
   * machine's facts live. The row is found the way the merge finds it
   * (rowAbout): the same id about this checkout, or the row whose home this
   * is - an ephemeral copy. Containment in either direction is not asked; a
   * move at a repository's root once recorded on the nested pack's row
   * (n-0173).
   *
   * A committed blueprint the person has never touched has no row yet: one is
   * made for it, project and home as they stand, so the override merges with
   * that entry and nothing else. A row still in config.yml about this
   * checkout folds into it on the way (foldFromConfig).
   */
  const code = loc.code?.path ?? dirname(loc.spec.path);
  const homeDir = loc.homeDir ?? dirname(loc.spec.path);
  const target = registryPath();
  mkdirSync(dirname(target), { recursive: true });
  const release = lockConfig(target);
  try {
    const { rows, error } = readRegistry();
    if (error) throw new Error(`${target} does not parse (${error}) — fix it first; nothing was written.`);
    const same = (a, b) =>
      Boolean(a) && Boolean(b) && canon(expand(String(a))) === canon(expand(String(b)));
    let row = rows.find(
      (r) =>
        String(r.id) === String(entry.id) &&
        (r.project ? same(r.project, code) : same(r.home, homeDir)),
    );
    if (!row) {
      const folded = foldFromConfig({ id: String(entry.id), root: code, spec: loc.spec.path })?.values ?? {};
      row = {
        id: entry.id,
        project: tilde(canon(code)),
        home: tilde(canon(homeDir)),
        registered: { by: 'move', at: new Date().toISOString() },
        ...folded,
      };
      rows.push(row);
    }
    row[kind] = tilde(to);
    writeRegistry(rows);
    return target;
  } finally {
    release();
  }
}
