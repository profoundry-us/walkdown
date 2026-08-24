/* walkdown panel — the reviewer's chrome, docked beside the REAL app.
 *
 * Proof of concept. Include it in a dev build next to the embed:
 *   <script src="http://localhost:4700/panel.js" data-bp="example/blueprint"></script>
 *
 * Unlike the viewer, nothing here frames the app: the page runs in its own
 * tab at its own viewport, and the panel docks alongside it. The prototype
 * has no permanent seat — it ghosts over the page on demand.
 *
 * Everything the panel draws lives in a SHADOW ROOT. That is not decoration:
 * this script is injected into somebody else's running application, and
 * Tailwind's preflight would otherwise restyle their buttons and headings
 * while their stylesheet restyled ours. Inside a shadow root neither happens.
 * The few elements that must live in the host document — the shell itself,
 * the reopen tab, the ghost stage — carry inline styles, because a host page
 * rule beats anything we could write about them from in here.
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
  if (document.documentElement.dataset.walkdownPanel) return;
  document.documentElement.dataset.walkdownPanel = '1';
  window.__walkdownPanel = true;

  // See the note in embed.js: served as a <script> tag, or handed the same
  // answers by the extension's bootstrap on window.__walkdownConfig.
  const script = document.currentScript;
  const cfg = window.__walkdownConfig ?? {};
  let SERVER = cfg.server ?? new URL(script?.src ?? 'http://localhost:4700').origin;
  let BP = cfg.bp ?? script?.dataset.bp ?? '';
  /*
   * Where the choice of blueprint is remembered. The extension hands us
   * chrome.storage — its own, per-profile, and untouched by a site clearing
   * its data. A page that loaded us from a script tag has already said which
   * blueprint it is, so the localStorage fallback is for a case that in
   * practice never arises.
   */
  const store = cfg.store ?? {
    get: async (k) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } },
    set: async (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const CHOICE = `walkdown:blueprint:${location.origin}`;
  // The extension ships the stylesheet itself; served, it comes off the server.
  const STYLESHEET = cfg.stylesheet ?? SERVER + '/walkdown.css';
  /*
   * The blueprint rides along as a query parameter — and it has to go BEFORE
   * any fragment, or the fragment swallows it: "#invite-batch?bp=..." is one
   * fragment named that, not a query, so the server never sees the blueprint
   * and the screen never sees its own fragment.
   */
  const api = (path) => {
    const h = path.indexOf('#');
    const head = h < 0 ? path : path.slice(0, h);
    const frag = h < 0 ? '' : path.slice(h);
    const q = BP ? (head.includes('?') ? '&' : '?') + 'bp=' + encodeURIComponent(BP) : '';
    return SERVER + head + q + frag;
  };

  const W = 384;    // the side panel
  const TOP = 44;   // the tool bar across the top
  const GAP = 12;   // how much desk shows around the wrapped page
  // Nothing separates the bar from the page any more, so the bar's own bottom
  // padding does that job — a second 12px gap on top of it read as a gutter.
  const HEAD = TOP;
  let data = null, view = 'list', selected = null, session = null, ghost = null, ghostOpacity = 0.5;
  let protoShare = null;   // 0 = all app, 1 = all prototype; null = follow the page
  let pickedScreen = cfg.screen ?? script?.dataset.screen ?? null;
  let openThread = null;   // the thread expanded in the detail pane, by id
  /*
   * A screen the ghost is pinned to for a moment — viewing a sketch from a
   * thread, say. Kept apart from pickedScreen on purpose: pickedScreen answers
   * "which screen is this page?", and a passing look at another screen's
   * artwork must not rewrite that answer, or the panel spends the rest of the
   * session describing a page you are not on.
   */
  let ghostOverride = null;
  /*
   * Which of the three things the panel is doing: finding a server, choosing a
   * blueprint from the ones it found, or reviewing. The first two are not error
   * states — a fresh install genuinely does not know either answer yet.
   */
  let phase = 'loading';   // loading | connect | choose | ready
  let projects = [];
  let servedRoot = null;   // the folder the server reports it is serving
  let listTab = 'rules';   // rules | screens — the two things the side lists
  let threadNote = '';     // what the reply box says, kept across re-renders
  let lastView = 'list';
  let ghostWidth = 0;   // 0 = fill the stage; otherwise a fixed CSS width

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /*
   * Phosphor, inlined. The panel ships as one file down two delivery paths, so
   * it cannot fetch an icon font or a sprite sheet; tools/sync-phosphor.mjs
   * copies the markup for the names we use out of @phosphor-icons/core.
   */
  // --- phosphor:start (generated by tools/sync-phosphor.mjs) ---
  const PHOSPHOR = {
    'map-pin': '<path d="M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,206c-16.53-13-72-60.75-72-118a72,72,0,0,1,144,0C200,161.23,144.53,209,128,222Z"/>',
  };
  // --- phosphor:end ---
  const icon = (name, cls = 'size-4') =>
    `<svg class="${cls}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${PHOSPHOR[name] ?? ''}</svg>`;

  // ---- chrome ---------------------------------------------------------------
  const shell = document.createElement('div');
  // The embed reads this to know the panel is walkdown's own chrome and not a
  // place to drop a pin. A click inside the shadow root retargets to this host
  // element, so marking the shell covers everything the panel draws.
  shell.dataset.walkdownChrome = '';
  // One shadow root over the whole viewport now that chrome runs along the top
  // as well as down the side. It is transparent and click-through; only the bar
  // and the panel take pointer events, so the page under it stays live.
  /*
   * z-index is not enough, and this is the one thing a docked tool cannot do
   * without: an application's own <dialog showModal()> (or any popover) is
   * promoted to the browser's TOP LAYER, which is painted above every
   * z-index there is — so the app's modal, and the backdrop that dims the
   * whole viewport with it, would cover walkdown's chrome. The only way to be
   * above the top layer is to be in it, so the shell is a manual popover.
   *
   * The UA stylesheet gives popovers a size, border, padding and background of
   * their own; every one of those is overridden back to the transparent
   * full-viewport sheet this has always been.
   */
  shell.style.cssText = `position:fixed; inset:0; z-index:2147483000; pointer-events:none;
    width:100%; height:100%; max-width:none; max-height:none; margin:0; border:0; padding:0;
    background:transparent; overflow:visible;`;
  const sr = shell.attachShadow({ mode: 'open' });
  document.body.appendChild(shell);

  /*
   * Order in the top layer is the order things were promoted, so the app
   * opening a modal after us puts it back on top. Re-promoting is how you get
   * the top of the stack again, and the two ways in are both observable: a
   * <dialog> gets an `open` attribute, and a popover fires `toggle` (which
   * does not bubble, hence the capture phase).
   */
  const promote = (el) => {
    if (!el?.isConnected || typeof el.showPopover !== 'function') return;
    if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
    try { el.hidePopover(); } catch { /* not showing yet */ }
    try { el.showPopover(); } catch { /* refused: the z-index still applies */ }
  };
  /*
   * The ghost goes up first and the shell after it, because within the top
   * layer the last one promoted is the one on top — and the panel must stay
   * above the design it is ghosting.
   */
  const raise = () => { promote(ghost); promote(shell); };
  if (typeof shell.showPopover === 'function') {
    raise();
    document.addEventListener('toggle', (e) => { if (e.target !== shell) raise(); }, true);
    new MutationObserver((records) => {
      // Only a dialog that just became open can have jumped over us; anything
      // else in the page is below the top layer and cannot.
      if (records.some((r) => r.target !== shell && r.target.matches?.('dialog[open]'))) raise();
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }

  // A transparent frame over the viewport. It must NOT carry data-theme:
  // daisyUI paints background-color on every [data-theme] element, so a
  // full-viewport carrier would cover the page it is supposed to be framing.
  // The theme goes on the two opaque surfaces instead, which is where the
  // background belongs anyway.
  const host = document.createElement('div');
  host.className = 'h-full w-full text-sm';
  sr.appendChild(host);

  // The two pieces of chrome are built once and filled by render(): the docking
  // transforms live on them, and a rebuild must never throw the panel back on
  // screen after you have put it away.
  // The bar carries no surface of its own — background:transparent overrides
  // the one daisyUI paints on every [data-theme] element — so the drafting
  // grid runs unbroken behind the controls and under the panel beside them.
  const bar = document.createElement('header');
  bar.dataset.theme = 'blueprint';   // walkdown's own skin — see styles/walkdown.css
  bar.style.cssText = `position:absolute; top:0; left:0; right:0; height:${TOP}px;
    pointer-events:auto; transition:transform .2s ease; background:transparent;`;
  bar.className = 'flex items-center gap-2 px-3 text-base-content';

  // The panel is a card lying on the same desk as the page, inset by the same
  // margin — two sheets side by side rather than a sheet and a wall.
  const side = document.createElement('aside');
  side.dataset.theme = 'blueprint';
  side.style.cssText = `position:absolute; top:${HEAD}px; right:${GAP}px; bottom:${GAP}px;
    width:${W}px; pointer-events:auto; transition:transform .22s ease; border-radius:10px;
    box-shadow:0 1px 2px rgba(0,0,0,.28), 0 12px 32px rgba(0,0,0,.34);`;
  side.className = 'flex flex-col overflow-hidden border border-primary/45 bg-base-100 text-base-content';
  host.append(bar, side);

  /*
   * The stylesheet, split in two on purpose:
   *
   *   – the whole thing goes into the shadow root, where it styles us alone;
   *   – its @property rules are ALSO copied into the host document, because
   *     the CSS Properties API only registers @property at document level.
   *     Unregistered, Tailwind's --tw-border-style and friends have no initial
   *     value and borders, transforms and rings silently stop working. The
   *     copy declares custom-property types and paints nothing, so it is the
   *     one thing we add to the host page.
   */
  fetch(STYLESHEET)
    .then((r) => r.text())
    .then((css) => {
      const sheet = document.createElement('style');
      sheet.textContent = css;
      sr.insertBefore(sheet, host);
      // The desk was painted from fallbacks before the theme existed; now that
      // the tokens resolve, paint it in walkdown's actual colours.
      if (docked) paintDesk(true);
      const props = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g);
      if (props) {
        const doc = document.createElement('style');
        doc.setAttribute('data-walkdown-property-registrations', '');
        doc.textContent = props.join('');
        document.head.appendChild(doc);
      }
    })
    .catch(() => { /* unstyled beats absent; the panel still works */ });

  const tab = document.createElement('button');
  tab.dataset.walkdownChrome = '';
  tab.textContent = 'WALKDOWN';
  tab.style.cssText = `position:fixed; right:0; top:50%; z-index:2147483000; transform:translateY(-50%);
    background:#16181d; color:#fff; border:0; border-radius:8px 0 0 8px; padding:11px 7px; cursor:pointer;
    font:600 11px/1 -apple-system, sans-serif; writing-mode:vertical-rl; letter-spacing:.08em; display:none;`;
  tab.onclick = () => setDocked(true);
  document.body.appendChild(tab);

  /*
   * Docking wraps the page rather than covering it: the document is inset to
   * leave room for the chrome and a margin of desk all round, and the page
   * itself becomes a sheet lying on that desk — rounded, shadowed, clearly a
   * separate thing from the tools around it.
   *
   * The mechanics rest on one CSS rule. The canvas takes its background from
   * <html>, and only falls through to <body> when <html> has none — so giving
   * <html> the desk stops <body>'s background propagating, and <body> paints
   * its own box for the first time. That box is the sheet.
   */
  const priorRoot = document.documentElement.getAttribute('style');
  const priorBody = document.body.getAttribute('style');

  function paintDesk(on) {
    const root = document.documentElement, page = document.body;
    if (!on) {
      priorRoot === null ? root.removeAttribute('style') : root.setAttribute('style', priorRoot);
      priorBody === null ? page.removeAttribute('style') : page.setAttribute('style', priorBody);
      return;
    }
    const cs = getComputedStyle(side);
    const token = (n, fallback) => cs.getPropertyValue(n).trim() || fallback;
    const desk = token('--color-base-200', '#12283f');
    const ink = token('--color-base-content', '#dbe7f3');
    root.style.margin = `${HEAD}px ${W + GAP * 2}px ${GAP}px ${GAP}px`;
    root.style.transition = 'margin .22s ease';
    root.style.background = desk;
    // Drafting paper, ruled faintly enough to read as texture rather than content.
    root.style.backgroundImage =
      `linear-gradient(color-mix(in oklch, ${ink} 8%, transparent) 1px, transparent 1px),` +
      `linear-gradient(90deg, color-mix(in oklch, ${ink} 8%, transparent) 1px, transparent 1px)`;
    root.style.backgroundSize = '24px 24px';
    root.style.backgroundAttachment = 'fixed';
    page.style.borderRadius = '10px';
    page.style.boxShadow = '0 1px 2px rgba(0,0,0,.28), 0 12px 32px rgba(0,0,0,.34)';
    // Exactly the space the page's own margins leave it, so a short page ends
    // level with the panel beside it instead of stopping 12px early.
    page.style.minHeight = `calc(100vh - ${HEAD + GAP}px)`;
    // A page with no background of its own would show the desk straight
    // through and never read as a sheet.
    const own = getComputedStyle(page).backgroundColor;
    if (own === 'rgba(0, 0, 0, 0)' || own === 'transparent') page.style.background = '#fff';
  }

  let docked = false;

  function setDocked(on) {
    docked = on;
    bar.style.transform = on ? 'none' : `translateY(-${TOP}px)`;
    side.style.transform = on ? 'none' : `translateX(calc(100% + ${GAP}px))`;
    tab.style.display = on ? 'none' : 'block';
    paintDesk(on);
    // How much of the right edge the panel is occupying. The embed's badge
    // reads this so it comes to rest beside the panel instead of under it.
    document.documentElement.style.setProperty('--walkdown-dock', on ? `${W + GAP * 2}px` : '0px');
    if (!on) setGhost(false);
  }

  // ---- data -----------------------------------------------------------------
  const needsYou = (rule) =>
    (data?.attention ?? []).some((i) => i.who === 'human' && !i.thread && i.rule === rule);
  const threadsFor = (rule) => (data?.threads ?? []).filter((t) => t.anchor?.rule === rule &&
    !['incorporated', 'verified', 'waived'].includes(t.status));

  /*
   * Screen identity, shared verbatim with the embed and the server so a pin
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

  /**
   * Which of the two surfaces this page already is. Without it the control is
   * asymmetric: on a prototype page, "show me the prototype" would ghost the
   * prototype over itself and do nothing visible.
   */
  function pageSurface() {
    const sc = currentScreen();
    if (!sc) return 'app';
    return matchScreen([sc], location)?.surface ?? 'app';
  }

  /** Which storyboard screen this page is, by URL — same trick the embed uses. */
  function currentScreen() {
    const screens = data?.storyboard ?? [];
    if (pickedScreen) return screens.find((s) => s.id === pickedScreen) ?? null;
    return matchScreen(screens, location)?.screen ?? null;
  }

  /*
   * The URL can change without the page reloading, and a modal or a drawer or
   * an SPA route is its own screen (docs/06 §2) — so the panel has to notice.
   *
   * Two of the three ways it changes announce themselves: hashchange and
   * popstate. history.pushState announces nothing, and the extension runs in an
   * isolated world where patching the page's own History object is not
   * possible — its History is not ours. So the events keep the ordinary cases
   * instant, and a slow poll catches the rest rather than pretending pushState
   * is covered.
   */
  let hereUrl = location.pathname + normalizeFragment(location.hash);
  function watchLocation() {
    const check = () => {
      const now = location.pathname + normalizeFragment(location.hash);
      if (now === hereUrl) return;
      hereUrl = now;
      /*
       * Both overrides answered a question about the page you were on — "this
       * page is that screen", "show me that screen's art". Carrying them across
       * a navigation would have the panel describing somewhere you have left.
       */
      pickedScreen = null;
      ghostOverride = null;
      if (phase !== 'ready') return;
      if (protoShare === null) setGhost(false);
      else setFade(protoShare);
      render();
    };
    addEventListener('hashchange', check);
    addEventListener('popstate', check);
    setInterval(check, 400);
  }

  async function load() {
    const res = await fetch(api('/api/blueprint'));
    data = await res.json();
    // Re-resolve against the reloaded data: the old object is a stale copy, so
    // holding it would show yesterday's verdict and threads.
    if (selected) selected = data.rows.find((r) => r.rule === selected.rule) ?? null;
    render();
  }

  const screenById = (id) => (data?.storyboard ?? []).find((s) => s.id === id) ?? null;

  /**
   * What the ghost should draw for a screen: the design if there is one, and
   * otherwise a proposal sketch — flagged, because a sketch that reads as the
   * design is exactly the confusion the ownership rules exist to prevent.
   */
  function ghostSource(screen) {
    if (pageSurface() === 'prototype') {
      // Standing on the design, the other surface is the running app — and it
      // lives at its own origin, so the ghost takes an absolute URL.
      return screen?.app?.path && data.appBase
        ? { url: data.appBase + screen.app.path, proposed: false }
        : null;
    }
    if (screen?.prototype && data.hasPrototype) return { path: '/prototype' + screen.prototype, proposed: false };
    if (screen?.proposal) return { path: '/proposals' + screen.proposal, proposed: true };
    return null;
  }

  /** "3h ago" — provenance should cost a glance, not a date parse. */
  function ago(iso) {
    const then = Date.parse(iso ?? '');
    if (!Number.isFinite(then)) return '';
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  }

  /** Short verbs, and only the transitions this kind and status allow. */
  function threadActions(t) {
    if (t.kind === 'note') {
      if (t.status === 'open') return [['Addressed', 'addressed'], ['Waive', 'waived', true]];
      if (t.status === 'addressed') return [['\u2713 Verify', 'verified'], ['Reopen', 'open'], ['Waive', 'waived', true]];
    } else {
      if (t.status === 'open') return [['Answer', '__answer'], ['Waive', 'waived', true]];
      if (t.status === 'answered') return [['Incorporated', 'incorporated'], ['Reopen', 'open'], ['Waive', 'waived', true]];
    }
    return [];
  }

  const LBL = 'text-[10.5px] font-bold uppercase tracking-widest opacity-40';
  /** A rule id with its story prefix dropped — what the rail calls it. */
  const shortName = (row) =>
    row.rule.startsWith(row.story + '.') ? row.rule.slice(row.story.length + 1) : row.rule;

  // ---- render ---------------------------------------------------------------
  function render() {
    if (!data) return;
    // render() rebuilds the panel wholesale, which resets scroll. Clicking a
    // control near the bottom of a long thread would otherwise throw you back
    // to the top — so note where each pane was and put it back.
    const wasAt = [...host.querySelectorAll('.wdp-pane')].map((p) => p.scrollTop);
    const total = data.rows.length;
    const verified = data.rows.filter((r) => r.verdict === 'pass').length;
    const owed = data.rows.filter((r) => needsYou(r.rule)).length;
    renderBar();
    const tab = (id, label) =>
      `<button role="tab" class="tab${listTab === id ? ' tab-active' : ''}" data-tab="${id}">${label}</button>`;
    side.innerHTML = `
      <div role="tablist" class="tabs tabs-box tabs-sm m-2 shrink-0">
        ${tab('blueprints', 'Blueprints')}${tab('rules', 'Rules')}${tab('screens', 'Screens')}
      </div>
      ${session ? `<div class="flex items-center gap-2 border-b border-base-300 bg-warning/10 px-3.5 py-2 text-xs">
        <span>Walkdown recording as</span>
        <input id="wdp-actor" class="input input-xs w-26" value="${esc(session.actor)}"
               title="Recorded as the author of these verdicts">
        <span>${Object.keys(session.verdicts).length} judged</span>
        <button class="btn btn-xs btn-warning ml-auto" id="wdp-finish">Finish</button>
      </div>` : ''}
      <!-- Two panes on one track — the slide between list and detail. The slot
           clips it, or the offscreen pane paints over the app instead of
           sliding within the panel. flex-[0_0_200%], not flex-1: inside a row
           flex slot, flex-1 means basis 0 and collapses both panes to half. -->
      <div class="flex min-h-0 flex-1 overflow-hidden">
        <div class="wdp-track flex min-h-0 flex-[0_0_200%] transition-transform duration-300 ease-out">
          <div class="wdp-pane flex min-h-0 w-1/2 flex-[0_0_50%] flex-col overflow-y-auto">${
            listTab === 'screens' ? screensPane()
            : listTab === 'blueprints' ? blueprintsPane()
            : listPane()}</div>
          <div class="wdp-pane flex min-h-0 w-1/2 flex-[0_0_50%] flex-col overflow-y-auto">${detailPane()}</div>
        </div>
      </div>
      ${listTab === 'rules' ? `<div class="flex shrink-0 items-center gap-2 border-t border-base-300 px-3.5 py-2 text-xs opacity-70">
        <span><b>${verified} of ${total}</b> rules verified</span>
        ${owed ? `<span class="badge badge-sm badge-warning badge-outline ml-auto">${owed} need you</span>` : ''}
      </div>` : ''}`;

    const track = host.querySelector('.wdp-track');
    if (track) {
      // A rebuilt element has no state to transition from, so paint where we
      // were, flush that, then move. A rAF is not enough — the browser
      // coalesces both states into one recalc and the slide is skipped.
      track.style.transition = 'none';
      track.classList.toggle('-translate-x-1/2', lastView === 'detail');
      void track.offsetWidth;
      track.style.transition = '';
      track.classList.toggle('-translate-x-1/2', view === 'detail');
      lastView = view;
    }
    host.querySelectorAll('.wdp-pane').forEach((p, i) => { p.scrollTop = wasAt[i] ?? 0; });
    host.querySelectorAll('[data-rule]').forEach((el) => {
      el.onclick = () => open(el.dataset.rule);
    });
    const back = host.querySelector('.wdp-back');
    if (back) back.onclick = () => { view = 'list'; render(); };
    host.querySelectorAll('[data-goto]').forEach((el) => {
      el.onclick = () => { selected = data.rows.find((r) => r.rule === el.dataset.goto) ?? selected; render(); };
    });
    const actorInput = host.querySelector('#wdp-actor');
    if (actorInput) actorInput.onchange = () => { session.actor = actorInput.value.trim(); };
    const finish = host.querySelector('#wdp-finish');
    if (finish) finish.onclick = finishWalkdown;
    side.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => { listTab = b.dataset.tab; render(); };
    });
    wireBlueprints(side);
    side.querySelectorAll('[data-screen]').forEach((b) => {
      b.onclick = () => {
        pickedScreen = b.dataset.screen || null;
        ghostOverride = null;
        if (ghost) { setGhost(false); setFade(ghostOpacity || 1); } else render();
      };
    });
    wireVerdict();
    wireThreads();
  }

  /*
   * The bar across the top: which project, which surface you are looking at,
   * and pin mode. These are the controls that are about the whole session
   * rather than about the rule in front of you, which is why they sit apart
   * from the panel.
   *
   * Prototype/App is the ghost at full strength — one idea, not two. There is
   * no Split here on purpose: the app is the actual page at its actual size,
   * and half of it would be a worse view of it than ghosting.
   */
  /*
   * The bar across the top: the surface you are looking at, and the two actions
   * that are about the whole session. Prototype and App are the ends of one
   * slider rather than two separate ideas — the slider IS the ghost, so
   * "compare them" and "show me the design" are one control, not three.
   */
  /*
   * A drag holds the slider element itself. Rebuilding the bar mid-drag
   * replaces the very input the pointer is on, and the drag dies on its first
   * move — which is the whole of the "the slider will not drag" bug. So while
   * a drag is live the bar is painted in place instead of rebuilt, and rebuilt
   * once when the drag ends.
   */
  let dragging = false;

  const PIN_MID = 'Slide fully to the prototype or the app first — half-faded, a pin has no surface to belong to';
  const PIN_UNREACHABLE = 'walkdown is not running inside this surface, so a pin here would land on the page underneath it';
  const pinHint = () => {
    const where = pinSurface();
    if (!where) return midFade() ? PIN_MID : PIN_UNREACHABLE;
    return `Click anything to attach a note — it lands on the ${where}`;
  };

  /**
   * Half-way through the fade you are looking at both surfaces at once, so a
   * pin cannot answer which one it is about. Rather than record a guess, the
   * control closes until you commit to an end.
   */
  const midFade = () => protoShare !== null && ghostOpacity > 0 && ghostOpacity < 1;

  /** The surface the ghost carries: always the one the page itself is not. */
  const ghostSurface = () => (pageSurface() === 'prototype' ? 'app' : 'prototype');

  /**
   * Which surface a pin would land on right now, or null if it has no honest
   * answer. Fully ghosted, you are looking at the OTHER surface, so that is
   * where a pin belongs — which means the ghost has to stop being scenery and
   * take the click. It can only do that if walkdown is running inside it,
   * which is what `ghostReady` records.
   */
  function pinSurface() {
    if (midFade()) return null;
    if (ghost && ghostOpacity === 1) return ghostReady ? ghostSurface() : null;
    return pageSurface();
  }

  /*
   * Set when the copy of walkdown inside the ghost announces itself. A
   * prototype carries the embed by contract (docs/06 §4); an app being ghosted
   * from a prototype page may not, and then the ghosted surface simply cannot
   * be pinned. Saying so is the point — the alternative is a pin that lands on
   * the page hidden underneath the one you are looking at.
   */
  let ghostReady = false;

  /** Repaint the bar's state without rebuilding it — see `dragging`. */
  function paintBar() {
    const share = protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
    bar.querySelectorAll('[data-surface]').forEach((b) => {
      const on = b.dataset.surface === 'prototype' ? share === 1 : share === 0;
      b.classList.toggle('btn-outline', !on);
    });
    const pin = bar.querySelector('#wdp-pin');
    if (!pin) return;
    const pinning = window.walkdownEmbed?.isPinMode() ?? false;
    pin.disabled = !pinSurface();
    pin.title = pinHint();
    pin.classList.toggle('btn-warning', pinning);
    pin.classList.toggle('btn-outline', !pinning);
    pin.classList.toggle('btn-primary', !pinning);
  }

  function renderBar() {
    if (dragging) return paintBar();
    if (phase !== 'ready') {
      bar.innerHTML = `<span class="font-bold tracking-tight">walk<span class="text-primary">down</span></span>`;
      return;
    }
    const canGhost = Boolean(ghostSource(screenById(ghostOverride) ?? currentScreen()));
    // Left is Prototype and right is App, matching the buttons on either side —
    // so the slider reads 100 at the App end and the value is inverted here.
    const share = protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
    const value = Math.round((1 - share) * 100);
    const pinning = window.walkdownEmbed?.isPinMode() ?? false;
    bar.innerHTML = `
      <span class="font-bold tracking-tight">walk<span class="text-primary">down</span></span>
      <span class="truncate text-[11.5px] opacity-50">${esc(data.project)}</span>

      <span class="absolute left-1/2 flex -translate-x-1/2 items-center gap-2"
        title="${canGhost ? 'Fade between the design and what shipped' : 'No design on file for this screen'}">
        <button class="btn btn-xs btn-primary${share === 1 ? '' : ' btn-outline'}" data-surface="prototype"
          ${canGhost || pageSurface() === 'prototype' ? '' : 'disabled'}>Prototype</button>
        <input type="range" min="0" max="100" value="${value}" id="wdp-fade"
          class="range range-xs range-primary w-28" ${canGhost ? '' : 'disabled'}
          aria-label="Fade between the design and the running app">
        <button class="btn btn-xs btn-primary${share === 0 ? '' : ' btn-outline'}" data-surface="app"
          ${canGhost || pageSurface() === 'app' ? '' : 'disabled'}>App</button>
      </span>

      <span class="ml-auto flex items-center gap-2">
        <button class="btn btn-xs gap-1 ${pinning ? 'btn-warning' : 'btn-outline btn-primary'}" id="wdp-pin"
          ${pinSurface() ? '' : 'disabled'}
          title="${esc(pinHint())}">${icon('map-pin', 'size-3.5')}Pin mode</button>
        <button class="btn btn-xs btn-primary" id="wdp-walk">${session ? 'Finish walkdown' : 'Start walkdown'}</button>
        <button class="btn btn-xs btn-ghost" id="wdp-undock" title="Put walkdown away">\u00d7</button>
      </span>`;

    bar.querySelector('#wdp-undock').onclick = () => setDocked(false);
    bar.querySelector('#wdp-pin').onclick = () =>
      window.walkdownEmbed?.setPinMode(!window.walkdownEmbed.isPinMode());
    bar.querySelector('#wdp-walk').onclick = () => (session ? finishWalkdown() : startWalkdown());
    bar.querySelectorAll('[data-surface]').forEach((b) => {
      b.onclick = () => setFade(b.dataset.surface === 'prototype' ? 1 : 0);
    });
    const fade = bar.querySelector('#wdp-fade');
    if (fade) {
      // `input` fires all through the drag and must not disturb the element;
      // `change` fires when the pointer (or the keyboard) lets go, and that is
      // where the bar is rebuilt and a ghost at zero is finally torn down.
      fade.oninput = () => { dragging = true; setFade(1 - fade.value / 100); };
      fade.onchange = () => { dragging = false; setFade(1 - fade.value / 100); };
    }
  }

  /**
   * One dial, expressed as how much PROTOTYPE is on screen. The ghost carries
   * whichever surface the page is not, so the same 1 means "ghost fully on"
   * standing on the app and "ghost fully off" standing on the prototype.
   */
  function setFade(share) {
    protoShare = Math.max(0, Math.min(1, share));
    const wanted = pageSurface() === 'prototype' ? 1 - protoShare : protoShare;
    ghostOpacity = wanted;
    // Mid-fade, both surfaces are on screen at once and a pin cannot say which
    // it belongs to. Closing pin mode is the honest move; leaving it open and
    // recording a guess is not.
    if (wanted > 0 && wanted < 1 && window.walkdownEmbed?.isPinMode())
      window.walkdownEmbed.setPinMode(false);
    if (wanted === 0) {
      // Mid-drag the ghost stays, emptied: tearing it down calls render(), and
      // sliding back off the end would then have nothing to fade up.
      if (dragging && ghost) { ghost.style.opacity = 0; paintGhostReach(); return paintBar(); }
      return setGhost(false);
    }
    if (ghost) {
      ghost.style.opacity = wanted;
      paintGhostReach();
      pushGhostContext();
      renderBar();
    } else setGhost(true);
  }

  function startWalkdown() {
    session = { verdicts: {}, actor: data.identity?.actor ?? '' };
    render();
  }

  function listPane() {
    if (!data.rows.length) return '<p class="p-3.5 text-[12.5px] opacity-40">No rules in this blueprint.</p>';
    let html = '';
    let story = null;
    for (const row of data.rows) {
      if (row.story !== story) {
        story = row.story;
        html += `<div class="px-3.5 pb-1 pt-2.5 ${LBL}">${esc(story)}</div>`;
      }
      const mine = needsYou(row.rule);
      const glyph = session?.verdicts[row.rule]
        ? (session.verdicts[row.rule] === 'pass' ? '✓' : '✗')
        : mine ? '◆' : { pass: '✓', fail: '✗', pending: '○' }[row.verdict];
      const cls = session?.verdicts[row.rule]
        ? (session.verdicts[row.rule] === 'pass' ? 'text-success' : 'text-error')
        : mine ? 'text-warning'
        : { pass: 'text-success', fail: 'text-error', pending: 'opacity-30' }[row.verdict];
      const short = shortName(row);
      const thr = threadsFor(row.rule).length;
      html += `<button class="flex w-full cursor-pointer items-center gap-2 px-3.5 py-1.5 text-left text-[13px] hover:bg-base-200"
        data-rule="${esc(row.rule)}" title="${esc(row.rule)}">
        <span class="w-3.5 shrink-0 text-center ${cls}">${glyph}</span>
        <span class="truncate">${esc(short)}</span>
        ${mine || thr ? `<span class="ml-auto shrink-0 text-[10.5px] font-semibold text-warning">${
          mine ? 'walk' : ''}${thr ? ` ${thr}⚑` : ''}</span>` : ''}
      </button>`;
    }
    return html;
  }

  function detailPane() {
    const r = selected;
    if (!r) return '';
    const threads = threadsFor(r.rule);
    const steps = r.steps
      ? Object.entries(r.steps).map(([ph, items]) =>
          `<span class="${LBL} pt-1">${esc(ph)}</span><span>${items.map((s) =>
            esc(s).replace(/`([^`]+)`/g, '<code class="rounded bg-base-200 px-1 text-xs">$1</code>')).join('<br>')}</span>`).join('')
      : '';
    const picked = session?.verdicts[r.rule];
    // Step through the rules in the order the list shows them, without going
    // back to it. The back link keeps its word ("All rules") so the bare
    // arrows beside it read as the stepper rather than as a second way out.
    const at = data.rows.findIndex((x) => x.rule === r.rule);
    const step = (row, cls, glyph, label) =>
      `<div class="tooltip tooltip-left" data-tip="${esc(row ? `${label} rule: ${shortName(row)}` : `No ${label.toLowerCase()} rule`)}">
        <button class="${cls} btn btn-ghost btn-xs" ${row ? `data-goto="${esc(row.rule)}"` : 'disabled'}>${glyph}</button>
      </div>`;
    return `
      <div class="flex items-center px-2 pt-2">
        <button class="wdp-back btn btn-ghost btn-xs text-primary">← All rules</button>
        <div class="ml-auto flex gap-0.5">
          ${step(at > 0 ? data.rows[at - 1] : null, 'wdp-prev', '←', 'Previous')}
          ${step(at >= 0 && at < data.rows.length - 1 ? data.rows[at + 1] : null, 'wdp-next', '→', 'Next')}
        </div>
      </div>
      <div class="flex flex-col gap-3 px-3.5 pb-3.5 pt-1">
        <div>
          <div class="break-all font-mono text-[11px] opacity-40">${esc(r.rule)}</div>
          <p class="text-[15px] leading-relaxed">${esc(r.statement)}</p>
          ${elsewhere(r)}
        </div>
        ${session ? `<div class="flex gap-2">
          <button class="btn btn-sm flex-1 ${picked === 'pass' ? 'btn-success' : 'btn-outline btn-success'}" data-v="pass">✓ Pass</button>
          <button class="btn btn-sm flex-1 ${picked === 'fail' ? 'btn-error' : 'btn-outline btn-error'}" data-v="fail">✗ Fail</button>
        </div>
        <div class="text-[11.5px] opacity-50">${Object.keys(session.verdicts).length} judged this session</div>` : ''}
        ${steps ? `<div><div class="${LBL} mb-1.5">Steps</div>
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[13px] leading-relaxed">${steps}</div></div>` : ''}
        <div>
          <div class="${LBL} mb-1.5">Verify</div>
          <div class="text-[13px]">${esc(r.verify.join(', '))}</div>
        </div>
        ${threads.length ? `<div><div class="${LBL} mb-1.5">Threads</div>
          ${threads.map(threadCard).join('')}</div>` : ''}
      </div>`;
  }

  /**
   * A thread in the detail pane. Collapsed it is a line of provenance and the
   * note; open it carries its replies, a reply box and the transitions its
   * state allows — feedback gets answered where it is read, without leaving
   * the app under review.
   */
  function threadCard(t) {
    const waiting = t.status === 'addressed' || t.status === 'answered';
    const open = openThread === t.id;
    const replies = t.replies ?? [];
    const sketch = ghostSource(screenById(t.anchor?.screen));
    return `<div class="mb-1.5 rounded-r-box border-l-3 px-2.5 py-2 ${
      waiting ? 'border-l-warning bg-warning/10' : 'border-l-base-300 bg-base-200'}">
      <button class="flex w-full items-center gap-1 text-left text-[11.5px] opacity-60" data-thread="${esc(t.id)}">
        <b class="opacity-100">${esc(t.id)}</b> · ${esc(t.kind)} · ${esc(t.status)}
        <span class="ml-auto">${open ? '\u25be' : '\u25b8'}</span>
      </button>
      <div class="mt-0.5 text-[12.5px] leading-snug">${esc(t.body)}</div>
      ${open ? `
        ${replies.length ? `<div class="mt-2 border-l-2 border-base-300 pl-2">
          ${replies.map((r) => `<div class="py-0.5 text-[12px] leading-snug">
            <div class="text-[10.5px] opacity-50">${esc(r.author)} · ${ago(r.created)}</div>${esc(r.body)}</div>`).join('')}
        </div>` : ''}
        ${sketch?.proposed ? `<button class="btn btn-xs btn-outline mt-2 w-full" data-sketch="${esc(t.anchor.screen)}">
          \u26a0 View the proposed sketch</button>` : ''}
        <textarea id="wdp-note" class="textarea textarea-xs mt-2 h-14 w-full"
          placeholder="Reply\u2026">${esc(threadNote)}</textarea>
        <div class="mt-1 flex flex-wrap items-center gap-1">
          <input id="wdp-tactor" class="input input-xs w-22" placeholder="your name"
            value="${esc(data.identity?.actor ?? '')}" title="Verify and waive are recorded under a person's name">
          <button class="btn btn-xs" data-act="__reply" data-tid="${esc(t.id)}">Reply</button>
          ${threadActions(t).map(([label, st, quiet]) =>
            `<button class="btn btn-xs${quiet ? ' btn-ghost ml-auto opacity-60' : ''}"
              data-act="${esc(st)}" data-tid="${esc(t.id)}">${label}</button>`).join('')}
        </div>
        <div class="mt-1 hidden text-[11px] text-warning" id="wdp-tsay"></div>` : ''}
    </div>`;
  }

  function say(msg) {
    const el = host.querySelector('#wdp-tsay');
    if (!el) return toast(msg);
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  async function threadPost(path, body) {
    const res = await fetch(api(path), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { say(out.error ?? 'request failed'); return false; }
    return true;
  }

  /** Reply and lifecycle, under the same governance the server enforces. */
  async function threadAct(id, status) {
    const t = (data.threads ?? []).find((x) => x.id === id);
    if (!t) return;
    const text = (host.querySelector('#wdp-note')?.value ?? '').trim();
    const actor = (host.querySelector('#wdp-tactor')?.value ?? '').trim();
    const humanOnly = status === 'verified' || status === 'waived';
    // Agents claim work; a person accepts it. The server refuses this too —
    // saying so here means you find out before you have written the reason.
    if (humanOnly && (!actor || actor === 'agent'))
      return say('Verify and waive are recorded under a person\u2019s name \u2014 fill it in first.');
    if (status === '__reply') {
      if (!text) return say('Write the reply first.');
      if (await threadPost(`/api/threads/${id}/replies`, { author: actor || undefined, body: text })) {
        threadNote = '';
        await load();
      }
      return;
    }
    if (status === '__answer') {
      if (!text) return say('Write the answer first \u2014 answering a question records it.');
      if (await threadPost(`/api/threads/${id}/replies`, { author: actor || undefined, body: text }) &&
          await threadPost(`/api/threads/${id}/status`, { status: 'answered', actor })) {
        threadNote = '';
        await load();
      }
      return;
    }
    const needsReason = status === 'waived' || status === 'open';
    if (needsReason && !text)
      return say(`${status === 'waived' ? 'Waiving' : 'Reopening'} is recorded with a reason \u2014 write it above, then press again.`);
    if (await threadPost(`/api/threads/${id}/status`,
        { status, actor, reason: needsReason ? text : undefined })) {
      threadNote = '';
      if (['verified', 'waived', 'incorporated'].includes(status)) openThread = null;
      await load();
    }
  }

  function wireThreads() {
    host.querySelectorAll('[data-thread]').forEach((el) => {
      el.onclick = () => {
        openThread = openThread === el.dataset.thread ? null : el.dataset.thread;
        threadNote = '';
        render();
      };
    });
    const note = host.querySelector('#wdp-note');
    if (note) note.oninput = () => { threadNote = note.value; };
    host.querySelectorAll('[data-act]').forEach((el) => {
      el.onclick = () => threadAct(el.dataset.tid, el.dataset.act);
    });
    host.querySelectorAll('[data-sketch]').forEach((el) => {
      el.onclick = () => { ghostOverride = el.dataset.sketch; setGhost(false); ghostOverride = el.dataset.sketch; setGhost(true); };
    });
  }

  /*
   * The panel does not move the page underneath it — it docks beside whatever
   * you navigated to, and the screen picker describes that page. So when a
   * rule lives on a screen you are not looking at, say so and offer the trip
   * rather than silently judging the wrong screen.
   */
  function elsewhere(r) {
    const here = currentScreen();
    const want = screenById(r.flow?.at(-1) ?? r.screens?.[0]);
    if (!want || !here || want.id === here.id) return '';
    const href = want.app?.path && data.appBase ? data.appBase + want.app.path : null;
    return `<div class="mt-1.5 text-[11.5px] opacity-60">This rule is on
      <b>${esc(want.id)}</b>; you are on <b>${esc(here.id)}</b>.
      ${href ? `<a class="link link-primary" href="${esc(href)}">Go there</a>` : ''}</div>`;
  }

  /*
   * Which screen is this page? The panel guesses from the URL and is usually
   * right; this is where you say otherwise, and where you see which screens
   * have a design on file to compare against at all.
   */
  function blueprintsPane() {
    return `
      <div class="px-3.5 pb-2 pt-1">
        <div class="mb-1 text-[11px] font-bold uppercase tracking-wider opacity-50">walkdown server</div>
        <div class="flex items-center gap-2">
          <input id="wdp-server" class="input input-xs flex-1" value="${esc(SERVER)}"
                 aria-label="walkdown server address">
          <button class="btn btn-xs btn-outline btn-primary" id="wdp-retry">Connect</button>
        </div>
        ${servedRoot
          ? `<p class="mt-1.5 text-[11px] leading-relaxed opacity-50">Serving
              <span class="font-mono opacity-80">${esc(servedRoot)}</span> \u2014 every blueprint
              under it is listed below.</p>`
          : `<p class="mt-1.5 text-[11px] leading-relaxed opacity-40">Not connected. Run
              <code>walkdown serve</code> in the folder holding your blueprints.</p>`}
      </div>
      ${projects.length ? projects.map((pr) => {
        const on = pr.id === BP;
        return `<button class="block w-full border-t border-base-300 px-3.5 py-2.5 text-left hover:bg-base-200"
          data-pick="${esc(pr.id)}">
          <span class="flex items-center gap-2">
            <span class="w-3.5 shrink-0 text-center ${on ? 'text-primary' : 'opacity-30'}">${on ? '\u25c9' : '\u25cb'}</span>
            <span class="text-[13px] font-semibold">${esc(pr.name)}</span>
          </span>
          <span class="mt-0.5 block pl-5.5 text-[12px] leading-snug opacity-60">${
            esc(pr.description ?? 'No description \u2014 add one to this blueprint\u2019s walkdown.yml.')}</span>
          <span class="mt-0.5 block pl-5.5 font-mono text-[10.5px] opacity-35">${esc(pr.id)}</span>
        </button>`;
      }).join('') : '<p class="px-3.5 py-3 text-[12.5px] opacity-40">Nothing found under that folder.</p>'}`;
  }

  /** Server address and blueprint choice, wired the same wherever they appear. */
  function wireBlueprints(root) {
    const retry = root.querySelector('#wdp-retry');
    if (retry) retry.onclick = () => {
      const at = root.querySelector('#wdp-server').value.trim();
      if (at) { SERVER = at.replace(/\/+$/, ''); store.set(CHOICE + ':server', SERVER); }
      phase = 'loading';
      start();
    };
    root.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = async () => {
        BP = b.dataset.pick;
        await store.set(CHOICE, BP);
        listTab = 'rules';
        view = 'list';
        selected = null;
        phase = 'loading';
        start();
      };
    });
  }

  function screensPane() {
    const screens = data.storyboard ?? [];
    if (!screens.length)
      return '<p class="p-3.5 text-[12.5px] opacity-40">No screens in this blueprint — headless rules only.</p>';
    const here = currentScreen();
    const auto = !pickedScreen;
    return `
      <button class="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12.5px] hover:bg-base-200"
        data-screen="">
        <span class="w-3.5 shrink-0 text-center ${auto ? 'text-primary' : 'opacity-30'}">${auto ? '\u25c9' : '\u25cb'}</span>
        <span>Detect from the page</span>
        ${auto && here ? `<span class="ml-auto text-[11px] opacity-50">${esc(here.id)}</span>` : ''}
      </button>
      <div class="mx-3.5 my-1 border-t border-base-300"></div>
      ${screens.map((sc) => {
        const on = pickedScreen === sc.id;
        const design = ghostSource(sc);
        return `<button class="flex w-full items-start gap-2 px-3.5 py-2 text-left hover:bg-base-200"
          data-screen="${esc(sc.id)}">
          <span class="w-3.5 shrink-0 pt-0.5 text-center ${on ? 'text-primary' : 'opacity-30'}">${on ? '\u25c9' : '\u25cb'}</span>
          <span class="min-w-0">
            <span class="block truncate text-[13px]">${esc(sc.title ?? sc.id)}</span>
            <span class="block truncate font-mono text-[10.5px] opacity-40">${esc(sc.id)}</span>
          </span>
          <span class="ml-auto shrink-0 pt-0.5 text-[10.5px] ${design ? 'opacity-50' : 'text-warning'}">${
            design ? (design.proposed ? 'sketch' : 'design') : 'no design'}</span>
        </button>`;
      }).join('')}`;
  }

  function wireVerdict() {
    host.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = () => {
        session.verdicts[selected.rule] = b.dataset.v;
        // A pass moves you on; a fail keeps you here to pin what is wrong.
        if (b.dataset.v === 'pass') {
          const next = data.rows.find((x) => needsYou(x.rule) && !session.verdicts[x.rule]);
          if (next) { selected = next; render(); return; }
          view = 'list';
        }
        render();
      };
    });
  }

  function toast(html) {
    const t = document.createElement('div');
    t.className = 'toast toast-end pointer-events-auto';
    t.dataset.theme = 'blueprint';
    t.style.right = `${W + 18}px`;
    t.innerHTML = `<div class="alert alert-neutral text-[13px]">${html}</div>`;
    side.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  /** Append the session to the runs ledger — the same write the viewer makes. */
  async function finishWalkdown() {
    const results = Object.entries(session.verdicts).map(([rule, status]) => ({ rule, status }));
    if (!results.length) { session = null; render(); return; }
    const actor = (session.actor ?? '').trim();
    if (!actor || actor === 'agent') {
      toast('A walkdown is recorded under a person’s name — fill it in first.');
      host.querySelector('#wdp-actor')?.focus();
      return;
    }
    try {
      const res = await fetch(api('/api/walkdowns'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor, target: 'local', results }),
      });
      const out = await res.json();
      if (!res.ok) return toast(`Not recorded: ${esc(out.error ?? 'request failed')}`);
      session = null;
      view = 'list';
      selected = null;
      await load();
      toast(`Recorded ${results.length} verdict${results.length === 1 ? '' : 's'} as <b>${esc(out.run_id)}</b>`);
    } catch {
      toast('walkdown server unreachable — nothing recorded.');
    }
  }

  function open(ruleId) {
    selected = data.rows.find((r) => r.rule === ruleId) ?? null;
    view = 'detail';
    render();
  }

  /** The prototype for this screen, laid over the running app. */
  function setGhost(on) {
    if (!on) {
      ghost?.remove();
      ghost = null;
      ghostReady = false;     // whatever was in there is gone with it
      ghostOverride = null;   // the detour ends with the overlay
      protoShare = null;      // and the dial goes back to following the page
      render();
      return;
    }
    ghostReady = false;
    const screen = screenById(ghostOverride) ?? currentScreen();
    const src = ghostSource(screen);
    if (!src) return;
    // The stage owns the opacity so the backdrop fades with the prototype: at
    // full strength the app is properly covered, not blended into. The
    // checkerboard says "nothing is here" where the prototype does not reach,
    // so an uncovered strip never reads as design. Inline styles: this element
    // is in the host document, where our stylesheet has no reach.
    ghost = document.createElement('div');
    // width/height stay auto so the four insets keep sizing it — the UA gives a
    // popover fit-content, which would collapse it to nothing.
    ghost.style.cssText = `position:fixed; top:${HEAD}px; left:${GAP}px; bottom:${GAP}px;
      right:${W + GAP * 2}px; z-index:2147482000; border-radius:10px; overflow:hidden;
      width:auto; height:auto; max-width:none; max-height:none; margin:0; border:0; padding:0;
      pointer-events:none; display:flex; align-items:center; justify-content:center;
      background-color:#e9ecf0;
      background-image:
        linear-gradient(45deg, #d5dae1 25%, transparent 25%),
        linear-gradient(-45deg, #d5dae1 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #d5dae1 75%),
        linear-gradient(-45deg, transparent 75%, #d5dae1 75%);
      background-size:22px 22px; background-position:0 0, 0 11px, 11px -11px, -11px 0;
      opacity:${ghostOpacity};`;
    // An iframe is a replaced element: insets alone leave it at its intrinsic
    // 300x150, so the size is explicit.
    const frame = document.createElement('iframe');
    frame.style.cssText = `width:${ghostWidth ? ghostWidth + 'px' : '100%'}; height:100%;
      max-width:100%; max-height:100%; border:0; background:#fff;
      box-shadow:0 0 0 1px rgba(20,25,40,.14), 0 10px 40px rgba(20,25,40,.18);`;
    frame.src = src.url ?? api(src.path);
    /*
     * A surface carrying walkdown announces itself while it parses, so by the
     * time the frame has loaded the answer is in. Nobody there means the ghost
     * cannot be pinned, and pin mode must not stay armed over it — a pin would
     * land on the page hidden underneath the one being looked at.
     */
    frame.addEventListener('load', () => {
      if (ghostReady) return;
      if (ghostOpacity === 1) window.walkdownEmbed?.setPinMode(false);
      renderBar();
    });
    ghost.appendChild(frame);
    // A proposal is an agent's sketch, not design's work. It says so on its
    // face, so nobody walks a screen down against a drawing we made up.
    if (src.proposed) {
      const flag = document.createElement('div');
      flag.textContent = '\u26a0 Proposed sketch \u2014 not from design';
      flag.style.cssText = `position:absolute; top:0; left:0; right:0; z-index:1; text-align:center;
        background:#d97706; color:#fff; font:600 11px/1 -apple-system, sans-serif;
        letter-spacing:.06em; padding:6px 8px;`;
      ghost.appendChild(flag);
    }
    document.body.appendChild(ghost);
    // The app's own modals live in the top layer, so a ghost that is only
    // z-indexed gets painted over by exactly the states worth comparing.
    raise();
    paintGhostReach();
    render();
  }

  /*
   * ---- the ghosted surface, when it is the one you are looking at ---------
   *
   * A ghost at full strength is not an overlay any more, it is the view. So
   * when pin mode is on and the fade has landed there, the ghost stops being
   * click-through and the copy of walkdown inside it does the pinning — the
   * same framed conversation the old viewer had with its two panes, which is
   * why the embed already speaks it and nothing in there needed changing.
   */
  const ghostFrame = () => ghost?.querySelector('iframe') ?? null;

  function pinsForScreen(id) {
    if (!id) return [];
    return (data?.threads ?? [])
      .filter((t) => t.anchor?.screen === id && !['incorporated', 'verified', 'waived'].includes(t.status))
      .map((t) => ({ id: t.id, kind: t.kind, status: t.status, element: t.anchor?.element,
        position: t.anchor?.position, surface: t.anchor?.surface, viewport: t.anchor?.viewport,
        body: t.body, replies: t.replies ?? [] }));
  }

  /** Whether the ghost currently takes the pointer instead of passing it through. */
  const ghostHasReach = () =>
    Boolean(ghost) && ghostOpacity === 1 && ghostReady && (window.walkdownEmbed?.isPinMode() ?? false);

  function paintGhostReach() {
    if (ghost) ghost.style.pointerEvents = ghostHasReach() ? 'auto' : 'none';
  }

  /*
   * What the copy inside the ghost needs in order to behave: which screen it
   * is showing, which surface it counts as, whether pinning is live, and the
   * pins already on that screen. Same message the viewer sent its panes.
   */
  function pushGhostContext() {
    const sc = screenById(ghostOverride) ?? currentScreen();
    ghostFrame()?.contentWindow?.postMessage({
      type: 'walkdown:context',
      screen: sc?.id ?? null,
      surface: ghostSurface(),
      pinMode: ghostHasReach(),
      pins: pinsForScreen(sc?.id),
    }, '*');
  }

  /*
   * Only the ghost gets to speak. This script runs inside somebody else's
   * application, which may have iframes of its own, and a message is not
   * evidence of who sent it — so anything not from the ghost's own window is
   * not walkdown talking.
   */
  addEventListener('message', async (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object' || !ghost) return;
    if (e.source !== ghostFrame()?.contentWindow) return;

    if (msg.type === 'walkdown:ready') {
      ghostReady = true;
      paintGhostReach();
      pushGhostContext();
      return renderBar();
    }
    // The ghosted surface can leave pin mode too (Escape). Pin mode has one
    // owner, so it is told rather than each side keeping its own answer.
    if (msg.type === 'walkdown:pin-mode' && msg.on === false)
      return window.walkdownEmbed?.setPinMode(false);

    if (msg.type === 'walkdown:open-thread') {
      openThread = msg.id;
      const t = (data?.threads ?? []).find((x) => x.id === msg.id);
      const row = t?.anchor?.rule ? data.rows.find((r) => r.rule === t.anchor.rule) : null;
      if (row) { selected = row; view = 'detail'; }
      return render();
    }

    if (msg.type === 'walkdown:new-pin') {
      const sc = screenById(ghostOverride) ?? currentScreen();
      await fetch(api('/api/threads'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: msg.kind, body: msg.body,
          anchor: {
            ...(msg.element && { element: msg.element }),
            ...(msg.position && { position: msg.position }),
            ...(msg.viewport && { viewport: msg.viewport }),
            surface: ghostSurface(),
            ...(sc && { screen: sc.id }),
          },
        }),
      }).catch(() => {});
      await load();
      pushGhostContext();
    }
  });

  /*
   * Is the keystroke going somewhere that wants letters? e.target is retargeted
   * to the shadow host for anything typed inside the panel, so a tagName test
   * on it sees a DIV and every "g" in a reply body used to flash the ghost.
   * composedPath()[0] is the element actually being typed into, on either side
   * of the boundary.
   */
  const typing = (e) => {
    const el = e.composedPath?.()[0] ?? e.target;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? '') || el?.isContentEditable === true;
  };

  // Hold G to peek at the prototype at full strength.
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'g' && ghost && !e.metaKey && !e.ctrlKey && !typing(e)) ghost.style.opacity = 1;
  });
  addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'g' && ghost) ghost.style.opacity = ghostOpacity;
  });

  /*
   * Three questions, asked once each and then not again: is there a server,
   * which blueprint is this site, and then the actual work. A script tag has
   * already answered the second, so it goes straight past the picker.
   */
  async function start() {
    let payload;
    try {
      payload = await (await fetch(api('/api/blueprint'))).json();
    } catch {
      phase = 'connect';
      return renderGate();
    }
    projects = payload.projects ?? [];
    servedRoot = payload.root ?? null;
    if (!BP && projects.length > 1) {
      const remembered = await store.get(CHOICE);
      if (remembered && projects.some((pr) => pr.id === remembered)) BP = remembered;
    }
    if (!BP && projects.length > 1) {
      phase = 'choose';
      return renderGate();
    }
    phase = 'ready';
    data = BP ? await (await fetch(api('/api/blueprint'))).json() : payload;
    render();
  }

  /** The two screens that come before there is anything to review. */
  function renderGate() {
    renderBar();
    if (phase === 'connect') {
      side.innerHTML = `
        <div class="flex flex-1 flex-col justify-center gap-3 p-5">
          <div class="text-[15px] font-semibold">No blueprints open</div>
          <p class="text-[12.5px] leading-relaxed opacity-60">A browser tab cannot read your
            filesystem, and walkdown both reads blueprints and writes threads and run records back
            to them. So it works through a small local server, which is the thing that actually
            holds the folder open.</p>
          <p class="text-[12.5px] leading-relaxed opacity-60">In the directory holding your
            blueprints, run:</p>
          <code class="rounded-box bg-base-200 px-3 py-2 text-[12px]">walkdown serve</code>
          <div class="flex items-center gap-2">
            <input id="wdp-server" class="input input-sm flex-1" value="${esc(SERVER)}"
                   aria-label="walkdown server address">
            <button class="btn btn-sm btn-primary" id="wdp-retry">Connect</button>
          </div>
          <p class="text-[11.5px] opacity-40">Then every blueprint under that folder is listed here.</p>
        </div>`;
      wireBlueprints(side);
      return;
    }
    side.innerHTML = `
      <div class="p-4 pb-2">
        <div class="text-[15px] font-semibold">Which blueprint?</div>
        <p class="mt-1 text-[12.5px] leading-relaxed opacity-60">Remembered for
          <b>${esc(location.origin)}</b>, and changeable later from the Blueprints tab.</p>
      </div>
      <div class="flex-1 overflow-y-auto">${blueprintsPane()}</div>`;
    wireBlueprints(side);
  }

  setDocked(true);
  watchLocation();
  window.walkdownEmbed?.dismissBadge();
  // Pin mode has one owner — the embed. The bar mirrors it rather than keeping
  // a second copy that Escape and the badge would have to remember to update.
  window.walkdownEmbed?.watchPinMode(() => {
    paintGhostReach();
    pushGhostContext();
    if (phase === 'ready') renderBar();
  });

  store.get(CHOICE + ':server').then((at) => { if (at) SERVER = at; }).finally(start);
})();
