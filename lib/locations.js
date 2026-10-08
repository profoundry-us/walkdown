/*
 * Where this project's pieces live, and why.
 *
 * One answer, computed once, so that every command agrees about it and a
 * person can ask the same question the tool asks (`walkdown where`). The
 * design and the reasoning are in docs/08-locations.md and ADR 0014; this is
 * the resolver.
 *
 * The principle it implements: the blueprint declares what the project needs,
 * and ~/.walkdown declares where this machine puts things and who is sitting
 * at it. The person's registry may move records and name ports. It may never
 * change what a rule means, or `walkdown status` would say two different
 * things on two laptops.
 *
 * Nothing here writes, except the functions whose names say they do.
 * Resolving a location is a question, and asking it must be free of
 * consequences - `walkdown where` on a machine with nothing set up should
 * leave the disk exactly as it found it.
 */
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse, parseDocument } from '../vendor/yaml.js';
import { Refused } from './refusal.js';

/** Overridable so checks can point the whole scheme at a scratch directory. */
export const walkdownHome = () => process.env.WALKDOWN_HOME || join(homedir(), '.walkdown');

/*
 * THE PERSON'S OWN FILE (ADR 0014 §6): who they are, and their defaults.
 * It was `config.yml` until three different files in walkdown were called
 * that and were mistaken for one another; `walkdown upgrade` renames it.
 */
export const profilePath = () => join(walkdownHome(), 'profile.yml');
/** The profile's name before ADR 0014, kept so the upgrade can find it. */
export const legacyConfigPath = () => join(walkdownHome(), 'config.yml');
/** Every caller that meant "the person's own file" means the profile now. */
export const configPath = profilePath;
/*
 * THE REGISTRY (ADR 0003, ADR 0014 §1). Every blueprint this person chose to
 * see, and how each is set up on this machine. Not under cache/: it is the
 * only record of what the machine knows, and a directory called cache says
 * it is safe to delete.
 */
export const registryPath = () => join(walkdownHome(), 'registry.yml');
/** Derived files - rebuilt on demand, deletable without loss. */
export const cacheDir = () => join(walkdownHome(), 'cache');
/** Where personal homes live, a folder per project (ADR 0014 §4). */
export const projectsDir = () => join(walkdownHome(), 'projects');
export const personalHomes = (project) => join(projectsDir(), project, 'blueprints');

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
 * Write down who is sitting here, once, if nobody has.
 *
 * Records are written under the profile's identity and nothing else can name
 * a person any more, which makes an absent `identity:` block a wall rather
 * than a default: accepting work is refused on a machine that only has a git
 * email to go on. The block is therefore part of being set up, and setup is
 * what `init` is - a human ran it, and building the profile around the human
 * who ran it is the point.
 *
 * Created, never corrected. An existing block is left exactly as found even
 * where git disagrees with it: it is a person's own statement about their
 * name, and the one thing an agent may not quietly change.
 *
 * The guess is passed IN rather than read here, because the module that knows
 * how to make one reads the profile through this one - asking it directly
 * would be a cycle.
 */
export function rememberIdentity({ username, name }) {
  const target = profilePath();
  const doc = existsSync(target) ? parseDocument(readFileSync(target, 'utf8')) : parseDocument('');
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
 * THE SHAPE OF A HOME (ADR 0014 §5). One flat folder, wherever it sits:
 *
 *     202610-search/
 *       spec.yml          the blueprint's settings
 *       storyboard.yml    screens and their anchors
 *       features/         stories and rules
 *       AGENTS.md         the agent conventions, copied from walkdown
 *       records.yml       where its records usually live
 *       .gitignore        this blueprint's commit choice
 *       threads/  runs/  evidence/  drafts/
 *
 * The spec used to sit one folder down, in `blueprint/`, and the home around
 * it was a numbered folder walkdown allocated. A folder path cannot collide
 * with itself, so the team names it and walkdown reads any name.
 */
export const SPEC_FILE = 'spec.yml';
export const RECORDS_FILE = 'records.yml';
export const KINDS = ['runs', 'threads', 'evidence', 'drafts'];
export const HOME_LAYOUT = Object.freeze({
  spec: '.',
  threads: 'threads',
  runs: 'runs',
  evidence: 'evidence',
  drafts: 'drafts',
});

/** Every path inside one home, by kind. The spec is the home itself. */
export const homePaths = (dir) =>
  Object.fromEntries(
    Object.entries(HOME_LAYOUT).map(([k, rel]) => [k, rel === '.' ? dir : join(dir, rel)]),
  );

/** Is this folder a home: does it hold a spec.yml? */
export const isHome = (dir) => {
  try {
    return statSync(join(dir, SPEC_FILE)).isFile();
  } catch {
    return false;
  }
};

/*
 * A home laid out before ADR 0014: `blueprint/walkdown.yml` inside a
 * numbered folder. Only `walkdown upgrade` reads one, to flatten it.
 */
export const isOldHome = (dir) => existsSync(join(dir, 'blueprint', 'walkdown.yml'));

/** The folders inside a home that are its own, never a home inside it. */
const HOME_OWN = new Set([
  'features',
  'threads',
  'runs',
  'evidence',
  'drafts',
  'proposals',
  'prototype',
  'node_modules',
]);

/**
 * Every home under `<checkout>/.walkdown/blueprints/`, at any depth (ADR 0014
 * §4), and every home standing inside another one, which is refused.
 *
 * Found by the file a home holds, never by a number in its name. A home is
 * not descended into for more homes except to say that one is there.
 *
 * `flat` walks the directory given rather than its `.walkdown/blueprints/`,
 * for a person's own `~/.walkdown/projects/<label>/blueprints/`.
 *
 * @param {string} checkout
 * @param {{ flat?: boolean }} [opts]
 * @returns {{ homes: { dir: string, folder: string }[], nested: { outer: string, inner: string }[] }}
 */
export function findHomes(checkout, { flat = false } = {}) {
  const top = flat ? checkout : join(checkout, '.walkdown', 'blueprints');
  const homes = [];
  const nested = [];
  const walk = (dir, outer, depth) => {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (outer && dir === outer && HOME_OWN.has(e.name)) continue;
      const at = join(dir, e.name);
      if (isHome(at)) {
        if (outer) nested.push({ outer, inner: at });
        else homes.push({ dir: at, folder: relative(top, at) });
        walk(at, outer ?? at, depth + 1);
      } else walk(at, outer, depth + 1);
    }
  };
  if (existsSync(top)) walk(top, null, 0);
  // By folder, so a list a person picks from by number reads the same twice.
  homes.sort((a, b) => a.folder.localeCompare(b.folder));
  return { homes, nested };
}

/** A name in lowercase words joined by dashes. */
export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'blueprint';

/*
 * The folder walkdown gives a new home: the blueprint's name, `search`.
 * A number or a date in front is the person's to choose with --folder,
 * `202610-search` or `0002-search`; walkdown adds none (n-0355).
 */
export function suggestFolder(name) {
  return slug(name);
}

/*
 * The description an ID ends with, from a folder name: the name without a
 * leading number or date, which is only ever read here and only to suggest
 * (ADR 0014 §2). `0002-cli` and `202610-cli` both describe `cli`.
 */
export const describeFolder = (folder) => slug(basename(folder).replace(/^\d+-(?=.)/, ''));

/*
 * REGISTRY IDS (ADR 0014 §2): `NNNN-pc-description`. The number is the
 * registry's own counter, the code is the project's, and the description is
 * what a person types inside the project.
 */
const ID_SHAPE = /^(\d{4})-([a-z0-9]{2,3})-([a-z0-9][a-z0-9-]*)$/;
export const isRegistryId = (s) => ID_SHAPE.test(String(s));
/** The description an ID ends with: `cli` in `0002-wd-cli`. */
export const nameOf = (id) => String(id).match(ID_SHAPE)?.[3] ?? String(id);
export const codeOf = (id) => String(id).match(ID_SHAPE)?.[2] ?? null;
export const numberOf = (id) => {
  const m = String(id).match(ID_SHAPE);
  return m ? Number(m[1]) : null;
};

/* git, asked quietly: the answer or null, never a word on stderr. */
const gitAsk = (cwd, args) => {
  try {
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
};

/*
 * What git says about a directory, asked once per process: every resolve
 * asks it of every registered checkout, and git is a process each time.
 */
const asked = new Map();
function remembered(key, fn) {
  if (!asked.has(key)) asked.set(key, fn());
  return asked.get(key);
}
/** A remote's URL, spelled one way: git@host:owner/repo.git and https://host/owner/repo are one. */
const spellRemote = (url) =>
  url
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    // ssh://host:22/owner/repo and host:owner/repo are one remote.
    .replace(/^([a-z]+:\/\/(?:[^@/]+@)?[^/:]+):\d+\//, '$1/')
    .replace(/^[a-z]+:\/\/(?:[^@/]+@)?/, '')
    .replace(/^[^@/]+@/, '')
    .replace(':', '/')
    .toLowerCase();
/** A checkout's `origin` remote, spelled one way, or null. */
export const originOf = (dir) =>
  dir
    ? remembered(`origin\0${canon(dir)}`, () => {
        const url = gitAsk(dir, ['config', '--get', 'remote.origin.url']);
        return url ? spellRemote(url) : null;
      })
    : null;
/** Every remote a checkout has, spelled one way. */
const remotesOf = (dir) =>
  (gitAsk(dir, ['config', '--get-regexp', '^remote\\..*\\.url$']) ?? '')
    .split('\n')
    .map((line) => line.split(' ').slice(1).join(' '))
    .filter(Boolean)
    .map(spellRemote);
const commonDirOf = (dir) =>
  dir
    ? remembered(`common\0${canon(dir)}`, () => {
        const d = gitAsk(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
        return d ? canon(d) : null;
      })
    : null;
const topOf = (dir) =>
  dir
    ? remembered(`top\0${canon(dir)}`, () => {
        const d = gitAsk(dir, ['rev-parse', '--show-toplevel']);
        return d ? canon(d) : null;
      })
    : null;

/*
 * A PROJECT IS A LABEL (ADR 0014 §3), named after the repository: the
 * `origin` remote's last part, or the directory's name where there is none.
 */
/**
 * Whether a registered row whose checkout is gone could be `checkout` moved:
 * the same place inside it is not enough, since an unrelated repository can
 * share a folder layout (n-0536). A project named outright must be the row's;
 * failing that, a checkout with an origin must give the row's label. Only a
 * checkout with neither - a rename with no remote - is judged by layout alone.
 * @param {{ project?: unknown, origin?: unknown, checkout?: unknown, root?: unknown, registered?: any }} row
 * @param {string} checkout
 * @param {string|null} [project]
 */
export function couldHaveMoved(row, checkout, project = null) {
  if (!checkoutGone(row)) return false;
  if (project) return String(row.project ?? '') === project;
  if (anotherRepository(row, checkout, 'elsewhere')) return false;
  if (row.root && rootsOf(checkout).length) return true;
  const origin = originOf(checkout);
  if (origin && !row.origin) return String(row.project ?? '') === defaultLabel(checkout);
  return true;
}

/**
 * Whether a checkout is certainly not the repository a row was registered
 * from, asked of the row's old path and of a candidate for its new one.
 *
 * At the row's own path, the very `.git` the row was registered from - the
 * same inode, kept on the row - is the same checkout, whatever has happened
 * to its commits or its remote since: amended and collected, an org
 * renamed, a remote removed (n-0548, n-0549). Any other `.git` there - a
 * re-clone, a sibling cloned where a gone project stood (n-0547), another
 * repository renamed in (n-0550) - is put to the tests below.
 *
 * The first commit, kept on the row, rules out a repository whose history
 * does not hold it, or that has none (n-0538, n-0547); a shallow cut, since
 * deepened, is still held. It cannot rule one in: a whole template family
 * shares it. So a row that knew its origin also wants it named - as the
 * origin, or among the remotes, as a fork keeps it in `upstream` (n-0544,
 * n-0545). A later commit is no test at all: an amend and a gc take it from
 * a checkout that never moved (n-0549).
 * @param {{ root?: unknown, origin?: unknown, git?: unknown }} row
 * @param {string} dir
 * @param {'here' | 'elsewhere'} where
 */
function anotherRepository(row, dir, where) {
  if (where === 'here' && row.git) {
    if (gitIdOf(dir) === String(row.git)) return false;
  }
  if (row.root && !hasCommit(dir, String(row.root))) return true;
  if (!row.origin || originOf(dir) === String(row.origin)) return false;
  return !remotesOf(dir).includes(String(row.origin));
}

/**
 * Which `.git` a checkout has: its device and inode. A move keeps it; a
 * clone, a copy, or another repository renamed into the path does not -
 * which its birth time could not say, as an older repository swapped in
 * proved (n-0550).
 */
function gitIdOf(dir) {
  try {
    const st = statSync(join(dir, '.git'));
    return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
}

/**
 * Whether a row's checkout is gone. A home missing from its place is not
 * enough: the same repository checked out at a commit from before its homes
 * is still there, and an unrelated repository with the same layout must not
 * take its rows (n-0538). Something else standing at the old path - another
 * repository, or no repository at all - leaves it gone.
 * @param {{ checkout?: unknown, origin?: unknown, project?: unknown, root?: unknown }} row
 */
/** A checkout's root commits on every branch, sorted, or none before its first. */
export const rootsOf = (dir) =>
  dir
    ? remembered(`roots\0${canon(dir)}`, () =>
        (gitAsk(dir, ['rev-list', '--all', '--max-parents=0']) ?? '')
          .split('\n')
          .filter(Boolean)
          .sort(),
      )
    : [];
/** Whether a checkout's repository holds a commit. */
const hasCommit = (dir, sha) =>
  /^[0-9a-f]{7,64}$/.test(sha) && gitAsk(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null;
/** The first commit of the branch a checkout is on, or null. */
const headRootOf = (dir) =>
  (gitAsk(dir, ['rev-list', '--max-parents=0', 'HEAD']) ?? '')
    .split('\n')
    .filter(Boolean)
    .sort()[0] ?? null;

export function checkoutGone(row) {
  if (!row?.checkout) return false;
  const old = resolve(expand(String(row.checkout)));
  if (!existsSync(old)) return true;
  const repo = topOf(old) === canon(old);
  // Another repository put at the old path leaves the row gone (n-0541),
  // by the same test a candidate for its new path is put to (n-0546).
  if (repo && anotherRepository(row, old, 'here')) return true;
  // Its home still on disk stands where it is, committed or not.
  if (row.home && existsSync(join(resolve(expand(String(row.home))), SPEC_FILE))) return false;
  if (!repo) return true;
  // The same repository is still standing if, whatever it has checked out,
  // the home is somewhere in its history (n-0540). One that never held it -
  // its origin cloned back without an unpushed home - is not.
  const home = row.home ? inside(resolve(expand(String(row.home))), old) : null;
  return !(home && gitAsk(old, ['rev-list', '--all', '-1', '--', home]));
}

/*
 * A row written before rows kept their repository is given it the next time
 * the registry is written, while its checkout still holds its home: a
 * registry from an older walkdown then learns which repository each row is
 * without being asked to upgrade (n-0540).
 */
function remember(row) {
  if (!row?.registered || row.ephemeral || !row.checkout || !row.home) return;
  // Learned together, once: a row with no origin is not asked again.
  if (row.root && row.git) return;
  const at = resolve(expand(String(row.checkout)));
  if (!existsSync(join(resolve(expand(String(row.home))), SPEC_FILE))) return;
  if (!existsSync(at) || topOf(at) !== canon(at)) return;
  const origin = originOf(at);
  const root = headRootOf(at);
  if (!row.origin && origin) row.origin = origin;
  if (!row.root && root) row.root = root;
  if (!row.git) row.git = gitIdOf(at) ?? undefined;
}

export function defaultLabel(checkout) {
  const origin = originOf(checkout);
  const name = origin ? basename(origin) : basename(checkout ?? '') || 'project';
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

/*
 * The two- or three-letter code an ID carries for its project. Initials
 * where the label has several words (`acme_main` is `am`), else the first
 * letter and the first consonant from the middle on (`walkdown` is `wd`). A
 * code another project has is not given; the person is asked for one.
 */
export function deriveCode(label) {
  const parts = String(label)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return 'bp';
  if (parts.length > 1)
    return parts
      .slice(0, 3)
      .map((p) => p[0])
      .join('');
  const w = parts[0];
  if (w.length < 2) return `${w}x`;
  const rest = w.slice(Math.floor(w.length / 2));
  const consonant = rest.match(/[b-df-hj-np-tv-z0-9]/)?.[0] ?? w[1];
  return `${w[0]}${consonant}`;
}

const REGISTRY_HEADER = [
  "# walkdown's registry - every blueprint this machine knows about (ADR 0003, ADR 0014).",
  '#',
  '# Written by `walkdown blueprints import` and `walkdown blueprints new`. Not intended for',
  '# manual editing: a row written by hand carries no `registered:` and is not read.',
  "# Each row's `id` is this machine's name for the blueprint and is written nowhere else.",
  '# `walkdown blueprints` lists what is here; `walkdown blueprints forget <id>` takes a row out.',
  '',
].join('\n');

/**
 * The registry as written: rows of `id`, `project` (the label), `code`,
 * `checkout` (the repository the blueprint belongs to, null for a copy kept
 * in no repository), `home`, `registered: { by, at }`, `ephemeral: { why }`
 * on a scratch copy, and any machine-local overrides (`evidence:`,
 * `targets:`) as plain keys beside them. `next` is the counter.
 *
 * @returns {{ exists: boolean, rows: Record<string, any>[], next: number, error: string | null }}
 */
export function readRegistry() {
  const path = registryPath();
  if (!existsSync(path)) return { exists: false, rows: [], next: 1, error: null };
  try {
    const parsed = parse(readFileSync(path, 'utf8')) ?? {};
    const rows = (Array.isArray(parsed.blueprints) ? parsed.blueprints : []).filter(
      (r) => r && typeof r === 'object',
    );
    const top = Math.max(0, ...rows.map((r) => numberOf(r.id) ?? 0));
    const next = Math.max(Number(parsed.next) || 1, top + 1);
    return { exists: true, rows, next, error: null };
  } catch (e) {
    return { exists: true, rows: [], next: 1, error: e.message };
  }
}

/** Write the rows back, under the header, in block style, stamped. */
export function writeRegistry(rows, next = null) {
  const target = registryPath();
  mkdirSync(dirname(target), { recursive: true });
  const top = Math.max(0, ...rows.map((r) => numberOf(r.id) ?? 0));
  const was = existsSync(target) ? readRegistry().next : 1;
  for (const r of rows) remember(r);
  const doc = parseDocument(REGISTRY_HEADER);
  doc.set('built', new Date().toISOString());
  // A number once given is never given again, so the counter only climbs.
  doc.set('next', Math.max(next ?? 1, was, top + 1));
  const list = doc.createNode(rows);
  list.flow = false;
  doc.set('blueprints', list);
  writeFileSync(target, String(doc));
  return target;
}

/**
 * A registry row as the rest of walkdown reads it: the home and the spec
 * (the same folder now), the checkout - also under its old name `project`,
 * for the readers that ask which repository - and the label and code.
 * Translation is one way; nothing downstream writes these back.
 *
 * A scratch copy gets no roots on purpose - it is never picked by standing
 * somewhere (ADR 0003 §3), which is what `--ephemeral` has always meant.
 */
export function registryEntry(raw) {
  const homeDir = raw.home ? canon(expand(String(raw.home))) : null;
  const checkout = raw.checkout ? canon(expand(String(raw.checkout))) : null;
  const { home: _h, project: label, code, checkout: _c, registered, ephemeral, ...rest } = raw;
  const at = registered?.at ?? null;
  return {
    ...rest,
    id: String(raw.id),
    name: nameOf(raw.id),
    label: label ?? null,
    code: code ?? codeOf(raw.id),
    ...(homeDir ? { spec: homeDir } : {}),
    homeDir,
    checkout,
    project: checkout,
    ...(checkout && !ephemeral ? { roots: [checkout] } : {}),
    ...(homeDir ? { home: basename(homeDir) } : {}),
    ...(registered?.by === 'import' && !ephemeral && checkout
      ? { imported: { project: tilde(checkout), at } }
      : {}),
    ...(ephemeral ? { ephemeral: true, declared: at, why: ephemeral?.why ?? '' } : {}),
    registered: registered ?? null,
  };
}

/*
 * One writer at a time on a registry, or a refusal.
 *
 * A lock somebody WAITS on is serialising, and this project's answer to two
 * writes at once is to refuse (Topher, 2026-09-06, on n-0210): whoever finds
 * the lock held is told to run again rather than queued behind it.
 *
 * It goes stale on its own. A refusal that outlived a crashed process would
 * wedge a person out of their own registry forever, which is a far worse
 * failure than the lost row it is here to prevent - so a lock older than
 * LOCK_STALE_MS is taken rather than obeyed.
 *
 * Re-entrant within one process, because `blueprints new` takes it around
 * the whole of make + scaffold + register, and the register asks again.
 */
const LOCK_STALE_MS = 10_000;
const held = new Set();

export function lockConfig(target) {
  const lock = `${target}.lock`;
  if (held.has(lock)) return () => {};
  mkdirSync(dirname(lock), { recursive: true });
  // Once only: a second call would take a lock somebody else holds by now.
  const release = () => {
    if (!held.has(lock)) return;
    held.delete(lock);
    process.removeListener('exit', release);
    try {
      unlinkSync(lock);
    } catch {
      /* somebody took it as stale; the write itself already landed */
    }
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
      held.add(lock);
      /*
       * A command that refuses with process.exit while holding the lock
       * skips every finally above it, and left the lock for the next ten
       * seconds of writes to be refused by.
       */
      process.once('exit', release);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Number.POSITIVE_INFINITY;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
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
          'Nothing was written down. Run the command again — two writes to one file at the ' +
          'same instant is the case walkdown refuses rather than guesses at.',
      );
    }
  }
  throw new Refused(
    `${target} is locked by a write that keeps reappearing. Nothing was written down.\n` +
      `If no other walkdown is running, remove ${target}.lock and try again.`,
  );
}

/**
 * What a checkout's project is called on this machine, if it has one: the
 * label and code its rows already carry. A worktree is never its own project
 * (ADR 0014 §10), so the caller hands in the checkout it belongs to.
 */
export function projectOf(checkout, rows = readRegistry().rows) {
  if (!checkout) return null;
  const at = canon(checkout);
  const row = rows.find(
    (r) => r?.registered && r.checkout && canon(expand(String(r.checkout))) === at && r.project,
  );
  return row ? { label: String(row.project), code: String(row.code ?? codeOf(row.id)) } : null;
}

/**
 * Register a blueprint (ADR 0014 §2, §3): give its home an ID and a row.
 *
 * Listed already, by its home under any spelling, is `kept`. A checkout the
 * registry already knows keeps its project's label and code; a new one gets
 * the label it asked for or its repository's name, and a code - and where
 * either is another project's, nothing is written and the caller hears
 * which, so the person can choose (`label-taken`, `code-taken`).
 *
 * @param {{ checkout: string | null, homeDir: string, by?: string,
 *   project?: string | null, code?: string | null, name?: string | null,
 *   ephemeral?: { why?: string } | null, extra?: Record<string, any> }} ask
 * @returns {{ path: string, action: 'kept' | 'written' | 'moved' | 'label-taken' | 'code-taken',
 *   id?: string, project?: string | null, code?: string, beside?: string[], taken?: string, from?: string }}
 */
export function register({
  checkout,
  homeDir,
  by = 'import',
  project = null,
  code = null,
  name = null,
  ephemeral = null,
  extra = {},
}) {
  const target = registryPath();
  mkdirSync(dirname(target), { recursive: true });
  const release = lockConfig(target);
  try {
    const { rows, next, error } = readRegistry();
    if (error)
      throw new Error(`${target} does not parse (${error}) — fix it first; nothing was written.`);
    const home = canon(homeDir);
    const same = (a, b) =>
      Boolean(a) && Boolean(b) && canon(expand(String(a))) === canon(expand(String(b)));
    const listed = rows.find((r) => r.registered && r.home && same(r.home, home));
    if (listed)
      return {
        path: target,
        action: 'kept',
        id: String(listed.id),
        project: listed.project ?? null,
      };

    /*
     * A CHECKOUT THAT MOVED keeps its IDs (locations.registry.ids-stay-here).
     * A row whose checkout is no longer there, whose home sat at this home's
     * place inside it, is this blueprint: every row of that checkout is
     * pointed at the new one, its committed homes with it, and no number,
     * label or code changes.
     */
    if (checkout && !ephemeral) {
      const now = canon(checkout);
      const inside = relative(now, home);
      const was = rows.find((r) => {
        if (!r.registered || !r.home || !r.checkout || r.ephemeral) return false;
        const old = resolve(expand(String(r.checkout)));
        // The home gone from its place, whether or not something new has
        // been made at the old path since.
        const was = resolve(expand(String(r.home)));
        // Gone is checkoutGone's to say, whatever stands at the old path now:
        // another repository's home there is no sign this one stayed (n-0541).
        return old !== now && relative(old, was) === inside && couldHaveMoved(r, now, project);
      });
      if (was) {
        const old = resolve(expand(String(was.checkout)));
        for (const r of rows) {
          if (!r.checkout || resolve(expand(String(r.checkout))) !== old) continue;
          rebaseRow(r, old, now);
        }
        writeRegistry(rows, next);
        return {
          path: target,
          action: 'moved',
          id: String(was.id),
          project: was.project ?? null,
          from: old,
        };
      }
    }

    let label;
    let pc;
    // Rows whose checkout is gone - another repository stands at their
    // path now - are another project's, never this one's (n-0548).
    const mine = (r) => checkout && same(r.checkout, checkout) && !checkoutGone(r);
    const known =
      checkout && !ephemeral
        ? projectOf(
            checkout,
            rows.filter((r) => !checkout || !same(r.checkout, checkout) || mine(r)),
          )
        : null;
    const others = rows.filter((r) => r.registered && r.project && !mine(r));
    if (ephemeral) {
      label = null;
      pc = 'tmp';
    } else if (known) {
      label = known.label;
      pc = known.code;
    } else {
      label = project ?? (checkout ? defaultLabel(checkout) : 'personal');
      if (others.some((r) => String(r.project) === label))
        return { path: target, action: 'label-taken', taken: label };
      pc = code ?? deriveCode(label);
      if (!/^[a-z0-9]{2,3}$/.test(pc))
        throw new Refused(
          `\`${pc}\` is not a project code — two or three lowercase letters or digits`,
        );
      if (others.some((r) => String(r.code ?? codeOf(r.id)) === pc))
        return { path: target, action: 'code-taken', taken: pc, project: label };
    }
    const description = slug(name ?? describeFolder(home));
    const id = `${String(next).padStart(4, '0')}-${pc}-${description}`;
    const beside = rows
      .filter((r) => r.registered && !r.ephemeral && checkout && same(r.checkout, checkout))
      .map((r) => nameOf(r.id));
    rows.push({
      id,
      project: label,
      code: pc,
      checkout: checkout ? tilde(canon(checkout)) : null,
      ...(checkout && originOf(checkout) ? { origin: originOf(checkout) } : {}),
      ...(checkout && headRootOf(checkout) ? { root: headRootOf(checkout) } : {}),
      ...(checkout && gitIdOf(checkout) ? { git: gitIdOf(checkout) } : {}),
      home: tilde(home),
      registered: { by, at: new Date().toISOString() },
      ...(ephemeral ? { ephemeral: { why: ephemeral.why ?? '' } } : {}),
      ...extra,
    });
    writeRegistry(rows, next + 1);
    return { path: target, action: 'written', id, project: label, code: pc, beside };
  } finally {
    release();
  }
}

/*
 * A CHECKOUT THAT MOVED, KEEPING ONLY PERSONAL HOMES. With nothing committed
 * there is no home to match by place, so the project is matched by the label
 * this directory would be given, among rows whose checkout is gone - and only
 * where those rows name one old checkout, so nothing is guessed between two.
 * Their checkout is pointed here; the homes stay where they are, and every
 * ID, label and code is kept (locations.registry.ids-stay-here).
 *
 * @returns {{ from: string, ids: string[] } | null}
 */
export function repointMovedCheckout(checkout, named = null) {
  const target = registryPath();
  const release = lockConfig(target);
  try {
    const { rows, next, error } = readRegistry();
    if (error) return null;
    const now = canon(checkout);
    if (rows.some((r) => r.checkout && canon(expand(String(r.checkout))) === now)) return null;
    // The label it would be given, or the one the person names: a checkout
    // with no remote whose folder was renamed has nothing else to match by.
    const label = named ?? defaultLabel(now);
    /*
     * A project the person names is theirs to move, though its old path may
     * hold something new by now; one only guessed at must be gone.
     */
    const gone = rows.filter(
      (r) =>
        r.registered &&
        !r.ephemeral &&
        r.checkout &&
        String(r.project) === label &&
        resolve(expand(String(r.checkout))) !== now &&
        (named || !existsSync(resolve(expand(String(r.checkout))))),
    );
    const olds = [...new Set(gone.map((r) => resolve(expand(String(r.checkout)))))];
    if (olds.length !== 1) return null;
    for (const r of gone) rebaseRow(r, olds[0], now);
    writeRegistry(rows, next);
    return { from: olds[0], ids: gone.map((r) => String(r.id)) };
  } finally {
    release();
  }
}

/*
 * A row following its checkout to a new path: the checkout, the home when it
 * sits inside, and any kind of record a `records move` put inside it too - a
 * runs folder the move left behind at the old path was a ledger read from
 * nowhere (locations.registry.ids-stay-here).
 */
function rebaseRow(r, from, now) {
  r.checkout = tilde(now);
  // The row learns the remote it moved under, so the next move of the same
  // checkout is not asked for --project again (n-0547).
  const origin = originOf(now);
  if (origin) r.origin = origin;
  // And where its history starts now: a move made with --project after the
  // history was rewritten is not refused the next time (n-0548).
  const root = headRootOf(now);
  if (root) r.root = root;
  const git = gitIdOf(now);
  if (git) r.git = git;
  for (const key of ['home', ...KINDS]) {
    if (typeof r[key] !== 'string') continue;
    const rest = inside(expand(r[key]), from);
    if (rest !== null) r[key] = tilde(join(now, rest));
  }
}

/*
 * Where `p` sits under `root`, or null: by real names, and ignoring case where
 * the disk does - `records move --to /tmp/x/app/runs` and `.../App/runs` are
 * both folders inside `/private/tmp/x/App`, and a move must carry either.
 */
const FOLDS = process.platform === 'darwin' || process.platform === 'win32';
function inside(p, root) {
  const P = canon(p);
  const R = canon(root);
  const fold = (x) => (FOLDS ? x.toLowerCase() : x);
  if (fold(P) === fold(R)) return '';
  return fold(P).startsWith(fold(R) + sep) ? P.slice(R.length + 1) : null;
}

/*
 * A checkout moved, with its origin cloned again where it stood: both trees
 * hold the committed homes, and the clone at the old path is the one the
 * rows name. The records git ignores tell them apart - a fresh clone has no
 * runs, evidence or drafts (or threads it keeps out of git), the moved original still has them - so when this
 * tree holds any a home keeps and the registered checkout holds none, the
 * rows follow the records here and keep their IDs. A kind its row moved
 * elsewhere tells nothing, and is not asked (locations.registry.ids-stay-here).
 */
export function reclaimFromClone(tree, from) {
  const release = lockConfig(registryPath());
  try {
    const { rows, next, error } = readRegistry();
    if (error) return null;
    const old = canon(from);
    const now = canon(tree);
    const ours = rows.filter(
      (r) =>
        r?.registered && !r.ephemeral && r.checkout && canon(expand(String(r.checkout))) === old,
    );
    // Each kind where the row keeps it: in its home, or in a folder a
    // records move put inside the checkout. One kept outside tells nothing.
    const places = (r) =>
      KINDS.flatMap((k) => {
        const at = r[k] ? expand(String(r[k])) : r.home ? join(expand(String(r.home)), k) : null;
        const rest = at ? inside(at, old) : null;
        return rest === null ? [] : [{ was: join(old, rest), here: join(now, rest) }];
      });
    const has = (dir) => {
      try {
        return readdirSync(dir).some((f) => !f.startsWith('.'));
      } catch {
        return false;
      }
    };
    const moved = ours.some((r) => {
      const at = places(r);
      return at.length > 0 && !at.some((p) => has(p.was)) && at.some((p) => has(p.here));
    });
    if (!moved) return null;
    for (const r of ours) rebaseRow(r, old, now);
    writeRegistry(rows, next);
    return { from: old, ids: ours.map((r) => String(r.id)) };
  } finally {
    release();
  }
}

/** The projects whose checkout is no longer where their rows say. */
export function goneCheckouts() {
  const { rows } = readRegistry();
  const out = new Map();
  for (const r of rows)
    if (
      r?.registered &&
      !r.ephemeral &&
      r.checkout &&
      r.project &&
      !existsSync(resolve(expand(String(r.checkout))))
    )
      out.set(String(r.project), String(r.checkout));
  return [...out].map(([label, checkout]) => ({ label, checkout }));
}

/** Take out of the registry every row whose home is this directory, or this id. */
export function forgetFromRegistry({ homeDir = null, id = null }) {
  const { rows, next, error } = readRegistry();
  if (error) throw new Error(`${registryPath()} does not parse (${error}) — fix it first.`);
  const keep = rows.filter((r) => {
    if (id !== null && String(r.id) === String(id)) return false;
    if (homeDir && r.home && canon(expand(String(r.home))) === canon(homeDir)) return false;
    return true;
  });
  if (keep.length === rows.length) return false;
  // The counter is kept: a number once given is never given again.
  writeRegistry(keep, next);
  return true;
}

/*
 * WHICH CHECKOUT A DIRECTORY BELONGS TO (ADR 0014 §10).
 *
 * Inside a registered checkout, that checkout. Otherwise a worktree of one:
 * git says they share a repository (Claude Code's worktrees, and Archon's
 * made from your checkout), or their `origin` remotes are the same (Archon's
 * own clones under ~/.archon/workspaces). A worktree is never a project of
 * its own; it answers as the checkout it is of, with its own tree beside.
 *
 * @returns {{ checkout: string, worktree: string | null, how: string } | null}
 */
/**
 * A linked git worktree's own checkout, asked of git rather than the
 * registry: a worktree of a checkout nobody has imported yet is still not a
 * project, and was registered as one (n-0543).
 * @returns {{ checkout: string, worktree: string, how: string, clone?: boolean } | null}
 */
export function linkedWorktree(dir) {
  const top = dir ? topOf(dir) : null;
  if (!top) return null;
  const own = gitAsk(top, ['rev-parse', '--absolute-git-dir']);
  const common = commonDirOf(top);
  if (!own || !common || canon(own) === common || basename(common) !== '.git') return null;
  const checkout = canon(dirname(common));
  if (checkout === top) return null;
  return { checkout, worktree: top, how: `a git worktree of ${tilde(checkout)}` };
}

export function checkoutFor(cwd, rows) {
  const here = canon(cwd);
  const checkouts = [
    ...new Set(
      rows
        .filter((r) => r?.registered && r.home && r.checkout && !r.ephemeral)
        .map((r) => canon(expand(String(r.checkout)))),
    ),
  ];
  const containing = checkouts.filter((c) => within(here, c));
  const top = checkouts.length ? topOf(here) : null;
  if (containing.length) {
    const deepest = containing.sort((a, b) => b.length - a.length)[0];
    /*
     * A worktree kept INSIDE its checkout - Claude Code's go under
     * `<repo>/.claude/worktrees/<name>` - stands within the checkout's folder
     * and is still a tree of its own: git's top level here is deeper than
     * the checkout, and shares its repository.
     */
    const nested = top && top !== deepest && within(top, deepest) && !checkouts.includes(top);
    if (nested && commonDirOf(here) && commonDirOf(here) === commonDirOf(deepest))
      return { checkout: deepest, worktree: top, how: `a git worktree of ${tilde(deepest)}` };
    /*
     * A repository of its own inside the checkout's folder - a vendored
     * project, a submodule - is not the checkout: its homes are its own,
     * and answering for them as the outer project files their threads in
     * another blueprint's ledger (n-0435).
     */
    if (!nested) return { checkout: deepest, worktree: null, how: `inside ${tilde(deepest)}` };
  }
  if (!checkouts.length) return null;
  if (!top) return null;
  const common = commonDirOf(here);
  for (const c of checkouts)
    if (common && commonDirOf(c) === common)
      return { checkout: c, worktree: top, how: `a git worktree of ${tilde(c)}` };
  const origin = originOf(top);
  if (origin)
    for (const c of checkouts)
      if (originOf(c) === origin)
        return {
          checkout: c,
          worktree: top,
          clone: true,
          how: `a clone of ${tilde(c)}'s origin (${origin})`,
        };
  return null;
}

/**
 * THE REGISTRY'S ANSWER for a directory (ADR 0003 §4, ADR 0014 §2). Named
 * outright: the row with that ID anywhere, or the one with that description
 * among the rows of the project standing here. Otherwise: the rows of the
 * checkout this directory is in, or a worktree of - one is the answer,
 * several a question. A scratch copy is never picked by standing somewhere.
 *
 * @param {string} cwd
 * @param {Record<string, any>[]} rows raw registry rows
 * @param {string | null} [want] a blueprint named outright
 * @returns {{ candidates: string[], picked: Record<string, any> | null, why: string,
 *   checkout: string | null, worktree: string | null, how: string | null }}
 */
export function registryPick(cwd, rows, want = null) {
  const registered = rows.filter((r) => r?.registered && r.home);
  const at = checkoutFor(cwd, registered) ?? homeProject(cwd, registered);
  const mine = at
    ? registered.filter(
        (r) => !r.ephemeral && r.checkout && canon(expand(String(r.checkout))) === at.checkout,
      )
    : [];
  const base = {
    checkout: at?.checkout ?? null,
    worktree: at?.worktree ?? null,
    how: at?.how ?? null,
  };
  /*
   * A home this checkout holds that nothing has imported: named, with the
   * command that registers it, whether it was stood in or asked for by name
   * (locations.answer.declared-not-discovered). It is never answered for.
   */
  const unimported = () => {
    // Outside every registered checkout, the repository standing here (n-0436).
    const own = at?.checkout ?? gitRoot(cwd);
    if (!own) return [];
    const listed = new Set(registered.map((r) => canon(expand(String(r.home)))));
    const trees = [at?.worktree, own].filter(Boolean);
    return trees.flatMap((t) =>
      findHomes(t)
        .homes.filter((h) => !listed.has(canon(join(own, relative(t, h.dir)))))
        .map((h) => ({ ...h, tree: t })),
    );
  };
  const toImport = (h) =>
    `${tilde(h.dir)} is a blueprint this machine has not imported — \`walkdown blueprints import ${tilde(h.dir)}\` registers it`;
  if (want) {
    const exact = registered.find((r) => String(r.id) === String(want));
    if (exact)
      return {
        ...base,
        candidates: [String(exact.id)],
        picked: exact,
        why: `registered as \`${exact.id}\``,
      };
    const named = mine.filter((r) => nameOf(r.id) === String(want));
    if (named.length === 1)
      return {
        ...base,
        candidates: [String(named[0].id)],
        picked: named[0],
        why: `\`${want}\` in ${tilde(at.checkout)}, registered as \`${named[0].id}\``,
      };
    if (named.length > 1)
      return {
        ...base,
        candidates: named.map((r) => String(r.id)),
        picked: null,
        why: `${named.length} blueprints in ${tilde(at.checkout)} are called \`${want}\` (${named.map((r) => r.id).join(', ')}) — choose one with --blueprint <id> (e.g. --blueprint ${named[0].id})`,
      };
    /*
     * The ID a row had before `walkdown upgrade` renumbered it, which upgrade
     * keeps on the row as `formerly:`. Typed anywhere, as an ID was, it still
     * answers - after a name in the project standing here, which is what a
     * bare word means there (n-0514) - `acme_main` became `0001-am-acme-main`, and every note
     * and script that typed the old one would otherwise break (n-0511).
     */
    const former = registered.filter((r) =>
      [r.formerly ?? []].flat().map(String).includes(String(want)),
    );
    if (former.length === 1)
      return {
        ...base,
        candidates: [String(former[0].id)],
        picked: former[0],
        why: `\`${want}\` is what \`${former[0].id}\` was called before \`walkdown upgrade\`; it is \`${former[0].id}\` now`,
      };
    const folder = unimported().find(
      (h) =>
        h.folder === String(want) ||
        basename(h.folder) === String(want) ||
        describeFolder(h.folder) === String(want) ||
        declaredName(h.dir) === slug(want),
    );
    if (folder) return { ...base, candidates: [], picked: null, why: toImport(folder) };
    /*
     * A name some project's blueprint has, asked for outside that project: it
     * is registered, and the true reason is that a bare name means a
     * blueprint of the project standing here (n-0437).
     */
    const elsewhere = registered.filter((r) => !r.ephemeral && nameOf(r.id) === String(want));
    if (elsewhere.length)
      return {
        ...base,
        candidates: [],
        picked: null,
        why: `a name alone means a blueprint of the project you are in, and ${at ? `${tilde(at.checkout)} has no \`${want}\`` : 'you are in no project'} — outside its project, name it by its ID: ${elsewhere.map((r) => `\`--blueprint ${r.id}\``).join(' or ')}`,
      };
    return { ...base, candidates: [], picked: null, why: `no registered blueprint \`${want}\`` };
  }
  // Standing inside one of the project's homes answers for that one.
  const here = canon(cwd);
  const inHome = mine.filter((r) => {
    const h = canon(expand(String(r.home)));
    return (
      within(here, h) || (at.worktree && within(here, join(at.worktree, relative(at.checkout, h))))
    );
  });
  if (inHome.length === 1 && mine.length > 1)
    return {
      ...base,
      candidates: [String(inHome[0].id)],
      picked: inHome[0],
      why: `inside \`${inHome[0].id}\`'s home, in ${tilde(at.checkout)}`,
    };
  const strayHere = unimported().find((h) => within(here, h.dir));
  if (strayHere) return { ...base, candidates: [], picked: null, why: toImport(strayHere) };
  if (!mine.length)
    return {
      ...base,
      candidates: [],
      picked: null,
      why: 'no registered project contains this directory',
    };
  if (mine.length === 1)
    return {
      ...base,
      candidates: [String(mine[0].id)],
      picked: mine[0],
      why: `registered project ${tilde(at.checkout)} — ${at.how}`,
    };
  return {
    ...base,
    candidates: mine.map((r) => String(r.id)),
    picked: null,
    why: `${mine.length} blueprints are registered for ${tilde(at.checkout)} (${mine
      .map((r) => nameOf(r.id))
      .join(', ')}) — choose one with --blueprint <id> (e.g. --blueprint ${nameOf(mine[0].id)})`,
  };
}

/*
 * A home kept outside its repository - in ~/.walkdown, the default - is
 * still its project's: standing in it answers as standing in the checkout
 * its row names (n-0489). Outside every home and checkout, nothing.
 */
function homeProject(cwd, registered) {
  const here = canon(cwd);
  const row = registered.find(
    (r) => !r.ephemeral && r.checkout && within(here, canon(expand(String(r.home)))),
  );
  return row
    ? {
        checkout: canon(expand(String(row.checkout))),
        worktree: null,
        how: `inside \`${row.id}\`'s home`,
      }
    : null;
}

/**
 * ` --blueprint <id>` for the blueprint kept at `dir`, for a hint that names
 * a command which writes into it (locations.several.writes-name-one). A home
 * nothing registered gets the placeholder.
 *
 * @param {string | null | undefined} dir
 */
export function blueprintFlag(dir) {
  if (!dir) return ' --blueprint <id>';
  const here = canon(dir);
  const row = readRegistry().rows.find(
    (r) => r?.registered && r.home && canon(expand(String(r.home))) === here,
  );
  return ` --blueprint ${row ? row.id : '<id>'}`;
}

/**
 * The IDs of every blueprint registered for the checkout `cwd` is in, or a
 * worktree of, in the order they were registered. What a refused write lists
 * (locations.several.writes-name-one): it never picks one of them.
 *
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function projectIdsAt(cwd = process.cwd()) {
  const registered = readRegistry().rows.filter((r) => r?.registered && r.home && !r.ephemeral);
  const at = checkoutFor(cwd, registered) ?? homeProject(cwd, registered);
  if (!at) return [];
  return registered
    .filter((r) => r.checkout && canon(expand(String(r.checkout))) === at.checkout)
    .map((r) => String(r.id));
}

/*
 * One spelling for one directory. A checkout reached through a symlink - and
 * on macOS everything under /var is - has two names, and a row naming
 * /var/x must still claim a process whose cwd reports /private/var/x.
 * Compared canonically, never stored canonically.
 */
export function canon(p) {
  try {
    // .native, for the name the disk keeps: on a disk that ignores case,
    // ~/shop and ~/Shop are one folder, and were registered twice (n-0541).
    return realpathSync.native(p);
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
  return d === r || d.startsWith(r + sep);
}

/**
 * Symlinks under `root` whose target lies outside it, as
 * `{ path, target, resolved }`.
 *
 * Reading through a link is harmless and supported: the panel serves a linked
 * screenshot, and a scratch copy shares the real evidence directory by linking
 * each entry into it (n-0193). A link pointing OUT is the one that costs
 * something, because the writers here write THROUGH it (n-0186's second half).
 *
 * Reported, never followed: a linked directory is named and not descended, so
 * a cycle is impossible and a door out of the tree is not a way to walk the
 * whole disk.
 */
export function escapingLinks(root) {
  const top = canon(root);
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
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
        continue;
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

/** A path as a person reads it: their own home shortened to `~`. */
export const tilde = (p) =>
  p && p.startsWith(homedir() + '/') ? '~' + p.slice(homedir().length) : p;

/**
 * A yaml file, or an empty one. A malformed file is reported rather than
 * thrown past: a file the person can fix should not stop them running the
 * command that would tell them it is broken.
 */
function readYamlFile(path) {
  if (!existsSync(path)) return { exists: false, config: {}, error: null };
  try {
    return { exists: true, config: parse(readFileSync(path, 'utf8')) ?? {}, error: null };
  } catch (e) {
    return { exists: true, config: {}, error: e.message };
  }
}

/**
 * WHAT IS LEFT OF THE LAYOUT BEFORE ADR 0014, and wants `walkdown upgrade`.
 * Asked, never acted on: the upgrade is the person's to run, and a command
 * that half-moved things on the way past is what the upgrade exists to stop.
 *
 * @returns {string[]} what is due, in words
 */
export function upgradeDue() {
  const due = [];
  if (existsSync(legacyConfigPath())) due.push(`${tilde(legacyConfigPath())} becomes profile.yml`);
  const { rows } = readRegistry();
  const old = rows.filter(
    (r) => r?.registered && r.home && (!('checkout' in r) || !isRegistryId(r.id)),
  );
  if (old.length)
    due.push(
      `${old.length} registry row(s) get an ID and a project (${old.map((r) => r.id).join(', ')})`,
    );
  const repos = new Set();
  for (const r of rows) {
    const dir = r?.home ? expand(String(r.home)) : null;
    if (dir && isOldHome(dir) && !isHome(dir))
      due.push(`${tilde(dir)} is flattened (blueprint/walkdown.yml becomes spec.yml)`);
    const c = r?.checkout ?? (r && !('checkout' in r) ? r.project : null);
    if (c) repos.add(expand(String(c)));
  }
  for (const repo of repos)
    if (existsSync(join(repo, '.walkdown', 'config.yml')))
      due.push(`${tilde(join(repo, '.walkdown', 'config.yml'))} is removed`);
  return due;
}

/**
 * The profile and the registry, as this machine keeps them.
 *
 * Two files, two authors. `profile.yml` is the person's: identity and
 * defaults, edited by hand, registering nothing. `registry.yml` is
 * walkdown's: every blueprint this machine knows about, and the only list
 * any reader consults. A row nothing wrote - no `registered:` - is set aside
 * and named, because the only path question walkdown asks is at add time.
 */
export function readUserConfig() {
  const path = profilePath();
  const personal = readYamlFile(path);
  const registry = readRegistry();
  const ignored = [];
  const setAside = (id, key, value, why) => ignored.push({ id, key, value: String(value), why });
  /*
   * Why a value in the profile is not a path it can resolve, or null when it
   * is one. Blank, and `~name` with no slash, used to pass as "not relative" -
   * a `defaults: { evidence: '  ' }` expanded to wherever the command ran
   * (n-0175).
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
  for (const key of ['blueprints', 'projects'])
    for (const p of personal.config[key] ?? [])
      setAside(
        p?.id ?? null,
        key,
        p?.id ?? '?',
        `${basename(path)} registers nothing — \`walkdown blueprints import <home>\` registers it, and this row can go`,
      );
  const defaults = { ...(personal.config.defaults ?? {}) };
  for (const [k, v] of Object.entries(defaults))
    if (!KINDS.includes(k)) {
      setAside(
        null,
        `defaults.${k}`,
        v,
        `a ${k} is never a default — the registry row names the home, and this line can go`,
      );
      delete defaults[k];
    } else if (stray(v)) {
      setAside(null, `defaults.${k}`, v, stray(v));
      delete defaults[k];
    }
  const rows = [];
  for (const r of registry.rows) {
    if (r?.registered && r.home) rows.push(r);
    else
      setAside(
        r?.id ?? null,
        'registry',
        r?.id ?? '?',
        r?.home
          ? 'written by hand — no `registered:` says how it arrived; `walkdown blueprints import <home>` registers it, and this row can go'
          : 'names no home — nothing to answer with; `walkdown blueprints import <home>` registers one',
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

/** What a blueprint calls itself, from its spec.yml. */
function declaredName(specDir) {
  try {
    const y = parse(readFileSync(join(specDir, SPEC_FILE), 'utf8'));
    return y?.blueprint ? slug(y.blueprint) : null;
  } catch {
    return null;
  }
}

/*
 * `records.yml` INFORMS AND THE REGISTRY DECIDES (ADR 0014 §5). The file says
 * where a blueprint's records usually live, relative to its home, for every
 * machine that has it; a registry row may say otherwise on this one.
 */
export function readRecordsFile(homeDir) {
  if (!homeDir) return {};
  const { config } = readYamlFile(join(homeDir, RECORDS_FILE));
  const out = {};
  for (const k of KINDS)
    if (typeof config?.[k] === 'string' && config[k].trim()) out[k] = expand(config[k], homeDir);
  return out;
}

/** What a home's own `.gitignore` keeps out of git, by kind. */
export function ignoredKinds(homeDir) {
  const file = homeDir ? join(homeDir, '.gitignore') : null;
  if (!file || !existsSync(file)) return null;
  const rules = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return {
    file,
    rules,
    kinds: KINDS.filter((k) => rules.some((r) => r.replace(/^\/|\/$/g, '') === HOME_LAYOUT[k])),
  };
}

/**
 * One resolved location: where, and the reason it was chosen there.
 * @typedef {{ path: string, why: string, missing?: boolean }} Location
 */

/**
 * Every path this project uses, each with the reason it was chosen.
 *
 * `overrides` pins a kind the way a flag on the command line does.
 *
 * @param {{ cwd?: string, blueprint?: string | null, spec?: string | null,
 *   overrides?: Record<string, string> }} [where]
 * @returns {{ id: string, name: string, home: string,
 *   walkdown: { path: string | null, why: string },
 *   blueprint: Record<string, any> | null, homeDir: string | null,
 *   worktree: { path: string, checkout: string, how: string, branch: string | null } | null,
 *   standard: { name: string, why: string, rules?: string[] } | null,
 *   ignore: string | null,
 *   ambiguous: boolean,
 *   upgrade: string[],
 *   config: { path: string, exists: boolean, error: string | null, matched: boolean,
 *     matchedIn: 'registry' | null,
 *     ignored: { id: string | null, key: string, value: string, why: string }[],
 *     registry: { path: string, exists: boolean, error: string | null, matched: boolean,
 *       registeredBy: string | null, candidates: string[], why?: string | null },
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
  const {
    path: cfgPath,
    exists: cfgExists,
    config,
    error: cfgError,
    registry: cfgRegistry,
    ignored: cfgIgnored,
  } = readUserConfig();
  const rows = readRegistry().rows;
  const defaults = config.defaults ?? {};
  const home = walkdownHome();
  const ignored = [...(cfgIgnored ?? [])];
  const live = rows.filter((r) => r?.registered && r.home);

  /*
   * WHICH BLUEPRINT (ADR 0003 §4). By ID or description when one was named;
   * by the spec path for the readers inside walkdown that hold a loaded
   * blueprint and need its records - which may be a worktree's copy of a
   * registered home; otherwise the registered rows of the checkout the
   * working directory is in. Nothing is found on disk: a directory no row
   * reaches is not a project, however much it looks like one.
   */
  let raw = null;
  let why = null;
  let ambiguous = false;
  let pick = null;
  let worktreeAt = null;
  if (at) {
    const want_ = canon(expand(at, cwd));
    raw = live.find((r) => canon(expand(String(r.home))) === want_) ?? null;
    if (!raw) {
      // A worktree's copy of a committed home answers as that home.
      const wt = checkoutFor(want_, live);
      if (wt?.worktree) {
        raw =
          live.find((r) => {
            if (!r.checkout) return false;
            const h = canon(expand(String(r.home)));
            const c = canon(expand(String(r.checkout)));
            return (
              c === wt.checkout &&
              within(h, c) &&
              canon(join(wt.worktree, relative(c, h))) === want_
            );
          }) ?? null;
        if (raw) worktreeAt = wt;
      }
    }
    if (!raw)
      why = `nothing registered at ${expand(at, cwd)} — every blueprint walkdown answers for is in the registry; \`walkdown blueprints import <home>\` registers one`;
  } else {
    pick = registryPick(cwd, rows, want);
    raw = pick.picked;
    if (raw && pick.worktree)
      worktreeAt = { checkout: pick.checkout, worktree: pick.worktree, how: pick.how };
    if (!raw) {
      ambiguous = pick.candidates.length > 1;
      why =
        ambiguous || /has not imported|name it by its ID/.test(pick.why)
          ? pick.why
          : want
            ? `no registered blueprint \`${want}\` — \`walkdown blueprints\` lists them`
            : unregisteredHere(cwd);
    }
  }
  const entry = raw ? registryEntry(raw) : null;
  const homeDir = entry?.homeDir ?? null;
  const upgrade = upgradeDue();

  /*
   * A WORKTREE (ADR 0014 §10). Its committed parts are its own: a home
   * committed in the checkout is read at the same place in the worktree, so
   * the branch's rule edits count. What git ignores stays where the registry
   * keeps it, because deleting a worktree must not take a ledger with it.
   */
  const committedHome = Boolean(entry?.checkout && homeDir && within(homeDir, entry.checkout));
  const worktree =
    worktreeAt && entry
      ? {
          path: worktreeAt.worktree,
          checkout: worktreeAt.checkout,
          how: worktreeAt.how ?? `a worktree of ${tilde(worktreeAt.checkout)}`,
          branch: gitAsk(worktreeAt.worktree, ['rev-parse', '--abbrev-ref', 'HEAD']),
        }
      : null;
  /*
   * The branch's copy, where the branch has one. A home committed after the
   * worktree was made is not on its branch yet, and the registered home is
   * the only one there is (locations.answer.says-why).
   */
  const branchCopy =
    worktree && committedHome ? join(worktree.path, relative(entry.checkout, homeDir)) : null;
  const branchHome = branchCopy && existsSync(join(branchCopy, SPEC_FILE)) ? branchCopy : null;

  // ---- the spec ------------------------------------------------------------
  let spec;
  if (entry) {
    spec = branchHome
      ? { path: branchHome, why: `this branch's copy, ${worktree.how} (${entry.id})` }
      : { path: entry.spec, why: `this machine's registry (${entry.id})` };
    spec.missing = !isHome(spec.path);
  } else spec = { path: null, why };

  const code = gitRoot(spec?.path ?? cwd) ?? gitRoot(cwd);
  const id = entry?.id ?? (spec.path && declaredName(spec.path)) ?? slug(basename(code ?? cwd));

  const fromDefault = (v) => {
    const raw_ = String(v);
    if (!raw_.includes('{id}')) return expand(raw_);
    return entry?.id ? expand(raw_.replace('{id}', nameOf(entry.id))) : null;
  };

  // ---- the records ---------------------------------------------------------
  const informed = readRecordsFile(branchHome ?? homeDir);
  const ignoredHere = ignoredKinds(branchHome ?? homeDir);
  const out = {};
  for (const kind of KINDS) {
    if (overrides[kind]) {
      out[kind] = { path: expand(overrides[kind], cwd), why: 'a flag on the command line' };
      continue;
    }
    if (entry?.[kind]) {
      out[kind] = {
        path: expand(entry[kind]),
        why: `this machine's registry (${entry.id}), which moved it here`,
      };
      continue;
    }
    if (!spec.path) {
      out[kind] = { path: null, why: 'nothing is registered for this directory' };
      continue;
    }
    /*
     * In a worktree, what git ignores is the registered home's - a run
     * filed in the worktree would go when the worktree does - and what is
     * committed follows the branch.
     */
    const shared = Boolean(branchHome) && Boolean(ignoredHere?.kinds.includes(kind));
    const base = branchHome && !shared ? branchHome : homeDir;
    const baseWhy = branchHome
      ? shared
        ? `the registered home's (${entry.id}) — git ignores ${kind}, so every worktree shares them`
        : `this branch's copy (${entry.id}) — ${kind} are committed, so they follow the checkout`
      : `the home this machine registered (${entry.id})`;
    if (informed[kind]) {
      const path = shared ? expand(relative(branchHome, informed[kind]), homeDir) : informed[kind];
      out[kind] = {
        path,
        why: shared
          ? `the blueprint's own ${RECORDS_FILE} (${entry.id}), read from the registered home's — git ignores ${kind}, so every worktree shares them`
          : `the blueprint's own ${RECORDS_FILE} (${entry.id})`,
      };
      continue;
    }
    if (defaults[kind]) {
      const at_ = fromDefault(defaults[kind]);
      if (at_) {
        out[kind] = { path: at_, why: 'the profile default' };
        continue;
      }
    }
    out[kind] = { path: homePaths(base)[kind], why: baseWhy };
  }
  const [runs, threads, evidence, drafts] = KINDS.map((k) => out[k]);

  /*
   * Where the CODE is. A worktree's own tree; else the row's checkout, the
   * one answer somebody wrote down, true from any directory and the only
   * thing that can answer for a spec kept outside the code; else the spec's
   * own repository.
   */
  const specRepo = spec?.path ? gitRoot(spec.path) : null;
  const entryRoot = worktree?.path ?? entry?.checkout ?? null;
  const codePath = entryRoot ?? specRepo ?? code;
  const codeRootPath = entryRoot ?? spec?.path ?? null;

  // The `.walkdown` the home sits in, read off the path.
  const homeAt = branchHome ?? homeDir;
  const wdRoot = (() => {
    if (!homeAt) return null;
    let d = dirname(homeAt);
    for (let i = 0; i < 16 && d !== dirname(d); i++, d = dirname(d))
      if (basename(d) === '.walkdown' || canon(d) === canon(home)) return d;
    return null;
  })();

  /*
   * WHAT VERSION CONTROL SEES, read off the tree rather than remembered
   * (n-0158). A personal home is never git's business; a home in a
   * repository is git's except for what its own `.gitignore` keeps out
   * (ADR 0014 §5); no `.gitignore` there means all of it.
   */
  const ignoreFile = homeAt ? join(homeAt, '.gitignore') : null;
  const standard = (() => {
    if (!entry || !homeAt) return null;
    if (within(homeAt, home))
      return { name: 'none', why: 'the home is in `~/.walkdown`, which git never sees' };
    if (!entry.checkout || !within(homeAt, worktree?.path ?? entry.checkout)) return null;
    if (!ignoredHere)
      return { name: 'all', why: `no .gitignore in ${homeAt} — everything there is git's` };
    return {
      name: 'spec',
      why: `${ignoredHere.file} keeps out ${ignoredHere.rules.join(', ') || 'nothing'} — delete it to commit everything`,
      rules: ignoredHere.rules,
    };
  })();

  return {
    id,
    name: entry ? entry.name : id,
    home,
    walkdown: wdRoot
      ? { path: wdRoot, why: 'the `.walkdown` the registered home sits in' }
      : {
          path: null,
          why: entry
            ? 'the home sits under no `.walkdown`'
            : 'nothing is registered for this directory',
        },
    blueprint: entry,
    homeDir,
    worktree,
    standard,
    ignore: ignoreFile,
    ambiguous,
    upgrade,
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
        candidates: ambiguous ? pick.candidates : [],
        why: pick?.why ?? null,
      },
      repo: null,
      refused: [],
    },
    code: codePath
      ? {
          path: codePath,
          why: worktree
            ? `${worktree.how}, on ${worktree.branch ?? 'a detached HEAD'}`
            : entryRoot
              ? "this machine's registry, which says which checkout the blueprint belongs to"
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
 * home nearby is the one path question asked here, and it is asked for the
 * message only: it names what `import` would register, never answers for it.
 */
function unregisteredHere(cwd) {
  const top = gitRoot(cwd);
  if (top) {
    const { homes } = findHomes(top);
    if (homes.length)
      return `nothing registered contains this directory — ${tilde(top)} holds ${homes.length === 1 ? 'a blueprint folder' : `${homes.length} blueprint folders`} (${homes
        .slice(0, 3)
        .map((h) => h.folder)
        .join(
          ', ',
        )}${homes.length > 3 ? ', …' : ''}); \`walkdown blueprints import ${tilde(top)}\` registers ${homes.length === 1 ? 'it' : 'them'}`;
    /*
     * A repository of its own inside a registered checkout - a submodule, a
     * vendored clone - is not that checkout (n-0435), and saying "nothing
     * registered contains this directory" there reads false (n-0438).
     */
    const here = canon(top);
    const outer = readRegistry()
      .rows.filter((r) => r?.registered && r.checkout && !r.ephemeral)
      .map((r) => canon(expand(String(r.checkout))))
      .find((c) => c !== here && within(here, c));
    if (outer)
      return `${tilde(top)} is a repository of its own inside ${tilde(outer)} — nothing registered belongs to it; \`walkdown blueprints new\` starts a blueprint for it, or run walkdown from ${tilde(outer)} for that project`;
  }
  return 'nothing registered contains this directory — `walkdown blueprints new` starts a blueprint here; `walkdown blueprints import <project>` registers one that exists';
}

/*
 * Can the choice be written down AT ALL - asked before anything moves. A
 * move that cannot be written down is a move that does not happen (n-0201,
 * n-0206): the precheck is the write's own test, `doc.errors`.
 */
export function canRemember(loc) {
  if (!loc.blueprint)
    throw new Error('nothing registered contains this directory — there is no row to write to');
  const path = registryPath();
  if (!existsSync(path)) {
    checkWritable(dirname(path));
    return;
  }
  let doc;
  try {
    doc = parseDocument(readFileSync(path, 'utf8'));
  } catch (e) {
    doc = { errors: [e] };
  }
  if (doc.errors?.length)
    throw new Error(
      `${path} cannot be written back (${String(doc.errors[0].message).split('\n')[0]}). ` +
        'The move is not made: a choice that cannot be written down is not a choice. Fix that file first.',
    );
  checkWritable(path);
}

function checkWritable(target) {
  try {
    accessSync(target, constants.W_OK);
  } catch {
    throw new Error(
      `${target} cannot be written. The move is not made: the records would end up somewhere nothing declares.`,
    );
  }
}

/*
 * A moved record kind, written on the blueprint's registry row (ADR 0003
 * §6): a fact about this disk, so the registry is where it lives. The row
 * is found by its ID; `records.yml` is never edited by a move.
 */
export function rememberLocation(loc, kind, to) {
  const entry = loc.blueprint;
  if (!entry)
    throw new Error('nothing registered contains this directory — there is no row to write to');
  const target = registryPath();
  mkdirSync(dirname(target), { recursive: true });
  const release = lockConfig(target);
  try {
    const { rows, next, error } = readRegistry();
    if (error)
      throw new Error(`${target} does not parse (${error}) — fix it first; nothing was written.`);
    const row = rows.find((r) => String(r.id) === String(entry.id));
    if (!row) throw new Error(`\`${entry.id}\` is not in ${target} any more — nothing was written`);
    row[kind] = tilde(to);
    writeRegistry(rows, next);
    return target;
  } finally {
    release();
  }
}
