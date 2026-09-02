/*
 * Pin the personal home for a test file, so no suite can write into whoever
 * ran it (n-0137).
 *
 * Several suites build fixture blueprints and then serve them, or spawn the
 * CLI at them. Locations resolve from `~/.walkdown/config.yml`, so an
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse, stringify } from '../vendor/yaml.js';

process.env.WALKDOWN_HOME ??= mkdtempSync(join(tmpdir(), 'walkdown-test-home-'));

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
 * Declare a fixture blueprint, and hand back the id to reach it by.
 *
 * `--dir <path>` is gone: everything walkdown answers for is written down,
 * because a blueprint reachable without an entry was a blueprint with no home
 * of its own, which is where six collisions came from (n-0156). Fixtures are
 * no exception - a test that reached a blueprint no config knew about was
 * testing a door that no longer exists.
 */
export function declareProject(home, spec, id = 'fixture') {
  /*
   * The home passed in, and it must be THIS suite's own.
   *
   * `node --test` runs files in parallel processes, so two suites declaring
   * into one config.yml are a read-modify-write race: the last writer wins and
   * the other's entry vanishes, which fails a suite only when another suite
   * happens to be running beside it. `suiteHome()` is how a file gets one of
   * its own; the shared pinned home is for reading, not for declaring into.
   */
  mkdirSync(home, { recursive: true });
  const path = join(home, 'config.yml');
  const doc = existsSync(path) ? (parse(readFileSync(path, 'utf8')) ?? {}) : {};
  const projects = doc.projects ?? [];
  const already = projects.find((p) => p?.spec === spec);
  if (already) return already.id;
  const taken = new Set(projects.map((p) => p?.id).filter(Boolean));
  let pick = id;
  for (let n = 2; taken.has(pick); n++) pick = `${id}-${n}`;
  projects.push({
    id: pick,
    roots: [dirname(spec)],
    spec,
    runs: join(spec, 'runs'),
    threads: join(spec, 'threads'),
  });
  doc.projects = projects;
  writeFileSync(path, stringify(doc));
  return pick;
}

/**
 * A personal home for one test file, so declaring into it races with nobody.
 * Carries an identity, because writes are recorded under one and a machine
 * with only a guess is refused anything a person must sign (n-0143).
 */
export function suiteHome(name, username = 'A Test Person') {
  const home = mkdtempSync(join(tmpdir(), `walkdown-${name}-`));
  writeFileSync(
    join(home, 'config.yml'),
    `identity:\n  username: ${username}\n  name: ${username}\n`,
  );
  return home;
}
