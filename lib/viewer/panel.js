/* Walkdown panel — the reviewer's chrome, docked beside the REAL app.
 *
 * Proof of concept. Include it in a dev build next to the embed:
 *   <script src="http://localhost:4700/panel.js" data-bp="example/blueprint"></script>
 *
 * Unlike the viewer, nothing here frames the app: the page runs in its own
 * tab at its own viewport, and the panel docks alongside it. The prototype
 * has no permanent seat — it ghosts over the page on demand.
 */
(() => {
  if (window.__walkdownPanel) return;
  window.__walkdownPanel = true;

  const script = document.currentScript;
  const SERVER = new URL(script?.src ?? 'http://localhost:4700').origin;
  const BP = script?.dataset.bp || '';
  const api = (path) => SERVER + path + (BP ? (path.includes('?') ? '&' : '?') + 'bp=' + encodeURIComponent(BP) : '');

  const W = 384;
  let data = null, view = 'list', selected = null, session = null, ghost = null, ghostOpacity = 0.5;
  let pickedScreen = script?.dataset.screen || null;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- chrome ---------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .wdp-host { position: fixed; top: 0; right: 0; bottom: 0; width: ${W}px; z-index: 2147483000;
      background: #fff; border-left: 1px solid #d3d6db; box-shadow: -2px 0 12px rgba(20,25,40,.06);
      font: 14px/1.45 -apple-system, "Segoe UI", sans-serif; color: #16181d;
      display: flex; flex-direction: column; transition: transform .22s ease; }
    .wdp-host.wdp-hidden { transform: translateX(100%); }
    .wdp-head { display: flex; align-items: center; gap: 9px; padding: 11px 14px; border-bottom: 1px solid #e5e7eb; }
    .wdp-logo { font-weight: 700; font-size: 13.5px; }
    .wdp-logo span { color: #16a34a; }
    .wdp-muted { color: #6b7280; font-size: 11.5px; }
    .wdp-x { margin-left: auto; border: 0; background: none; cursor: pointer; color: #9ca3af; font-size: 16px; padding: 0 2px; }
    .wdp-queue { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
    .wdp-pill { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: #fdf6e8;
      border: 1px solid #d97706; color: #d97706; font-weight: 600; margin-left: auto; }
    /* two panes on one track — the slide between list and detail */
    .wdp-track { flex: 1; display: flex; width: 200%; min-height: 0; transition: transform .26s cubic-bezier(.4,0,.2,1); }
    .wdp-track.wdp-detail { transform: translateX(-50%); }
    .wdp-pane { width: 50%; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
    .wdp-story { padding: 10px 14px 3px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; color: #9ca3af; }
    .wdp-rule { display: flex; gap: 8px; align-items: center; padding: 7px 14px; cursor: pointer; font-size: 13px; border: 0; background: none; width: 100%; text-align: left; font-family: inherit; }
    .wdp-rule:hover { background: #f5f6f8; }
    .wdp-glyph { width: 13px; text-align: center; flex: 0 0 auto; }
    .wdp-pass { color: #16a34a; } .wdp-fail { color: #dc2626; } .wdp-pending { color: #c6ccd4; }
    .wdp-mine { color: #d97706; }
    .wdp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wdp-tag { margin-left: auto; font-size: 10.5px; color: #d97706; font-weight: 600; flex: 0 0 auto; }
    .wdp-back { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; cursor: pointer;
      color: #2563eb; font: inherit; font-size: 12.5px; padding: 11px 14px 4px; }
    .wdp-body { padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 13px; }
    .wdp-rid { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #9ca3af; word-break: break-all; }
    .wdp-stmt { font-size: 15px; line-height: 1.5; margin: 0; }
    .wdp-verdict { display: flex; gap: 7px; }
    .wdp-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 8px 0; font: inherit; font-size: 13px; font-weight: 600; border-radius: 8px; cursor: pointer;
      border: 1px solid #e5e7eb; background: #fff; }
    .wdp-btn.wdp-p { border-color: #16a34a; background: #16a34a; color: #fff; }
    .wdp-btn.wdp-f { color: #dc2626; }
    .wdp-btn.wdp-off { background: #fff; color: #16a34a; }
    .wdp-lbl { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: #9ca3af; text-transform: uppercase; }
    .wdp-steps { display: grid; grid-template-columns: auto 1fr; gap: 3px 9px; font-size: 13px; line-height: 1.45; }
    .wdp-ph { color: #9ca3af; font-size: 10.5px; font-weight: 700; text-transform: uppercase; padding-top: 3px; }
    .wdp-steps code, .wdp-stmt code { background: #f5f6f8; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
    .wdp-thread { padding: 8px 10px; border-left: 3px solid #e5e7eb; border-radius: 0 7px 7px 0; background: #fafbfc; margin-bottom: 6px; }
    .wdp-thread.wdp-you { border-left-color: #d97706; background: #fdf6e8; }
    .wdp-foot { border-top: 1px solid #e5e7eb; padding: 9px 14px; display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }
    .wdp-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border: 1px solid #e5e7eb;
      border-radius: 8px; font: inherit; font-size: 12.5px; color: #374151; background: #fff; cursor: pointer; }
    .wdp-chip.wdp-on { background: #d97706; border-color: #d97706; color: #fff; font-weight: 600; }
    .wdp-slider { width: 82px; accent-color: #d97706; }
    .wdp-tab { position: fixed; right: 0; top: 50%; z-index: 2147483000; transform: translateY(-50%);
      background: #16181d; color: #fff; border: 0; border-radius: 8px 0 0 8px; padding: 11px 7px; cursor: pointer;
      font: 600 11px/1 -apple-system, sans-serif; writing-mode: vertical-rl; letter-spacing: .08em; display: none; }
    .wdp-tab.wdp-show { display: block; }
    /* the prototype, ghosted over the running app */
    .wdp-ghost { position: fixed; top: 0; left: 0; bottom: 0; right: ${W}px; z-index: 2147482000;
      border: 0; pointer-events: none; }
    .wdp-empty { color: #9ca3af; font-size: 12.5px; padding: 14px; }`;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.className = 'wdp-host';
  document.body.appendChild(host);

  const tab = document.createElement('button');
  tab.className = 'wdp-tab';
  tab.textContent = 'WALKDOWN';
  tab.onclick = () => setDocked(true);
  document.body.appendChild(tab);

  // Docking pushes the page rather than covering it, so nothing is hidden
  // behind the panel. (It does narrow the app — that is the tradeoff.)
  const prevMargin = document.documentElement.style.marginRight;
  function setDocked(on) {
    host.classList.toggle('wdp-hidden', !on);
    tab.classList.toggle('wdp-show', !on);
    document.documentElement.style.marginRight = on ? `${W}px` : prevMargin;
    document.documentElement.style.transition = 'margin-right .22s ease';
    if (!on) setGhost(false);
  }

  // ---- data -----------------------------------------------------------------
  const needsYou = (rule) =>
    (data?.attention ?? []).some((i) => i.who === 'human' && !i.thread && i.rule === rule);
  const threadsFor = (rule) => (data?.threads ?? []).filter((t) => t.anchor?.rule === rule &&
    !['incorporated', 'verified', 'waived'].includes(t.status));

  /** Which storyboard screen this page is, by URL — same trick the embed uses. */
  function currentScreen() {
    const screens = data?.storyboard ?? [];
    if (pickedScreen) return screens.find((s) => s.id === pickedScreen) ?? null;
    const here = (s) => s && (location.pathname === s || location.pathname.endsWith(s));
    return screens.find((s) => here(s.app?.path) || here(s.prototype)) ?? null;
  }

  async function load() {
    const res = await fetch(api('/api/blueprint'));
    data = await res.json();
    render();
  }

  // ---- render ---------------------------------------------------------------
  function render() {
    if (!data) return;
    const total = data.rows.length;
    const verified = data.rows.filter((r) => r.verdict === 'pass').length;
    const owed = data.rows.filter((r) => needsYou(r.rule)).length;
    host.innerHTML = `
      <div class="wdp-head">
        <span class="wdp-logo">Walk<span>down</span></span>
        <span class="wdp-muted">${esc(data.project)}</span>
        <button class="wdp-x" title="Undock">×</button>
      </div>
      <div class="wdp-queue">
        <span><b>${verified} of ${total}</b> rules verified</span>
        ${owed ? `<span class="wdp-pill">${owed} need you</span>` : ''}
      </div>
      <div class="wdp-track${view === 'detail' ? ' wdp-detail' : ''}">
        <div class="wdp-pane">${listPane()}</div>
        <div class="wdp-pane">${detailPane()}</div>
      </div>
      ${footer()}`;

    host.querySelector('.wdp-x').onclick = () => setDocked(false);
    host.querySelectorAll('[data-rule]').forEach((el) => {
      el.onclick = () => open(el.dataset.rule);
    });
    const back = host.querySelector('.wdp-back');
    if (back) back.onclick = () => { view = 'list'; render(); };
    wireFooter();
    wireVerdict();
  }

  function listPane() {
    if (!data.rows.length) return '<p class="wdp-empty">No rules in this blueprint.</p>';
    let html = '';
    let story = null;
    for (const row of data.rows) {
      if (row.story !== story) {
        story = row.story;
        html += `<div class="wdp-story">${esc(story)}</div>`;
      }
      const mine = needsYou(row.rule);
      const glyph = session?.verdicts[row.rule]
        ? (session.verdicts[row.rule] === 'pass' ? '✓' : '✗')
        : mine ? '◆' : { pass: '✓', fail: '✗', pending: '○' }[row.verdict];
      const cls = session?.verdicts[row.rule]
        ? (session.verdicts[row.rule] === 'pass' ? 'wdp-pass' : 'wdp-fail')
        : mine ? 'wdp-mine' : { pass: 'wdp-pass', fail: 'wdp-fail', pending: 'wdp-pending' }[row.verdict];
      const short = row.rule.startsWith(row.story + '.') ? row.rule.slice(row.story.length + 1) : row.rule;
      const thr = threadsFor(row.rule).length;
      html += `<button class="wdp-rule" data-rule="${esc(row.rule)}" title="${esc(row.rule)}">
        <span class="wdp-glyph ${cls}">${glyph}</span>
        <span class="wdp-name">${esc(short)}</span>
        ${mine || thr ? `<span class="wdp-tag">${mine ? 'walk' : ''}${thr ? ` ${thr}⚑` : ''}</span>` : ''}
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
          `<span class="wdp-ph">${esc(ph)}</span><span>${items.map((s) =>
            esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')).join('<br>')}</span>`).join('')
      : '';
    const picked = session?.verdicts[r.rule];
    return `
      <button class="wdp-back">← All rules</button>
      <div class="wdp-body">
        <div>
          <div class="wdp-rid">${esc(r.rule)}</div>
          <p class="wdp-stmt">${esc(r.statement)}</p>
        </div>
        ${session ? `<div class="wdp-verdict">
          <button class="wdp-btn ${picked === 'pass' ? 'wdp-p' : 'wdp-off'}" data-v="pass">✓ Pass</button>
          <button class="wdp-btn wdp-f" data-v="fail" ${picked === 'fail' ? 'style="border-color:#dc2626;background:#dc2626;color:#fff"' : ''}>✗ Fail</button>
        </div>
        <div class="wdp-muted">${Object.keys(session.verdicts).length} judged this session</div>` : ''}
        ${steps ? `<div><div class="wdp-lbl" style="margin-bottom:5px">Steps</div>
          <div class="wdp-steps">${steps}</div></div>` : ''}
        <div>
          <div class="wdp-lbl" style="margin-bottom:5px">Verify</div>
          <div style="font-size:13px">${esc(r.verify.join(', '))}</div>
        </div>
        ${threads.length ? `<div><div class="wdp-lbl" style="margin-bottom:5px">Threads</div>
          ${threads.map((t) => `<div class="wdp-thread ${t.status === 'addressed' || t.status === 'answered' ? 'wdp-you' : ''}">
            <div style="font-size:11.5px;color:#6b7280"><b style="color:#16181d">${esc(t.id)}</b> · ${esc(t.status)}</div>
            <div style="font-size:12.5px;line-height:1.4;margin-top:2px">${esc(t.body)}</div>
          </div>`).join('')}</div>` : ''}
      </div>`;
  }

  function footer() {
    const screen = currentScreen();
    const canGhost = Boolean(screen?.prototype && data.hasPrototype);
    return `<div class="wdp-foot">
      <button class="wdp-chip ${session ? 'wdp-on' : ''}" id="wdp-session">${session ? 'End walkdown' : 'Start walkdown'}</button>
      <button class="wdp-chip ${ghost ? 'wdp-on' : ''}" id="wdp-ghost" ${canGhost ? '' : 'disabled style="opacity:.45;cursor:default"'}>Ghost</button>
      ${ghost ? `<input class="wdp-slider" id="wdp-op" type="range" min="0" max="100" value="${ghostOpacity * 100}">` : ''}
      <select class="wdp-chip" id="wdp-screen" style="margin-left:auto" title="Which screen is this page?">
        <option value="">screen…</option>
        ${(data.storyboard ?? []).map((s) =>
          `<option value="${esc(s.id)}" ${screen?.id === s.id ? 'selected' : ''}>${esc(s.id)}</option>`).join('')}
      </select>
    </div>`;
  }

  function wireFooter() {
    host.querySelector('#wdp-session').onclick = () => {
      session = session ? null : { verdicts: {} };
      render();
    };
    const g = host.querySelector('#wdp-ghost');
    if (g && !g.disabled) g.onclick = () => setGhost(!ghost);
    const op = host.querySelector('#wdp-op');
    if (op) op.oninput = () => { ghostOpacity = op.value / 100; if (ghost) ghost.style.opacity = ghostOpacity; };
    const sel = host.querySelector('#wdp-screen');
    if (sel) sel.onchange = () => {
      pickedScreen = sel.value || null;
      if (ghost) { setGhost(false); setGhost(true); } else render();
    };
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
      render();
      return;
    }
    const screen = currentScreen();
    if (!screen?.prototype) return;
    ghost = document.createElement('iframe');
    ghost.className = 'wdp-ghost';
    ghost.style.opacity = ghostOpacity;
    ghost.src = api('/prototype' + screen.prototype);
    document.body.appendChild(ghost);
    render();
  }

  // Hold G to peek at the prototype at full strength.
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'g' && ghost && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) ghost.style.opacity = 1;
  });
  addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'g' && ghost) ghost.style.opacity = ghostOpacity;
  });

  setDocked(true);
  load().catch(() => {
    host.innerHTML = '<p class="wdp-empty">Walkdown server unreachable — run <code>walkdown serve</code>.</p>';
  });
})();
