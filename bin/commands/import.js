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
  checkoutGone,
  couldHaveMoved,
  describeFolder,
  expand,
  findHomes,
  gitRoot,
  goneCheckouts,
  isHome,
  isOldHome,
  linkedWorktree,
  projectOf,
  projectsDir,
  readRegistry,
  reclaimFromClone,
  register,
  relearnCheckout,
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
      const wt = checkoutFor(checkout, readRegistry().rows) ?? linkedWorktree(checkout);
      if (wt?.worktree) {
        const there = join(wt.checkout, relative(wt.worktree, homeDir));
        if (isHome(there)) {
          homeDir = canon(there);
          checkout = wt.checkout;
        } else if (!wt.clone) {
          // Only this worktree's branch holds it: registered here, the
          // worktree became a project of its own (n-0542).
          console.error(red(onlyInWorktree(homeDir, wt)));
          return end(2);
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
    if (already && claimedByGone([homeDir])) return end(2);
    if (already) {
      if (values.json)
        console.log(
          JSON.stringify(
            { imported: [], listed: [{ id: already, home: tilde(homeDir) }] },
            null,
            2,
          ),
        );
      else
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
  let { homes, nested } = top ? findHomes(top) : { homes: [], nested: [] };
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
          `  ${green('~ moved')}    ${dim(`\`${id}\` keeps its ID: it was at ${tilde(moved.from)}, ${gone(moved.from)}, and this machine now finds it at ${tilde(top)}`)}`,
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
  let wt = top ? (checkoutFor(top, readRegistry().rows) ?? linkedWorktree(top)) : null;
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
  // A home only this worktree's branch holds is not offered (n-0542).
  let branchOnly = [];
  if (wt?.worktree && !wt.clone) {
    const mine = (h) => isHome(join(wt.checkout, relative(wt.worktree, h.dir)));
    branchOnly = homes.filter((h) => !mine(h));
    for (const h of branchOnly) console.error(dim(onlyInWorktree(h.dir, wt)));
    homes = homes.filter(mine);
    if (!homes.length) return end(2);
  }
  const at_ = (h) => {
    if (!wt?.worktree) return h;
    const there = canon(join(wt.checkout, relative(wt.worktree, h.dir)));
    return isHome(there) ? { ...h, dir: there } : { ...h, checkout: top };
  };
  relearnCheckout(checkout);
  const listed = listedHomes();
  if (claimedByGone(homes.map((h) => at_(h).dir))) return end(2);
  const isListed = (h) => listed.has(canon(at_(h).dir));
  const fresh = homes.filter((h) => !isListed(h));
  let known = homes.filter(isListed);
  const show = (h, i) => {
    const d = describe(h.dir).description;
    const mark = isListed(h)
      ? dim(`  · already listed as \`${listed.get(canon(at_(h).dir))}\``)
      : '';
    return `  ${i === null ? '' : `${i + 1}. `}${h.folder}${d ? dim(` — ${d}`) : ''}${mark}`;
  };
  // By any letter case, as the path itself is (n-0543).
  const named = (h, w) =>
    [h.folder, basename(h.folder), describeFolder(h.folder)].some(
      (n) => String(n).toLowerCase() === w.toLowerCase(),
    );
  let chosen = fresh;
  if (values.only) {
    const want = [
      ...new Set(
        values.only
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    // Refused alike whether or not anything here is still unlisted (n-0541).
    // One only this worktree holds was said so above, not called missing.
    const missing = want.filter(
      (w) => !homes.some((h) => named(h, w)) && !branchOnly.some((h) => named(h, w)),
    );
    if (missing.length) {
      console.error(red(`${tilde(top)} holds no blueprint folder called ${missing.join(', ')}.`));
      console.error(dim(`  it holds: ${homes.map((h) => h.folder).join(', ')}`));
      return end(2);
    }
    chosen = fresh.filter((h) => want.some((w) => named(h, w)));
    // A folder already listed is said so, not refused: `--only cart,billing`
    // with cart listed still imports billing (n-0538).
    known = homes.filter((h) => isListed(h) && want.some((w) => named(h, w)));
    // Every name was a home only this worktree holds, already said.
    if (!chosen.length && !known.length) return end(2);
  } else if (!fresh.length) {
    if (values.json) {
      const listed = known.map((h) => ({
        id: listedHomes().get(canon(at_(h).dir)) ?? null,
        home: tilde(at_(h).dir),
      }));
      console.log(JSON.stringify({ imported: [], listed }, null, 2));
      return end(0);
    }
    console.log(`${dim('· already listed')} every blueprint in ${tilde(top)}:`);
    for (const h of homes) console.log(show(h, null));
    return end(0);
  } else if (!values.all) {
    // --json keeps stdout JSON: the list a person would choose from is the
    // refusal's, on stderr (n-0541).
    const say = values.json ? console.error : console.log;
    say(`${tilde(top)} holds ${homes.length} blueprint${homes.length === 1 ? '' : 's'}:`);
    homes.forEach((h, i) => say(show(h, i)));
    if (!process.stdin.isTTY) {
      console.error(yellow('\nSay which: --all, or --only <folders>. Nothing was imported.'));
      return end(2);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Ctrl-D at the question is "none of them", not a stack trace.
    const said = (
      await rl.question('\nImport which? (numbers or folders, or "all") ').catch(() => '')
    ).trim();
    rl.close();
    if (!said) {
      console.log(dim('nothing imported'));
      return end(0);
    }
    if (said.toLowerCase() === 'all') chosen = fresh;
    else {
      // A number, or the folder's name as the list shows it (n-0545).
      const words = said.split(/[\s,]+/).filter(Boolean);
      // A word that is neither is refused, as --only refuses it (n-0546).
      const unknown = words.filter(
        (w) => !homes.some((h, i) => Number(w) === i + 1 || named(h, w)),
      );
      if (unknown.length) {
        console.error(
          red(
            `${tilde(top)} holds no blueprint folder called ${unknown.join(', ')}. Nothing was imported.`,
          ),
        );
        return end(2);
      }
      const picked = new Set(
        homes
          .map((h, i) => i + 1)
          .filter((n) => words.some((w) => Number(w) === n || named(homes[n - 1], w))),
      );
      chosen = homes.filter((h, i) => picked.has(i + 1) && !isListed(h));
      known = homes.filter((h, i) => picked.has(i + 1) && isListed(h));
    }
    if (!chosen.length && !known.length) {
      console.log(dim('nothing imported'));
      return end(0);
    }
  }
  return finish(chosen.map(at_), checkout, values, known.map(at_));
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
      // A label whose checkout is gone may be this one, moved: the way to
      // keep its IDs is said, not only the way to make new ones (n-0544).
      const gone =
        row.action === 'label-taken' &&
        values.project !== row.taken &&
        readRegistry().rows.some((r) => r?.project === row.taken && checkoutGone(r));
      if (gone)
        console.error(
          dim(
            `  If this is \`${row.taken}\`'s checkout, moved, \`--project ${row.taken}\` keeps its IDs.`,
          ),
        );
      console.error(
        dim(
          `  ${gone ? 'Otherwise choose' : 'Choose'} another with \`--project <label>\` and \`--code <two or three letters>\`.`,
        ),
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
          listed: known.map((k) => ({
            id: listedHomes().get(canon(k.dir)) ?? null,
            home: tilde(k.dir),
          })),
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
        `  ${green('~ moved')}    ${tilde(w.dir)}  ${dim(`keeps its ID \`${w.id}\`: it was at ${tilde(w.from)}, ${gone(w.from)}`)}`,
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

/** Why a home only a worktree holds is not registered (ADR 0014 §10). */
function onlyInWorktree(dir, wt) {
  return `${tilde(dir)} is only in ${tilde(wt.worktree)}, a git worktree of ${tilde(wt.checkout)}, and a worktree is never registered. Once its branch is in ${tilde(wt.checkout)}, import it there.`;
}

/*
 * A home listed under a row whose checkout is gone - another repository now
 * stands where it stood - is neither this checkout's nor already listed.
 * Taking the old IDs claimed one project's records for another; making new
 * ones beside them would list one folder twice. So it is said, with the way
 * out (n-0547).
 */
function claimedByGone(dirs) {
  const rows = readRegistry().rows;
  const gone = dirs
    .map((d) =>
      rows.find((r) => r?.registered && r.home && canon(expand(String(r.home))) === canon(d)),
    )
    .filter((r) => r && checkoutGone(r));
  if (!gone.length) return false;
  const ids = gone.map((r) => `\`${r.id}\``).join(', ');
  console.error(
    red(
      `✗ ${tilde(expand(String(gone[0].checkout)))} is listed as \`${gone[0].project}\` (${ids}), but what stands there now is another repository. Nothing was imported.`,
    ),
  );
  console.error(
    dim(
      `  If \`${gone[0].project}\` moved, import it where it is now and its IDs go with it. If it is gone for good, forget each of its IDs here (the files stay), then import this one:`,
    ),
  );
  // Every row of that checkout, not only those this import met (n-0548).
  const at = canon(expand(String(gone[0].checkout)));
  for (const r of rows.filter(
    (r) => r?.registered && r.checkout && canon(expand(String(r.checkout))) === at,
  ))
    console.error(dim(`    walkdown blueprints forget ${r.id}`));
  return true;
}

/** What became of a moved checkout's old path, said truly (n-0550). */
function gone(from) {
  return existsSync(from) ? 'where another repository stands now' : 'which no longer exists';
}
