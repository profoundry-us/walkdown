/*
 * A thread, rendered as a conversation.
 *
 * The panel and the embed both show threads, and they have to show them the
 * same way — the same grouping, the same "new since you looked" line, the same
 * shape of message — or the two surfaces of one tool disagree about what a
 * conversation looks like. Both bundle this module, so there is one shape.
 *
 * The model is deliberately flat: a thread is an opening message plus replies,
 * and the opening message is not special. Everything append-only — no editing,
 * no deleting, no reactions. A verdict is the ledger's job, and a thumbs-up
 * that quietly means "addressed" without recording it would be a lie.
 *
 * Everything here must stay dependency-free and browser-safe.
 */

const MSG = {
  /** Same escaping rules as the rest of the chrome; bodies are user text. */
  esc: (s) =>
    String(s ?? '').replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    ),

  /** Up to two letters, from a name or an email-ish handle. */
  initials(name) {
    const parts = String(name ?? '?')
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean);
    if (!parts.length) return '?';
    return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
  },

  /**
   * A stable colour per name. Recognising who is speaking should not require
   * reading — and the agent is always the same green, so its voice is one
   * thing you learn once.
   */
  tint(name) {
    const who = String(name ?? '')
      .trim()
      .toLowerCase();
    if (who === 'agent') return 'oklch(52% 0.09 165)';
    // One tint per person: the first word is what a handle and a full name
    // have in common, so "topher" and "Topher Fangio" wear the same colour.
    const first = who.split(/[\s._-]+/)[0] || who;
    let h = 0;
    for (const ch of first) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `oklch(52% 0.10 ${h})`;
  },

  /** "12m ago" / "3h ago" / "2d ago" — short enough to sit beside a name. */
  ago(iso) {
    const then = Date.parse(iso ?? '');
    if (!Number.isFinite(then)) return '';
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  },

  /** The full stamp, for the hover title — "2h ago" is never the whole answer. */
  stamp(iso) {
    const at = new Date(iso ?? '');
    return Number.isFinite(at.getTime()) ? at.toLocaleString() : '';
  },

  /** Today / Yesterday / a weekday-and-date, for the divider between days. */
  day(iso) {
    const at = new Date(iso ?? '');
    if (!Number.isFinite(at.getTime())) return '';
    const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((midnight(new Date()) - midnight(at)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return at.toLocaleDateString(undefined, { weekday: 'long' });
    return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  },

  /** The opening note and its replies as one list. The note is message zero. */
  messages(thread) {
    return [
      // `via` rides along with the author, because it is a fact about the same
      // message: who decided it, and how it arrived.
      { author: thread?.author, via: thread?.via, created: thread?.created, body: thread?.body },
      ...(thread?.replies ?? []),
    ].filter((m) => m && (m.body ?? '') !== '');
  },

  /**
   * Message text, with the ids in it made clickable: a thread id opens that
   * thread, a rule id opens that rule. Line breaks survive, because a reply
   * written as three lines was meant as three lines.
   */
  body(text, { rules = [] } = {}) {
    const known = new Set(rules);
    return this.esc(text)
      .replace(
        /\b([nq]-\d{4})\b/g,
        '<button class="wd-ref link link-hover" data-thread-ref="$1">$1</button>',
      )
      .replace(/\b([a-z][\w-]*(?:\.[a-z][\w-]*){2,})\b/gi, (m) =>
        known.has(m)
          ? `<button class="wd-ref link link-hover font-mono" data-rule-ref="${m}">${m}</button>`
          : m,
      );
  },

  /**
   * The stream. `seenAt` is when this reader last had the thread open: newer
   * messages sit under a "New" line, which is the whole reason to open a
   * thread you have already read.
   *
   * Consecutive messages from one author, close in time, drop the repeated
   * name and tile — the grouping is what makes a long thread read as talking
   * rather than as filing.
   */
  stream(thread, { seenAt = null, rules = [], pending = [], names = {} } = {}) {
    const all = [...this.messages(thread), ...pending];
    let lastDay = '',
      prev = null,
      marked = false;
    const GROUP_MS = 5 * 60 * 1000;
    return all
      .map((m) => {
        const out = [];
        const day = this.day(m.created);
        if (day && day !== lastDay) {
          lastDay = day;
          prev = null;
          out.push(`<div class="wd-day"><span></span>${this.esc(day)}<span></span></div>`);
        }
        if (!marked && seenAt && m.created && String(m.created) > String(seenAt) && !m.pending) {
          marked = true;
          prev = null;
          out.push('<div class="wd-new"><span></span>New<span></span></div>');
        }
        const cont =
          prev &&
          prev.author === m.author &&
          Math.abs(Date.parse(m.created ?? '') - Date.parse(prev.created ?? '')) < GROUP_MS;
        prev = m;
        const who = this.displayName(m.author, names);
        out.push(`<div class="wd-msg${cont ? ' cont' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}">
        <div class="wd-ava" style="background:${this.tint(who)}">${this.esc(this.initials(who))}</div>
        <div class="wd-col">
          <div class="wd-head">${cont ? '' : `<span class="wd-who">${this.esc(who)}</span>`}${
            /*
             * How the words arrived, beside who decided them. An agent acting
             * on somebody's behalf records under that person - the
             * instruction was theirs - and this is the part a reader cannot
             * otherwise recover: which sentences a person typed. It was
             * written to disk and rendered nowhere, which made it a field
             * with no reader (n-0142). Shown on the first message of a run
             * only, like the name it sits beside.
             */
            !cont && m.via ? `<span class="wd-via">via ${this.esc(m.via)}</span>` : ''
          }<span
            class="wd-at" title="${this.esc(this.stamp(m.created))}">${
              m.failed ? 'not sent' : m.pending ? 'sending…' : this.esc(this.ago(m.created))
            }</span></div>
          <div class="wd-text">${this.body(m.body, { rules })}</div>
        </div>
      </div>`);
        return out.join('');
      })
      .join('');
  },

  /**
   * What to call whoever wrote a message. Threads record whatever name the
   * writer's machine had - "topher" from a git handle, "agent" from a script -
   * but a conversation should use the name a person goes by. `names` maps the
   * handles that are known to belong to someone to their full name; anything
   * unknown is shown as recorded, only capitalised.
   */
  displayName(name, names = {}) {
    const who = String(name ?? '').trim();
    if (!who) return 'someone';
    const key = who.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (names[key]) return names[key];
    return who
      .split(/(\s+)/)
      .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
      .join('');
  },

  /**
   * The handles that resolve to a full name. The person walking down is known
   * by the identity the server reports, and the agent is always the agent -
   * beyond those two, a name is whatever it says it is, because guessing that
   * two handles are one person is how a message ends up over the wrong face.
   *
   * Identity and display name are two fields now (n-0104): records carry the
   * username, the UI shows the full name. That makes this the seam where the
   * ledger's history stays legible - every handle the server says belongs to
   * this person, including the full name records were written under before the
   * split, maps onto the one name shown today. Nothing is rewritten; the old
   * messages simply stop looking like a second person.
   *
   * Takes the identity object; a bare string is still accepted and read as the
   * one name it used to be.
   */
  nameMap(identity) {
    const names = { agent: 'Agent' };
    const id = typeof identity === 'string' ? { name: identity } : (identity ?? {});
    const name = String(id.name ?? '').trim();
    const username = String(id.username ?? '').trim();
    const display = name || username;
    if (!display) return names;
    const key = (s) =>
      String(s)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    for (const handle of [username, name, ...(id.handles ?? [])])
      if (String(handle ?? '').trim()) names[key(handle)] = display;
    const first = name.split(/\s+/)[0];
    if (first && first.length > 2) names[key(first)] = display;
    return names;
  },

  /** Who has spoken in this thread, in the order they first did. */
  participants(thread) {
    const seen = [];
    for (const m of this.messages(thread)) {
      const who = m.author || 'someone';
      if (!seen.includes(who)) seen.push(who);
    }
    return seen;
  },

  /** One initials tile. The same face for the same person, everywhere. */
  avatar(name, cls = 'wd-ava') {
    const who = name || 'someone';
    return `<div class="${cls}" style="background:${this.tint(who)}" title="${this.esc(
      who,
    )}">${this.esc(this.initials(who))}</div>`;
  },

  /** "today at 1:09 PM" - when the conversation was last touched. */
  lastReply(iso) {
    const at = new Date(iso ?? '');
    if (!Number.isFinite(at.getTime())) return '';
    const clock = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const day = this.day(iso);
    return `${day === 'Today' ? 'today' : day === 'Yesterday' ? 'yesterday' : day} at ${clock}`;
  },

  /**
   * The replies line under a message: the faces of everyone in the thread, the
   * count as the way in, and when it was last touched. This is the affordance
   * that makes a list of threads read as a channel rather than as a table.
   */
  repliesLine(thread, names = {}) {
    const replies = thread?.replies ?? [];
    const faces = this.participants(thread)
      .slice(0, 3)
      .map((who) => this.avatar(this.displayName(who, names), 'wd-face'))
      .join('');
    if (!replies.length)
      return `<button class="wd-replies empty" data-testid="thread.replies" data-open-thread="${this.esc(thread?.id)}">Reply</button>`;
    return `<button class="wd-replies" data-testid="thread.replies" data-open-thread="${this.esc(thread?.id)}">
      <span class="wd-faces">${faces}</span>
      <span class="wd-count">${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</span>
      <span class="wd-last">Last reply ${this.esc(this.lastReply(replies.at(-1)?.created))}</span>
    </button>`;
  },

  /** One stylesheet for both deliveries, injected into each shadow root. */
  css: `
    .wd-msg { display: grid; grid-template-columns: 1.6rem 1fr; gap: .45rem; padding: .18rem 0; }
    .wd-msg.cont { padding-top: 0; }
    .wd-ava { width: 1.6rem; height: 1.6rem; border-radius: .3rem; display: grid; place-items: center;
      font-size: 10px; font-weight: 700; color: #fff; }
    .wd-msg.cont .wd-ava { visibility: hidden; height: 0; }
    .wd-head { display: flex; align-items: center; gap: .4rem; margin-bottom: .18rem; min-height: 1.15rem; }
    .wd-head .badge { padding-inline: .5rem; margin-left: .15rem; }
    .wd-who { font-weight: 600; font-size: 12px; }
    /* Quieter than the name and louder than nothing: provenance is a fact
       about the message, not a second author. */
    .wd-via { font-size: 10px; opacity: .55; font-style: italic; }
    .wd-at { font-size: 10px; opacity: .45; }
    .wd-msg.cont .wd-at { visibility: hidden; }
    .wd-msg.cont:hover .wd-at { visibility: visible; }
    .wd-text { font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    /* A collapsed thread sits a little lower under its header, so the name and
       the status read as the label of what follows rather than as part of it. */
    .wd-row .wd-text { margin-top: .1rem; }
    .wd-row { padding-block: .55rem; }
    .wd-msg.pending { opacity: .55; }
    .wd-msg.failed .wd-at { opacity: 1; color: oklch(72% 0.17 22); }
    .wd-ref { font-size: inherit; }
    /* Threads share one surface, like messages in a channel: no card, no rail,
       just a hairline between them and a lift under the cursor. */
    .wd-row + .wd-row { border-top: 1px solid color-mix(in oklch, currentColor 10%, transparent); }
    .wd-row:hover { background: color-mix(in oklch, currentColor 5%, transparent); }
    /* The collapsed thread: one message, then the way into the rest of it. */
    .wd-preview { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .wd-replies { display: flex; align-items: center; gap: .35rem; margin-top: .2rem;
      padding: .12rem .3rem .12rem .12rem; border-radius: .3rem; max-width: 100%; }
    .wd-replies:hover { background: color-mix(in oklch, currentColor 8%, transparent);
      outline: 1px solid color-mix(in oklch, currentColor 15%, transparent); }
    .wd-faces { display: flex; }
    .wd-face { width: 1.05rem; height: 1.05rem; border-radius: .22rem; display: grid; place-items: center;
      font-size: 7.5px; font-weight: 700; color: #fff; margin-right: -.2rem;
      box-shadow: 0 0 0 1.5px color-mix(in oklch, currentColor 12%, transparent); }
    .wd-count { font-size: 11.5px; font-weight: 600; color: var(--color-primary, currentColor); }
    .wd-last { font-size: 10.5px; opacity: .45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wd-replies.empty { font-size: 11px; opacity: .4; padding-left: .3rem; }
    .wd-day, .wd-new { display: flex; align-items: center; gap: .5rem; margin: .45rem 0 .3rem;
      font-size: 9.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; opacity: .45; }
    .wd-day span, .wd-new span { flex: 1; height: 1px; background: currentColor; opacity: .25; }
    .wd-new { color: oklch(72% 0.17 22); opacity: .9; }
  `,
};

export { MSG };
