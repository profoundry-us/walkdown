(function () {
  'use strict';

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

  /*
   * Which storyboard screen a location is — the one answer three separate
   * programs have to agree on.
   *
   * The panel resolves it to label the page and aim the ghost, the embed
   * resolves it to stamp pins, and the server resolves it again for pins that
   * arrive from a standalone embed. If those three ever disagree, a pin lands on
   * the wrong screen and nothing says so — so the logic lives here once. The
   * server imports it; the panel and the embed bundle it (rollup inlines this
   * module into each committed single-file build). It used to be PASTED into
   * the browser files by tools/sync-shared.mjs, back when they were
   * hand-written and could not import; the bundlers retired that tool.
   *
   * Everything here must stay dependency-free and browser-safe.
   */

  /**
   * A screen is identified by origin + path + fragment (docs/06 §2). The
   * storyboard writes that as one string, the way a URL is written:
   *
   *   prototype: /screens/waitlist-admin.html#invite-batch
   *   app: { path: /waitlist#invite-batch }
   *
   * A query may also be written, and it is treated differently on purpose: the
   * fragment is part of identity, the query is not. `?page=2` is the same screen
   * holding different data, and forking the storyboard on every filter would be
   * absurd. What a declared query does is break ties between screens that share
   * a path — /confirm.html and /confirm.html?already=1 are two screens, and the
   * constraint that a page belongs to exactly one blueprint is still checked on
   * path and fragment alone.
   */
  function splitScreenRef(ref) {
    if (!ref) return null;
    const s = String(ref);
    const h = s.indexOf('#'); // the fragment starts at the FIRST #,
    const fragment = h < 0 ? '' : s.slice(h); // so "#/order?id=1" stays whole
    const head = h < 0 ? s : s.slice(0, h);
    const q = head.indexOf('?');
    return { path: q < 0 ? head : head.slice(0, q), query: q < 0 ? '' : head.slice(q), fragment };
  }

  /** An empty hash and a bare "#" are the same absence. */
  function normalizeFragment(hash) {
    if (!hash || hash === '#') return '';
    return String(hash).startsWith('#') ? String(hash) : '#' + hash;
  }

  /** The canonical identity of one surface of one screen, for collision checks. */
  function screenKey(ref) {
    const parts = splitScreenRef(ref);
    return parts ? parts.path + parts.fragment : null;
  }

  function pathMatches(refPath, pathname) {
    if (!refPath) return false;
    return pathname === refPath || String(pathname).endsWith(refPath);
  }

  /**
   * The two surfaces a screen can be reached at, as parsed refs. The prototype
   * comes first because app paths are the loose ones — an app path of "/" is a
   * suffix of every URL there is — and a page that is genuinely the design
   * should never be reported as the running app.
   */
  function screenRefs(screen) {
    const out = [];
    const proto = splitScreenRef(screen?.prototype);
    if (proto) out.push({ surface: 'prototype', ref: proto });
    const app = splitScreenRef(screen?.app?.path);
    if (app) out.push({ surface: 'app', ref: app });
    return out;
  }

  /**
   * How well a declared ref fits a location: -1 for "not this one", otherwise
   * higher is more specific.
   *
   * A declared fragment must match exactly, because it is part of what the
   * screen IS. A ref with no fragment still matches a location that has one, and
   * scores lower — that fallback is what keeps an SPA usable before anyone has
   * enumerated its routes: at /orders#/order/1234 with only `/orders` in the
   * storyboard you are still, correctly, on the orders screen. Enumerating the
   * route later makes the answer sharper without breaking the one you had.
   */
  function scoreRef(ref, loc) {
    if (!pathMatches(ref.path, loc.pathname ?? '')) return -1;
    if (ref.fragment && ref.fragment !== normalizeFragment(loc.hash)) return -1;
    const want = new URLSearchParams(ref.query);
    const have = new URLSearchParams(loc.search ?? '');
    let bonus = 0;
    for (const [k, v] of want) {
      if (have.get(k) !== v) return -1;
      bonus += 1;
    }
    return (ref.fragment ? 100 : 0) + bonus;
  }

  /** Resolve a location to the most specific storyboard screen that claims it. */
  function matchScreen(screens, loc) {
    let best = null;
    for (const screen of screens ?? []) {
      for (const { surface, ref } of screenRefs(screen)) {
        const score = scoreRef(ref, loc ?? {});
        if (score < 0 || (best && score <= best.score)) continue;
        best = { screen, surface, fragment: ref.fragment, score };
      }
    }
    return best;
  }

  /** The identity-bearing parts of a URL string, for callers holding one. */
  function locationOfUrl(url) {
    try {
      const u = new URL(url);
      return { pathname: u.pathname, search: u.search, hash: u.hash };
    } catch {
      return null;
    }
  }

  /*
   * The vocabulary. One module, no dependencies, both runtimes.
   *
   * walkdown exists so that a term means one thing, and for its first month its
   * own vocabulary was string literals in ten files across two runtimes. The
   * panel's idea of a terminal thread agreed with the server's because two
   * people typed the same words carefully — the panel's TERMINAL even listed
   * them in a different order — and one typo would have disagreed silently, in
   * the direction that matters: a status the panel cannot draw is invisible,
   * not loud.
   *
   * So every LIST and TABLE lives here: the sets two files must agree on, the
   * transition table, and what derives from them. The line is enumeration, not
   * comparison — `status === 'open'` in a handler is fine, because a typo there
   * fails the check that drives it, but naming the members of a set anywhere
   * else is a second copy of this file waiting to drift.
   *
   * Browser-safe on purpose: no node imports, no I/O. The panel bundles it the
   * way it bundles screen-match; the CLI and server import it like any module.
   * Derivations (TERMINAL, statusesFor) are computed from FLOWS rather than
   * written beside it, because two spellings of one fact is the disease this
   * module treats.
   */

  // ---- threads --------------------------------------------------------------

  const THREAD_KINDS = Object.freeze(['note', 'question']);

  /** The id prefix a kind files under: n-0042 is a note, q-0042 a question. */
  const threadPrefix = (kind) => (kind === 'question' ? 'q' : 'n');

  /**
   * Legal status transitions per thread kind — the lifecycle itself.
   * Order is meaningful twice over: the keys are each kind's statuses in
   * lifecycle order, and each list is the order actions are offered in.
   */
  const FLOWS = Object.freeze({
    note: Object.freeze({
      open: Object.freeze(['addressed', 'waived']),
      addressed: Object.freeze(['verified', 'open', 'waived']),
      verified: Object.freeze([]),
      waived: Object.freeze([]),
    }),
    question: Object.freeze({
      open: Object.freeze(['answered', 'waived']),
      answered: Object.freeze(['incorporated', 'open', 'waived']),
      incorporated: Object.freeze([]),
      waived: Object.freeze([]),
    }),
  });

  /** Every status a thread of this kind may hold. */
  const statusesFor = (kind) => Object.freeze(Object.keys(FLOWS[kind] ?? FLOWS.note));

  /**
   * Statuses a thread never leaves. Derived, not listed: a status is terminal
   * exactly when its kind's flow offers it nowhere to go, so this cannot
   * disagree with FLOWS no matter who edits which.
   */
  const TERMINAL = Object.freeze([
    ...new Set(
      Object.values(FLOWS).flatMap((flow) =>
        Object.entries(flow)
          .filter(([, next]) => next.length === 0)
          .map(([status]) => status),
      ),
    ),
  ]);

  /** May a `kind` thread move from `from` to `to`? The one answer, for every caller. */
  const canTransition = (kind, from, to) => ((FLOWS[kind] ?? FLOWS.note)[from] ?? []).includes(to);

  /**
   * Statuses that mean "a person judged it". An agent claims work and never
   * accepts it — blueprint/AGENTS.md states the law, threads.js enforces it,
   * and the panel greys the buttons; all three read this list.
   */
  const HUMAN_ONLY = Object.freeze(['verified', 'waived']);

  /**
   * Transitions that must say why: waiving buries work and reopening un-buries
   * it, and both are illegible a week later without a sentence attached.
   */
  const NEEDS_REASON = Object.freeze(['waived', 'open']);

  /*
   * How a status is drawn, wherever it is drawn. daisyUI badge classes rather
   * than abstract tokens because every surface walkdown ships uses daisyUI -
   * and the panel and the embed carrying separate copies of this map is how a
   * status ends up amber on one surface and blue on the other.
   */
  const CHIP = Object.freeze({
    open: 'badge-warning',
    answered: 'badge-warning',
    addressed: 'badge-info',
    verified: 'badge-success',
    incorporated: 'badge-success',
    waived: 'badge-ghost',
  });

  // ---- verification ---------------------------------------------------------

  /**
   * The declarable verify tiers. `human` is not one: humans accept rules
   * through signoff, not through a verify list (docs/02-blueprint-schema.md —
   * the verify inversion).
   */
  const TIERS = Object.freeze(['checks', 'agent']);

  /** Who can sign a rule off. */
  const ROLES = Object.freeze(['eng', 'product', 'design']);

  /**
   * What one result in a run record may say. The last two are sign-off verdicts
   * on unbuilt rules — a judgment of the spec, recorded by walkdown sessions
   * only, and never build evidence (docs/05-runs-ledger.md).
   */
  const RESULT_STATUSES = Object.freeze([
    'pass',
    'fail',
    'skipped',
    'blocked',
    'approved',
    'refining',
  ]);

  /*
   * Did this thread arrive during a session that started at `started`? By
   * NUMBER, never by string: thread stamps carried seconds while session starts
   * carried milliseconds, and the lexicographic compare counted the whole start
   * second as "during" - a thread POSTed just before Start walkdown satisfied
   * the fail gate (n-0132). Thread stamps carry milliseconds now; an older
   * seconds-only stamp floors toward "before", which is the side a gate errs on.
   */
  function duringSession(created, started) {
    const c = Date.parse(created ?? '');
    const s = Date.parse(started ?? '');
    return Number.isFinite(c) && Number.isFinite(s) && c >= s;
  }

  /*
   * The embed's one icon, generated the way the panel's are - see
   * src/panel/icons.js for why the markup is inlined. Its own module so the
   * two machines that write embed source cannot fight: biome formats
   * src/embed/index.js, sync-phosphor owns everything between these markers,
   * and this file is excluded from formatting for exactly that reason.
   */
  /*
   * Phosphor, inlined - the embed ships as one file into somebody else's page
   * and cannot fetch an icon font. tools/sync-phosphor.mjs copies the markup
   * for what it draws out of @phosphor-icons/core.
   */
  // --- phosphor:start (generated by tools/sync-phosphor.mjs) ---
  const PHOSPHOR = {
    'map-pin-fill': '<path d="M128,16a88.1,88.1,0,0,0-88,88c0,75.3,80,132.17,83.41,134.55a8,8,0,0,0,9.18,0C136,236.17,216,179.3,216,104A88.1,88.1,0,0,0,128,16Zm0,56a32,32,0,1,1-32,32A32,32,0,0,1,128,72Z"/>',
  };
  // --- phosphor:end ---
  const icon = (name, cls = 'size-4') =>
    `<svg class="${cls}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${PHOSPHOR[name] ?? ''}</svg>`;

  /* walkdown embed — injected into prototypes and dev/staging builds.
   * Framed (inside the viewer): talks postMessage to the parent, which owns
   * screen context and persists pins. Standalone: posts straight to the local
   * walkdown server (its own origin), which resolves the screen from the URL.
   * Never ships to production. */
  /*
   * These used to be pasted in between markers by tools/sync-shared.mjs,
   * because a hand-written single file cannot import. The embed is built now
   * (rollup.embed.mjs -> lib/viewer/embed.js), so it imports the same modules
   * the server runs and the panel bundles - one implementation, and no paster
   * to keep honest.
   */

  (() => {
    /*
     * Once per page, across BOTH JavaScript worlds. A page can carry walkdown by
     * script tag while the extension injects it too, and those run in separate
     * globals — so a window flag cannot see the other copy and you get two of
     * everything. The DOM is the one thing the two worlds share. The script tag
     * wins when both are present: it runs at parse time, and an app that
     * declares its own blueprint should keep it.
     */
    if (document.documentElement.dataset.walkdownEmbed) return;
    document.documentElement.dataset.walkdownEmbed = '1';
    window.__walkdown = true;

    /*
     * Config arrives one of two ways. Served by `walkdown serve`, this file is a
     * <script> tag: the server substitutes the anchor attribute on its way out,
     * and the tag's src and data-bp say the rest. Loaded by the browser
     * extension there is no tag at all, so the bootstrap leaves the same answers
     * on window.__walkdownConfig first. One implementation, two deliveries —
     * forking it would guarantee the two drift.
     */
    const cfg = window.__walkdownConfig ?? {};
    const SUBSTITUTED = '__ANCHOR_ATTR__';
    const ANCHOR_ATTR =
      cfg.anchorAttribute ?? (SUBSTITUTED.startsWith('__ANCHOR') ? 'data-testid' : SUBSTITUTED);
    const SERVER =
      cfg.server ?? new URL(document.currentScript?.src ?? 'http://localhost:4700').origin;
    // The extension ships the stylesheet itself; served, it comes off the server.
    const STYLESHEET = cfg.stylesheet ?? SERVER + '/walkdown.css';
    const framed = window.parent !== window;

    /*
     * Which blueprint this page belongs to. One server can host sibling projects,
     * so without this a pin dropped on an example app files against whichever
     * blueprint `walkdown serve` happened to start in — silently, and into the
     * wrong project's threads/.
     *
     * Prefer this tag's own data-bp; fall back to any other walkdown tag on the
     * page that declares one (the panel usually does), so a page that already
     * says which project it is does not have to say it twice. The fallback is
     * read lazily: sibling script tags below this one are not parsed yet while
     * this script runs.
     */
    const ownBp = cfg.bp || document.currentScript?.dataset.bp || '';
    const blueprintId = () =>
      ownBp ||
      document.querySelector('script[src*="4700"][data-bp], script[data-walkdown][data-bp]')?.dataset
        .bp ||
      '';
    /*
     * The blueprint rides along as a query parameter — and it has to go BEFORE
     * any fragment, or the fragment swallows it: "#invite-batch?bp=..." is one
     * fragment named that, not a query.
     */
    const api = (path) => {
      const bp = blueprintId();
      const h = path.indexOf('#');
      const head = h < 0 ? path : path.slice(0, h);
      const frag = h < 0 ? '' : path.slice(h);
      const q = bp ? (head.includes('?') ? '&' : '?') + 'bp=' + encodeURIComponent(bp) : '';
      return SERVER + head + q + frag;
    };

    /* walkdown's own chrome, in this page and in the panel docked beside it.
       Pin mode must never treat a click on it as a place to put a pin. Both live
       in shadow roots now, and a click inside one retargets to its host, so the
       single marker covers everything either of them draws. */
    const CHROME = '[data-walkdown-chrome]';

    let ctx = { screen: null, surface: null, pinMode: false, pins: [], viewport: null };

    // The surface's own viewport — what the document was laid out at, regardless
    // of how the viewer scaled it into a pane.
    const currentViewport = () =>
      ctx.viewport ?? {
        name: window.innerWidth < 768 ? 'mobile' : 'desktop',
        width: window.innerWidth,
      };
    let overlay = null;
    /** The pin drawn at the spot while its form is open, and gone with it. */
    let placeholder = null;
    // Whose machine this is - the whole identity, username and full name both,
    // so a handle recorded in a thread can be shown as the name that person goes
    // by, whichever of their handles the record happens to carry.
    let identity = null;

    const $anchors = () => [...document.querySelectorAll(`[${ANCHOR_ATTR}]`)];
    const anchorId = (el) => el.getAttribute(ANCHOR_ATTR);

    // --- the layer walkdown draws in --------------------------------------------
    /*
     * Everything walkdown puts on the page lives in a shadow root, for the same
     * reason the panel's chrome does: this script runs inside somebody else's
     * application, and loading our stylesheet into their document would restyle
     * their buttons and headings through Tailwind's preflight. Inside a shadow
     * root the theme is ours and reaches nothing else — which is what lets the
     * pin form wear the same blueprint skin as the panel rather than a
     * hand-rolled lookalike that drifts from it.
     *
     * The host is positioned at the document's origin and has no size, so a
     * pin's absolute coordinates mean exactly what they meant when pins were
     * children of <body>.
     */
    const layer = document.createElement('div');
    layer.dataset.walkdownChrome = '';
    layer.style.cssText = 'position:absolute; top:0; left:0; width:0; height:0; pointer-events:none;';
    const lr = layer.attachShadow({ mode: 'open' });
    /*
     * The theme carrier. daisyUI paints a background on every [data-theme]
     * element, so it must never be something with size — this one is 0x0 and
     * paints nothing, while the custom properties it defines inherit down to the
     * chrome that actually has surfaces.
     */
    const root = document.createElement('div');
    root.dataset.theme = 'blueprint';
    // Undressed until the fetched stylesheet lands — see the rule that reads it.
    root.className = 'wd-unstyled';
    // Inheritance is the one thing a shadow root does not keep out, so what the
    // host page sets on our layer stops here - see the same reset in panel.js.
    root.style.cssText =
      'position:absolute; top:0; left:0; width:0; height:0; letter-spacing:normal; word-spacing:normal; text-transform:none; font-variant:normal; font-style:normal; text-indent:0; text-shadow:none; white-space:normal; word-break:normal; text-align:left; direction:ltr; text-decoration:none;';
    lr.appendChild(root);
    (document.body ?? document.documentElement).appendChild(layer);

    /*
     * The stylesheet goes into the shadow root, where it styles us alone. Its
     * @property rules are ALSO copied into the host document, because the CSS
     * Properties API only registers @property at document level — unregistered,
     * Tailwind's --tw-border-style and friends have no initial value and borders
     * and rings silently stop working. That copy declares types and paints
     * nothing, so it is the one thing we add to the host page. The panel adds
     * the same copy, so whichever loads first wins and the other stands down.
     */
    fetch(STYLESHEET)
      .then((r) => r.text())
      .then((css) => {
        const sheet = document.createElement('style');
        // The conversation's own rules ride along: one shared block, so a thread
        // looks the same here as it does in the panel.
        sheet.textContent = css + MSG.css;
        lr.insertBefore(sheet, root);
        // Dressed now, so what is drawn may be shown. Only on success: with no
        // stylesheet at all, pinning still works (see the catch below) and a
        // page of tooltips unfurled into the layout is not the fallback anyone
        // wants.
        root.classList.remove('wd-unstyled');
        if (document.querySelector('[data-walkdown-property-registrations]')) return;
        const props = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g);
        if (!props) return;
        const doc = document.createElement('style');
        doc.setAttribute('data-walkdown-property-registrations', '');
        doc.textContent = props.join('');
        document.head.appendChild(doc);
      })
      .catch(() => {
        /* unstyled beats absent; pinning still works */
      });

    /*
     * The only rules that must live in the host document, because they style the
     * host's own elements rather than ours: what a pinnable thing looks like
     * under the cursor. Everything with a surface of its own is in the shadow.
     */
    const style = document.createElement('style');
    style.textContent = `
    .wd-hover { outline: 2px solid #4bb8dd !important; outline-offset: 2px; cursor: crosshair !important; }
    /* The crosshair means "this is pinnable". walkdown's own chrome is UI, so
       it keeps normal cursors — and, more importantly, stays clickable. */
    .wd-pinning, .wd-pinning * { cursor: crosshair !important; }
    .wd-pinning [data-walkdown-chrome] { cursor: auto !important; }`;
    // The pin's own vocabulary, inside the shadow root where the chrome lives.
    const pinStyle = document.createElement('style');
    pinStyle.textContent = `
    .wd-dot { line-height: 0; }
    /* A white disc in the pin's head carrying the kind - the classic map
       marker, and the one place a letter is legible at this size. */
    .wd-dot .wd-kind {
      position: absolute; top: 3px; left: 50%; transform: translateX(-50%);
      width: 11px; height: 11px; border-radius: 50%; background: #fff; color: currentColor;
      font: 700 8px/11px ui-sans-serif, system-ui, sans-serif; text-align: center;
      pointer-events: none;
    }
    /* Where the pin will land, while the form is open: the same pin, quieter,
       so the spot is never in doubt while you are writing about it. */
    /* The tooltip is for reading, never for clicking: it hovers over the page
       around its pin, and a click meant for the pin must reach the pin. */
    .wd-pin .tooltip-content { pointer-events: none; }
    /* Nothing walkdown draws is shown before the sheet that dresses it has
       landed. This stylesheet is in the shadow root synchronously; the big one
       is FETCHED, and until it arrives a tooltip is simply a visible box of
       text - so every pin on the page showed its tooltip unprompted and then
       transitioned it away as the sheet applied, a fade-out nobody asked for on
       every load (n-0106). Hidden rather than transparent on purpose: opacity
       here would be unlayered CSS and would beat daisyUI's own hover rule,
       which lives in a cascade layer and loses to anything outside one however
       specific it is - a tooltip that never shows at all. */
    .wd-unstyled .tooltip-content { display: none; }
    .wd-ghost-pin { opacity: .55; animation: wd-bob 1.4s ease-in-out infinite; }
    @keyframes wd-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }`;
    document.head.appendChild(style);
    // The pin's styles belong to the shadow root: they dress our own markup, and
    // the host page must not inherit a single rule of it.
    lr.appendChild(pinStyle);

    /* One surface for both popovers: the panel's card, at the size of a note. */
    const FORM = `wd-form pointer-events-auto absolute z-[99999] w-64 rounded-box border
    border-primary/45 bg-base-100 p-3 text-[13px] text-base-content shadow-xl`;

    // --- pins -------------------------------------------------------------------
    /*
     * Which way a tooltip should open. It has to be visible, so it opens away
     * from whichever edge the pin is near: down when the pin is near the top,
     * up when it is near the bottom, and otherwise towards the side with the
     * room. Written as whole class names - a `tooltip-${dir}` the stylesheet
     * has never seen is a class that does not exist.
     */
    const TIP_SIDE = {
      top: 'tooltip-top',
      bottom: 'tooltip-bottom',
      left: 'tooltip-left',
      right: 'tooltip-right',
    };
    function tipSide(left, top) {
      const x = left - window.scrollX,
        y = top - window.scrollY;
      const W = window.innerWidth,
        H = window.innerHeight;
      // A tooltip is centred on its pin along the other axis, so a side is only
      // usable when there is room for the card AND for half of it either way.
      const room = { right: W - x, left: x, bottom: H - y, top: y };
      const vRoom = y > 60 && H - y > 60; // left/right are centred vertically
      const hRoom = x > 150 && W - x > 150; // top/bottom are centred horizontally
      if (vRoom && room.right > 300) return TIP_SIDE.right;
      if (vRoom && room.left > 300) return TIP_SIDE.left;
      if (hRoom && room.bottom > 130) return TIP_SIDE.bottom;
      if (hRoom && room.top > 130) return TIP_SIDE.top;
      // Cornered: nothing fits properly, so take the most room going.
      const best = Object.keys(room).reduce((a, k) => (room[k] > room[a] ? k : a), 'right');
      return TIP_SIDE[best];
    }

    function renderPins() {
      root.querySelectorAll('.wd-pin').forEach((p) => p.remove());
      for (const pin of ctx.pins) {
        const el =
          pin.element && document.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(pin.element)}"]`);
        /*
         * Where a pin sits. The spot it was placed at is the truth - it is where
         * the person was pointing - and the anchor is what keeps that spot
         * meaningful when the element moves: the offset within the element is
         * replayed against wherever the element is now. Without an offset (pins
         * placed before this was recorded) an anchored pin still rides the
         * element's corner, and an unanchored one keeps its absolute spot.
         */
        let left, top;
        // A pin's tip is the spot, so the icon hangs above and centred on it -
        // the same way a pin on a map points at the place rather than sitting
        // beside it.
        let spotX, spotY;
        if (el && pin.offset) {
          const rect = el.getBoundingClientRect();
          spotX = window.scrollX + rect.left + pin.offset.x;
          spotY = window.scrollY + rect.top + pin.offset.y;
        } else if (el) {
          const rect = el.getBoundingClientRect();
          spotX = window.scrollX + rect.right - 3;
          spotY = window.scrollY + rect.top + 12;
        } else if (pin.position) {
          // A positioned pin belongs to the surface it was placed on — the same
          // coordinates would mean something else in the other surface.
          if (pin.surface && ctx.surface && pin.surface !== ctx.surface) continue;
          spotX = pin.position.x;
          spotY = pin.position.y;
        } else continue;
        left = spotX - 11;
        top = spotY - 19;
        /*
         * The tooltip is ours, not the browser's: a title attribute waits a
         * second or so before it shows, which is a second per pin spent hovering
         * and hoping. This one is markup, so it is there on contact.
         */
        const wrap = document.createElement('div');
        wrap.className = `wd-pin pointer-events-auto absolute z-[99998] ${tipSide(left, top)} tooltip`;
        wrap.dataset.testid = 'pin.marker';
        wrap.dataset.thread = pin.id;
        wrap.style.left = `${left}px`;
        wrap.style.top = `${top}px`;
        const tip = document.createElement('div');
        tip.dataset.testid = 'pin.tip';
        tip.className = 'tooltip-content max-w-70 whitespace-normal text-left';
        tip.innerHTML = pinTip(pin);
        const dot = document.createElement('div');
        // A map pin, because that is what it is. Colour carries the state -
        // amber while the conversation is open, green once it has settled - and
        // the letter in the head says note or question.
        const settled = pin.status !== 'open';
        dot.className = `wd-dot pointer-events-auto relative cursor-pointer
        ${settled ? 'text-success' : 'text-warning'}`;
        dot.innerHTML = `${icon('map-pin-fill', 'size-[22px] drop-shadow')}
        <span class="wd-kind">${pin.kind === 'question' ? '?' : '!'}</span>`;
        dot.onclick = (e) => {
          e.stopPropagation();
          if (framed) window.parent.postMessage({ type: 'walkdown:open-thread', id: pin.id }, '*');
          else openThreadPopover(pin, wrap);
        };
        wrap.append(tip, dot);
        root.appendChild(wrap);
      }
    }

    /*
     * What a pin says under the cursor: which thread, what state it is in, what
     * it is about, and enough of the text to recognise it. Three short lines -
     * a tooltip that has to be read is a tooltip nobody reads.
     */
    function pinTip(pin) {
      const esc = (v) =>
        String(v ?? '').replace(
          /[&<>"]/g,
          (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
        );
      const where = [pin.rule ? `rule ${pin.rule}` : 'no rule', pin.screen, pin.element]
        .filter(Boolean)
        .join(' · ');
      const text = String(pin.body ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return `<div class="font-semibold">${esc(pin.id)} · ${esc(pin.kind)} · ${esc(pin.status)}</div>
      <div class="opacity-70">${esc(where)}</div>${
        text
          ? `<div class="mt-0.5">“${esc(text.length > 90 ? text.slice(0, 89) + '…' : text)}”</div>`
          : ''
      }`;
    }

    // --- standalone thread popover: read + reply (lifecycle actions live in the
    // viewer and CLI, where transitions are validated with an actor) -------------

    /**
     * The thread as a conversation, beside its pin. Same stream, same grouping
     * and the same standing composer as the panel - one tool, one way a thread
     * looks. Replies land on screen before the server answers; a refused one
     * says so and keeps the text.
     */
    function openThreadPopover(pin, dot, pending = []) {
      overlay?.remove();
      overlay = document.createElement('div');
      overlay.className = FORM;
      overlay.dataset.testid = 'thread.panel';
      overlay.style.left = dot.style.left;
      overlay.style.top = `${parseFloat(dot.style.top) + 24}px`;
      overlay.innerHTML = `
      <div class="flex items-center gap-1.5">
        <b class="font-mono text-[11.5px]">${pin.id}</b>
        <span class="badge badge-xs ${CHIP[pin.status] ?? 'badge-ghost'}">${pin.status}</span>
        <span class="text-[11px] opacity-40">${pin.kind}</span>
        <button class="btn btn-xs btn-ghost wd-cancel ml-auto">✕</button>
      </div>
      <div class="wd-stream mt-1 max-h-64 overflow-y-auto">${MSG.stream(pin, {
        pending,
        names: MSG.nameMap(identity),
      })}</div>
      <textarea class="textarea textarea-sm mt-2 h-14 w-full" placeholder="Reply…"></textarea>
      <div class="mt-1 flex items-center gap-2">
        <span class="text-[10px] opacity-40"><b>Enter</b> sends</span>
        <button class="btn btn-xs btn-primary wd-primary ml-auto">Reply</button>
      </div>`;
      root.appendChild(overlay);
      // Open at the newest message, the way you left a conversation - reading a
      // thread from its top means scrolling past what you already know.
      const stream = overlay.querySelector('.wd-stream');
      if (stream) stream.scrollTop = stream.scrollHeight;
      const box = overlay.querySelector('textarea');
      overlay.querySelector('.wd-cancel').onclick = () => closeForm();
      const send = () => {
        const body = box.value.trim();
        if (!body) return;
        // On screen first: waiting on a round trip to see your own words is what
        // makes a thread feel like a form.
        const msg = { author: 'you', created: new Date().toISOString(), body, pending: true };
        openThreadPopover(pin, dot, [...pending, msg]);
        fetch(api(`/api/threads/${pin.id}/replies`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.thread) {
              Object.assign(pin, { replies: data.thread.replies });
              openThreadPopover(pin, dot);
            } else throw new Error(data.error ?? 'refused');
          })
          .catch(() => {
            console.warn('walkdown: reply not recorded');
            openThreadPopover(pin, dot, [...pending, { ...msg, pending: false, failed: true }]);
            overlay.querySelector('textarea').value = body;
          });
      };
      overlay.querySelector('.wd-primary').onclick = send;
      box.onkeydown = (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        e.preventDefault();
        send();
      };
      box.focus();
    }

    // --- pin creation -----------------------------------------------------------
    // Opens for an anchored element, or — when nothing anchored was under the
    // click — at the click point itself, pinning by position.
    function openForm(el, point) {
      overlay?.remove();
      /*
       * The form opens at the spot, not at the element's foot: what you are
       * writing about is the point you clicked, and a form that jumps to the
       * bottom of a tall element leaves you writing about something you can no
       * longer see. Below the spot when there is room, above it when there is
       * not, and never off the side.
       */
      overlay = document.createElement('div');
      overlay.className = FORM;
      overlay.dataset.testid = 'pin.form';
      overlay.style.left = `${Math.max(
      window.scrollX + 8,
      Math.min(point.x - 24, window.scrollX + window.innerWidth - 268),
    )}px`;
      overlay.style.top = `${point.y + 18}px`;
      // The pin that is about to exist, drawn where it will land.
      placeholder?.remove();
      placeholder = document.createElement('div');
      placeholder.className = `wd-ghost-pin wd-dot pointer-events-none absolute z-[99997] text-warning`;
      placeholder.dataset.testid = 'pin.placeholder';
      placeholder.style.left = `${point.x - 11}px`;
      placeholder.style.top = `${point.y - 19}px`;
      placeholder.innerHTML = `${icon('map-pin-fill', 'size-[22px] drop-shadow')}
      <span class="wd-kind">!</span>`;
      root.appendChild(placeholder);
      overlay.innerHTML = `
      <b class="font-mono text-[11.5px]">${el ? anchorId(el) : 'unanchored spot'}</b>
      ${el ? '' : '<div class="text-[11px] opacity-50">no anchored element here — pinned by position</div>'}
      <textarea data-testid="pin.note" class="textarea textarea-sm mt-2 h-16 w-full" placeholder="What should change here?"></textarea>
      <label class="mt-1 flex items-center gap-2 text-[12px]">
        <input type="checkbox" data-testid="pin.kind" class="checkbox checkbox-xs wd-q"> question (not a note)</label>
      <div class="mt-2 flex gap-2">
        <button data-testid="pin.save" class="btn btn-xs btn-primary wd-primary">Pin it</button>
        <button data-testid="pin.cancel" class="btn btn-xs btn-ghost wd-cancel">Cancel</button>
      </div>`;
      root.appendChild(overlay);
      // Measured, then placed: how tall the form is depends on what it says.
      const h = overlay.getBoundingClientRect().height;
      if (point.y - window.scrollY + 18 + h > window.innerHeight)
        overlay.style.top = `${Math.max(window.scrollY + 8, point.y - h - 18)}px`;
      // The kind switch moves the placeholder's letter with it, so the pin on the
      // page always says what is about to be filed.
      const kindBox = overlay.querySelector('.wd-q');
      kindBox.onchange = () => {
        const mark = placeholder?.querySelector('.wd-kind');
        if (mark) mark.textContent = kindBox.checked ? '?' : '!';
      };
      overlay.querySelector('textarea').focus();
      overlay.querySelector('.wd-cancel').onclick = () => closeForm();
      overlay.querySelector('.wd-primary').onclick = () => {
        const body = overlay.querySelector('textarea').value.trim();
        const kind = overlay.querySelector('.wd-q').checked ? 'question' : 'note';
        if (!body) return;
        /*
         * The click point is recorded either way: it is where the person was
         * actually pointing, and an anchored pin that forgets it can only be
         * drawn at a corner of its element. The anchor rides alongside as the
         * durable part - element plus the offset within it, so the same spot
         * survives the element moving.
         */
        const rect = el?.getBoundingClientRect();
        submitPin({
          ...(el && {
            element: anchorId(el),
            offset: {
              x: Math.round(point.x - (window.scrollX + rect.left)),
              y: Math.round(point.y - (window.scrollY + rect.top)),
            },
          }),
          position: point,
          body,
          kind,
          surface: ctx.surface,
          viewport: currentViewport(),
        });
        closeForm();
      };
    }

    /** The form and the pin it was promising go together. */
    function closeForm() {
      overlay?.remove();
      overlay = null;
      placeholder?.remove();
      placeholder = null;
    }

    function submitPin(pin) {
      if (framed) {
        window.parent.postMessage({ type: 'walkdown:new-pin', ...pin }, '*');
      } else {
        fetch(api('/api/threads'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...pin,
            anchor: {
              ...(pin.element && { element: pin.element }),
              ...(pin.offset && { offset: pin.offset }),
              ...(pin.position && { position: pin.position }),
              ...(pin.surface && { surface: pin.surface }),
              ...(pin.viewport && { viewport: pin.viewport }),
            },
            url: location.href,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            // Carry back what the server stamped, so a pin opened straight after
            // being dropped reads as a message like any other.
            ctx.pins.push({
              ...pin,
              id: data.id,
              status: 'open',
              author: data.thread?.author,
              via: data.thread?.via ?? null,
              created: data.thread?.created,
            });
            renderPins();
          })
          .catch(() => console.warn('walkdown: server unreachable — start `walkdown serve`'));
      }
    }

    // --- pin mode interaction ---------------------------------------------------
    let hovered = null;
    document.addEventListener('mouseover', (e) => {
      if (!ctx.pinMode) return;
      const el = e.target.closest?.(`[${ANCHOR_ATTR}]`);
      hovered?.classList.remove('wd-hover');
      hovered = el;
      el?.classList.add('wd-hover');
    });
    document.addEventListener(
      'click',
      (e) => {
        if (!ctx.pinMode || overlay?.contains(e.target)) return;
        // walkdown's own chrome is never a pin target: the panel has to be able
        // to turn pin mode back off, a pin has to be able to open its thread, and
        // the docked panel has to keep working while you pin. A click inside the
        // panel's shadow root retargets to its host element, which carries the
        // marker, so one check covers the whole panel.
        if (e.target.closest?.(CHROME)) return;
        const el = e.target.closest?.(`[${ANCHOR_ATTR}]`);
        e.preventDefault();
        e.stopPropagation();
        // No anchored element under the cursor: pin the spot itself.
        openForm(el, { x: window.scrollX + e.clientX, y: window.scrollY + e.clientY });
      },
      true,
    );

    /*
     * A pointer going down on the page, reported outward.
     *
     * The panel's popovers — the screen picker and the desk tuner — close on a
     * click anywhere outside them, and the panel listens for that with a
     * capturing pointerdown on its own document. Framed, this page is a document
     * of its own: a pointerdown here never reaches the parent, so a click in the
     * application under review left them open, which is most of "anywhere
     * outside" (n-0111). So the frame says so out loud, the same way it already
     * reports leaving pin mode. Passive and never cancelled — this only tells,
     * it does not take the gesture from the application.
     */
    if (framed)
      document.addEventListener(
        'pointerdown',
        () => window.parent.postMessage({ type: 'walkdown:page-click' }, '*'),
        { capture: true, passive: true },
      );

    // Escape is the way out of any mode: it closes the open form first, then
    // leaves pin mode. Without it the only exit was the bar's control, which
    // itself was swallowing.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !ctx.pinMode) return;
      if (overlay) {
        closeForm();
        return;
      }
      setPinMode(false);
      if (framed) window.parent.postMessage({ type: 'walkdown:pin-mode', on: false }, '*');
    });

    const pinWatchers = new Set();
    function setPinMode(on) {
      ctx.pinMode = on;
      // Anywhere is pinnable, so the whole surface reads as targetable.
      document.documentElement.classList.toggle('wd-pinning', on);
      if (!on) {
        hovered?.classList.remove('wd-hover');
        overlay?.remove();
        overlay = null;
      }
      for (const fn of pinWatchers) fn(on);
    }

    /*
     * The one seam other walkdown chrome may use. The panel puts a pin-mode
     * control in its header, and pin mode has exactly one owner - this script -
     * so the panel asks rather than keeping a second copy of the state that
     * Escape would then have to remember to update.
     */
    window.walkdownEmbed = {
      isPinMode: () => ctx.pinMode,
      setPinMode,
      watchPinMode(fn) {
        pinWatchers.add(fn);
        return () => pinWatchers.delete(fn);
      },
    };

    /*
     * Screen identity, shared verbatim with the panel and the server so a pin
     * cannot land on one screen here and a different one there.
     */

    /*
     * The URL can change without the page reloading, and a modal, a drawer or an
     * SPA route is its own screen (docs/06 §2). hashchange and popstate cover
     * two of the three ways that happens; history.pushState announces nothing,
     * and in the extension's isolated world the page's History object is not
     * ours to patch — so a slow poll catches the rest instead of pretending.
     */
    let hereUrl = location.pathname + normalizeFragment(location.hash);
    function watchLocation(onChange) {
      const check = () => {
        const now = location.pathname + normalizeFragment(location.hash);
        if (now === hereUrl) return;
        hereUrl = now;
        onChange();
      };
      window.addEventListener('hashchange', check);
      window.addEventListener('popstate', check);
      setInterval(check, 400);
    }

    /*
     * Point at one anchored element, because the panel is talking about it.
     *
     * The same outline pin mode draws under the cursor, on purpose: a reviewer
     * has already learnt what that ring means, and a second highlight vocabulary
     * would be one more thing to learn for the same fact. `null` puts it back.
     */
    let highlighted = null;
    function setHighlight(id) {
      highlighted?.classList.remove('wd-hover');
      highlighted = id ? document.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(id)}"]`) : null;
      highlighted?.classList.add('wd-hover');
    }

    // --- framed mode: context from the viewer -----------------------------------
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      // A step in the panel naming an anchor: show which element it means.
      if (msg.type === 'walkdown:highlight') return setHighlight(msg.element ?? null);
      if (msg.type === 'walkdown:context') {
        ctx = {
          ...ctx,
          screen: msg.screen ?? ctx.screen,
          surface: msg.surface ?? ctx.surface,
          viewport: msg.viewport ?? ctx.viewport,
          pins: msg.pins ?? [],
        };
        if (typeof msg.pinMode === 'boolean') setPinMode(msg.pinMode);
        renderPins();
      }
    });

    /*
     * Two contexts, and pin mode has an owner in both. Framed, the embed reports
     * what it is looking at and the panel outside drives it. Top level, the panel
     * is in this same document and owns the control outright.
     *
     * There was a third: an embed with no panel anywhere carried a floating badge
     * of its own. It went when the only page that could reach it turned out to be
     * one nobody opens (n-0058) - and it had been leaking onto panelled pages
     * besides, which is two controls for a thing that must have exactly one.
     */
    if (framed) {
      const announce = () =>
        window.parent.postMessage(
          { type: 'walkdown:ready', anchors: $anchors().map(anchorId), href: location.href },
          '*',
        );
      announce();
      // Again once the document is parsed, so the anchor list is the whole one
      // rather than however much had been seen when this script ran.
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce);
      /*
       * The panel cannot read this frame's URL across origins, so a navigation
       * inside the application is only visible to it if the application says so.
       * Same three ways a URL changes, same slow poll for the one that announces
       * nothing.
       */
      watchLocation(announce);
    } else {
      // After the document is parsed: the pins need the anchored elements to
      // position against, and blueprintId() needs to be able to see a sibling
      // walkdown tag further down the page.
      /*
       * The blueprint is fetched once and kept, because the answer it feeds —
       * which screen is this? — has to be recomputed every time the URL changes,
       * and re-fetching a blueprint on every drawer open would be absurd.
       */
      let blueprint = null;
      const resolve = () => {
        if (!blueprint) return;
        const hit = matchScreen(blueprint.storyboard ?? [], location);
        // Off the storyboard: drop the old screen rather than keep stamping pins
        // with the last screen that did match, which would file them against a
        // page nobody is looking at.
        ctx.screen = hit?.screen?.id ?? null;
        ctx.surface = hit?.surface ?? null;
        ctx.pins = !hit
          ? []
          : blueprint.threads
              .filter((t) => t.anchor?.screen === hit.screen.id && !TERMINAL.includes(t.status))
              .map((t) => ({
                id: t.id,
                kind: t.kind,
                status: t.status,
                element: t.anchor?.element,
                position: t.anchor?.position,
                surface: t.anchor?.surface,
                viewport: t.anchor?.viewport,
                // Who wrote the note and when: the opening message is a message, and a
                // message without an author reads as nobody having said it.
                offset: t.anchor?.offset,
                rule: t.anchor?.rule ?? null,
                screen: t.anchor?.screen ?? null,
                author: t.author,
                // How the opening message arrived rides with its author: a note an
                // agent typed under a person's name must not read as the person's
                // own words while the reply under it says `via agent` (n-0152).
                via: t.via ?? null,
                created: t.created,
                body: t.body,
                replies: t.replies ?? [],
              }));
        renderPins();
      };
      const start = () =>
        fetch(api('/api/blueprint'))
          .then((r) => r.json())
          .then((data) => {
            blueprint = data;
            identity = data.identity ?? null;
            resolve();
          })
          .catch(() => {}); // server not running — embed stays dormant
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
      watchLocation(resolve);
    }

    window.addEventListener('resize', renderPins);
    window.addEventListener('scroll', renderPins, true);
  })();

})();
