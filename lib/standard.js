/*
 * What version control sees of a project's home, and how that changes.
 *
 * There are three arrangements and no flag records which one is in force -
 * the tree does (locations.default.in-repo-on-request, n-0158):
 *
 *   none   the home is under `~/.walkdown/blueprints/`; the repository holds
 *          nothing of walkdown's, not a pointer, not a directory
 *   spec   the home is under `<repo>/.walkdown/blueprints/`, and a
 *          `.gitignore` beside it keeps runs, evidence and drafts out
 *   all    the same, with no `.gitignore` - everything is git's
 *
 * So changing your mind is a filesystem act: a home moves between the two
 * `.walkdown` directories, and a file is written or deleted. `walkdown init
 * --commit <standard>` does those acts and nothing cleverer, and `walkdown
 * where` answers by looking. Nothing here touches the git index: a file
 * already committed stays tracked until a person removes it, and walkdown
 * says so rather than doing it.
 */
import { cpSync, existsSync, readFileSync, renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseDocument } from '../vendor/yaml.js';
import { POINTER_BEGIN, POINTER_END } from './init.js';
import {
  claimHome,
  configPath,
  expand,
  HOME_LAYOUT,
  rememberProject,
  walkdownHome,
} from './locations.js';

export const STANDARDS = ['none', 'spec', 'all'];

/*
 * The spec standard, as the file that is the standard. Written as three
 * positive rules rather than "ignore everything, then re-include some of it":
 * git does not descend into an excluded directory, so a negation chain is
 * easy to get subtly wrong and a wrong one silently commits nothing or
 * everything. Ignoring only what is unwanted has no such failure mode - and
 * it leaves this file itself, and config.yml beside it, committable, which a
 * bare `*` did not (q-0162).
 */
export const SPEC_IGNORE = `# The spec and its conversations are committed; what a machine or one person
# produced is not. Runs are a build's verdicts, evidence is the screenshots
# behind them, and a draft is somebody's half-finished sitting.
#
# Delete this file to commit everything. \`walkdown init --commit spec\` writes
# it back; \`walkdown init --commit none\` moves the home out of the repository.
blueprints/*/${HOME_LAYOUT.runs}/
blueprints/*/${HOME_LAYOUT.evidence}/
blueprints/*/${HOME_LAYOUT.drafts}/
`;

/**
 * Make `<walkdown>/.gitignore` say what the standard says.
 *
 * `spec` writes the file; `all` deletes it, because a standard that is a file
 * is changed by the file going away. A file somebody has edited is theirs -
 * kept and reported unless forced, since an edited ignore list is a decision
 * (this repository's own is one).
 *
 * @returns {{ path: string, action: 'written' | 'up-to-date' | 'kept-differs' | 'removed' | 'absent' }}
 */
export function setIgnore(walkdown, standard, { force = false } = {}) {
  const path = join(walkdown, '.gitignore');
  if (standard === 'all') {
    if (!existsSync(path)) return { path, action: 'absent' };
    unlinkSync(path);
    return { path, action: 'removed' };
  }
  if (!existsSync(path)) {
    writeFileSync(path, SPEC_IGNORE);
    return { path, action: 'written' };
  }
  if (readFileSync(path, 'utf8') === SPEC_IGNORE) return { path, action: 'up-to-date' };
  if (!force) return { path, action: 'kept-differs' };
  writeFileSync(path, SPEC_IGNORE);
  return { path, action: 'written' };
}

/* A directory, moved whole - across volumes too, since `~` and a checkout
 * need not share one. */
function moveDir(from, to) {
  try {
    renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

const PATH_KEYS = ['spec', ...Object.keys(HOME_LAYOUT).filter((k) => k !== 'spec'), 'home'];

/*
 * Take a project's row out of one config, or only its paths.
 *
 * Whole when nothing else is in it; otherwise the path keys go and whatever
 * else the person wrote - targets, a port - stays, because the entry is theirs
 * once written and this is about where the home is, not about them.
 */
function dropPaths(file, { spec, base }) {
  if (!existsSync(file)) return false;
  const doc = parseDocument(readFileSync(file, 'utf8'));
  const projects = doc.get('projects');
  const items = projects?.items ?? [];
  const i = items.findIndex(
    (it) => String(it.get?.('spec') ?? '') && expand(String(it.get('spec')), base) === spec,
  );
  if (i < 0) return false;
  const item = items[i];
  for (const k of PATH_KEYS) if (item.has(k)) item.delete(k);
  const left = item.items.map((pair) => String(pair.key)).filter((k) => !['id', 'roots'].includes(k));
  if (!left.length) projects.delete(i);
  writeFileSync(file, String(doc));
  return true;
}

/*
 * The pointer, taken back out of an agent file - the fenced block only, and
 * the file itself when the block was all there was, since then walkdown made
 * it. Everything a person wrote around it stays exactly where it was.
 */
export function removePointer(file) {
  if (!existsSync(file)) return 'absent';
  const text = readFileSync(file, 'utf8');
  const from = text.indexOf(POINTER_BEGIN);
  if (from < 0) return 'absent';
  const to = text.indexOf(POINTER_END, from);
  if (to < 0) return 'kept';
  const rest = text.slice(0, from) + text.slice(to + POINTER_END.length + 1);
  if (!rest.trim()) {
    unlinkSync(file);
    return 'deleted';
  }
  writeFileSync(file, rest.replace(/\n{3,}$/, '\n\n'));
  return 'removed';
}

/**
 * Move a project's home between the personal `.walkdown` and the
 * repository's, and rewrite the declarations to match.
 *
 * The home moves as one directory - spec, threads, runs, evidence, drafts -
 * so no record is edited and none is left behind (the split n-0141 saw).
 * Numbering is claimed afresh in the receiving `.walkdown`, against ITS
 * listing, because `0002` there may already be somebody.
 *
 * @param {{ loc: ReturnType<typeof import('./locations.js').resolveLocations>,
 *   root: string, to: 'repo' | 'personal' }} move
 * @returns {{ id: string, from: string, to: string, home: string, config: string, gone: string[] }}
 */
export function relocateHome({ loc, root, to }) {
  const entry = loc.project;
  if (!entry || !loc.homeDir)
    throw new Error(
      `This project's blueprint sits at ${loc.spec.path}, outside any numbered home, and walkdown does not move it. Its commit standard is whatever your own .gitignore says.`,
    );
  const from = loc.homeDir;
  const receiving = to === 'repo' ? join(root, '.walkdown') : walkdownHome();
  const claim = claimHome({ name: String(entry.home ?? basename(from)).replace(/^\d{4}-/, ''), walkdown: receiving });
  rmSync(claim.dir, { recursive: true, force: true }); // the claim made it; the move fills it
  moveDir(from, claim.dir);

  const written = rememberProject({
    id: String(entry.id),
    root,
    homeDir: claim.dir,
    home: claim.home,
    inRepo: to === 'repo',
  });
  /*
   * The old declaration, gone - from the file that held it, matched by the
   * spec path it named, never by id. And the repository's `.walkdown`, when
   * it declares nothing any more, is taken away entirely: a directory left
   * standing is the thing `walkdownRoot` finds, and an empty one would keep
   * answering for a project that has left.
   */
  const gone = [];
  if (to === 'repo') {
    dropPaths(configPath(), { spec: join(from, HOME_LAYOUT.spec), base: walkdownHome() });
  } else {
    const repoCfg = join(root, '.walkdown', 'config.yml');
    dropPaths(repoCfg, { spec: join(from, HOME_LAYOUT.spec), base: root });
    const left = existsSync(repoCfg) ? parseDocument(readFileSync(repoCfg, 'utf8')).get('projects')?.items?.length : 0;
    if (!left) {
      for (const f of [repoCfg, join(root, '.walkdown', '.gitignore')])
        if (existsSync(f)) {
          unlinkSync(f);
          gone.push(f);
        }
      for (const d of [join(root, '.walkdown', 'blueprints'), join(root, '.walkdown')])
        try {
          rmdirSync(d);
          gone.push(d);
        } catch {
          /* not empty: somebody else's, left alone */
        }
    }
  }
  return { id: written.id, from, to: claim.dir, home: claim.home, config: written.path, gone };
}
