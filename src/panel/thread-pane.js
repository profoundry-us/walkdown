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
import { html, live, nothing, unsafeHTML } from '../../vendor/lit.js';
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
import { askOptions } from './ask.js';
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

/** Every name an anchor has had on a screen, oldest first - the filed name, then each rename. */
export const renameChain = (sc, element) => {
  const out = [element];
  const seen = new Set([element]);
  let cur = element;
  while (sc?.renames?.[cur] && !seen.has(sc.renames[cur])) {
    cur = String(sc.renames[cur]);
    seen.add(cur);
    out.push(cur);
  }
  return out;
};


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
      ? (() => {
          /*
           * The name it was filed under, always - a thread is a record of a
           * moment. When the storyboard says the anchor has since been
           * renamed, the record says so beside it, and resting on it lists
           * every name it has had (q-0252).
           */
          const chain = renameChain(sc, t.anchor.element);
          /*
           * The bubble opens down and to the right, from the left edge of
           * the name: centred on it, it ran off the pane's left edge, and
           * inside the line's own faded ink it was unreadable (n-0329). The
           * line is faded part by part below, so the bubble is not.
           */
          return chain.length > 1
            ? html`<span class="tooltip tooltip-bottom tooltip-start [--tt-trans:0]"
                ><span class="tooltip-content z-50 whitespace-nowrap font-mono text-[11px]" data-testid="thread.renames">${chain.join(' → ')}</span
                ><span class="font-mono opacity-45">${t.anchor.element}</span>
                <span class="badge badge-xs badge-outline align-middle opacity-45" data-testid="thread.renamed">renamed</span></span>`
            : html`<span class="font-mono opacity-45">${t.anchor.element}</span>`;
        })()
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
  /*
   * A picture dropped anywhere on the thread screen is taken, the way the
   * pin form takes one dropped anywhere on it. The box alone was the
   * target, two rows tall, and a drop that missed it by a finger went to
   * the browser, which opened the file in a new tab (Topher, 2026-09-21,
   * n-0328). Both handlers here, since the wrapper is what the drop lands on.
   */
  const zone = dropZone('thread', (e) => pasteShots(e));
  return html`
    <div class="relative flex h-full min-h-0 flex-col rounded-box ${dropZoneClass('thread')}" data-testid="thread.screen"
      @dragenter=${zone.enter} @dragleave=${zone.leave} @dragover=${zone.over} @drop=${zone.drop}>
    ${dropCover('thread', 'It goes with your next reply.')}
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
        ? html`<div class="px-3.5 pb-1 text-[11px]">${where.map(
            (part, i) =>
              html`${i ? html`<span class="opacity-45"> · </span>` : nothing}${
                typeof part === 'string' ? html`<span class="opacity-45">${part}</span>` : part
              }`,
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
        ${
          // An open question re-asks itself above the box: its opening
          // message, however far up the stream the replies have pushed it
          // (Topher, 2026-09-19; the rule's detail does the same).
          t.kind === 'question' && t.status === 'open'
            ? html`<div class="mt-1.5 rounded bg-base-100/70 px-1.5 py-1" data-testid="thread.ask">
                <div class="wd-stream max-h-48 overflow-y-auto">${unsafeHTML(
                  MSG.stream({ replies: [{ ...MSG.messages(t)[0], options: undefined }] }, { rules: (S.data?.rows ?? []).map((r) => r.rule), names: names() }),
                )}</div>
                <!-- The choices, here too (n-0319): a question is answered
                     from wherever it is read, and Answer below sends the
                     pick with the words. -->
                ${askOptions(t)}
              </div>`
            : nothing
        }
      </div>
      ${pastedShots()}
      <!-- The words are a live() property binding, as on the rule's composer,
           not child text: child text only seeds a textarea, and a plain
           .value binding compares against what lit last wrote rather than
           what the box holds - typing renders nothing, so a send that
           emptied the state found '' already committed and left the typed
           reply in the box for the next Enter to post again (n-0332). -->
      <textarea id="wdp-note" data-testid="thread.reply" rows="2" class="textarea textarea-xs w-full resize-none"
        placeholder="${composerPlaceholder(t, role)}"
        .value=${live(S.threadNote)}
        @input=${(e) => {
          S.threadNote = e.currentTarget.value;
        }}
        @paste=${(e) => pasteShots(e)}
        @keydown=${(e) => {
          // Enter sends, Shift+Enter breaks the line - the muscle memory
          // everyone already has. The buttons stay for the pointer.
          if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
          e.preventDefault();
          const text = e.currentTarget.value.trim();
          if (S.openThread && text) threadAct(S.openThread, enterAct);
        }}></textarea>
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
    </div>
    </div>`;
}


/*
 * A picture pasted into the composer (n-0096): held until the reply is sent,
 * shown small above the box with a way to drop it, and sent with the words.
 * Paste is the door because that is where a screenshot already is.
 */
/** Whether a drag carries files - the only kind of drag a drop zone answers to. */
export const dragFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

/*
 * A drop zone says it will take the picture (Topher, 2026-09-21): a dashed
 * primary outline the moment a file is in the air anywhere over the window,
 * and a solid one with a tint while the file is over the zone itself. Only
 * files - dragging text across the panel lights nothing. The window-level
 * half (S.dragFiles) is kept by the shell; each zone keeps its own
 * enter/leave depth, because dragenter and dragleave fire for every child
 * the pointer crosses.
 */
const depth = {};
export const dropZoneClass = (key) =>
  S.dragOver === key
    ? 'outline outline-2 -outline-offset-2 outline-primary'
    : S.dragFiles
      ? 'outline-dashed outline-2 -outline-offset-2 outline-primary/50'
      : '';
/*
 * The cover a zone wears while a file is in the air (n-0333): a translucent
 * ground over the conversation with a line saying what a drop here does,
 * denser while the file is over it. It sits inside the zone, so the zone's
 * own enter and leave count it like any child, and a drop on it is a drop
 * on the zone.
 */
export const dropCover = (key, line) =>
  S.dragFiles
    ? html`<div class="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center rounded-box backdrop-blur-[1.5px] ${
        S.dragOver === key ? 'bg-primary/25' : 'bg-primary/15'
      }" data-testid="${key === 'rule' ? 'detail.drop-cover' : 'thread.drop-cover'}">
      <!-- The words on a ground of their own: over the conversation's text
           they were unreadable (seen on the 2026-09-21 look). -->
      <div class="flex max-w-[26ch] flex-col items-center gap-0.5 rounded-box border border-primary/60 bg-base-100 px-3 py-2 text-center shadow-lg">
        <span class="text-[13px] font-semibold">${S.dragOver === key ? 'Drop it' : 'Drop the picture here'}</span>
        <span class="text-[11px] opacity-80">${line}</span>
      </div>
    </div>`
    : nothing;
export function dropZone(key, take, allowed = () => true) {
  const on = (e) => allowed() && dragFiles(e);
  return {
    enter: (e) => {
      if (!on(e)) return;
      depth[key] = (depth[key] ?? 0) + 1;
      if (S.dragOver !== key) {
        S.dragOver = key;
        requestRender();
      }
    },
    leave: (e) => {
      if (!on(e)) return;
      depth[key] = Math.max(0, (depth[key] ?? 0) - 1);
      if (!depth[key] && S.dragOver === key) {
        S.dragOver = null;
        requestRender();
      }
    },
    over: (e) => {
      if (on(e)) e.preventDefault();
    },
    drop: (e) => {
      depth[key] = 0;
      if (S.dragOver === key) S.dragOver = null;
      if (allowed()) take(e);
    },
  };
}

export function pasteShots(e, key = 'threadShots') {
  // Paste and drop are the same door: a file from the clipboard, or one
  // dragged from the desk onto the box (n-0328). `key` says which box holds
  // them - the thread screen's, or the rule's (n-0328 again: a picture
  // dropped while failing a rule had nowhere to go).
  const files = [...(e.clipboardData?.files ?? e.dataTransfer?.files ?? [])].filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  for (const f of files.slice(0, 4 - S[key].length)) {
    const reader = new FileReader();
    reader.onload = () => {
      S[key] = [...S[key], { name: f.name || 'pasted.png', type: f.type, data: String(reader.result) }];
      requestRender();
    };
    reader.readAsDataURL(f);
  }
}

/** The pictures held on a box, small, each with a way to drop it. */
export function pastedShots(key = 'threadShots', testid = 'thread.shots') {
  if (!S[key].length) return nothing;
  return html`<div class="mb-1 flex flex-wrap gap-1" data-testid="${testid}">${S[key].map(
    (s, i) => html`<span class="relative inline-block">
      <img src="${s.data}" alt="${s.name}" class="h-12 rounded border border-base-300">
      <button type="button" class="btn btn-circle btn-ghost btn-xs absolute -right-1 -top-1 h-4 min-h-0 w-4 bg-base-100 p-0 text-[10px]"
        title="Drop this picture" @click=${() => {
          S[key] = S[key].filter((_, j) => j !== i);
          requestRender();
        }}>✕</button>
    </span>`,
  )}</div>`;
}
