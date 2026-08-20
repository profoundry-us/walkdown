import { collectRules, verifyList } from './blueprint.js';
import { hashMatches } from './hash.js';

const TERMINAL_THREAD_STATUSES = ['incorporated', 'verified', 'waived'];

/**
 * Derive per-rule verification status from the runs ledger. Status is never
 * stored: every cell is "the latest relevant run result" for that rule and
 * evidence source, per docs/05-runs-ledger.md.
 *
 * Cell states: na (evidence type not required, or target outside the rule's
 * environments) · never (required but no run touches it) · pass · fail ·
 * skipped · blocked · stale (a pass whose recorded statement_hash no longer
 * matches the rule's current statement).
 */
export function deriveStatus(blueprint, { target } = {}) {
  const { config, features, threads, runs } = blueprint;
  const rules = collectRules(features).filter((r) => r.rule?.id);

  let targets = Object.keys(config?.runner?.targets ?? {});
  if (!targets.length)
    targets = [...new Set(runs.map((r) => r.data?.target).filter(Boolean))];
  if (target) targets = targets.filter((t) => t === target);

  // Later runs win: walk the ledger in created-order and let entries overwrite.
  const sorted = [...runs].sort((a, b) =>
    String(a.data?.created ?? '').localeCompare(String(b.data?.created ?? ''))
  );
  const checkCells = new Map(); // "ruleId\0target" -> entry
  const agentCells = new Map(); // ruleId -> entry (latest agent walkdown)
  const humanCells = new Map(); // ruleId -> entry (latest human walkdown)
  for (const { data: run } of sorted) {
    for (const res of run?.results ?? []) {
      if (!res?.rule) continue;
      const entry = {
        status: res.status,
        statementHash: res.statement_hash ?? null,
        actor: run.actor,
        runId: run.run_id,
        created: run.created ?? null,
        evidence: res.evidence ?? [],
        detail: res.message ?? res.reasoning ?? res.reason ?? null,
        threads: res.threads ?? [],
      };
      if (run.kind === 'checks') checkCells.set(`${res.rule}\0${run.target}`, entry);
      else if (run.kind === 'walkdown')
        (run.actor === 'agent' ? agentCells : humanCells).set(res.rule, entry);
    }
  }

  const toCell = (entry, rule) => {
    if (!entry) return { state: 'never' };
    const stale =
      entry.status === 'pass' &&
      entry.statementHash &&
      !hashMatches(entry.statementHash, rule.statement);
    return {
      state: stale ? 'stale' : entry.status,
      actor: entry.actor,
      runId: entry.runId,
      created: entry.created,
      evidence: entry.evidence,
      detail: entry.detail,
    };
  };

  const rows = rules.map(({ rule, story }) => {
    const verify = verifyList(rule);
    const envs = rule.environments;

    const cells = {};
    for (const t of targets) {
      if (!verify.includes('checks') || (envs && !envs.includes(t))) cells[t] = { state: 'na' };
      else cells[t] = toCell(checkCells.get(`${rule.id}\0${t}`), rule);
    }
    const agent = verify.includes('agent') ? toCell(agentCells.get(rule.id), rule) : { state: 'na' };
    const human = verify.includes('human') ? toCell(humanCells.get(rule.id), rule) : { state: 'na' };

    const openThreads = threads
      .filter(
        (t) => t.data?.anchor?.rule === rule.id && !TERMINAL_THREAD_STATUSES.includes(t.data?.status)
      )
      .map((t) => ({ id: t.data.id, status: t.data.status }));

    // Verdict: pass when every required evidence type has a current pass
    // (checks: every applicable target); fail on any fail; else pending.
    const applicable = [...Object.values(cells), agent, human].filter((c) => c.state !== 'na');
    let verdict;
    if (applicable.some((c) => c.state === 'fail')) verdict = 'fail';
    else if (applicable.length && applicable.every((c) => c.state === 'pass')) verdict = 'pass';
    else verdict = 'pending';

    return {
      rule: rule.id,
      story: story?.id,
      statement: rule.statement,
      screens: rule.screens ?? [],
      verify,
      verdict,
      cells,
      agent,
      human,
      threads: openThreads,
    };
  });

  return { targets, rows };
}
