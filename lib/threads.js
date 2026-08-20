const TERMINAL = ['incorporated', 'verified', 'waived'];

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
