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
   * Two layouts, one panel.
   *
   * DOCKED: injected into the application's own document, which is inset by a
   * margin to leave room for the chrome. Cheap, works from a script tag — and
   * bounded by the fact that the application owns the viewport. Anything it
   * positions against that viewport ignores the margin, and a native
   * <dialog showModal()> makes everything outside it inert.
   *
   * FRAMED: walkdown owns the document and the application is a frame inside
   * it. A frame is a viewport of its own, so the app's modals are laid out
   * against the sheet, nothing it draws can paint over the tool, and inert
   * stops at the frame boundary. The extension delivers this one, because
   * putting a page in a frame it refuses is something only an extension can do.
   */
  const FRAMED = Boolean(cfg.frame?.url);
  let frameUrl = cfg.frame?.url ?? null;   // where the app frame actually is
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
  // Set when a blueprint is chosen by hand, spent once the new one has loaded.
  let jumpOnLoad = false;
  let servedRoot = null;   // the folder the server reports it is serving
  let listTab = 'rules';   // rules | screens — the two things the side lists
  let threadNote = '';     // what the reply box says, kept across re-renders
  let verdictNote = '';    // the verdict feedback box, kept across re-renders
  const ACTOR_KEY = 'walkdown:actor';
  let actorOverride = null; // a name set in Settings outlives the git default
  let lastView = 'list';
  let ghostWidth = 0;   // 0 = fill the stage; otherwise a fixed CSS width
  let viewportW = 0;    // framed viewport preset: 0 = fit the space, else CSS px

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /*
   * Phosphor, inlined. The panel ships as one file down two delivery paths, so
   * it cannot fetch an icon font or a sprite sheet; tools/sync-phosphor.mjs
   * copies the markup for the names we use out of @phosphor-icons/core.
   */
  // --- phosphor:start (generated by tools/sync-phosphor.mjs) ---
  const PHOSPHOR = {
    'bounding-box': '<path d="M208,96a16,16,0,0,0,16-16V48a16,16,0,0,0-16-16H176a16,16,0,0,0-16,16v8H96V48A16,16,0,0,0,80,32H48A16,16,0,0,0,32,48V80A16,16,0,0,0,48,96h8v64H48a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16H80a16,16,0,0,0,16-16v-8h64v8a16,16,0,0,0,16,16h32a16,16,0,0,0,16-16V176a16,16,0,0,0-16-16h-8V96ZM176,48h32V80H176ZM48,48H80V63.9a.51.51,0,0,0,0,.2V80H48ZM80,208H48V176H80v15.9a.51.51,0,0,0,0,.2V208Zm128,0H176V176h32Zm-24-48h-8a16,16,0,0,0-16,16v8H96v-8a16,16,0,0,0-16-16H72V96h8A16,16,0,0,0,96,80V72h64v8a16,16,0,0,0,16,16h8Z"/>',
    'checks': '<path d="M149.61,85.71l-89.6,88a8,8,0,0,1-11.22,0L10.39,136a8,8,0,1,1,11.22-11.41L54.4,156.79l84-82.5a8,8,0,1,1,11.22,11.42Zm96.1-11.32a8,8,0,0,0-11.32-.1l-84,82.5-18.83-18.5a8,8,0,0,0-11.21,11.42l24.43,24a8,8,0,0,0,11.22,0l89.6-88A8,8,0,0,0,245.71,74.39Z"/>',
    'desktop': '<path d="M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24h72v16H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V200h72a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40ZM48,56H208a8,8,0,0,1,8,8v80H40V64A8,8,0,0,1,48,56ZM208,184H48a8,8,0,0,1-8-8V160H216v16A8,8,0,0,1,208,184Z"/>',
    'device-mobile': '<path d="M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16ZM72,64H184V192H72Zm8-32h96a8,8,0,0,1,8,8v8H72V40A8,8,0,0,1,80,32Zm96,192H80a8,8,0,0,1-8-8v-8H184v8A8,8,0,0,1,176,224Z"/>',
    'frame-corners': '<path d="M200,80v32a8,8,0,0,1-16,0V88H160a8,8,0,0,1,0-16h32A8,8,0,0,1,200,80ZM96,168H72V144a8,8,0,0,0-16,0v32a8,8,0,0,0,8,8H96a8,8,0,0,0,0-16ZM232,56V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56ZM216,200V56H40V200H216Z"/>',
    'gear': '<path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z"/>',
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
   * The desk tuner. A separate element rather than part of the bar's innerHTML
   * for the same reason the fade slider needed `dragging`: the bar is rebuilt
   * wholesale, and rebuilding an input mid-drag kills the drag. This panel is
   * built once and only shown or hidden, so its sliders survive anything.
   */
  const deskPanel = document.createElement('div');
  deskPanel.dataset.theme = 'blueprint';
  deskPanel.className = 'w-64 rounded-box border border-primary/45 bg-base-100 p-3 text-base-content shadow-xl';
  // Offset past the app's own top-left corner on purpose — flush against it
  // read as though the tuner belonged to the app's layout rather than to the
  // desk it sits on. One GAP beyond the corner on each axis, so it stands off
  // evenly rather than drifting further from one side than the other.
  deskPanel.style.cssText = `position:absolute; top:${TOP + GAP}px; left:${GAP * 2}px; display:none; pointer-events:auto;`;
  host.appendChild(deskPanel);
  let deskOpen = false;

  const DESK_DIALS = [
    { k: 'tilt', label: 'Tilt', min: 0, max: 45, unit: '°' },
    { k: 'tip', label: 'Tip', min: 0, max: 60, unit: '°' },
    { k: 'depth', label: 'Depth', min: 400, max: 3000, unit: 'px' },
    { k: 'gap', label: 'Spacing', min: 16, max: 64, unit: 'px' },
    { k: 'ink', label: 'Ink', min: 2, max: 24, unit: '%' },
  ];

  /*
   * "See the full effect" means seeing the app out of the way without it
   * being gone — 10%, not 0, so the ruling is judged against the thing it
   * actually sits behind rather than against nothing. Deliberately not saved:
   * the checkbox is a way of looking, not a preference, and it always starts
   * unchecked because leaving it on would mean a reviewer opening the tuner
   * to a half-invisible application without having asked for that.
   */
  let hideAppOn = false;
  function hideApp(on) {
    hideAppOn = on;
    const app = FRAMED ? appFrame : document.body;
    // The aside goes with the app rather than staying — it sits on the desk
    // over the page, so leaving it at full strength would still hide most of
    // the ruling behind it. So does the headless cover, which is opaque by
    // design. The bar stays: its buttons have to keep working while you're
    // peeking, and it draws no surface of its own to cover the desk with.
    for (const el of [app, side, headlessCover]) if (el) el.style.opacity = on ? '0.1' : '';
  }

  /** A dial's number, click-to-edit: text until clicked, then a real input. */
  function editDialValue(dial) {
    const cell = deskPanel.querySelector(`#wdp-desk-${dial.k}`);
    if (!cell || cell.querySelector('input')) return;
    const range = deskPanel.querySelector(`input[type=range][data-k="${dial.k}"]`);
    cell.innerHTML = `<input type="number" class="input input-xs w-12 px-1 text-right font-mono text-[10.5px]"
      min="${dial.min}" max="${dial.max}" value="${desk[dial.k]}">`;
    const inp = cell.querySelector('input');
    inp.focus();
    inp.select();
    const commit = () => {
      const v = Math.min(dial.max, Math.max(dial.min, Number(inp.value) || 0));
      desk[dial.k] = v;
      range.value = v;
      store.set(DESK_KEY, { ...desk });
      if (docked) paintDesk(true);
      cell.textContent = `${v}${dial.unit}`;
    };
    inp.onblur = commit;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') inp.blur();
      if (e.key === 'Escape') {
        // Cancel the edit rather than the tuner — the outer Escape handler
        // would otherwise close the whole panel from under an open edit.
        e.stopPropagation();
        cell.textContent = `${desk[dial.k]}${dial.unit}`;
      }
    };
  }

  /** The gear panel is Settings: who you record as, then the desk ruling. */
  function openActorSettings() {
    deskOpen = true;
    syncDeskPanel();
    deskPanel.querySelector('#wdp-set-actor')?.focus();
  }

  function buildDeskPanel() {
    deskPanel.innerHTML = `
      <div class="mb-2 flex items-center gap-2">
        <span class="text-[12px] font-semibold">Record as</span>
        <input id="wdp-set-actor" class="input input-xs ml-auto w-36" value="${esc(session?.actor ?? actorOverride ?? data?.identity?.actor ?? '')}"
          title="Walkdown verdicts, sign-offs and thread actions are recorded under this name">
      </div>
      <div class="mb-2 mt-3 flex items-center gap-2 border-t border-base-300 pt-2">
        <span class="text-[12px] font-semibold">Desk ruling</span>
        <button class="btn btn-xs btn-ghost ml-auto" id="wdp-desk-reset">Reset</button>
      </div>
      ${DESK_DIALS.map((d) => `
        <label class="mb-1.5 flex items-center gap-2 text-[11.5px]">
          <span class="w-14 shrink-0 opacity-60">${d.label}</span>
          <input type="range" class="range range-xs range-primary" data-k="${d.k}"
            min="${d.min}" max="${d.max}" value="${desk[d.k]}" aria-label="${d.label}">
          <span class="w-12 shrink-0 cursor-text text-right font-mono text-[10.5px] opacity-60 hover:opacity-100"
            id="wdp-desk-${d.k}" title="Click to type a value">${desk[d.k]}${d.unit}</span>
        </label>`).join('')}
      <label class="mt-1 flex items-center gap-2 text-[11.5px]">
        <input type="checkbox" class="checkbox checkbox-xs" id="wdp-desk-hide" ${hideAppOn ? 'checked' : ''}>
        <span>Hide app temporarily</span>
      </label>
      <p class="mt-2 text-[10.5px] leading-relaxed opacity-40">Yours alone — how the paper
        lies changes nothing about what gets verified.</p>`;
    deskPanel.querySelectorAll('input[type=range]').forEach((inp) => {
      const dial = DESK_DIALS.find((d) => d.k === inp.dataset.k);
      // input repaints live under the drag; change is when the value is kept.
      inp.oninput = () => {
        desk[dial.k] = Number(inp.value);
        deskPanel.querySelector(`#wdp-desk-${dial.k}`).textContent = `${desk[dial.k]}${dial.unit}`;
        if (docked) paintDesk(true);
      };
      inp.onchange = () => store.set(DESK_KEY, { ...desk });
    });
    DESK_DIALS.forEach((d) => {
      deskPanel.querySelector(`#wdp-desk-${d.k}`).onclick = () => editDialValue(d);
    });
    deskPanel.querySelector('#wdp-desk-reset').onclick = () => {
      desk = { ...DESK_DEFAULTS };
      store.set(DESK_KEY, { ...desk });
      buildDeskPanel();
      if (docked) paintDesk(true);
    };
    deskPanel.querySelector('#wdp-desk-hide').onchange = (e) => hideApp(e.target.checked);
    const act = deskPanel.querySelector('#wdp-set-actor');
    act.onchange = () => {
      actorOverride = act.value.trim();
      store.set(ACTOR_KEY, actorOverride);
      if (session) { session.actor = actorOverride; render(); }
    };
  }

  function syncDeskPanel() {
    if (deskOpen) buildDeskPanel();
    else hideApp(false);   // closing the tuner ends the peek, not just hides the checkbox
    deskPanel.style.display = deskOpen ? '' : 'none';
  }

  const closeDeskPanel = () => { deskOpen = false; syncDeskPanel(); };

  /*
   * A click anywhere outside the tuner closes it — composedPath rather than
   * e.target, because e.target of an event crossing into a shadow root is
   * retargeted to the shadow's host and would see every click in the panel as
   * "the panel", tuner included. The gear is excluded on purpose: its own
   * onclick already toggles deskOpen, and closing it here first would just
   * have that reopen it a moment later.
   */
  document.addEventListener('pointerdown', (e) => {
    if (!deskOpen) return;
    const path = e.composedPath();
    if (path.includes(deskPanel)) return;
    const gear = bar.querySelector('#wdp-desk-btn');
    if (gear && path.includes(gear)) return;
    closeDeskPanel();
  }, true);

  // Escape closes the tuner — but only once whatever is being typed into it
  // has had its own turn (a dial's own edit box reverts first, see below).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && deskOpen) closeDeskPanel();
  });

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

  /*
   * Framed: the application is a frame of ours, laid on the desk exactly where
   * the docked layout lays the host page. Everything downstream — the ghost's
   * geometry, the fade, the pin plumbing — measures the same rectangle either
   * way, so only this differs.
   */
  const appFrame = FRAMED ? document.createElement('iframe') : null;
  if (appFrame) {
    appFrame.src = frameUrl;
    appFrame.setAttribute('title', 'the application under review');
    document.body.appendChild(appFrame);
  }

  /** The desk space the frame may occupy, and the scale a preset needs. */
  function frameSpace() {
    const availW = innerWidth - (W + GAP * 3);
    const availH = innerHeight - (HEAD + GAP);
    const scale = viewportW ? Math.min(1, availW / viewportW) : 1;
    return { availW, availH, scale };
  }

  function placeAppFrame(on) {
    if (!appFrame) return;
    const { availW, availH, scale } = frameSpace();
    // An iframe is a replaced element: four insets alone leave it at its
    // intrinsic 300x150, so the size has to be said outright. A viewport
    // preset sizes the frame like a real device: the app lays out at that
    // width, and a viewport wider than the space scales down WHOLE - a
    // desktop layout seen as a desktop layout, never reflowed to a column.
    appFrame.style.cssText = on
      ? (viewportW
        ? `position:fixed; top:${HEAD}px;
           left:${GAP + Math.max(0, (availW - viewportW * scale) / 2)}px;
           width:${viewportW}px; height:${availH / scale}px;
           transform:scale(${scale}); transform-origin:top left;
           border:0; border-radius:${10 / scale}px; background:#fff;
           box-shadow:0 1px 2px rgba(0,0,0,.28), 0 12px 32px rgba(0,0,0,.34);
           transition:width .22s ease, height .22s ease, top .22s ease, left .22s ease;`
        : `position:fixed; top:${HEAD}px; left:${GAP}px;
           width:calc(100vw - ${W + GAP * 3}px); height:calc(100vh - ${HEAD + GAP}px);
           border:0; border-radius:10px; background:#fff; transform:none;
           box-shadow:0 1px 2px rgba(0,0,0,.28), 0 12px 32px rgba(0,0,0,.34);
           transition:width .22s ease, height .22s ease, top .22s ease, left .22s ease;`)
      : `position:fixed; top:0; left:0; width:100vw; height:100vh;
         border:0; border-radius:0; background:#fff;
         transition:width .22s ease, height .22s ease, top .22s ease, left .22s ease;`;
  }

  /** The little pill naming the preset and, when the frame is scaled, by how much. */
  let zoomBadge = null;
  function syncZoomBadge() {
    const show = docked && FRAMED && viewportW;
    if (!show) { zoomBadge?.remove(); zoomBadge = null; return; }
    if (!zoomBadge) {
      zoomBadge = document.createElement('div');
      document.body.appendChild(zoomBadge);
    }
    const { scale } = frameSpace();
    zoomBadge.textContent = scale < 1
      ? `${viewportW}px · fit ${Math.round(scale * 100)}%`
      : `${viewportW}px`;
    zoomBadge.style.cssText = `position:fixed; right:${W + GAP * 2 + 10}px; bottom:${GAP + 10}px;
      z-index:2147482001; padding:4px 9px; border-radius:99px;
      font:600 10.5px/1 -apple-system, system-ui, sans-serif;
      background:rgba(20,25,40,.75); color:#fff; pointer-events:none;`;
  }

  /** Size the frame like a real device; the ghost always follows. */
  function setViewport(w) {
    viewportW = w;
    ghostWidth = w;
    if (docked) paintDesk(true);
    syncZoomBadge();
    // The ghost renders at the same viewport or the comparison lies.
    if (ghost) { setGhost(false); setFade(ghostOpacity || 1); }
    renderBar();
  }

  addEventListener('resize', () => {
    if (!docked || !FRAMED) return;
    placeAppFrame(true);
    if (hideAppOn) hideApp(true);
    syncHeadlessCover();
    syncZoomBadge();
  });

  /*
   * The desk: drafting paper, ruled faintly enough to read as texture rather
   * than as content, and tilted off square because a perfectly upright grid
   * reads as a spreadsheet.
   *
   * repeating-linear-gradient rather than a tiled background-size, because the
   * repetition runs along the gradient's own axis: it seams correctly at any
   * angle, where a 24px tile only lines up with its neighbours at multiples of
   * 90 degrees. The two rulings are one right angle apart, so the grid stays
   * square and only its orientation changes.
   */
  /*
   * The desk's look is a preference, not a truth about any blueprint — so the
   * values live in one object, are tunable from the gear in the bar, and
   * persist through the same store as every other panel choice.
   */
  const DESK_KEY = 'walkdown:desk';
  const DESK_DEFAULTS = {
    tilt: 35,     // degrees clockwise, spun within the paper's own plane
    tip: 35,      // degrees the plane leans away from the viewer
    depth: 600,   // the camera's distance; nearer converges harder
    gap: 60,      // ruling pitch on the tipped plane
    ink: 10,      // line strength, % of the theme's ink
  };
  let desk = { ...DESK_DEFAULTS };
  const DESK_SKEW = 7;     // fallback only: how far the rulings fall short of a right angle
  const line = (ink) => `color-mix(in oklch, ${ink} ${desk.ink}%, transparent)`;
  const ruling = (ink, deg, gap) =>
    `repeating-linear-gradient(${deg}deg, ${line(ink)} 0 1px, transparent 1px ${gap}px)`;

  /*
   * The fallback ruling: an affine skew painted straight onto the root. Not
   * quite a right angle, one axis breathing wider — the most a background can
   * do on its own, since gradients repeat at a fixed pitch and parallel stays
   * parallel.
   */
  const deskLines = (ink) =>
    `${ruling(ink, desk.tilt, desk.gap - 8)}, ${ruling(ink, desk.tilt + 90 - DESK_SKEW, desk.gap - 4)}`;

  /*
   * The real thing: a square grid on its own plane, tipped away from the
   * viewer in actual 3D, so the lines converge toward the horizon the way a
   * sheet on a desk does. This was never possible on the root itself — in the
   * docked layout that is the host application's own <html>, and a transform
   * there hands every fixed element in the app a new containing block — but a
   * dedicated layer transforms nothing but itself.
   *
   * The layer sits at z-index -1 as a child of the root: painted above the
   * root's own background, below the body's — so the page sheet still covers
   * it and only the desk margins show it. Oversized because a tipped plane's
   * corners pull inward; the excess keeps its edges out of the viewport.
   */
  const HAS_3D = typeof CSS !== 'undefined' &&
    CSS.supports?.('transform', 'perspective(1px) rotateX(1deg)');
  let deskEl = null;

  function drawDesk(on, ink) {
    const root = document.documentElement;
    if (!on || !HAS_3D) {
      deskEl?.remove();
      deskEl = null;
      if (on) {
        root.style.backgroundImage = deskLines(ink);
        root.style.backgroundAttachment = 'fixed';
      }
      return;
    }
    root.style.backgroundImage = 'none';
    if (!deskEl) {
      deskEl = document.createElement('div');
      deskEl.dataset.walkdownChrome = '';
      root.appendChild(deskEl);
    }
    deskEl.style.cssText = `position:fixed; left:50%; top:50%; width:320vmax; height:320vmax;
      margin:-160vmax 0 0 -160vmax; z-index:-1; pointer-events:none;
      background-image:${ruling(ink, 0, desk.gap)}, ${ruling(ink, 90, desk.gap)};
      transform:perspective(${desk.depth}px) rotateX(${desk.tip}deg) rotate(${desk.tilt}deg);`;
  }

  function paintDesk(on) {
    const root = document.documentElement, page = document.body;
    if (FRAMED) {
      // Our own document: there is no host page to inset or to put back, only
      // a desk to paint and a frame to place on it.
      const cs = getComputedStyle(side);
      const token = (n, fallback) => cs.getPropertyValue(n).trim() || fallback;
      const ink = token('--color-base-content', '#dbe7f3');
      root.style.background = token('--color-base-200', '#12283f');
      drawDesk(on, ink);
      // Whatever the page painted on <body> to avoid a white flash would sit
      // on top of the desk, so it stands down now that the desk is real.
      page.style.background = 'transparent';
      placeAppFrame(on);
      // placeAppFrame replaces the frame's whole style attribute wholesale (it
      // needs to, for the transition), which silently drops any opacity the
      // peek checkbox had set — and every dial edit repaints the desk, so a
      // peek that survived one repaint would be undone by the very next drag.
      // Re-asserting is cheap and idempotent, unlike trying to make the two
      // writers share one attribute.
      if (hideAppOn) hideApp(true);
      syncHeadlessCover();
      return;
    }
    if (!on) {
      drawDesk(false);
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
    drawDesk(true, ink);
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

  /*
   * Pin mode has one owner. Docked, that is the embed sharing this document.
   * Framed, there is no embed here — it is inside the frames — so the panel
   * owns the flag and tells them, which is the arrangement the viewer had.
   */
  let framedPinMode = false;
  const PIN = FRAMED
    ? {
        isOn: () => framedPinMode,
        set(on) { framedPinMode = on; pushContexts(); paintGhostReach(); renderBar(); },
        watch() { /* the panel is the owner; there is nobody to hear from */ },
      }
    : {
        isOn: () => window.walkdownEmbed?.isPinMode() ?? false,
        set(on) { window.walkdownEmbed?.setPinMode(on); },
        watch(fn) { window.walkdownEmbed?.watchPinMode(fn); },
      };

  let docked = false;

  function setDocked(on) {
    docked = on;
    bar.style.transform = on ? 'none' : `translateY(-${TOP}px)`;
    side.style.transform = on ? 'none' : `translateX(calc(100% + ${GAP}px))`;
    tab.style.display = on ? 'none' : 'block';
    if (!on) { deskOpen = false; syncDeskPanel(); }   // no tuner over a put-away panel
    paintDesk(on);
    // How much of the right edge the panel is occupying. The embed's badge
    // reads this so it comes to rest beside the panel instead of under it.
    // Docked, the embed's badge reads this so it comes to rest beside the panel
    // rather than under it. Framed, the embed is in another document and the
    // panel is not over it at all.
    if (!FRAMED) document.documentElement.style.setProperty('--walkdown-dock', on ? `${W + GAP * 2}px` : '0px');
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
  /*
   * Where the surface under review is. Docked that is this document's own URL;
   * framed it is the frame's, which we cannot read across origins — the copy
   * of walkdown inside it says so instead, as it loads and whenever it moves.
   */
  const hereLocation = () => (FRAMED ? locationOfUrl(frameUrl) ?? {} : location);

  function pageSurface() {
    const sc = currentScreen();
    if (!sc) return 'app';
    return matchScreen([sc], hereLocation())?.surface ?? 'app';
  }

  /** Which storyboard screen this page is, by URL — same trick the embed uses. */
  function currentScreen() {
    const screens = data?.storyboard ?? [];
    if (pickedScreen) return screens.find((s) => s.id === pickedScreen) ?? null;
    return matchScreen(screens, hereLocation())?.screen ?? null;
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
  /*
   * Both overrides answered a question about the page you were on — "this page
   * is that screen", "show me that screen's art". Carrying them across a
   * navigation would have the panel describing somewhere you have left.
   */
  function hereChanged() {
    pickedScreen = null;
    ghostOverride = null;
    if (phase !== 'ready') return;
    if (protoShare === null) setGhost(false);
    else setFade(protoShare);
    render();
  }

  let hereUrl = location.pathname + normalizeFragment(location.hash);
  function watchLocation() {
    // Framed, this document never moves — the frame does, and the copy of
    // walkdown inside it reports that itself.
    if (FRAMED) return;
    const check = () => {
      const now = location.pathname + normalizeFragment(location.hash);
      if (now === hereUrl) return;
      hereUrl = now;
      hereChanged();
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
    // The footer names the kind of work owed, matching the list's badges.
    const toSign = data.rows.filter((r) => needsYou(r.rule) && !r.built).length;
    const toWalk = data.rows.filter((r) => needsYou(r.rule) && r.built).length;
    renderBar();
    const TAB_ICON = { blueprints: 'bounding-box', rules: 'checks', screens: 'frame-corners' };
    const tab = (id, label) =>
      `<button role="tab" class="tab gap-1 px-4${listTab === id ? ' tab-active' : ''}" data-tab="${id}">
        ${icon(TAB_ICON[id], 'size-4')}${label}</button>`;
    side.innerHTML = `
      ${cfg.buildHash && data.panelHash && cfg.buildHash !== data.panelHash
        ? `<div class="shrink-0 border-b border-base-300 bg-error/10 px-3.5 py-2 text-[11.5px] leading-snug">
            walkdown was updated — <b>reload the extension</b> (chrome://extensions),
            then this page, to run the current build.</div>`
        : ''}
      <div role="tablist" class="tabs tabs-box tabs-sm m-2 shrink-0 self-center">
        ${tab('blueprints', 'Blueprints')}${tab('rules', 'Rules')}${tab('screens', 'Screens')}
      </div>
      <!-- The name stays on screen while a session runs (nobody is attributed
           silently) but editing it lives in Settings - the strip only shows it. -->
      ${session ? `<div class="flex items-center gap-2 border-b border-base-300 bg-warning/10 px-3.5 py-2 text-xs">
        <span>Recording as
          <button id="wdp-actor" class="link font-semibold" title="Change the name in Settings (the gear)">${
            esc(session.actor || 'set your name…')}</button></span>
        <span class="ml-auto">${Object.keys(session.verdicts).length} judged</span>
        <button class="btn btn-xs btn-warning" id="wdp-finish">Finish</button>
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
        <span class="ml-auto flex gap-1">
          ${toSign ? `<span class="badge badge-sm badge-warning badge-outline" title="rules owing your sign-off">${toSign} to sign</span>` : ''}
          ${toWalk ? `<span class="badge badge-sm badge-warning badge-outline" title="rules owing your walkdown">${toWalk} to walk</span>` : ''}
        </span>
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
      // Through open(), not by assigning `selected`: stepping to a rule is
      // opening it, and a second way in that skipped the trip to its screen
      // meant next/previous quietly judged whatever page you were left on.
      el.onclick = () => open(el.dataset.goto);
    });
    const actorName = host.querySelector('#wdp-actor');
    if (actorName) actorName.onclick = openActorSettings;
    const finish = host.querySelector('#wdp-finish');
    if (finish) finish.onclick = finishWalkdown;
    side.querySelectorAll('[data-tab]').forEach((b) => {
      // Back to the list as well as to the tab: the detail pane is a rule's,
      // and a rule is a thing on the Rules tab. Leaving the track slid over
      // showed the open rule sitting on top of whichever tab you picked.
      b.onclick = () => { listTab = b.dataset.tab; view = 'list'; render(); };
    });
    wireBlueprints(side);
    const reghost = () => {
      if (ghost) { setGhost(false); setFade(ghostOpacity || 1); } else render();
    };
    side.querySelectorAll('[data-screen]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.screen || null;
        ghostOverride = null;
        // "Detect from the page" is a reset, not a destination.
        if (!id) { pickedScreen = null; return reghost(); }
        if (goTo(screenById(id))) return;
        // Nowhere to go: a screen with no URL on either surface. Then the only
        // thing the picker can do is what it always did — record that this
        // page is that screen.
        pickedScreen = id;
        reghost();
      };
    });
    host.querySelectorAll('[data-goscreen]').forEach((el) => {
      el.onclick = () => goTo(screenById(el.dataset.goscreen));
    });
    wireVerdict();
    wireThreads();
    syncHeadlessCover();
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
    const pinning = PIN.isOn();
    pin.disabled = !pinSurface();
    pin.title = pinHint();
    pin.classList.toggle('btn-warning', pinning);
    pin.classList.toggle('btn-outline', !pinning);
    pin.classList.toggle('btn-primary', !pinning);
  }

  const GEAR = () =>
    `<button class="btn btn-xs btn-ghost" id="wdp-desk-btn" title="Settings">${icon('gear', 'size-3.5')}</button>`;
  const wireGear = () => {
    const gear = bar.querySelector('#wdp-desk-btn');
    if (gear) gear.onclick = () => { deskOpen = !deskOpen; syncDeskPanel(); };
  };

  function renderBar() {
    if (dragging) return paintBar();
    if (phase !== 'ready') {
      bar.innerHTML = `${GEAR()}<span class="font-bold tracking-tight">walk<span class="text-primary">down</span></span>`;
      return wireGear();
    }
    const canGhost = Boolean(ghostSource(screenById(ghostOverride) ?? currentScreen()));
    // Left is Prototype and right is App, matching the buttons on either side —
    // so the slider reads 100 at the App end and the value is inverted here.
    const share = protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
    const value = Math.round((1 - share) * 100);
    const pinning = PIN.isOn();
    bar.innerHTML = `
      ${GEAR()}
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
        ${FRAMED ? `<span class="join" title="Size the frame like a real device — the ghost always agrees">
          <button class="btn btn-xs join-item ${viewportW === 0 ? 'btn-primary' : 'btn-outline btn-primary'}" data-vp="0">Fit</button>
          <button class="btn btn-xs join-item gap-1 ${viewportW === 1440 ? 'btn-primary' : 'btn-outline btn-primary'}" data-vp="1440">${icon('desktop', 'size-3.5')}1440</button>
          <button class="btn btn-xs join-item gap-1 ${viewportW === 390 ? 'btn-primary' : 'btn-outline btn-primary'}" data-vp="390">${icon('device-mobile', 'size-3.5')}390</button>
        </span>` : ''}
        <button class="btn btn-xs gap-1 ${pinning ? 'btn-warning' : 'btn-outline btn-primary'}" id="wdp-pin"
          ${pinSurface() ? '' : 'disabled'}
          title="${esc(pinHint())}">${icon('map-pin', 'size-3.5')}Pin mode</button>
        <button class="btn btn-xs btn-primary" id="wdp-walk">${session ? 'Finish walkdown' : 'Start walkdown'}</button>
        <button class="btn btn-xs btn-ghost" id="wdp-undock" title="Put walkdown away">\u00d7</button>
      </span>`;

    wireGear();
    bar.querySelector('#wdp-undock').onclick = () => setDocked(false);
    bar.querySelector('#wdp-pin').onclick = () =>
      PIN.set(!PIN.isOn());
    bar.querySelector('#wdp-walk').onclick = () => (session ? finishWalkdown() : startWalkdown());
    bar.querySelectorAll('[data-vp]').forEach((b) => {
      b.onclick = () => setViewport(Number(b.dataset.vp));
    });
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
    if (wanted > 0 && wanted < 1 && PIN.isOn()) PIN.set(false);
    if (wanted === 0) {
      // Mid-drag the ghost stays, emptied: tearing it down calls render(), and
      // sliding back off the end would then have nothing to fade up.
      if (dragging && ghost) { ghost.style.opacity = 0; paintGhostReach(); return paintBar(); }
      return setGhost(false);
    }
    if (ghost) {
      ghost.style.opacity = wanted;
      paintGhostReach();
      pushContexts();
      renderBar();
    } else setGhost(true);
  }

  function startWalkdown() {
    // `started` marks the session so pins dropped during it can count as a
    // fail's why and ride into the run record; `threads` collects the notes
    // the feedback box files, per rule.
    session = {
      verdicts: {}, threads: {}, actor: actorOverride ?? data.identity?.actor ?? '',
      started: new Date().toISOString(),
    };
    render();
  }

  /**
   * The list glyph: SHAPE carries the lifecycle, COLOR carries ownership.
   * □ designed · ✍︎ approved, awaiting build · ✎︎ refining · ○ built,
   * awaiting verification · ✓ verified · ✗ failing. Warning tint plus the
   * right-edge badge mean the rule waits on you, and the badge names the
   * work: sign for a sign-off, walk for a walkdown. The pencils carry
   * U+FE0E - as emoji they take their own colors and the ownership channel
   * goes silent.
   */
  function ruleState(row, mine) {
    if (row.verdict === 'pass') return { glyph: '✓', cls: 'text-success', why: 'verified' };
    if (row.verdict === 'fail') return { glyph: '✗', cls: 'text-error', why: 'failing — the build was rejected' };
    const tint = mine ? 'text-warning' : 'opacity-30';
    if (!row.built) {
      if (row.signoff === 'refining')
        return { glyph: '✎︎', cls: 'text-warning', why: 'refining — sent back for spec rework' };
      if (row.signoff === 'approved')
        return { glyph: '✍︎', cls: 'opacity-60', why: 'approved — spec signed off, awaiting build' };
      return { glyph: '□', cls: tint, why: `designed — awaiting ${mine ? 'your ' : ''}sign-off` };
    }
    return { glyph: '○', cls: tint, why: mine ? 'built — awaiting your walkdown' : 'built — awaiting verification' };
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
      const picked = session?.verdicts[row.rule];
      const state = picked
        ? { glyph: { pass: '✓', fail: '✗', approved: '✍︎', refining: '✎︎' }[picked],
            cls: { pass: 'text-success', fail: 'text-error', approved: 'text-success', refining: 'text-warning' }[picked],
            why: 'judged this session' }
        : ruleState(row, mine);
      const owes = mine && !picked ? (row.built ? 'walk' : 'sign') : '';
      const short = shortName(row);
      const thr = threadsFor(row.rule).length;
      html += `<button class="flex w-full cursor-pointer items-center gap-2 px-3.5 py-1.5 text-left text-[13px] hover:bg-base-200"
        data-rule="${esc(row.rule)}" title="${esc(row.rule)} — ${esc(state.why)}">
        <span class="w-3.5 shrink-0 text-center ${state.cls}">${state.glyph}</span>
        <span class="truncate">${esc(short)}</span>
        ${owes || thr ? `<span class="ml-auto shrink-0 text-[10.5px] font-semibold text-warning">${
          owes}${thr ? ` ${thr}⚑` : ''}</span>` : ''}
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
        ${session ? `<div class="flex flex-col gap-1.5">
          <!-- The box rides ABOVE the buttons: write the why, then judge. -->
          <textarea id="wdp-vnote" class="textarea textarea-xs h-14 w-full" placeholder="${r.built
            ? 'Why? Anything written here is filed as a note with your verdict.'
            : 'What should change? Refine files this as the rule’s feedback.'}">${esc(verdictNote)}</textarea>
          ${r.built ? `<div class="flex gap-2">
            <button class="btn btn-sm flex-1 ${picked === 'pass' ? 'btn-success' : 'btn-outline btn-success'}" data-v="pass">✓ Pass</button>
            <button class="btn btn-sm flex-1 ${picked === 'fail' ? 'btn-error' : 'btn-outline btn-error'}" data-v="fail">✗ Fail</button>
          </div>` : `<div class="flex gap-2">
            <button class="btn btn-sm flex-1 ${picked === 'approved' ? 'btn-success' : 'btn-outline btn-success'}" data-v="approved">✍︎ Approve</button>
            <button class="btn btn-sm flex-1 ${picked === 'refining' ? 'btn-warning' : 'btn-outline btn-warning'}" data-v="refining">✎︎ Refine</button>
          </div>
          <div class="text-[11px] opacity-50">No build evidence yet — you are signing off the rule, not judging a build.</div>`}
          <div id="wdp-vsay" class="hidden text-[11px] text-warning"></div>
          <div class="text-[11.5px] opacity-50">${Object.keys(session.verdicts).length} judged this session</div>
        </div>` : ''}
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

  /** Where a screen lives on one surface, as a URL walkdown can navigate to. */
  function screenUrl(screen, surface) {
    if (!screen) return null;
    if (surface === 'prototype')
      return screen.prototype && data?.hasPrototype ? api('/prototype' + screen.prototype) : null;
    return screen.app?.path && data?.appBase ? data.appBase + screen.app.path : null;
  }

  /** The screen a rule is about: the end of its flow, or the one it names. */
  const ruleScreen = (r) => screenById(r?.flow?.at(-1) ?? r?.screens?.[0]);

  /**
   * Take the surface under review to a screen.
   *
   * Framed, walkdown owns the frame and simply navigates it. Docked, the page
   * belongs to the browser and this is a real navigation, which is why the
   * docked layout used to only ever offer the trip rather than make it.
   *
   * Staying on the surface you are on matters: asking for a screen while
   * looking at the design should show you the design of it. Only when that
   * surface has no URL for the screen does it cross over.
   */
  function goTo(screen, surface = pageSurface()) {
    const url = screenUrl(screen, surface)
      ?? screenUrl(screen, surface === 'app' ? 'prototype' : 'app');
    if (!url) return false;
    if (!FRAMED) { location.assign(url); return true; }
    frameUrl = url;
    appFrame.src = url;
    /*
     * Both overrides described the screen we are leaving. The frame will
     * announce where it lands and detection takes over from there.
     */
    pickedScreen = null;
    ghostOverride = null;
    if (protoShare === null) setGhost(false);
    else setFade(protoShare);
    render();
    return true;
  }

  /*
   * When a rule lives on a screen you are not looking at, say so — and, now
   * that walkdown can move the surface, offer the trip as something it will
   * actually make rather than as a link out of the tool.
   */
  const isHeadless = (r) => Boolean(r) && !r.screens?.length && !r.flow?.length;

  /*
   * Opening a headless rule clears the desk: an opaque cover in walkdown's
   * own colors takes the sheet's place, so the previous screen cannot keep
   * masquerading as the rule's. Covering rather than navigating keeps the
   * application's state intact underneath.
   */
  let headlessCover = null;
  function syncHeadlessCover() {
    const show = docked && view === 'detail' && isHeadless(selected);
    if (!show) { headlessCover?.remove(); headlessCover = null; return; }
    if (!headlessCover) {
      headlessCover = document.createElement('div');
      document.body.appendChild(headlessCover);
    }
    const cs = getComputedStyle(side);
    headlessCover.style.cssText = `position:fixed; top:${HEAD}px; left:${GAP}px;
      width:calc(100vw - ${W + GAP * 3}px); height:calc(100vh - ${HEAD + GAP}px);
      z-index:2147482000; border-radius:10px; overflow:hidden;
      background:${cs.backgroundColor}; color:${cs.color};
      box-shadow:0 1px 2px rgba(0,0,0,.28), 0 12px 32px rgba(0,0,0,.34);
      display:flex; align-items:center; justify-content:center; text-align:center;
      font:13px/1.6 system-ui, sans-serif;`;
    // cssText above is wholesale, so the peek's dimming must be re-said here
    // or a repaint mid-peek snaps the cover back to full strength.
    headlessCover.style.opacity = hideAppOn ? '0.1' : '';
    headlessCover.innerHTML = `<div style="max-width:26rem; padding:2rem; opacity:.9">
      <div style="font-size:15px; font-weight:700; margin-bottom:.5rem">No screen belongs to this rule</div>
      It is judged by its checks and recorded behavior, not by looking.<br>
      The page you were reviewing is untouched underneath.</div>`;
  }

  function elsewhere(r) {
    const here = currentScreen();
    const want = ruleScreen(r);
    // A headless rule must say so - otherwise whatever is on the desk reads
    // as the rule's screen, and it is not.
    if (!want && isHeadless(r))
      return `<div class="mt-1.5 text-[11.5px] opacity-60">Headless — no screen belongs to
        this rule, so what is on the desk is beside the point. It is judged by its
        checks and recorded behavior, not by looking.</div>`;
    if (!want || !here || want.id === here.id) return '';
    const can = Boolean(screenUrl(want, pageSurface()) ?? screenUrl(want, 'app') ?? screenUrl(want, 'prototype'));
    return `<div class="mt-1.5 text-[11.5px] opacity-60">This rule is on
      <b>${esc(want.id)}</b>; you are on <b>${esc(here.id)}</b>.
      ${can ? `<button class="link link-primary" data-goscreen="${esc(want.id)}">Go there</button>` : ''}</div>`;
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
        // A picker that changes the panel and not the page is only half a
        // choice — but where to go depends on the blueprint that is still
        // loading, so it is settled there.
        jumpOnLoad = true;
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

  function sayVerdict(msg) {
    const el = host.querySelector('#wdp-vsay');
    if (!el) return toast(msg);
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  /** File the feedback box's text as a note on the rule; null on refusal. */
  async function postRuleNote(rule, body) {
    const author = (session.actor ?? '').trim() || undefined;
    const res = await fetch(api('/api/threads'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', author, body, anchor: { rule } }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { sayVerdict(out.error ?? 'note not filed'); return null; }
    return out.id;
  }

  /** A pin dropped on this rule since the session began — the other way to say why. */
  const pinnedThisSession = (rule) =>
    (data?.threads ?? []).some((t) => t.anchor?.rule === rule &&
      session?.started && String(t.created ?? '') >= session.started);

  function wireVerdict() {
    const note = host.querySelector('#wdp-vnote');
    if (note) note.oninput = () => { verdictNote = note.value; };
    host.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = async () => {
        const status = b.dataset.v;
        const rule = selected.rule;
        const text = (host.querySelector('#wdp-vnote')?.value ?? '').trim();
        // A refusal is work nobody can act on until it says why. Refine's why
        // is the text itself; a fail's may also be a pin on the page.
        if (status === 'refining' && !text)
          return sayVerdict('Refine is the feedback — write what should change first.');
        if (status === 'fail' && !text) {
          await load(); // a pin may have landed since the last paint
          if (!pinnedThisSession(rule)) {
            PIN.set(true);
            sayVerdict('A fail needs a why — write it above, or pin it on the page.');
            return;
          }
        }
        if (text) {
          const tid = await postRuleNote(rule, text);
          if (!tid) return; // the refusal is on screen; verdict stays unrecorded
          (session.threads[rule] ??= []).push(tid);
        }
        session.verdicts[rule] = status;
        verdictNote = '';
        // A pass or approval moves you on; fail and refine keep you here —
        // fail with pin mode armed so the note lands where the problem is.
        if (status === 'fail') PIN.set(true);
        if (status === 'pass' || status === 'approved') {
          const next = data.rows.find((x) => needsYou(x.rule) && !session.verdicts[x.rule]);
          if (next) { open(next.rule); load(); return; }
          view = 'list';
        }
        await load(); // pull the new thread into the lists and repaint
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
    // A double-click on Finish must not append the same record twice.
    if (session.posting) return;
    session.posting = true;
    // Each verdict carries its why: the notes the feedback box filed, plus
    // any pins dropped on the rule during this session.
    const results = Object.entries(session.verdicts).map(([rule, status]) => {
      const pins = (data?.threads ?? [])
        .filter((t) => t.anchor?.rule === rule && String(t.created ?? '') >= session.started)
        .map((t) => t.id);
      const threads = [...new Set([...(session.threads?.[rule] ?? []), ...pins])];
      return { rule, status, ...(threads.length && { threads }) };
    });
    if (!results.length) { session = null; render(); return; }
    const actor = (session.actor ?? '').trim();
    if (!actor || actor === 'agent') {
      toast('A walkdown is recorded under a person’s name — set it in Settings (the gear).');
      openActorSettings();
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
    selected = data.rows.find((r) => r.rule === ruleId) ?? selected;
    view = 'detail';
    /*
     * A walkdown is a sequence of deep links, so opening a rule goes to the
     * screen it is about — but only framed, where walkdown owns the surface
     * and moving it costs nothing. Docked, every move is a real page load that
     * takes the panel down with it, so browsing the rule list would mean
     * reloading the application on every click; there the trip stays something
     * you ask for, on the rule itself.
     *
     * Either way, never when the rule is about the screen you are already on:
     * re-navigating throws away the page's state for nothing.
     */
    const want = ruleScreen(selected);
    if (FRAMED && want && want.id !== currentScreen()?.id && goTo(want)) return;
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
    // At a preset the ghost lays out at that width too, scaling down whole
    // when the stage is narrower - the same rule the app frame follows.
    const stageW = innerWidth - (W + GAP * 3);
    const gs = ghostWidth ? Math.min(1, stageW / ghostWidth) : 1;
    if (ghostWidth) ghost.style.alignItems = 'flex-start';
    frame.style.cssText = `width:${ghostWidth ? ghostWidth + 'px' : '100%'};
      height:${gs < 1 ? 100 / gs + '%' : '100%'};
      ${gs < 1 ? `transform:scale(${gs}); transform-origin:top center;` : ''}
      max-width:${ghostWidth ? 'none' : '100%'}; max-height:${gs < 1 ? 'none' : '100%'};
      border:0; background:#fff;
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
      if (ghostOpacity === 1) PIN.set(false);
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
    Boolean(ghost) && ghostOpacity === 1 && ghostReady && PIN.isOn();

  function paintGhostReach() {
    if (ghost) ghost.style.pointerEvents = ghostHasReach() ? 'auto' : 'none';
  }

  /*
   * What the copy inside the ghost needs in order to behave: which screen it
   * is showing, which surface it counts as, whether pinning is live, and the
   * pins already on that screen. Same message the viewer sent its panes.
   */
  function pushContext(frame, surface, pinMode) {
    const sc = screenById(ghostOverride) ?? currentScreen();
    frame?.contentWindow?.postMessage({
      type: 'walkdown:context',
      screen: sc?.id ?? null,
      surface,
      pinMode,
      pins: pinsForScreen(sc?.id),
    }, '*');
  }

  /*
   * Both surfaces are told, and only one of them is armed: whichever is in
   * front. Two live pin modes would mean a click landing twice, or landing on
   * the one you are not looking at.
   */
  function pushContexts() {
    pushContext(ghostFrame(), ghostSurface(), ghostHasReach());
    if (appFrame) pushContext(appFrame, pageSurface(), PIN.isOn() && !ghostHasReach());
  }

  /** Which surface a message came from, or null if it is not one of ours. */
  function surfaceOfSource(src) {
    if (!src) return null;
    if (src === ghostFrame()?.contentWindow) return ghostSurface();
    if (appFrame && src === appFrame.contentWindow) return pageSurface();
    return null;
  }

  /*
   * Only the ghost gets to speak. This script runs inside somebody else's
   * application, which may have iframes of its own, and a message is not
   * evidence of who sent it — so anything that is not one of our own frames is
   * not walkdown talking.
   */
  addEventListener('message', async (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    const surface = surfaceOfSource(e.source);
    if (!surface) return;
    const fromGhost = e.source === ghostFrame()?.contentWindow;

    if (msg.type === 'walkdown:ready') {
      if (fromGhost) {
        ghostReady = true;
        paintGhostReach();
        pushContexts();
        return renderBar();
      }
      /*
       * The application saying where it is. Framed we cannot read that across
       * origins, and this is also how an SPA reports moving — so a hash route
       * or a pushState inside the frame re-answers which screen this is.
       */
      const moved = msg.href && msg.href !== frameUrl;
      frameUrl = msg.href ?? frameUrl;
      pushContexts();
      return moved ? hereChanged() : render();
    }
    // The ghosted surface can leave pin mode too (Escape). Pin mode has one
    // owner, so it is told rather than each side keeping its own answer.
    if (msg.type === 'walkdown:pin-mode' && msg.on === false)
      return PIN.set(false);

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
            surface,
            ...(sc && { screen: sc.id }),
          },
        }),
      }).catch(() => {});
      await load();
      pushContexts();
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
    if (jumpOnLoad) {
      jumpOnLoad = false;
      /*
       * Only when the blueprint you have just chosen says nothing about the
       * page you are on. If it does cover this page, you are already where the
       * choice meant to put you, and moving would be the panel overruling you.
       */
      const first = (data.storyboard ?? []).find((sc) => screenUrl(sc, 'app') ?? screenUrl(sc, 'prototype'));
      if (first && !currentScreen() && goTo(first)) return;
    }
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
  PIN.watch(() => {
    paintGhostReach();
    pushContexts();
    if (phase === 'ready') renderBar();
  });

  store.get(ACTOR_KEY).then((v) => {
    if (typeof v === 'string' && v.trim()) actorOverride = v.trim();
  });
  store.get(DESK_KEY).then((v) => {
    try {
      const saved = typeof v === 'string' ? JSON.parse(v) : v;
      if (!saved || typeof saved !== 'object') return;
      desk = { ...DESK_DEFAULTS, ...saved };
      if (docked) paintDesk(true);
    } catch { /* a malformed save loses to the defaults */ }
  });
  store.get(CHOICE + ':server').then((at) => { if (at) SERVER = at; }).finally(start);
})();
