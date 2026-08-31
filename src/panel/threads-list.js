/*
 * The Threads tab: every conversation on this blueprint, filtered the three
 * ways `walkdown threads` filters them, in the same words.
 */
import { html } from '../../vendor/lit.js';
import { open, start } from './app.js';
import { S } from './state.js';
import { threadCard } from './thread-pane.js';
import { screenById, TERMINAL, threadTouched } from './vocab.js';

/*
 * ---- the Threads tab -------------------------------------------------
 *
 * A conversation used to be reachable only through the rule it was anchored
 * to, and once it ended it was reachable nowhere at all - the panel filters
 * terminal threads out of the rule list, the pins and the counts, and gave
 * nobody a way to ask for them back. `walkdown threads --all` could show
 * them; the panel could not. This is that view (n-0094).
 *
 * The three filters are the three questions the command line already
 * answers, in the same words, so the two never disagree about what "active"
 * means.
 */
export function threadsMatching(filter) {
  const all = S.data?.threads ?? [];
  if (filter === 'all') return all;
  if (filter === 'you') {
    /*
     * Whose turn it is, taken from the server's attention queue rather than
     * re-derived here. A note awaiting verification and a question awaiting
     * an answer are both work for a person, and the rules for that live in
     * status.js beside every other queue - a second copy in the panel is a
     * second thing to get wrong.
     */
    const owed = new Set(
      (S.data?.attention ?? []).filter((i) => i.who === 'human' && i.thread).map((i) => i.thread),
    );
    return all.filter((t) => owed.has(t.id));
  }
  return all.filter((t) => !TERMINAL.includes(t.status));
}

/** Where a thread is anchored, in words, for a list that is not scoped to one rule. */
export function threadWhere(t) {
  const a = t?.anchor ?? {};
  const sc = screenById(a.screen);
  return (
    [a.rule, a.element ?? (sc ? (sc.title ?? sc.id) : a.screen)].filter(Boolean).join(' · ') ||
    'not attached to anything'
  );
}

/*
 * The three questions over the thread list, drawn OUTSIDE the scrolling
 * wrapper as a sibling above it - the same shape as the rule list's search
 * box, and for the same reason. `position: sticky` is the reflex and the
 * wrong tool: the pane itself is what scrolls, so a sticky child sticks to a
 * scrollport that is already moving with it. A column with a fixed head and
 * a growing body needs no stacking, no offsets, and nothing to go wrong when
 * the list is short (n-0103).
 */
export function threadFilterBar() {
  const counts = {
    active: threadsMatching('active').length,
    you: threadsMatching('you').length,
    all: (S.data?.threads ?? []).length,
  };
  const pick = (id, label, hint) =>
    html`<button class="btn btn-xs join-item gap-1 ${S.threadFilter === id ? 'btn-primary' : 'btn-outline btn-primary'}"
      data-tfilter="${id}" title="${hint}">${label}<span class="opacity-60">${counts[id]}</span></button>`;
  return html`<div class="flex shrink-0 justify-center border-b border-base-300 px-3.5 py-2">
    <div class="join" data-testid="panel.thread-filter">
      ${pick('active', 'Active', 'Questions and notes still in play')}
      ${pick('you', 'Awaiting you', 'A fix claimed and unverified, or a question unanswered — the same queue walkdown status shows')}
      ${pick('all', 'All', 'Every thread ever filed on this blueprint, ended ones included')}
    </div>
  </div>`;
}

export function threadsPane() {
  const list = [...threadsMatching(S.threadFilter)].sort((a, b) =>
    threadTouched(b).localeCompare(threadTouched(a)),
  );
  const EMPTY = {
    active: html`No live threads. Everything said here has been answered — <b>All</b> has them.`,
    you: html`Nothing is waiting on you.`,
    all: html`No threads yet. Drop a pin on the page, or leave a note on a rule, to start one.`,
  };
  return list.length
    ? list.map((t) => threadCard(t, threadWhere(t)))
    : html`<p class="p-3.5 text-[12.5px] opacity-40">${EMPTY[S.threadFilter]}</p>`;
}
