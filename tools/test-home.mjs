/*
 * Pin the personal home for a test file, so no suite can write into whoever
 * ran it (n-0137).
 *
 * Several suites build fixture blueprints and then serve them, or spawn the
 * CLI at them. Locations resolve from `~/.walkdown/registry.yml`, so an
 * unpinned run files their drafts, their evidence and - since the config
 * became the only list - their PROJECT ENTRIES into the developer's own home.
 * Thirteen dead entries accumulated there on 2026-09-01 from three runs.
 *
 * `npm test` and `runner.run_all` pin it, but that guards the callers
 * somebody wrote down. A bare `node --test test/serve.test.js` is a thing
 * people type, and it should not depend on remembering. Importing this is
 * how a suite stops depending on its caller:
 *
 *     import '../tools/test-home.mjs';
 *
 * `??=`, so a caller that pinned deliberately still wins - the runner's
 * `tmp/test-home` keeps working, and a suite that pins its own scratch
 * home per case (locations.test.js) is unaffected either way.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parse, stringify } from '../vendor/yaml.js';

/*
 * One home PER PROCESS, under whatever the caller pinned. The registry is the
 * only door now (ADR 0003): every fixture a suite reaches is a row in
 * `$WALKDOWN_HOME/registry.yml`, and `node --test` runs files in parallel
 * processes - so two suites sharing one home are a read-modify-write race on
 * the registry, the last writer wins, and a fixture vanishes only when
 * another suite happens to be running beside it. `npm test` still pins
 * `tmp/test-home`; each suite gets a directory of its own inside it.
 */
const pinned = process.env.WALKDOWN_HOME ?? tmpdir();
mkdirSync(pinned, { recursive: true });
process.env.WALKDOWN_HOME = mkdtempSync(join(pinned, 'suite-'));
// And taken away when the suite is done: forty of these per `npm test`
// would otherwise pile up under tmp/test-home between runs.
const own = process.env.WALKDOWN_HOME;
process.on('exit', () => rmSync(own, { recursive: true, force: true }));

/*
 * And the SKILLS home, for the same reason one directory over.
 *
 * `scaffold` installs the agent procedures into the person's own
 * `~/.claude/skills` whenever the spec is not committed - which is the right
 * default and the rule, and which means a suite that scaffolds a fixture
 * reaches a directory outside its own temp tree. Nothing was overwritten when
 * this was noticed (a copy the person has edited is kept, and identical ones
 * report up-to-date), but "it happened not to overwrite anything" is not the
 * guarantee to rely on: a machine missing one of them would have had it
 * created by running the tests. This is n-0137 again, one directory over.
 */
process.env.WALKDOWN_SKILLS_DIR ??= join(process.env.WALKDOWN_HOME, 'skills');

/*
 * A registry row, written the way `import` writes one (ADR 0014 §2): an ID
 * `NNNN-pc-name` from the registry's own counter, the project's label and
 * code, the checkout it belongs to - null for an ephemeral copy, reached by
 * its ID only. A second fixture in a checkout already listed joins its
 * project; a new checkout gets a label and code no other project has.
 *
 * The ID comes back. Inside its checkout `name` reaches it too, the way a
 * person types `--blueprint cli` for `0002-wd-cli`.
 */
export function register({ id: name, project: checkout, homeDir, ephemeral = null, label = null, code = null }) {
  const home = process.env.WALKDOWN_HOME;
  mkdirSync(home, { recursive: true });
  const path = join(home, 'registry.yml');
  const doc = existsSync(path) ? (parse(readFileSync(path, 'utf8')) ?? {}) : {};
  const listed = doc.blueprints ?? [];
  const already = listed.find((p) => p?.home === homeDir);
  if (already) return already.id;
  const top = Math.max(0, ...listed.map((r) => Number(String(r?.id).match(/^(\d{4})-/)?.[1] ?? 0)));
  const n = Math.max(Number(doc.next) || 1, top + 1);
  const mine = checkout && !ephemeral ? listed.find((r) => r?.checkout === checkout && !r.ephemeral) : null;
  let pl = mine?.project ?? label;
  let pc = mine?.code ?? code;
  if (ephemeral) {
    pl = null;
    pc = 'tmp';
  } else if (!mine) {
    const labels = new Set(listed.map((r) => r?.project).filter(Boolean));
    const codes = new Set(listed.map((r) => r?.code).filter(Boolean));
    const base = pl ?? (checkout ? basename(checkout) : 'personal');
    pl = base;
    for (let k = 2; labels.has(pl); k++) pl = `${base}-${k}`;
    if (!pc) {
      pc = 'fx';
      for (let k = 0; codes.has(pc); k++) pc = `f${k.toString(36).padStart(2, '0')}`.slice(0, 3);
    }
  }
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'blueprint';
  const id = `${String(n).padStart(4, '0')}-${pc}-${slug}`;
  listed.push({
    id,
    project: pl,
    code: pc,
    checkout: ephemeral ? null : (checkout ?? null),
    home: homeDir,
    registered: { by: 'import', at: new Date().toISOString() },
    ...(ephemeral ? { ephemeral } : {}),
  });
  doc.next = n + 1;
  doc.blueprints = listed;
  writeFileSync(path, stringify(doc));
  return id;
}

/*
 * Register a fixture blueprint into a given personal home, and hand back its
 * ID. The home passed in must be THIS suite's own: `node --test` runs files
 * in parallel processes, and two suites registering into one registry are a
 * read-modify-write race. `suiteHome()` is how a file gets one of its own.
 *
 * `spec` is the home itself now (ADR 0014 §5): spec.yml, storyboard.yml and
 * features/ with threads, runs, evidence and drafts beside them. A fixture
 * standing under some `<root>/.walkdown/blueprints/` belongs to that root;
 * one standing anywhere else is registered with no checkout, the way a
 * person's own blueprint is.
 */
export function declareProject(home, spec, id = 'fixture') {
  if (basename(spec) === 'blueprint')
    throw new Error(`declareProject: ${spec} is a blueprint/ folder — homes are flat now, with spec.yml in the home itself`);
  const homeDir = spec;
  for (const kind of ['threads', 'runs', 'evidence', 'drafts']) mkdirSync(join(homeDir, kind), { recursive: true });
  const m = homeDir.match(/^(.*)\/\.walkdown\/blueprints\/[^/]+$/);
  const was = process.env.WALKDOWN_HOME;
  process.env.WALKDOWN_HOME = home;
  try {
    return register({ id, project: m ? m[1] : null, homeDir });
  } finally {
    process.env.WALKDOWN_HOME = was;
  }
}

/**
 * A registered blueprint inside its own repository-style root: its home is
 * `<root>/.walkdown/blueprints/0001-<id>/`, flat, with the four kinds of
 * record laid out beside the spec. Hands back every path, so a suite writes
 * `h.runs` and loads with `loadBlueprint(h.spec, { cwd: h.root })` - the
 * same door a person's checkout goes through.
 *
 * A second call with a new id makes a second home beside the first
 * (`0002-<id>`), in the same project, for suites that need two blueprints in
 * one tree.
 */
export function declaredHome(root, id = 'fixture') {
  const wd = join(root, '.walkdown');
  const blueprints = join(wd, 'blueprints');
  mkdirSync(blueprints, { recursive: true });
  const n = String(readdirSync(blueprints).length + 1).padStart(4, '0');
  const home = `${n}-${id}`;
  const homeDir = join(blueprints, home);
  const kinds = { spec: '.', threads: 'threads', runs: 'runs', evidence: 'evidence', drafts: 'drafts' };
  const paths = Object.fromEntries(Object.entries(kinds).map(([k, d]) => [k, d === '.' ? homeDir : join(homeDir, d)]));
  for (const p of Object.values(paths)) mkdirSync(p, { recursive: true });
  const rid = register({ id, project: root, homeDir });
  return { root, wd, id: rid, name: id, home, homeDir, ...paths };
}

/**
 * A personal home for one test file, so registering into it races with
 * nobody. Carries an identity in its profile, because writes are recorded
 * under one and a machine with only a guess is refused anything a person
 * must sign (n-0143).
 */
export function suiteHome(name, username = 'A Test Person') {
  const home = mkdtempSync(join(tmpdir(), `walkdown-${name}-`));
  writeFileSync(
    join(home, 'profile.yml'),
    `identity:\n  username: ${username}\n  name: ${username}\n`,
  );
  return home;
}

/**
 * The file holding a thread, by its label or its UUID (ADR 0014 §9). A
 * thread's file is named by its UUID now, so a suite that knows `n-0001`
 * finds it by what the file says; an older fixture's `n-0001.yml` is found
 * by its name. The path before the name is joined, as `join` would.
 */
export function threadAt(...parts) {
  const name = parts.pop();
  const dir = join(...parts);
  if (existsSync(dir))
    for (const f of readdirSync(dir)) {
      if (!/\.ya?ml$/.test(f)) continue;
      if (f === `${name}.yml`) return join(dir, f);
      const text = readFileSync(join(dir, f), 'utf8');
      if (new RegExp(`^(id|uuid): ['"]?${String(name).replace(/[.]/g, '\\.')}['"]?$`, 'm').test(text)) return join(dir, f);
    }
  return join(dir, `${name}.yml`);
}
