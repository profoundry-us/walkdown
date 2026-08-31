import { collectRules, excuseFor, signoffList, verifyList } from './blueprint.js';
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
/**
 * @param {{ config?: any, storyboard?: any, features: any[], threads: any[], runs: any[] }} blueprint
 * @param {{ target?: string, checkRefs?: Set<string> | null }} [opts]
 */
export function deriveStatus(blueprint, { target, checkRefs } = {}) {
  const { config, features, threads, runs } = blueprint;
  const rules = collectRules(features).filter((r) => r.rule?.id);
  const screenIdSet = new Set(
    (blueprint.storyboard?.screens ?? []).map((s) => s?.id).filter(Boolean),
  );

  let targets = Object.keys(config?.runner?.targets ?? {});
  if (!targets.length) targets = [...new Set(runs.map((r) => r.data?.target).filter(Boolean))];
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
    String(a.data?.created ?? '').localeCompare(String(b.data?.created ?? '')),
  );
  /*
   * A SWEEP is a dated marker saying "from here, earn it again".
   *
   * After something large - a refactor that moved four thousand lines, or a
   * fortnight of small changes nobody re-judged - a reviewer wants every
   * verdict earned against the code as it stands now. The ledger cannot be
   * cleared to arrange that: "no run file is edited or deleted" is a step of
   * status.derived.latest-wins, and it is the property that makes the history
   * worth having. So a sweep supersedes rather than deletes. Verdicts recorded
   * before it read as STALE - the state the report already means by "it passed,
   * but not against what we are looking at now" - so a rule nobody has got back
   * to is legible as unfinished instead of quietly green.
   *
   * Per tier and per target, because they are judged separately and swept
   * separately: re-running the suite is cheap, a walkdown is a person's
   * afternoon, and asking for both when you meant one is how a sweep gets
   * abandoned half-done.
   */
  const sweeps = sorted.map(({ data }) => data).filter((r) => r?.kind === 'sweep' && r.created);
  const sweepFor = (tier, t) => {
    const relevant = sweeps.filter(
      (r) => (r.tiers ?? []).includes(tier) && (!r.target || r.target === t),
    );
    return relevant.length ? relevant[relevant.length - 1] : null;
  };
  /** Whether an entry was recorded before the sweep that governs its tier. */
  const swept = (entry, tier, t) => {
    const s = sweepFor(tier, t);
    return Boolean(s && entry?.created && String(entry.created) < String(s.created));
  };

  const checkCells = new Map(); // "ruleId\0target" -> entry
  const agentCells = new Map(); // "ruleId\0target" -> entry (latest agent walkdown)
  const humanCells = new Map(); // "ruleId\0target" -> entry (latest human walkdown, any role)
  /*
   * And the same again split by the ROLE the signer was acting in, because
   * acceptance is a set of people rather than a kind of evidence: product
   * accepting that the thing does what was asked is a different signature
   * from engineering accepting that it was built right, and a rule wants both
   * where it names both.
   *
   * The role comes off the RUN rather than off whoever the signer is today.
   * People change teams; a signature does not stop meaning what it meant.
   *
   * A run recorded before roles existed carries none, and is read as an
   * ENGINEERING signature - historically the person signing a walkdown was
   * the developer who built it. Product signatures are the new work, and
   * pretending the old runs were product's would be inventing them.
   */
  const roleCells = new Map(); // "ruleId\0target\0role" -> entry
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
        if (run.actor === 'agent') agentCells.set(`${res.rule}\0${run.target}`, entry);
        else {
          humanCells.set(`${res.rule}\0${run.target}`, entry);
          const roles = (run.roles ?? []).filter(Boolean);
          for (const role of roles.length ? roles : ['eng'])
            roleCells.set(`${res.rule}\0${run.target}\0${role}`, { ...entry, role });
        }
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

  const toCell = (entry, rule, kind, tier, t) => {
    if (!entry) return { state: 'never' };
    // An approval is of the statement as written, so it goes stale the same
    // way a pass does when the statement moves on.
    const outdated = swept(entry, tier ?? kind, t ?? primary);
    const stale =
      (['pass', 'approved'].includes(entry.status) &&
        entry.statementHash &&
        !hashMatches(entry.statementHash, rule.statement)) ||
      uncovered(entry, rule, kind) ||
      outdated;
    return {
      state: stale ? 'stale' : entry.status,
      // Why it is stale, so the report can say "swept" rather than leaving a
      // reviewer to guess that somebody reworded the statement.
      ...(outdated && { sweptBy: sweepFor(tier ?? kind, t ?? primary)?.run_id ?? null }),
      actor: entry.actor,
      runId: entry.runId,
      created: entry.created,
      checks: entry.checks,
      evidence: entry.evidence,
      detail: entry.detail,
    };
  };

  /*
   * A retired rule is one we stopped meaning - a layout withdrawn, a surface
   * replaced. It stays in the file so the ids in old run records still resolve
   * and the ledger keeps its meaning; it leaves every derived report, because a
   * rule nobody intends to satisfy is not pending, not failing, and not owed to
   * anyone. Deleting it instead would turn every verdict ever recorded against
   * it into a lint warning about an unknown rule, forever.
   */
  const rows = rules
    .filter(({ rule }) => !rule.retired)
    .map(({ rule, story }) => {
      const verify = verifyList(rule);
      const envs = rule.environments;

      const cells = {};
      for (const t of targets) {
        if (!verify.includes('checks') || (envs && !envs.includes(t))) cells[t] = { state: 'na' };
        else cells[t] = toCell(checkCells.get(`${rule.id}\0${t}`), rule, 'checks', 'checks', t);
      }
      const at = `${rule.id}\0${primary}`;
      const agent = verify.includes('agent')
        ? toCell(agentCells.get(at), rule, undefined, 'agent', primary)
        : { state: 'na' };
      const human = toCell(humanCells.get(at), rule, undefined, 'human', primary);

      /*
       * Who has accepted this rule, and who has not. One entry per role the rule
       * names, in the order it names them, so the panel can draw a fixed slot
       * per role rather than a count - "product has not signed" is a different
       * thing to know from "one of two".
       *
       * `sent-back` is refining: a signer who looked and said not yet. It is not
       * an absence, and drawing it as one would lose the only signal on the
       * board that somebody actively disagreed.
       */
      const roles = signoffList(rule);
      const acceptance = roles.map((role) => {
        const e = roleCells.get(`${rule.id}\0${primary}\0${role}`);
        if (!e) return { role, state: 'none' };
        const stale =
          ['pass', 'approved'].includes(e.status) &&
          e.statementHash &&
          !hashMatches(e.statementHash, rule.statement);
        if (e.status === 'refining' || e.status === 'fail')
          return { role, state: 'sent-back', ...e };
        if (stale) return { role, state: 'stale', ...e };
        /*
         * Approving the WORDING is not accepting the BUILD, and the two have
         * always been different records here - "approving a spec is not judging
         * a build" (docs/00-vision.md). So a role that approved has a state of
         * its own: it discharges the queue while the rule is unbuilt, and asks
         * for a real signature the moment there is something to look at.
         */
        if (e.status === 'approved') return { role, state: 'approved', ...e };
        if (e.status === 'pass') return { role, state: 'signed', ...e };
        return { role, state: 'none' };
      });

      // The sign-off state, read past the verify gate so a checks-only rule's
      // approval still shows. A hash-stale approval yields null - rewording
      // the statement asks for a fresh sign-off.
      const signed = humanCells.get(at);
      const signoff =
        signed &&
        ['approved', 'refining'].includes(signed.status) &&
        !(
          signed.status === 'approved' &&
          signed.statementHash &&
          !hashMatches(signed.statementHash, rule.statement)
        )
          ? signed.status
          : null;

      const openThreads = threads
        .filter(
          (t) =>
            t.data?.anchor?.rule === rule.id && !TERMINAL_THREAD_STATUSES.includes(t.data?.status),
        )
        .map((t) => ({ id: t.data.id, status: t.data.status }));

      /*
       * Verdict: every evidence tier the rule asks for holds a current pass, AND
       * every role it names has accepted. Fail on any failing tier, or on a
       * signer who sent it back - somebody looking at the thing and saying not
       * yet is a fail, not a gap.
       *
       * The human WALKDOWN cell is deliberately not in this sum any more.
       * Acceptance is the roles, and counting a person's signature twice - once
       * as a tier and once as a role - made a one-person team's rule need two
       * different things that were the same thing.
       */
      const applicable = [...Object.values(cells), agent].filter((c) => c.state !== 'na');
      const sentBack = acceptance.some((a) => a.state === 'sent-back');
      const allSigned = acceptance.every((a) => a.state === 'signed');
      let verdict;
      if (applicable.some((c) => c.state === 'fail') || sentBack) verdict = 'fail';
      else if (applicable.every((c) => c.state === 'pass') && allSigned) verdict = 'pass';
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
              ['given', 'when', 'then']
                .filter((ph) => rule.steps[ph]?.length)
                .map((ph) => [ph, rule.steps[ph]]),
            )
          : null,
        screens: rule.screens ?? [],
        flow: screenFlow(rule, screenIdSet),
        verify,
        verdict,
        built,
        signoff,
        acceptance,
        excuses: Object.fromEntries(
          ['checks', 'agent'].map((t) => [t, excuseFor(rule, t)]).filter(([, why]) => why),
        ),
        cells,
        agent,
        human,
        threads: openThreads,
      };
    });

  // Drift: where the spec has gotten ahead of its sources. Derived, never stored.
  const activeFor = (screenId) =>
    threads
      .filter(
        (t) =>
          t.data?.anchor?.screen === screenId && !TERMINAL_THREAD_STATUSES.includes(t.data?.status),
      )
      .map((t) => t.data.id);
  const drift = {
    design: (blueprint.storyboard?.screens ?? [])
      .filter((s) => s?.id && !s.prototype && !s.retired)
      .map((s) => ({ screen: s.id, proposal: s.proposal ?? null, requests: activeFor(s.id) })),
    sources: rules
      .filter(
        ({ rule }) =>
          typeof rule.origin === 'string' && !['prd', 'prototype'].includes(rule.origin),
      )
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
    /*
     * Now per role, because "somebody should look at this" was never quite the
     * question - the question is whether PRODUCT should look at it, or
     * engineering, and a queue that cannot say which is a queue two people
     * both scroll past. A sent-back rule is not queued to its signer: they
     * have looked, and what it owes is a fix.
     */
    for (const a of row.acceptance) {
      if (a.state === 'signed' || a.state === 'sent-back') continue;
      // An approval covers an unbuilt rule and stops covering it the moment
      // there is a build to judge.
      if (a.state === 'approved' && !row.built) continue;
      attention.push({ who: 'human', role: a.role, action: 'judge', rule: row.rule });
    }

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
    if (t.status === 'addressed')
      attention.push({ who: 'human', action: 'verify', thread: t.id, rule });
    else if (t.kind === 'question' && t.status === 'open')
      attention.push({ who: 'human', action: 'answer', thread: t.id, rule });
    else if (t.kind === 'note' && t.status === 'open')
      attention.push({ who: 'agent', action: 'address', thread: t.id, rule });
    else if (t.status === 'answered')
      attention.push({ who: 'agent', action: 'incorporate', thread: t.id, rule });
  }

  /*
   * What each open sweep still owes. Counted from the rows just derived rather
   * than from the ledger, so it agrees with the report by construction: a rule
   * whose cell reads stale because of the sweep is owed, and one that has been
   * judged since is done. Rules that never asked for the tier are not owed it.
   */
  const sweepReport = [];
  for (const tier of ['checks', 'agent', 'human']) {
    for (const t of targets) {
      const s = sweepFor(tier, t);
      if (!s) continue;
      if (tier !== 'checks' && t !== primary) continue;
      const cellOf = (row) => (tier === 'checks' ? row.cells[t] : row[tier]);
      const applies = rows.filter((row) => cellOf(row)?.state !== 'na');
      /*
       * Owed is "not judged since the sweep", which is two things: a verdict
       * the sweep superseded, and a rule that never had one. Counting only the
       * first would report a rule nobody has EVER judged as done, which is the
       * exact question a sweep exists to answer.
       */
      const owed = applies.filter((row) => {
        const cell = cellOf(row);
        return cell?.sweptBy === s.run_id || cell?.state === 'never';
      });
      sweepReport.push({
        runId: s.run_id,
        tier,
        target: t,
        created: s.created,
        why: s.why ?? s.note ?? null,
        actor: s.actor ?? null,
        of: applies.length,
        done: applies.length - owed.length,
        owed: owed.map((row) => row.rule),
      });
    }
  }

  return { targets, rows, drift, attention, sweeps: sweepReport };
}
