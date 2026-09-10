/*
 * `walkdown import <path>` — take a project's blueprints into this machine's
 * registry.
 *
 * WHY THIS IS NOT `project add` (ADR 0001). `add` lists a blueprint that lives
 * in a home under the `.walkdown` answering where you are standing; it refuses
 * to reach into another checkout, because a server inferring a neighbour's
 * blueprints from the tree is how one pack's board came to serve and write to
 * another's (n-0159). That refusal is about INFERENCE, and this command is the
 * opposite: you name a directory, you are shown what it declares, and you say
 * which of them you want. Nothing arrives by walking anywhere.
 *
 * The consequence is the point: a clone of a repository that happens to use
 * walkdown shows you nothing until you import it. You never see blueprints you
 * did not ask for.
 *
 * It writes to the personal config, never a repository's - what this machine
 * has imported is a fact about this machine - and the entries carry no
 * `roots`, so an imported blueprint is reachable by name and by the server and
 * never shadows the `.walkdown` that answers where you stand.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  canon,
  expand,
  HOME_LAYOUT,
  readUserConfig,
  rememberProject,
  tilde,
} from '../../lib/locations.js';
import { refreshIndex } from '../../lib/registry.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { parse } from '../../vendor/yaml.js';
import { end } from './context.js';

const HELP = `walkdown import <path> [--all] [--only <ids>] [--json]

  <path>   a project directory holding a .walkdown that declares blueprints
  --all    take every blueprint it declares, without asking
  --only   take these ids only, comma separated`;

/** What a directory declares: its own `.walkdown/config.yml`, and only that. */
function declaredIn(dir) {
  const config = join(dir, '.walkdown', 'config.yml');
  if (!existsSync(config)) return null;
  let parsed;
  try {
    parsed = parse(readFileSync(config, 'utf8'));
  } catch (e) {
    throw new Error(`${config} cannot be read (${e.message}). Fix that file and import again.`);
  }
  const out = [];
  for (const entry of parsed?.projects ?? []) {
    if (!entry?.id || !entry?.spec) continue;
    const spec = canon(expand(String(entry.spec), dir));
    if (!existsSync(join(spec, 'walkdown.yml'))) continue;
    let name = entry.id;
    let description = '';
    try {
      const cfg = parse(readFileSync(join(spec, 'walkdown.yml'), 'utf8'));
      name = cfg?.project ?? entry.id;
      description = cfg?.description ?? '';
    } catch {
      /* unnamed, which is a lint problem there and not an import problem here */
    }
    out.push({ id: String(entry.id), spec, name, description });
  }
  return out;
}

/** Ids already in the personal registry, and the specs behind them. */
function alreadyHere() {
  const rows = readUserConfig().config.projects ?? [];
  return {
    ids: new Set(rows.map((p) => p?.id).filter(Boolean)),
    specs: new Set(rows.filter((p) => p?.spec).map((p) => canon(expand(String(p.spec))))),
  };
}

export async function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      only: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  const at = positionals[0];
  if (!at) {
    console.error('walkdown import needs a path to a project.');
    console.error(HELP);
    return end(2);
  }
  const dir = canon(expand(at, process.cwd()));
  if (!existsSync(dir)) {
    console.error(red(`${at} does not exist.`));
    return end(2);
  }
  let found;
  try {
    found = declaredIn(dir);
  } catch (e) {
    console.error(red(e.message));
    return end(2);
  }
  if (found === null) {
    console.error(
      red(`Nothing at ${at} declares a blueprint — there is no .walkdown/config.yml there.`),
    );
    console.error(dim('  `walkdown init` inside that project starts one.'));
    return end(2);
  }
  if (!found.length) {
    console.error(red(`${at} has a .walkdown, but it declares no blueprint walkdown can read.`));
    return end(2);
  }

  const here = alreadyHere();
  const fresh = found.filter((b) => !here.specs.has(b.spec));
  const known = found.filter((b) => here.specs.has(b.spec));

  if (!fresh.length) {
    console.log(`${dim('· already imported')} ${found.length} blueprint(s) from ${tilde(dir)}`);
    return end(0);
  }

  /*
   * Which of them. A project holding one is not a question worth asking; two
   * or more is the person's call, and an import that took everything by
   * default is exactly the "I did not ask for these" the registry exists to
   * prevent. Non-interactive and unasked, it prints what it found and stops -
   * a script that meant `--all` can say so.
   */
  let chosen = fresh;
  if (values.only) {
    const want = new Set(values.only.split(',').map((s) => s.trim()).filter(Boolean));
    chosen = fresh.filter((b) => want.has(b.id));
    const missing = [...want].filter((id) => !fresh.some((b) => b.id === id));
    if (missing.length) {
      console.error(red(`${tilde(dir)} declares no blueprint called ${missing.join(', ')}.`));
      console.error(dim(`  it declares: ${fresh.map((b) => b.id).join(', ')}`));
      return end(2);
    }
  } else if (!values.all && fresh.length > 1) {
    if (!process.stdin.isTTY) {
      console.log(`${tilde(dir)} declares ${fresh.length} blueprints:`);
      for (const b of fresh) console.log(`  ${b.id}${b.description ? dim(` — ${b.description}`) : ''}`);
      console.error(yellow('\nSay which: --all, or --only <ids>.'));
      return end(2);
    }
    console.log(`${tilde(dir)} declares ${fresh.length} blueprints:`);
    fresh.forEach((b, i) => {
      console.log(`  ${i + 1}. ${b.id}${b.description ? dim(` — ${b.description}`) : ''}`);
    });
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const said = (await rl.question('\nImport which? (numbers, or "all") ')).trim();
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
          .filter((n) => n >= 1 && n <= fresh.length),
      );
      chosen = fresh.filter((_, i) => picked.has(i + 1));
    }
    if (!chosen.length) {
      console.log(dim('nothing imported'));
      return end(0);
    }
  }

  const taken = new Set(here.ids);
  const written = [];
  for (const bp of chosen) {
    const homeDir = resolve(bp.spec, '..');
    if (basename(bp.spec) !== HOME_LAYOUT.spec) {
      console.error(
        red(`${bp.spec} is not a home's ${HOME_LAYOUT.spec}/ — walkdown reads a home, not a bare spec directory.`),
      );
      return end(2);
    }
    /*
     * The blueprint's own id first, since that is what its people call it.
     * Where this machine already has that name, the project's directory
     * disambiguates before a number does: `acme-shop-checkout` says where it
     * came from and `checkout-2` says nothing at all.
     */
    let id = bp.id;
    if (taken.has(id)) id = `${basename(dir)}-${bp.id}`;
    for (let n = 2; taken.has(id); n++) id = `${basename(dir)}-${bp.id}-${n}`;
    taken.add(id);
    try {
      const row = rememberProject({
        id,
        root: null, // reachable by name and by the server; it shadows nothing
        homeDir,
        home: null,
        inRepo: false,
        extra: { imported: { project: tilde(dir), at: new Date().toISOString() } },
      });
      written.push({ ...bp, id: row.id, path: row.path });
    } catch (e) {
      console.error(red(e.message));
      return end(2);
    }
  }

  // Claims are indexed at import, so routing never has to load a spec (ADR
  // 0001 §5). `serve` rebuilds it; this is what makes the first serve cheap.
  const index = refreshIndex();

  if (values.json) {
    console.log(
      JSON.stringify(
        { project: tilde(dir), imported: written.map((w) => ({ id: w.id, spec: w.spec })), indexed: index.blueprints.length },
        null,
        2,
      ),
    );
    return end(0);
  }
  console.log(`${green('imported')} from ${tilde(dir)}`);
  for (const w of written) console.log(`  ${green('+')} ${w.id}  ${dim(w.spec)}`);
  for (const k of known) console.log(`  ${dim(`· already listed  ${k.id}`)}`);
  const skipped = fresh.filter((b) => !written.some((w) => w.spec === b.spec));
  for (const s of skipped) console.log(`  ${dim(`· not imported    ${s.id}`)}`);
  console.log(dim(`\n  ${index.blueprints.length} blueprint(s) indexed · walkdown projects lists them`));
  return end(0);
}
