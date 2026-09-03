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
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseDocument } from '../vendor/yaml.js';
import { POINTER_BEGIN, POINTER_END } from './init.js';
import {
  canon,
  claimHome,
  configPath,
  expand,
  HOME_LAYOUT,
  KINDS,
  rememberProject,
  walkdownHome,
  within,
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
function dropPaths(file, { spec, base, home }) {
  if (!existsSync(file)) return false;
  const doc = parseDocument(readFileSync(file, 'utf8'));
  const projects = doc.get('projects');
  const items = projects?.items ?? [];
  const i = items.findIndex(
    (it) => String(it.get?.('spec') ?? '') && canon(expand(String(it.get('spec')), base)) === canon(spec),
  );
  if (i < 0) return false;
  const item = items[i];
  /*
   * Only the paths that pointed INTO the home that moved. A record kind the
   * person had already moved elsewhere - `evidence: ~/my-evidence` - is a
   * decision about this disk, not part of the home, and dropping it with
   * the rest left those screenshots named by nothing (n-0173, F2). It
   * stays, and merges over the receiving entry as the override it is.
   */
  for (const k of PATH_KEYS) {
    if (!item.has(k)) continue;
    const v = k === 'home' ? null : expand(String(item.get(k)), base);
    if (k === 'spec' || k === 'home' || !home || (v && within(v, home))) item.delete(k);
  }
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
  /*
   * Both config files are read BEFORE the directory moves. A file that
   * cannot be written back used to be discovered after the move, which left
   * the tree declaring a home that had gone (n-0172); a move that cannot be
   * written down is a move that does not happen.
   */
  for (const file of [configPath(), join(root, '.walkdown', 'config.yml')]) {
    if (!existsSync(file)) continue;
    const errors = parseDocument(readFileSync(file, 'utf8')).errors;
    if (errors.length)
      throw new Error(`${file} does not parse (${errors[0].message.split('\n')[0]}) — fix it first; nothing was moved.`);
  }
  const claim = claimHome({ name: String(entry.home ?? basename(from)).replace(/^\d{4}-/, ''), walkdown: receiving });
  rmSync(claim.dir, { recursive: true, force: true }); // the claim made it; the move fills it
  moveDir(from, claim.dir);

  /*
   * A record kind the person had already moved OUTSIDE the home - `move
   * evidence --to ~/my-evidence` - is their decision, not part of the home,
   * and the personal row is written INTO on the way back out (rememberProject).
   * Named here so the write keeps it; a committed file cannot carry a path
   * outside its repository, and there the personal row keeps it as the
   * override it already is (dropPaths leaves it alone).
   */
  const kept =
    to === 'repo'
      ? {}
      : Object.fromEntries(
          KINDS.filter((k) => loc[k]?.path && !within(loc[k].path, from)).map((k) => [k, loc[k].path]),
        );
  const written = rememberProject({
    id: String(entry.id),
    root,
    homeDir: claim.dir,
    home: claim.home,
    inRepo: to === 'repo',
    records: kept,
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
    dropPaths(configPath(), { spec: join(from, HOME_LAYOUT.spec), base: walkdownHome(), home: from });
  } else {
    const repoCfg = join(root, '.walkdown', 'config.yml');
    dropPaths(repoCfg, { spec: join(from, HOME_LAYOUT.spec), base: root, home: from });
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

/* git, asked quietly: stdout or a throw, never a word on stderr. */
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * What git sees of a project's files, asked of git itself - the only thing
 * that knows.
 *
 * The ignore file walkdown writes is a promise; git's answer is the fact,
 * and the two part company in ways no reading of the ignore file can see: a
 * root `.gitignore` that hides `.walkdown/` entirely (n-0180), a rule that
 * does not reach a home standing elsewhere in the tree (n-0181), an ignore
 * file somebody emptied, a run committed before the rule was written
 * (n-0164). So every kind is asked about at the path the resolver actually
 * answered with: is it tracked, and would a new file there be ignored, and
 * by which rule in which file.
 *
 * @param {{ root: string, paths: Record<string, string | null | undefined> }} q
 * @returns {{ repo: boolean, top?: string, kinds: Record<string, {
 *   path: string, inside: boolean, tracked: string[],
 *   ignored: { file: string, line: number, pattern: string } | null }> }}
 */
export function gitView({ root, paths }) {
  let top;
  try {
    top = canon(git(root, ['rev-parse', '--show-toplevel']).trim());
  } catch {
    return { repo: false, kinds: {} };
  }
  const kinds = {};
  for (const [kind, path] of Object.entries(paths)) {
    if (!path) continue;
    const at = canon(path);
    if (!within(at, top)) {
      kinds[kind] = { path, inside: false, tracked: [], ignored: null };
      continue;
    }
    const rel = relative(top, at);
    let tracked = [];
    try {
      tracked = git(top, ['ls-files', '-z', '--', rel]).split('\0').filter(Boolean);
    } catch {
      /* nothing tracked, or nothing to ask */
    }
    /*
     * Asked about a file that does not exist under the directory, so the
     * answer is "would a new record here be ignored" - which is the question,
     * and one a directory pattern like `blueprints/*\/runs/` answers whether
     * or not the directory exists yet. A negated pattern is a match too, and
     * it means the opposite.
     */
    let ignored = null;
    try {
      const m = git(top, ['check-ignore', '-v', '--', join(rel, '.probe')]).match(/^(.*?):(\d+):(.*?)\t/);
      if (m && !m[3].startsWith('!')) ignored = { file: m[1], line: Number(m[2]), pattern: m[3] };
    } catch {
      /* exit 1: not ignored */
    }
    kinds[kind] = { path, inside: true, tracked, ignored };
  }
  return { repo: true, top, kinds };
}

/* Does an ignore rule speak about a record kind - `blueprints/*\/runs/`, `runs/`, `runs`? */
const names = (rule, dir) => {
  const r = rule.replace(/^!/, '').replace(/\/$/, '');
  return r === dir || r.endsWith('/' + dir);
};

/**
 * Git's answer set against the tree's promise, in words a person reads and
 * findings a linter refuses on.
 *
 * `words` is what git tracks now - the row `walkdown where` prints and the
 * sentence `init` closes with. `findings` are the places the two disagree,
 * which is what "the project is not configured the way it says" looks like:
 * a rule hiding the spec, a rule from some other file doing the ignoring,
 * a promise in the ignore file that git does not keep, an ignore file that
 * keeps nothing out. Each is an error, because a clone that gets no spec or
 * a repository that quietly commits screenshots is a broken setup, and the
 * one thing this tool is for is saying so. Records committed before a rule
 * was written are a warning: known, transitional, and yours to `git rm
 * --cached` (n-0164).
 *
 * @param {ReturnType<typeof import('./locations.js').resolveLocations>} loc
 * @returns {{ view: ReturnType<typeof gitView>, words: string, why: string,
 *   findings: { level: 'error' | 'warn', message: string }[] }}
 */
export function tracking(loc) {
  const root = loc.code?.path ?? null;
  const findings = [];
  const paths = Object.fromEntries(['spec', 'threads', 'runs', 'evidence', 'drafts'].map((k) => [k, loc[k]?.path]));
  const view = root && loc.project ? gitView({ root, paths }) : { repo: false, kinds: {} };
  if (!loc.project) return { view, words: '—', why: 'not a project', findings };
  if (!view.repo) return { view, words: 'nothing', why: `${root} is not a git repository — there is nothing to track`, findings };
  const top = view.top;
  const inside = Object.entries(view.kinds).filter(([, v]) => v.inside);
  if (!inside.length)
    return { view, words: 'nothing', why: 'every path is outside the repository, where git never looks', findings };
  const rel = (p) => relative(top, canon(p)) || '.';
  const cite = (v) => `${v.ignored.file}:${v.ignored.line} \`${v.ignored.pattern}\``;
  const hidden = inside.filter(([, v]) => v.ignored);
  const seen = inside.filter(([, v]) => !v.ignored).map(([k]) => k);
  const all = Object.keys(view.kinds);

  let words;
  if (view.kinds.spec?.ignored) words = `nothing — ${cite(view.kinds.spec)} hides the spec from git`;
  else if (!hidden.length) words = seen.length === all.length ? 'everything' : `${seen.join(', ')} — the rest is outside the repository`;
  else if (seen.slice().sort().join() === 'spec,threads') words = 'the spec and its threads';
  else words = seen.join(', ');
  const why = hidden.length
    ? `asked git: ${hidden.map(([k, v]) => `${k} is kept out by ${cite(v)}`).join('; ')}`
    : 'asked git: no rule keeps any of it out';

  /*
   * The promise: the ignore file beside the home, if there is one - the
   * file `--commit spec` writes and `--commit all` deletes. Anything git
   * does that this file did not ask for, or asks for that git does not do,
   * is a disagreement.
   */
  const own = loc.walkdown?.path ? join(loc.walkdown.path, '.gitignore') : null;
  const ownRel = own ? rel(own) : null;
  const rules = loc.standard?.name === 'spec' ? loc.standard.rules ?? [] : null;
  const byOwn = (v) => own && canon(resolve(top, v.ignored.file)) === canon(own);
  for (const [kind, v] of hidden) {
    if (kind === 'spec' || kind === 'threads')
      findings.push({
        level: 'error',
        message: `${cite(v)} hides ${rel(v.path)} from git — a clone will not get the ${kind}. Fix that rule, or move the home out of the repository with \`walkdown init --commit none\`.`,
      });
    else if (!byOwn(v))
      findings.push({
        level: 'error',
        message: rules
          ? `git keeps ${rel(v.path)} out by ${cite(v)}, not by ${ownRel} — the tree says the spec standard and something else is doing the ignoring. Make ${ownRel} the rule, or delete the other.`
          : `git keeps ${rel(v.path)} out by ${cite(v)} — the tree says everything is committed (no ${ownRel}) and git disagrees. Write the rule beside the home (\`walkdown init --commit spec\`) or delete that one.`,
      });
    if (v.tracked.length)
      findings.push({
        level: 'warn',
        message: `still tracked: ${v.tracked.length} file(s) under ${rel(v.path)}, committed before ${cite(v)} — the rule covers only what git has not met, and \`git rm --cached\` is yours to run; walkdown never touches the index (${v.tracked.slice(0, 3).join(', ')}${v.tracked.length > 3 ? ', …' : ''})`,
      });
  }
  if (rules) {
    if (!rules.length)
      findings.push({
        level: 'error',
        message: `${ownRel} is present and keeps nothing out — git will commit runs, evidence and drafts. \`walkdown init --commit spec --force\` writes it back, or delete it to commit everything on purpose.`,
      });
    for (const kind of KINDS) {
      const v = view.kinds[kind];
      if (!v?.inside || v.ignored) continue;
      const rule = rules.find((r) => names(r, HOME_LAYOUT[kind]));
      if (rule)
        findings.push({
          level: 'error',
          message: `${ownRel} says \`${rule}\`, but git does not keep ${rel(v.path)} out — the rule does not reach this home. Move the records under it (\`walkdown move\`), or write a rule that names them.`,
        });
    }
  }
  return { view, words, why, findings };
}
