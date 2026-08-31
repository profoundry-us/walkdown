/*
 * Everything the panel says INTO threads, and what it remembers about
 * reading them: replies, transitions, notes on rules, read marks, and the
 * refusals that guard attribution. This is thread I/O — the panes render
 * conversations; this module is how anything gets said.
 *
 * It talks upward only through the shell interface (shell.js): repaint,
 * refetch, open Settings. That is what lets every pane import it without
 * importing app.js back, which is the cycle this file was carved out of.
 */
import { MSG } from '../../lib/message-stream.js';
import { openSettings, requestReload, requestRender } from './shell.js';
import { D, identityOverride, S, store } from './state.js';
import { toast } from './toast.js';
import { api, esc } from './util.js';
import { HUMAN_ONLY, NEEDS_REASON, TERMINAL, threadsFor, whoAmI } from './vocab.js';

/**
 * The handles that resolve to a full name, for every message on screen.
 *
 * Every handle this machine could have signed with goes in - the username,
 * the OS name, the full name records were written under before identity and
 * display name were told apart. Old records are never rewritten; this is
 * what stops them reading as somebody else.
 */
export const names = () =>
  MSG.nameMap({
    username: whoAmI(),
    name: (identityOverride.name ?? S.data?.identity?.name ?? '').trim(),
    handles: [...(S.data?.identity?.handles ?? []), S.session?.actor].filter(Boolean),
  });

/*
 * Threads remember where your reading stopped, so opening one the agent has
 * replied to twice shows which part is new. `seen` is what is remembered;
 * `seenAtOpen` freezes the mark for this viewing, or the New line would
 * vanish the instant it appeared.
 */
const SEEN_KEY = () => `walkdown:seen:${S.BP}`;
let seen = {},
  seenFor = null;
/* Read marks belong to a blueprint, and the blueprint is chosen after boot -
   so they are loaded once the choice is settled, and again if it changes. */
export async function loadSeen() {
  if (seenFor === S.BP) return;
  seenFor = S.BP;
  seen = (await store.get(SEEN_KEY()).catch(() => null)) ?? {};
}
export const seenAtOpen = {};
/** Replies on screen before the server has answered, by thread id. */
export const pendingReplies = new Map();

export const unreadCount = (t) => {
  const at = seen[t.id];
  if (!at) return 0;
  return (t.replies ?? []).filter((r) => String(r.created ?? '') > String(at)).length;
};

export function markSeen(id) {
  seenAtOpen[id] = seen[id] ?? null;
  seen[id] = new Date().toISOString();
  store.set(SEEN_KEY(), { ...seen });
}

export function say(msg) {
  const el = D.host.querySelector('#wdp-tsay');
  if (!el) return toast(msg, { tone: 'error' });
  el.textContent = msg;
  el.classList.remove('hidden');
}

export function sayFiling(msg) {
  for (const id of ['#wdp-nsay', '#wdp-vsay']) {
    const el = D.host.querySelector(id);
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
      return;
    }
  }
  toast(msg, { tone: 'error' });
}

/** File the feedback box's text as a note on the rule; null on refusal. */

export function sayVerdict(msg) {
  const el = D.host.querySelector('#wdp-vsay');
  if (!el) return toast(msg, { tone: 'error' });
  el.textContent = msg;
  el.classList.remove('hidden');
}

export async function threadPost(path, body) {
  const res = await fetch(api(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    say(out.error ?? 'request failed');
    return false;
  }
  return true;
}

/**
 * A reply lands on screen before the server has answered - the message is
 * what you wrote, and waiting on a round trip to see it is what makes a
 * thread feel like a form. If the post is refused the message stays,
 * marked, and the text comes back to the composer so it can be sent again.
 */
async function postReply(id, text, actor) {
  /*
   * The same refusal postRuleNote makes, for the same reason.
   *
   * This sent `author: actor || undefined`, the key fell out of the JSON, and
   * the server filled it from the machine's username - so a reply landed in a
   * conversation under a name the panel had never shown, while the composer
   * said only "set your name...". A reply is attributed work.
   *
   * Fixing the note path alone left the rule half-kept, which is what an
   * independent re-judge found an hour after the first fix: one path over,
   * identical line, same server fallback. Worth remembering that the bug was
   * never in either function - it was in the shape `actor || undefined`,
   * which reads as a default and is a handoff.
   */
  const who = (actor ?? '').trim();
  if (!who || who === 'agent') {
    say('A reply is recorded under a person\u2019s name \u2014 set it in Settings (the gear).');
    openSettings();
    return false;
  }
  const msg = { author: who, created: new Date().toISOString(), body: text, pending: true };
  const list = pendingReplies.get(id) ?? [];
  pendingReplies.set(id, [...list, msg]);
  S.threadNote = '';
  requestRender();
  const ok = await threadPost(`/api/threads/${id}/replies`, { author: who, body: text });
  if (ok) {
    pendingReplies.set(
      id,
      (pendingReplies.get(id) ?? []).filter((m) => m !== msg),
    );
    // The reply is yours and you have just read it: do not mark it new.
    if (seen[id]) {
      seen[id] = new Date().toISOString();
      store.set(SEEN_KEY(), { ...seen });
    }
    await requestReload();
  } else {
    msg.pending = false;
    msg.failed = true;
    S.threadNote = text;
    requestRender();
  }
  return ok;
}

/** Reply and lifecycle, under the same governance the server enforces. */
export async function threadAct(id, status) {
  const t = (S.data.threads ?? []).find((x) => x.id === id);
  if (!t) return;
  const text = (D.host.querySelector('#wdp-note')?.value ?? '').trim();
  const actor = whoAmI();
  const humanOnly = HUMAN_ONLY.includes(status);
  // Agents claim work; a person accepts it. The server refuses this too —
  // saying so here means you find out before you have written the reason.
  if (humanOnly && (!actor || actor === 'agent')) {
    say(
      'Verify and waive are recorded under a person\u2019s name \u2014 set it in Settings first.',
    );
    return openSettings();
  }
  /*
   * And every OTHER transition needs a name too, which this guard used to
   * leave to the two human-only ones. Reopening posted `actor: ''`, went
   * through, and lib/threads.js filed the reason as a reply authored
   * "unknown" - a transition recorded under nobody, in a ledger whose whole
   * claim is that a verdict says whose judgment it was. Answering was the
   * same. Not the human-only refusal, which is about WHICH person may act;
   * this one is about there being a person at all.
   */
  if (!actor) {
    say('A thread action is recorded under a person\u2019s name \u2014 set it in Settings first.');
    return openSettings();
  }
  if (status === '__reply') {
    if (!text) return say('Write the reply first.');
    await postReply(id, text, actor);
    return;
  }
  if (status === '__answer') {
    if (!text) return say('Write the answer first \u2014 answering a question records it.');
    if (
      (await postReply(id, text, actor)) &&
      (await threadPost(`/api/threads/${id}/status`, { status: 'answered', actor }))
    )
      await requestReload();
    return;
  }
  const needsReason = NEEDS_REASON.includes(status);
  if (needsReason && !text)
    return say(
      `${status === 'waived' ? 'Waiving' : 'Reopening'} is recorded with a reason \u2014 write it above, then press again.`,
    );
  if (
    await threadPost(`/api/threads/${id}/status`, {
      status,
      actor,
      reason: needsReason ? text : undefined,
    })
  ) {
    S.threadNote = '';
    // A thread that ends leaves the active list, so its screen has nothing
    // left to show — slide back to where it came from rather than emptying
    // the pane and stranding the reader on a blank one.
    if (TERMINAL.includes(status)) {
      S.openThread = null;
      if (S.view === 'thread') S.view = S.selected ? 'detail' : 'list';
      // An ended conversation is a finished piece of work, whichever way it
      // ended - verified, waived or incorporated - so it reads as one.
      toast(`<b>${esc(id)}</b> ${esc(status)} — it leaves the rule’s active threads.`, {
        tone: 'success',
      });
    }
    await requestReload();
  }
}

/*
 * Verify every addressed thread on one rule. Same governance as verifying
 * one: it is recorded under the person pressing it, and refused outright
 * without a name, because an agent may claim work and never accept it.
 */
export async function verifyAll(rule) {
  const actor = whoAmI();
  if (!actor || actor === 'agent') {
    toast(
      'Verifying is recorded under a person\u2019s name \u2014 set it in Settings (the gear).',
      { tone: 'error' },
    );
    return openSettings();
  }
  const pending = threadsFor(rule).filter((t) => t.status === 'addressed');
  if (!pending.length) return;
  let done = 0;
  for (const t of pending)
    if (await threadPost(`/api/threads/${t.id}/status`, { status: 'verified', actor })) done += 1;
  await requestReload();
  // All of them is the result asked for; a partial pass is not a failure but
  // it is unfinished, and the colour is the difference.
  toast(
    done === pending.length
      ? `<b>${done}</b> thread${done === 1 ? '' : 's'} verified on ${esc(rule)}.`
      : `<b>${done}</b> of ${pending.length} verified \u2014 the rest are still open.`,
    { tone: done === pending.length ? 'success' : 'warning' },
  );
}

export async function postRuleNote(rule, body) {
  /*
   * Refuse rather than let the server choose a name for us.
   *
   * This sent `author: undefined` when the sitting had no actor, the field
   * dropped out of the JSON, and the server filled it in from the machine's
   * own username - so a note went into the ledger under a name the panel had
   * never put on screen. `panel.identity.attribution-visible` says a defaulted
   * identity is always visible BEFORE it is used, and this was the one path
   * that used one nobody had seen. Finish already refused; the note-filing
   * half did not, so a fail could be recorded, and its reason attributed,
   * under a stranger.
   *
   * Found by an agent walkdown on 2026-08-28 emptying Settings and pressing
   * Fail. n-0116 had looked at the same screen and judged it harmless on the
   * belief that every attributed action was refused; that belief was true of
   * every path but this one.
   */
  /*
   * whoAmI() rather than the sitting's actor, because a rule is now a place
   * to talk WITHOUT a sitting - and outside one, S.session is null, which
   * this line used to read straight through. It keeps the guard it was
   * written for: whoAmI is precisely the name the panel puts on screen as
   * you, in the bar, in Settings and above both composers, so a note can
   * still never be filed under a name nobody was shown (n-0116, n-0121).
   */
  const author = whoAmI();
  if (!author || author === 'agent') {
    sayFiling(
      'A note is recorded under a person\u2019s name \u2014 set it in Settings (the gear).',
    );
    openSettings();
    return null;
  }
  const res = await fetch(api('/api/threads'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'note', author, body, anchor: { rule } }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    sayFiling(out.error ?? 'note not filed');
    return null;
  }
  return out.id;
}

/** Open a thread on its own screen, landing where the reading resumes. */
export function openThreadView(id) {
  if (!(S.data?.threads ?? []).some((x) => x.id === id))
    return toast(`No thread ${esc(id)} here.`, { tone: 'error' });
  S.openThread = id;
  S.threadNote = '';
  markSeen(id);
  S.view = 'thread';
  requestRender();
  /*
   * The first unread message if there is one, and otherwise the newest -
   * never the top of an exchange you have already read.
   *
   * Scroll the STREAM, by hand. scrollIntoView looks like the obvious way to
   * say this and is not: it scrolls every scrollable ancestor, and one of the
   * ancestors here is the pane wrapper that carries the slide track. Landing
   * on an unread mark pushed that wrapper to scrollLeft 368, which slid all
   * three panes a third of a column left and left the reviewer looking at an
   * empty one - a thread with unread messages opened to blank, and only a
   * thread with unread messages, which is why it survived every check.
   *
   * offsetTop is measured against the stream because the stream is the
   * offsetParent here; the fallback covers a layout where it is not.
   */
  const pane = D.host.querySelectorAll('.wdp-track > div')[S.listTab === 'threads' ? 1 : 2];
  const stream = pane?.querySelector('.overflow-y-auto');
  const mark = pane?.querySelector('.wd-new');
  if (!stream) return;
  if (mark) {
    const top = stream.contains(mark.offsetParent ?? mark)
      ? mark.offsetTop
      : mark.getBoundingClientRect().top - stream.getBoundingClientRect().top + stream.scrollTop;
    stream.scrollTop = Math.max(0, top);
  } else {
    stream.scrollTop = stream.scrollHeight;
  }
}
