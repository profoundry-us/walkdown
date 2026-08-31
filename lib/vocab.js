/*
 * The vocabulary. One module, no dependencies, both runtimes.
 *
 * walkdown exists so that a term means one thing, and for its first month its
 * own vocabulary was string literals in ten files across two runtimes. The
 * panel's idea of a terminal thread agreed with the server's because two
 * people typed the same words carefully — the panel's TERMINAL even listed
 * them in a different order — and one typo would have disagreed silently, in
 * the direction that matters: a status the panel cannot draw is invisible,
 * not loud.
 *
 * So every LIST and TABLE lives here: the sets two files must agree on, the
 * transition table, and what derives from them. The line is enumeration, not
 * comparison — `status === 'open'` in a handler is fine, because a typo there
 * fails the check that drives it, but naming the members of a set anywhere
 * else is a second copy of this file waiting to drift.
 *
 * Browser-safe on purpose: no node imports, no I/O. The panel bundles it the
 * way it bundles screen-match; the CLI and server import it like any module.
 * Derivations (TERMINAL, statusesFor) are computed from FLOWS rather than
 * written beside it, because two spellings of one fact is the disease this
 * module treats.
 */

// --- vocab:start ---
// ---- threads --------------------------------------------------------------

const THREAD_KINDS = Object.freeze(['note', 'question']);

/** The id prefix a kind files under: n-0042 is a note, q-0042 a question. */
const threadPrefix = (kind) => (kind === 'question' ? 'q' : 'n');

/**
 * Legal status transitions per thread kind — the lifecycle itself.
 * Order is meaningful twice over: the keys are each kind's statuses in
 * lifecycle order, and each list is the order actions are offered in.
 */
const FLOWS = Object.freeze({
  note: Object.freeze({
    open: Object.freeze(['addressed', 'waived']),
    addressed: Object.freeze(['verified', 'open', 'waived']),
    verified: Object.freeze([]),
    waived: Object.freeze([]),
  }),
  question: Object.freeze({
    open: Object.freeze(['answered', 'waived']),
    answered: Object.freeze(['incorporated', 'open', 'waived']),
    incorporated: Object.freeze([]),
    waived: Object.freeze([]),
  }),
});

/** Every status a thread of this kind may hold. */
const statusesFor = (kind) => Object.freeze(Object.keys(FLOWS[kind] ?? FLOWS.note));

/**
 * Statuses a thread never leaves. Derived, not listed: a status is terminal
 * exactly when its kind's flow offers it nowhere to go, so this cannot
 * disagree with FLOWS no matter who edits which.
 */
const TERMINAL = Object.freeze([
  ...new Set(
    Object.values(FLOWS).flatMap((flow) =>
      Object.entries(flow)
        .filter(([, next]) => next.length === 0)
        .map(([status]) => status),
    ),
  ),
]);

/** May a `kind` thread move from `from` to `to`? The one answer, for every caller. */
const canTransition = (kind, from, to) => ((FLOWS[kind] ?? FLOWS.note)[from] ?? []).includes(to);

/**
 * Statuses that mean "a person judged it". An agent claims work and never
 * accepts it — blueprint/AGENTS.md states the law, threads.js enforces it,
 * and the panel greys the buttons; all three read this list.
 */
const HUMAN_ONLY = Object.freeze(['verified', 'waived']);

/**
 * Transitions that must say why: waiving buries work and reopening un-buries
 * it, and both are illegible a week later without a sentence attached.
 */
const NEEDS_REASON = Object.freeze(['waived', 'open']);

// ---- verification ---------------------------------------------------------

/**
 * The declarable verify tiers. `human` is not one: humans accept rules
 * through signoff, not through a verify list (docs/02-blueprint-schema.md —
 * the verify inversion).
 */
const TIERS = Object.freeze(['checks', 'agent']);

/** Who can sign a rule off. */
const ROLES = Object.freeze(['eng', 'product', 'design']);

/**
 * What one result in a run record may say. The last two are sign-off verdicts
 * on unbuilt rules — a judgment of the spec, recorded by walkdown sessions
 * only, and never build evidence (docs/05-runs-ledger.md).
 */
const RESULT_STATUSES = Object.freeze([
  'pass',
  'fail',
  'skipped',
  'blocked',
  'approved',
  'refining',
]);

// --- vocab:end ---

export {
  canTransition,
  FLOWS,
  HUMAN_ONLY,
  NEEDS_REASON,
  RESULT_STATUSES,
  ROLES,
  statusesFor,
  TERMINAL,
  THREAD_KINDS,
  TIERS,
  threadPrefix,
};
