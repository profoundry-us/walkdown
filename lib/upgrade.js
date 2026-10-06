/*
 * `walkdown upgrade`: walkdown's files, moved once from the layout before ADR
 * 0014 to the one after it (locations.keeping.upgrade-moves-once).
 *
 * A layout changes once, on purpose, when a person runs this - never a piece
 * at a time by whichever command happened to run first. Every other command
 * that finds the old layout says an upgrade is due and stops
 * (bin/commands/context.js). So this is the only writer that knows the old
 * shapes, and what it moves:
 *
 *   ~/.walkdown/config.yml                 becomes profile.yml
 *   registry rows                          get an ID, a project label and code
 *   <home>/blueprint/walkdown.yml          becomes <home>/spec.yml, the rest
 *                                          of blueprint/ moving up beside it
 *   each home                              gets records.yml, and a committed
 *                                          one its own .gitignore
 *   <repo>/.walkdown/config.yml, .gitignore    are removed
 *   ~/.walkdown/blueprints/<folder>        moves to ~/.walkdown/projects/
 *                                          <label>/blueprints/<folder>
 *   threads named n-0001.yml               get a UUID and are renamed to it,
 *                                          keeping their label
 *
 * Folder names are kept, every record is moved rather than rewritten, and
 * run again it finds nothing to do.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseDocument } from '../vendor/yaml.js';
import { placePointer, POINTER_BEGIN, POINTER_TEXT, pointerHomes, RECORDS_TEMPLATE } from './init.js';
import {
  canon,
  codeOf,
  deriveCode,
  defaultLabel,
  expand,
  findHomes,
  gitRoot,
  isHome,
  isOldHome,
  isRegistryId,
  KINDS,
  legacyConfigPath,
  lockConfig,
  numberOf,
  personalHomes,
  profilePath,
  readRegistry,
  RECORDS_FILE,
  registryPath,
  slug,
  SPEC_FILE,
  tilde,
  walkdownHome,
  writeRegistry,
} from './locations.js';
import { SPEC_IGNORE } from './standard.js';

const OLD_SPEC = 'walkdown.yml';
const OLD_DIR = 'blueprint';

/** Every old-layout home under a folder that holds homes, at any depth. */
function oldHomesUnder(top) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 8 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const at = join(dir, e.name);
      if (isOldHome(at)) out.push(at);
      else if (!isHome(at)) walk(at, depth + 1);
    }
  };
  walk(top, 0);
  return out;
}

/*
 * The repositories this machine knows: every registered row's checkout -
 * `project` was the checkout's path before ADR 0014 - and the one the
 * command is run in, registered or not, so a fresh clone of a project that
 * used walkdown can be upgraded before anything is imported from it.
 */
function repositories(rows, cwd) {
  const out = new Set();
  for (const r of rows) {
    const c = r?.checkout ?? (r && !('checkout' in r) && r.project && String(r.project).includes('/') ? r.project : null);
    if (c && existsSync(expand(String(c)))) out.add(canon(expand(String(c))));
  }
  // The nearest folder holding a .walkdown, up to the repository's top: a
  // project inside a repository (`example/`) has a .walkdown of its own.
  const top = cwd ? gitRoot(cwd) : null;
  for (let d = cwd ? canon(cwd) : null; d; d = dirname(d) === d ? null : dirname(d)) {
    if (existsSync(join(d, '.walkdown')) && canon(d) !== canon(dirname(walkdownHome()))) {
      out.add(canon(d));
      break;
    }
    if (top && canon(d) === canon(top)) break;
  }
  return [...out];
}

/*
 * A shared `.walkdown/.gitignore`, read as what each home keeps out of git:
 * `blueprints/*\/evidence/` says every home leaves its evidence out. Null
 * when there is none, which meant everything was committed.
 */
function sharedIgnore(repo) {
  const file = join(repo, '.walkdown', '.gitignore');
  if (!existsSync(file)) return null;
  const kinds = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.trim().match(/^\/?blueprints\/(?:\*|[^/]+)\/([a-z]+)\/?$/);
    if (m && KINDS.includes(m[1])) kinds.add(m[1]);
  }
  return { file, kinds: KINDS.filter((k) => kinds.has(k)) };
}

/** A home's own .gitignore for the kinds a shared one kept out. */
function homeIgnore(kinds) {
  const standard = ['runs', 'evidence', 'drafts'];
  if (kinds.length === standard.length && standard.every((k) => kinds.includes(k))) return SPEC_IGNORE;
  return [
    "# This blueprint's commit choice, carried over from the repository's old",
    '# .walkdown/.gitignore by `walkdown upgrade`: these stay out of git, and',
    '# everything else in this folder is committed.',
    ...kinds.map((k) => `${k}/`),
    '',
  ].join('\n');
}

/**
 * What the upgrade would do, without doing it.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {{ steps: { what: string, run: () => void }[], repos: string[] }}
 */
export function planUpgrade({ cwd = process.cwd() } = {}) {
  const steps = [];
  const step = (what, run) => steps.push({ what, run });
  const { rows } = readRegistry();
  const repos = repositories(rows, cwd);

  // ---- the profile ----------------------------------------------------------
  if (existsSync(legacyConfigPath()))
    step(`${tilde(legacyConfigPath())} becomes ${basename(profilePath())}`, () => {
      if (existsSync(profilePath()))
        throw new Error(`both ${tilde(legacyConfigPath())} and ${tilde(profilePath())} exist — keep one, then run the upgrade again`);
      renameSync(legacyConfigPath(), profilePath());
    });

  // ---- every home, flattened ------------------------------------------------
  const homes = new Set();
  for (const r of rows) if (r?.home) homes.add(canon(expand(String(r.home))));
  for (const repo of repos) for (const h of oldHomesUnder(join(repo, '.walkdown', 'blueprints'))) homes.add(canon(h));
  for (const h of oldHomesUnder(join(walkdownHome(), 'blueprints'))) homes.add(canon(h));
  for (const home of homes) {
    if (!isOldHome(home) || isHome(home)) continue;
    step(`${tilde(home)} is flattened: ${OLD_DIR}/${OLD_SPEC} becomes ${SPEC_FILE}`, () => flatten(home));
  }

  // ---- each home's records.yml, and a committed one's .gitignore -------------
  const ignoreFor = new Map();
  for (const repo of repos) {
    const shared = sharedIgnore(repo);
    for (const x of findHomes(repo).homes) {
      homes.add(canon(x.dir));
      if (shared?.kinds.length) ignoreFor.set(canon(x.dir), shared.kinds);
    }
  }
  for (const home of homes) {
    if (!isHome(home)) continue;
    const kinds = ignoreFor.get(home);
    const records = !existsSync(join(home, RECORDS_FILE));
    const ignore = kinds && !existsSync(join(home, '.gitignore'));
    if (records || ignore)
      step(`${tilde(home)} gets ${[records && RECORDS_FILE, ignore && 'its own .gitignore'].filter(Boolean).join(' and ')}`, () => {
        if (records) writeFileSync(join(home, RECORDS_FILE), RECORDS_TEMPLATE);
        if (ignore) writeFileSync(join(home, '.gitignore'), homeIgnore(kinds));
      });
    // The `*` a draft save used to write into drafts/ overruled the home's
    // own choice from inside it; the home's .gitignore says it now.
    const drafts = join(home, 'drafts', '.gitignore');
    if (existsSync(drafts) && readFileSync(drafts, 'utf8') === '*\n!.gitignore\n')
      step(`${tilde(drafts)}, which walkdown wrote, is removed`, () => unlinkSync(drafts));
  }
  for (const repo of repos) {
    for (const name of ['config.yml', '.gitignore']) {
      const file = join(repo, '.walkdown', name);
      if (existsSync(file))
        step(`${tilde(file)} is removed — the registry and each home's own files say what it said`, () => unlinkSync(file));
    }
    /*
     * The pointer names no blueprint now (ADR 0014 §7). A block from before
     * named them, and a name in committed text is wrong on every machine
     * but one.
     */
    for (const rel of pointerHomes(repo)) {
      const file = join(repo, rel);
      const text = readFileSync(file, 'utf8');
      if (text.includes(POINTER_BEGIN) && !text.includes(POINTER_TEXT))
        step(`${rel} in ${tilde(repo)}: the pointer is the fixed paragraph`, () => placePointer(file, POINTER_TEXT));
    }
  }

  // ---- the registry: IDs, labels, personal homes -----------------------------
  const due = rows.some((r) => r?.registered && r.home && (!('checkout' in r) || !isRegistryId(r.id)));
  const personalOld = rows.some((r) => r?.home && canon(expand(String(r.home))).startsWith(`${canon(join(walkdownHome(), 'blueprints'))}/`));
  if (due || personalOld)
    step('registry rows get IDs and project labels, and personal homes move under projects/', () => upgradeRegistry());

  // ---- threads: a UUID each ---------------------------------------------------
  const threadDirs = new Set();
  for (const h of homes) threadDirs.add(join(h, 'threads'));
  for (const dir of threadDirs) {
    const old = existsSync(dir) ? readdirSync(dir).filter((f) => /^[nq]-\d+\.ya?ml$/.test(f)) : [];
    if (old.length)
      step(`${old.length} thread(s) in ${tilde(dir)} get a UUID, and their files are renamed to it`, () => giveUuids(dir));
  }
  return { steps, repos };
}

/*
 * One home, flattened. Everything in `blueprint/` moves up a level and the
 * spec file is renamed. A name both levels hold is refused rather than
 * merged: nothing is overwritten by an upgrade.
 */
function flatten(home) {
  const inner = join(home, OLD_DIR);
  const names = readdirSync(inner);
  const clash = names.filter((n) => n !== OLD_SPEC && existsSync(join(home, n)));
  if (existsSync(join(home, SPEC_FILE))) clash.push(SPEC_FILE);
  if (clash.length) throw new Error(`${tilde(home)} already holds ${clash.join(', ')} beside ${OLD_DIR}/ — move them aside and run the upgrade again`);
  /*
   * A path in the spec written relative to `blueprint/` - `prototype.root:
   * ../sketches/` - names the same folder from one level up.
   */
  const specText = readFileSync(join(inner, OLD_SPEC), 'utf8');
  const doc = parseDocument(specText);
  const root = doc.getIn(['prototype', 'root']);
  let text = specText;
  if (typeof root === 'string' && root.startsWith('..') && existsSync(resolve(inner, root))) {
    const moved = relative(home, resolve(inner, root)) || '.';
    doc.setIn(['prototype', 'root'], moved.endsWith('/') ? moved : `${moved}/`);
    text = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  }
  for (const n of names) if (n !== OLD_SPEC) renameSync(join(inner, n), join(home, n));
  writeFileSync(join(home, SPEC_FILE), text);
  unlinkSync(join(inner, OLD_SPEC));
  rmdirSync(inner);
}

/*
 * Every thread named by its label gets a UUID, written beside the label,
 * and its file is renamed to the UUID. The label stays the thread's `id`:
 * a commit message citing n-0012 still finds it.
 */
function giveUuids(dir) {
  for (const f of readdirSync(dir)) {
    if (!/^[nq]-\d+\.ya?ml$/.test(f)) continue;
    const file = join(dir, f);
    let text = readFileSync(file, 'utf8');
    let uuid = text.match(/^uuid:\s*['"]?([0-9a-f-]{36})/m)?.[1];
    if (!uuid) {
      uuid = randomUUID();
      text = /^id:.*$/m.test(text) ? text.replace(/^(id:.*)$/m, `$1\nuuid: ${uuid}`) : `uuid: ${uuid}\n${text}`;
      writeFileSync(file, text);
    }
    const to = join(dir, `${uuid}.yml`);
    if (existsSync(to)) throw new Error(`${tilde(to)} already exists — ${f} was not renamed`);
    renameSync(file, to);
  }
}

/*
 * The registry, in the new shape. A row from before ADR 0014 carried its
 * checkout as `project` and a bare name as its `id`; now the label is the
 * project, the checkout has its own key, and the ID is `NNNN-pc-name` from
 * the registry's counter. A personal home moves under its project's label.
 */
function upgradeRegistry() {
  const release = lockConfig(registryPath());
  try {
    const { rows, next } = readRegistry();
    let n = next;
    const labels = new Map(); // checkout -> { label, code }
    for (const r of rows)
      if (r?.checkout && r.project && r.code) labels.set(canon(expand(String(r.checkout))), { label: r.project, code: r.code });
    const takenLabels = new Set([...labels.values()].map((v) => v.label));
    const takenCodes = new Set([...labels.values()].map((v) => v.code));
    const projectFor = (checkout) => {
      const key = checkout ? canon(expand(String(checkout))) : null;
      if (key && labels.has(key)) return labels.get(key);
      const base = checkout ? defaultLabel(key) : 'personal';
      let label = base;
      for (let k = 2; takenLabels.has(label); k++) label = `${base}-${k}`;
      let code = deriveCode(label);
      for (let k = 0; takenCodes.has(code); k++) code = `${code[0]}${k.toString(36)}`.slice(0, 3);
      takenLabels.add(label);
      takenCodes.add(code);
      const v = { label, code };
      if (key) labels.set(key, v);
      return v;
    };
    const out = rows.map((r) => {
      if (!r?.registered || !r.home) return r;
      let row = { ...r };
      if (!('checkout' in r) || !isRegistryId(r.id)) {
        const checkout = r.ephemeral ? null : (r.checkout ?? (r.project ? r.project : null));
        const { label, code } = r.ephemeral ? { label: null, code: 'tmp' } : projectFor(checkout);
        const num = numberOf(r.id) ?? n++;
        const name = slug(isRegistryId(r.id) ? String(r.id).replace(/^\d{4}-[a-z0-9]{2,3}-/, '') : String(r.id));
        const { project: _p, roots: _r, ...rest } = r;
        row = {
          ...rest,
          id: `${String(num).padStart(4, '0')}-${codeOf(r.id) ?? code}-${name}`,
          project: label,
          code: codeOf(r.id) ?? code,
          checkout: checkout ? tilde(canon(expand(String(checkout)))) : null,
          formerly: String(r.id),
        };
      }
      const home = canon(expand(String(row.home)));
      const oldPersonal = canon(join(walkdownHome(), 'blueprints'));
      if (home.startsWith(`${oldPersonal}/`) && row.project) {
        const to = join(personalHomes(row.project), relative(oldPersonal, home));
        if (existsSync(to)) throw new Error(`${tilde(to)} already exists — ${tilde(home)} was not moved`);
        mkdirSync(dirname(to), { recursive: true });
        renameSync(home, to);
        row.home = tilde(to);
      }
      return row;
    });
    writeRegistry(out, n);
    // An empty ~/.walkdown/blueprints/ is the old layout's last trace.
    const old = join(walkdownHome(), 'blueprints');
    if (existsSync(old) && !readdirSync(old).length) rmdirSync(old);
  } finally {
    release();
  }
}

/**
 * Run every step, in order, saying each as it lands.
 *
 * @param {{ cwd?: string, say?: (what: string) => void }} [opts]
 */
export function runUpgrade({ cwd = process.cwd(), say = () => {} } = {}) {
  /*
   * Planned again after each step, because a step changes what the next
   * one finds: flattening a home is what lets its records.yml be written.
   */
  const done = [];
  for (let guard = 0; guard < 64; guard++) {
    const { steps } = planUpgrade({ cwd });
    const next = steps.find((s) => !done.includes(s.what));
    if (!next) break;
    next.run();
    done.push(next.what);
    say(next.what);
  }
  return done;
}
