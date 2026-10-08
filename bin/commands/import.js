/*
 * `walkdown blueprints import <path>` — take blueprints into this machine's
 * registry (ADR 0003, ADR 0014 §8).
 *
 * Import takes what it is pointed at. A path to one blueprint's folder - a
 * home, holding a spec.yml - registers that one. A path to a repository
 * lists every home under its `.walkdown/blueprints/`, at any depth, and asks
 * which to take; with no terminal to ask it prints the list and needs
 * `--all` or `--only`. Nothing arrives by walking anywhere else, and a clone
 * of a repository that uses walkdown shows you nothing until you import it.
 *
 * `--ephemeral` is for a copy not meant to outlive the afternoon - a scratch
 * blueprint a judging agent works against. It is registered like anything
 * else, because an unregistered one is exactly the ghost the registry exists
 * to abolish, and it is marked and belongs to no project, so it is reachable
 * by its ID and never by standing somewhere.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
  canon,
  checkoutFor,
  couldHaveMoved,
  describeFolder,
  expand,
  findHomes,
  gitRoot,
  goneCheckouts,
  isHome,
  isOldHome,
  projectOf,
  projectsDir,
  readRegistry,
  reclaimFromClone,
  register,
  repointMovedCheckout,
  SPEC_FILE,
  tilde,
} from '../../lib/locations.js';
import { refreshIndex } from '../../lib/registry.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { parse } from '../../vendor/yaml.js';
import { end } from './context.js';

const HELP = `walkdown blueprints import <path> [--all] [--only <folders>] [--ephemeral] [--why <reason>] [--json]

  <path>       one blueprint's folder (it holds a spec.yml), or a repository whose
               .walkdown/blueprints/ holds some
  --all        take every blueprint the repository holds, without asking
  --only       take these folders only, comma separated
  --project    the project label, where this checkout is new to this machine
  --code       its two- or three-letter code
  --ephemeral  a throwaway copy of a home: reachable by its ID, never by standing somewhere
  --why        what the copy is for, kept beside it`;

/** What a home says about itself, from its spec.yml. */
function describe(dir) {
  try {
    const cfg = parse(readFileSync(join(dir, SPEC_FILE), 'utf8')) ?? {};
    return { name: cfg.blueprint ?? null, description: cfg.description ?? '' };
  } catch {
    return { name: null, description: '' };
  }
}

/*
 * The checkout a home belongs to: the repository whose `.walkdown/blueprints/`
 * it stands under, or null for one standing anywhere else.
 */
function checkoutOf(homeDir) {
  let d = dirname(homeDir);
  for (let i = 0; i < 16 && d !== dirname(d); i++, d = dirname(d))
    if (basename(d) === 'blueprints' && basename(dirname(d)) === '.walkdown')
      return dirname(dirname(d));
  return null;
}

/** The project a home kept under ~/.walkdown/projects/ is kept for, or null. */
function keptFor(homeDir) {
  const rel = relative(canon(projectsDir()), homeDir).split(sep);
  return rel.length === 3 && rel[0] !== '..' && rel[1] === 'blueprints' ? rel[0] : null;
}

const listedHomes = () =>
  new Map(
    readRegistry()
      .rows.filter((r) => r?.registered && r.home)
      .map((r) => [canon(expand(String(r.home))), String(r.id)]),
  );

export async function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      only: { type: 'string' },
      json: { type: 'boolean', default: false },
      project: { type: 'string' },
      code: { type: 'string' },
      ephemeral: { type: 'boolean', default: false },
      why: { type: 'string' },
    },
  });
  const at = positionals[0];
  if (!at) {
    console.error('walkdown blueprints import needs a path to a blueprint folder or a repository.');
    console.error(HELP);
    return end(2);
  }
  const dir = canon(expand(at, process.cwd()));
  if (!existsSync(dir)) {
    console.error(red(`${at} does not exist.`));
    return end(2);
  }
  if (isOldHome(dir) && !isHome(dir)) {
    console.error(
      red(
        `${tilde(dir)} is laid out the way walkdown laid homes out before ADR 0014 (blueprint/walkdown.yml).`,
      ),
    );
    console.error(dim('  `walkdown upgrade` flattens it; import it after.'));
    return end(2);
  }

  // ---- one blueprint's folder ----------------------------------------------
  if (isHome(dir)) {
    let homeDir = dir;
    let checkout = checkoutOf(homeDir);
    /*
     * A home in a worktree is the project's, at the checkout's own copy
     * (ADR 0014 §10): a worktree is never registered.
     */
    if (checkout) {
      const wt = checkoutFor(checkout, readRegistry().rows);
      if (wt?.worktree) {
        const there = join(wt.checkout, relative(wt.worktree, homeDir));
        if (isHome(there)) {
          homeDir = canon(there);
          checkout = wt.checkout;
        }
      }
    }
    /*
     * A COPY MEANS A COPY (q-0176). A project's own home under --ephemeral is
     * refused; a home standing where no project owns it, such as a copy under
     * `.walkdown/tmp/`, is what the flag is for.
     */
    if (checkout && values.ephemeral) {
      console.error(
        red(
          `${tilde(homeDir)} is ${tilde(checkout)}'s own blueprint — an ephemeral entry is for a throwaway COPY, and this is the original. Copy it somewhere no project owns (${tilde(join(checkout, '.walkdown', 'tmp', '<label>'))}, say) and import the copy.`,
        ),
      );
      return end(2);
    }
    /*
     * A home kept on this machine for a project, under
     * ~/.walkdown/projects/<label>/blueprints/, belongs to that project's
     * checkout: imported from inside it, it is that project's again. Without
     * this a forgotten one could never come back (n-0501).
     */
    const kept = !checkout && !values.ephemeral ? keptFor(homeDir) : null;
    if (kept) {
      const here = gitRoot(process.cwd());
      const known = here ? projectOf(canon(here), readRegistry().rows) : null;
      if (!here || (known && known.label !== kept)) {
        console.error(
          red(
            `${tilde(homeDir)} is kept on this machine for the project \`${kept}\`. Nothing was registered.`,
          ),
        );
        console.error(
          dim(
            here
              ? `  This is ${tilde(here)}, project \`${known?.label}\`. Run it again from inside ${kept}'s checkout.`
              : `  Run it again from inside ${kept}'s checkout, which it belongs to.`,
          ),
        );
        return end(2);
      }
      checkout = canon(here);
      values.project ??= kept;
    }
    if (!checkout && !values.ephemeral) {
      console.error(
        red(
          `${tilde(homeDir)} is not under any repository's .walkdown/blueprints/ — a registered blueprint belongs to one (\`walkdown blueprints new\` makes one). A copy standing elsewhere is imported with --ephemeral.`,
        ),
      );
      return end(2);
    }
    // A home inside a home is refused named by its path, as the scan refuses it (n-0490).
    const pair = checkout
      ? findHomes(checkout).nested.find((n) => canon(n.inner) === canon(homeDir))
      : null;
    if (pair) {
      console.error(
        red(
          `✗ ${tilde(pair.inner)} is a blueprint inside ${tilde(pair.outer)} — a home inside a home is refused. Nothing was registered.`,
        ),
      );
      console.error(
        dim(
          '  Move the inner one out to a folder of its own under .walkdown/blueprints/, then import it.',
        ),
      );
      return end(2);
    }
    const already = listedHomes().get(canon(homeDir));
    if (already) {
      console.log(`  ${dim('· already listed')} ${tilde(homeDir)}  ${dim(`as \`${already}\``)}`);
      return end(0);
    }
    return finish([{ dir: homeDir, folder: basename(homeDir) }], checkout, values);
  }

  // ---- a repository ----------------------------------------------------------
  const top =
    (gitRoot(dir) && canon(gitRoot(dir)) === dir) || existsSync(join(dir, '.walkdown'))
      ? dir
      : null;
  const { homes, nested } = top ? findHomes(top) : { homes: [], nested: [] };
  for (const n of nested)
    console.error(
      red(
        `✗ ${tilde(n.inner)} is a blueprint inside ${tilde(n.outer)} — a home inside a home is refused, and not offered.`,
      ),
    );
  if (!homes.length) {
    // A checkout that moved, whose blueprints are all kept on this machine.
    const moved = top ? repointMovedCheckout(top, values.project ?? null) : null;
    if (moved) {
      for (const id of moved.ids)
        console.log(
          `  ${green('~ moved')}    ${dim(`\`${id}\` keeps its ID: it was at ${tilde(moved.from)}, which no longer exists, and this machine now finds it at ${tilde(top)}`)}`,
        );
      return end(0);
    }
    const here = top
      ? readRegistry().rows.filter(
          (r) => r?.registered && r.checkout && canon(expand(String(r.checkout))) === top,
        )
      : [];
    if (here.length) {
      console.log(
        `${dim('· already listed')} ${tilde(top)}: ${here.map((r) => `\`${r.id}\``).join(', ')}`,
      );
      return end(0);
    }
    console.error(
      red(
        `Nothing at ${at} is a blueprint — no spec.yml there, and no .walkdown/blueprints/ holding one.`,
      ),
    );
    // A project whose checkout went missing may be this one, moved; the
    // person says so, and nothing is guessed.
    for (const g of top ? goneCheckouts() : [])
      console.error(
        dim(
          `  \`${g.label}\`'s checkout ${g.checkout} is gone — if this is it, \`walkdown blueprints import ${at} --project ${g.label}\` points it here.`,
        ),
      );
    console.error(dim('  `walkdown blueprints new` inside that project starts one.'));
    return end(2);
  }
  /*
   * A worktree's homes are imported as the checkout's (ADR 0014 §10): the
   * project is the checkout, and the worktree is never registered.
   */
  let wt = checkoutFor(top, readRegistry().rows);
  if (wt?.clone) {
    const moved = reclaimFromClone(top, wt.checkout);
    if (moved) {
      for (const id of moved.ids)
        console.log(
          `  ${green('~ moved')}    ${dim(`\`${id}\` belongs to ${tilde(top)} now, still as \`${id}\` — ${tilde(moved.from)} is a fresh clone without the records this tree holds`)}`,
        );
      wt = checkoutFor(top, readRegistry().rows);
    }
  }
  const checkout = wt?.worktree ? wt.checkout : top;
  /*
   * A home the checkout has a copy of is the checkout's. One it has no copy
   * of is this tree's own - a moved checkout whose origin was cloned back at
   * its old path matches that clone by origin, and is still not its
   * worktree (locations.registry.ids-stay-here).
   */
  const at_ = (h) => {
    if (!wt?.worktree) return h;
    const there = canon(join(wt.checkout, relative(wt.worktree, h.dir)));
    return isHome(there) ? { ...h, dir: there } : { ...h, checkout: top };
  };
  const listed = listedHomes();
  const isListed = (h) => listed.has(canon(at_(h).dir));
  const fresh = homes.filter((h) => !isListed(h));
  const known = homes.filter(isListed);
  const show = (h, i) => {
    const d = describe(h.dir).description;
    const mark = isListed(h)
      ? dim(`  · already listed as \`${listed.get(canon(at_(h).dir))}\``)
      : '';
    return `  ${i === null ? '' : `${i + 1}. `}${h.folder}${d ? dim(` — ${d}`) : ''}${mark}`;
  };
  if (!fresh.length) {
    console.log(`${dim('· already listed')} every blueprint in ${tilde(top)}:`);
    for (const h of homes) console.log(show(h, null));
    return end(0);
  }

  let chosen = fresh;
  const named = (h, w) =>
    w === h.folder || w === basename(h.folder) || w === describeFolder(h.folder);
  if (values.only) {
    const want = [
      ...new Set(
        values.only
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    chosen = fresh.filter((h) => want.some((w) => named(h, w)));
    // A folder already listed is said so, not refused: `--only cart,billing`
    // with cart listed still imports billing (n-0538).
    const already = homes.filter(
      (h) => isListed(h) && want.some((w) => named(h, w)) && !chosen.includes(h),
    );
    for (const h of already)
      console.log(`${dim('· already listed')}${show(h, null).replace(/^ {2}/, ' ')}`);
    const missing = want.filter((w) => !homes.some((h) => named(h, w)));
    if (missing.length) {
      console.error(red(`${tilde(top)} holds no blueprint folder called ${missing.join(', ')}.`));
      console.error(dim(`  it holds: ${homes.map((h) => h.folder).join(', ')}`));
      return end(2);
    }
    if (!chosen.length) return end(0);
  } else if (!values.all) {
    console.log(`${tilde(top)} holds ${homes.length} blueprint${homes.length === 1 ? '' : 's'}:`);
    homes.forEach((h, i) => console.log(show(h, i)));
    if (!process.stdin.isTTY) {
      console.error(yellow('\nSay which: --all, or --only <folders>. Nothing was imported.'));
      return end(2);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Ctrl-D at the question is "none of them", not a stack trace.
    const said = (await rl.question('\nImport which? (numbers, or "all") ').catch(() => '')).trim();
    rl.close();
    if (!said) {
      console.log(dim('nothing imported'));
      return end(0);
    }
    if (said.toLowerCase() === 'all') chosen = fresh;
    else {
      const picked = new Set(
        said
          .split(/[\s,]+/)
          .map((n) => Number.parseInt(n, 10))
          .filter((n) => n >= 1 && n <= homes.length),
      );
      chosen = homes.filter((h, i) => picked.has(i + 1) && !isListed(h));
      for (const h of homes.filter((h, i) => picked.has(i + 1) && isListed(h)))
        console.log(`${dim('· already listed')}${show(h, null).replace(/^ {2}/, ' ')}`);
    }
    if (!chosen.length) {
      console.log(dim('nothing imported'));
      return end(0);
    }
  }
  return finish(chosen.map(at_), checkout, values, known);
}

function finish(chosen, checkout, values, known = []) {
  const written = [];
  /*
   * A moved checkout re-points every row it holds at once, on the first of
   * its homes. The rest then read as listed - at a path they were not listed
   * at when this began - and are moves too (n-0522).
   */
  const before = listedHomes();
  let movedFrom = null;
  /*
   * A row whose checkout is gone, and whose home stands at the same place in
   * this one, is this checkout moved. It is registered first, whatever was
   * chosen, so the move is seen before a home new to the machine asks for
   * the project's label and is refused it as another project's (n-0533).
   */
  if (checkout && !values.ephemeral) {
    const here = canon(checkout);
    const riders = [];
    for (const r of readRegistry().rows) {
      if (!r?.registered || !r.checkout || !r.home || r.ephemeral) continue;
      const old = expand(String(r.checkout));
      if (existsSync(old) && existsSync(join(expand(String(r.home)), SPEC_FILE))) continue;
      if (!couldHaveMoved(r, here, values.project ?? null)) continue;
      const there = join(here, relative(old, expand(String(r.home))));
      if (!isHome(there) || riders.some((x) => x.dir === canon(there))) continue;
      riders.push({ dir: canon(there), folder: basename(there) });
    }
    if (riders.length) {
      const picked = new Set(riders.map((x) => x.dir));
      chosen = [...riders, ...chosen.filter((h) => !picked.has(canon(h.dir)))];
    }
  }
  for (const h of chosen) {
    let row;
    try {
      row = register({
        checkout: values.ephemeral ? null : (h.checkout ?? checkout),
        homeDir: h.dir,
        by: 'import',
        project: values.project ?? null,
        code: values.code ?? null,
        ephemeral: values.ephemeral ? { why: values.why ?? '' } : null,
      });
    } catch (e) {
      // A registry that does not parse, a lock held, a code that is no code:
      // said as a sentence, with nothing written.
      console.error(red(`✗ ${e.message}`));
      return end(2);
    }
    if (row.action === 'label-taken' || row.action === 'code-taken') {
      console.error(
        red(
          `✗ the project ${row.action === 'label-taken' ? 'label' : 'code'} \`${row.taken}\` is another project's on this machine. Nothing more was imported.`,
        ),
      );
      console.error(
        dim('  Choose another with `--project <label>` and `--code <two or three letters>`.'),
      );
      return end(2);
    }
    written.push({
      ...h,
      id: row.id,
      project: row.project,
      path: row.path,
      beside: row.beside ?? [],
      kept: row.action === 'kept',
      from:
        row.from ??
        (row.action === 'kept' && movedFrom && !before.has(canon(h.dir)) ? movedFrom : null),
    });
    movedFrom = row.from ?? movedFrom;
  }
  /*
   * Claims are indexed at import, so routing never has to load a spec (ADR
   * 0001 §5). `serve` rebuilds it; this is what makes the first serve cheap.
   */
  let indexed = null;
  try {
    indexed = refreshIndex().blueprints.length;
  } catch {
    /* the claims index is a cache; the next serve rebuilds it */
  }
  if (values.json) {
    console.log(
      JSON.stringify(
        {
          checkout: checkout ? tilde(checkout) : null,
          imported: written.map((w) => ({ id: w.id, project: w.project, home: tilde(w.dir) })),
          indexed,
        },
        null,
        2,
      ),
    );
    return end(0);
  }
  /*
   * A move re-points every row of the checkout at once, so rows this import
   * was never pointed at can change too - after `import <one home>` or
   * `--only`. Each is said, never changed in silence (n-0522).
   */
  const after = listedHomes();
  const now = new Map([...after].map(([home, id]) => [id, home]));
  const was = new Map([...before].map(([home, id]) => [id, home]));
  const named = new Set(written.map((w) => w.id));
  for (const [id, home] of now)
    if (!named.has(id) && was.has(id) && was.get(id) !== home)
      console.log(
        `  ${green('~ moved')}    ${tilde(home)}  ${dim(`keeps its ID \`${id}\`: it was at ${tilde(was.get(id))}, and moved with its checkout`)}`,
      );
  for (const w of written) {
    if (w.from) {
      // The checkout moved: the same blueprint, by the same ID.
      console.log(
        `  ${green('~ moved')}    ${tilde(w.dir)}  ${dim(`keeps its ID \`${w.id}\`: it was at ${tilde(w.from)}, which no longer exists`)}`,
      );
      continue;
    }
    console.log(
      `  ${w.kept ? dim('· already listed') : green('+ listed')}   ${tilde(w.dir)}  ${dim(`as \`${w.id}\``)}`,
    );
    if (!w.kept)
      console.log(
        `  ${''.padEnd(10)} ${dim(
          values.ephemeral
            ? `a throwaway copy${values.why ? `: "${values.why}"` : ''}`
            : `in project \`${w.project}\`${w.beside.length ? `, beside ${w.beside.map((b) => `\`${b}\``).join(', ')}` : ''}`,
        )}`,
      );
  }
  for (const k of known) console.log(`  ${dim(`· already listed  ${k.folder}`)}`);
  // The index is the machine's, so the count is too - not what this import
  // touched, which read as a miscount after a move (n-0502).
  if (indexed !== null)
    console.log(
      dim(
        `\n  ${indexed} blueprint${indexed === 1 ? '' : 's'} on this machine now · \`walkdown blueprints\` lists them`,
      ),
    );
  return end(0);
}
