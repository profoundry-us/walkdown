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
import { createInterface } from 'node:readline/promises';
import { basename, dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  canon,
  checkoutFor,
  describeFolder,
  expand,
  findHomes,
  gitRoot,
  isHome,
  isOldHome,
  readRegistry,
  register,
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
    if (basename(d) === 'blueprints' && basename(dirname(d)) === '.walkdown') return dirname(dirname(d));
  return null;
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
    console.error(red(`${tilde(dir)} is laid out the way walkdown laid homes out before ADR 0014 (blueprint/walkdown.yml).`));
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
    if (!checkout && !values.ephemeral) {
      console.error(
        red(
          `${tilde(homeDir)} is not under any repository's .walkdown/blueprints/ — a registered blueprint belongs to one (\`walkdown blueprints new\` makes one). A copy standing elsewhere is imported with --ephemeral.`,
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
  const top = (gitRoot(dir) && canon(gitRoot(dir)) === dir) || existsSync(join(dir, '.walkdown')) ? dir : null;
  const { homes, nested } = top ? findHomes(top) : { homes: [], nested: [] };
  for (const n of nested)
    console.error(red(`✗ ${tilde(n.inner)} is a blueprint inside ${tilde(n.outer)} — a home inside a home is refused, and not offered.`));
  if (!homes.length) {
    console.error(red(`Nothing at ${at} is a blueprint — no spec.yml there, and no .walkdown/blueprints/ holding one.`));
    console.error(dim('  `walkdown blueprints new` inside that project starts one.'));
    return end(2);
  }
  /*
   * A worktree's homes are imported as the checkout's (ADR 0014 §10): the
   * project is the checkout, and the worktree is never registered.
   */
  const wt = checkoutFor(top, readRegistry().rows);
  const checkout = wt?.worktree ? wt.checkout : top;
  const at_ = (h) => {
    if (!wt?.worktree) return h;
    const there = canon(join(wt.checkout, relative(wt.worktree, h.dir)));
    return isHome(there) ? { ...h, dir: there } : h;
  };
  const listed = listedHomes();
  const isListed = (h) => listed.has(canon(at_(h).dir));
  const fresh = homes.filter((h) => !isListed(h));
  const known = homes.filter(isListed);
  const show = (h, i) => {
    const d = describe(h.dir).description;
    const mark = isListed(h) ? dim(`  · already listed as \`${listed.get(canon(at_(h).dir))}\``) : '';
    return `  ${i === null ? '' : `${i + 1}. `}${h.folder}${d ? dim(` — ${d}`) : ''}${mark}`;
  };
  if (!fresh.length) {
    console.log(`${dim('· already listed')} every blueprint in ${tilde(top)}:`);
    for (const h of homes) console.log(show(h, null));
    return end(0);
  }

  let chosen = fresh;
  const named = (h, w) => w === h.folder || w === basename(h.folder) || w === describeFolder(h.folder);
  if (values.only) {
    const want = [...new Set(values.only.split(',').map((s) => s.trim()).filter(Boolean))];
    chosen = fresh.filter((h) => want.some((w) => named(h, w)));
    const missing = want.filter((w) => !fresh.some((h) => named(h, w)));
    if (missing.length) {
      console.error(red(`${tilde(top)} holds no unlisted blueprint folder called ${missing.join(', ')}.`));
      console.error(dim(`  it holds: ${homes.map((h) => h.folder).join(', ')}`));
      return end(2);
    }
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
  for (const h of chosen) {
    let row;
    try {
      row = register({
        checkout: values.ephemeral ? null : checkout,
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
        red(`✗ the project ${row.action === 'label-taken' ? 'label' : 'code'} \`${row.taken}\` is another project's on this machine. Nothing more was imported.`),
      );
      console.error(dim('  Choose another with `--project <label>` and `--code <two or three letters>`.'));
      return end(2);
    }
    written.push({ ...h, id: row.id, project: row.project, path: row.path, beside: row.beside ?? [], kept: row.action === 'kept', from: row.from ?? null });
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
  for (const w of written) {
    if (w.from) {
      // The checkout moved: the same blueprint, by the same ID.
      console.log(`  ${green('~ moved')}    ${tilde(w.dir)}  ${dim(`as \`${w.id}\`, still — the row named ${tilde(w.from)}, which is gone`)}`);
      continue;
    }
    console.log(`  ${w.kept ? dim('· already listed') : green('+ listed')}   ${tilde(w.dir)}  ${dim(`as \`${w.id}\``)}`);
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
  if (indexed !== null) console.log(dim(`\n  ${indexed} blueprint(s) indexed · \`walkdown blueprints\` lists them`));
  return end(0);
}
