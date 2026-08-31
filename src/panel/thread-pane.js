/*
 * One conversation, opened: the thread's own detail pane, and the card the
 * lists draw for it.
 */
import { MSG } from '../../lib/message-stream.js';
import {
  ghostSource,
  names,
  open,
  pendingReplies,
  say,
  seenAtOpen,
  threadActions,
  unreadCount,
} from './app.js';
import { icon } from './icons.js';
import { S } from './state.js';
import { esc } from './util.js';
import { CHIP, TERMINAL, screenById, shortName, whoAmI } from './vocab.js';

/*
 * A thread, collapsed: the opening message and the way into the rest of it.
 * It reads the way a message with replies reads anywhere - a face, a name, a
 * time, what was said, and under it the people in the thread, the number of
 * replies, and when it was last touched. The count is the door; opening it
 * slides the whole conversation in beside the rule.
 */
export function threadCard(t, where = null) {
  const who = MSG.displayName(t.author, names());
  const unread = unreadCount(t);
  // No card, no rail: threads share one surface with the pane, the way
  // messages share a channel. What is waiting on you is said in words - the
  // status chip and the unread count - rather than by tinting a box.
  //
  // `where` is passed only by the Threads tab, which is not scoped to a rule
  // and so has to say what each conversation is about. It also makes the
  // whole row the way in: under a rule the reply line is enough, because the
  // rule above it is already the context.
  return `<div class="wd-row px-3.5 py-2${where ? ' cursor-pointer' : ''}"${
    where ? ` data-open-thread="${esc(t.id)}"` : ''
  }>
    ${where ? `<div class="mb-1 truncate text-[11px] opacity-45" data-testid="thread.where">${esc(where)}</div>` : ''}
    <div class="wd-msg">
      ${MSG.avatar(who)}
      <div class="wd-col min-w-0">
        <div class="wd-head">
          <span class="wd-who">${esc(who)}</span>
          <span class="wd-at" title="${esc(MSG.stamp(t.created))}">${esc(MSG.ago(t.created))}</span>
          <!-- The id stays visible, quietly: a conversation you can name is a
               conversation you can point at from a run record or a commit. -->
          <span class="wd-at font-mono">${esc(t.id)}</span>
          <span class="ml-auto flex shrink-0 items-center gap-1">
            ${unread ? `<span class="badge badge-xs badge-error">${unread} new</span>` : ''}
            <span class="badge badge-xs ${CHIP[t.status] ?? 'badge-ghost'}">${esc(t.status)}</span>
          </span>
        </div>
        <div class="wd-text wd-preview">${MSG.body(t.body, { rules: (S.data?.rows ?? []).map((r) => r.rule) })}</div>
        ${MSG.repliesLine(t, names())}
      </div>
    </div>
  </div>`;
}

/*
 * The thread itself: its own screen, one slide to the right of the rule it
 * belongs to. A conversation deserves the width - reading and answering
 * should not happen in a card wedged between a rule's steps and its verify
 * list - and the way back is where you came from.
 */
/**
 * What the way out of a thread is called. On the Threads tab the thread is
 * the tab's own detail, so the way back is the list of threads - naming a
 * rule there would offer a trip nobody took.
 */
export const backFromThread = (row) =>
  S.listTab === 'threads' ? 'All threads' : row ? shortName(row) : 'All rules';

export function threadPane() {
  const t = (S.data?.threads ?? []).find((x) => x.id === S.openThread);
  // Whatever became of the thread — ended, reloaded away, never there — this
  // screen is never a dead end.
  if (!t)
    return `
    <div class="flex items-center px-2 pt-2">
      <button class="wdp-thread-back btn btn-ghost btn-xs text-primary">← ${esc(
        backFromThread(S.selected),
      )}</button>
    </div>
    <div class="px-3.5 pt-1 text-[12.5px] opacity-60">That thread is no longer open here.</div>`;
  const row = t.anchor?.rule ? S.data.rows.find((r) => r.rule === t.anchor.rule) : null;
  const sc = screenById(t.anchor?.screen);
  const where = [
    t.anchor?.rule ? '' : 'not attached to a rule',
    sc?.title ?? t.anchor?.screen,
    t.anchor?.element
      ? `<span class="font-mono">${esc(t.anchor.element)}</span>`
      : t.anchor?.position
        ? 'by position'
        : '',
    t.anchor?.viewport
      ? `${esc(t.anchor.viewport.name)} ${esc(String(t.anchor.viewport.width))}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const sketch = ghostSource(sc);
  const acts = threadActions(t);
  const me = whoAmI();
  const ended = TERMINAL.includes(t.status) ? (t.replies ?? []).at(-1) : null;
  return `
    <div class="flex items-center gap-1 px-2 pt-2">
      <button class="wdp-thread-back btn btn-ghost btn-xs text-primary" data-testid="thread.close">← ${esc(
        backFromThread(row),
      )}</button>
      <span class="ml-auto flex items-center gap-1 pr-1.5 text-[11px]" data-testid="thread.provenance">
        <b class="opacity-60">${esc(t.id)}</b>
        <span class="badge badge-xs ${CHIP[t.status] ?? 'badge-ghost'}">${esc(t.status)}</span>
      </span>
    </div>
    ${where ? `<div class="px-3.5 pb-1 text-[11px] opacity-45">${where}</div>` : ''}
    <div class="min-h-0 flex-1 overflow-y-auto px-3.5 pb-2" data-testid="thread.body">
      ${MSG.stream(t, {
        seenAt: seenAtOpen[t.id] ?? null,
        rules: (S.data?.rows ?? []).map((r) => r.rule),
        pending: pendingReplies.get(t.id) ?? [],
        names: names(),
      })}
      ${
        ended
          ? `<div class="mt-2 flex items-center gap-1.5 rounded border border-success/40 px-2 py-1 text-[11px]">
        <span class="text-success">✓</span> ${esc(t.status === 'waived' ? 'Waived' : t.status)}${
          ended.author ? ` by <b>${esc(MSG.displayName(ended.author, names()))}</b>` : ''
        } · ${esc(MSG.ago(ended.created))}</div>`
          : ''
      }
      ${
        sketch?.proposed
          ? `<button class="btn btn-xs btn-outline mt-2 w-full" data-sketch="${esc(t.anchor.screen)}">
        ⚠ View the proposed sketch</button>`
          : ''
      }
    </div>
    <!-- The composer stays put at the foot of the screen: type, press Enter,
         the message is there. The name is not asked for again — it is
         whoever you are recording as, changed in Settings like everywhere. -->
    <div class="shrink-0 border-t border-base-300 p-2">
      <textarea id="wdp-note" data-testid="thread.reply" rows="2" class="textarea textarea-xs w-full resize-none"
        placeholder="Reply…">${esc(S.threadNote)}</textarea>
      <div class="mt-1 flex flex-wrap items-center gap-1">
        <span class="text-[10px] opacity-40">as <button id="wdp-tactor" class="link">${esc(
          me || 'set your name…',
        )}</button> · <b>Enter</b> sends</span>
        ${acts
          .map(
            ([label, st, quiet], i) =>
              `<button class="btn btn-xs${quiet ? ' btn-ghost opacity-60' : ''}${i === 0 ? ' ml-auto' : ''}"
            data-testid="thread.actions" data-act="${esc(st)}" data-tid="${esc(t.id)}">${label}</button>`,
          )
          .join('')}
      </div>
      <div class="mt-1 hidden text-[11px] text-warning" data-testid="thread.say" id="wdp-tsay"></div>
    </div>`;
}
