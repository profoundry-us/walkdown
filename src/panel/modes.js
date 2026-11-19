/*
 * The three modes of one window: Walkdown, Boards and Personas (ADR 0018 §7,
 * the panel.modes story).
 *
 * Walkdown is the panel as it always was: the rules beside the app. Boards
 * and Personas take the whole window under the bar. The side panel and the
 * app's frame are hidden for them and never closed, so the page in the frame
 * keeps running and is there, as it was, on the way back.
 *
 * This module owns which mode is chosen, the switcher and the board picker
 * the bar draws, the page under the bar, and each mode's place. It draws a
 * board and a persona only as far as the mode rules need: a board's lanes,
 * hand-offs, marks and pictures, and what a persona's card holds, have rules
 * of their own to come, and nothing here stands in for them.
 */
import { html, nothing, render as put, svg } from '../../vendor/lit.js';
import { icon } from './icons.js';
import { requestRender } from './shell.js';
import { D, S } from './state.js';

const glyph = (body) =>
  html`<svg class="size-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/* In the order the list shows them. The lines are the accepted design's. */
export const MODES = [
  {
    id: 'walkdown',
    title: 'Walkdown',
    line: 'The rules, one at a time, beside the app.',
    glyph: svg`<rect x="1.75" y="3" width="12.5" height="10" rx="1.5"/><path d="M9.5 3v10"/><path d="M3.9 8.2l1.3 1.3 2.2-2.8"/><path d="M11.2 6.4h1.4M11.2 8.6h1.4"/>`,
  },
  {
    id: 'boards',
    title: 'Boards',
    line: 'Who does what, in the order it happens.',
    glyph: svg`<rect x="1.5" y="2.75" width="4.5" height="3.5" rx=".8"/><rect x="5.75" y="9.75" width="4.5" height="3.5" rx=".8"/><rect x="10" y="2.75" width="4.5" height="3.5" rx=".8"/><path d="M1.5 8h13" stroke-dasharray="1.5 1.5"/>`,
  },
  {
    id: 'personas',
    title: 'Personas',
    line: 'Everyone who uses the app, and who they sign in as.',
    glyph: svg`<circle cx="6" cy="5.4" r="2.2"/><path d="M2 13c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8"/><circle cx="11.6" cy="6.2" r="1.6"/><path d="M11.4 9.5c1.6 0 2.9 1.2 2.9 3"/>`,
  },
];
const modeOf = (id) => MODES.find((m) => m.id === id) ?? MODES[0];

/** The chosen mode. Walkdown until the blueprint is on screen. */
export const modeNow = () => (S.phase === 'ready' ? modeOf(S.mode).id : 'walkdown');
export const wholeWindow = () => modeNow() !== 'walkdown';

const boards = () => S.data?.boards ?? [];
const people = () => S.data?.people ?? { groups: [], personas: [], systems: [], targets: [] };

// ---- each mode's place ------------------------------------------------------
/*
 * Where a board was left (which one, its position, its zoom) and how far
 * Personas was scrolled. Kept for the tab, per blueprint, so a reload comes
 * back to it. The address names the mode and the board and nothing finer: a
 * link opens the board, and where the sender had dragged it to is theirs.
 */
const placeKey = () => `walkdown:modes:${S.BP || S.data?.key || ''}`;
const blank = () => ({ board: null, views: {}, personas: 0, down: false });
let place = blank();
let placeFor = null;

function readPlace() {
  const key = placeKey();
  if (placeFor === key) return place;
  placeFor = key;
  place = blank();
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (saved && typeof saved === 'object') place = { ...blank(), ...saved };
  } catch {
    /* a tab that keeps nothing starts each mode where it opens */
  }
  return place;
}

function keepPlace() {
  try {
    sessionStorage.setItem(placeKey(), JSON.stringify(place));
  } catch {
    /* kept for this page alone, then */
  }
}

const HOME_VIEW = { x: 32, y: 32, z: 1 };
const viewOf = (id) => readPlace().views[id] ?? HOME_VIEW;

/**
 * The board Boards shows: the one the address named, or the one it was left
 * on, or the blueprint's first. `missing` is an address naming a board the
 * blueprint does not have.
 */
function boardNow() {
  const all = boards();
  if (S.board) {
    const named = all.find((b) => b.id === S.board);
    return named ? { board: named } : { board: null, missing: S.board };
  }
  const left = all.find((b) => b.id === readPlace().board);
  return { board: left ?? all[0] ?? null };
}

// ---- the address --------------------------------------------------------------
/** Write the mode, and on Boards the board, into an address being built. */
export function modeParams(url) {
  const mode = modeNow();
  if (mode === 'walkdown') {
    url.searchParams.delete('mode');
    url.searchParams.delete('board');
    return;
  }
  url.searchParams.set('mode', mode);
  const { board, missing } = mode === 'boards' ? boardNow() : {};
  if (board || missing) url.searchParams.set('board', board?.id ?? missing);
  else url.searchParams.delete('board');
}

/** Take the mode and the board from the address: at boot, and on Back and Forward. */
export function readModeAddress() {
  const q = new URLSearchParams(location.search);
  const mode = q.get('mode');
  S.mode = MODES.some((m) => m.id === mode) ? mode : 'walkdown';
  S.board = S.mode === 'boards' ? q.get('board') || null : null;
}

/*
 * A choice of mode or board is a step in the browser's history, so Back
 * returns to the mode before it. Everything else the address says is
 * rewritten in place, as before.
 */
function stepAddress() {
  try {
    const url = new URL(location.href);
    modeParams(url);
    if (url.href !== location.href) history.pushState(history.state, '', url.href);
  } catch {
    /* an address that cannot be written is left as it was */
  }
}

// ---- choosing ---------------------------------------------------------------
export function setMode(id) {
  S.modesOpen = false;
  S.boardsOpen = false;
  S.modeSettingsOpen = false;
  if (modeOf(id).id !== modeNow()) {
    notePlace();
    S.mode = modeOf(id).id;
    // Boards opens where it was left, whatever an old address said.
    if (S.mode === 'boards' && !boards().some((b) => b.id === S.board)) S.board = null;
    stepAddress();
  }
  requestRender();
}

function setBoard(id) {
  S.boardsOpen = false;
  notePlace();
  S.board = id;
  readPlace().board = id;
  keepPlace();
  stepAddress();
  requestRender();
}

/** Back or Forward landed on another address. */
export function modeFromHistory() {
  notePlace();
  readModeAddress();
  S.modesOpen = S.boardsOpen = S.modeSettingsOpen = false;
  requestRender();
}

/** Another blueprint: its boards are not this one's. */
export function forgetBoard() {
  S.board = null;
}

export function closeModeMenus() {
  if (!S.modesOpen && !S.boardsOpen && !S.modeSettingsOpen) return false;
  S.modesOpen = S.boardsOpen = S.modeSettingsOpen = false;
  requestRender();
  return true;
}

// ---- what the bar draws -----------------------------------------------------
/*
 * The switcher stands where the walkdown name stood, and is named for the
 * mode that is chosen: its icon, then its name. One button, so three modes
 * cost a narrow bar the width of one word (Topher, 2026-11-18).
 */
export function modeSwitcher() {
  const now = modeOf(modeNow());
  return html`<span class="relative shrink-0" data-mode-menu>
    <button type="button" class="btn btn-xs btn-ghost gap-1 px-1.5 font-bold tracking-tight ${S.modesOpen ? 'btn-active' : ''}"
      data-testid="panel.modes" data-mode="${now.id}" aria-haspopup="menu"
      aria-expanded=${String(Boolean(S.modesOpen))} aria-label="Mode: ${now.title}"
      title="${now.title}. Choose another mode."
      @click=${() => {
        S.modesOpen = !S.modesOpen;
        S.boardsOpen = S.modeSettingsOpen = false;
        requestRender();
      }}>${glyph(now.glyph)}<span>${now.title}</span>${icon('caret-down', 'size-3')}</button>
  </span>`;
}

/*
 * The switcher's list. Drawn by the bar itself and not inside the switcher:
 * on Walkdown the switcher sits in a group that clips what overflows it, and
 * a list hung from the button was cut off at the bar's own height.
 */
export function modeMenu() {
  const now = modeOf(modeNow());
  return S.modesOpen
    ? html`<div class="modes-pop modes-menu" data-mode-menu role="menu" aria-label="Modes" data-testid="modes.menu">
            ${MODES.map(
              (m) => html`<button type="button" class="row" role="menuitemradio" data-mode="${m.id}"
                aria-checked=${String(m.id === now.id)} @click=${() => setMode(m.id)}>
                ${glyph(m.glyph)}
                <span><span class="name">${m.title}</span><span class="line">${m.line}</span></span>
                <span class="tick" aria-hidden="true">${m.id === now.id ? '✓' : ''}</span></button>`,
            )}
            <p>Boards and Personas take the whole window. The app keeps running underneath, and Walkdown comes back as you left it.</p>
          </div>`
    : nothing;
}

/** Which board this is, where Walkdown names its screen. None to pick, none drawn. */
export function boardPicker() {
  if (modeNow() !== 'boards' || !boards().length) return nothing;
  const { board, missing } = boardNow();
  return html`<span class="relative min-w-0" data-mode-menu>
    <button type="button" class="btn btn-xs btn-ghost min-w-0 gap-1 px-1.5 font-normal ${S.boardsOpen ? 'btn-active' : ''}"
      data-testid="modes.board-picker" aria-haspopup="listbox" aria-expanded=${String(Boolean(S.boardsOpen))}
      title="Which board this is. Choose another."
      @click=${() => {
        S.boardsOpen = !S.boardsOpen;
        S.modesOpen = S.modeSettingsOpen = false;
        requestRender();
      }}><span class="max-w-56 truncate">${board?.title ?? (missing ? 'Choose a board' : '')}</span>${icon('caret-down', 'size-3')}</button>
    ${
      S.boardsOpen
        ? html`<div class="target-pop" role="listbox" aria-label="This blueprint's boards">
            ${boards().map(
              (b) => html`<button class="row" role="option" data-board="${b.id}"
                aria-selected=${String(b.id === board?.id)} @click=${() => setBoard(b.id)}>
                <span class="tick">${b.id === board?.id ? '✓' : ''}</span>
                <span><div class="name">${b.title}</div><div class="url">${b.cards.length} card${b.cards.length === 1 ? '' : 's'}</div></span></button>`,
            )}
          </div>`
        : nothing
    }
  </span>`;
}

/*
 * The gear on Boards and Personas. Each mode will have settings of its own;
 * neither has one yet, and the panel says so sooner than draw a dial that
 * turns nothing.
 */
export function modeGear() {
  const now = modeOf(modeNow());
  return html`<span class="relative shrink-0" data-mode-menu>
    <button class="btn btn-xs btn-ghost ${S.modeSettingsOpen ? 'btn-active' : ''}" data-testid="panel.desk-tuner"
      title="Settings for ${now.title}" aria-expanded=${String(Boolean(S.modeSettingsOpen))}
      @click=${() => {
        S.modeSettingsOpen = !S.modeSettingsOpen;
        S.modesOpen = S.boardsOpen = false;
        requestRender();
      }}>${icon('gear', 'size-3.5')}</button>
    ${
      S.modeSettingsOpen
        ? html`<div class="modes-pop" role="dialog" aria-label="Settings for ${now.title}" data-testid="modes.settings">
            <p class="head">${now.title} settings</p>
            <p>${now.title} has no settings yet.</p>
          </div>`
        : nothing
    }
  </span>`;
}

// ---- the page under the bar -------------------------------------------------
const say = (title, ...lines) =>
  html`<div class="modes-say"><h2>${title}</h2>${lines.map((l) => html`<p>${l}</p>`)}</div>`;

function paintView(el, v) {
  el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
  el.dataset.x = String(Math.round(v.x));
  el.dataset.y = String(Math.round(v.y));
  el.dataset.zoom = String(Math.round(v.z * 100));
  const pct = D.modePage?.querySelector('[data-zoom-now]');
  if (pct) pct.textContent = `${Math.round(v.z * 100)}%`;
}

function moveBoard(id, next) {
  const v = { ...viewOf(id), ...next };
  v.z = Math.min(2, Math.max(0.25, v.z));
  readPlace().views[id] = v;
  const el = D.modePage?.querySelector('[data-board-sheet]');
  if (el) paintView(el, v);
  keepPlace();
}

const zoomBy = (id, by) => moveBoard(id, { z: Math.round((viewOf(id).z + by) * 20) / 20 });

function boardPage() {
  const { board, missing } = boardNow();
  if (missing)
    return say(
      html`There is no board called <code>${missing}</code> here.`,
      "It may have been renamed or removed since the link was made. Choose one of this blueprint's boards.",
      html`<span class="flex flex-wrap justify-center gap-1">${boards().map(
        (b) =>
          html`<button class="btn btn-xs btn-outline" @click=${() => setBoard(b.id)}>${b.title}</button>`,
      )}</span>`,
    );
  if (!board)
    return say(
      'This blueprint has no boards.',
      "A board puts the blueprint's stories in the order people meet them.",
      html`Add one as a file in the blueprint's <code>boards/</code> folder and it opens here.`,
    );
  const down = Boolean(readPlace().down);
  const phases = board.phases.length ? board.phases : [null];
  const drag = { on: false, x: 0, y: 0 };
  return html`<div class="modes-canvas" data-board="${board.id}"
      @pointerdown=${(e) => {
        if (e.target.closest('button')) return;
        drag.on = true;
        drag.x = e.clientX - viewOf(board.id).x;
        drag.y = e.clientY - viewOf(board.id).y;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      @pointermove=${(e) => drag.on && moveBoard(board.id, { x: e.clientX - drag.x, y: e.clientY - drag.y })}
      @pointerup=${() => (drag.on = false)}
      @pointercancel=${() => (drag.on = false)}
      @wheel=${(e) => {
        e.preventDefault();
        const v = viewOf(board.id);
        if (e.ctrlKey || e.metaKey)
          moveBoard(board.id, { z: v.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1) });
        else moveBoard(board.id, { x: v.x - e.deltaX, y: v.y - e.deltaY });
      }}>
      <div class="modes-board ${down ? 'down' : ''}" data-board-sheet aria-label="The board ${board.title}">
        ${phases.map(
          (phase) => html`<section>
            ${phase ? html`<h3>${phase}</h3>` : nothing}
            ${board.cards
              .filter((c) => !phase || c.phase === phase || (!c.phase && phase === phases[0]))
              .map(
                (c) => html`<article class="${c.story ? '' : 'outside'}" data-card="${c.id}"
                  title="${c.story ?? 'A step outside this blueprint'}">${c.title}</article>`,
              )}
          </section>`,
        )}
      </div>
      <div class="modes-float">
        <span class="pill" title="Which way time runs on the board">
          <span class="opacity-50">Time runs</span>
          <span class="join">
            <button class="btn btn-xs join-item ${down ? 'btn-ghost' : 'btn-active'}" aria-pressed=${String(!down)}
              @click=${() => turn(false)}>Across →</button>
            <button class="btn btn-xs join-item ${down ? 'btn-active' : 'btn-ghost'}" aria-pressed=${String(down)}
              @click=${() => turn(true)}>Down ↓</button>
          </span>
        </span>
        <span class="pill">
          <button class="btn btn-xs btn-ghost btn-square" title="Zoom out" @click=${() => zoomBy(board.id, -0.1)}>−</button>
          <span class="w-10 text-center opacity-60" data-zoom-now>100%</span>
          <button class="btn btn-xs btn-ghost btn-square" title="Zoom in" @click=${() => zoomBy(board.id, 0.1)}>+</button>
          <button class="btn btn-xs btn-ghost" title="Back to where the board opens"
            @click=${() => moveBoard(board.id, HOME_VIEW)}>Reset</button>
        </span>
      </div>
    </div>`;
}

function turn(down) {
  readPlace().down = down;
  keepPlace();
  requestRender();
}

/*
 * The five marks a story can carry (ADR 0018 §5), in the order a card counts
 * them. Warning yellow is this panel's "waiting on you", as on a rule's glyph.
 */
const MARKS = [
  ['failing', '✕', 'failing', 'var(--color-error)'],
  ['not-built', '○', 'not built', 'inherit'],
  ['you', '●', 'waiting on you', 'var(--color-warning)'],
  ['agent', '◐', 'waiting on an agent', 'var(--color-info)'],
  ['passing', '✓', 'passing', 'var(--color-success)'],
];

/* The first letters of a title's first two words: who a card is, at a glance. */
const initials = (title) =>
  String(title)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

/* Boards, on this board: one step in the browser's history, as choosing a mode is. */
function openBoard(id) {
  notePlace();
  S.board = id;
  readPlace().board = id;
  keepPlace();
  setMode('boards');
}

function userRow(u, first) {
  return html`<div class="user" data-user="${u.id}">
    <b>${u.title}</b>${first ? html` <i>· default</i>` : nothing}
    ${u.fixtures.map((k) => html`<br /><code>{fixtures.${k}}</code>`)}
    ${u.targets.map(
      (t) => html`<div class="tg ${t.set ? '' : 'none'}" data-target="${t.target}">
        <span>${t.target}</span><span>${
          t.set
            ? 'has a value'
            : 'no value, so nothing signed in as this user can be walked or pictured there'
        }</span></div>`,
    )}
  </div>`;
}

function personaCard(p) {
  const n = p.stories.total;
  return html`<article class="pcard" data-testid="personas.card" data-persona="${p.id}">
    <div class="top"><span class="av" aria-hidden="true">${initials(p.title)}</span>
      <div><b>${p.title}</b>${p.of ? html`<small>of ${p.of}</small>` : nothing}</div></div>
    ${p.blurb ? html`<p class="blurb">${p.blurb}</p>` : nothing}
    <dl>
      ${p.uses ? html`<dt>Uses</dt><dd>${p.uses}</dd>` : nothing}
      <dt>Users</dt>
      <dd data-testid="personas.users">${
        p.users.length
          ? p.users.map((u, i) => userRow(u, i === 0))
          : 'Nobody signs in as this persona.'
      }</dd>
      <dt>Stories</dt>
      <dd data-testid="personas.stories">${
        n
          ? html`${n} ${n === 1 ? 'story' : 'stories'} ${MARKS.filter(([id]) => p.stories[id]).map(
              ([id, mark, words, colour]) =>
                html`<span class="count" data-mark="${id}" style="color:${colour}"
                  title="${p.stories[id]} ${words}">${mark} ${p.stories[id]}</span>`,
            )}`
          : 'none yet'
      }</dd>
      <dt>On boards</dt>
      <dd class="bd" data-testid="personas.boards">${
        p.boards.length
          ? p.boards.map(
              (b) => html`<button data-board="${b.id}" title="Open the board, following ${p.title}"
                @click=${() => openBoard(b.id)}>${b.title} →</button>`,
            )
          : html`<span>none yet</span>`
      }</dd>
    </dl>
  </article>`;
}

function personasPage() {
  const { groups, personas: all, systems } = people();
  if (!all.length && !systems.length)
    return say(
      'This blueprint has no personas.',
      "A persona is someone who uses the app. A story is one persona's, and a board's lanes are the personas of its stories.",
      html`Declare them under <code>personas:</code> in the storyboard and they are listed here.`,
    );
  const named = new Set(groups.map((g) => g.id));
  // Personas of no declared group come first, under no heading: a storyboard with no groups is all of them.
  const loose = all.filter((p) => !named.has(p.group));
  return html`<div class="modes-people">
    <h1>Personas</h1>
    <p class="lede">Everyone who uses the app. A story is one persona's, a screen is signed in as one of its users,
      and a board's lanes are the personas of its stories.</p>
    <p class="key" aria-label="What the marks mean">${MARKS.map(
      ([id, mark, words, colour]) =>
        html`<span data-mark="${id}"><b style="color:${colour}">${mark}</b> ${words}</span>`,
    )}</p>
    ${loose.length ? html`<div class="pgrid loose">${loose.map(personaCard)}</div>` : nothing}
    ${groups.map(
      (g) => html`<h2 data-testid="personas.group" data-group="${g.id}">${g.title}</h2>
        <div class="pgrid">${all.filter((p) => p.group === g.id).map(personaCard)}</div>`,
    )}
    ${
      systems.length
        ? html`<h2 data-systems>Systems nobody signs in as</h2>
            <div class="sgrid">${systems.map(
              (
                s2,
              ) => html`<article class="scard" data-testid="personas.system" data-system="${s2.id}">
                <span class="sq" aria-hidden="true">${initials(s2.title)}</span>
                <div><b>${s2.title}</b>${s2.outside ? html` <small>(outside)</small>` : nothing}</div>
              </article>`,
            )}</div>`
        : nothing
    }
  </div>`;
}

/** Note where the mode being left stands, before another takes the page. */
function notePlace() {
  if (modeNow() === 'personas' && D.modePage) {
    readPlace().personas = D.modePage.scrollTop;
    keepPlace();
  }
}

let painted = null;

/**
 * Show or hide the page, and with it the side panel and the app's frame.
 * Hidden, never removed: a frame taken out of the document loads again when
 * it comes back, and what was typed into it is gone.
 */
export function paintModePage() {
  if (!D.modePage) return;
  const mode = modeNow();
  const whole = mode !== 'walkdown';
  D.modePage.style.display = whole ? '' : 'none';
  if (D.side) D.side.style.visibility = whole ? 'hidden' : '';
  if (D.appFrame) D.appFrame.style.visibility = whole ? 'hidden' : '';
  D.modePage.dataset.mode = mode;
  D.modePage.classList.toggle('scrolls', mode === 'personas');
  if (!whole) {
    painted = null;
    return;
  }
  put(mode === 'boards' ? boardPage() : personasPage(), D.modePage);
  if (mode === 'boards') {
    const { board } = boardNow();
    const sheet = D.modePage.querySelector('[data-board-sheet]');
    if (board && sheet) paintView(sheet, viewOf(board.id));
    if (board && readPlace().board !== board.id) {
      readPlace().board = board.id;
      keepPlace();
    }
  }
  // Personas comes back scrolled to where it was left, once, as it is shown.
  if (mode === 'personas' && painted !== 'personas')
    D.modePage.scrollTop = readPlace().personas ?? 0;
  painted = mode;
}

/** The page element, built once beside the bar and the side panel. */
export function buildModePage(top) {
  D.modePage = document.createElement('main');
  D.modePage.dataset.testid = 'modes.page';
  D.modePage.dataset.theme = 'blueprint';
  D.modePage.className = 'modes-page text-base-content';
  D.modePage.style.cssText = `position:absolute; top:${top}px; left:0; right:0; bottom:0; display:none; pointer-events:auto; z-index:2;`;
  D.modePage.addEventListener('scroll', () => {
    if (modeNow() !== 'personas') return;
    readPlace().personas = D.modePage.scrollTop;
    keepPlace();
  });
  D.host.appendChild(D.modePage);
}
