import { collectRules, verifyList } from './blueprint.js';
import { hashMatches } from './hash.js';

const TERMINAL_THREAD_STATUSES = ['incorporated', 'verified', 'waived'];
const BACKTICK_TOKEN = /`([A-Za-z0-9][A-Za-z0-9._-]*)`/g;

/**
 * The rule's screen progression, derived from its steps: screens in the order
 * the steps mention them (given → when → then), consecutive repeats collapsed.
 * The last entry is where the flow ends — where the rule's outcome is
 * observable — so it's the navigation target. A flow may legitimately revisit
 * a screen (join → confirm → join) and the progression shows that honestly.
 */
export function screenFlow(rule, screenIds) {
  const flow = [];
  for (const phase of ['given', 'when', 'then']) {
    for (const step of rule.steps?.[phase] ?? []) {
      for (const m of String(step).matchAll(BACKTICK_TOKEN)) {
        if (screenIds.has(m[1]) && flow.at(-1) !== m[1]) flow.push(m[1]);
      }
    }
  }
  return flow;
}

/**
 * Derive per-rule verification status from the runs ledger. Status is never
 * stored: every cell is "the latest relevant run result" for that rule and
 * evidence source, per docs/05-runs-ledger.md.
 *
 * Cell states: na (evidence type not required, or target outside the rule's
 * environments) · never (required but no run touches it) · pass · fail ·
 * skipped · blocked · stale (a pass whose recorded statement_hash no longer
 * matches the rule's current statement).
 *
 * A verdict is a claim about a PLACE. Every run records the base_url it ran
 * against, and only runs made against a target's current address count toward
 * it — point a target somewhere new and its evidence empties out, which is the
 * whole point: nobody should inherit a pass earned on a system that no longer
 * exists. Nothing is deleted to achieve this; the ledger stays append-only and
 * the old runs still describe the address they were made against.
 *
 * A run that recorded NO base_url is taken at face value, because it cannot be
 * shown to belong somewhere else — the same courtesy the ledger already
 * extends to a result carrying no statement_hash. Unit-test runners legitimately
 * have no address; browser runners record one.
 */
export function deriveStatus(blueprint, { target, checkRefs } = {}) {
  const { config, features, threads, runs } = blueprint;
  const rules = collectRules(features).filter((r) => r.rule?.id);
  const screenIdSet = new Set(
    (blueprint.storyboard?.screens ?? []).map((s) => s?.id).filter(Boolean)
  );

  let targets = Object.keys(config?.runner?.targets ?? {});
  if (!targets.length)
    targets = [...new Set(runs.map((r) => r.data?.target).filter(Boolean))];
  if (target) targets = targets.filter((t) => t === target);

  // Where each target currently points. A run against a different address is
  // evidence about a different system, so it does not fill this target's cells.
  const addressOf = (t) => config?.runner?.targets?.[t]?.base_url ?? null;
  const inPlace = (run) => {
    const want = addressOf(run?.target);
    if (!want || !run?.base_url) return true;
    return run.base_url === want;
  };

  // Walkdown verdicts are per-target too. The judgment "this is built right"
  // was made while looking at one system, and cannot speak for another - which
  // is why these used to overwrite each other across environments.
  const primary = target ?? targets[0] ?? null;

  // Later runs win: walk the ledger in created-order and let entries overwrite.
  const sorted = [...runs].sort((a, b) =>
    String(a.data?.created ?? '').localeCompare(String(b.data?.created ?? ''))
  );
  const checkCells = new Map(); // "ruleId\0target" -> entry
  const agentCells = new Map(); // "ruleId\0target" -> entry (latest agent walkdown)
  const humanCells = new Map(); // "ruleId\0target" -> entry (latest human walkdown)
  for (const { data: run } of sorted) {
    if (!inPlace(run)) continue;
    for (const res of run?.results ?? []) {
      if (!res?.rule) continue;
      const entry = {
        status: res.status,
        statementHash: res.statement_hash ?? null,
        actor: run.actor,
        runId: run.run_id,
        created: run.created ?? null,
        checks: res.checks ?? [],
        evidence: res.evidence ?? [],
        detail: res.message ?? res.reasoning ?? res.reason ?? null,
        threads: res.threads ?? [],
      };
      if (run.kind === 'checks') checkCells.set(`${res.rule}\0${run.target}`, entry);
      else if (run.kind === 'walkdown')
        (run.actor === 'agent' ? agentCells : humanCells).set(`${res.rule}\0${run.target}`, entry);
    }
  }

  /*
   * A checks pass is only as good as the check behind it. Every result records
   * which checks produced it, and a suite can lose one - deleted, renamed, or
   * (the case that started this) untagged because it never exercised the rule
   * it claimed. The ledger is append-only, so the old pass keeps winning and
   * the cell keeps reading green long after nothing tests it.
   *
   * So when the caller supplies the current inventory of rule ids the check
   * suite references, a checks pass for a rule nothing references any more goes
   * stale - exactly as a pass goes stale when the statement moves. Callers
   * without the inventory get the old behaviour, because absence of the list is
   * not evidence that a suite is empty.
   *
   * Matched on rule id rather than the recorded refs themselves: those carry
   * line numbers, which move whenever anyone edits the file above them.
   */
  /*
   * An EMPTY inventory is not evidence that nothing is checked - it is far more
   * likely that the scan looked in the wrong place. A blueprint served from a
   * copy, or read from outside the project it belongs to, finds no check files
   * at all, and treating that as "no check claims this rule" quietly turned
   * every checks pass stale at once. Absence of the list and an empty list mean
   * the same thing here: we do not know, so we do not touch the verdict.
   */
  const uncovered = (entry, rule, kind) =>
    kind === 'checks' && checkRefs?.size && entry.status === 'pass' && !checkRefs.has(rule.id);

  const toCell = (entry, rule, kind) => {
    if (!entry) return { state: 'never' };
    // An approval is of the statement as written, so it goes stale the same
    // way a pass does when the statement moves on.
    const stale =
      (['pass', 'approved'].includes(entry.status) &&
        entry.statementHash &&
        !hashMatches(entry.statementHash, rule.statement)) ||
      uncovered(entry, rule, kind);
    return {
      state: stale ? 'stale' : entry.status,
      actor: entry.actor,
      runId: entry.runId,
      created: entry.created,
      checks: entry.checks,
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
      else cells[t] = toCell(checkCells.get(`${rule.id}\0${t}`), rule, 'checks');
    }
    const at = `${rule.id}\0${primary}`;
    const agent = verify.includes('agent') ? toCell(agentCells.get(at), rule) : { state: 'na' };
    const human = verify.includes('human') ? toCell(humanCells.get(at), rule) : { state: 'na' };

    // The sign-off state, read past the verify gate so a checks-only rule's
    // approval still shows. A hash-stale approval yields null - rewording
    // the statement asks for a fresh sign-off.
    const signed = humanCells.get(at);
    const signoff =
      signed && ['approved', 'refining'].includes(signed.status) &&
      !(signed.status === 'approved' && signed.statementHash &&
        !hashMatches(signed.statementHash, rule.statement))
        ? signed.status
        : null;

    const openThreads = threads
      .filter(
        (t) => t.data?.anchor?.rule === rule.id && !TERMINAL_THREAD_STATUSES.includes(t.data?.status)
      )
      .map((t) => ({ id: t.data.id, status: t.data.status }));

    // Verdict: pass when every required evidence type has a current pass
    // (checks: every applicable target); fail on any fail; else pending.
    // Sign-off states are neither - approving a spec never verifies a build.
    const applicable = [...Object.values(cells), agent, human].filter((c) => c.state !== 'na');
    let verdict;
    if (applicable.some((c) => c.state === 'fail')) verdict = 'fail';
    else if (applicable.length && applicable.every((c) => c.state === 'pass')) verdict = 'pass';
    else verdict = 'pending';

    // Built: the ledger holds a real build verdict - a pass or fail from
    // checks or judgment ('stale' was a pass). Sign-off records, skips and
    // blocks are not build evidence, so an approved rule stays unbuilt until
    // something actually verifies against it.
    const built = applicable.some((c) => ['pass', 'fail', 'stale'].includes(c.state));

    return {
      rule: rule.id,
      story: story?.id,
      statement: rule.statement,
      steps: rule.steps
        ? Object.fromEntries(
            ['given', 'when', 'then'].filter((ph) => rule.steps[ph]?.length).map((ph) => [ph, rule.steps[ph]])
          )
        : null,
      screens: rule.screens ?? [],
      flow: screenFlow(rule, screenIdSet),
      verify,
      verdict,
      built,
      signoff,
      cells,
      agent,
      human,
      threads: openThreads,
    };
  });

  // Drift: where the spec has gotten ahead of its sources. Derived, never stored.
  const activeFor = (screenId) =>
    threads
      .filter((t) => t.data?.anchor?.screen === screenId && !TERMINAL_THREAD_STATUSES.includes(t.data?.status))
      .map((t) => t.data.id);
  const drift = {
    design: (blueprint.storyboard?.screens ?? [])
      .filter((s) => s?.id && !s.prototype)
      .map((s) => ({ screen: s.id, proposal: s.proposal ?? null, requests: activeFor(s.id) })),
    sources: rules
      .filter(({ rule }) => typeof rule.origin === 'string' && !['prd', 'prototype'].includes(rule.origin))
      .map(({ rule }) => ({ rule: rule.id, origin: rule.origin })),
  };

  // Attention: who is blocking what, derived from rows and thread states.
  // human: judge (a rule needs a human walkdown), verify (a fix awaits acceptance),
  //        answer (an open question awaits one).
  // agent: address (an open note is unclaimed work), incorporate (an answer
  //        awaits folding into the rule), cover (a rule demands checks and the
  //        suite has none for it).
  const attention = [];
  for (const row of rows) {
    // A rule owes the human a sign-off (unbuilt, unsigned) or a walkdown
    // (built, unjudged). A sign-off already given discharges the queue until
    // the build lands - approving a spec is not judging a build, so once
    // built the rule owes a real walkdown even though its cell says approved.
    const owes = row.built
      ? ['never', 'stale', 'approved', 'refining'].includes(row.human.state)
      : ['never', 'stale'].includes(row.human.state) && !row.signoff;
    if (row.verify.includes('human') && owes)
      attention.push({ who: 'human', action: 'judge', rule: row.rule });

    /*
     * A rule demanding checks that nothing checks is work for whoever writes
     * checks, not for the person waiting to judge one. Before this, an
     * uncovered rule queued to the human as "judge" and the missing check was
     * nobody's item - the loudest channel pointed at the wrong party.
     *
     * Only claimed when the inventory is known: without it, every rule would
     * look uncovered and the queue would fill with imaginary work.
     */
    if (checkRefs && row.verify.includes('checks') && !checkRefs.has(row.rule)) {
      const applicable = targets.some((t) => row.cells[t]?.state !== 'na');
      if (applicable) attention.push({ who: 'agent', action: 'cover', rule: row.rule });
    }
  }
  for (const { data: t } of threads) {
    if (!t?.id) continue;
    const rule = t.anchor?.rule ?? null;
    if (t.status === 'addressed') attention.push({ who: 'human', action: 'verify', thread: t.id, rule });
    else if (t.kind === 'question' && t.status === 'open')
      attention.push({ who: 'human', action: 'answer', thread: t.id, rule });
    else if (t.kind === 'note' && t.status === 'open')
      attention.push({ who: 'agent', action: 'address', thread: t.id, rule });
    else if (t.status === 'answered')
      attention.push({ who: 'agent', action: 'incorporate', thread: t.id, rule });
  }

  return { targets, rows, drift, attention };
}
