/*
 * WHERE A RECORDED RUN IS FILED (ADR 0013 §1).
 *
 * A project's test suite checks rules from every blueprint registered for
 * the project, so a recorded run is filed by RULE: each result goes to the
 * blueprint that holds its rule, one record per blueprint, all sharing one
 * run id. Before this, every reporter asked "which blueprint stands here?",
 * and with two standing there the answer was none - the run went unrecorded
 * and every rule read as unbuilt (2026-10-02).
 *
 * One blueprint, and the run is filed exactly as it always was, whatever its
 * tags say. The node reporter and the Playwright reporter file through here;
 * the RSpec formatter does the same in Ruby, reading the same answer from
 * `walkdown where --json`.
 */
import { relative, resolve } from 'node:path';
import { collectRules, loadBlueprint } from './blueprint.js';
import { canon, resolveLocations } from './locations.js';
import { nextRunId, writeRunRecord } from './run-record.js';

/**
 * The blueprints a run standing in `cwd` files into. `dir` - the spec
 * `walkdown run` passes as WALKDOWN_SPEC, or a reporter's own option -
 * narrows it to that one; the rest of the project is still read, so a result
 * for a sibling's rule can be named as set aside rather than mistaken for a
 * tag nobody holds.
 *
 * @param {{ cwd?: string, dir?: string | null }} [where]
 * @returns {{ into: { id: string, dir: string }[], project: { id: string, dir: string }[] }}
 */
export function filingTargets({ cwd = process.cwd(), dir = null } = {}) {
  const here = resolveLocations({ cwd });
  const live = (loc) => (loc.spec?.path && !loc.spec.missing ? loc.spec.path : null);
  const project = here.ambiguous
    ? here.config.registry.candidates
        .map((id) => ({ id, dir: live(resolveLocations({ cwd, blueprint: id })) }))
        .filter((b) => b.dir)
    : live(here)
      ? [{ id: here.id, dir: live(here) }]
      : [];
  if (!dir) return { into: project, project };
  const named = canon(resolve(dir));
  const inProject = project.find((b) => canon(b.dir) === named);
  return { into: [inProject ?? { id: null, dir: resolve(dir) }], project: inProject ? project : [] };
}

const rulesOf = (blueprint) =>
  new Map(
    collectRules(blueprint.features)
      .map(({ rule }) => /** @type {[string, object]} */ ([rule?.id, rule]))
      .filter(([id]) => id),
  );

/**
 * File one recorded run. `perTest` is what the reporter collected; `prepare`
 * finishes an entry for the blueprint it is being filed in - the Playwright
 * reporter copies a test's screenshots into THAT blueprint's evidence, which
 * it cannot do before it knows which blueprint holds the rule.
 *
 * Returns what was written and what was not, for the reporter to say:
 * `setAside` are results for a sibling's rule when the run was narrowed to
 * one blueprint, `unheld` are tags no blueprint in the project holds.
 *
 * @param {{ perTest: any[], target: string, actor: (dir: string) => string,
 *   baseUrl?: string | null, cwd?: string, dir?: string | null,
 *   prepare?: (entry: any, blueprintDir: string) => any, date?: Date }} run
 */
export function fileRun({ perTest, target, actor, baseUrl = null, cwd = process.cwd(), dir = null, prepare, date = new Date() }) {
  const { into, project } = filingTargets({ cwd, dir });
  if (!into.length) return { written: [], setAside: [], unheld: [], none: true };
  const loaded = into.map((b) => {
    const blueprint = loadBlueprint(b.dir);
    return { ...b, blueprint, rules: rulesOf(blueprint) };
  });
  const finish = (entry, b) => {
    const codeRoot = b.blueprint.codeRoot ?? b.blueprint.projectRoot;
    const out = prepare ? prepare({ ...entry }, b.dir) : { ...entry };
    if (out.checkFile !== undefined) {
      out.check = out.checkFile ? relative(codeRoot, out.checkFile) + (out.checkLine ? `:${out.checkLine}` : '') : null;
      delete out.checkFile;
      delete out.checkLine;
    }
    return out;
  };

  /*
   * One blueprint in the project and no narrowing to speak of: every result
   * goes to it, held or not, exactly as before there could be two.
   */
  if (loaded.length === 1 && project.length <= 1) {
    const b = loaded[0];
    const { file, record } = writeRunRecord({
      blueprintDir: b.dir,
      target,
      baseUrl,
      actor: actor(b.dir),
      perTest: perTest.map((e) => finish(e, b)),
      rulesById: b.rules,
      date,
    });
    return { written: [{ id: b.id, file, record }], setAside: [], unheld: [], none: false };
  }

  const siblings = project
    .filter((p) => !loaded.some((b) => canon(b.dir) === canon(p.dir)))
    .map((p) => rulesOf(loadBlueprint(p.dir)));
  const byBlueprint = new Map(loaded.map((b) => [b, []]));
  const setAside = new Set();
  const unheld = new Set();
  for (const entry of perTest) {
    const holder = loaded.find((b) => b.rules.has(entry.ruleId));
    if (holder) byBlueprint.get(holder).push(finish(entry, holder));
    else if (siblings.some((r) => r.has(entry.ruleId))) setAside.add(entry.ruleId);
    else unheld.add(entry.ruleId);
  }

  /*
   * One run id for every record the run writes: the same run, seen from
   * each blueprint. Counted across all of them, so it is new in each.
   */
  const ids = loaded.map((b) => nextRunId(resolveLocations({ spec: b.dir, cwd }).runs.path, target, date));
  const runId = ids.sort().at(-1);
  const written = [];
  for (const [b, entries] of byBlueprint) {
    if (!entries.length) continue;
    const { file, record } = writeRunRecord({
      blueprintDir: b.dir,
      target,
      baseUrl,
      actor: actor(b.dir),
      perTest: entries,
      rulesById: b.rules,
      runId,
      date,
    });
    written.push({ id: b.id, file, record });
  }
  return { written, setAside: [...setAside], unheld: [...unheld], none: false };
}

/** What a reporter says after filing: one line per record, and one for what went nowhere. */
export function filingLines({ written, setAside, unheld, none }, cwd = process.cwd()) {
  if (none) return ['walkdown: no blueprint (spec.yml) found — run not recorded'];
  const lines = written.map(
    ({ id, file, record }) =>
      `walkdown: recorded ${record.results.length} rule result(s)${written.length > 1 || setAside.length || unheld.length ? ` for ${id}` : ''} → ${relative(cwd, file)}`,
  );
  if (setAside.length)
    lines.push(`walkdown: set aside ${setAside.length} result(s) for another blueprint in this project — ${setAside.join(', ')}`);
  if (unheld.length)
    lines.push(`walkdown: no blueprint in this project holds ${unheld.join(', ')} — not recorded`);
  return lines;
}
