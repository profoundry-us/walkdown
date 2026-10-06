import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { basename, join, resolve } from 'node:path';
import {
  canon,
  checkoutFor,
  defaultLabel,
  deriveCode,
  describeFolder,
  expand,
  findHomes,
  isHome,
  isRegistryId,
  lockConfig,
  nameOf,
  personalHomes,
  projectOf,
  readRegistry,
  readUserConfig,
  register,
  registryPath,
  resolveLocations,
  slug,
  suggestFolder,
  tilde,
} from '../../lib/locations.js';
import { gitView, relocateHome, removePointer, setIgnore, STANDARDS, tracking } from '../../lib/standard.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';

/*
 * `walkdown blueprints new` and `walkdown blueprints commit` (ADR 0012, ADR
 * 0014): a blueprint made for a project - and, with a standard, a
 * blueprint's home moved between the arrangements version control can be in.
 *
 * WHAT VERSION CONTROL SEES is not recorded anywhere; it is read off the tree
 * (lib/standard.js, n-0158). So this command's whole job with a standard is
 * to make the tree say it: put the home where the standard needs it, and
 * write or delete the `.gitignore` inside it. Run with no `--commit` on a
 * blueprint that exists, it keeps whatever the tree already says, which is
 * what makes it safe to run twice.
 */

const NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * @param {{ id?: string | null, dir?: string | null, commit?: string | null, force?: boolean,
 *   verb: 'new' | 'commit', folder?: string | null, project?: string | null, code?: string | null }} ask
 */
export async function make({ id = null, dir = null, commit: asked = null, force = false, verb, folder = null, project = null, code = null }) {
  if (asked && !STANDARDS.includes(asked)) {
    console.error(`walkdown blueprints commit takes none, spec or all — not "${asked}".`);
    console.error('  none  the home lives in ~/.walkdown and the repository gets nothing (the default)');
    console.error('  spec  the home lives in .walkdown/blueprints/; the spec and its threads are committed');
    console.error('  all   the same, and the runs and evidence are committed too');
    return process.exit(2);
  }
  const { scaffold } = await import('../../lib/init.js');
  const root = canon(resolve(dir ?? process.cwd()));

  /*
   * A profile or registry that does not parse is refused before anything is
   * made. Read as empty, an unreadable file made a listed blueprint look
   * unlisted, and a second home was made beside the real one (n-0172).
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
   * WHICH CHECKOUT. A worktree of a registered checkout is that checkout's
   * project and is never registered itself (ADR 0014 §10): a blueprint made
   * there belongs to the project, and its home is made in the checkout's
   * place, not in a tree somebody will delete.
   */
  const live = () => readRegistry().rows.filter((r) => r?.registered && r.home);
  const wt = checkoutFor(root, live());
  const checkout = wt?.worktree ? wt.checkout : root;
  const mine = () =>
    live().filter((r) => !r.ephemeral && r.checkout && canon(expand(String(r.checkout))) === checkout);

  const wanted = id?.trim() || null;
  if (wanted !== null && !isRegistryId(wanted) && !NAME.test(wanted)) {
    console.error(red(`\`${id}\` is not a name — letters, digits, dots, dashes and underscores, starting with a letter or digit.`));
    return process.exit(2);
  }
  const defaultName = slug(basename(checkout));
  const want = wanted ? (isRegistryId(wanted) ? wanted : slug(wanted)) : null;

  /*
   * WHICH BLUEPRINT OF THE PROJECT'S (ADR 0011 §1). Idempotent on the project
   * and the name: with no name, the name it would give the project anyway -
   * which, where the project has one blueprint, is that one whatever it is
   * called.
   */
  const exact = () => {
    const here = mine();
    if (want) return here.find((r) => String(r.id) === want || nameOf(r.id) === want);
    if (here.length <= 1) return here[0];
    return here.find((r) => nameOf(r.id) === defaultName);
  };
  {
    const here = mine();
    const names = here.map((r) => nameOf(r.id));
    if (!want && here.length > 1 && !names.includes(defaultName)) {
      console.error(red(`This project holds several blueprints (${names.join(', ')}) and none is \`${defaultName}\`.`));
      console.error(
        dim(
          verb === 'commit'
            ? `  Choose one with \`--blueprint <id>\` (e.g. \`--blueprint ${names[0]}\`).`
            : '  `walkdown blueprints new <name>` names a new one.',
        ),
      );
      return process.exit(2);
    }
    if (!want && here.length > 1 && asked) {
      console.error(red(`This project holds several blueprints (${names.join(', ')}); \`blueprints commit\` moves one.`));
      console.error(dim(`  Choose one with \`--blueprint <id>\` (e.g. \`--blueprint ${names[0]}\`).`));
      return process.exit(2);
    }
  }

  /*
   * A checkout holding a committed home the registry has not met - a fresh
   * clone - is registered here rather than set up a second time, when it is
   * the one asked for. The folder declares itself; nothing is guessed.
   */
  let found = null;
  if (!exact()) {
    const asName = want && !isRegistryId(want) ? want : defaultName;
    const fresh = findHomes(checkout).homes.filter(
      (h) => describeFolder(h.folder) === asName && !live().some((r) => canon(expand(String(r.home))) === canon(h.dir)),
    );
    if (fresh.length === 1) found = fresh[0].dir;
  }
  if (verb === 'commit' && !exact() && !found) {
    console.error(red(want ? `No blueprint \`${want}\` in this project — \`walkdown blueprints\` lists them.` : 'No blueprint here to commit.'));
    console.error(dim('  `walkdown blueprints new` makes one.'));
    return process.exit(2);
  }

  /*
   * The project's label and code, decided before anything is made: a label
   * or code another project already has is the person's to change, and a
   * home made first would be a home with no row (ADR 0014 §3).
   */
  const label = await (async () => {
    const known = projectOf(checkout, readRegistry().rows);
    if (known) return known;
    const rows = live().filter((r) => r.project && !(r.checkout && canon(expand(String(r.checkout))) === checkout));
    let l = project ?? defaultLabel(checkout);
    let c = code ?? null;
    for (;;) {
      const labelTaken = rows.some((r) => String(r.project) === l);
      const pc = c ?? deriveCode(l);
      const codeTaken = rows.some((r) => String(r.code) === pc);
      if (!labelTaken && !codeTaken) return { label: l, code: pc, fresh: true };
      const what = labelTaken
        ? `the project label \`${l}\` is another checkout's (${tilde(String(rows.find((r) => String(r.project) === l).checkout))})`
        : `the project code \`${pc}\` is \`${rows.find((r) => String(r.code) === pc).project}\`'s`;
      if (!process.stdin.isTTY) {
        console.error(red(`✗ ${what}. Nothing was made.`));
        console.error(dim('  Choose another with `--project <label>` and `--code <two or three letters>`.'));
        return null;
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      console.log(yellow(`! ${what}.`));
      if (labelTaken) l = (await rl.question('  A label for this project: ')).trim() || l;
      else c = (await rl.question(`  A two- or three-letter code for \`${l}\`: `)).trim().toLowerCase() || c;
      rl.close();
    }
  })();
  if (!label) return process.exit(2);

  /*
   * One writer at a time against the registry, taken BEFORE the home is
   * made: a racer refused at the write would otherwise have made a home
   * with no row, the stranded home the refusal exists to prevent (n-0219).
   */
  const release = lockConfig(registryPath());
  try {
    return await build();
  } finally {
    release();
  }

  async function build() {
    let listed = exact() ?? null;
    /*
     * The label was chosen before the lock, so another project may have
     * taken it since. Asked again under the lock, and refused with nothing
     * made: register() would refuse it after the home was scaffolded.
     */
    if (!listed && label.fresh) {
      const rows = live().filter((r) => r.project && !(r.checkout && canon(expand(String(r.checkout))) === checkout));
      const taken = rows.some((r) => String(r.project) === label.label)
        ? `label \`${label.label}\``
        : rows.some((r) => String(r.code) === label.code)
          ? `code \`${label.code}\``
          : null;
      if (taken) {
        console.error(red(`✗ the project ${taken} was taken while this ran. Nothing was made; run it again.`));
        return process.exit(2);
      }
    }
    let loc = listed ? resolveLocations({ cwd: checkout, blueprint: String(listed.id) }) : null;
    const siblings = listed ? [] : mine().map((r) => nameOf(r.id));
    const current = loc?.standard?.name ?? (found ? (isHome(found) && existsSync(join(found, '.gitignore')) ? 'spec' : 'all') : null);
    const commit = asked ?? current ?? 'none';

    /*
     * A change of standard that crosses the line - into the repository, or
     * back out - is a home moving. It moves whole, keeping its folder name
     * and its ID; only then is the ignore file the question.
     */
    let moved = null;
    if (listed && current && (current === 'none') !== (commit === 'none')) {
      try {
        moved = relocateHome({ loc, root: checkout, to: commit === 'none' ? 'personal' : 'repo' });
      } catch (e) {
        console.error(red(e.message));
        return process.exit(2);
      }
      listed = exact();
      loc = resolveLocations({ cwd: checkout, blueprint: String(listed.id) });
    }
    /*
     * What git tracked under what just left. "Nothing was added to this
     * repository" was printed over files git now held as pending deletions
     * (n-0179); the index still lists a file whose working copy is gone.
     */
    const leaving =
      moved && commit === 'none'
        ? [...new Set(Object.values(gitView({ root: checkout, paths: { home: moved.from } }).kinds).flatMap((v) => v.tracked))]
        : [];

    // ---- the home: the one it has, or a new folder -------------------------
    const results = [];
    let homeDir = loc?.homeDir ?? found ?? null;
    if (!homeDir) {
      const named = folder ?? suggestFolder(want && !isRegistryId(want) ? want : defaultName);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(named)) {
        console.error(red(`\`${named}\` is not a folder name.`));
        return process.exit(2);
      }
      homeDir = commit === 'none' ? join(personalHomes(label.label), named) : join(checkout, '.walkdown', 'blueprints', named);
      if (existsSync(homeDir) && readdirSync(homeDir).length) {
        console.error(red(`${tilde(homeDir)} already exists and is not a blueprint walkdown can take — choose another folder with --folder.`));
        return process.exit(2);
      }
      const outer = findHomes(checkout).homes.find((h) => homeDir.startsWith(`${h.dir}/`));
      if (outer) {
        console.error(red(`${tilde(homeDir)} would be inside ${tilde(outer.dir)}, which is a blueprint already — a home inside a home is refused.`));
        return process.exit(2);
      }
      mkdirSync(homeDir, { recursive: true });
    }
    const name = listed ? nameOf(listed.id) : want && !isRegistryId(want) ? want : found ? describeFolder(found) : defaultName;
    results.push(...scaffold(checkout, { force, specDir: homeDir, commit, name, skills: false }));

    // ---- the row ------------------------------------------------------------
    const entry = listed
      ? { action: /** @type {const} */ ('kept'), id: String(listed.id), path: registryPath(), beside: [], taken: undefined }
      : register({ checkout, homeDir, by: 'blueprints new', project: label.label, code: label.code, name });
    if (entry.action === 'label-taken' || entry.action === 'code-taken') {
      console.error(red(`✗ the project ${entry.action === 'label-taken' ? 'label' : 'code'} \`${entry.taken}\` was taken while this ran. Run it again.`));
      return process.exit(2);
    }
    const ignore = commit === 'none' ? null : setIgnore(homeDir, commit, { force });

    /*
     * Leaving the repository takes the pointer with it once no blueprint is
     * committed there any more (ADR 0014 §7).
     */
    if (commit === 'none' && moved && !findHomes(checkout).homes.length) {
      for (const rel of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', 'CONVENTIONS.md']) {
        const what = removePointer(join(checkout, rel));
        if (what === 'removed') results.push({ path: rel, action: 'pointer-removed' });
        else if (what === 'deleted') results.push({ path: rel, action: 'pointer-file-deleted' });
      }
    }
    const unready = !readUserConfig().config?.identity;

    const MARK = {
      created: green('+ created'),
      updated: green('~ updated'),
      'pointer-appended': green('+ appended'),
      'pointer-updated': green('~ pointer updated'),
      'pointer-removed': green('- pointer removed'),
      'pointer-file-deleted': green('- removed (walkdown made this file)'),
      'pointer-undecided': yellow('? several agent files — `walkdown pointer --into <file>`'),
      'up-to-date': dim('· up to date'),
      kept: dim('· kept'),
      'kept-differs': yellow('! kept (differs from packaged — --force to update)'),
    };
    if (moved) {
      console.log(`  ${green('→ moved')}    ${tilde(moved.from)}`);
      console.log(`  ${''.padEnd(10)} ${dim(`to ${tilde(moved.to)} — the whole home, no record edited, the ID kept`)}`);
      for (const g of moved.gone) console.log(`  ${green('- removed')}  ${g}`);
    }
    for (const r of results.filter((r) => !r.action.startsWith('spec-')))
      console.log(`  ${MARK[r.action] ?? r.action}  ${r.path}${r.target ? dim(` → ${r.target}`) : ''}`);
    if (ignore) {
      const IGN = {
        written: green('+ written'),
        'up-to-date': dim('· up to date'),
        removed: green('- removed'),
        absent: null,
        'kept-differs': yellow('! kept (yours differs from the spec standard — --force to rewrite)'),
      };
      if (IGN[ignore.action]) console.log(`  ${IGN[ignore.action]}  ${tilde(ignore.path)}`);
    }
    if (entry.action === 'written') console.log(`  ${green('+ listed')}   ${tilde(entry.path)}  ${dim(`as \`${entry.id}\``)}`);
    /*
     * Another blueprint for a project that has one is said as that, with the
     * others named: a mistyped name is a second blueprint nobody meant, and
     * the moment to notice is now (ADR 0011 §1, ADR 0014 §3).
     */
    if (entry.action === 'written' && siblings.length)
      console.log(
        `  ${green('+ another')}  ${dim(`added to \`${label.label}\`, beside ${siblings.map((i) => `\`${i}\``).join(', ')} — commands that write take \`--blueprint <id>\` now`)}`,
      );
    else if (entry.action === 'written' && label.fresh)
      console.log(`  ${green('+ project')}  ${dim(`\`${label.label}\`, a new project on this machine, code \`${label.code}\``)}`);
    /*
     * One directory too deep. A project inside another project's checkout
     * is deliberate where it is meant, so this is not a refusal - the
     * finding was the silence: the person got a working second project in
     * place of a correction, and the two only diverged later, when the
     * outer kept its ledger and the inner started empty (n-0214).
     */
    const above =
      entry.action === 'written' && label.fresh
        ? live().filter((r) => r.checkout && !r.ephemeral && checkout.startsWith(`${canon(expand(String(r.checkout)))}/`))
        : [];
    if (above.length)
      console.log(
        `  ${yellow('! above')}    ${dim(`\`${above[0].id}\` already answers for this directory, from ${tilde(String(above[0].checkout))} — this makes two blueprints in two projects, each with its own ledger`)}`,
      );
    if (unready)
      console.log(`  ${yellow('? you')}      this machine is not set up — \`walkdown init\` says who you are and installs the skills`);

    console.log(`\n  spec: ${tilde(homeDir)}`);
    const say = {
      none:
        '  In ~/.walkdown, which git never sees. Nothing was added to this repository.' +
        '\n  Prefer it committed? `walkdown blueprints commit spec` moves the home into the repository.',
      spec:
        '  Committed: the spec and its threads, so a rule change arrives as a diff somebody' +
        " approves and a clone is a working project. The home's own .gitignore is the standard —" +
        '\n  delete it to commit everything, or `walkdown blueprints commit none` moves the home back out.',
      all:
        "  Committed in full, says the tree: no .gitignore in the home, so everything there is git's" +
        ' — and git keeps every version of every screenshot forever.' +
        '\n  `walkdown blueprints commit spec` writes the ignore file back.',
    };
    const several = mine().length > 1;
    const idFlag = several ? ` --blueprint ${name}` : '';
    const said = ignore?.action === 'kept-differs' ? "  Committed, by the home's own .gitignore, which differs from walkdown's and was left as it is." : say[commit];
    console.log(dim(said.replace(/`walkdown blueprints commit (\w+)`/g, (_, std) => `\`walkdown blueprints commit ${std}${idFlag}\``)));
    /*
     * What git tracks NOW, asked of git rather than asserted from the file
     * just written (n-0164, n-0180).
     */
    const after = resolveLocations({ cwd: checkout, blueprint: entry.id });
    const t = tracking(after);
    console.log(`  tracked: ${t.words}  ${dim(t.why)}`);
    for (const f of t.findings) console.log(`  ${f.level === 'error' ? red(`✗ ${f.message}`) : yellow(`! ${f.message}`)}`);
    if (leaving.length)
      console.log(
        yellow(
          `  ${leaving.length} file(s) git tracked under the home that left are now deletions to commit — git keeps` +
            ` their history, and walkdown never touches the index.\n    ${leaving.slice(0, 3).join('\n    ')}${leaving.length > 3 ? `\n    … ${leaving.length - 3} more` : ''}`,
        ),
      );
    if (results.some((r) => r.action === 'created')) {
      console.log(`\nNext: fill in ${dim(join(tilde(homeDir), 'spec.yml'))} (runner commands, targets), sketch your`);
      console.log(`first feature from its ${dim('features/_template.yml')}, then \`walkdown lint\`.`);
      console.log(dim('`walkdown where` shows every path this project uses.'));
    }
    if (!isHome(homeDir)) console.error(red(`  the spec did not land at ${homeDir}`));
  }
}
