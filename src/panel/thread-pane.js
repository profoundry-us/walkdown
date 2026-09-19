/*
 * One conversation, opened: the thread's own detail pane, and the card the
 * lists draw for it.
 */
import { MSG } from '../../lib/message-stream.js';
/*
 * unsafeHTML, with the answer its import owes (docs/10-house-style.md): the
 * MSG renderers are shared verbatim with the embed, which still renders by
 * string - so their output is a string here too, escaped internally by
 * MSG.esc. The boundary sits exactly at these call sites, and it retires if
 * the embed ever renders with lit.
 */
import { html, nothing, unsafeHTML } from '../../vendor/lit.js';
import { names, pendingReplies, seenAtOpen, threadAct, unreadCount } from './conversation.js';
import { icon } from './icons.js';
import { requestRender } from './shell.js';
import { S } from './state.js';
import { fire } from './util.js';


/*
 * Why the note exists, beside its status (ADR 0005 §1): a finding is a
 * judge's, feedback is yours, a decision is a record. Read at a glance,
 * because which of these it is decides who it is waiting on. A question
 * has none, and a legacy note with none reads as feedback everywhere else,
 * so nothing is drawn for it here either.
 */
const reasonChip = (t) =>
  t.kind === 'note' && t.reason && t.reason !== 'feedback'
    ? html`<span class="badge badge-xs badge-outline opacity-70" data-testid="thread.reason">${t.reason}</span>`
    : nothing;
import {
  CHIP,
  composerPlaceholder,
  ghostSource,
  myRole,
  screenById,
  shortName,
  TERMINAL,
  threadActions,
  turnLine,
} from './vocab.js';

/*
 * How the turn line is drawn, by whose move it is. A person's move is amber,
 * the agent's is blue and dashed like the agent's own face in the stream, an
 * ended thread is green: the colour is the party, not the reader, so the
 * same thread reads the same on both sides of the table.
 */
const TURN = {
  human: { line: 'border-warning', chip: 'bg-warning text-warning-content' },
  agent: { line: 'border-info', chip: 'bg-info text-info-content' },
  closed: { line: 'border-success', chip: 'bg-success text-success-content' },
};

/* The button for a tone: the primary is filled, the warning outlined in amber, the rest quiet. */
const TONE = {
  primary: 'btn-primary',
  warn: 'btn-outline btn-warning',
  quiet: 'btn-outline border-base-300 text-base-content/70',
};

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
  return html`<div class="wd-row px-3.5 py-2${where ? ' cursor-pointer' : ''}"
    data-open-thread="${where ? t.id : nothing}">
    ${where ? html`<div class="mb-1 truncate text-[11px] opacity-45" data-testid="thread.where">${where}</div>` : nothing}
    <div class="wd-msg">
      ${unsafeHTML(MSG.avatar(who, 'wd-ava', Boolean(t.via)))}
      <div class="wd-col min-w-0">
        <div class="wd-head">
          <span class="wd-who">${who}</span>
          <!-- Provenance beside the name, here too. This is where a reader
               MEETS a thread, and an agent files under the person it acts
               for - so a list that shows only the name says a person wrote
               something a machine wrote (n-0147). -->
          ${t.via ? html`<span class="wd-via">via ${t.via}</span>` : nothing}
          <span class="wd-at" title="${MSG.stamp(t.created)}">${MSG.ago(t.created)}</span>
          <!-- The id stays visible, quietly: a conversation you can name is a
               conversation you can point at from a run record or a commit. -->
          <span class="wd-at font-mono">${t.id}</span>
          <span class="ml-auto flex shrink-0 items-center gap-1">
            ${unread ? html`<span class="badge badge-xs badge-error">${unread} new</span>` : nothing}
            ${reasonChip(t)}
            <span class="badge badge-xs ${CHIP[t.status] ?? 'badge-ghost'}">${t.status}</span>
          </span>
        </div>
        <div class="wd-text wd-preview">${unsafeHTML(
          MSG.opening(t.kind, t.body, { rules: (S.data?.rows ?? []).map((r) => r.rule) }),
        )}</div>
        ${t.added ? unsafeHTML(MSG.addition(t.added, { rules: (S.data?.rows ?? []).map((r) => r.rule) })) : nothing}
        ${unsafeHTML(MSG.repliesLine(t, names()))}
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

/*
 * Back where you came from: the rule, or the list for a pin that has none -
 * and on the Threads tab always the thread list, because that is where you
 * came from and no rule was ever opened.
 */
function leaveThread() {
  const t = (S.data?.threads ?? []).find((x) => x.id === S.openThread);
  S.view = S.listTab !== 'threads' && t?.anchor?.rule && S.selected ? 'detail' : 'list';
  S.openThread = null;
  S.threadSay = '';
  requestRender();
}

export function threadPane() {
  const t = (S.data?.threads ?? []).find((x) => x.id === S.openThread);
  // Whatever became of the thread — ended, reloaded away, never there — this
  // screen is never a dead end.
  if (!t)
    return html`
    <div class="flex items-center px-2 pt-2">
      <button class="wdp-thread-back btn btn-ghost btn-xs text-primary" @click=${leaveThread}>← ${backFromThread(S.selected)}</button>
    </div>
    <div class="px-3.5 pt-1 text-[12.5px] opacity-60">That thread is no longer open here.</div>`;
  const row = t.anchor?.rule ? S.data.rows.find((r) => r.rule === t.anchor.rule) : null;
  const sc = screenById(t.anchor?.screen);
  const where = [
    t.anchor?.rule ? '' : 'not attached to a rule',
    sc?.title ?? t.anchor?.screen,
    t.anchor?.element
      ? html`<span class="font-mono">${t.anchor.element}</span>`
      : t.anchor?.position
        ? 'by position'
        : '',
    t.anchor?.viewport ? `${t.anchor.viewport.name} ${t.anchor.viewport.width}` : '',
  ].filter(Boolean);
  const sketch = ghostSource(sc);
  const role = myRole();
  const acts = threadActions(t, role);
  /*
   * Who ended the thread: the record first, the guess second. verified_by /
   * waived_by name whoever accepted; only a thread from before those were
   * recorded falls back to the last reply's author, which once credited an
   * agent's evidence post with a human's acceptance (n-0127).
   */
  const lastReply = (t.replies ?? []).at(-1);
  const recordedBy =
    t.status === 'verified' ? t.verified_by : t.status === 'waived' ? t.waived_by : null;
  const ended =
    TERMINAL.includes(t.status) && (recordedBy || lastReply)
      ? { author: recordedBy ?? lastReply?.author, created: lastReply?.created }
      : null;
  // The person on the other side of the table, for the agent's reading of
  // the line: whoever opened the thread, unless a machine did.
  const opener = MSG.displayName(t.author, names());
  const turn = turnLine(t, role, {
    person: /^agent$/i.test(t.author ?? '') ? 'the person' : opener,
    endedBy: ended?.author ? MSG.displayName(ended.author, names()) : null,
    endedAt: ended?.created ? MSG.ago(ended.created) : null,
  });
  // Enter sends what the box is for: the answer on a question that is
  // yours to answer, and a reply everywhere else.
  const enterAct = acts.some(([, act]) => act === '__answer') ? '__answer' : '__reply';
  return html`
    <div class="flex items-center gap-1 px-2 pt-2">
      <button class="wdp-thread-back btn btn-ghost btn-xs text-primary" data-testid="thread.close" @click=${leaveThread}>← ${backFromThread(row)}</button>
      <span class="ml-auto flex items-center gap-1 pr-1.5 text-[11px]" data-testid="thread.provenance">
        <!-- No name up here. "as topher" stood under the composer, then
             here as a link into Settings; who a reply or a move is recorded
             under is chosen once, when a walkdown starts and each role is
             signed for, and is not re-offered at the action (Topher,
             2026-09-18; panel.identity.attribution-visible). -->
        <b class="opacity-60">${t.id}</b>
        ${reasonChip(t)}
        <span class="badge badge-xs ${CHIP[t.status] ?? 'badge-ghost'}">${t.status}</span>
      </span>
    </div>
    ${
      where.length
        ? html`<div class="px-3.5 pb-1 text-[11px] opacity-45">${where.map(
            (part, i) => html`${i ? ' · ' : nothing}${part}`,
          )}</div>`
        : nothing
    }
    <div class="min-h-0 flex-1 overflow-y-auto px-3.5 pb-2" data-testid="thread.body">
      ${unsafeHTML(
        MSG.stream(t, {
          seenAt: seenAtOpen[t.id] ?? null,
          rules: (S.data?.rows ?? []).map((r) => r.rule),
          pending: pendingReplies.get(t.id) ?? [],
          names: names(),
        }),
      )}
      ${
        sketch?.proposed
          ? html`<button class="btn btn-xs btn-outline mt-2 w-full" data-sketch="${t.anchor.screen}"
        @click=${(e) => fire(e.currentTarget, 'view-sketch', { screen: t.anchor.screen })}>
        ⚠ View the proposed sketch</button>`
          : nothing
      }
    </div>
    <!-- The composer stays put at the foot of the screen: type, press Enter,
         the message is there. Above it, one line says whose move this is
         and what happens next; the buttons under it are only the moves this
         reader takes from here. -->
    <div class="shrink-0 border-t border-base-300 p-2">
      <!-- The label floats on the top edge, the way a material input's does,
           so the sentence takes the full width under it rather than sharing
           the row with the chip (Topher, 2026-09-17). The top padding leaves
           the chip room to sit on the border without touching the text. -->
      <div class="relative mt-2 mb-1.5 rounded border border-dashed px-2 pt-2.5 pb-1.5 text-[11px] leading-snug ${TURN[turn.party].line}"
        data-testid="thread.turn" data-party="${turn.party}">
        <span class="absolute -top-[7px] left-2 rounded px-1 text-[9px] font-bold uppercase leading-[14px] tracking-wider ${TURN[turn.party].chip}">${turn.label}</span>
        <span class="opacity-75">${turn.text}</span>
      </div>
      <textarea id="wdp-note" data-testid="thread.reply" rows="2" class="textarea textarea-xs w-full resize-none"
        placeholder="${composerPlaceholder(t, role)}"
        @input=${(e) => {
          S.threadNote = e.currentTarget.value;
        }}
        @keydown=${(e) => {
          // Enter sends, Shift+Enter breaks the line - the muscle memory
          // everyone already has. The buttons stay for the pointer.
          if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
          e.preventDefault();
          const text = e.currentTarget.value.trim();
          if (S.openThread && text) threadAct(S.openThread, enterAct);
        }}>${S.threadNote}</textarea>
      <!-- Waive stands alone at the far left; the rest gather on the right. -->
      <div class="mt-1 flex flex-wrap items-center justify-end gap-1">
        ${acts.map(
          ([label, act, tone]) =>
            html`<button class="btn btn-xs ${TONE[tone]}${tone === 'warn' ? ' mr-auto' : ''}"
            data-testid="thread.actions" data-act="${act}" data-tid="${t.id}"
            @click=${() => threadAct(t.id, act)}>${label}</button>`,
        )}
      </div>
      ${
        S.threadSay
          ? html`<div class="mt-1 text-[11px] text-warning" data-testid="thread.say">${S.threadSay}</div>`
          : nothing
      }
    </div>`;
}
