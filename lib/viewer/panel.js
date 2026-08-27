/* walkdown panel — the reviewer's chrome around the app under review.
 *
 * Loaded into walkdown's own page: the browser extension's, or the one
 * `walkdown serve` puts at /. The application lives in a frame inside it,
 * because a frame is a viewport of its own — the app's modals lay out against
 * the sheet rather than over the tool, and the `inert` a native <dialog>
 * imposes stops at the frame's edge. The prototype has no permanent seat; it
 * ghosts over the frame on demand.
 *
 * Until 2026-08-26 there was a second layout, docked into the application's own
 * document by a script tag. It is gone, and so is everything it needed to
 * survive in a page it did not own: the climb into the browser's top layer, the
 * reset for inherited host CSS, the inset-and-restore of somebody else's body.
 *
 * Everything the panel draws still lives in a SHADOW ROOT, because the panel is
 * not the only thing in this document — Tailwind's preflight would restyle the
 * host page's own markup, and the extension's page is not always bare. The few
 * elements that must sit outside it — the shell, the reopen tab, the ghost
 * stage — carry inline styles.
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
   * Whether this delivery comes back after a real page load. The extension
   * says so, because its content script runs on every page; a script tag
   * cannot, because the navigation unloads it. It decides whether a trip the
   * panel wants to make is taken or merely offered.
   */
  const REINJECTS = cfg.reinjects === true;
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
   * walkdown owns the document and the application is a frame inside
   * it. A frame is a viewport of its own, so the app's modals are laid out
   * against the sheet, nothing it draws can paint over the tool, and inert
   * stops at the frame boundary. The extension delivers this one, because
   * putting a page in a frame it refuses is something only an extension can do.
   */
  /*
   * The panel reviews a page by framing it, and a page cannot frame itself - so
   * there is always a frame, and whoever started us said which. The extension's
   * bootstrap and walkdown's own review page both refuse to load us without one.
   */
  if (!cfg.frame?.url) {
    console.warn('[walkdown] no page to review — the panel needs a frame url');
    return;
  }
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
  let listTab = 'rules';   // blueprints | rules | threads — what the side lists
  /*
   * Which threads the Threads tab is showing. The same three questions
   * `walkdown threads` answers at the command line: what is live, what is
   * waiting on me, and everything ever said. Default `active`, because that is
   * the one with work in it - `all` is for going back to a conversation that
   * ended, which is the thing that was impossible before this tab existed.
   */
  let threadFilter = 'active';   // active | you | all
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
    'caret-down': '<path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/>',
    'chats-circle': '<path d="M232.07,186.76a80,80,0,0,0-62.5-114.17A80,80,0,1,0,23.93,138.76l-7.27,24.71a16,16,0,0,0,19.87,19.87l24.71-7.27a80.39,80.39,0,0,0,25.18,7.35,80,80,0,0,0,108.34,40.65l24.71,7.27a16,16,0,0,0,19.87-19.86ZM62,159.5a8.28,8.28,0,0,0-2.26.32L32,168l8.17-27.76a8,8,0,0,0-.63-6,64,64,0,1,1,26.26,26.26A8,8,0,0,0,62,159.5Zm153.79,28.73L224,216l-27.76-8.17a8,8,0,0,0-6,.63,64.05,64.05,0,0,1-85.87-24.88A79.93,79.93,0,0,0,174.7,89.71a64,64,0,0,1,41.75,92.48A8,8,0,0,0,215.82,188.23Z"/>',
    'checks': '<path d="M149.61,85.71l-89.6,88a8,8,0,0,1-11.22,0L10.39,136a8,8,0,1,1,11.22-11.41L54.4,156.79l84-82.5a8,8,0,1,1,11.22,11.42Zm96.1-11.32a8,8,0,0,0-11.32-.1l-84,82.5-18.83-18.5a8,8,0,0,0-11.21,11.42l24.43,24a8,8,0,0,0,11.22,0l89.6-88A8,8,0,0,0,245.71,74.39Z"/>',
    'desktop': '<path d="M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24h72v16H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V200h72a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40ZM48,56H208a8,8,0,0,1,8,8v80H40V64A8,8,0,0,1,48,56ZM208,184H48a8,8,0,0,1-8-8V160H216v16A8,8,0,0,1,208,184Z"/>',
    'device-mobile': '<path d="M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16ZM72,64H184V192H72Zm8-32h96a8,8,0,0,1,8,8v8H72V40A8,8,0,0,1,80,32Zm96,192H80a8,8,0,0,1-8-8v-8H184v8A8,8,0,0,1,176,224Z"/>',
    'frame-corners': '<path d="M200,80v32a8,8,0,0,1-16,0V88H160a8,8,0,0,1,0-16h32A8,8,0,0,1,200,80ZM96,168H72V144a8,8,0,0,0-16,0v32a8,8,0,0,0,8,8H96a8,8,0,0,0,0-16ZM232,56V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56ZM216,200V56H40V200H216Z"/>',
    'gear': '<path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z"/>',
    'map-pin': '<path d="M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,206c-16.53-13-72-60.75-72-118a72,72,0,0,1,144,0C200,161.23,144.53,209,128,222Z"/>',
    'warning-fill': '<path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z"/>',
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

  /** Whether the pointer is currently holding one of our own controls. */
  let dragging = false;

  // A transparent frame over the viewport. It must NOT carry data-theme:
  // daisyUI paints background-color on every [data-theme] element, so a
  // full-viewport carrier would cover the page it is supposed to be framing.
  // The theme goes on the two opaque surfaces instead, which is where the
  // background belongs anyway.
  const host = document.createElement('div');
  host.className = 'h-full w-full text-sm';
  /*
   * The one thing a shadow root does NOT keep out: inheritance. A host page
   * with `* { letter-spacing: 3px }` - or a text-transform, or a word-spacing -
   * sets it on our shell element like any other, and it flows down into every
   * word walkdown draws. Styling `:host` cannot fix it either: for the host
   * element, the document's own rules win. So the reset lives here, on our
   * first element INSIDE the boundary, where the host page has no reach.
   */
  host.style.cssText = 'letter-spacing:normal; word-spacing:normal; text-transform:none; font-variant:normal; font-style:normal; text-indent:0; text-shadow:none; white-space:normal; word-break:normal; text-align:left; direction:ltr; text-decoration:none;';
  sr.appendChild(host);

  // The two pieces of chrome are built once and filled by render(): the docking
  // transforms live on them, and a rebuild must never throw the panel back on
  // screen after you have put it away.
  // The bar carries no surface of its own — background:transparent overrides
  // the one daisyUI paints on every [data-theme] element — so the drafting
  // grid runs unbroken behind the controls and under the panel beside them.
  const bar = document.createElement('header');
  bar.dataset.testid = 'panel.bar';
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
  deskPanel.dataset.testid = 'settings.panel';
  deskPanel.dataset.theme = 'blueprint';
  deskPanel.className = 'w-64 rounded-box border border-primary/45 bg-base-100 p-3 text-base-content shadow-xl';
  // Offset past the app's own top-left corner on purpose — flush against it
  // read as though the tuner belonged to the app's layout rather than to the
  // desk it sits on. One GAP beyond the corner on each axis, so it stands off
  // evenly rather than drifting further from one side than the other.
  deskPanel.style.cssText = `position:absolute; top:${TOP + GAP}px; left:${GAP * 2}px; display:none; pointer-events:auto;`;
  host.appendChild(deskPanel);
  let deskOpen = false;

  /*
   * Which screen this page is. It used to be a third tab in the sidebar and it
   * was never at home there: Blueprints and Rules answer "what did we agree to
   * build", and this answers "where am I standing", which is a session control
   * with a current value - the same kind of thing as the surface dial and the
   * viewport, which live in the bar. Moved there it also stops hiding its own
   * answer: the control is labelled with the screen you are on, so reading it
   * no longer costs a tab switch and a trip back.
   *
   * Built once and shown or hidden, like the tuner beside it, and positioned
   * under its own button at open time rather than at a guessed offset - the
   * bar's left side changes width with the project's name.
   */
  const screenPanel = document.createElement('div');
  screenPanel.dataset.testid = 'panel.screens-list';
  screenPanel.dataset.theme = 'blueprint';
  screenPanel.className = 'w-72 overflow-hidden rounded-box border border-primary/45 bg-base-100 py-1 text-base-content shadow-xl';
  screenPanel.style.cssText = `position:absolute; top:${TOP + GAP}px; left:${GAP * 2}px; display:none; pointer-events:auto; max-height:60vh; overflow-y:auto;`;
  host.appendChild(screenPanel);
  let screensOpen = false;

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
    const app = appFrame;
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
        <input id="wdp-set-actor" data-testid="settings.actor" class="input input-xs ml-auto w-36" value="${esc(session?.actor ?? actorOverride ?? data?.identity?.actor ?? '')}"
          title="Walkdown verdicts, sign-offs and thread actions are recorded under this name">
      </div>
      <div class="mb-2 mt-3 flex items-center gap-2 border-t border-base-300 pt-2">
        <span class="text-[12px] font-semibold">Desk ruling</span>
        <button class="btn btn-xs btn-ghost ml-auto" id="wdp-desk-reset">Reset</button>
      </div>
      ${DESK_DIALS.map((d) => `
        <label class="mb-1.5 flex items-center gap-2 text-[11.5px]">
          <span class="w-14 shrink-0 opacity-60">${d.label}</span>
          <input type="range" class="range range-xs range-primary" data-testid="settings.dials" data-k="${d.k}"
            min="${d.min}" max="${d.max}" value="${desk[d.k]}" aria-label="${d.label}">
          <span class="w-12 shrink-0 cursor-text text-right font-mono text-[10.5px] opacity-60 hover:opacity-100"
            id="wdp-desk-${d.k}" title="Click to type a value">${desk[d.k]}${d.unit}</span>
        </label>`).join('')}
      <label class="mt-1 flex items-center gap-2 text-[11.5px]">
        <input type="checkbox" class="checkbox checkbox-xs" data-testid="settings.hide" id="wdp-desk-hide" ${hideAppOn ? 'checked' : ''}>
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
      if (session) { session.actor = actorOverride; saveSession(); render(); }
    };
  }

  function syncDeskPanel() {
    if (deskOpen) buildDeskPanel();
    else hideApp(false);   // closing the tuner ends the peek, not just hides the checkbox
    deskPanel.style.display = deskOpen ? '' : 'none';
  }

  const closeDeskPanel = () => { deskOpen = false; syncDeskPanel(); };

  /*
   * The screen picker's contents are the list the Screens tab used to draw,
   * unchanged - the same radio rows, the same "Detect from the page" reset at
   * the top. It is placed under its own button because the bar's left side is
   * as wide as the project's name, and clamped to the stage so a long
   * storyboard cannot run the list off the right edge.
   */
  function syncScreenPanel() {
    if (screensOpen) {
      screenPanel.innerHTML = screensPane();
      wireScreens(screenPanel);
      const btn = bar.querySelector('#wdp-screen-btn');
      if (btn) {
        const at = btn.getBoundingClientRect();
        const wide = screenPanel.offsetWidth || 288;
        screenPanel.style.left = `${Math.max(GAP * 2, Math.min(at.left, innerWidth - wide - GAP * 2))}px`;
      }
    }
    screenPanel.style.display = screensOpen ? '' : 'none';
  }

  const closeScreenPanel = () => { screensOpen = false; syncScreenPanel(); };

  /*
   * The two popovers the bar opens — the screen picker and the desk tuner —
   * dismiss on the same gesture, so they dismiss through the same function.
   * `path` is the event's composedPath rather than e.target, because e.target
   * of an event crossing into a shadow root is retargeted to the shadow's host
   * and would see every click in the panel as "the panel", popover included.
   * Each popover's own button is excluded on purpose: its onclick already
   * toggles the flag, and closing here first would just have that reopen it a
   * moment later.
   *
   * A click on the page under review arrives with no path at all — a
   * pointerdown inside the frame never reaches this document, so the embed
   * posts `walkdown:page-click` instead (see the message handler). Nothing in
   * this document is on that path, which is exactly right: a click in the
   * application is outside both popovers.
   */
  function dismissPopovers(path = []) {
    if (screensOpen) {
      const btn = bar.querySelector('#wdp-screen-btn');
      const mine = path.includes(screenPanel) || (btn && path.includes(btn));
      if (!mine) closeScreenPanel();
    }
    if (deskOpen) {
      const gear = bar.querySelector('#wdp-desk-btn');
      const mine = path.includes(deskPanel) || (gear && path.includes(gear));
      if (!mine) closeDeskPanel();
    }
  }

  document.addEventListener(
    'pointerdown',
    (e) => { if (screensOpen || deskOpen) dismissPopovers(e.composedPath()); },
    true
  );

  /*
   * One Escape handler, doing the most local thing first: the screen picker,
   * then the desk tuner, then pin mode. Three of them side by side would each
   * fire on the same keystroke and close everything at once - and pin mode had
   * no handler here at all, which is why Escape stopped leaving it (n-0077).
   * Docked, the embed shared this document and owned that key; framed, the
   * embed is inside the frame and only hears Escape when the frame has focus,
   * so the panel has to answer for the keystrokes typed at its own chrome.
   * (A dial being edited cancels itself first - it stops the event, see above.)
   */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (screensOpen) return closeScreenPanel();
    if (deskOpen) return closeDeskPanel();
    if (PIN.isOn()) PIN.set(false);
  });

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
      // The conversation's own rules ride with the stylesheet: one shared
      // block, so a thread looks the same in the panel and in the embed.
      sheet.textContent = css + MSG.css;
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
   * Beside the tab, a way to cross between the design and what shipped without
   * opening anything (n-0072). Comparing the two is the most frequent gesture
   * there is, and with the panel put away it otherwise costs re-opening the
   * whole thing to reach the fade control - the cheapest comparison behind the
   * most expensive move. It says the surface it will take you TO, because a
   * control that names where you already are gives you nothing to act on.
   */
  const swap = document.createElement('button');
  swap.dataset.walkdownChrome = '';
  swap.dataset.testid = 'panel.tab-swap';
  swap.style.cssText = `position:fixed; right:0; top:50%; z-index:2147483000;
    background:#2b303a; color:#fff; border:0; border-radius:8px 0 0 8px; padding:9px 7px; cursor:pointer;
    font:600 10px/1 -apple-system, sans-serif; writing-mode:vertical-rl; letter-spacing:.08em; display:none;`;
  swap.onclick = () => {
    const share = protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
    setFade(share === 1 ? 0 : 1);
    paintTabs();
  };
  document.body.appendChild(swap);

  /*
   * The put-away controls, kept in step: the swap only appears when there is a
   * design on file to cross to, and it is stacked clear of the tab rather than
   * centred on top of it.
   */
  function paintTabs() {
    // Called from setDocked, which runs at boot before any blueprint is in
    // hand. Nothing here is worth an exception on the way up.
    if (!data) { swap.style.display = 'none'; return; }
    if (!docked) {
      const tabH = tab.getBoundingClientRect().height || 96;
      tab.style.transform = `translateY(calc(-50% - ${Math.round(tabH / 2) + 4}px))`;
      const canGhost = Boolean(ghostSource(screenInHand()));
      swap.style.display = canGhost ? 'block' : 'none';
      const share = protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
      const goingTo = share === 1 ? 'APP' : 'PROTOTYPE';
      swap.textContent = goingTo;
      swap.title = `Show the ${goingTo.toLowerCase()} instead`;
      const swapH = swap.getBoundingClientRect().height || 80;
      swap.style.transform = `translateY(calc(-50% + ${Math.round(swapH / 2) + 4}px))`;
    } else {
      tab.style.transform = 'translateY(-50%)';
      swap.style.display = 'none';
    }
  }

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
  const appFrame = document.createElement('iframe');
  if (appFrame) {
    appFrame.src = frameUrl;
    appFrame.dataset.testid = 'panel.app-frame';
    appFrame.setAttribute('title', 'the application under review');
    document.body.appendChild(appFrame);
  }

  /*
   * While the frame is fetching, say so. A page that takes its time leaves the
   * PREVIOUS screen on display, and a reviewer reads that as a walkdown that
   * went somewhere wrong rather than one still on its way - the slower the app,
   * the longer it lies (n-0071).
   *
   * Held back by a short delay, because a veil that flashes on every quick load
   * is its own kind of noise. Lives in the host document beside the frame, so
   * it carries its styles inline, and it is marked as walkdown's own chrome so
   * pin mode ignores it.
   */
  const VEIL_DELAY = 180;
  let veil = null;
  let veilTimer = null;
  let veilFor = null;

  function placeVeil() {
    if (!veil || !appFrame) return;
    const r = appFrame.getBoundingClientRect();
    veil.style.top = `${r.top}px`;
    veil.style.left = `${r.left}px`;
    veil.style.width = `${r.width}px`;
    veil.style.height = `${r.height}px`;
  }

  function showVeil(label) {
    if (!appFrame) return;
    if (!veil) {
      veil = document.createElement('div');
      veil.dataset.walkdownChrome = '';
      veil.dataset.testid = 'panel.frame-loading';
      veil.dataset.theme = 'blueprint';
      veil.style.cssText = `position:fixed; z-index:2147483004; border-radius:10px;
        display:flex; align-items:center; justify-content:center; gap:.55rem;
        background:rgba(255,255,255,.82); backdrop-filter:blur(1.5px);
        font:500 13px/1.4 ui-sans-serif, system-ui, sans-serif; color:#334155;
        pointer-events:none; transition:opacity .15s ease;`;
      veil.innerHTML = `<span style="width:14px;height:14px;border:2px solid currentColor;
          border-right-color:transparent;border-radius:50%;display:inline-block;
          animation:wdspin .7s linear infinite;opacity:.65"></span><span class="wd-veil-label"></span>
        <style>@keyframes wdspin{to{transform:rotate(360deg)}}</style>`;
      document.body.appendChild(veil);
    }
    veil.querySelector('.wd-veil-label').textContent = label;
    placeVeil();
  }

  function hideVeil() {
    clearTimeout(veilTimer);
    veilTimer = null;
    veilFor = null;
    veil?.remove();
    veil = null;
  }

  /** The frame is going somewhere: promise a veil if it does not arrive fast. */
  /*
   * Short enough to read at a glance. Screen titles carry a parenthetical
   * saying which state they are - useful in a list, too long for a veil.
   */
  function screenLabel(screen) {
    const name = String(screen?.title ?? screen?.id ?? 'the page');
    const plain = name.split('(')[0].trim() || name;
    return plain.length > 38 ? `${plain.slice(0, 37)}…` : plain;
  }

  function frameLoading(url, label) {
    if (!appFrame) return;
    hideVeil();
    veilFor = url;
    veilTimer = setTimeout(() => showVeil(label), VEIL_DELAY);
  }

  if (appFrame) {
    // Whatever the frame lands on - our navigation or the app's own - the wait
    // is over. Errors never fire load, and a frame that never arrives is still
    // loading, which is what the veil should keep saying.
    appFrame.addEventListener('load', hideVeil);
  }

  /** The desk space the frame may occupy, and the scale a preset needs. */
  function frameSpace() {
    /*
     * Put away, the panel occupies nothing and the stage is the whole window.
     * Measuring as though it were still there left the design floating in a
     * box the size of the old stage, with the app showing along the edges it
     * no longer covered - which is the thing the swap beside the tab exists to
     * make easy (n-0072).
     */
    const availW = docked ? innerWidth - (W + GAP * 3) : innerWidth;
    const availH = docked ? innerHeight - (HEAD + GAP) : innerHeight;
    const scale = viewportW ? Math.min(1, availW / viewportW) : 1;
    return { availW, availH, scale };
  }

  /*
   * The ghost lies exactly where the app frame lies - it is the same sheet,
   * showing the other surface - so it is placed by the same rules and at the
   * same moments. Only the frame used to be, which is how the design ended up
   * inset over a full-bleed app.
   */
  function placeGhost(on) {
    if (!ghost) return;
    Object.assign(ghost.style, on
      ? { top: `${HEAD}px`, left: `${GAP}px`, right: `${W + GAP * 2}px`,
          bottom: `${GAP}px`, borderRadius: '10px' }
      : { top: '0px', left: '0px', right: '0px', bottom: '0px', borderRadius: '0px' });
    sizeGhost();
  }

  function placeAppFrame(on) {
    if (!appFrame) return;
    // The veil is pinned to the frame's box, so it follows every move of it.
    if (veil) requestAnimationFrame(placeVeil);
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
    const show = docked && viewportW;
    if (!show) { zoomBadge?.remove(); zoomBadge = null; return; }
    if (!zoomBadge) {
      zoomBadge = document.createElement('div');
      zoomBadge.dataset.testid = 'panel.zoom';
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
    /*
     * The ghost renders at the same viewport or the comparison lies. A preset
     * changes how the page lays out, not just how big its box is, so this is
     * one of the few things that genuinely reloads it - and the dial has to be
     * put back where it was, by its own value. Restoring from the ghost's
     * opacity instead reads the wrong number: on a page standing on the
     * prototype, full opacity means the dial is at the APP end, so handing
     * that back as the share tore the rebuilt ghost straight down again.
     */
    if (ghost) {
      const share = protoShare ?? (pageSurface() === 'prototype' ? 0 : 1);
      setGhost(false);
      setFade(share);
    }
    renderBar();
  }

  addEventListener('resize', () => {
    placeAppFrame(docked);
    placeGhost(docked);
    if (!docked) return;
    // The ghost states its size in pixels, so it has to be told about a resize
    // rather than being carried along by percentages - re-measured, not
    // rebuilt, or every drag of the window edge reloads the page inside it.
    sizeGhost();
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
      deskEl.dataset.testid = 'panel.desk';
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
    {
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
      placeGhost(on);
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
  /*
   * Pin mode has one owner and it is this panel: the embed lives in the framed
   * document and is told, never asked. (Docked, the embed shared our document
   * and owned it instead - that is gone with the layout.)
   */
  const PIN = {
    isOn: () => framedPinMode,
    set(on) { framedPinMode = on; pushContexts(); paintGhostReach(); renderBar(); },
    watch() { /* the panel is the owner; there is nobody to hear from */ },
  };

  let docked = false;

  function setDocked(on) {
    docked = on;
    bar.style.transform = on ? 'none' : `translateY(-${TOP}px)`;
    side.style.transform = on ? 'none' : `translateX(calc(100% + ${GAP}px))`;
    tab.style.display = on ? 'none' : 'block';
    // Nothing the bar opens outlives the bar: put away, neither the tuner nor
    // the screen picker has anything left to hang off.
    if (!on) { deskOpen = false; syncDeskPanel(); closeScreenPanel(); }
    paintDesk(on);
    // How much of the right edge the panel is occupying. The embed's badge
    // reads this so it comes to rest beside the panel instead of under it.
    // Docked, the embed's badge reads this so it comes to rest beside the panel
    // rather than under it. Framed, the embed is in another document and the
    // panel is not over it at all.
    /*
     * The surface you were looking at survives being put away, because the
     * swap beside the tab is there to change it. Tearing the ghost down here
     * used to mean the panel decided for you the moment you got it out of the
     * way, and put a page load between you and getting back.
     */
    paintTabs();
  }

  // ---- data -----------------------------------------------------------------
  /*
   * The walk's own work list: rules owing you a verdict, less the ones you
   * have already judged this sitting. Four copies of this predicate had grown
   * up - the footer's counts, the tab badge, the pass-advance, Continue - and
   * they only agreed by hand. One definition, and the number on the tab is by
   * construction the list Continue walks.
   */
  const owedRows = () => (data?.rows ?? []).filter(
    (r) => needsYou(r.rule) && !(session?.verdicts ?? {})[r.rule]);

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
    stream(thread, { seenAt = null, rules = [], pending = [], names = {} } = {}) {
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
        const who = this.displayName(m.author, names);
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
      return who.split(/(\s+)/).map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join('');
    },

    /**
     * The handles that resolve to a full name. The person walking down is known
     * by the identity the server reports, and the agent is always the agent -
     * beyond those two, a name is whatever it says it is, because guessing that
     * two handles are one person is how a message ends up over the wrong face.
     */
    nameMap(actor) {
      const names = { agent: 'Agent' };
      const full = String(actor ?? '').trim();
      if (!full) return names;
      const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      names[key(full)] = full;
      const first = full.split(/\s+/)[0];
      if (first && first.length > 2) names[key(first)] = full;
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
    repliesLine(thread, names = {}) {
      const replies = thread?.replies ?? [];
      const faces = this.participants(thread).slice(0, 3)
        .map((who) => this.avatar(this.displayName(who, names), 'wd-face')).join('');
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
  // --- message-stream:end ---

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
  const hereLocation = () => locationOfUrl(frameUrl) ?? {};

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
    /*
     * Arriving at the screen someone picked is not leaving it. The frame
     * announces every landing, including the one the picker asked for, so a
     * blanket reset here threw the choice away between the click and the load
     * and the radio list snapped back to Detect (n-0098). A pick survives
     * exactly as long as the page still IS that screen.
     */
    const arrived = pickedScreen && matchScreen(
      (data?.storyboard ?? []).filter((s) => s.id === pickedScreen), hereLocation())?.screen;
    pickedScreen = arrived ? pickedScreen : null;
    ghostOverride = null;
    if (phase !== 'ready') return;
    if (protoShare === null) setGhost(false);
    else setFade(protoShare);
    render();
  }

  /*
   * This document never moves - the frame does, and the copy of walkdown inside
   * it says so, which is what the `walkdown:ready` handler acts on. The docked
   * layout had to watch its own location three ways because it lived in the
   * page it was reviewing; nothing here does.
   */

  async function load() {
    const res = await fetch(api('/api/blueprint'));
    data = await res.json();
    // Re-resolve against the reloaded data: the old object is a stale copy, so
    // holding it would show yesterday's verdict and threads.
    if (selected) selected = data.rows.find((r) => r.rule === selected.rule) ?? null;
    await loadSeen();
    await restoreSession();
    render();
    // The surfaces carry the pins, so they have to hear about a thread that
    // has just ended - a verified note leaves the page it was pinned to,
    // rather than sitting there until something else happens to refresh it.
    if (phase === 'ready') pushContexts();
  }

  /**
   * Bring back an unfinished session the last page or extension unload ate.
   * The project's draft wins over the browser's copy: it is the one another
   * window, another browser, or `walkdown status` can also see, so trusting it
   * is what makes "the sitting is on disk" true rather than nearly true.
   */
  async function restoreSession() {
    if (session) return;
    const local = await store.get(SESSION_KEY()).catch(() => null);
    const saved = (data?.draft?.verdicts && data.draft) || local;
    if (saved?.verdicts && Object.keys(saved.verdicts).length)
      session = {
        verdicts: saved.verdicts, threads: saved.threads ?? {},
        actor: saved.actor ?? actorOverride ?? data?.identity?.actor ?? '',
        started: saved.started ?? new Date().toISOString(),
      };
  }

  const screenById = (id) => (data?.storyboard ?? []).find((s) => s.id === id) ?? null;

  /*
   * Where a surface goes when the page is not a screen. Without this the fade
   * control was dead everywhere except the handful of pages walkdown happens to
   * recognise - so crossing between the design and the build, the single most
   * frequent thing a reviewer does, depended on where you already were.
   */
  const defaultScreen = () =>
    screenById(data?.defaultScreen) ??
    (data?.storyboard ?? []).find((sc) => screenUrl(sc, 'app') ?? screenUrl(sc, 'prototype')) ?? null;

  /** The screen a surface control should act on: this page, or the front door. */
  const screenInHand = () => screenById(ghostOverride) ?? currentScreen() ?? defaultScreen();

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
    // The thread screen without a thread is not a screen.
    if (view === 'thread' && !openThread) view = selected ? 'detail' : 'list';
    // render() rebuilds the panel wholesale, which resets scroll. Clicking a
    // control near the bottom of a long thread would otherwise throw you back
    // to the top — so note where each pane was and put it back. Read live, not
    // from a record kept by scroll events: those fire AFTER the position has
    // already moved, so a record would sometimes be the staler of the two.
    const wasAt = [...host.querySelectorAll('.wdp-pane')].map((p) => p.scrollTop);
    // Typing must survive a repaint: a composer that loses the caret mid-reply
    // is the difference between a conversation and a form.
    const typing = sr.activeElement;
    const caret = typing?.id === 'wdp-note'
      ? { start: typing.selectionStart, end: typing.selectionEnd } : null;
    const total = data.rows.length;
    const verified = data.rows.filter((r) => r.verdict === 'pass').length;
    /*
     * A sitting's verdicts are not in the ledger until Finish, so the footer
     * used to sit frozen through the very work it is meant to be counting -
     * "23 of 83 verified" three inches under "34 judged", which reads as a
     * broken number rather than as two different facts. The work in hand is
     * now counted separately and marked as not yet recorded, and a rule judged
     * this sitting stops being listed as owed, because it is not.
     */
    const judged = new Set(Object.keys(session?.verdicts ?? {}));
    const owed = owedRows();
    const toSign = owed.filter((r) => !r.built).length;
    const toWalk = owed.filter((r) => r.built).length;
    /*
     * Threads waiting on a person - counted the way the server counts them, so
     * the badge and `walkdown status` can never disagree. It rides on the tab
     * rather than in the rules footer: it is a count of conversations, and the
     * footer beneath the rule list counts rules.
     */
    const toVerify = threadsMatching('you').length;
    renderBar();
    const onThreads = listTab === 'threads';
    const TAB_ICON = { blueprints: 'bounding-box', rules: 'checks', threads: 'chats-circle' };
    /*
     * A tab's badge is what that tab is holding for you, and the colour ranks
     * it. Warning yellow is this panel's "waiting on you" - the rule glyphs,
     * their badges and the footer all say it in that colour
     * (panel.rules.lifecycle-legible) - and it belongs to the rules a walkdown
     * would take you through, which is the work the whole tool exists to get
     * done. Threads are blue: real work, answered when you get to it, and a
     * second yellow beside the first would flatten the two into one call on
     * the eye. Nothing is drawn at zero - a badge saying none is a claim on
     * the eye that turns out to be about nothing.
     */
    const tab = (id, label, badge = 0, why = '', tone = 'badge-warning') =>
      `<button role="tab" class="tab gap-1 px-4${listTab === id ? ' tab-active' : ''}" data-tab="${id}">
        ${icon(TAB_ICON[id], 'size-4')}${label}${badge
          ? `<span class="badge badge-xs ${tone}" title="${esc(why)}">${badge}</span>`
          : ''}</button>`;
    side.innerHTML = `
      <div role="tablist" class="tabs tabs-box tabs-sm m-2 shrink-0 self-center" data-testid="panel.tabs">
        ${tab('blueprints', 'Blueprints')}${
          /*
           * What a walkdown would take you through, counted the same way
           * Continue walkdown picks the next one - rules owing you a verdict,
           * less the ones you have already judged this sitting. So the badge
           * empties as you walk, and reaching zero and the button saying there
           * is nothing left are the same fact rather than two.
           */
          tab('rules', 'Rules', toSign + toWalk,
            `${toSign + toWalk} rule${toSign + toWalk === 1 ? '' : 's'} a walkdown would take you through`
            + `${toSign ? ` — ${toSign} to sign` : ''}${toWalk ? ` — ${toWalk} to walk` : ''}`)
        }${tab('threads', 'Threads', toVerify,
          `${toVerify} thread${toVerify === 1 ? '' : 's'} awaiting your judgment`, 'badge-info')}
      </div>
      <!-- The name stays on screen while a session runs (nobody is attributed
           silently) but editing it lives in Settings - the strip only shows it. -->
      ${session ? `<div class="flex items-center gap-2 border-b border-base-300 bg-warning/10 px-3.5 py-2 text-xs" data-testid="panel.actor">
        <span>Recording as
          <button id="wdp-actor" data-testid="panel.actor-name" class="link font-semibold" title="Change the name in Settings (the gear)">${
            esc(session.actor || 'set your name…')}</button></span>
        <!-- Both halves of the same fact: how many you have judged, and how
             many the sitting has in it. The denominator is what you have done
             plus what is still owed, so it holds steady as you walk and reads
             7/7 when there is nothing left. Judging a rule that was not owed -
             one opened off the list that already passed - moves both numbers,
             which is honest: it was work the sitting did not set out to do. -->
        <span class="ml-auto" title="Judged in this sitting, of the rules owing you a verdict">${
          judged.size}/${judged.size + toSign + toWalk} judged</span>
        <!-- Carrying on lives beside the tally, because they are the same
             thought: how far you have got, and the next one. A verdict of pass
             already advances on its own; a fail parks you on the rule so you
             can pin it, and this is the way out of that - the walk's own next
             step rather than the stepper beside the back link, which reads the
             list in order and is a different journey.

             Warning yellow, outlined: it belongs to the same family as the
             walk counts it sits above and the control that ends the sitting -
             the colour this panel already uses for the work you owe. Outlined
             rather than filled because Finish walkdown is the solid one, and
             two solid yellows in view would argue about which is the act. -->
        <button class="btn btn-xs btn-outline btn-warning" data-testid="panel.continue" id="wdp-continue"
          title="Open the next rule still owing you a verdict">Continue</button>
      </div>` : ''}
      <!-- Three screens on one track — the list, the rule, and the thread, each
           one slide to the right of the last. The slot clips it, or an
           offscreen pane paints over the app instead of sliding within the
           panel. flex-[0_0_300%], not flex-1: inside a row flex slot, flex-1
           means basis 0 and collapses every pane. The thread pane manages its
           own scrolling, so its composer can stay pinned to the foot. -->
      <div class="flex min-h-0 flex-1 overflow-hidden">
        <div class="wdp-track flex min-h-0 flex-[0_0_300%] transition-transform duration-300 ease-out">
          <div class="wdp-pane flex min-h-0 w-1/3 flex-[0_0_33.3333%] flex-col overflow-y-auto"
               data-testid="${onThreads ? 'panel.threads-list' : listTab === 'rules' ? 'panel.rules-list' : 'panel.blueprints-list'}">${
            onThreads ? threadsPane()
            : listTab === 'blueprints' ? blueprintsPane()
            : listPane()}</div>
          <!-- The second pane is whatever THIS tab opens: a rule from the rule
               list, a conversation from the thread list. A tab's detail belongs
               to that tab (panel.rules.one-pane-per-tab), so the thread list
               opens into the seat beside it rather than sliding two panes over
               and flying past a rule detail nobody asked for. -->
          <div class="wdp-pane flex min-h-0 w-1/3 flex-[0_0_33.3333%] flex-col ${
               onThreads ? 'overflow-hidden' : 'overflow-y-auto'}"${
               onThreads ? ' data-testid="thread.panel"' : ''}>${
            onThreads ? threadPane() : detailPane()}</div>
          <!-- Third seat: the thread reached FROM a rule, which is a different
               trip - it keeps the rule behind it to come back to. -->
          <div class="flex min-h-0 w-1/3 flex-[0_0_33.3333%] flex-col overflow-hidden"${
               onThreads ? '' : ' data-testid="thread.panel"'}>${onThreads ? '' : threadPane()}</div>
        </div>
      </div>
      ${listTab === 'rules' ? `<div class="flex shrink-0 items-center gap-2 border-t border-base-300 px-3.5 py-2 text-xs opacity-70" data-testid="panel.counts">
        <span class="shrink-0 whitespace-nowrap"><b>${verified}/${total}</b> verified${
          judged.size ? `<b class="text-primary" title="Judged in this sitting. Nothing reaches the ledger until you press Finish walkdown."> +${judged.size}</b>` : ''}</span>
        <span class="ml-auto flex shrink-0 gap-1">
          ${toSign ? `<span class="badge badge-xs badge-warning badge-outline" title="rules owing your sign-off">${toSign} sign</span>` : ''}
          ${toWalk ? `<span class="badge badge-xs badge-warning badge-outline" title="rules owing your walkdown">${toWalk} walk</span>` : ''}
        </span>
      </div>` : ''}`;

    const track = host.querySelector('.wdp-track');
    if (track) {
      // A rebuilt element has no state to transition from, so paint where we
      // were, flush that, then move. A rAF is not enough — the browser
      // coalesces both states into one recalc and the slide is skipped.
      const AT = { list: '0%', detail: '-33.3333%', thread: onThreads ? '-33.3333%' : '-66.6667%' };
      track.style.transition = 'none';
      track.style.transform = `translateX(${AT[lastView] ?? '0%'})`;
      void track.offsetWidth;
      track.style.transition = '';
      track.style.transform = `translateX(${AT[view] ?? '0%'})`;
      lastView = view;
    }
    host.querySelectorAll('.wdp-pane').forEach((p, i) => { p.scrollTop = wasAt[i] ?? 0; });
    if (caret) {
      const note = host.querySelector('#wdp-note');
      if (note) {
        note.focus();
        note.setSelectionRange(caret.start, caret.end);
      }
    }
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
    const carryOn = host.querySelector('#wdp-continue');
    if (carryOn) carryOn.onclick = continueWalkdown;
    side.querySelectorAll('[data-tab]').forEach((b) => {
      // Back to the list as well as to the tab: the detail pane is a rule's,
      // and a rule is a thing on the Rules tab. Leaving the track slid over
      // showed the open rule sitting on top of whichever tab you picked.
      b.onclick = () => { listTab = b.dataset.tab; view = 'list'; render(); };
    });
    side.querySelectorAll('[data-tfilter]').forEach((b) => {
      // Changing which threads are listed is not opening one: back to the list,
      // or the filter would quietly re-answer a question about the thread you
      // are reading rather than about the list behind it.
      b.onclick = () => { threadFilter = b.dataset.tfilter; view = 'list'; render(); };
    });
    wireBlueprints(side);
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

  /** Where the ghost's surface lives right now, as a URL — or null if nowhere. */
  function ghostUrlNow() {
    const src = ghostSource(screenInHand());
    return src ? (src.url ?? api(src.path)) : null;
  }

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
  /** What the kept copy is showing, so a toggle can reuse it and a change cannot. */
  let ghostSrc = null;

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
    `<button class="btn btn-xs btn-ghost" id="wdp-desk-btn" data-testid="panel.desk-tuner" title="Settings">${icon('gear', 'size-3.5')}</button>`;
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
    const canGhost = Boolean(ghostSource(screenInHand()));
    // Left is Prototype and right is App, matching the buttons on either side —
    // so the slider reads 100 at the App end and the value is inverted here.
    const share = protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
    const value = Math.round((1 - share) * 100);
    const pinning = PIN.isOn();
    const atScreen = (pickedScreen && screenById(pickedScreen)) || currentScreen();
    /*
     * Starting wears the same warning colour as finishing when there is
     * something to walk - the blueprint asking before you have asked it. With
     * nothing owed it drops back to primary: an invitation, not a summons,
     * because a control that is always loud says nothing.
     */
    const owedNow = owedRows().length;
    bar.innerHTML = `
      ${GEAR()}
      <span class="font-bold tracking-tight">walk<span class="text-primary">down</span></span>
      ${STALE_COPY()
        /*
         * A stale copy takes the blueprint's place in the bar rather than
         * sitting in the sidebar. It belongs beside the logo because it is
         * about walkdown itself, not about the project - and the sidebar could
         * be put away, while a stale panel is stale whether you are looking at
         * it or not. Loud on purpose: everything it draws underneath is being
         * judged against code that is not what shipped.
         */
        ? `<span class="badge badge-sm badge-error badge-dash gap-1 font-semibold"
             data-testid="panel.stale"
             title="walkdown was updated — reload the extension at chrome://extensions, then reload this page, to run the current build.">
             ${icon('warning-fill', 'size-3.5')}Stale — reload the extension</span>`
        : `<span class="truncate text-[11.5px] opacity-50" data-testid="panel.blueprint">${
             esc(data.project)}</span>`}
      <!-- Which screen this page is. It reads as the answer, not as a way to
           ask the question: the button is labelled with the screen you are on,
           so the common case costs no click at all. Outlined once a screen has
           been picked by hand, because a hand-picked screen outranks detection
           and the difference has to be visible from the bar. -->
      <button class="btn btn-xs shrink-0 gap-1 px-1.5 font-normal ${
          pickedScreen ? 'btn-outline btn-primary' : 'btn-ghost'}"
        id="wdp-screen-btn" data-testid="panel.screen-picker"
        title="${pickedScreen
          ? 'Screen picked by hand — open to change it, or go back to detecting from the page'
          : 'Which screen this page is, detected from its address — open to pick one by hand'}">
        ${icon('frame-corners', 'size-3.5')}<span class="max-w-32 truncate">${
          esc(atScreen ? (atScreen.title ?? atScreen.id) : 'No screen')}</span>${icon('caret-down', 'size-3')}</button>

      <span class="absolute left-1/2 flex -translate-x-1/2 items-center gap-2"
        title="${canGhost ? 'Fade between the design and what shipped' : 'No design on file for this screen'}">
        <button class="btn btn-xs btn-primary${share === 1 ? '' : ' btn-outline'}" data-surface="prototype"
          ${canGhost || pageSurface() === 'prototype' ? '' : 'disabled'}>Prototype</button>
        <input type="range" min="0" max="100" value="${value}" id="wdp-fade" data-testid="panel.fade"
          class="range range-xs range-primary w-28" ${canGhost ? '' : 'disabled'}
          aria-label="Fade between the design and the running app">
        <button class="btn btn-xs btn-primary${share === 0 ? '' : ' btn-outline'}" data-surface="app"
          ${canGhost || pageSurface() === 'app' ? '' : 'disabled'}>App</button>
      </span>

      <span class="ml-auto flex items-center gap-2">
        <!-- Icons, not numbers: a width in the button reads as a promise about
             the pixels on screen, and the frame is usually scaled to fit. The
             tooltip names the layout width, and the zoom pill says what the
             scale actually is while a preset is on. -->
        <span class="join" data-testid="panel.viewport-toggle">
          <button class="btn btn-xs join-item ${viewportW === 0 ? 'btn-primary' : 'btn-outline btn-primary'}"
            data-vp="0" title="Fit the frame to the space">Fit</button>
          <button class="btn btn-xs join-item ${viewportW === 1440 ? 'btn-primary' : 'btn-outline btn-primary'}"
            data-vp="1440" title="Desktop — lay the page out at 1440px">${icon('desktop', 'size-3.5')}</button>
          <button class="btn btn-xs join-item ${viewportW === 390 ? 'btn-primary' : 'btn-outline btn-primary'}"
            data-vp="390" title="Mobile — lay the page out at 390px">${icon('device-mobile', 'size-3.5')}</button>
        </span>
        <button class="btn btn-xs gap-1 ${pinning ? 'btn-warning' : 'btn-outline btn-primary'}" id="wdp-pin" data-testid="panel.pin-mode"
          ${pinSurface() ? '' : 'disabled'}
          title="${esc(pinHint())}">${icon('map-pin', 'size-3.5')}Pin mode</button>
        <!-- One control owns the sitting from end to end: it starts one, and
             while one runs it is how you end it. Starting in the bar and
             finishing somewhere else made the two halves of one act look like
             two unrelated buttons - and left the bar holding "Continue", which
             is not about the sitting as a whole but about the next rule in it,
             and belongs beside the count of the ones already judged. -->
        <button class="btn btn-xs ${session || owedNow ? 'btn-warning' : 'btn-primary'}" id="wdp-walk" data-testid="panel.walk"
          title="${session
            ? 'Record this sitting to the runs ledger under your name'
            : owedNow
              ? `Begin a sitting — ${owedNow} rule${owedNow === 1 ? '' : 's'} owe you a verdict`
              : 'Begin a sitting on this blueprint'}">${
          session ? 'Finish walkdown' : 'Start walkdown'}</button>
        <button class="btn btn-xs btn-ghost" id="wdp-undock" title="Put walkdown away">\u00d7</button>
      </span>`;

    wireGear();
    bar.querySelector('#wdp-screen-btn').onclick = () => {
      screensOpen = !screensOpen;
      syncScreenPanel();
    };
    bar.querySelector('#wdp-undock').onclick = () => setDocked(false);
    bar.querySelector('#wdp-pin').onclick = () =>
      PIN.set(!PIN.isOn());
    // Start it, or end it: the same button, because it is the same sitting.
    bar.querySelector('#wdp-walk').onclick = () => (session ? finishWalkdown() : startWalkdown());
    bar.querySelectorAll('[data-vp]').forEach((b) => {
      b.onclick = () => setViewport(Number(b.dataset.vp));
    });
    bar.querySelectorAll('[data-surface]').forEach((b) => {
      b.onclick = () => {
        /*
         * Off a screen entirely, fading is meaningless - there is no design of
         * THIS page to fade to. So the control takes you to the blueprint's
         * front door on the surface you asked for, which is what someone
         * pressing Prototype from nowhere in particular actually wants.
         */
        const want = b.dataset.surface;
        if (!currentScreen() && !ghostOverride) {
          const home = defaultScreen();
          const url = home && (screenUrl(home, want) ?? screenUrl(home, want === 'app' ? 'prototype' : 'app'));
          /*
           * Getting there means a real page load, so the same rule applies as
           * everywhere else: framed walkdown owns the frame and goes, the
           * extension goes because it comes back, and a script tag offers the
           * trip rather than unloading the panel that is making it.
           */
          if (url) { goTo(home, want); return; }
          if (url) {
            return toast(`Nothing here is a screen — <a class="link" href="${esc(url)}">open ${
              esc(home.title ?? home.id)}</a> to compare the ${esc(want)}.`);
          }
        }
        setFade(want === 'prototype' ? 1 : 0);
      };
    });
    const fade = bar.querySelector('#wdp-fade');
    if (fade) {
      // `input` fires all through the drag and must not disturb the element;
      // `change` fires when the pointer (or the keyboard) lets go, and that is
      // where the bar is rebuilt and a ghost at zero is finally torn down.
      fade.oninput = () => { dragging = true; setFade(1 - fade.value / 100); };
      fade.onchange = () => {
        dragging = false;
        setFade(1 - fade.value / 100);
      };
    }
  }

  /**
   * One dial, expressed as how much PROTOTYPE is on screen. The ghost carries
   * whichever surface the page is not, so the same 1 means "ghost fully on"
   * standing on the app and "ghost fully off" standing on the prototype.
   */
  function setFade(share) {
    protoShare = Math.max(0, Math.min(1, share));
    // The put-away swap names the surface it will take you to, so it follows
    // every crossing however it was made.
    if (!docked) queueMicrotask(paintTabs);
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
      /*
       * Landing on the page's own surface hides the copy rather than throwing
       * it away, so coming back is instant. The one thing that must still end
       * here is a detour to a proposal sketch: looking at a sketch is
       * temporary by rule, and a kept one would quietly return.
       */
      if (!ghost || ghostOverride) return setGhost(false);
      ghost.style.opacity = 0;
      paintGhostReach();
      pushContexts();
      return render();
    }
    // The kept copy is only reusable while it is showing what the ghost should
    // be showing. When the screen moved under it, this falls through to a
    // rebuild rather than fading up yesterday's page.
    if (ghost && ghostSrc === ghostUrlNow()) {
      ghost.style.opacity = wanted;
      paintGhostReach();
      pushContexts();
      renderBar();
    } else setGhost(true);
  }

  // An unfinished session is real judging work, so it is written down from the
  // first verdict: to the project as a draft on disk - where `walkdown status`
  // can see it and another window can pick it up - and to browser storage as
  // the copy that still works when the server is not there. Neither is the
  // ledger: a run is appended once, at Finish, and never edited.
  const SESSION_KEY = () => `walkdown:session:${BP}`;
  const sessionDraft = () => session && {
    verdicts: session.verdicts, threads: session.threads,
    actor: session.actor, started: session.started,
  };
  function saveSession() {
    const draft = sessionDraft();
    store.set(SESSION_KEY(), draft);
    // Fire and forget: a verdict must never wait on the network, and the local
    // copy already holds it if this write does not land.
    fetch(api('/api/draft'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'local', ...(draft ?? { discard: true }) }),
    }).catch(() => {});
  }

  function startWalkdown() {
    // `started` marks the session so pins dropped during it can count as a
    // fail's why and ride into the run record; `threads` collects the notes
    // the feedback box files, per rule.
    session = {
      verdicts: {}, threads: {}, actor: actorOverride ?? data.identity?.actor ?? '',
      started: new Date().toISOString(),
    };
    saveSession();
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
    if (!data.rows.length)
      return '<p class="p-3.5 text-[12.5px] opacity-40">No rules in this blueprint.</p>';
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

  /** Every check ref recorded for this rule, across targets. */
  const checkRefs = (row) =>
    [...new Set((data?.targets ?? []).flatMap((t) => row.cells?.[t]?.checks ?? []))];

  /*
   * What the rule's standing rests on: the latest ledger result for each kind
   * of evidence it asks for, who or what produced it, and when. The chain of
   * trust belongs where the rule is judged - a verdict you cannot see the
   * basis of is a verdict you have to take on faith.
   */
  function evidenceRows(row) {
    const STATE = {
      pass: ['✓', 'text-success'], fail: ['✗', 'text-error'], stale: ['~', 'text-warning'],
      approved: ['✍︎', 'text-warning'], refining: ['✎︎', 'text-warning'],
      skipped: ['–', 'opacity-50'], blocked: ['⊘', 'text-warning'], never: ['○', 'opacity-50'],
      na: ['·', 'opacity-40'],
    };
    const line = (label, cell) => {
      const [glyph, cls] = STATE[cell?.state] ?? STATE.na;
      const who = cell?.actor ? ` · ${esc(cell.actor)}` : '';
      const when = cell?.created ? ` · ${esc(MSG.ago(cell.created))}` : '';
      const said = cell?.state === 'never' ? 'never run'
        : cell?.state === 'na' ? 'not required'
        : `${esc(cell.state)}${who}${when}`;
      return `<div class="evrow" title="${esc(cell?.runId ?? '')}">
        <span class="src">${esc(label)}</span>
        <span class="${cls}">${glyph} ${said}</span></div>`;
    };
    const rows = [
      ...(row.verify.includes('checks')
        ? (data?.targets ?? []).map((t) => line(`checks/${t}`, row.cells?.[t]))
        : []),
      ...(row.verify.includes('agent') ? [line('agent', row.agent)] : []),
      ...(row.verify.includes('human') ? [line('human', row.human)] : []),
    ];
    // A rule with nothing recorded says so, rather than showing an empty box.
    return rows.length
      ? rows.join('') + (row.agent?.evidence?.length
        ? `<div class="evrow"><span class="src">screens</span><span class="opacity-60">${
          row.agent.evidence.length} from the agent's run</span></div>` : '')
      : '<div class="text-[13px] opacity-50">Nothing recorded yet.</div>';
  }

  function detailPane() {
    const r = selected;
    // A pin with no rule has no rule screen: it opens on the thread screen
    // itself, and this slot is only what slides past on the way there.
    if (!r) return `
      <div class="flex items-center px-2 pt-2">
        <button class="wdp-back btn btn-ghost btn-xs text-primary" data-testid="detail.back">← All rules</button>
      </div>
      <div class="px-3.5 pt-1 text-[12.5px] opacity-60">This thread is not attached to a rule.</div>`;
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
        <button class="${cls} btn btn-ghost btn-xs" data-testid="detail.stepper" ${row ? `data-goto="${esc(row.rule)}"` : 'disabled'}>${glyph}</button>
      </div>`;
    return `
      <div class="flex items-center px-2 pt-2">
        <button class="wdp-back btn btn-ghost btn-xs text-primary" data-testid="detail.back">← All rules</button>
        <div class="ml-auto flex gap-0.5">
          ${step(at > 0 ? data.rows[at - 1] : null, 'wdp-prev', '←', 'Previous')}
          ${step(at >= 0 && at < data.rows.length - 1 ? data.rows[at + 1] : null, 'wdp-next', '→', 'Next')}
        </div>
      </div>
      <div class="flex flex-col gap-3 px-3.5 pb-3.5 pt-1">
        <div>
          <div class="break-all font-mono text-[11px] opacity-40" data-testid="detail.rule-id">${esc(r.rule)}</div>
          <p class="text-[15px] leading-relaxed" data-testid="detail.statement">${esc(r.statement)}</p>
          ${elsewhere(r)}
        </div>
        ${session ? `<div class="flex flex-col gap-1.5">
          <!-- The box rides ABOVE the buttons: write the why, then judge. -->
          <textarea id="wdp-vnote" data-testid="detail.feedback" class="textarea textarea-xs h-14 w-full" placeholder="${r.built
            ? 'Why? Anything written here is filed as a note with your verdict.'
            : 'What should change? Refine files this as the rule’s feedback.'}">${esc(verdictNote)}</textarea>
          ${r.built ? `<div class="flex gap-2" data-testid="detail.verdict">
            <button class="btn btn-sm flex-1 ${picked === 'pass' ? 'btn-success' : 'btn-outline btn-success'}" data-v="pass">✓ Pass</button>
            <button class="btn btn-sm flex-1 ${picked === 'fail' ? 'btn-error' : 'btn-outline btn-error'}" data-v="fail">✗ Fail</button>
          </div>` : `<div class="flex gap-2" data-testid="detail.verdict">
            <button class="btn btn-sm flex-1 ${picked === 'approved' ? 'btn-success' : 'btn-outline btn-success'}" data-v="approved">✍︎ Approve</button>
            <button class="btn btn-sm flex-1 ${picked === 'refining' ? 'btn-warning' : 'btn-outline btn-warning'}" data-v="refining">✎︎ Refine</button>
          </div>
          <div class="text-[11px] opacity-50">No build evidence yet — you are signing off the rule, not judging a build.</div>`}
          <div id="wdp-vsay" data-testid="detail.say" class="hidden text-[11px] text-warning"></div>
          <div class="text-[11.5px] opacity-50" data-testid="detail.judged">${Object.keys(session.verdicts).length} judged this session</div>
        </div>` : ''}
        ${(() => {
          /*
           * A screen can be a STATE rather than an address - a filtered list,
           * an open drawer, the second time you submit the same form - and a
           * state shares its URL with the page it is a state of. Walking to a
           * rule about one navigates to that shared address and lands you on
           * the page, not in the state, so the storyboard's setup is the rest
           * of the sentence: it says what to do on arrival. Above the steps,
           * because it happens before them.
           */
          const setup = ruleScreen(r)?.app?.setup;
          return setup ? `<div>
            <div class="${LBL} mb-1.5">To get here</div>
            <div class="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[13px] leading-relaxed"
              data-testid="detail.setup">${esc(setup)}</div>
          </div>` : '';
        })()}
        ${steps ? `<div><div class="${LBL} mb-1.5">Steps</div>
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[13px] leading-relaxed"
            data-testid="detail.steps">${steps}</div>
          ${checkRefs(r).length ? `<!-- The steps are the rule; the source that checks them is a
               technical detail, so it waits behind a disclosure until asked for. -->
            <details class="mt-2 rounded border border-base-300 bg-base-200/60 px-2 py-1 text-[11.5px]"
              data-testid="detail.technical-disclosure" data-checks="${esc(r.rule)}">
              <summary class="cursor-pointer opacity-60">Check source · ${
                checkRefs(r).map((c) => esc(c)).join(', ')}</summary>
              <div class="wdp-check-src mt-1 opacity-70">Loading…</div>
            </details>` : ''}</div>` : ''}
        <div>
          <div class="${LBL} mb-1.5">Evidence</div>
          <div data-testid="detail.evidence">${evidenceRows(r)}</div>
        </div>
        <div>
          <div class="${LBL} mb-1.5">Verify</div>
          <div class="text-[13px]" data-testid="detail.verify">${esc(r.verify.join(', '))}</div>
        </div>
        ${threads.length ? `<div class="-mx-3.5" data-testid="detail.threads">
          <div class="${LBL} mb-0.5 flex items-center gap-2 px-3.5">Threads
            ${threads.filter((t) => t.status === 'addressed').length > 1
              /*
               * A rule whose fixes all landed together is verified together.
               * Going through a dozen threads one at a time is the same
               * judgment repeated, and the repetition is what makes people
               * stop reading them - so the sweep is offered where the pile is,
               * and it is still a person pressing it.
               */
              ? `<button class="btn btn-xs btn-outline btn-success ml-auto" data-verify-all="${esc(r.rule)}"
                   title="Verify every addressed thread on this rule, under your name">
                   Verify all ${threads.filter((t) => t.status === 'addressed').length}</button>`
              : ''}
          </div>
          ${threads.map(threadCard).join('')}</div>` : ''}
      </div>`;
  }

  /**
   * A thread in the detail pane. Collapsed it is a line of provenance and the
   * note; open it carries its replies, a reply box and the transitions its
   * state allows — feedback gets answered where it is read, without leaving
   * the app under review.
   */
  const CHIP = {
    open: 'badge-warning', answered: 'badge-warning', addressed: 'badge-info',
    verified: 'badge-success', incorporated: 'badge-success', waived: 'badge-ghost',
  };
  const TERMINAL = ['verified', 'incorporated', 'waived'];

  /** Who a reply and a transition are recorded as - one answer, as everywhere. */
  const whoAmI = () => (actorOverride ?? session?.actor ?? data?.identity?.actor ?? '').trim();
  /** The handles that resolve to a full name, for every message on screen. */
  const names = () => MSG.nameMap(data?.identity?.actor || whoAmI());

  /*
   * A thread, collapsed: the opening message and the way into the rest of it.
   * It reads the way a message with replies reads anywhere - a face, a name, a
   * time, what was said, and under it the people in the thread, the number of
   * replies, and when it was last touched. The count is the door; opening it
   * slides the whole conversation in beside the rule.
   */
  function threadCard(t, where = null) {
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
      where ? ` data-open-thread="${esc(t.id)}"` : ''}>
      ${where ? `<div class="mb-1 truncate text-[11px] opacity-45">${esc(where)}</div>` : ''}
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
          <div class="wd-text wd-preview">${MSG.body(t.body, { rules: (data?.rows ?? []).map((r) => r.rule) })}</div>
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
  const backFromThread = (row) =>
    (listTab === 'threads' ? 'All threads' : row ? shortName(row) : 'All rules');

  function threadPane() {
    const t = (data?.threads ?? []).find((x) => x.id === openThread);
    // Whatever became of the thread — ended, reloaded away, never there — this
    // screen is never a dead end.
    if (!t) return `
      <div class="flex items-center px-2 pt-2">
        <button class="wdp-thread-back btn btn-ghost btn-xs text-primary">← ${
          esc(backFromThread(selected))}</button>
      </div>
      <div class="px-3.5 pt-1 text-[12.5px] opacity-60">That thread is no longer open here.</div>`;
    const row = t.anchor?.rule ? data.rows.find((r) => r.rule === t.anchor.rule) : null;
    const sc = screenById(t.anchor?.screen);
    const where = [
      t.anchor?.rule ? '' : 'not attached to a rule',
      sc?.title ?? t.anchor?.screen,
      t.anchor?.element ? `<span class="font-mono">${esc(t.anchor.element)}</span>` : (t.anchor?.position ? 'by position' : ''),
      t.anchor?.viewport ? `${esc(t.anchor.viewport.name)} ${esc(String(t.anchor.viewport.width))}` : '',
    ].filter(Boolean).join(' · ');
    const sketch = ghostSource(sc);
    const acts = threadActions(t);
    const me = whoAmI();
    const ended = TERMINAL.includes(t.status) ? (t.replies ?? []).at(-1) : null;
    return `
      <div class="flex items-center gap-1 px-2 pt-2">
        <button class="wdp-thread-back btn btn-ghost btn-xs text-primary" data-testid="thread.close">← ${
          esc(backFromThread(row))}</button>
        <span class="ml-auto flex items-center gap-1 pr-1.5 text-[11px]" data-testid="thread.provenance">
          <b class="opacity-60">${esc(t.id)}</b>
          <span class="badge badge-xs ${CHIP[t.status] ?? 'badge-ghost'}">${esc(t.status)}</span>
        </span>
      </div>
      ${where ? `<div class="px-3.5 pb-1 text-[11px] opacity-45">${where}</div>` : ''}
      <div class="min-h-0 flex-1 overflow-y-auto px-3.5 pb-2" data-testid="thread.body">
        ${MSG.stream(t, {
          seenAt: seenAtOpen[t.id] ?? null,
          rules: (data?.rows ?? []).map((r) => r.rule),
          pending: pendingReplies.get(t.id) ?? [],
          names: names(),
        })}
        ${ended ? `<div class="mt-2 flex items-center gap-1.5 rounded border border-success/40 px-2 py-1 text-[11px]">
          <span class="text-success">✓</span> ${esc(t.status === 'waived' ? 'Waived' : t.status)}${
            ended.author ? ` by <b>${esc(MSG.displayName(ended.author, names()))}</b>` : ''
          } · ${esc(MSG.ago(ended.created))}</div>` : ''}
        ${sketch?.proposed ? `<button class="btn btn-xs btn-outline mt-2 w-full" data-sketch="${esc(t.anchor.screen)}">
          ⚠ View the proposed sketch</button>` : ''}
      </div>
      <!-- The composer stays put at the foot of the screen: type, press Enter,
           the message is there. The name is not asked for again — it is
           whoever you are recording as, changed in Settings like everywhere. -->
      <div class="shrink-0 border-t border-base-300 p-2">
        <textarea id="wdp-note" data-testid="thread.reply" rows="2" class="textarea textarea-xs w-full resize-none"
          placeholder="Reply…">${esc(threadNote)}</textarea>
        <div class="mt-1 flex flex-wrap items-center gap-1">
          <span class="text-[10px] opacity-40">as <button id="wdp-tactor" class="link">${
            esc(me || 'set your name…')}</button> · <b>Enter</b> sends</span>
          ${acts.map(([label, st, quiet], i) =>
            `<button class="btn btn-xs${quiet ? ' btn-ghost opacity-60' : ''}${i === 0 ? ' ml-auto' : ''}"
              data-testid="thread.actions" data-act="${esc(st)}" data-tid="${esc(t.id)}">${label}</button>`).join('')}
        </div>
        <div class="mt-1 hidden text-[11px] text-warning" data-testid="thread.say" id="wdp-tsay"></div>
      </div>`;
  }

  /*
   * Threads remember where your reading stopped, so opening one the agent has
   * replied to twice shows which part is new. `seen` is what is remembered;
   * `seenAtOpen` freezes the mark for this viewing, or the New line would
   * vanish the instant it appeared.
   */
  const SEEN_KEY = () => `walkdown:seen:${BP}`;
  let seen = {}, seenFor = null;
  /* Read marks belong to a blueprint, and the blueprint is chosen after boot -
     so they are loaded once the choice is settled, and again if it changes. */
  async function loadSeen() {
    if (seenFor === BP) return;
    seenFor = BP;
    seen = (await store.get(SEEN_KEY()).catch(() => null)) ?? {};
  }
  const seenAtOpen = {};
  /** Replies on screen before the server has answered, by thread id. */
  const pendingReplies = new Map();

  const unreadCount = (t) => {
    const at = seen[t.id];
    if (!at) return 0;
    return (t.replies ?? []).filter((r) => String(r.created ?? '') > String(at)).length;
  };

  function markSeen(id) {
    seenAtOpen[id] = seen[id] ?? null;
    seen[id] = new Date().toISOString();
    store.set(SEEN_KEY(), { ...seen });
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

  /**
   * A reply lands on screen before the server has answered - the message is
   * what you wrote, and waiting on a round trip to see it is what makes a
   * thread feel like a form. If the post is refused the message stays,
   * marked, and the text comes back to the composer so it can be sent again.
   */
  async function postReply(id, text, actor) {
    const msg = { author: actor || 'you', created: new Date().toISOString(), body: text, pending: true };
    const list = pendingReplies.get(id) ?? [];
    pendingReplies.set(id, [...list, msg]);
    threadNote = '';
    render();
    const ok = await threadPost(`/api/threads/${id}/replies`, { author: actor || undefined, body: text });
    if (ok) {
      pendingReplies.set(id, (pendingReplies.get(id) ?? []).filter((m) => m !== msg));
      // The reply is yours and you have just read it: do not mark it new.
      if (seen[id]) { seen[id] = new Date().toISOString(); store.set(SEEN_KEY(), { ...seen }); }
      await load();
    } else {
      msg.pending = false;
      msg.failed = true;
      threadNote = text;
      render();
    }
    return ok;
  }

  /** Reply and lifecycle, under the same governance the server enforces. */
  async function threadAct(id, status) {
    const t = (data.threads ?? []).find((x) => x.id === id);
    if (!t) return;
    const text = (host.querySelector('#wdp-note')?.value ?? '').trim();
    const actor = whoAmI();
    const humanOnly = status === 'verified' || status === 'waived';
    // Agents claim work; a person accepts it. The server refuses this too —
    // saying so here means you find out before you have written the reason.
    if (humanOnly && (!actor || actor === 'agent')) {
      say('Verify and waive are recorded under a person\u2019s name \u2014 set it in Settings first.');
      return openActorSettings();
    }
    if (status === '__reply') {
      if (!text) return say('Write the reply first.');
      await postReply(id, text, actor);
      return;
    }
    if (status === '__answer') {
      if (!text) return say('Write the answer first \u2014 answering a question records it.');
      if (await postReply(id, text, actor) &&
          await threadPost(`/api/threads/${id}/status`, { status: 'answered', actor })) await load();
      return;
    }
    const needsReason = status === 'waived' || status === 'open';
    if (needsReason && !text)
      return say(`${status === 'waived' ? 'Waiving' : 'Reopening'} is recorded with a reason \u2014 write it above, then press again.`);
    if (await threadPost(`/api/threads/${id}/status`,
        { status, actor, reason: needsReason ? text : undefined })) {
      threadNote = '';
      // A thread that ends leaves the active list, so its screen has nothing
      // left to show — slide back to where it came from rather than emptying
      // the pane and stranding the reader on a blank one.
      if (TERMINAL.includes(status)) {
        openThread = null;
        if (view === 'thread') view = selected ? 'detail' : 'list';
        toast(`<b>${esc(id)}</b> ${esc(status)} — it leaves the rule’s active threads.`);
      }
      await load();
    }
  }

  /*
   * Verify every addressed thread on one rule. Same governance as verifying
   * one: it is recorded under the person pressing it, and refused outright
   * without a name, because an agent may claim work and never accept it.
   */
  async function verifyAll(rule) {
    const actor = whoAmI();
    if (!actor || actor === 'agent') {
      toast('Verifying is recorded under a person\u2019s name \u2014 set it in Settings (the gear).');
      return openActorSettings();
    }
    const pending = threadsFor(rule).filter((t) => t.status === 'addressed');
    if (!pending.length) return;
    let done = 0;
    for (const t of pending)
      if (await threadPost(`/api/threads/${t.id}/status`, { status: 'verified', actor })) done += 1;
    await load();
    toast(done === pending.length
      ? `<b>${done}</b> thread${done === 1 ? '' : 's'} verified on ${esc(rule)}.`
      : `<b>${done}</b> of ${pending.length} verified \u2014 the rest are still open.`);
  }

  /** Open a thread on its own screen, landing where the reading resumes. */
  function openThreadView(id) {
    if (!(data?.threads ?? []).some((x) => x.id === id)) return toast(`No thread ${esc(id)} here.`);
    openThread = id;
    threadNote = '';
    markSeen(id);
    view = 'thread';
    render();
    // The first unread message if there is one, and otherwise the newest -
    // never the top of an exchange you have already read.
    const pane = host.querySelectorAll('.wdp-track > div')[listTab === 'threads' ? 1 : 2];
    const stream = pane?.querySelector('.overflow-y-auto');
    const mark = pane?.querySelector('.wd-new');
    if (mark) mark.scrollIntoView({ block: 'start' });
    else if (stream) stream.scrollTop = stream.scrollHeight;
  }

  function wireThreads() {
    host.querySelectorAll('[data-open-thread]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); openThreadView(el.dataset.openThread); };
    });
    const tback = host.querySelector('.wdp-thread-back');
    if (tback) tback.onclick = () => {
      const t = (data?.threads ?? []).find((x) => x.id === openThread);
      // Back where you came from: the rule, or the list for a pin that has
      // none - and on the Threads tab always the thread list, because that is
      // where you came from and no rule was ever opened.
      view = listTab !== 'threads' && t?.anchor?.rule && selected ? 'detail' : 'list';
      openThread = null;
      render();
    };
    const note = host.querySelector('#wdp-note');
    if (note) {
      note.oninput = () => { threadNote = note.value; };
      // Enter sends, Shift+Enter breaks the line - the muscle memory everyone
      // already has. The button stays for the pointer.
      note.onkeydown = (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        e.preventDefault();
        const id = openThread;
        const text = note.value.trim();
        if (id && text) threadAct(id, '__reply');
      };
    }
    // An id written in a message is a link: thread ids open that thread, rule
    // ids open that rule, so a conversation can point at things.
    host.querySelectorAll('[data-thread-ref]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.dataset.threadRef;
        const t = (data?.threads ?? []).find((x) => x.id === id);
        // Follow it to its own rule, so going back from the thread lands
        // somewhere that makes sense rather than on the rule you came from.
        if (t?.anchor?.rule) selected = data.rows.find((r) => r.rule === t.anchor.rule) ?? selected;
        openThreadView(id);
      };
    });
    host.querySelectorAll('[data-rule-ref]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); open(el.dataset.ruleRef); };
    });
    const tactor = host.querySelector('#wdp-tactor');
    if (tactor) tactor.onclick = () => openActorSettings();
    host.querySelectorAll('[data-act]').forEach((el) => {
      el.onclick = () => threadAct(el.dataset.tid, el.dataset.act);
    });
    host.querySelectorAll('[data-verify-all]').forEach((el) => {
      el.onclick = () => verifyAll(el.dataset.verifyAll);
    });
    host.querySelectorAll('[data-checks]').forEach((el) => {
      el.ontoggle = async () => {
        const slot = el.querySelector('.wdp-check-src');
        if (!el.open || !slot || slot.dataset.loaded) return;
        slot.dataset.loaded = '1';
        try {
          const res = await fetch(api(`/api/checks?rule=${encodeURIComponent(el.dataset.checks)}`));
          const out = await res.json();
          slot.innerHTML = (out.checks ?? []).map((c) => c.missing
            ? `<div class="text-warning">${esc(c.ref)} — no longer in the tree</div>`
            : `<div class="mb-1"><div class="font-mono text-[10.5px] opacity-60">${esc(c.ref)}</div>
                <pre class="overflow-x-auto whitespace-pre rounded bg-base-300/40 p-1.5 text-[10.5px] leading-snug">${
                  esc(c.source)}</pre></div>`).join('') || 'No source recorded.';
        } catch {
          slot.textContent = 'walkdown server unreachable.';
        }
      };
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
  /*
   * Whether two addresses are the same page. `bp` is walkdown's own, added on
   * the way out so a prototype page can tell which blueprint it belongs to; it
   * never distinguishes one page from another.
   */
  function sameAddress(a, b) {
    if (!a || !b) return false;
    const strip = (u) => {
      try {
        const parsed = new URL(u, location.href);
        parsed.searchParams.delete('bp');
        return parsed.href;
      } catch {
        return String(u);
      }
    };
    return strip(a) === strip(b);
  }

  /*
   * Is the copy we are running the one the server ships? Only the extension
   * can be stale — a script tag fetches the panel afresh every load — so a
   * delivery that publishes no build hash never claims to be current or not.
   */
  const STALE_COPY = () =>
    Boolean(cfg.buildHash && data?.panelHash && cfg.buildHash !== data.panelHash);

  /*
   * Go to a screen. `pick` is what the screen override should say once we are
   * there: null for every trip walkdown makes on its own (a rule's screen, the
   * blueprint's front door), and the screen's own id when a person chose it in
   * the picker - that choice outranks detection and has to survive arriving,
   * or the radio list snaps back to "Detect from the page" the moment the
   * frame lands (n-0098).
   */
  function goTo(screen, surface = pageSurface(), pick = null) {
    const url = screenUrl(screen, surface)
      ?? screenUrl(screen, surface === 'app' ? 'prototype' : 'app');
    if (!url) return false;
    /*
     * Already there. Assigning the same address is still a navigation - the
     * page reloads, scroll position and form state go, and on a slow app you
     * watch it rebuild for nothing.
     *
     * Compared without walkdown's own `bp` parameter, which we append so a
     * prototype page knows which blueprint it belongs to. It is bookkeeping,
     * not part of the page's identity, and comparing raw strings made the same
     * page look like a different one the first time we asked for it - so the
     * frame reloaded for a screen it was already showing.
     */
    if (!sameAddress(frameUrl, url)) {
      frameUrl = url;
      frameLoading(url, `Loading ${screenLabel(screen)}…`);
      appFrame.src = url;
    }
    /*
     * The screen override describes where we are going, not where we have
     * been: null for a trip walkdown decided on, and the picked id when a
     * person named the screen. The sketch override always describes the page
     * being left, so it goes either way.
     */
    pickedScreen = pick;
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
    const show = docked && view !== 'list' && isHeadless(selected);
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
          ? `<p class="mt-1.5 text-[11px] leading-relaxed opacity-50" data-testid="start.folder">Serving
              <span class="font-mono opacity-80">${esc(servedRoot)}</span> \u2014 every blueprint
              under it is listed below.</p>`
          : `<p class="mt-1.5 text-[11px] leading-relaxed opacity-40">Not connected. Run
              <code>walkdown serve</code> in the folder holding your blueprints.</p>`}
      </div>
      <div data-testid="start.options">${projects.length ? projects.map((pr) => {
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
      }).join('') : '<p class="px-3.5 py-3 text-[12.5px] opacity-40">Nothing found under that folder.</p>'}</div>`;
  }

  /** Server address and blueprint choice, wired the same wherever they appear. */
  /*
   * Offered rather than decided: a sitting is somebody's work in progress, and
   * a picker that silently discarded it - or silently carried it - would be
   * making that call for them.
   */
  function askAboutSitting(nextBp) {
    const name = projects.find((p) => p.id === nextBp)?.name ?? nextBp;
    toast(
      `A walkdown is running on <b>${esc(data.project)}</b>, with <b>${
        Object.keys(session.verdicts).length} judged</b>. It cannot come with you to ${esc(name)}.` +
      ` <button class="link" data-sitting="keep">Keep it as a draft</button>` +
      ` · <button class="link" data-sitting="discard">Discard it</button>`,
      { sticky: true, on: {
        keep: () => crossTo(nextBp),        // the draft is already on disk
        discard: async () => { await discardSitting(); crossTo(nextBp); },
      } }
    );
  }

  /** End the sitting and take nothing with it. */
  async function discardSitting() {
    session = null;
    saveSession();
    await fetch(api('/api/draft'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discard: true }),
    }).catch(() => {});
  }

  function crossTo(nextBp) {
    session = null;          // left behind, on disk, waiting to be resumed
    BP = nextBp;
    store.set(CHOICE, BP);
    listTab = 'rules';
    view = 'list';
    selected = null;
    phase = 'loading';
    jumpOnLoad = true;
    start();
  }

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
        /*
         * A walkdown belongs to the blueprint it was started in - its verdicts
         * name that blueprint's rules and nothing else. Carrying a sitting
         * across would either write those verdicts into a project they do not
         * describe or drop them on the floor, so the crossing has to be
         * settled first. The draft is already on disk, which is what makes
         * "keep it and come back" a real offer rather than a promise.
         */
        if (session && b.dataset.pick !== BP) return askAboutSitting(b.dataset.pick);
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

  /*
   * ---- the Threads tab -------------------------------------------------
   *
   * A conversation used to be reachable only through the rule it was anchored
   * to, and once it ended it was reachable nowhere at all - the panel filters
   * terminal threads out of the rule list, the pins and the counts, and gave
   * nobody a way to ask for them back. `walkdown threads --all` could show
   * them; the panel could not. This is that view (n-0094).
   *
   * The three filters are the three questions the command line already
   * answers, in the same words, so the two never disagree about what "active"
   * means.
   */
  function threadsMatching(filter) {
    const all = data?.threads ?? [];
    if (filter === 'all') return all;
    if (filter === 'you') {
      /*
       * Whose turn it is, taken from the server's attention queue rather than
       * re-derived here. A note awaiting verification and a question awaiting
       * an answer are both work for a person, and the rules for that live in
       * status.js beside every other queue - a second copy in the panel is a
       * second thing to get wrong.
       */
      const owed = new Set((data?.attention ?? [])
        .filter((i) => i.who === 'human' && i.thread).map((i) => i.thread));
      return all.filter((t) => owed.has(t.id));
    }
    return all.filter((t) => !TERMINAL.includes(t.status));
  }

  /** Last time anything was said - what a list of conversations sorts by. */
  const threadTouched = (t) => String((t?.replies ?? []).at(-1)?.created ?? t?.created ?? '');

  /** Where a thread is anchored, in words, for a list that is not scoped to one rule. */
  function threadWhere(t) {
    const a = t?.anchor ?? {};
    const sc = screenById(a.screen);
    return [
      a.rule,
      a.element ?? (sc ? (sc.title ?? sc.id) : a.screen),
    ].filter(Boolean).join(' · ') || 'not attached to anything';
  }

  function threadsPane() {
    const counts = {
      active: threadsMatching('active').length,
      you: threadsMatching('you').length,
      all: (data?.threads ?? []).length,
    };
    const list = [...threadsMatching(threadFilter)]
      .sort((a, b) => threadTouched(b).localeCompare(threadTouched(a)));
    const pick = (id, label, hint) =>
      `<button class="btn btn-xs join-item gap-1 ${threadFilter === id ? 'btn-primary' : 'btn-outline btn-primary'}"
        data-tfilter="${id}" title="${esc(hint)}">${label}<span class="opacity-60">${counts[id]}</span></button>`;
    const EMPTY = {
      active: 'No live threads. Everything said here has been answered — <b>All</b> has them.',
      you: 'Nothing is waiting on you.',
      all: 'No threads yet. Drop a pin on the page, or leave a note on a rule, to start one.',
    };
    return `
      <div class="join m-2 shrink-0 self-center" data-testid="panel.thread-filter">
        ${pick('active', 'Active', 'Questions and notes still in play')}
        ${pick('you', 'Awaiting you', 'A fix claimed and unverified, or a question unanswered — the same queue walkdown status shows')}
        ${pick('all', 'All', 'Every thread ever filed on this blueprint, ended ones included')}
      </div>
      ${list.length
        ? list.map((t) => threadCard(t, threadWhere(t))).join('')
        : `<p class="p-3.5 text-[12.5px] opacity-40">${EMPTY[threadFilter]}</p>`}`;
  }

  /**
   * Wire a rendered screen list. Lives apart from the list itself because the
   * two are now in different places: the rows are drawn into the bar's picker,
   * and picking one closes it - a chooser that stayed open over the screen it
   * just took you to would be covering its own result.
   */
  function wireScreens(root) {
    root.querySelectorAll('[data-screen]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.screen || null;
        ghostOverride = null;
        closeScreenPanel();
        const reghost = () => {
          if (ghost) { setGhost(false); setFade(ghostOpacity || 1); } else render();
        };
        // "Detect from the page" is a reset, not a destination.
        if (!id) { pickedScreen = null; return reghost(); }
        // Picked by hand, so the pick rides along and survives the arrival.
        if (goTo(screenById(id), pageSurface(), id)) return;
        // Nowhere to go: a screen with no URL on either surface. Then the only
        // thing the picker can do is what it always did — record that this
        // page is that screen.
        pickedScreen = id;
        reghost();
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
            /*
             * The refusal names both ways to give a why and switches neither
             * on. Arming pin mode here made the panel decide how you were
             * going to answer - and for a reviewer who writes rather than
             * pins, every fail left a mode behind to notice and turn off,
             * which is a tax on the commonest verdict in a hard sitting.
             */
            sayVerdict('A fail needs a why — write it above, or turn on Pin mode and drop it on the page.');
            return;
          }
        }
        if (text) {
          const tid = await postRuleNote(rule, text);
          if (!tid) return; // the refusal is on screen; verdict stays unrecorded
          (session.threads[rule] ??= []).push(tid);
          saveSession();
        }
        session.verdicts[rule] = status;
        saveSession();
        verdictNote = '';
        // A pass or approval moves you on; fail and refine keep you here, so
        // the reason can be written or pinned where the rule is. Staying put
        // is the whole of it - pin mode is a tool you reach for, not a mode a
        // verdict puts you in.
        if (status === 'pass' || status === 'approved') {
          const next = owedRows()[0];
          if (next) { open(next.rule); load(); return; }
          view = 'list';
        }
        await load(); // pull the new thread into the lists and repaint
      };
    });
  }

  /*
   * `sticky` for a toast that asks something: a question that disappears after
   * four seconds is worse than no question. `on` wires its buttons by their
   * data-sitting name, so the caller says what each choice does rather than
   * reaching back into the DOM for it.
   */
  function toast(html, { sticky = false, on = null } = {}) {
    const t = document.createElement('div');
    t.className = 'toast toast-end pointer-events-auto';
    t.dataset.theme = 'blueprint';
    t.style.right = `${W + 18}px`;
    t.innerHTML = `<div class="alert alert-neutral text-[13px]">${html}</div>`;
    if (on)
      for (const [name, fn] of Object.entries(on))
        t.querySelector(`[data-sitting="${name}"]`)?.addEventListener('click', () => {
          t.remove();
          fn();
        });
    // Onto the shell, not into the panel: render() rewrites the panel's markup
    // wholesale, and the things worth toasting - a verdict recorded, a thread
    // ended - are exactly the things that trigger a repaint, so a toast living
    // in there was swept away in the same tick it appeared.
    host.appendChild(t);
    if (!sticky) setTimeout(() => t.remove(), 4200);
  }

  /*
   * Carry on where the sitting left off: the next rule still owing a verdict.
   * A sitting resumed from disk lands here too - the draft survives crossing to
   * another blueprint and back, so "continue" is a real offer rather than a
   * word for "start over".
   */
  function continueWalkdown() {
    const next = owedRows()[0];
    if (!next) {
      view = 'list';
      render();
      return toast('Nothing left owing a verdict in this blueprint — <b>Finish walkdown</b> records the sitting.');
    }
    open(next.rule);
  }

  /** Append the session to the runs ledger — the same write the viewer makes. */
  async function finishWalkdown() {
    // A double-click on Finish must not append the same record twice - but a
    // refused or failed attempt must hand the button back, or one hiccup
    // silently bricks Finish for the rest of the session.
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
    if (!results.length) { session = null; saveSession(); render(); return; }
    const actor = (session.actor ?? '').trim();
    if (!actor || actor === 'agent') {
      session.posting = false;
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
      if (!res.ok) { session.posting = false; return toast(`Not recorded: ${esc(out.error ?? 'request failed')}`); }
      session = null;
      saveSession();
      view = 'list';
      selected = null;
      await load();
      toast(`Recorded ${results.length} verdict${results.length === 1 ? '' : 's'} as <b>${esc(out.run_id)}</b>`);
    } catch {
      session.posting = false;
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
    if (want && want.id !== currentScreen()?.id && goTo(want)) return;
    render();
  }

  /** The prototype for this screen, laid over the running app. */
  /**
   * The ghost's geometry, said outright in pixels — the stage and the framed
   * copy inside it. Kept apart from building the ghost so a window resize
   * re-measures rather than reloading the page in there.
   */
  function sizeGhost() {
    const frame = ghostFrame();
    if (!ghost || !frame) return;
    const { availW, availH } = frameSpace();
    // At a preset the ghost lays out at that width too, scaling down whole
    // when the stage is narrower - the same rule the app frame follows.
    const gs = ghostWidth ? Math.min(1, availW / ghostWidth) : 1;
    ghost.style.width = `${availW}px`;
    ghost.style.height = `${availH}px`;
    ghost.style.alignItems = ghostWidth ? 'flex-start' : 'center';
    frame.style.width = `${ghostWidth || availW}px`;
    frame.style.height = `${gs < 1 ? availH / gs : availH}px`;
    frame.style.transform = gs < 1 ? `scale(${gs})` : '';
    frame.style.transformOrigin = 'top center';
    frame.style.maxWidth = 'none';
    frame.style.maxHeight = 'none';
    frame.style.flex = 'none';
  }

  function setGhost(on) {
    if (!on) {
      ghost?.remove();
      ghost = null;
      ghostSrc = null;
      ghostReady = false;     // whatever was in there is gone with it
      ghostOverride = null;   // the detour ends with the overlay
      protoShare = null;      // and the dial goes back to following the page
      render();
      return;
    }
    const screen = screenById(ghostOverride) ?? currentScreen();
    const src = ghostSource(screen);
    if (!src) return;
    const url = src.url ?? api(src.path);
    /*
     * The copy is kept between looks. Swapping surfaces used to tear the ghost
     * down and load it again on the way back, which is a fresh page load - and
     * a visible flash - every time you compare. What actually invalidates it is
     * the source changing: another screen, another surface, a viewport preset
     * that lays the page out differently. Those all arrive here as a different
     * url or through a deliberate teardown; a plain toggle does not, so a
     * plain toggle is now instant. The page in there is as old as the last
     * load, which is the trade: a reload of walkdown refreshes it.
     */
    if (ghost && ghostSrc === url) {
      sizeGhost();
      ghost.style.opacity = ghostOpacity;
      paintGhostReach();
      render();
      return;
    }
    ghost?.remove();
    ghostReady = false;
    ghostSrc = url;
    // The stage owns the opacity so the backdrop fades with the prototype: at
    // full strength the app is properly covered, not blended into. The
    // checkerboard says "nothing is here" where the prototype does not reach,
    // so an uncovered strip never reads as design. Inline styles: this element
    // is in the host document, where our stylesheet has no reach.
    ghost = document.createElement('div');
    /*
     * The box is stated in pixels, not left to the four insets to work out.
     * This element is promoted into the top layer, where the UA's own popover
     * rules give it fit-content sizing, and it lives in a page we know nothing
     * about — either can leave an inset-sized box collapsed, and a collapsed
     * ghost shows a corner of the design over a full-size app, which reads as
     * the design being cut off. The app frame has always said its size
     * outright for the same reason; so does this now.
     */
    const box = frameSpace();
    /*
     * No z-index of its own, on purpose. It used to carry one from when it was
     * an overlay in the host document, and inside the shadow root that number
     * stopped meaning "above the app" - the app frame is in the page, and the
     * shell that holds this is in the top layer above all of it - and started
     * meaning "above walkdown's own chrome". The bar's popovers (the screen
     * picker, the desk tuner) hang off an unpositioned wrapper and paint at
     * z-index auto and a ghost at 2147482000 buried them: the picker opened
     * under the design and reads as a button that does nothing (n-0107).
     * Left to auto, painting follows DOM order inside the root - ghost first,
     * chrome after - which is the ordering the insert below is written for.
     */
    ghost.style.cssText = `position:fixed; top:${HEAD}px; left:${GAP}px; bottom:${GAP}px;
      right:${W + GAP * 2}px; border-radius:10px; overflow:hidden;
      width:${box.availW}px; height:${box.availH}px; max-width:none; max-height:none;
      min-width:0; min-height:0; margin:0; border:0; padding:0;
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
    frame.style.cssText = `border:0; background:#fff;
      box-shadow:0 0 0 1px rgba(20,25,40,.14), 0 10px 40px rgba(20,25,40,.18);`;
    frame.src = url;
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
    // Built while the panel is put away, it must be built full-bleed: the box
    // stated at creation is the docked one.
    placeGhost(docked);
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
    /*
     * Into the panel's own shadow root, ahead of the chrome, rather than into
     * the page beside it. The ghost still has to clear the app's modals, which
     * live in the top layer - but the shell is already up there, so riding
     * inside it gets the same height for free, and DOM order keeps the chrome
     * above the design it is ghosting - which is now plain DOM order inside
     * one shadow root, rather than an ordering in the browser's top layer.
     * When it was the latter, promoting two elements in sequence left the
     * panel's rule list unable to receive a wheel event at all until a reload
     * (n-0086), and a fade slider dying mid-drag was the same failure (n-0068).
     */
    sr.insertBefore(ghost, host);
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
        offset: t.anchor?.offset,
        position: t.anchor?.position, surface: t.anchor?.surface, viewport: t.anchor?.viewport,
        // What it is about, for the tooltip: a pin should say where it belongs
        // before you spend a click finding out.
        rule: t.anchor?.rule ?? null, screen: t.anchor?.screen ?? null,
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

    /*
     * A pointer went down on the page under review. That event is the frame's
     * and never reaches this document, so the embed relays it; from here it is
     * an outside click like any other, and goes through the same dismissal.
     * Pin mode is deliberately untouched: it is a mode you work in, and every
     * click while pinning happens on the page.
     */
    if (msg.type === 'walkdown:page-click') return dismissPopovers();

    if (msg.type === 'walkdown:open-thread') {
      openThread = msg.id;
      markSeen(msg.id);
      view = 'thread';
      const t = (data?.threads ?? []).find((x) => x.id === msg.id);
      const row = t?.anchor?.rule ? data.rows.find((r) => r.rule === t.anchor.rule) : null;
      // The rule behind it, when it has one, so going back from the thread
      // lands on it. A pin with no rule still opens - the thread screen is
      // about the thread, not about what it happens to be attached to.
      selected = row ?? null;
      return render();
    }

    if (msg.type === 'walkdown:new-pin') {
      const sc = screenById(ghostOverride) ?? currentScreen();
      await fetch(api('/api/threads'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: msg.kind, body: msg.body,
          ...(msg.author && { author: msg.author }),
          anchor: {
            ...(msg.element && { element: msg.element }),
            // The spot within the element, and the spot on the surface: both
            // travel, so an anchored pin still draws where it was put.
            ...(msg.offset && { offset: msg.offset }),
            ...(msg.position && { position: msg.position }),
            ...(msg.viewport && { viewport: msg.viewport }),
            surface,
            ...(sc && { screen: sc.id }),
            // A pin dropped while a rule is open is feedback on that rule -
            // the linkage the fail gate and the rule's thread list live on.
            ...(view !== 'list' && selected && { rule: selected.rule }),
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
    /*
     * Ask the page first. A blueprint that claims this address is a fact about
     * where you are; a remembered choice is a fact about what you picked last,
     * somewhere else. Preferring memory is what made walkdown open its own
     * rules on somebody else's app and then stay there.
     *
     * A page belongs to exactly one blueprint, which is the constraint that
     * lets this be an answer rather than a guess - `walkdown claims` is what
     * keeps it true.
     */
    if (!BP && projects.length > 1) {
      try {
        // Framed, the page under review is the one in the frame, not walkdown's
        // own address — asking about ourselves would answer about nothing.
        const asking = frameUrl;
        const whose = asking
          ? await (await fetch(api(`/api/whose?url=${encodeURIComponent(asking)}`))).json()
          : null;
        if (whose?.match?.id && projects.some((pr) => pr.id === whose.match.id)) BP = whose.match.id;
      } catch { /* the server is old or unreachable; memory and the picker remain */ }
    }
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
    await loadSeen();
    await restoreSession();
    if (jumpOnLoad) {
      jumpOnLoad = false;
      /*
       * Only when the blueprint you have just chosen says nothing about the
       * page you are on. If it does cover this page, you are already where the
       * choice meant to put you, and moving would be the panel overruling you.
       */
      const first = (data.storyboard ?? []).find((sc) => screenUrl(sc, 'app') ?? screenUrl(sc, 'prototype'));
      if (first && !currentScreen()) {
        /*
         * Three deliveries, two answers. Framed, walkdown owns the frame and
         * can simply take you there. Docked BY THE EXTENSION it can go too:
         * the content script matches every URL, so walkdown is waiting on the
         * other side. Docked by a script tag it cannot - navigating unloads
         * the very script drawing this panel, and you would arrive at the
         * other site with no walkdown at all, which is what used to happen.
         * Only that last case offers the trip instead of taking it.
         */
        if (goTo(first)) return;
      }
    }
    render();
    /*
     * And tell the surfaces, exactly as a reload does. The frame announces
     * itself the moment it lands, which is well before this first fetch comes
     * back - so every context pushed from that announcement carried no
     * storyboard, no screen, and therefore no pins, and nothing pushed one
     * again. The page under review sat there with its pins invisible until
     * something unrelated happened to repaint them.
     */
    pushContexts();
  }

  /** The two screens that come before there is anything to review. */
  function renderGate() {
    renderBar();
    if (phase === 'connect') {
      side.innerHTML = `
        <div class="flex flex-1 flex-col justify-center gap-3 p-5">
          <div class="flex flex-col gap-3" data-testid="start.message">
            <div class="text-[15px] font-semibold">No blueprints open</div>
            <p class="text-[12.5px] leading-relaxed opacity-60">A browser tab cannot read your
              filesystem, and walkdown both reads blueprints and writes threads and run records back
              to them. So it works through a small local server, which is the thing that actually
              holds the folder open.</p>
            <p class="text-[12.5px] leading-relaxed opacity-60">In the directory holding your
              blueprints, run:</p>
          </div>
          <code class="rounded-box bg-base-200 px-3 py-2 text-[12px]">walkdown serve</code>
          <div class="flex items-center gap-2">
            <input id="wdp-server" data-testid="start.server" class="input input-sm flex-1" value="${esc(SERVER)}"
                   aria-label="walkdown server address">
            <button class="btn btn-sm btn-primary" id="wdp-retry" data-testid="start.connect">Connect</button>
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
  // Pin mode has one owner — the embed. The bar mirrors it rather than keeping
  // a second copy that Escape would have to remember to update.
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
