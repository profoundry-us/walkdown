import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatHash, specHash } from './hash.js';
import { resolveLocations } from './locations.js';

/** fail > blocked > pass > skipped: one failing check fails the rule. */
const PRECEDENCE = ['fail', 'blocked', 'pass', 'skipped'];

/*
 * The roles a person can sign a walkdown in.
 *
 * A closed vocabulary on purpose. Acceptance is derived by matching a rule's
 * `signoff` list against the roles a run was recorded under, so a typo is not
 * a harmless string - it is a signature that silently satisfies nothing, on a
 * rule that then waits forever for a person who has already signed it. A team
 * adding a role adds it here, once, where both ends can see it.
 *
 * QA is deliberately absent: the agent walkdown is QA (docs/00-vision.md, "the
 * tiers are a ladder"), and it is a tier rather than a signature.
 */
export const ROLES = ['eng', 'product', 'design'];

/*
 * The roles on a record, or null for "none stated".
 *
 * Null and an empty list mean the same thing, and both mean absent rather than
 * "nobody": a run carrying no roles is read as engineering's (lib/status.js),
 * because historically the person signing a walkdown was the developer. So an
 * emptied control must not write `roles: []` into the ledger and invent a
 * distinction nothing downstream honours.
 */
export function normalizeRoles(roles) {
  if (roles == null) return null;
  if (!Array.isArray(roles)) throw new Error('roles must be an array');
  const seen = [];
  for (const raw of roles) {
    const role = String(raw ?? '').trim();
    if (!role) continue;
    if (!ROLES.includes(role))
      throw new Error(`unknown role "${role}" (expected ${ROLES.join('|')})`);
    if (!seen.includes(role)) seen.push(role);
  }
  return seen.length ? seen : null;
}

/**
 * Aggregate per-test entries ({ ruleId, status, durationMs, check, evidence })
 * into one result per rule, stamping the rule's *current* statement_hash so
 * status can later detect staleness. Unknown rule ids are still recorded
 * (lint and status will flag them) — just without a hash.
 */
export function aggregateResults(perTest, rulesById) {
  const byRule = new Map();
  for (const entry of perTest) {
    const agg = byRule.get(entry.ruleId) ?? {
      rule: entry.ruleId, status: 'skipped', duration_ms: 0, checks: [], evidence: [] };
    if (PRECEDENCE.indexOf(entry.status) < PRECEDENCE.indexOf(agg.status)) agg.status = entry.status;
    agg.duration_ms += entry.durationMs ?? 0;
    if (entry.check && !agg.checks.includes(entry.check)) agg.checks.push(entry.check);
    for (const e of entry.evidence ?? []) if (!agg.evidence.includes(e)) agg.evidence.push(e);
    byRule.set(entry.ruleId, agg);
  }

  return [...byRule.values()].map((agg) => {
    const rule = rulesById.get(agg.rule);
    const result = { rule: agg.rule, status: agg.status };
    if (rule?.statement && (agg.status === 'pass' || agg.status === 'fail'))
      result.statement_hash = formatHash(rule.statement);
    result.duration_ms = agg.duration_ms;
    if (agg.checks.length) result.checks = agg.checks;
    if (agg.evidence.length) result.evidence = agg.evidence;
    return result;
  });
}

/** Short git sha of `cwd`, with a "-dirty" suffix for an unclean tree; null without git. */
export function gitSha(cwd) {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    const dirty = execSync('git status --porcelain', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}

/*
 * A hash of the uncommitted changes, so two runs on a dirty tree can be told
 * apart. Most runs happen mid-edit, so `<sha>-dirty` is the common case and it
 * means "some unknown superset of that commit" - you cannot check it out and
 * you cannot tell two of them apart. This answers the question people actually
 * ask, which is whether two runs were against identical code.
 *
 * Null on a clean tree, where the sha already says everything.
 */
export function treeHash(cwd) {
  try {
    const diff = execSync('git diff HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    if (!diff.trim()) return null;
    return 'sha256:' + createHash('sha256').update(diff, 'utf8').digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

/** Timestamped id unique within runsDir: <ISO-with-dashes>-<target>-<NN>. */
export function nextRunId(runsDir, target, date) {
  const ts = date.toISOString().replace(/\.\d+Z$/, 'Z').replaceAll(':', '-');
  const prefix = `${ts}-${target}-`;
  const existing = existsSync(runsDir)
    ? readdirSync(runsDir).filter((f) => f.startsWith(prefix)).length
    : 0;
  return `${prefix}${String(existing + 1).padStart(2, '0')}`;
}

/**
 * Build and append one run record to <blueprintDir>/runs/. Returns the file path.
 * Pass `perTest` + `rulesById` for checks runs (aggregated + hash-stamped), or
 * prebuilt `results` for walkdown sessions.
 *
 * `roles` is which hats the signer was wearing, and it is recorded on the RUN
 * rather than looked up from whoever the signer is today: people change teams,
 * and a signature does not stop meaning what it meant when it was given.
 */
export function writeRunRecord({ blueprintDir, target, baseUrl, actor, roles, kind = 'checks', perTest, rulesById, results, date = new Date() }) {
  const signedAs = normalizeRoles(roles);
  const runsDir = resolveLocations({ dir: blueprintDir }).runs.path;
  mkdirSync(runsDir, { recursive: true });
  const runId = nextRunId(runsDir, target, date);
  const sha = gitSha(blueprintDir);
  const tree = treeHash(blueprintDir);
  const spec = specHash(blueprintDir);
  const record = {
    run_id: runId,
    created: date.toISOString().replace(/\.\d+Z$/, 'Z'),
    actor,
    ...(signedAs && { roles: signedAs }),
    kind,
    target,
    ...(baseUrl && { base_url: baseUrl }),
    ...(sha && { git_sha: sha }),
    ...(tree && { tree_hash: tree }),
    ...(spec && { spec_hash: spec }),
    results: results ?? aggregateResults(perTest, rulesById),
  };
  const file = join(runsDir, `${runId}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  return { file, record };
}

/*
 * Declare a sweep: a marker saying that from here, the tiers it names must
 * earn their verdicts again.
 *
 * It is a run record like any other - same directory, same id scheme, append
 * only - because that is what makes it survive, travel with the repo, and show
 * up in the history beside the runs it supersedes. It carries no results,
 * because it is not evidence about any rule; it is a statement about when we
 * stopped trusting the evidence we had.
 *
 * The reason is required rather than optional. A sweep puts work back on the
 * queue for every rule at once, and six weeks later the only person who can
 * say whether that was warranted is the one reading the marker.
 */
export function writeSweep({ blueprintDir, target, tiers, why, actor, date = new Date() }) {
  if (!why || !String(why).trim()) throw new Error('a sweep needs a reason');
  if (!tiers?.length) throw new Error('a sweep needs at least one tier');
  const runsDir = resolveLocations({ dir: blueprintDir }).runs.path;
  mkdirSync(runsDir, { recursive: true });
  const runId = nextRunId(runsDir, target, date);
  const sha = gitSha(blueprintDir);
  const tree = treeHash(blueprintDir);
  const spec = specHash(blueprintDir);
  const record = {
    run_id: runId,
    created: date.toISOString().replace(/\.\d+Z$/, 'Z'),
    actor,
    kind: 'sweep',
    target,
    tiers: [...tiers],
    why: String(why).trim(),
    ...(sha && { git_sha: sha }),
    ...(tree && { tree_hash: tree }),
    ...(spec && { spec_hash: spec }),
    results: [],
  };
  const file = join(runsDir, `${runId}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  return { file, record };
}
