import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from '../vendor/yaml.js';
// The lifecycle itself — FLOWS, what is terminal, what needs a human, what
// needs a reason — lives in vocab.js, where the panel reads the same tables.
// This module is the ENFORCEMENT: the only writer that applies them to disk.
import { canTransition, HUMAN_ONLY, NEEDS_REASON, TERMINAL } from './vocab.js';

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
  if (t.status === status) throw new Error(`thread ${id} is already ${status}`);
  if (!canTransition(t.kind, t.status, status))
    throw new Error(`illegal transition ${t.status} → ${status} for a ${t.kind}`);
  if (HUMAN_ONLY.includes(status) && (!actor?.trim() || actor.trim() === 'agent'))
    throw new Error(
      `"${status}" requires a named human actor — agents may claim work, never accept it`,
    );
  if (NEEDS_REASON.includes(status) && !reason?.trim())
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
