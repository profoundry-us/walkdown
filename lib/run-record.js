import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatHash } from './hash.js';

/** fail > blocked > pass > skipped: one failing check fails the rule. */
const PRECEDENCE = ['fail', 'blocked', 'pass', 'skipped'];

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
 */
export function writeRunRecord({ blueprintDir, target, baseUrl, actor, kind = 'checks', perTest, rulesById, results, date = new Date() }) {
  const runsDir = join(blueprintDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const runId = nextRunId(runsDir, target, date);
  const sha = gitSha(blueprintDir);
  const record = {
    run_id: runId,
    created: date.toISOString().replace(/\.\d+Z$/, 'Z'),
    actor,
    kind,
    target,
    ...(baseUrl && { base_url: baseUrl }),
    ...(sha && { git_sha: sha, blueprint_sha: sha }),
    results: results ?? aggregateResults(perTest, rulesById),
  };
  const file = join(runsDir, `${runId}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  return { file, record };
}
