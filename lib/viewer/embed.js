/* Walkdown embed — injected into prototypes and dev/staging builds.
 * Framed (inside the viewer): talks postMessage to the parent, which owns
 * screen context and persists pins. Standalone: posts straight to the local
 * Walkdown server (its own origin), which resolves the screen from the URL.
 * Never ships to production. */
(() => {
  if (window.__walkdown) return;
  window.__walkdown = true;

  const ANCHOR_ATTR = '__ANCHOR_ATTR__';
  const SERVER = new URL(document.currentScript?.src ?? 'http://localhost:4700').origin;
  const framed = window.parent !== window;

  let ctx = { screen: null, surface: null, pinMode: false, pins: [] };
  let overlay = null;

  const $anchors = () => [...document.querySelectorAll(`[${ANCHOR_ATTR}]`)];
  const anchorId = (el) => el.getAttribute(ANCHOR_ATTR);

  // --- styles -----------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .wd-hover { outline: 2px solid #2563eb !important; outline-offset: 2px; cursor: crosshair !important; }
    .wd-pinning, .wd-pinning * { cursor: crosshair !important; }
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
    .wd-badge { position: fixed; z-index: 99999; right: 10px; bottom: 10px; background: #111; color: #fff;
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
      fetch(`${SERVER}/api/threads/${pin.id}/replies`, {
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
      submitPin(el ? { element: anchorId(el), body, kind } : { position: point, body, kind });
      overlay.remove();
    };
  }

  function submitPin(pin) {
    if (framed) {
      window.parent.postMessage({ type: 'walkdown:new-pin', ...pin }, '*');
    } else {
      fetch(`${SERVER}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...pin,
          anchor: { ...(pin.element && { element: pin.element }), ...(pin.position && { position: pin.position }) },
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
      if (e.target.closest?.('.wd-pin')) return;   // clicking a pin opens its thread
      const el = e.target.closest?.(`[${ANCHOR_ATTR}]`);
      e.preventDefault();
      e.stopPropagation();
      // No anchored element under the cursor: pin the spot itself.
      openForm(el, { x: window.scrollX + e.clientX, y: window.scrollY + e.clientY });
    },
    true
  );

  function setPinMode(on) {
    ctx.pinMode = on;
    badge?.classList.toggle('wd-on', on);
    // Anywhere is pinnable, so the whole surface reads as targetable.
    document.documentElement.classList.toggle('wd-pinning', on);
    if (!on) {
      hovered?.classList.remove('wd-hover');
      overlay?.remove();
    }
  }

  // --- framed mode: context from the viewer -----------------------------------
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'walkdown:context') {
      ctx = { ...ctx, screen: msg.screen ?? ctx.screen, surface: msg.surface ?? ctx.surface, pins: msg.pins ?? [] };
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
    badge.title = 'Walkdown: toggle pin mode';
    badge.onclick = () => setPinMode(!ctx.pinMode);
    document.body.appendChild(badge);
    fetch(`${SERVER}/api/blueprint`)
      .then((r) => r.json())
      .then((data) => {
        const here = (s) => location.pathname === s || location.pathname.endsWith(s);
        const screen = data.storyboard.find((s) => (s.app?.path && here(s.app.path)) || (s.prototype && here(s.prototype)));
        if (!screen) return;
        ctx.screen = screen.id;
        ctx.pins = data.threads.filter(
          (t) => t.anchor?.screen === screen.id && !['incorporated', 'verified', 'waived'].includes(t.status)
        ).map((t) => ({ id: t.id, kind: t.kind, status: t.status, element: t.anchor?.element,
          position: t.anchor?.position, body: t.body, replies: t.replies ?? [] }));
        renderPins();
      })
      .catch(() => {}); // server not running — embed stays dormant
  }

  window.addEventListener('resize', renderPins);
  window.addEventListener('scroll', renderPins, true);
})();
