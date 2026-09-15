import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from '../vendor/yaml.js';
import { isoNow } from './time.js';
// The lifecycle itself — FLOWS, what is terminal, what needs a human, what
// needs a reason — lives in vocab.js, where the panel reads the same tables.
// This module is the ENFORCEMENT: the only writer that applies them to disk.
import {
  canTransition,
  closesOnVerdict,
  HUMAN_ONLY,
  isMachineName,
  NEEDS_REASON,
  saysSomething,
  TERMINAL,
} from './vocab.js';


function threadFile(blueprint, id) {
  const entry = blueprint.threads.find((t) => t.data?.id === id);
  if (!entry) throw new Error(`no thread "${id}"`);
  return entry.file;
}

/**
 * Append a reply to a thread. Returns the updated thread.
 *
 * `via` is PROVENANCE, not attribution: who decided and how it arrived are
 * two questions, and one field was answering both. An agent acting on a
 * person's behalf records under that person - it is their instruction, and
 * asking the agent to sign somebody else's name was the fiction - but the
 * sentence was still typed by a machine, and a reader deserves to know which
 * ones. `via: agent` says so beside the author rather than instead of them.
 */
export function replyToThread(blueprint, id, { author, body, via = null }) {
  if (!body?.trim()) throw new Error('reply body required');
  const file = threadFile(blueprint, id);
  const t = parse(readFileSync(file, 'utf8'));
  (t.replies ??= []).push({
    author: author || 'unknown',
    ...(via ? { via } : {}),
    created: isoNow(),
    body: body.trim(),
  });
  writeFileSync(file, stringify(t));
  return t;
}

/**
 * The transition guards alone, applied to a thread already in hand and
 * writing nothing. A command combining a reply with a transition asks this
 * FIRST, so a refused transition refuses the whole mutation instead of
 * landing the reply and then reporting that nothing happened (n-0125,
 * second sitting: the reply survived the refusal and a retry duplicated it).
 */
export function checkTransition(t, { status, actor, reason, via = null }) {
  if (t.status === status) throw new Error(`thread ${t.id} is already ${status}`);
  if (!canTransition(t.kind, t.status, status))
    throw new Error(`illegal transition ${t.status} → ${status} for a ${t.kind}`);
  // Case-insensitive on purpose: "Agent" and "AGENT" walked through this
  // gate and stood on disk as accepters (n-0130). The gate names a role,
  // not a spelling.
  if (HUMAN_ONLY.includes(status) && isMachineName(actor))
    throw new Error(
      `"${status}" requires a named human actor — agents may claim work, never accept it`,
    );
  /*
   * And the same rule read off the provenance rather than the name. Once an
   * agent records under the person it acts for, `actor` stops being able to
   * answer "was a machine driving?" - so the flag that SAYS a machine was
   * driving carries the refusal. Provenance can only ever subtract authority:
   * there is no value of `via` that lets a claim become an acceptance.
   *
   * ANY provenance, not the one spelling. This read `via === 'agent'` - case
   * sensitive, untrimmed, one line below an actor test that deliberately
   * folds case - so `via: 'Agent'` verified a thread on any machine whose
   * home declares a person, which is the ordinary machine an agent sits at.
   * Case-folding alone would not have been the fix: `via` is free text, and
   * an agent naming itself honestly - `via: 'claude-opus-5'` - is exactly the
   * one that would still have walked through (n-0212).
   *
   * So the test is presence. `via` means SOMETHING TYPED THIS FOR THE PERSON
   * NAMED, and a person's acceptance is the one thing nothing may type for
   * them. A human at a keyboard sends no `via` and is unaffected; every
   * machine that says what it is, in any words, is refused - which is what
   * the paragraph above always claimed.
   */
  if (HUMAN_ONLY.includes(status) && saysSomething(via))
    throw new Error(
      `"${status}" is a person's acceptance — an agent may claim work on their behalf, never accept it`,
    );
  if (NEEDS_REASON.includes(status) && !reason?.trim())
    throw new Error(`${status === 'waived' ? 'waiving' : 'reopening'} requires a reason`);
  // Settling is an observation's ending and nothing else's: a person's
  // feedback and a judge's finding wait on a verdict, a request on a person
  // (ADR 0005 §2). Any actor may settle - it is a claim, not an acceptance.
  if (status === 'settled' && t.reason !== 'observation')
    throw new Error(`only an observation is settled; ${t.id} is ${t.reason ?? 'feedback'} and waits on a person's look`);
}

/**
 * Move a thread to a new status, enforcing the lifecycle:
 * - only transitions in FLOWS are legal;
 * - `verified` and `waived` require a named human actor (never "agent", and
 *   never a mutation carrying ANY `via` - provenance means a machine typed
 *   it, whatever the machine calls itself);
 * - waiving and reopening require a reason, recorded as a reply;
 * - waiving records `waived_by`, verifying records `verified_by` (n-0127:
 *   the name the gate demands must not be thrown away at the moment of
 *   acceptance).
 * Returns the updated thread.
 */
export function transitionThread(blueprint, id, { status, actor, reason, via = null }) {
  const file = threadFile(blueprint, id);
  const t = parse(readFileSync(file, 'utf8'));
  checkTransition(t, { status, actor, reason, via });
  if (reason?.trim())
    (t.replies ??= []).push({
      author: actor || 'unknown',
      ...(via ? { via } : {}),
      created: isoNow(),
      body: reason.trim(),
    });
  if (status === 'waived') t.waived_by = actor.trim();
  if (status === 'verified') t.verified_by = actor.trim();
  t.status = status;
  writeFileSync(file, stringify(t));
  return t;
}

/**
 * List threads, newest first. By default only active ones (non-terminal
 * status); `all` includes incorporated/verified/waived. `rule` filters by the
 * anchored rule id.
 */
/**
 * @param {{ threads: any[] }} blueprint
 * @param {{ rule?: string, all?: boolean }} [opts]
 */
export function listThreads(blueprint, { rule, all = false } = {}) {
  return blueprint.threads
    .map((t) => t.data)
    .filter((t) => t?.id)
    .filter((t) => all || !TERMINAL.includes(t.status))
    .filter((t) => !rule || t.anchor?.rule === rule)
    .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
}

/** Find one thread by id (exact match). */
export function getThread(blueprint, id) {
  return blueprint.threads.map((t) => t.data).find((t) => t?.id === id) ?? null;
}

/**
 * A signed pass closes the notes that were waiting on exactly that look
 * (ADR 0005 §2, §3): a judge's finding, or a person's own feedback, that was
 * addressed before the pass was recorded. Written as `verified` under the
 * signer's name - the acceptance is theirs, given on the rule rather than on
 * the thread - and the run that carried it is kept on the thread, so the
 * record says how it closed. Returns the ids it closed.
 *
 * @param {{ threads: any[] }} blueprint
 * @param {{ rule: string, signer: string, runId: string, created: string }} pass
 */
export function closeByVerdict(blueprint, { rule, signer, runId, created }) {
  if (isMachineName(signer)) return [];
  const closed = [];
  for (const { file, data: t } of blueprint.threads) {
    if (t?.anchor?.rule !== rule || t.status !== 'addressed' || !closesOnVerdict(t)) continue;
    // Addressed BEFORE the pass: a fix claimed after the person looked is not
    // what they looked at, and stays open for the next look.
    const claimed = (t.replies ?? []).map((r) => r?.created).filter(Boolean).sort().at(-1) ?? t.created;
    // Whole seconds: a run is stamped to the second and a reply to the
    // millisecond, and a claim made in the same second as the pass that
    // followed it would otherwise read as later than the look it got.
    const secs = (iso) => Math.floor(Date.parse(iso) / 1000);
    if (created && claimed && secs(claimed) > secs(created)) continue;
    const fresh = parse(readFileSync(file, 'utf8'));
    (fresh.replies ??= []).push({
      author: signer,
      via: 'verdict',
      created: isoNow(),
      body: `Verified by ${signer}'s pass on ${rule} (${runId}).`,
    });
    fresh.status = 'verified';
    fresh.verified_by = signer;
    fresh.verified_via = runId;
    writeFileSync(file, stringify(fresh));
    t.status = 'verified';
    closed.push(t.id);
  }
  return closed;
}
