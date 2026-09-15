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
 * Everything here must stay browser-safe. Its one dependency is the vendored
 * markdown bundle (marked + DOMPurify), which loads in node too and is only
 * asked to render where there is a document.
 */

import { DOMPurify, marked } from '../vendor/markdown.js';

/*
 * What a rendered body may contain. Bodies arrive from the browser and from
 * agents, and marked passes raw HTML through as written - so the list is
 * short and closed: the structure markdown makes, links to the web, and
 * nothing that can run, load or style. A heading is deliberately not on it:
 * a reply with an <h2> in a 300px pane reads as a different document, and
 * nobody has written one in 664 messages.
 */
const ALLOWED_TAGS = ['p', 'br', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a', 'del', 'hr'];
const ALLOWED_ATTR = ['href', 'title'];

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

  /**
   * The zone every clock here is read in. Records carry UTC and nothing
   * else; the panel sets this from the identity the server hands it, which
   * is what the person declared in their config or, unsaid, the machine the
   * server runs on (n-0290). Null reads in the browser's own zone.
   */
  zone: /** @type {string | null} */ (null),

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
    if (!Number.isFinite(at.getTime())) return '';
    return at.toLocaleString(undefined, { timeZone: this.zone ?? undefined, timeZoneName: 'short' });
  },

  /** Today / Yesterday / a weekday-and-date, for the divider between days. */
  day(iso) {
    const at = new Date(iso ?? '');
    if (!Number.isFinite(at.getTime())) return '';
    // "Today" is the reader's today: the calendar date in THEIR zone, not
    // the browser's midnight, or a reply at 7pm Chicago reads as tomorrow's.
    const tz = this.zone ?? undefined;
    const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const asUtc = (s) => {
      const [y, m, d] = s.split('-').map(Number);
      return Date.UTC(y, m - 1, d);
    };
    const days = Math.round((asUtc(ymd(new Date())) - asUtc(ymd(at))) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return at.toLocaleDateString(undefined, { timeZone: tz, weekday: 'long' });
    return at.toLocaleDateString(undefined, { timeZone: tz, month: 'short', day: 'numeric' });
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
   * Message text as markdown, with the ids in it made clickable: a thread id
   * opens that thread, a rule id opens that rule. Line breaks survive (a
   * reply written as three lines was meant as three lines), lists are lists,
   * a backticked path is code, and an evidence key opens the file the server
   * resolves it to.
   *
   * The refs are linked AFTER rendering, on text nodes only, so an id inside
   * a code span or a link's address is left as the author typed it. Without
   * a document (node, the tests) the text comes back escaped and plain.
   */
  body(text, { rules = [] } = {}) {
    const src = String(text ?? '');
    if (!/** @type {any} */ (DOMPurify).isSupported || typeof document === 'undefined') return this.esc(src);
    // The sync parse: marked's types offer the options on the instance
    // rather than the call, and `async: false` is what keeps it a string.
    marked.setOptions({ gfm: true, breaks: true, async: false });
    const raw = /** @type {string} */ (marked.parse(src));
    // The bundle carries no types; DOMPurify's sanitize is built at load.
    const purify = /** @type {any} */ (DOMPurify);
    const clean = purify.sanitize(raw, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP: /^https?:\/\//i,
    });
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    for (const a of tpl.content.querySelectorAll('a')) {
      // A link to anything but http(s) lost its href to the sanitizer above
      // and is not a link: it becomes the words it wrapped, not an underlined
      // element that goes nowhere (n-0291).
      if (!a.getAttribute('href')) {
        a.replaceWith(...a.childNodes);
        continue;
      }
      // Links leave the pane: the panel lives inside somebody else's page.
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    this.linkRefs(tpl.content, new Set(rules));
    return tpl.innerHTML;
  },

  /**
   * Walk the text nodes under `root` (never inside code, pre or a) and
   * replace the ids and keys walkdown knows with what opens them.
   */
  linkRefs(root, known) {
    const skip = (n) => {
      for (let p = n.parentNode; p && p !== root; p = p.parentNode)
        if (/^(code|pre|a|button)$/i.test(p.nodeName)) return true;
      return false;
    };
    const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!skip(n)) texts.push(n);
    const RE = /\b([nq]-\d{4})\b|\b(runs\/evidence\/[\w.-]+\/[\w./-]+)|\b([a-z][\w-]*(?:\.[a-z][\w-]*){2,})\b/gi;
    for (const node of texts) {
      const value = node.nodeValue;
      let last = 0;
      const frag = root.ownerDocument.createDocumentFragment();
      let m;
      let any = false;
      RE.lastIndex = 0;
      while ((m = RE.exec(value))) {
        const [whole, thread, evidence, rule] = m;
        let el = null;
        if (thread) {
          el = root.ownerDocument.createElement('button');
          el.className = 'wd-ref link link-hover';
          el.dataset.threadRef = thread;
        } else if (evidence) {
          el = root.ownerDocument.createElement('a');
          el.className = 'wd-ref link link-hover font-mono';
          el.dataset.evidenceRef = evidence;
          el.href = '#';
        } else if (rule && known.has(rule)) {
          el = root.ownerDocument.createElement('button');
          el.className = 'wd-ref link link-hover font-mono';
          el.dataset.ruleRef = rule;
        }
        if (!el) continue;
        any = true;
        frag.append(value.slice(last, m.index));
        el.textContent = whole;
        frag.append(el);
        last = m.index + whole.length;
      }
      if (!any) continue;
      frag.append(value.slice(last));
      node.replaceWith(frag);
    }
  },

  /**
   * The stream. `seenAt` is when this reader last had the thread open: newer
   * messages sit under a "New" line, which is the whole reason to open a
   * thread you have already read.
   *
   * Consecutive messages from one author AND one provenance, close in time,
   * drop the repeated name and tile — the grouping is what makes a long
   * thread read as talking rather than as filing.
   *
   * Why provenance is part of the identity of a run and not merely a label on
   * it (n-0147): an agent records under the person it acts for, so grouping
   * by author alone puts a person's sentence and a machine's sentence in one
   * run — and the run shows its `via` only once, on the first message, which
   * is the person's. The field was written to disk and rendered nowhere,
   * which is precisely what n-0142 was. "Same author" was never the question;
   * "same speaker" was, and a machine typing for somebody is a different
   * speaker from that somebody.
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
          (prev.via ?? null) === (m.via ?? null) &&
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
             * only, like the name it sits beside — and a change of `via`
             * starts a new run, so "only once" never means "not at all"
             * (n-0147).
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
    const clock = at.toLocaleTimeString(undefined, { timeZone: this.zone ?? undefined, hour: 'numeric', minute: '2-digit' });
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
  /**
   * What an id names, before you follow it (n-0298): the card a reference
   * shows under the cursor, the way a PR link previews the PR. A rule shows
   * its statement and where its verdict stands; a thread shows who opened it,
   * why, where it stands and how it begins. Both surfaces link ids through
   * linkRefs above, so both preview them here - one card, one shape.
   *
   * Returns a string, like everything else here (see body). Unknown ids get
   * no card at all: an empty card is a box that says nothing.
   *
   * @param {{ rule?: any, thread?: any, names?: Record<string, string>, leaves?: boolean }} [opts]
   */
  preview({ rule = null, thread = null, names = {}, leaves = false } = {}) {
    const chip = (text, cls) =>
      `<span class="badge badge-xs ${cls}">${this.esc(text)}</span>`;
    const VERDICT = { pass: 'badge-success', fail: 'badge-error', pending: 'badge-ghost' };
    const STATUS = {
      open: 'badge-warning', answered: 'badge-warning', addressed: 'badge-info',
      verified: 'badge-success', incorporated: 'badge-success', settled: 'badge-success',
      recorded: 'badge-ghost', waived: 'badge-ghost',
    };
    let head = '';
    let lines = [];
    if (rule) {
      const open = (rule.threads ?? []).length;
      head = `<b class="font-mono">${this.esc(rule.rule)}</b>${chip(rule.verdict ?? 'pending', VERDICT[rule.verdict] ?? 'badge-ghost')}`;
      lines = [
        `<div class="wd-card-text">${this.esc(rule.statement ?? '')}</div>`,
        open ? `<div class="wd-card-meta">${open} open thread${open === 1 ? '' : 's'}</div>` : '',
      ];
    } else if (thread) {
      const reason = thread.kind === 'note' && thread.reason && thread.reason !== 'feedback' ? thread.reason : '';
      head = `<b class="font-mono">${this.esc(thread.id)}</b>${
        reason ? chip(reason, 'badge-outline opacity-70') : ''
      }${chip(thread.status ?? 'open', STATUS[thread.status] ?? 'badge-ghost')}`;
      const who = this.displayName(thread.author, names);
      const replies = (thread.replies ?? []).length;
      lines = [
        `<div class="wd-card-meta">${this.esc(who)}${thread.via ? ` <span class="wd-via">via ${this.esc(thread.via)}</span>` : ''} · ${this.esc(this.ago(thread.created))}${
          replies ? ` · ${replies} repl${replies === 1 ? 'y' : 'ies'}` : ''
        }</div>`,
        `<div class="wd-card-text">${this.esc(this.firstLine(thread.body))}</div>`,
      ];
    } else return '';
    return `<div class="wd-card-head">${head}</div>${lines.filter(Boolean).join('')}${
      leaves ? `<div class="wd-card-foot">Opens in walkdown, in a new tab</div>` : ''
    }`;
  },

  /**
   * How a message begins, as plain words: the first paragraph with the
   * markdown taken off, cut to fit a card. A preview is a glance, not the
   * message.
   */
  firstLine(body, max = 160) {
    const para = String(body ?? '').trim().split(/\n\s*\n/)[0] ?? '';
    const plain = para
      .replace(/\s*\n\s*/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
      .replace(/^\s*(?:[-*+]|\d+\.|>|#+)\s+/, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim();
    return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
  },

  /**
   * Wire the preview cards to a surface: one card element under `root`,
   * shown for whichever rule or thread reference is under the cursor or
   * holds keyboard focus, after the pause a pointer needs to be resting
   * rather than passing (n-0298). `rows`, `threads` and `names` are read
   * when a card is shown, so the card says what is true now.
   *
   * Hover AND focus: a pointer rests, a keyboard lands, and the card owes
   * both the same answer. It never takes the pointer itself - it is for
   * reading, and the click goes to the reference under it.
   *
   * @param {Element} root
   * @param {{ rows?: () => any[], threads?: () => any[], names?: () => Record<string, string> }} [opts]
   */
  hoverCards(root, { rows, threads, names } = {}) {
    const doc = root.ownerDocument ?? document;
    const card = doc.createElement('div');
    card.className = 'wd-card';
    card.dataset.testid = 'ref.preview';
    // Its own skin: the panel's theme sits on its two opaque surfaces, not
    // on the frame this card hangs from, and a card is a surface too.
    card.dataset.theme = 'blueprint';
    card.hidden = true;
    root.appendChild(card);
    let timer = null;
    let shown = null;
    const hide = () => {
      clearTimeout(timer);
      timer = null;
      shown = null;
      card.hidden = true;
    };
    const place = (ref) => {
      const r = ref.getBoundingClientRect();
      const vw = doc.defaultView?.innerWidth ?? 800;
      const vh = doc.defaultView?.innerHeight ?? 600;
      card.style.left = `${Math.max(8, Math.min(r.left, vw - card.offsetWidth - 8))}px`;
      // Under the reference, unless that would run off the bottom.
      const below = r.bottom + 6;
      card.style.top =
        below + card.offsetHeight <= vh - 8 ? `${below}px` : `${Math.max(8, r.top - card.offsetHeight - 6)}px`;
    };
    const show = (ref) => {
      const id = ref.dataset.ruleRef ?? ref.dataset.threadRef;
      const html = ref.dataset.ruleRef
        ? this.preview({
            rule: (rows?.() ?? []).find((x) => x.rule === id),
            leaves: ref.target === '_blank',
          })
        : this.preview({
            thread: (threads?.() ?? []).find((x) => x.id === id),
            names: names?.() ?? {},
            leaves: ref.target === '_blank',
          });
      if (!html) return hide();
      card.innerHTML = html;
      card.hidden = false;
      shown = ref;
      place(ref);
    };
    const refOf = (t) => t?.closest?.('[data-rule-ref], [data-thread-ref]');
    const arm = (ref, delay) => {
      if (!ref || ref === shown) return;
      clearTimeout(timer);
      timer = setTimeout(() => show(ref), delay);
    };
    root.addEventListener('pointerover', (e) => {
      const ref = refOf(e.target);
      if (ref) arm(ref, 350);
    });
    root.addEventListener('pointerout', (e) => {
      const ref = refOf(e.target);
      if (ref && !ref.contains(/** @type {PointerEvent} */ (e).relatedTarget)) hide();
    });
    root.addEventListener('focusin', (e) => {
      const ref = refOf(e.target);
      if (ref && ref.matches(':focus-visible')) arm(ref, 0);
    });
    root.addEventListener('focusout', (e) => {
      if (refOf(e.target)) hide();
    });
    root.addEventListener('pointerdown', hide, true);
    root.addEventListener('scroll', hide, true);
    root.addEventListener('keydown', (e) => {
      if (/** @type {KeyboardEvent} */ (e).key === 'Escape') hide();
    });
    return { hide };
  },

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
    .wd-text { overflow-wrap: anywhere; }
    /* The chat's size is for the chat. A rule's statement and steps read
       through the same renderer but keep the size the detail gave them - and
       a size utility on the element must win, so this is the rule that
       steps aside rather than one that overrides. */
    .wd-text:not(.wd-inherit) { font-size: 12.5px; line-height: 1.45; }
    /* Markdown's blocks, spaced as paragraphs in a chat rather than sections
       in a document: a little air between them, none above the first or
       below the last, so a one-line reply sits exactly where plain text did. */
    .wd-text > * { margin: 0; }
    .wd-text > * + * { margin-top: .45em; }
    .wd-text ul, .wd-text ol { padding-left: 1.25rem; }
    .wd-text ul { list-style: disc; }
    .wd-text ol { list-style: decimal; }
    .wd-text li + li { margin-top: .15em; }
    .wd-text li > p { margin: 0; }
    /* Code wears a wash of the chrome's own blue - the primary, the colour
       the links and the bar already speak in - so a path or an id stands
       apart from the prose in more than typeface. Yellow was tried first and
       read as yellow-on-yellow beside the warning badges. Tinted from the
       theme token, so a delivery with no theme still gets a wash. */
    .wd-text code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em;
      padding: .05em .3em; border-radius: .25rem;
      color: color-mix(in oklch, var(--color-primary, oklch(78% 0.10 235)) 88%, currentColor);
      background: color-mix(in oklch, var(--color-primary, oklch(78% 0.10 235)) 13%, transparent); }
    .wd-text pre { padding: .4rem .5rem; border-radius: .3rem; overflow-x: auto; white-space: pre;
      background: color-mix(in oklch, var(--color-primary, oklch(78% 0.10 235)) 9%, transparent);
      border: 1px solid color-mix(in oklch, var(--color-primary, oklch(78% 0.10 235)) 22%, transparent); }
    .wd-text pre code { padding: 0; background: none; color: inherit; font-size: .88em; }
    /* A rule id linked in the prose is code-shaped too, and takes the same wash. */
    .wd-text .wd-ref.font-mono { color: color-mix(in oklch, var(--color-primary, oklch(78% 0.10 235)) 88%, currentColor); }
    .wd-text blockquote { padding-left: .6rem; border-left: 2px solid color-mix(in oklch, currentColor 25%, transparent); opacity: .85; }
    .wd-text a { text-decoration: underline; text-underline-offset: 2px; }
    .wd-text hr { border: 0; border-top: 1px solid color-mix(in oklch, currentColor 15%, transparent); }
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
    /* The preview under a reference (n-0298): fixed to the viewport so it
       clears whatever pane the reference sits in, and never the pointer's -
       it is for reading, and the click goes to the reference beneath. */
    .wd-card { position: fixed; z-index: 99999; pointer-events: none; width: max-content; max-width: 19rem;
      padding: .45rem .6rem; border-radius: .4rem; font-size: 11.5px; line-height: 1.35;
      color: var(--color-base-content, currentColor); background: var(--color-base-100, #fff);
      border: 1px solid color-mix(in oklch, currentColor 18%, transparent);
      box-shadow: 0 6px 20px -6px rgba(0,0,0,.35); }
    .wd-card-head { display: flex; align-items: center; gap: .35rem; margin-bottom: .2rem; }
    .wd-card-head b { font-size: 11px; }
    .wd-card-meta { font-size: 10.5px; opacity: .6; margin-bottom: .15rem; }
    .wd-card-text { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .wd-card-foot { margin-top: .3rem; padding-top: .25rem; font-size: 10px; opacity: .5;
      border-top: 1px solid color-mix(in oklch, currentColor 12%, transparent); }
  `,
};

export { MSG };
