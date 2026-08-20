import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';

const TERMINAL = ['incorporated', 'verified', 'waived'];

/** Legal status transitions per thread kind. Reopening (→ open) requires a reason. */
const FLOWS = {
  note: { open: ['addressed', 'waived'], addressed: ['verified', 'open', 'waived'], verified: [], waived: [] },
  question: { open: ['answered', 'waived'], answered: ['incorporated', 'open', 'waived'], incorporated: [], waived: [] },
};
/** States that mean "a person judged it" — an agent can claim work, never self-accept. */
const HUMAN_ONLY = ['verified', 'waived'];

const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

function threadFile(blueprint, id) {
  const entry = blueprint.threads.find((t) => t.data?.id === id);
  if (!entry) throw new Error(`no thread "${id}"`);
  return entry.file;
}

/** Append a reply to a thread. Returns the updated thread. */
export function replyToThread(blueprint, id, { author, body }) {
  if (!body?.trim()) throw new Error('reply body required');
  const file = threadFile(blueprint, id);
  const t = parse(readFileSync(file, 'utf8'));
  (t.replies ??= []).push({ author: author || 'unknown', created: isoNow(), body: body.trim() });
  writeFileSync(file, stringify(t));
  return t;
}

/**
 * Move a thread to a new status, enforcing the lifecycle:
 * - only transitions in FLOWS are legal;
 * - `verified` and `waived` require a named human actor (never "agent");
 * - waiving and reopening require a reason, recorded as a reply;
 * - waiving records `waived_by`.
 * Returns the updated thread.
 */
export function transitionThread(blueprint, id, { status, actor, reason }) {
  const file = threadFile(blueprint, id);
  const t = parse(readFileSync(file, 'utf8'));
  const flow = FLOWS[t.kind] ?? FLOWS.note;
  if (t.status === status) throw new Error(`thread ${id} is already ${status}`);
  if (!(flow[t.status] ?? []).includes(status))
    throw new Error(`illegal transition ${t.status} → ${status} for a ${t.kind}`);
  if (HUMAN_ONLY.includes(status) && (!actor?.trim() || actor.trim() === 'agent'))
    throw new Error(`"${status}" requires a named human actor — agents may claim work, never accept it`);
  if ((status === 'waived' || status === 'open') && !reason?.trim())
    throw new Error(`${status === 'waived' ? 'waiving' : 'reopening'} requires a reason`);
  if (reason?.trim())
    (t.replies ??= []).push({ author: actor || 'unknown', created: isoNow(), body: reason.trim() });
  if (status === 'waived') t.waived_by = actor.trim();
  t.status = status;
  writeFileSync(file, stringify(t));
  return t;
}

/**
 * List threads, newest first. By default only active ones (non-terminal
 * status); `all` includes incorporated/verified/waived. `rule` filters by the
 * anchored rule id.
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
