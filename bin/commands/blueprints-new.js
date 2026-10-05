import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  canon,
  claimHome,
  within,
  expand,
  homePaths,
  lockConfig,
  readUserConfig,
  registryPath,
  rememberBlueprint,
  resolveLocations,
  walkdownHome,
} from '../../lib/locations.js';
import { gitView, relocateHome, removePointer, setIgnore, STANDARDS, tracking } from '../../lib/standard.js';
import { declaredIn } from './import.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';

/*
 * `walkdown blueprints new` and `walkdown blueprints commit` (ADR 0012): a
 * blueprint made for a project - and, with a standard, a blueprint's home
 * moved between the three arrangements version control can be in. Both were
 * `walkdown init` until ADR 0012 gave init to the machine alone.
 *
 * WHAT VERSION CONTROL SEES is not recorded anywhere; it is read off the tree
 * (lib/standard.js, n-0158). So this command's whole job with a standard is
 * to make the tree say it: put the home under the `.walkdown` the standard
 * needs, and write or delete the `.gitignore` beside it. Run with no
 * `--commit` on a project that exists, it keeps whatever the tree already
 * says, which is what makes it safe to run twice.
 */
/**
 * @param {{ id?: string | null, dir?: string | null, commit?: string | null, force?: boolean, verb: 'new' | 'commit' }} ask
 */
export async function make({ id = null, dir = null, commit: asked = null, force = false, verb }) {
  const values = { id: id ?? undefined, dir: dir ?? undefined, commit: asked ?? undefined, force };
  if (values.commit && !STANDARDS.includes(values.commit)) {
    console.error(`walkdown blueprints commit takes none, spec or all — not "${values.commit}".`);
    console.error('  none  the home lives in ~/.walkdown and the repository gets nothing (the default)');
    console.error('  spec  the home lives in .walkdown/; the spec and its threads are committed');
    console.error('  all   the same, and the runs and evidence are committed too');
    return process.exit(2);
  }
  const { scaffold } = await import('../../lib/init.js');
  const root = resolve(values.dir ?? process.cwd());

  /*
   * Already set up? Then keep the home it has. Allocating unconditionally is
   * how `init` run twice in one project minted a second home and a second
   * entry, with the second blueprint read by nothing while the command told
   * the person to go fill it in (n-0145). The test is the project ROOT,
   * because that is what a repeat `init` is about - and it is exact, never
   * containment, since a pack inside a listed repository is its own question
   * and not one a claim should answer quietly (n-0135).
   */
  /*
   * A config that does not parse is refused before anything is claimed. Read
   * as empty, an unreadable personal file made a listed project look
   * unlisted: `--commit spec` minted a second home in the repository beside
   * the person's real one, and `--commit none` moved the home and then died
   * on the write, leaving the tree declaring a home that had gone (n-0172).
   */
  const cfg = readUserConfig();
  for (const [file, error] of [
    [cfg.path, cfg.error],
    [cfg.registry?.path, cfg.registry?.error],
  ])
    if (error) {
      console.error(red(`${file} does not parse — ${error}`));
      console.error(dim('  Fix it first: this writes to it, and cannot tell what it already says.'));
      return process.exit(2);
    }
  /*
   * WHICH BLUEPRINT OF THE PROJECT'S (ADR 0011 §1). `init` is idempotent on
   * the project and the id, not the project alone: a project may hold
   * several blueprints, and `--id` names the one this run is about. With no
   * `--id` it means the id it would give the project anyway, the directory's
   * name - which, where the project has one blueprint, is that one whatever
   * it is called, exactly as before.
   */
  const rootedHere = () =>
    (readUserConfig().config.blueprints ?? []).filter(
      (p) => !p?.ephemeral && [p?.roots ?? []].flat().some((r) => r && canon(expand(r)) === canon(root)),
    );
  const wantId = values.id?.trim() || null;
  const defaultId = basename(root);
  const exact = () => {
    const here = rootedHere();
    if (wantId) return here.find((p) => String(p.id) === wantId);
    if (here.length <= 1) return here[0];
    return here.find((p) => String(p.id) === defaultId);
  };
  {
    const here = rootedHere();
    const ids = here.map((p) => String(p.id));
    if (wantId !== null && !/^[a-z0-9][a-z0-9._-]*$/i.test(wantId)) {
      console.error(red(`\`${values.id}\` is not an id — letters, digits, dots, dashes and underscores, starting with a letter or digit.`));
      return process.exit(2);
    }
    /*
     * An id is asked for by name, so one somebody else's project holds is
     * refused rather than suffixed: `--id billing` quietly becoming
     * `billing-2` is a blueprint nobody asked for, and every later
     * `--blueprint billing` reaches the wrong one.
     */
    if (wantId && !ids.includes(wantId)) {
      const elsewhere = (readUserConfig().config.blueprints ?? []).find((p) => String(p.id) === wantId);
      if (elsewhere) {
        const there = [elsewhere.roots ?? []].flat()[0];
        console.error(red(`\`${wantId}\` is already registered${there ? ` for ${there}` : ''} — choose another id.`));
        return process.exit(2);
      }
    }
    if (!wantId && here.length > 1) {
      if (!ids.includes(defaultId)) {
        console.error(red(`This project holds several blueprints (${ids.join(', ')}) and none is \`${defaultId}\`.`));
        console.error(
          dim(
            verb === 'commit'
              ? '  `--blueprint <id>` says which one to move.'
              : '  `walkdown blueprints new <id>` names a new one.',
          ),
        );
        return process.exit(2);
      }
      if (values.commit) {
        console.error(red(`This project holds several blueprints (${ids.join(', ')}); \`blueprints commit\` moves one.`));
        console.error(dim('  `--blueprint <id>` says which.'));
        return process.exit(2);
      }
    }
  }
  /*
   * A checkout that declares a blueprint the registry has not met - a fresh
   * clone, or this machine before ADR 0003 - is registered here rather than
   * set up a second time. The registry is the only door (ADR 0003), and
   * `init` is one of the three hands that write it: what the manifest
   * declares and what stands in the tree agree, so there is nothing to ask.
   */
  if (!exact()) {
    let declared = [];
    try {
      declared = declaredIn(root) ?? [];
    } catch (e) {
      console.error(red(e.message));
      return process.exit(2);
    }
    for (const b of declared) {
      const homeDir = resolve(b.spec, '..');
      if (!/\/\.walkdown\/blueprints\/\d{4}-[^/]+$/.test(homeDir) || !within(homeDir, root)) continue;
      rememberBlueprint({ id: b.id, root, homeDir, home: basename(homeDir), inRepo: false, by: 'init' });
    }
  }
  /*
   * An entry rooted here that resolves to NO spec - a row holding only a
   * port override, say, after its paths left with a relocation - is not a
   * project to build into, and it is not a reason to scaffold one in the
   * tree either: that printed "the spec did not land at null" under a fresh
   * blueprint at <repo>/blueprint/ outside any home, with exit 0 (n-0171,
   * n-0173). Say what the entry lacks, and stop.
   */
  const noSpec = (entry, at) =>
    console.error(
      red(
        `\`${entry.id}\` is listed at this directory but names no spec and no home — nothing to build into. ` +
          `Add \`spec:\` or \`home:\` to the entry, or \`walkdown blueprints forget ${entry.id}\` and run this again.`,
      ),
    ) ?? console.error(dim(`  the entry: ${at}`));
  let listed = exact();
  let loc = listed ? resolveLocations({ cwd: root, blueprint: listed.id }) : null;
  if (listed && !loc.spec.path) {
    noSpec(listed, loc.config.registry.path);
    return process.exit(2);
  }
  /*
   * A listed blueprint with no home has no tree to read a standard off and
   * nothing for one to be written against: `--commit spec` over it printed
   * success and changed nothing (n-0183). Every blueprint lives in a home
   * now, so an entry naming none is a hand edit, and the honest answer is
   * to refuse and say what the entry is missing.
   */
  if (listed && !loc.homeDir) {
    console.error(
      red(
        `\`${listed.id}\` is listed at this directory but names no home — its spec ${loc.spec.path} stands outside any numbered home, so there is no tree to set a standard on. ` +
          `\`walkdown blueprints forget ${listed.id}\`, copy the blueprint into a home \`walkdown blueprints new\` lays out, and list that.`,
      ),
    );
    return process.exit(2);
  }
  /*
   * A blueprint that already answers HERE, from a row rooted above this
   * directory. Two packs in one repository each answering for themselves is
   * deliberate, tested, and the reason the crossing guard exists - so this is
   * not a refusal. The finding was the SILENCE: `init` one directory too deep
   * printed a first-ever init, word for word, and the person got a working
   * second project instead of a correction. The two only diverge later, when
   * the outer one keeps its ledger and the inner one starts empty and
   * `walkdown where` answers with the inner one, correctly and confusingly
   * (n-0214). The neighbouring case - init twice at the SAME level - already
   * says the right kind of thing by reporting every file up to date.
   */
  const siblings = listed ? [] : rootedHere().map((p) => String(p.id));
  const answering = listed || siblings.length ? null : resolveLocations({ cwd: root });
  const outer = answering?.spec?.path ? answering : null;

  const current = loc?.standard?.name ?? null;
  const commit = values.commit ?? current ?? 'none';

  /*
   * A change of standard that crosses the line - into the repository, or
   * back out - is a home moving. It moves whole, and the declarations follow
   * it; only then is the ignore file the question.
   */
  let moved = null;
  if (listed && current && (current === 'none') !== (commit === 'none')) {
    try {
      moved = relocateHome({ loc, root, to: commit === 'none' ? 'personal' : 'repo' });
    } catch (e) {
      console.error(red(e.message));
      return process.exit(2);
    }
    listed = exact();
    loc = resolveLocations({ cwd: root, blueprint: listed.id });
    if (!loc.spec.path) {
      noSpec(listed, moved.config);
      return process.exit(2);
    }
  }
  /*
   * What git tracked under what just left - the home, and the declaration
   * files taken away with it. "Nothing was added to this repository" was
   * printed over eight files git now held as pending deletions (n-0179).
   * The index still lists a file whose working copy is gone, so git can be
   * asked after the move, about the old paths.
   */
  const leaving =
    moved && commit === 'none'
      ? [
          ...new Set(
            Object.values(
              gitView({ root, paths: { home: moved.from, ...Object.fromEntries(moved.gone.map((g, i) => [`gone${i}`, g])) } }).kinds,
            ).flatMap((v) => v.tracked),
          ),
        ]
      : [];

  /*
   * The home, decided FIRST and built into afterwards. This used to take the
   * spec path from one derivation and let the entry-writer pick another, and
   * the two disagreed in both directions (n-0141, n-0145). A project with no
   * home at all - a blueprint standing where it always stood, declared by
   * path - is scaffolded where it is and claims nothing.
   */
  const walkdown = commit === 'none' ? walkdownHome() : join(root, '.walkdown');
  /*
   * One init at a time against this config, taken BEFORE the home is claimed.
   *
   * Locking only the config write was not enough: the home is claimed and
   * scaffolded first, so a racer refused at the write had already made a home
   * with no row — the stranded home the refusal exists to prevent, now
   * produced by the refusal itself (measured while fixing n-0219). Held
   * across claim, scaffold and write, a refused init has made nothing at all.
   */
  const releaseConfig = lockConfig(
    commit === 'none' ? registryPath() : join(root, '.walkdown', 'config.yml'),
  );
  try {
    return await build();
  } finally {
    releaseConfig();
  }

  async function build() {
  const claim = listed
    ? { home: listed.home ? String(listed.home) : null, dir: loc.homeDir }
    : claimHome({ name: wantId ?? defaultId, walkdown });
  const specDir = listed ? loc.spec.path : homePaths(claim.dir).spec;
  // A second blueprint is named for its id, not for the project (ADR 0011).
  const results = scaffold(root, { force: values.force, specDir, commit, name: listed ? null : wantId, skills: false });
  /*
   * And write it down. Walkdown does not find blueprints by looking, so a
   * spec nobody declared is a directory rather than a project - init would
   * otherwise hand somebody a blueprint that `walkdown status` denies the
   * existence of. This is also why there is no adopt command: the entry is
   * written where it belongs, and a clone reads it from the repository.
   */
  const entry = listed
    ? { path: null, action: 'kept', id: listed.id }
    : rememberBlueprint({
        id: wantId ?? defaultId,
        root,
        homeDir: claim.dir,
        home: claim.home,
        inRepo: commit !== 'none',
        by: 'init',
      });
  /*
   * A committed home is written down twice, on purpose: the manifest says
   * what the checkout declares, for every machine that clones it, and the
   * registry says this machine knows it (ADR 0003 §3). Only the registry is
   * read; the manifest is what `walkdown import` reads on the next machine.
   */
  const registered =
    commit !== 'none' && !listed
      ? rememberBlueprint({ id: entry.id, root, homeDir: claim.dir, home: claim.home, inRepo: false, by: 'init' })
      : null;
  const ignore =
    commit === 'none' || !claim.dir
      ? null
      : setIgnore(walkdown, commit, { force: values.force, shared: otherHomes(walkdown, claim.dir) });
  /*
   * Leaving the repository takes the pointer with it - unless another
   * blueprint of this project is still there, when the pointer is that
   * one's too, and is rewritten below rather than removed (ADR 0013 §4).
   */
  if (commit === 'none' && moved && rootedHere().length <= 1) {
    for (const rel of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', 'CONVENTIONS.md']) {
      // Said apart, because they are different things to have done to a
      // person's file: one gives the block back, the other takes the whole
      // file away - which walkdown may only do because it made it.
      const what = removePointer(join(root, rel));
      if (what === 'removed') results.push({ path: rel, action: 'pointer-removed' });
      else if (what === 'deleted') results.push({ path: rel, action: 'pointer-file-deleted' });
    }
    /*
     * The skills stay. They used to leave with the spec, because init had put
     * them in the repository and the "repository gets nothing" line would
     * otherwise lie (n-0166) - but init no longer puts them there at all
     * (n-0239), so a copy in `.claude/skills` is now one somebody asked for
     * with `walkdown skills --project`. Deleting that on the way out would be
     * walkdown taking away a decision it did not make.
     */
  }
  /*
   * Who is sitting here, and the skills, are the machine's business now:
   * `walkdown init` sets both up (ADR 0012 §1). A machine that never ran it
   * still gets its blueprint, and is told where the rest comes from.
   */
  const unready = !readUserConfig().config?.identity;

  const MARK = {
    created: green('+ created'),
    updated: green('~ updated'),
    'pointer-appended': green('+ appended'),
    'pointer-updated': green('~ pointer updated'),
    'pointer-removed': green('- pointer removed'),
    'pointer-file-deleted': green('- removed (walkdown made this file)'),
    'skill-removed': green('- removed'),
    'pointer-undecided': yellow('? several agent files — `walkdown pointer --into <file>`'),
    'up-to-date': dim('· up to date'),
    kept: dim('· kept'),
    'kept-differs': yellow('! kept (differs from packaged — --force to update)'),
  };
  const summary = (r) => r.action.startsWith('spec-');
  const placed = results.filter((r) => r.action.startsWith('spec-'));
  if (moved) {
    console.log(`  ${green('→ moved')}    ${moved.from}`);
    console.log(`  ${''.padEnd(10)} ${dim(`to ${moved.to} — the whole home, no record edited`)}`);
    for (const g of moved.gone) console.log(`  ${green('- removed')}  ${g}`);
  }
  for (const r of results.filter((r) => !summary(r)))
    console.log(`  ${MARK[r.action] ?? r.action}  ${r.path}${r.target ? dim(` → ${r.target}`) : ''}`);
  if (ignore) {
    const IGN = {
      written: green('+ written'),
      'up-to-date': dim('· up to date'),
      removed: green('- removed'),
      absent: null,
      'kept-differs': yellow('! kept (yours differs from the spec standard — --force to rewrite)'),
      'kept-shared': yellow(`! kept (it rules ${ignore.shared?.join(', ')} too — --force to change it for every one)`),
    };
    if (IGN[ignore.action]) console.log(`  ${IGN[ignore.action]}  ${ignore.path}`);
  }

  /*
   * Say where it went, always. A tool that quietly puts a project's spec
   * somewhere the person did not look for it has not been polite, it has been
   * confusing - and half of what the setup wizard exists to do is this
   * sentence.
   */
  if (entry.action === 'written')
    console.log(`  ${green('+ listed')}   ${entry.path}  ${dim(`as \`${entry.id}\``)}`);
  /*
   * A pointer block already in an agent file names every blueprint once
   * there are several (ADR 0013 §4) - the scaffold above wrote this one's,
   * and left alone it would name only the newest.
   */
  if (rootedHere().length > 1) {
    const { placePointer, pointerBlock, pointerHomes, pointerTargets, POINTER_BEGIN } = await import('../../lib/init.js');
    for (const rel of pointerHomes(root)) {
      const file = join(root, rel);
      if (!readFileSync(file, 'utf8').includes(POINTER_BEGIN)) continue;
      const action = placePointer(file, pointerBlock(pointerTargets(root, dirname(file))));
      if (action === 'pointer-updated') console.log(`  ${green('~ pointer')}  ${rel}  ${dim('names every blueprint in this project')}`);
    }
  }
  /*
   * Another blueprint for a project that has one is said as that, with the
   * others named: a mistyped `--id` is a second blueprint nobody meant, and
   * the moment to notice is now (ADR 0011 §1).
   */
  if (siblings.length)
    console.log(
      `  ${green('+ another')}  ${dim(`\`${entry.id}\` is another blueprint for this project, beside ${siblings.map((i) => `\`${i}\``).join(', ')} — commands that write take \`--blueprint <id>\` now`)}`,
    );
  // The registry write is the one that folds a config.yml row in, and with
  // the spec committed that is the second write, not the one reported above.
  const fold =
    ('folded' in entry ? entry.folded : null) ??
    (registered && 'folded' in registered ? registered.folded : null);
  if (fold) {
    const took = Object.keys(fold.values);
    console.log(
      `  ${green('~ folded')}   ${fold.path}  ${dim(
        `took \`${fold.id || '?'}\` out of \`${fold.from}:\`${took.length ? ` and kept its ${took.join(', ')}` : ''} — that file registers nothing now`,
      )}`,
    );
  }
  else if (moved)
    console.log(`  ${green('~ listed')}   ${moved.config}  ${dim(`as \`${moved.id}\``)}`);
  if (unready)
    console.log(`  ${yellow('? you')}      this machine is not set up — \`walkdown init\` says who you are and installs the skills`);

  const where = placed[0];
  if (where) {
    console.log(`\n  spec: ${where.path}`);
    const say = {
      none:
        '  In ~/.walkdown, which git never sees. Nothing was added to this repository,' +
        ' not even a pointer — `walkdown pointer --into CLAUDE.md` adds one for agents.' +
        '\n  Prefer it committed? `walkdown blueprints commit spec` moves the home into the repository.',
      spec:
        '  Committed: the spec and its threads, so a rule change arrives as a diff somebody' +
        ' approves and a clone is a working project. .walkdown/.gitignore is the standard —' +
        '\n  delete it to commit everything, or `walkdown blueprints commit none` moves the home back out.',
      all:
        '  Committed in full, says the tree: no .gitignore under .walkdown/, so everything there is' +
        " git's — and git keeps every version of every screenshot forever." +
        '\n  `walkdown blueprints commit spec` writes the ignore file back.',
    };
    // With several, the hint names this one: a bare `--commit` is refused.
    const idFlag = rootedHere().length > 1 ? ` --blueprint ${entry.id ?? listed?.id}` : '';
    // Among several, the pointer is the project's and names this one too.
    const said = ignore?.action?.startsWith('kept')
      ? `  Committed, by the .gitignore already under .walkdown/ — it decides for every blueprint there, and was left as it is.`
      : idFlag
      ? say[commit].replace(' Nothing was added to this repository, not even a pointer — `walkdown pointer --into CLAUDE.md` adds one for agents.', '')
      : say[commit];
    console.log(dim(said.replace(/`walkdown blueprints commit (\w+)`/g, (_, std) => `\`walkdown blueprints commit ${std}${idFlag}\``)));
    /*
     * What git tracks NOW, asked of git rather than asserted from the file
     * just written. An ignore file rules only what git has not met: a run
     * committed under `all` stays in the index after `--commit spec` writes
     * the file, and this command said "keeps runs, evidence and drafts out"
     * over a tree where they were in (n-0164); a root `.gitignore` hiding
     * `.walkdown/` made "Committed" a lie (n-0180). So the sentence is git's,
     * and where git and the tree disagree it is said here in colour and lint
     * refuses it.
     */
    const after = resolveLocations({ cwd: root, blueprint: entry.id ?? listed?.id });
    const t = tracking(after);
    console.log(`  tracked: ${t.words}  ${dim(t.why)}`);
    for (const f of t.findings)
      console.log(`  ${f.level === 'error' ? red(`✗ ${f.message}`) : yellow(`! ${f.message}`)}`);
    if (leaving.length)
      console.log(
        yellow(
          `  ${leaving.length} file(s) git tracked under the .walkdown that left are now deletions to commit — git keeps` +
            ` their history, and walkdown never touches the index.\n    ${leaving.slice(0, 3).join('\n    ')}${leaving.length > 3 ? `\n    … ${leaving.length - 3} more` : ''}`,
        ),
      );
  }
  if (outer) {
    const who = outer.blueprint?.id ?? outer.spec.path;
    console.log(yellow(`\n  note: \`${who}\` already answers for this directory.`));
    console.log(dim(`  its spec ${outer.spec.path}`));
    console.log(
      dim(
        '  You now have two blueprints, each with its own ledger — which is on purpose when this\n' +
          '  directory is its own pack, and a directory too deep when it is not. To use the one\n' +
          `  that was already here instead: \`walkdown blueprints forget\` the new entry, and stand\n  where \`${who}\` is rooted.`,
      ),
    );
  }
  if (results.some((r) => r.action === 'created' && !r.path.includes('SKILL.md'))) {
    const cfg = join(where?.path ?? 'blueprint', 'walkdown.yml');
    console.log(`\nNext: fill in ${dim(cfg)} (runner commands, targets), sketch your`);
    console.log(`first feature from its ${dim('features/_template.yml')}, then \`walkdown lint\`.`);
    console.log(dim('`walkdown where` shows every path this project uses.'));
  }
  if (!existsSync(specDir)) console.error(red(`  the spec did not land at ${specDir}`));
}
}

/* The other blueprints' homes under this `.walkdown/`, by directory name. */
function otherHomes(walkdown, mine) {
  const dir = join(walkdown, 'blueprints');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && resolve(dir, d.name) !== resolve(mine))
    .map((d) => d.name);
}
