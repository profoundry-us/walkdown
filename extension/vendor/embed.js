/* walkdown embed — injected into prototypes and dev/staging builds.
 * Framed (inside the viewer): talks postMessage to the parent, which owns
 * screen context and persists pins. Standalone: posts straight to the local
 * walkdown server (its own origin), which resolves the screen from the URL.
 * Never ships to production. */
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
  const ANCHOR_ATTR = cfg.anchorAttribute ??
    (SUBSTITUTED.startsWith('__ANCHOR') ? 'data-testid' : SUBSTITUTED);
  const SERVER = cfg.server ?? new URL(document.currentScript?.src ?? 'http://localhost:4700').origin;
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
  const blueprintId = () => ownBp ||
    document.querySelector('script[src*="4700"][data-bp], script[data-walkdown][data-bp]')?.dataset.bp || '';
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
    ctx.viewport ?? { name: window.innerWidth < 768 ? 'mobile' : 'desktop', width: window.innerWidth };
  let overlay = null;

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
  root.style.cssText = 'position:absolute; top:0; left:0; width:0; height:0;';
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
      if (document.querySelector('[data-walkdown-property-registrations]')) return;
      const props = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g);
      if (!props) return;
      const doc = document.createElement('style');
      doc.setAttribute('data-walkdown-property-registrations', '');
      doc.textContent = props.join('');
      document.head.appendChild(doc);
    })
    .catch(() => { /* unstyled beats absent; pinning still works */ });

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
  document.head.appendChild(style);

  /* One surface for both popovers: the panel's card, at the size of a note. */
  const FORM = `wd-form pointer-events-auto absolute z-[99999] w-64 rounded-box border
    border-primary/45 bg-base-100 p-3 text-[13px] text-base-content shadow-xl`;

  // --- pins -------------------------------------------------------------------
  function renderPins() {
    root.querySelectorAll('.wd-pin').forEach((p) => p.remove());
    for (const pin of ctx.pins) {
      const el = pin.element && document.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(pin.element)}"]`);
      // An anchored pin tracks its element; a positioned one keeps its spot.
      let left, top;
      if (el) {
        const rect = el.getBoundingClientRect();
        left = window.scrollX + rect.right - 6;
        top = window.scrollY + rect.top - 6;
      } else if (pin.position) {
        // A positioned pin belongs to the surface it was placed on — the same
        // coordinates would mean something else in the other surface.
        if (pin.surface && ctx.surface && pin.surface !== ctx.surface) continue;
        left = pin.position.x - 9;
        top = pin.position.y - 9;
      } else continue;
      const dot = document.createElement('div');
      // Round = anchored to an element, square = placed at a spot. A pin that
      // is no longer open reads as settled rather than outstanding.
      const settled = pin.status !== 'open';
      dot.className = `wd-pin pointer-events-auto absolute z-[99998] grid size-[18px] cursor-pointer
        place-items-center text-[11px] font-bold shadow ${el ? 'rounded-full' : 'rounded-[3px]'}
        ${settled ? 'bg-success text-success-content' : 'bg-warning text-warning-content'}`;
      dot.textContent = pin.kind === 'question' ? '?' : '!';
      dot.title = `${pin.id} (${pin.status}): ${pin.body ?? ''}`;
      dot.style.left = `${left}px`;
      dot.style.top = `${top}px`;
      dot.onclick = (e) => {
        e.stopPropagation();
        if (framed) window.parent.postMessage({ type: 'walkdown:open-thread', id: pin.id }, '*');
        else openThreadPopover(pin, dot);
      };
      root.appendChild(dot);
    }
  }

  // --- standalone thread popover: read + reply (lifecycle actions live in the
  // viewer and CLI, where transitions are validated with an actor) -------------
  const STATUS_CHIP = {
    open: 'badge-warning', answered: 'badge-warning', addressed: 'badge-info',
    verified: 'badge-success', incorporated: 'badge-success', waived: 'badge-ghost',
  };

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
    overlay.style.left = dot.style.left;
    overlay.style.top = `${parseFloat(dot.style.top) + 24}px`;
    overlay.innerHTML = `
      <div class="flex items-center gap-1.5">
        <b class="font-mono text-[11.5px]">${pin.id}</b>
        <span class="badge badge-xs ${STATUS_CHIP[pin.status] ?? 'badge-ghost'}">${pin.status}</span>
        <span class="text-[11px] opacity-40">${pin.kind}</span>
        <button class="btn btn-xs btn-ghost wd-cancel ml-auto">✕</button>
      </div>
      <div class="wd-stream mt-1 max-h-64 overflow-y-auto">${MSG.stream(pin, { pending })}</div>
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
    overlay.querySelector('.wd-cancel').onclick = () => overlay.remove();
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
    const at = el
      ? (() => { const r = el.getBoundingClientRect();
          return { x: window.scrollX + r.left, y: window.scrollY + r.bottom + 8 }; })()
      : { x: point.x, y: point.y + 8 };
    overlay = document.createElement('div');
    overlay.className = FORM;
    overlay.style.left = `${Math.min(at.x, window.scrollX + window.innerWidth - 290)}px`;
    overlay.style.top = `${at.y}px`;
    overlay.innerHTML = `
      <b class="font-mono text-[11.5px]">${el ? anchorId(el) : 'unanchored spot'}</b>
      ${el ? '' : '<div class="text-[11px] opacity-50">no anchored element here — pinned by position</div>'}
      <textarea class="textarea textarea-sm mt-2 h-16 w-full" placeholder="What should change here?"></textarea>
      <label class="mt-1 flex items-center gap-2 text-[12px]">
        <input type="checkbox" class="checkbox checkbox-xs wd-q"> question (not a note)</label>
      <div class="mt-2 flex gap-2">
        <button class="btn btn-xs btn-primary wd-primary">Pin it</button>
        <button class="btn btn-xs btn-ghost wd-cancel">Cancel</button>
      </div>`;
    root.appendChild(overlay);
    overlay.querySelector('textarea').focus();
    overlay.querySelector('.wd-cancel').onclick = () => overlay.remove();
    overlay.querySelector('.wd-primary').onclick = () => {
      const body = overlay.querySelector('textarea').value.trim();
      const kind = overlay.querySelector('.wd-q').checked ? 'question' : 'note';
      if (!body) return;
      submitPin({
        ...(el ? { element: anchorId(el) } : { position: point }),
        body, kind, surface: ctx.surface, viewport: currentViewport(),
      });
      overlay.remove();
    };
  }

  function submitPin(pin) {
    if (framed) {
      window.parent.postMessage({ type: 'walkdown:new-pin', ...pin }, '*');
    } else {
      fetch(api('/api/threads'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...pin,
          anchor: { ...(pin.element && { element: pin.element }), ...(pin.position && { position: pin.position }),
            ...(pin.surface && { surface: pin.surface }), ...(pin.viewport && { viewport: pin.viewport }) },
          url: location.href }),
      })
        .then((r) => r.json())
        .then((data) => {
          // Carry back what the server stamped, so a pin opened straight after
          // being dropped reads as a message like any other.
          ctx.pins.push({ ...pin, id: data.id, status: 'open',
            author: data.thread?.author, created: data.thread?.created });
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
      // walkdown's own chrome is never a pin target: the badge has to be able
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
    true
  );

  // Escape is the way out of any mode: it closes the open form first, then
  // leaves pin mode. Without it the only exit was the badge, which pin mode
  // itself was swallowing.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !ctx.pinMode) return;
    if (overlay) { overlay.remove(); overlay = null; return; }
    setPinMode(false);
    if (framed) window.parent.postMessage({ type: 'walkdown:pin-mode', on: false }, '*');
  });

  const pinWatchers = new Set();
  function setPinMode(on) {
    ctx.pinMode = on;
    badge?.classList.toggle('btn-warning', on);
    badge?.classList.toggle('btn-neutral', !on);
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
   * Escape and the badge would then have to remember to update.
   */
  window.walkdownEmbed = {
    isPinMode: () => ctx.pinMode,
    setPinMode,
    watchPinMode(fn) { pinWatchers.add(fn); return () => pinWatchers.delete(fn); },
    /*
     * Once the panel is up it owns the pin-mode control, and the badge goes.
     * It was a second control saying the same thing as the one in the bar —
     * another place to look, and another thing to keep in step. The crosshair
     * cursor already says pin mode is on. Without a panel the badge stays put,
     * because then it is the only way in.
     */
    dismissBadge() {
      badge?.remove();
      badge = null;
    },
  };

  /*
   * Screen identity, shared verbatim with the panel and the server so a pin
   * cannot land on one screen here and a different one there.
   */
  // --- screen-match:start --- (generated by tools/sync-shared.mjs — edit lib/screen-match.js) ---
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
    const h = s.indexOf('#');           // the fragment starts at the FIRST #,
    const fragment = h < 0 ? '' : s.slice(h);   // so "#/order?id=1" stays whole
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
  // --- screen-match:end ---

  // --- message-stream:start --- (generated by tools/sync-shared.mjs — edit lib/message-stream.js) ---
  const MSG = {
    /** Same escaping rules as the rest of the chrome; bodies are user text. */
    esc: (s) =>
      String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),

    /** Up to two letters, from a name or an email-ish handle. */
    initials(name) {
      const parts = String(name ?? '?').trim().split(/[\s._-]+/).filter(Boolean);
      if (!parts.length) return '?';
      return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
    },

    /**
     * A stable colour per name. Recognising who is speaking should not require
     * reading — and the agent is always the same green, so its voice is one
     * thing you learn once.
     */
    tint(name) {
      const who = String(name ?? '').trim().toLowerCase();
      if (who === 'agent') return 'oklch(52% 0.09 165)';
      let h = 0;
      for (const ch of who) h = (h * 31 + ch.charCodeAt(0)) % 360;
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
        { author: thread?.author, created: thread?.created, body: thread?.body },
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
        .replace(/\b([nq]-\d{4})\b/g, '<button class="wd-ref link link-hover" data-thread-ref="$1">$1</button>')
        .replace(/\b([a-z][\w-]*(?:\.[a-z][\w-]*){2,})\b/gi, (m) =>
          known.has(m) ? `<button class="wd-ref link link-hover font-mono" data-rule-ref="${m}">${m}</button>` : m);
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
    stream(thread, { seenAt = null, rules = [], pending = [] } = {}) {
      const all = [...this.messages(thread), ...pending];
      let lastDay = '', prev = null, marked = false;
      const GROUP_MS = 5 * 60 * 1000;
      return all.map((m) => {
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
        const cont = prev && prev.author === m.author &&
          Math.abs(Date.parse(m.created ?? '') - Date.parse(prev.created ?? '')) < GROUP_MS;
        prev = m;
        const who = m.author || 'someone';
        out.push(`<div class="wd-msg${cont ? ' cont' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}">
          <div class="wd-ava" style="background:${this.tint(who)}">${this.esc(this.initials(who))}</div>
          <div class="wd-col">
            <div class="wd-head">${cont ? '' : `<span class="wd-who">${this.esc(who)}</span>`}<span
              class="wd-at" title="${this.esc(this.stamp(m.created))}">${
                m.failed ? 'not sent' : m.pending ? 'sending…' : this.esc(this.ago(m.created))}</span></div>
            <div class="wd-text">${this.body(m.body, { rules })}</div>
          </div>
        </div>`);
        return out.join('');
      }).join('');
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
      return `<div class="${cls}" style="background:${this.tint(who)}" title="${
        this.esc(who)}">${this.esc(this.initials(who))}</div>`;
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
    repliesLine(thread) {
      const replies = thread?.replies ?? [];
      const faces = this.participants(thread).slice(0, 3)
        .map((who) => this.avatar(who, 'wd-face')).join('');
      if (!replies.length)
        return `<button class="wd-replies empty" data-open-thread="${this.esc(thread?.id)}">Reply</button>`;
      return `<button class="wd-replies" data-open-thread="${this.esc(thread?.id)}">
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
      .wd-head { display: flex; align-items: baseline; gap: .35rem; }
      .wd-who { font-weight: 600; font-size: 12px; }
      .wd-at { font-size: 10px; opacity: .45; }
      .wd-msg.cont .wd-at { visibility: hidden; }
      .wd-msg.cont:hover .wd-at { visibility: visible; }
      .wd-text { font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
      .wd-msg.pending { opacity: .55; }
      .wd-msg.failed .wd-at { opacity: 1; color: oklch(72% 0.17 22); }
      .wd-ref { font-size: inherit; }
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
  // --- message-stream:end ---

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

  // --- framed mode: context from the viewer -----------------------------------
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'walkdown:context') {
      ctx = { ...ctx, screen: msg.screen ?? ctx.screen, surface: msg.surface ?? ctx.surface,
        viewport: msg.viewport ?? ctx.viewport, pins: msg.pins ?? [] };
      if (typeof msg.pinMode === 'boolean') setPinMode(msg.pinMode);
      renderPins();
    }
  });

  // --- standalone mode: floating toggle + pins from server --------------------
  let badge = null;
  if (framed) {
    const announce = () => window.parent.postMessage(
      { type: 'walkdown:ready', anchors: $anchors().map(anchorId), href: location.href },
      '*'
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
    badge = document.createElement('button');
    // --walkdown-dock is how wide the docked panel is, published by panel.js;
    // custom properties cross the shadow boundary, so the badge still gets out
    // from under a panel it cannot see.
    badge.className = 'wd-badge btn btn-xs btn-neutral pointer-events-auto fixed bottom-2.5 z-[99999]';
    badge.style.cssText = 'right: calc(10px + var(--walkdown-dock, 0px)); transition: right .22s ease;';
    badge.textContent = 'W pin';
    badge.title = 'walkdown: toggle pin mode';
    badge.onclick = () => setPinMode(!ctx.pinMode);
    root.appendChild(badge);
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
      ctx.pins = !hit ? [] : blueprint.threads.filter(
        (t) => t.anchor?.screen === hit.screen.id && !['incorporated', 'verified', 'waived'].includes(t.status)
      ).map((t) => ({ id: t.id, kind: t.kind, status: t.status, element: t.anchor?.element,
        position: t.anchor?.position, surface: t.anchor?.surface, viewport: t.anchor?.viewport,
        // Who wrote the note and when: the opening message is a message, and a
        // message without an author reads as nobody having said it.
        author: t.author, created: t.created, body: t.body, replies: t.replies ?? [] }));
      renderPins();
    };
    const start = () => fetch(api('/api/blueprint'))
      .then((r) => r.json())
      .then((data) => { blueprint = data; resolve(); })
      .catch(() => {}); // server not running — embed stays dormant
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    watchLocation(resolve);
  }

  window.addEventListener('resize', renderPins);
  window.addEventListener('scroll', renderPins, true);
})();
