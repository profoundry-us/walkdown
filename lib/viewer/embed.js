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
  const api = (path) => {
    const bp = blueprintId();
    return SERVER + path + (bp ? (path.includes('?') ? '&' : '?') + 'bp=' + encodeURIComponent(bp) : '');
  };

  /* walkdown's own chrome, in this page and in the panel docked beside it.
     Pin mode must never treat a click on it as a place to put a pin. */
  const CHROME = '.wd-badge, .wd-form, .wd-pin, [data-walkdown-chrome]';

  let ctx = { screen: null, surface: null, pinMode: false, pins: [], viewport: null };

  // The surface's own viewport — what the document was laid out at, regardless
  // of how the viewer scaled it into a pane.
  const currentViewport = () =>
    ctx.viewport ?? { name: window.innerWidth < 768 ? 'mobile' : 'desktop', width: window.innerWidth };
  let overlay = null;

  const $anchors = () => [...document.querySelectorAll(`[${ANCHOR_ATTR}]`)];
  const anchorId = (el) => el.getAttribute(ANCHOR_ATTR);

  // --- styles -----------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .wd-hover { outline: 2px solid #2563eb !important; outline-offset: 2px; cursor: crosshair !important; }
    /* The crosshair means "this is pinnable". The pin form is ordinary UI,
       so it — and everything in it — keeps normal cursors. */
    .wd-pinning, .wd-pinning * { cursor: crosshair !important; }
    .wd-pinning .wd-form, .wd-pinning .wd-form * { cursor: auto !important; }
    .wd-pinning .wd-form button, .wd-pinning .wd-form label,
    .wd-pinning .wd-form input[type=checkbox] { cursor: pointer !important; }
    .wd-pinning .wd-form textarea { cursor: text !important; }
    .wd-pinning .wd-pin { cursor: pointer !important; }
    /* The panel and the badge are UI, not surface: they stay clickable-looking
       and, more importantly, stay clickable. */
    .wd-pinning .wd-badge, .wd-pinning [data-walkdown-chrome] { cursor: pointer !important; }
    .wd-pinning [data-walkdown-chrome] * { cursor: auto !important; }
    .wd-pin { position: absolute; z-index: 99998; width: 18px; height: 18px; border-radius: 50%;
      background: #d97706; color: #fff; font: 700 11px/18px sans-serif; text-align: center;
      box-shadow: 0 1px 4px rgba(0,0,0,.4); cursor: default; }
    .wd-form { position: absolute; z-index: 99999; background: #fff; color: #111; border: 1px solid #cbd5e1;
      border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: 10px; width: 260px;
      font: 13px/1.4 -apple-system, sans-serif; }
    .wd-form textarea { width: 100%; height: 60px; box-sizing: border-box; font: inherit; margin: 6px 0; }
    .wd-form button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid #cbd5e1;
      background: #f8fafc; cursor: pointer; }
    .wd-form button.wd-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
    /* --walkdown-dock is how wide the docked panel is, published by panel.js.
       Without it the badge sits under the panel, out of reach. */
    .wd-badge { position: fixed; z-index: 99999; bottom: 10px;
      right: calc(10px + var(--walkdown-dock, 0px)); transition: right .22s ease;
      background: #111; color: #fff;
      font: 600 12px/1 -apple-system, sans-serif; padding: 8px 12px; border-radius: 999px; cursor: pointer;
      opacity: .75; }
    .wd-badge.wd-on { background: #2563eb; opacity: 1; }`;
  document.head.appendChild(style);

  // --- pins -------------------------------------------------------------------
  function renderPins() {
    document.querySelectorAll('.wd-pin').forEach((p) => p.remove());
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
      dot.className = 'wd-pin';
      dot.textContent = pin.kind === 'question' ? '?' : '!';
      dot.title = `${pin.id} (${pin.status}): ${pin.body ?? ''}`;
      if (!el) dot.style.borderRadius = '3px';   // squared = placed by position
      dot.style.left = `${left}px`;
      dot.style.top = `${top}px`;
      dot.style.cursor = 'pointer';
      if (pin.status !== 'open') dot.style.background = '#16a34a';
      dot.onclick = (e) => {
        e.stopPropagation();
        if (framed) window.parent.postMessage({ type: 'walkdown:open-thread', id: pin.id }, '*');
        else openThreadPopover(pin, dot);
      };
      document.body.appendChild(dot);
    }
  }

  // --- standalone thread popover: read + reply (lifecycle actions live in the
  // viewer and CLI, where transitions are validated with an actor) -------------
  function openThreadPopover(pin, dot) {
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.className = 'wd-form';
    overlay.style.left = dot.style.left;
    overlay.style.top = `${parseFloat(dot.style.top) + 24}px`;
    overlay.innerHTML = `
      <b>${pin.id}</b> · ${pin.kind} · ${pin.status}<br>${pin.body ?? ''}
      ${(pin.replies ?? []).map((r) => `<div style="margin:6px 0 0 8px;border-left:2px solid #cbd5e1;padding-left:6px">
        <span style="color:#6b7280;font-size:11px">${r.author} · ${r.created}</span><br>${r.body}</div>`).join('')}
      <textarea placeholder="Reply…"></textarea>
      <button class="wd-primary">Reply</button> <button class="wd-cancel">Close</button>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.wd-cancel').onclick = () => overlay.remove();
    overlay.querySelector('.wd-primary').onclick = () => {
      const body = overlay.querySelector('textarea').value.trim();
      if (!body) return;
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
          }
        })
        .catch(() => console.warn('walkdown: server unreachable'));
    };
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
    overlay.className = 'wd-form';
    overlay.style.left = `${Math.min(at.x, window.scrollX + window.innerWidth - 290)}px`;
    overlay.style.top = `${at.y}px`;
    overlay.innerHTML = `
      <b>${el ? anchorId(el) : 'unanchored spot'}</b>
      ${el ? '' : '<div style="color:#6b7280;font-size:11px">no anchored element here — pinned by position</div>'}
      <textarea placeholder="What should change here?"></textarea>
      <label><input type="checkbox" class="wd-q"> question (not a note)</label><br><br>
      <button class="wd-primary">Pin it</button> <button class="wd-cancel">Cancel</button>`;
    document.body.appendChild(overlay);
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
          ctx.pins.push({ ...pin, id: data.id, status: 'open' });
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
    badge?.classList.toggle('wd-on', on);
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
  };

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
    window.parent.postMessage(
      { type: 'walkdown:ready', anchors: $anchors().map(anchorId), href: location.href },
      '*'
    );
  } else {
    badge = document.createElement('div');
    badge.className = 'wd-badge';
    badge.textContent = 'W pin';
    badge.title = 'walkdown: toggle pin mode';
    badge.onclick = () => setPinMode(!ctx.pinMode);
    document.body.appendChild(badge);
    // After the document is parsed: the pins need the anchored elements to
    // position against, and blueprintId() needs to be able to see a sibling
    // walkdown tag further down the page.
    const start = () => fetch(api('/api/blueprint'))
      .then((r) => r.json())
      .then((data) => {
        const here = (s) => location.pathname === s || location.pathname.endsWith(s);
        const screen = data.storyboard.find((s) => (s.app?.path && here(s.app.path)) || (s.prototype && here(s.prototype)));
        if (!screen) return;
        ctx.screen = screen.id;
        ctx.pins = data.threads.filter(
          (t) => t.anchor?.screen === screen.id && !['incorporated', 'verified', 'waived'].includes(t.status)
        ).map((t) => ({ id: t.id, kind: t.kind, status: t.status, element: t.anchor?.element,
          position: t.anchor?.position, surface: t.anchor?.surface, viewport: t.anchor?.viewport,
          body: t.body, replies: t.replies ?? [] }));
        renderPins();
      })
      .catch(() => {}); // server not running — embed stays dormant
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  window.addEventListener('resize', renderPins);
  window.addEventListener('scroll', renderPins, true);
})();
