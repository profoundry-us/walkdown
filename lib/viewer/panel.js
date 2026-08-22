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
  if (window.__walkdownPanel) return;
  window.__walkdownPanel = true;

  const script = document.currentScript;
  const SERVER = new URL(script?.src ?? 'http://localhost:4700').origin;
  const BP = script?.dataset.bp || '';
  const api = (path) => SERVER + path + (BP ? (path.includes('?') ? '&' : '?') + 'bp=' + encodeURIComponent(BP) : '');

  const W = 384;
  let data = null, view = 'list', selected = null, session = null, ghost = null, ghostOpacity = 0.5;
  let pickedScreen = script?.dataset.screen || null;
  let openThread = null;   // the thread expanded in the detail pane, by id
  /*
   * A screen the ghost is pinned to for a moment — viewing a sketch from a
   * thread, say. Kept apart from pickedScreen on purpose: pickedScreen answers
   * "which screen is this page?", and a passing look at another screen's
   * artwork must not rewrite that answer, or the panel spends the rest of the
   * session describing a page you are not on.
   */
  let ghostOverride = null;
  let threadNote = '';     // what the reply box says, kept across re-renders
  let lastView = 'list';
  let ghostWidth = 0;   // 0 = fill the stage; otherwise a fixed CSS width

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- chrome ---------------------------------------------------------------
  const shell = document.createElement('div');
  // The embed reads this to know the panel is walkdown's own chrome and not a
  // place to drop a pin. A click inside the shadow root retargets to this host
  // element, so marking the shell covers everything the panel draws.
  shell.dataset.walkdownChrome = '';
  shell.style.cssText = `position:fixed; top:0; right:0; bottom:0; width:${W}px; z-index:2147483000;
    border-left:1px solid rgba(20,25,40,.14); box-shadow:-2px 0 12px rgba(20,25,40,.06);
    transition:transform .22s ease; background:#fff;`;
  const sr = shell.attachShadow({ mode: 'open' });
  document.body.appendChild(shell);

  // The panel's own root inside the shadow tree. data-theme is what makes
  // daisyUI's tokens resolve in here: :root does not match a shadow root, but
  // [data-theme] matches any element, so the wrapper carries the theme.
  const host = document.createElement('div');
  host.dataset.theme = 'light';
  host.className = 'flex h-full flex-col bg-base-100 text-sm text-base-content';
  sr.appendChild(host);

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
  fetch(SERVER + '/walkdown.css')
    .then((r) => r.text())
    .then((css) => {
      const sheet = document.createElement('style');
      sheet.textContent = css;
      sr.insertBefore(sheet, host);
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

  // Docking pushes the page rather than covering it, so nothing is hidden
  // behind the panel. (It does narrow the app — that is the tradeoff.)
  const prevMargin = document.documentElement.style.marginRight;
  function setDocked(on) {
    shell.style.transform = on ? 'none' : 'translateX(100%)';
    tab.style.display = on ? 'none' : 'block';
    document.documentElement.style.marginRight = on ? `${W}px` : prevMargin;
    document.documentElement.style.transition = 'margin-right .22s ease';
    // How much of the right edge the panel is occupying. The embed's badge
    // reads this so it comes to rest beside the panel instead of under it.
    document.documentElement.style.setProperty('--walkdown-dock', on ? `${W}px` : '0px');
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
    host.innerHTML = `
      <div class="flex items-center gap-2 border-b border-base-300 px-3.5 py-3">
        <span class="text-[13.5px] font-bold">walk<span class="text-success">down</span></span>
        <span class="text-[11.5px] opacity-50">${esc(data.project)}</span>
        <button class="wdp-x btn btn-xs btn-ghost ml-auto" title="Undock">×</button>
      </div>
      <div class="flex items-center gap-2 border-b border-base-300 px-3.5 py-2 text-xs opacity-70">
        <span><b>${verified} of ${total}</b> rules verified</span>
        ${owed ? `<span class="badge badge-sm badge-warning badge-outline ml-auto">${owed} need you</span>` : ''}
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
          <div class="wdp-pane flex min-h-0 w-1/2 flex-[0_0_50%] flex-col overflow-y-auto">${listPane()}</div>
          <div class="wdp-pane flex min-h-0 w-1/2 flex-[0_0_50%] flex-col overflow-y-auto">${detailPane()}</div>
        </div>
      </div>
      ${footer()}`;

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
    host.querySelector('.wdp-x').onclick = () => setDocked(false);
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
    wireFooter();
    wireVerdict();
    wireThreads();
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

  function footer() {
    const screen = currentScreen();
    const detour = ghostOverride && ghostOverride !== screen?.id ? screenById(ghostOverride) : null;
    const canGhost = Boolean(ghostSource(screenById(ghostOverride) ?? screen));
    return `<div class="flex flex-wrap items-center gap-2 border-t border-base-300 px-3.5 py-2">
      <button class="btn btn-sm ${session ? 'btn-warning' : ''}" id="wdp-session">${
        session ? 'Discard' : 'Start walkdown'}</button>
      <button class="btn btn-sm ${ghost ? 'btn-warning' : ''}" id="wdp-ghost" ${canGhost ? '' : 'disabled'}>Ghost</button>
      ${ghost ? `<input class="range range-xs range-warning w-20" id="wdp-op" type="range" min="0" max="100" value="${ghostOpacity * 100}">
        <select class="select select-sm w-20" id="wdp-gw" title="Width the prototype is drawn at">
          ${[[0, 'fill'], [1440, '1440'], [1024, '1024'], [390, '390']].map(([v, l]) =>
            `<option value="${v}" ${ghostWidth === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>` : ''}
      ${detour ? `<span class="badge badge-sm badge-warning badge-outline"
        title="The ghost is showing another screen — turn it off to go back">ghosting ${esc(detour.id)}</span>` : ''}
      <select class="select select-sm ml-auto w-36" id="wdp-screen" title="Which screen is this page?">
        <option value="">detect from the page</option>
        ${(data.storyboard ?? []).map((s) =>
          `<option value="${esc(s.id)}" ${screen?.id === s.id ? 'selected' : ''}>${esc(s.id)}</option>`).join('')}
      </select>
    </div>`;
  }

  function wireFooter() {
    host.querySelector('#wdp-session').onclick = () => {
      session = session ? null : { verdicts: {}, actor: data.identity?.actor ?? '' };
      render();
    };
    const g = host.querySelector('#wdp-ghost');
    if (g && !g.disabled) g.onclick = () => setGhost(!ghost);
    const op = host.querySelector('#wdp-op');
    if (op) op.oninput = () => { ghostOpacity = op.value / 100; if (ghost) ghost.style.opacity = ghostOpacity; };
    const gw = host.querySelector('#wdp-gw');
    if (gw) gw.onchange = () => {
      ghostWidth = Number(gw.value);
      const frame = ghost?.querySelector('iframe');
      if (frame) frame.style.width = ghostWidth ? `${ghostWidth}px` : '100%';
    };
    const sel = host.querySelector('#wdp-screen');
    if (sel) sel.onchange = () => {
      pickedScreen = sel.value || null;
      ghostOverride = null;
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

  function toast(html) {
    const t = document.createElement('div');
    t.className = 'toast toast-end';
    t.style.right = `${W + 18}px`;
    t.innerHTML = `<div class="alert alert-neutral text-[13px]">${html}</div>`;
    host.appendChild(t);
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
      ghostOverride = null;   // the detour ends with the overlay
      render();
      return;
    }
    const screen = screenById(ghostOverride) ?? currentScreen();
    const src = ghostSource(screen);
    if (!src) return;
    // The stage owns the opacity so the backdrop fades with the prototype: at
    // full strength the app is properly covered, not blended into. The
    // checkerboard says "nothing is here" where the prototype does not reach,
    // so an uncovered strip never reads as design. Inline styles: this element
    // is in the host document, where our stylesheet has no reach.
    ghost = document.createElement('div');
    ghost.style.cssText = `position:fixed; top:0; left:0; bottom:0; right:${W}px; z-index:2147482000;
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
    frame.src = api(src.path);
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
    host.innerHTML = '<p class="p-3.5 text-[12.5px] opacity-40">walkdown server unreachable — run <code>walkdown serve</code>.</p>';
  });
})();
