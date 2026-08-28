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

/*
 * The two blocks that used to sit in the middle of this file as generated
 * copies — the shared screen matcher and the conversation model — are
 * imports now. They were copies because a self-contained script cannot
 * import anything and three hand-written near-matches of "which screen is
 * this?" is exactly the drift walkdown exists to catch. Rollup makes the
 * copy unnecessary without making the delivery any less self-contained: it
 * inlines both modules into the one file that ships.
 *
 * embed.js still carries the generated copies. It has no bundler yet, and
 * tools/sync-shared.mjs still keeps it honest.
 */
import { locationOfUrl, matchScreen } from '../../lib/screen-match.js';
import { MSG } from '../../lib/message-stream.js';
import { icon } from './icons.js';
import {
ACTOR_KEY, CHOICE, D, GAP, HEAD, IDENTITY_KEY, REINJECTS, S, STYLESHEET, TOP, W,
cfg, identityOverride, saveIdentity, script, store,
} from './state.js';
import { closeShots, openShots, shotsOpen } from './shots.js';
import { toast } from './toast.js';
import { api, esc } from './util.js';
import {
CHIP, LBL, TERMINAL, isHeadless, needsYou, owedRows, ruleScreen, screenById,
shortName, threadTouched, threadsFor, whoAmI,
} from './vocab.js';
import {
  askAboutSitting, blueprintsPane, crossTo, wireBlueprints,
} from './blueprints.js';
import { DESK_DEFAULTS, DESK_KEY, drawDesk } from './desk.js';
import { backFromThread, threadCard, threadPane } from './thread-pane.js';
import { checkRefs, detailPane, evidenceRows, loadCheckSource } from './rule-detail.js';
import { screensPane, wireScreens } from './screens.js';
import {
  listPane, paintRules, ruleState, searchBox, tierMarks, wireRuleRows, wireSearch,
} from './rules-list.js';
import { threadFilterBar, threadsMatching, threadsPane } from './threads-list.js';
import { frameLoading, hideVeil, placeVeil, screenLabel, veilIsUp } from './veil.js';

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
 * The blueprint rides along as a query parameter — and it has to go BEFORE
 * any fragment, or the fragment swallows it: "#invite-batch?bp=..." is one
 * fragment named that, not a query, so the server never sees the blueprint
 * and the screen never sees its own fragment.
 */

// ---- chrome ---------------------------------------------------------------
function buildChrome() {
  D.shell = document.createElement('div');
  // The embed reads this to know the panel is walkdown's own chrome and not a
  // place to drop a pin. A click inside the shadow root retargets to this host
  // element, so marking the shell covers everything the panel draws.
  D.shell.dataset.walkdownChrome = '';
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
  D.shell.style.cssText = `position:fixed; inset:0; z-index:2147483000; pointer-events:none;
    width:100%; height:100%; max-width:none; max-height:none; margin:0; border:0; padding:0;
    background:transparent; overflow:visible;`;
  D.sr = D.shell.attachShadow({ mode: 'open' });
  document.body.appendChild(D.shell);


  // A transparent frame over the viewport. It must NOT carry data-theme:
  // daisyUI paints background-color on every [data-theme] element, so a
  // full-viewport carrier would cover the page it is supposed to be framing.
  // The theme goes on the two opaque surfaces instead, which is where the
  // background belongs anyway.
  D.host = document.createElement('div');
  D.host.className = 'h-full w-full text-sm';
  /*
   * The one thing a shadow root does NOT keep out: inheritance. A host page
   * with `* { letter-spacing: 3px }` - or a text-transform, or a word-spacing -
   * sets it on our shell element like any other, and it flows down into every
   * word walkdown draws. Styling `:host` cannot fix it either: for the host
   * element, the document's own rules win. So the reset lives here, on our
   * first element INSIDE the boundary, where the host page has no reach.
   */
  D.host.style.cssText = 'letter-spacing:normal; word-spacing:normal; text-transform:none; font-variant:normal; font-style:normal; text-indent:0; text-shadow:none; white-space:normal; word-break:normal; text-align:left; direction:ltr; text-decoration:none;';
  D.sr.appendChild(D.host);

  // The two pieces of chrome are built once and filled by render(): the docking
  // transforms live on them, and a rebuild must never throw the panel back on
  // screen after you have put it away.
  // The bar carries no surface of its own — background:transparent overrides
  // the one daisyUI paints on every [data-theme] element — so the drafting
  // grid runs unbroken behind the controls and under the panel beside them.
  D.bar = document.createElement('header');
  D.bar.dataset.testid = 'panel.bar';
  D.bar.dataset.theme = 'blueprint';   // walkdown's own skin — see styles/walkdown.css
  D.bar.style.cssText = `position:absolute; top:0; left:0; right:0; height:${TOP}px;
    pointer-events:auto; transition:transform .2s ease; background:transparent;`;
  D.bar.className = 'flex items-center gap-2 px-3 text-base-content';

  // The panel is a card lying on the same desk as the page, inset by the same
  // margin — two sheets side by side rather than a sheet and a wall.
  D.side = document.createElement('aside');
  D.side.dataset.theme = 'blueprint';
  D.side.style.cssText = `position:absolute; top:${HEAD}px; right:${GAP}px; bottom:${GAP}px;
    width:${W}px; pointer-events:auto; transition:transform .22s ease; border-radius:10px;
    box-shadow:0 1px 2px rgba(0,0,0,.28), 0 12px 32px rgba(0,0,0,.34);`;
  D.side.className = 'flex flex-col overflow-hidden border border-primary/45 bg-base-100 text-base-content';
  D.host.append(D.bar, D.side);

  /*
   * The desk tuner. A separate element rather than part of the bar's innerHTML
   * for the same reason the fade slider needed `dragging`: the bar is rebuilt
   * wholesale, and rebuilding an input mid-drag kills the drag. This panel is
   * built once and only shown or hidden, so its sliders survive anything.
   */
  D.deskPanel = document.createElement('div');
  D.deskPanel.dataset.testid = 'settings.panel';
  D.deskPanel.dataset.theme = 'blueprint';
  D.deskPanel.className = 'w-64 rounded-box border border-primary/45 bg-base-100 p-3 text-base-content shadow-xl';
  // Offset past the app's own top-left corner on purpose — flush against it
  // read as though the tuner belonged to the app's layout rather than to the
  // desk it sits on. One GAP beyond the corner on each axis, so it stands off
  // evenly rather than drifting further from one side than the other.
  D.deskPanel.style.cssText = `position:absolute; top:${TOP + GAP}px; left:${GAP * 2}px; display:none; pointer-events:auto;`;
  D.host.appendChild(D.deskPanel);

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
  D.screenPanel = document.createElement('div');
  D.screenPanel.dataset.testid = 'panel.screens-list';
  D.screenPanel.dataset.theme = 'blueprint';
  D.screenPanel.className = 'w-72 overflow-hidden rounded-box border border-primary/45 bg-base-100 py-1 text-base-content shadow-xl';
  D.screenPanel.style.cssText = `position:absolute; top:${TOP + GAP}px; left:${GAP * 2}px; display:none; pointer-events:auto; max-height:60vh; overflow-y:auto;`;
  D.host.appendChild(D.screenPanel);
}

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
function hideApp(on) {
  S.hideAppOn = on;
  const app = D.appFrame;
  // The aside goes with the app rather than staying — it sits on the desk
  // over the page, so leaving it at full strength would still hide most of
  // the ruling behind it. So does the headless cover, which is opaque by
  // design. The bar stays: its buttons have to keep working while you're
  // peeking, and it draws no surface of its own to cover the desk with.
  for (const el of [app, D.side, S.headlessCover]) if (el) el.style.opacity = on ? '0.1' : '';
}

/** A dial's number, click-to-edit: text until clicked, then a real input. */
function editDialValue(dial) {
  const cell = D.deskPanel.querySelector(`#wdp-desk-${dial.k}`);
  if (!cell || cell.querySelector('input')) return;
  const range = D.deskPanel.querySelector(`input[type=range][data-k="${dial.k}"]`);
  cell.innerHTML = `<input type="number" class="input input-xs w-12 px-1 text-right font-mono text-[10.5px]"
    min="${dial.min}" max="${dial.max}" value="${S.desk[dial.k]}">`;
  const inp = cell.querySelector('input');
  inp.focus();
  inp.select();
  const commit = () => {
    const v = Math.min(dial.max, Math.max(dial.min, Number(inp.value) || 0));
    S.desk[dial.k] = v;
    range.value = v;
    store.set(DESK_KEY, { ...S.desk });
    if (S.docked) paintDesk(true);
    cell.textContent = `${v}${dial.unit}`;
  };
  inp.onblur = commit;
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') inp.blur();
    if (e.key === 'Escape') {
      // Cancel the edit rather than the tuner — the outer Escape handler
      // would otherwise close the whole panel from under an open edit.
      e.stopPropagation();
      cell.textContent = `${S.desk[dial.k]}${dial.unit}`;
    }
  };
}

/*
 * The roles somebody could sign in. eng and product are always offered - they
 * are the two the ledger itself knows about - and anything else this
 * blueprint's rules ask for joins them, so a team that names a third role
 * sees it here rather than in a patch to this file.
 */
const knownRoles = () => [...new Set(['eng', 'product',
  ...(S.data?.rows ?? []).flatMap((r) => (r.acceptance ?? []).map((a) => a.role))])];

/** The gear panel is Settings: who you record as, then the desk ruling. */
function openActorSettings() {
  S.deskOpen = true;
  syncDeskPanel();
  D.deskPanel.querySelector('#wdp-set-actor')?.focus();
}

function buildDeskPanel() {
  D.deskPanel.innerHTML = `
    <div class="mb-2 flex items-center gap-2">
      <span class="text-[12px] font-semibold">Record as</span>
      <input id="wdp-set-actor" data-testid="settings.actor" class="input input-xs ml-auto w-36" placeholder="username"
        value="${esc(identityOverride.username ?? S.session?.actor ?? S.data?.identity?.username ?? '')}"
        title="Walkdown verdicts, sign-offs and thread actions are recorded under this username">
    </div>
    <!-- The display name. Shown everywhere in the UI, recorded nowhere - so
         someone whose git has no full name loses nothing but the nicety, and
         someone who has one is not silently filed under it. Both are
         editable, including from empty, on the honour system (n-0104). -->
    <div class="mb-2 flex items-center gap-2">
      <span class="text-[12px] font-semibold">Full name</span>
      <input id="wdp-set-name" data-testid="settings.display-name" class="input input-xs ml-auto w-36" placeholder="optional"
        value="${esc(identityOverride.name ?? S.data?.identity?.name ?? '')}"
        title="How you are shown in the panel. Records still carry the username.">
    </div>
    <!-- Which hats you sign in. Checkboxes rather than a picker because
         plenty of people are more than one thing - Topher signs as both eng
         and product - and a control that made you choose would make the
         board wrong about who has accepted what. The list is the roles this
         blueprint's rules actually name, so a team that invents one gets it
         here without anybody editing this file. -->
    <div class="mb-2 flex items-start gap-2">
      <span class="shrink-0 text-[12px] font-semibold">Signs as</span>
      <span class="ml-auto flex w-36 flex-wrap gap-x-3 gap-y-1">
        ${knownRoles().map((r) => `<label class="flex cursor-pointer items-center gap-1 text-[11.5px]">
          <input type="checkbox" class="checkbox checkbox-xs" data-testid="settings.roles"
            data-role="${esc(r)}" ${(identityOverride.roles ?? []).includes(r) ? 'checked' : ''}>
          <span>${esc(r)}</span></label>`).join('')}
      </span>
    </div>
    <p class="mb-1 text-[10.5px] leading-relaxed opacity-40">Records carry the
      username; the full name is only how you are shown. Clear either to go
      back to what git says. A sign-off recorded without a role is read as
      eng.</p>
    <div class="mb-2 mt-3 flex items-center gap-2 border-t border-base-300 pt-2">
      <span class="text-[12px] font-semibold">Desk ruling</span>
      <button class="btn btn-xs btn-ghost ml-auto" id="wdp-desk-reset">Reset</button>
    </div>
    ${DESK_DIALS.map((d) => `
      <label class="mb-1.5 flex items-center gap-2 text-[11.5px]">
        <span class="w-14 shrink-0 opacity-60">${d.label}</span>
        <input type="range" class="range range-xs range-primary" data-testid="settings.dials" data-k="${d.k}"
          min="${d.min}" max="${d.max}" value="${S.desk[d.k]}" aria-label="${d.label}">
        <span class="w-12 shrink-0 cursor-text text-right font-mono text-[10.5px] opacity-60 hover:opacity-100"
          id="wdp-desk-${d.k}" title="Click to type a value">${S.desk[d.k]}${d.unit}</span>
      </label>`).join('')}
    <label class="mt-1 flex items-center gap-2 text-[11.5px]">
      <input type="checkbox" class="checkbox checkbox-xs" data-testid="settings.hide" id="wdp-desk-hide" ${S.hideAppOn ? 'checked' : ''}>
      <span>Hide app temporarily</span>
    </label>
    <p class="mt-2 text-[10.5px] leading-relaxed opacity-40">Yours alone — how the paper
      lies changes nothing about what gets verified.</p>`;
  D.deskPanel.querySelectorAll('input[type=range]').forEach((inp) => {
    const dial = DESK_DIALS.find((d) => d.k === inp.dataset.k);
    // input repaints live under the drag; change is when the value is kept.
    inp.oninput = () => {
      S.desk[dial.k] = Number(inp.value);
      D.deskPanel.querySelector(`#wdp-desk-${dial.k}`).textContent = `${S.desk[dial.k]}${dial.unit}`;
      if (S.docked) paintDesk(true);
    };
    inp.onchange = () => store.set(DESK_KEY, { ...S.desk });
  });
  DESK_DIALS.forEach((d) => {
    D.deskPanel.querySelector(`#wdp-desk-${d.k}`).onclick = () => editDialValue(d);
  });
  D.deskPanel.querySelector('#wdp-desk-reset').onclick = () => {
    S.desk = { ...DESK_DEFAULTS };
    store.set(DESK_KEY, { ...S.desk });
    buildDeskPanel();
    if (S.docked) paintDesk(true);
  };
  D.deskPanel.querySelector('#wdp-desk-hide').onchange = (e) => hideApp(e.target.checked);
  const act = D.deskPanel.querySelector('#wdp-set-actor');
  act.onchange = () => {
    /*
     * An emptied field is an explicit answer, not the absence of one: it
     * means "nobody", and the panel then refuses attributed work under it
     * (panel.threads.claim-never-accept). Reverting to git's answer is
     * retyping it - which is cheap, and a good deal less surprising than a
     * box that silently refills itself with a name you just removed.
     */
    identityOverride.username = act.value.trim();
    saveIdentity();
    // A running sitting is re-signed, the way the single field always did -
    // the verdicts already in it have not been sealed into a run yet.
    if (S.session) { S.session.actor = whoAmI(); saveSession(); }
    render();
  };
  /*
   * The roles are kept as a set, so unticking the last one leaves an empty
   * array rather than nothing said - "I sign as none of these" is an answer.
   * Nothing repaints: no run record reads this yet, and a panel that redrew
   * itself would only be claiming otherwise.
   */
  const boxes = [...D.deskPanel.querySelectorAll('input[data-testid="settings.roles"]')];
  boxes.forEach((box) => {
    box.onchange = () => {
      identityOverride.roles = boxes.filter((b) => b.checked).map((b) => b.dataset.role);
      saveIdentity();
    };
  });
  const nam = D.deskPanel.querySelector('#wdp-set-name');
  nam.onchange = () => {
    // Emptied here means "show me by my username" - the honest answer for
    // someone who does not want a full name on screen.
    identityOverride.name = nam.value.trim();
    saveIdentity();
    render();   // nothing recorded moves: this name is only ever shown
  };
}

function syncDeskPanel() {
  if (S.deskOpen) buildDeskPanel();
  else hideApp(false);   // closing the tuner ends the peek, not just hides the checkbox
  D.deskPanel.style.display = S.deskOpen ? '' : 'none';
}

const closeDeskPanel = () => { S.deskOpen = false; syncDeskPanel(); };

/*
 * The screen picker's contents are the list the Screens tab used to draw,
 * unchanged - the same radio rows, the same "Detect from the page" reset at
 * the top. It is placed under its own button because the bar's left side is
 * as wide as the project's name, and clamped to the stage so a long
 * storyboard cannot run the list off the right edge.
 *
 * Called on every repaint of the bar as well as on opening, because the list
 * is an answer and not a snapshot: in Detect mode both the button's label and
 * the row the list marks are reporting which screen the page IS, and a page
 * that moves under an open list has to move the list with it (n-0107).
 */
function syncScreenPanel() {
  if (S.screensOpen) {
    // Rebuilt in place, so a long storyboard keeps its scroll: this now runs
    // on every repaint, and a list that jumped back to the top whenever the
    // panel drew would be worse than one that lagged.
    const wasAt = D.screenPanel.scrollTop;
    D.screenPanel.innerHTML = screensPane();
    wireScreens(D.screenPanel);
    D.screenPanel.scrollTop = wasAt;
    const btn = D.bar.querySelector('#wdp-screen-btn');
    if (btn) {
      const at = btn.getBoundingClientRect();
      const wide = D.screenPanel.offsetWidth || 288;
      D.screenPanel.style.left = `${Math.max(GAP * 2, Math.min(at.left, innerWidth - wide - GAP * 2))}px`;
    }
  }
  D.screenPanel.style.display = S.screensOpen ? '' : 'none';
}

export const closeScreenPanel = () => { S.screensOpen = false; syncScreenPanel(); };

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
  if (S.screensOpen) {
    const btn = D.bar.querySelector('#wdp-screen-btn');
    const mine = path.includes(D.screenPanel) || (btn && path.includes(btn));
    if (!mine) closeScreenPanel();
  }
  if (S.deskOpen) {
    const gear = D.bar.querySelector('#wdp-desk-btn');
    const mine = path.includes(D.deskPanel) || (gear && path.includes(gear));
    if (!mine) closeDeskPanel();
  }
}



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
function loadStylesheet() {
  fetch(STYLESHEET)
    .then((r) => r.text())
    .then((css) => {
      const sheet = document.createElement('style');
      // The conversation's own rules ride with the stylesheet: one shared
      // block, so a thread looks the same in the panel and in the embed.
      sheet.textContent = css + MSG.css;
      D.sr.insertBefore(sheet, D.host);
      // The desk was painted from fallbacks before the theme existed; now that
      // the tokens resolve, paint it in walkdown's actual colours.
      if (S.docked) paintDesk(true);
      const props = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g);
      if (props) {
        const doc = document.createElement('style');
        doc.setAttribute('data-walkdown-property-registrations', '');
        doc.textContent = props.join('');
        document.head.appendChild(doc);
      }
    })
    .catch(() => { /* unstyled beats absent; the panel still works */ });
}

/*
 * The two controls that survive the chrome being put away: the pull tab
 * that brings it back, and the prototype/app cross beside it.
 */
function buildPutAwayControls() {
  D.tab = document.createElement('button');
  D.tab.dataset.walkdownChrome = '';
  D.tab.textContent = 'WALKDOWN';
  D.tab.style.cssText = `position:fixed; right:0; top:50%; z-index:2147483000; transform:translateY(-50%);
    background:#16181d; color:#fff; border:0; border-radius:8px 0 0 8px; padding:11px 7px; cursor:pointer;
    font:600 11px/1 -apple-system, sans-serif; writing-mode:vertical-rl; letter-spacing:.08em; display:none;`;
  D.tab.onclick = () => setDocked(true);
  document.body.appendChild(D.tab);

  /*
   * Beside the tab, a way to cross between the design and what shipped without
   * opening anything (n-0072). Comparing the two is the most frequent gesture
   * there is, and with the panel put away it otherwise costs re-opening the
   * whole thing to reach the fade control - the cheapest comparison behind the
   * most expensive move. It says the surface it will take you TO, because a
   * control that names where you already are gives you nothing to act on.
   */
  D.swap = document.createElement('button');
  D.swap.dataset.walkdownChrome = '';
  D.swap.dataset.testid = 'panel.tab-swap';
  D.swap.style.cssText = `position:fixed; right:0; top:50%; z-index:2147483000;
    background:#2b303a; color:#fff; border:0; border-radius:8px 0 0 8px; padding:9px 7px; cursor:pointer;
    font:600 10px/1 -apple-system, sans-serif; writing-mode:vertical-rl; letter-spacing:.08em; display:none;`;
  D.swap.onclick = () => {
    const share = S.protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
    setFade(share === 1 ? 0 : 1);
    paintTabs();
  };
  document.body.appendChild(D.swap);
}

/*
 * The put-away controls, kept in step: the swap only appears when there is a
 * design on file to cross to, and it is stacked clear of the tab rather than
 * centred on top of it.
 */
function paintTabs() {
  // Called from setDocked, which runs at boot before any blueprint is in
  // hand. Nothing here is worth an exception on the way up.
  if (!S.data) { D.swap.style.display = 'none'; return; }
  if (!S.docked) {
    const tabH = D.tab.getBoundingClientRect().height || 96;
    D.tab.style.transform = `translateY(calc(-50% - ${Math.round(tabH / 2) + 4}px))`;
    const canGhost = Boolean(ghostSource(screenInHand()));
    D.swap.style.display = canGhost ? 'block' : 'none';
    const share = S.protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
    const goingTo = share === 1 ? 'APP' : 'PROTOTYPE';
    D.swap.textContent = goingTo;
    D.swap.title = `Show the ${goingTo.toLowerCase()} instead`;
    const swapH = D.swap.getBoundingClientRect().height || 80;
    D.swap.style.transform = `translateY(calc(-50% + ${Math.round(swapH / 2) + 4}px))`;
  } else {
    D.tab.style.transform = 'translateY(-50%)';
    D.swap.style.display = 'none';
  }
}

/*
 * Framed: the application is a frame of ours, laid on the desk exactly where
 * the docked layout lays the host page. Everything downstream — the ghost's
 * geometry, the fade, the pin plumbing — measures the same rectangle either
 * way, so only this differs.
 */
function buildAppFrame() {
  D.appFrame = document.createElement('iframe');
  D.appFrame.src = S.frameUrl;
  D.appFrame.dataset.testid = 'panel.app-frame';
  D.appFrame.setAttribute('title', 'the application under review');
  // Whatever the frame lands on - our navigation or the app's own - the wait
  // is over. Errors never fire load, and a frame that never arrives is still
  // loading, which is what the veil should keep saying.
  D.appFrame.addEventListener('load', hideVeil);
  document.body.appendChild(D.appFrame);
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
  const availW = S.docked ? innerWidth - (W + GAP * 3) : innerWidth;
  const availH = S.docked ? innerHeight - (HEAD + GAP) : innerHeight;
  const scale = S.viewportW ? Math.min(1, availW / S.viewportW) : 1;
  return { availW, availH, scale };
}

/*
 * The ghost lies exactly where the app frame lies - it is the same sheet,
 * showing the other surface - so it is placed by the same rules and at the
 * same moments. Only the frame used to be, which is how the design ended up
 * inset over a full-bleed app.
 */
function placeGhost(on) {
  if (!S.ghost) return;
  Object.assign(S.ghost.style, on
    ? { top: `${HEAD}px`, left: `${GAP}px`, right: `${W + GAP * 2}px`,
        bottom: `${GAP}px`, borderRadius: '10px' }
    : { top: '0px', left: '0px', right: '0px', bottom: '0px', borderRadius: '0px' });
  sizeGhost();
}

function placeAppFrame(on) {
  if (!D.appFrame) return;
  // The veil is pinned to the frame's box, so it follows every move of it.
  if (veilIsUp()) requestAnimationFrame(placeVeil);
  const { availW, availH, scale } = frameSpace();
  // An iframe is a replaced element: four insets alone leave it at its
  // intrinsic 300x150, so the size has to be said outright. A viewport
  // preset sizes the frame like a real device: the app lays out at that
  // width, and a viewport wider than the space scales down WHOLE - a
  // desktop layout seen as a desktop layout, never reflowed to a column.
  D.appFrame.style.cssText = on
    ? (S.viewportW
      ? `position:fixed; top:${HEAD}px;
         left:${GAP + Math.max(0, (availW - S.viewportW * scale) / 2)}px;
         width:${S.viewportW}px; height:${availH / scale}px;
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
  const show = S.docked && S.viewportW;
  if (!show) { zoomBadge?.remove(); zoomBadge = null; return; }
  if (!zoomBadge) {
    zoomBadge = document.createElement('div');
    zoomBadge.dataset.testid = 'panel.zoom';
    document.body.appendChild(zoomBadge);
  }
  const { scale } = frameSpace();
  zoomBadge.textContent = scale < 1
    ? `${S.viewportW}px · fit ${Math.round(scale * 100)}%`
    : `${S.viewportW}px`;
  zoomBadge.style.cssText = `position:fixed; right:${W + GAP * 2 + 10}px; bottom:${GAP + 10}px;
    z-index:2147482001; padding:4px 9px; border-radius:99px;
    font:600 10.5px/1 -apple-system, system-ui, sans-serif;
    background:rgba(20,25,40,.75); color:#fff; pointer-events:none;`;
}

/** Size the frame like a real device; the ghost always follows. */
function setViewport(w) {
  S.viewportW = w;
  S.ghostWidth = w;
  if (S.docked) paintDesk(true);
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
  if (S.ghost) {
    const share = S.protoShare ?? (pageSurface() === 'prototype' ? 0 : 1);
    setGhost(false);
    setFade(share);
  }
  /*
   * Say the peek again, because this function just wiped it.
   *
   * Placement writes style.cssText wholesale - it has to, for the transition -
   * and that drops the inline opacity the peek set. paintDesk already knew
   * this and re-asserted afterwards, so dragging a dial kept the peek; every
   * OTHER route through here did not, so using any control in the bar put the
   * app back to full strength while the checkbox stayed ticked. The control
   * that means "a way of looking" was left lying about what you were looking
   * at (found by an agent walkdown, 2026-08-28).
   *
   * Re-asserting here rather than at each caller because the wipe happens
   * here: a new caller should not have to know it owes the peek a repair.
   */
  if (S.hideAppOn) hideApp(true);
  renderBar();
}


/*
 * Our own document: there is no host page to inset or to put back, only a
 * desk to paint and a frame to place on it. Until 2026-08-26 this function
 * had a second half that inset the host page and restored it on the way
 * out; the docked-into-the-application layout it served is gone, and with
 * it the only caller that could ever reach that code.
 */
function paintDesk(on) {
  const root = document.documentElement, page = document.body;
  const cs = getComputedStyle(D.side);
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
  if (S.hideAppOn) hideApp(true);
  syncHeadlessCover();
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


function setDocked(on) {
  S.docked = on;
  D.bar.style.transform = on ? 'none' : `translateY(-${TOP}px)`;
  D.side.style.transform = on ? 'none' : `translateX(calc(100% + ${GAP}px))`;
  D.tab.style.display = on ? 'none' : 'block';
  // Nothing the bar opens outlives the bar: put away, neither the tuner nor
  // the screen picker has anything left to hang off.
  if (!on) { S.deskOpen = false; syncDeskPanel(); closeScreenPanel(); }
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

/*
 * Screen identity, shared verbatim with the embed and the server so a pin
 * cannot land on one screen here and a different one there.
 */
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
const hereLocation = () => locationOfUrl(S.frameUrl) ?? {};

export function pageSurface() {
  const sc = currentScreen();
  if (!sc) return 'app';
  return matchScreen([sc], hereLocation())?.surface ?? 'app';
}

/** Which storyboard screen this page is, by URL — same trick the embed uses. */
export function currentScreen() {
  const screens = S.data?.storyboard ?? [];
  if (S.pickedScreen) return screens.find((s) => s.id === S.pickedScreen) ?? null;
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
  const arrived = S.pickedScreen && matchScreen(
    (S.data?.storyboard ?? []).filter((s) => s.id === S.pickedScreen), hereLocation())?.screen;
  S.pickedScreen = arrived ? S.pickedScreen : null;
  S.ghostOverride = null;
  if (S.phase !== 'ready') return;
  if (S.protoShare === null) setGhost(false);
  else setFade(S.protoShare);
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
  S.data = await res.json();
  // Re-resolve against the reloaded data: the old object is a stale copy, so
  // holding it would show yesterday's verdict and threads.
  if (S.selected) S.selected = S.data.rows.find((r) => r.rule === S.selected.rule) ?? null;
  await loadSeen();
  await restoreSession();
  render();
  // The surfaces carry the pins, so they have to hear about a thread that
  // has just ended - a verified note leaves the page it was pinned to,
  // rather than sitting there until something else happens to refresh it.
  if (S.phase === 'ready') pushContexts();
}

/**
 * Bring back an unfinished session the last page or extension unload ate.
 * The project's draft wins over the browser's copy: it is the one another
 * window, another browser, or `walkdown status` can also see, so trusting it
 * is what makes "the sitting is on disk" true rather than nearly true.
 */
async function restoreSession() {
  if (S.session) return;
  const local = await store.get(SESSION_KEY()).catch(() => null);
  const saved = (S.data?.draft?.verdicts && S.data.draft) || local;
  if (saved?.verdicts && Object.keys(saved.verdicts).length)
    S.session = {
      verdicts: saved.verdicts, threads: saved.threads ?? {},
      actor: saved.actor ?? whoAmI(),
      started: saved.started ?? new Date().toISOString(),
    };
}

/*
 * Where a surface goes when the page is not a screen. Without this the fade
 * control was dead everywhere except the handful of pages walkdown happens to
 * recognise - so crossing between the design and the build, the single most
 * frequent thing a reviewer does, depended on where you already were.
 */
const defaultScreen = () =>
  screenById(S.data?.defaultScreen) ??
  (S.data?.storyboard ?? []).find((sc) => screenUrl(sc, 'app') ?? screenUrl(sc, 'prototype')) ?? null;

/** The screen a surface control should act on: this page, or the front door. */
const screenInHand = () => screenById(S.ghostOverride) ?? currentScreen() ?? defaultScreen();

/**
 * What the ghost should draw for a screen: the design if there is one, and
 * otherwise a proposal sketch — flagged, because a sketch that reads as the
 * design is exactly the confusion the ownership rules exist to prevent.
 */
export function ghostSource(screen) {
  if (pageSurface() === 'prototype') {
    // Standing on the design, the other surface is the running app — and it
    // lives at its own origin, so the ghost takes an absolute URL.
    return screen?.app?.path && S.data.appBase
      ? { url: S.data.appBase + screen.app.path, proposed: false }
      : null;
  }
  if (screen?.prototype && S.data.hasPrototype) return { path: '/prototype' + screen.prototype, proposed: false };
  if (screen?.proposal) return { path: '/proposals' + screen.proposal, proposed: true };
  return null;
}

/** Short verbs, and only the transitions this kind and status allow. */
export function threadActions(t) {
  if (t.kind === 'note') {
    if (t.status === 'open') return [['Addressed', 'addressed'], ['Waive', 'waived', true]];
    if (t.status === 'addressed') return [['\u2713 Verify', 'verified'], ['Reopen', 'open'], ['Waive', 'waived', true]];
  } else {
    if (t.status === 'open') return [['Answer', '__answer'], ['Waive', 'waived', true]];
    if (t.status === 'answered') return [['Incorporated', 'incorporated'], ['Reopen', 'open'], ['Waive', 'waived', true]];
  }
  return [];
}

// ---- render ---------------------------------------------------------------
export function render() {
  if (!S.data) return;
  // The thread screen without a thread is not a screen.
  if (S.view === 'thread' && !S.openThread) S.view = S.selected ? 'detail' : 'list';
  // render() rebuilds the panel wholesale, which resets scroll. Clicking a
  // control near the bottom of a long thread would otherwise throw you back
  // to the top — so note where each pane was and put it back. Read live, not
  // from a record kept by scroll events: those fire AFTER the position has
  // already moved, so a record would sometimes be the staler of the two.
  const wasAt = [...D.host.querySelectorAll('.wdp-pane')].map((p) => p.scrollTop);
  // Typing must survive a repaint: a composer that loses the caret mid-reply
  // is the difference between a conversation and a form.
  const typing = D.sr.activeElement;
  const caret = ['wdp-note', 'wdp-search'].includes(typing?.id)
    ? { id: typing.id, start: typing.selectionStart, end: typing.selectionEnd } : null;
  const total = S.data.rows.length;
  const verified = S.data.rows.filter((r) => r.verdict === 'pass').length;
  /*
   * A sitting's verdicts are not in the ledger until Finish, so the footer
   * used to sit frozen through the very work it is meant to be counting -
   * "23 of 83 verified" three inches under "34 judged", which reads as a
   * broken number rather than as two different facts. The work in hand is
   * now counted separately and marked as not yet recorded, and a rule judged
   * this sitting stops being listed as owed, because it is not.
   */
  const judged = new Set(Object.keys(S.session?.verdicts ?? {}));
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
  const onThreads = S.listTab === 'threads';
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
    // px-3 sits mid-list on purpose. Tailwind scans this file as text, and a
    // utility written flush against a \${…} is not a candidate it can see -
    // a px-4 sat here for months and never reached the built sheet at all,
    // so the tabs ran on daisyUI's own padding and read as squished
    // (n-0102). Once the class was real, px-4 turned out to be too much:
    // three tabs, two of them carrying a count badge, wrap at 384px.
    `<button role="tab" class="tab px-3 gap-1${S.listTab === id ? ' tab-active' : ''}" data-tab="${id}">
      ${icon(TAB_ICON[id], 'size-4')}${label}${badge
        ? `<span class="badge badge-xs ${tone}" title="${esc(why)}">${badge}</span>`
        : ''}</button>`;
  D.side.innerHTML = `
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
         silently) but editing it lives in Settings - the strip only shows it.

         Only over the Rules tab, because everything in the strip is about
         the rules: whose name the verdicts go under, how many of them are
         judged, and which rule is next. Over the thread list or the
         blueprint picker it was a header describing a list you were not
         looking at, and Continue would have walked you off the tab you had
         just opened (n-0101). -->
    ${S.session && S.listTab === 'rules' ? `<div class="flex items-center gap-2 border-b border-base-300 bg-warning/10 px-3.5 py-2 text-xs" data-testid="panel.actor">
      <!-- Two facts, because they are two fields now (n-0104): the name you
           go by, and the username the ledger will actually carry. The handle
           stays on screen rather than only in Settings, because a defaulted
           identity has to be visible BEFORE it is used - that is
           panel.identity.attribution-visible, and showing only a full name
           while recording a handle would quietly break it. With no full name
           anywhere the two are the same string and only one is drawn. -->
      <span>Recording as
        <button id="wdp-actor" data-testid="panel.actor-name" class="link font-semibold" title="Change the name in Settings (the gear)">${
          esc(recordingDisplay() || 'set your name…')}</button>${
          recordingHandle() && recordingHandle() !== recordingDisplay()
            ? ` <span data-testid="panel.actor-handle" class="font-mono opacity-60" title="Verdicts and thread actions are recorded under this username">${
                esc(recordingHandle())}</span>`
            : ''}</span>
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
        <!-- The first seat is a column, not a scroller: the search box sits
             ABOVE the scrolling part rather than inside it. Sticky was tried
             and is the wrong tool here - the pane itself is what scrolls, so
             a sticky child sticks to a viewport that is already moving with
             it. Taking the box out of the scrolling wrapper is the whole
             trick, and it costs nothing. One .wdp-pane in this seat either
             way, so scroll restoration still lines up by index. -->
        <div class="flex min-h-0 w-1/3 flex-[0_0_33.3333%] flex-col overflow-hidden"
             data-testid="${onThreads ? 'panel.threads-list' : S.listTab === 'rules' ? 'panel.rules-list' : 'panel.blueprints-list'}">
          ${onThreads ? threadFilterBar() : S.listTab === 'rules' ? searchBox() : ''}
          <div class="wdp-pane wdp-list flex min-h-0 flex-1 flex-col overflow-y-auto">${
            onThreads ? threadsPane()
            : S.listTab === 'blueprints' ? blueprintsPane()
            : listPane()}</div>
        </div>
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
    <!-- Every number here is derived from something, and a bare number told a
         newcomer nothing about how it got there or what is left (n-0091). So
         each one carries a tooltip saying what it counts, in the same words
         the rule detail uses. daisyUI tooltips rather than a title attribute:
         the footer is the last row in the panel and a native tooltip opens
         below the window edge, where nobody can read it.

         Upwards, and aligned to its label rather than centred on it: this is
         the last row in the panel, so a bubble opening downwards or sideways
         is cut off by the bottom of the window, and a bubble centred on a
         short label at either end of a 384px panel hangs off the side.
         daisyUI's own tooltip-start / tooltip-end do the aligning; the
         --tt-trans they leave at -50% has to be zeroed with them, or the
         bubble is pinned to the edge and then dragged half its width back
         over it.

         The row no longer dims as a whole - opacity on the container dimmed
         the tooltips it opens with it, and opacity cannot be undone by a
         child. The label carries its own. -->
    ${S.listTab === 'rules' ? `<div class="flex shrink-0 items-center gap-2 border-t border-base-300 px-3.5 py-2 text-xs" data-testid="panel.counts">
      <span class="tooltip tooltip-top tooltip-start [--tt-trans:0] shrink-0 whitespace-nowrap">
        <span class="tooltip-content w-52 whitespace-normal text-left text-[11.5px] leading-snug"
          >Rules holding a current pass on every tier they ask for. The rest are the work counted at the right.</span>
        <span class="opacity-70"><b>${verified}/${total}</b> verified</span></span>${
        judged.size ? `<span class="tooltip tooltip-top tooltip-start [--tt-trans:0] shrink-0 text-primary">
        <span class="tooltip-content w-52 whitespace-normal text-left text-[11.5px] leading-snug"
          >Judged by you in this sitting. Nothing reaches the ledger until you press Finish walkdown.</span>
        <b>+${judged.size}</b></span>` : ''}
      <span class="ml-auto flex shrink-0 gap-1">
        ${toSign ? `<span class="tooltip tooltip-top tooltip-end [--tt-trans:0]">
          <span class="tooltip-content w-52 whitespace-normal text-left text-[11.5px] leading-snug"
            >${toSign} rule${toSign === 1 ? '' : 's'} designed but not built. Your sign-off on the spec is what they wait for.</span>
          <span class="badge badge-xs badge-warning badge-outline">${toSign} sign</span></span>` : ''}
        ${toWalk ? `<span class="tooltip tooltip-top tooltip-end [--tt-trans:0]">
          <span class="tooltip-content w-52 whitespace-normal text-left text-[11.5px] leading-snug"
            >${toWalk} rule${toWalk === 1 ? '' : 's'} built and unjudged by you. Open one and give it a pass or a fail.</span>
          <span class="badge badge-xs badge-warning badge-outline">${toWalk} walk</span></span>` : ''}
      </span>
    </div>` : ''}`;

  const track = D.host.querySelector('.wdp-track');
  if (track) {
    // A rebuilt element has no state to transition from, so paint where we
    // were, flush that, then move. A rAF is not enough — the browser
    // coalesces both states into one recalc and the slide is skipped.
    const AT = { list: '0%', detail: '-33.3333%', thread: onThreads ? '-33.3333%' : '-66.6667%' };
    track.style.transition = 'none';
    track.style.transform = `translateX(${AT[S.lastView] ?? '0%'})`;
    void track.offsetWidth;
    track.style.transition = '';
    track.style.transform = `translateX(${AT[S.view] ?? '0%'})`;
    S.lastView = S.view;
  }
  D.host.querySelectorAll('.wdp-pane').forEach((p, i) => { p.scrollTop = wasAt[i] ?? 0; });
  if (caret) {
    const box = D.host.querySelector('#' + caret.id);
    if (box) {
      box.focus();
      box.setSelectionRange(caret.start, caret.end);
    }
  }
  wireRuleRows();
  wireSearch();
  const back = D.host.querySelector('.wdp-back');
  if (back) back.onclick = () => { S.view = 'list'; render(); };
  D.host.querySelectorAll('[data-goto]').forEach((el) => {
    // Through open(), not by assigning `selected`: stepping to a rule is
    // opening it, and a second way in that skipped the trip to its screen
    // meant next/previous quietly judged whatever page you were left on.
    el.onclick = () => open(el.dataset.goto);
  });
  const actorName = D.host.querySelector('#wdp-actor');
  if (actorName) actorName.onclick = openActorSettings;
  const carryOn = D.host.querySelector('#wdp-continue');
  if (carryOn) carryOn.onclick = continueWalkdown;
  D.side.querySelectorAll('[data-tab]').forEach((b) => {
    // Back to the list as well as to the tab: the detail pane is a rule's,
    // and a rule is a thing on the Rules tab. Leaving the track slid over
    // showed the open rule sitting on top of whichever tab you picked.
    b.onclick = () => { S.listTab = b.dataset.tab; S.view = 'list'; render(); };
  });
  D.side.querySelectorAll('[data-tfilter]').forEach((b) => {
    // Changing which threads are listed is not opening one: back to the list,
    // or the filter would quietly re-answer a question about the thread you
    // are reading rather than about the list behind it.
    b.onclick = () => { S.threadFilter = b.dataset.tfilter; S.view = 'list'; render(); };
  });
  wireBlueprints(D.side);
  D.host.querySelectorAll('[data-goscreen]').forEach((el) => {
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
const midFade = () => S.protoShare !== null && S.ghostOpacity > 0 && S.ghostOpacity < 1;

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
  if (S.ghost && S.ghostOpacity === 1) return S.ghostReady ? ghostSurface() : null;
  return pageSurface();
}


/** Repaint the bar's state without rebuilding it — see `dragging`. */
function paintBar() {
  const share = S.protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
  D.bar.querySelectorAll('[data-surface]').forEach((b) => {
    const on = b.dataset.surface === 'prototype' ? share === 1 : share === 0;
    b.classList.toggle('btn-outline', !on);
  });
  const pin = D.bar.querySelector('#wdp-pin');
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
  const gear = D.bar.querySelector('#wdp-desk-btn');
  if (gear) gear.onclick = () => { S.deskOpen = !S.deskOpen; syncDeskPanel(); };
};

function renderBar() {
  if (S.dragging) return paintBar();
  if (S.phase !== 'ready') {
    D.bar.innerHTML = `${GEAR()}<span class="font-bold tracking-tight">walk<span class="text-primary">down</span></span>`;
    return wireGear();
  }
  const canGhost = Boolean(ghostSource(screenInHand()));
  // Left is Prototype and right is App, matching the buttons on either side —
  // so the slider reads 100 at the App end and the value is inverted here.
  const share = S.protoShare ?? (pageSurface() === 'prototype' ? 1 : 0);
  const value = Math.round((1 - share) * 100);
  const pinning = PIN.isOn();
  const atScreen = (S.pickedScreen && screenById(S.pickedScreen)) || currentScreen();
  /*
   * Starting wears the same warning colour as finishing when there is
   * something to walk - the blueprint asking before you have asked it. With
   * nothing owed it drops back to primary: an invitation, not a summons,
   * because a control that is always loud says nothing.
   */
  const owedNow = owedRows().length;
  D.bar.innerHTML = `
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
           esc(S.data.project)}</span>`}
    <!-- Which screen this page is. It reads as the answer, not as a way to
         ask the question: the button is labelled with the screen you are on,
         so the common case costs no click at all. Outlined once a screen has
         been picked by hand, because a hand-picked screen outranks detection
         and the difference has to be visible from the bar. -->
    <button class="btn btn-xs shrink-0 gap-1 px-1.5 font-normal ${
        S.pickedScreen ? 'btn-outline btn-primary' : 'btn-ghost'}"
      id="wdp-screen-btn" data-testid="panel.screen-picker"
      title="${S.pickedScreen
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
        <button class="btn btn-xs join-item ${S.viewportW === 0 ? 'btn-primary' : 'btn-outline btn-primary'}"
          data-vp="0" title="Fit the frame to the space">Fit</button>
        <button class="btn btn-xs join-item ${S.viewportW === 1440 ? 'btn-primary' : 'btn-outline btn-primary'}"
          data-vp="1440" title="Desktop — lay the page out at 1440px">${icon('desktop', 'size-3.5')}</button>
        <button class="btn btn-xs join-item ${S.viewportW === 390 ? 'btn-primary' : 'btn-outline btn-primary'}"
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
      <button class="btn btn-xs ${S.session || owedNow ? 'btn-warning' : 'btn-primary'}" id="wdp-walk" data-testid="panel.walk"
        title="${S.session
          ? 'Record this sitting to the runs ledger under your name'
          : owedNow
            ? `Begin a sitting — ${owedNow} rule${owedNow === 1 ? '' : 's'} owe you a verdict`
            : 'Begin a sitting on this blueprint'}">${
        S.session ? 'Finish walkdown' : 'Start walkdown'}</button>
      <button class="btn btn-xs btn-ghost" id="wdp-undock" title="Put walkdown away">\u00d7</button>
    </span>`;

  wireGear();
  D.bar.querySelector('#wdp-screen-btn').onclick = () => {
    S.screensOpen = !S.screensOpen;
    syncScreenPanel();
  };
  /*
   * The button and the list are one control saying one thing, so they are
   * repainted together. The label above was rebuilt from the page just now;
   * an open list drawn before the page moved would still be marking the
   * screen we left, and in Detect mode still naming it beside "Detect from
   * the page" - the control reporting one answer in the bar and a staler one
   * an inch below it (n-0107). Cheap when it is shut: syncScreenPanel builds
   * nothing unless the list is open.
   */
  syncScreenPanel();
  D.bar.querySelector('#wdp-undock').onclick = () => setDocked(false);
  D.bar.querySelector('#wdp-pin').onclick = () =>
    PIN.set(!PIN.isOn());
  // Start it, or end it: the same button, because it is the same sitting.
  D.bar.querySelector('#wdp-walk').onclick = () => (S.session ? finishWalkdown() : startWalkdown());
  D.bar.querySelectorAll('[data-vp]').forEach((b) => {
    b.onclick = () => setViewport(Number(b.dataset.vp));
  });
  D.bar.querySelectorAll('[data-surface]').forEach((b) => {
    b.onclick = () => {
      /*
       * Off a screen entirely, fading is meaningless - there is no design of
       * THIS page to fade to. So the control takes you to the blueprint's
       * front door on the surface you asked for, which is what someone
       * pressing Prototype from nowhere in particular actually wants.
       */
      const want = b.dataset.surface;
      if (!currentScreen() && !S.ghostOverride) {
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
            esc(home.title ?? home.id)}</a> to compare the ${esc(want)}.`, { tone: 'warning' });
        }
      }
      setFade(want === 'prototype' ? 1 : 0);
    };
  });
  const fade = D.bar.querySelector('#wdp-fade');
  if (fade) {
    // `input` fires all through the drag and must not disturb the element;
    // `change` fires when the pointer (or the keyboard) lets go, and that is
    // where the bar is rebuilt and a ghost at zero is finally torn down.
    fade.oninput = () => { S.dragging = true; setFade(1 - fade.value / 100); };
    fade.onchange = () => {
      S.dragging = false;
      setFade(1 - fade.value / 100);
    };
  }
}

/**
 * One dial, expressed as how much PROTOTYPE is on screen. The ghost carries
 * whichever surface the page is not, so the same 1 means "ghost fully on"
 * standing on the app and "ghost fully off" standing on the prototype.
 */
export function setFade(share) {
  S.protoShare = Math.max(0, Math.min(1, share));
  // The put-away swap names the surface it will take you to, so it follows
  // every crossing however it was made.
  if (!S.docked) queueMicrotask(paintTabs);
  const wanted = pageSurface() === 'prototype' ? 1 - S.protoShare : S.protoShare;
  S.ghostOpacity = wanted;
  // Mid-fade, both surfaces are on screen at once and a pin cannot say which
  // it belongs to. Closing pin mode is the honest move; leaving it open and
  // recording a guess is not.
  if (wanted > 0 && wanted < 1 && PIN.isOn()) PIN.set(false);
  if (wanted === 0) {
    // Mid-drag the ghost stays, emptied: tearing it down calls render(), and
    // sliding back off the end would then have nothing to fade up.
    if (S.dragging && S.ghost) { S.ghost.style.opacity = 0; paintGhostReach(); return paintBar(); }
    /*
     * Landing on the page's own surface hides the copy rather than throwing
     * it away, so coming back is instant. The one thing that must still end
     * here is a detour to a proposal sketch: looking at a sketch is
     * temporary by rule, and a kept one would quietly return.
     */
    if (!S.ghost || S.ghostOverride) return setGhost(false);
    S.ghost.style.opacity = 0;
    paintGhostReach();
    pushContexts();
    return render();
  }
  // The kept copy is only reusable while it is showing what the ghost should
  // be showing. When the screen moved under it, this falls through to a
  // rebuild rather than fading up yesterday's page.
  if (S.ghost && S.ghostSrc === ghostUrlNow()) {
    S.ghost.style.opacity = wanted;
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
const SESSION_KEY = () => `walkdown:session:${S.BP}`;
const sessionDraft = () => S.session && {
  verdicts: S.session.verdicts, threads: S.session.threads,
  actor: S.session.actor, started: S.session.started,
};
export function saveSession() {
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
  S.session = {
    verdicts: {}, threads: {}, actor: whoAmI(),
    started: new Date().toISOString(),
  };
  saveSession();
  render();
}

/** The username a sitting's records will carry: the one it was started under. */
const recordingHandle = () => (S.session?.actor ?? '').trim() || whoAmI();
/** And how to read that handle - the same fallback, one place. */
const recordingDisplay = () => {
  const full = (identityOverride.name ?? S.data?.identity?.name ?? '').trim();
  return full || recordingHandle();
};
/**
 * The handles that resolve to a full name, for every message on screen.
 *
 * Every handle this machine could have signed with goes in - the username,
 * the OS name, the full name records were written under before identity and
 * display name were told apart. Old records are never rewritten; this is
 * what stops them reading as somebody else.
 */
export const names = () => MSG.nameMap({
  username: whoAmI(),
  name: (identityOverride.name ?? S.data?.identity?.name ?? '').trim(),
  handles: [...(S.data?.identity?.handles ?? []), S.session?.actor].filter(Boolean),
});

/*
 * Threads remember where your reading stopped, so opening one the agent has
 * replied to twice shows which part is new. `seen` is what is remembered;
 * `seenAtOpen` freezes the mark for this viewing, or the New line would
 * vanish the instant it appeared.
 */
const SEEN_KEY = () => `walkdown:seen:${S.BP}`;
let seen = {}, seenFor = null;
/* Read marks belong to a blueprint, and the blueprint is chosen after boot -
   so they are loaded once the choice is settled, and again if it changes. */
async function loadSeen() {
  if (seenFor === S.BP) return;
  seenFor = S.BP;
  seen = (await store.get(SEEN_KEY()).catch(() => null)) ?? {};
}
export const seenAtOpen = {};
/** Replies on screen before the server has answered, by thread id. */
export const pendingReplies = new Map();

export const unreadCount = (t) => {
  const at = seen[t.id];
  if (!at) return 0;
  return (t.replies ?? []).filter((r) => String(r.created ?? '') > String(at)).length;
};

function markSeen(id) {
  seenAtOpen[id] = seen[id] ?? null;
  seen[id] = new Date().toISOString();
  store.set(SEEN_KEY(), { ...seen });
}

export function say(msg) {
  const el = D.host.querySelector('#wdp-tsay');
  if (!el) return toast(msg, { tone: 'error' });
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
  /*
   * The same refusal postRuleNote makes, for the same reason.
   *
   * This sent `author: actor || undefined`, the key fell out of the JSON, and
   * the server filled it from the machine's username - so a reply landed in a
   * conversation under a name the panel had never shown, while the composer
   * said only "set your name...". A reply is attributed work.
   *
   * Fixing the note path alone left the rule half-kept, which is what an
   * independent re-judge found an hour after the first fix: one path over,
   * identical line, same server fallback. Worth remembering that the bug was
   * never in either function - it was in the shape `actor || undefined`,
   * which reads as a default and is a handoff.
   */
  const who = (actor ?? '').trim();
  if (!who || who === 'agent') {
    say('A reply is recorded under a person\u2019s name \u2014 set it in Settings (the gear).');
    openActorSettings();
    return false;
  }
  const msg = { author: who, created: new Date().toISOString(), body: text, pending: true };
  const list = pendingReplies.get(id) ?? [];
  pendingReplies.set(id, [...list, msg]);
  S.threadNote = '';
  render();
  const ok = await threadPost(`/api/threads/${id}/replies`, { author: who, body: text });
  if (ok) {
    pendingReplies.set(id, (pendingReplies.get(id) ?? []).filter((m) => m !== msg));
    // The reply is yours and you have just read it: do not mark it new.
    if (seen[id]) { seen[id] = new Date().toISOString(); store.set(SEEN_KEY(), { ...seen }); }
    await load();
  } else {
    msg.pending = false;
    msg.failed = true;
    S.threadNote = text;
    render();
  }
  return ok;
}

/** Reply and lifecycle, under the same governance the server enforces. */
async function threadAct(id, status) {
  const t = (S.data.threads ?? []).find((x) => x.id === id);
  if (!t) return;
  const text = (D.host.querySelector('#wdp-note')?.value ?? '').trim();
  const actor = whoAmI();
  const humanOnly = status === 'verified' || status === 'waived';
  // Agents claim work; a person accepts it. The server refuses this too —
  // saying so here means you find out before you have written the reason.
  if (humanOnly && (!actor || actor === 'agent')) {
    say('Verify and waive are recorded under a person\u2019s name \u2014 set it in Settings first.');
    return openActorSettings();
  }
  /*
   * And every OTHER transition needs a name too, which this guard used to
   * leave to the two human-only ones. Reopening posted `actor: ''`, went
   * through, and lib/threads.js filed the reason as a reply authored
   * "unknown" - a transition recorded under nobody, in a ledger whose whole
   * claim is that a verdict says whose judgment it was. Answering was the
   * same. Not the human-only refusal, which is about WHICH person may act;
   * this one is about there being a person at all.
   */
  if (!actor) {
    say('A thread action is recorded under a person\u2019s name \u2014 set it in Settings first.');
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
    S.threadNote = '';
    // A thread that ends leaves the active list, so its screen has nothing
    // left to show — slide back to where it came from rather than emptying
    // the pane and stranding the reader on a blank one.
    if (TERMINAL.includes(status)) {
      S.openThread = null;
      if (S.view === 'thread') S.view = S.selected ? 'detail' : 'list';
      // An ended conversation is a finished piece of work, whichever way it
      // ended - verified, waived or incorporated - so it reads as one.
      toast(`<b>${esc(id)}</b> ${esc(status)} — it leaves the rule’s active threads.`,
        { tone: 'success' });
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
    toast('Verifying is recorded under a person\u2019s name \u2014 set it in Settings (the gear).',
      { tone: 'error' });
    return openActorSettings();
  }
  const pending = threadsFor(rule).filter((t) => t.status === 'addressed');
  if (!pending.length) return;
  let done = 0;
  for (const t of pending)
    if (await threadPost(`/api/threads/${t.id}/status`, { status: 'verified', actor })) done += 1;
  await load();
  // All of them is the result asked for; a partial pass is not a failure but
  // it is unfinished, and the colour is the difference.
  toast(done === pending.length
    ? `<b>${done}</b> thread${done === 1 ? '' : 's'} verified on ${esc(rule)}.`
    : `<b>${done}</b> of ${pending.length} verified \u2014 the rest are still open.`,
    { tone: done === pending.length ? 'success' : 'warning' });
}

/** Open a thread on its own screen, landing where the reading resumes. */
function openThreadView(id) {
  if (!(S.data?.threads ?? []).some((x) => x.id === id))
    return toast(`No thread ${esc(id)} here.`, { tone: 'error' });
  S.openThread = id;
  S.threadNote = '';
  markSeen(id);
  S.view = 'thread';
  render();
  /*
   * The first unread message if there is one, and otherwise the newest -
   * never the top of an exchange you have already read.
   *
   * Scroll the STREAM, by hand. scrollIntoView looks like the obvious way to
   * say this and is not: it scrolls every scrollable ancestor, and one of the
   * ancestors here is the pane wrapper that carries the slide track. Landing
   * on an unread mark pushed that wrapper to scrollLeft 368, which slid all
   * three panes a third of a column left and left the reviewer looking at an
   * empty one - a thread with unread messages opened to blank, and only a
   * thread with unread messages, which is why it survived every check.
   *
   * offsetTop is measured against the stream because the stream is the
   * offsetParent here; the fallback covers a layout where it is not.
   */
  const pane = D.host.querySelectorAll('.wdp-track > div')[S.listTab === 'threads' ? 1 : 2];
  const stream = pane?.querySelector('.overflow-y-auto');
  const mark = pane?.querySelector('.wd-new');
  if (!stream) return;
  if (mark) {
    const top = stream.contains(mark.offsetParent ?? mark)
      ? mark.offsetTop
      : mark.getBoundingClientRect().top - stream.getBoundingClientRect().top + stream.scrollTop;
    stream.scrollTop = Math.max(0, top);
  } else {
    stream.scrollTop = stream.scrollHeight;
  }
}

function wireThreads() {
  D.host.querySelectorAll('[data-open-thread]').forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); openThreadView(el.dataset.openThread); };
  });
  const tback = D.host.querySelector('.wdp-thread-back');
  if (tback) tback.onclick = () => {
    const t = (S.data?.threads ?? []).find((x) => x.id === S.openThread);
    // Back where you came from: the rule, or the list for a pin that has
    // none - and on the Threads tab always the thread list, because that is
    // where you came from and no rule was ever opened.
    S.view = S.listTab !== 'threads' && t?.anchor?.rule && S.selected ? 'detail' : 'list';
    S.openThread = null;
    render();
  };
  const note = D.host.querySelector('#wdp-note');
  if (note) {
    note.oninput = () => { S.threadNote = note.value; };
    // Enter sends, Shift+Enter breaks the line - the muscle memory everyone
    // already has. The button stays for the pointer.
    note.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      const id = S.openThread;
      const text = note.value.trim();
      if (id && text) threadAct(id, '__reply');
    };
  }
  // An id written in a message is a link: thread ids open that thread, rule
  // ids open that rule, so a conversation can point at things.
  D.host.querySelectorAll('[data-thread-ref]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const id = el.dataset.threadRef;
      const t = (S.data?.threads ?? []).find((x) => x.id === id);
      // Follow it to its own rule, so going back from the thread lands
      // somewhere that makes sense rather than on the rule you came from.
      if (t?.anchor?.rule) S.selected = S.data.rows.find((r) => r.rule === t.anchor.rule) ?? S.selected;
      openThreadView(id);
    };
  });
  D.host.querySelectorAll('[data-rule-ref]').forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); open(el.dataset.ruleRef); };
  });
  const tactor = D.host.querySelector('#wdp-tactor');
  if (tactor) tactor.onclick = () => openActorSettings();
  D.host.querySelectorAll('[data-act]').forEach((el) => {
    el.onclick = () => threadAct(el.dataset.tid, el.dataset.act);
  });
  D.host.querySelectorAll('[data-verify-all]').forEach((el) => {
    el.onclick = () => verifyAll(el.dataset.verifyAll);
  });
  D.host.querySelectorAll('[data-checks]').forEach((el) => {
    el.ontoggle = () => {
      const rule = el.dataset.checks;
      // A pane rebuilt with the disclosure already open fires this too; only
      // a real change is one.
      if (el.open === (S.srcOpenFor === rule)) return;
      S.srcOpenFor = el.open ? rule : null;
      if (el.open) loadCheckSource(rule);
    };
  });
  /*
   * An anchor written into a step points at the thing it names. Cleared
   * first, because a pane rebuilt while the pointer was over a token never
   * gets the mouseleave that would have put the surface back.
   */
  highlightAnchor(null);
  D.host.querySelectorAll('[data-anchor]').forEach((el) => {
    el.onmouseenter = () => highlightAnchor(el.dataset.anchor);
    el.onmouseleave = () => highlightAnchor(null);
  });
  D.host.querySelectorAll('[data-shots]').forEach((el) => {
    el.onclick = () => { try { openShots(JSON.parse(el.dataset.shots)); } catch { /* nothing to show */ } };
  });
  D.host.querySelectorAll('[data-sketch]').forEach((el) => {
    el.onclick = () => { S.ghostOverride = el.dataset.sketch; setGhost(false); S.ghostOverride = el.dataset.sketch; setGhost(true); };
  });
}

/** Where a screen lives on one surface, as a URL walkdown can navigate to. */
function screenUrl(screen, surface) {
  if (!screen) return null;
  if (surface === 'prototype')
    return screen.prototype && S.data?.hasPrototype ? api('/prototype' + screen.prototype) : null;
  return screen.app?.path && S.data?.appBase ? S.data.appBase + screen.app.path : null;
}

/** Every anchor the storyboard declares, on any screen. */
export const declaredAnchors = () =>
  new Set((S.data?.storyboard ?? []).flatMap((s) => s.anchors ?? []));

/*
 * Point at an element on the surface under review, by the anchor that names
 * it. Both surfaces are told and each answers for itself: the design is what
 * you are usually reading a step against, but the same step is about the
 * built page too, and the frame that has no such element simply draws
 * nothing. `null` puts the surfaces back.
 */
function highlightAnchor(element) {
  const msg = { type: 'walkdown:highlight', element: element ?? null };
  ghostFrame()?.contentWindow?.postMessage(msg, '*');
  D.appFrame?.contentWindow?.postMessage(msg, '*');
}

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
  Boolean(cfg.buildHash && S.data?.panelHash && cfg.buildHash !== S.data.panelHash);

/*
 * Go to a screen. `pick` is what the screen override should say once we are
 * there: null for every trip walkdown makes on its own (a rule's screen, the
 * blueprint's front door), and the screen's own id when a person chose it in
 * the picker - that choice outranks detection and has to survive arriving,
 * or the radio list snaps back to "Detect from the page" the moment the
 * frame lands (n-0098).
 */
export function goTo(screen, surface = pageSurface(), pick = null) {
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
  if (!sameAddress(S.frameUrl, url)) {
    S.frameUrl = url;
    frameLoading(url, `Loading ${screenLabel(screen)}…`);
    D.appFrame.src = url;
  }
  /*
   * The screen override describes where we are going, not where we have
   * been: null for a trip walkdown decided on, and the picked id when a
   * person named the screen. The sketch override always describes the page
   * being left, so it goes either way.
   */
  S.pickedScreen = pick;
  S.ghostOverride = null;
  if (S.protoShare === null) setGhost(false);
  else setFade(S.protoShare);
  render();
  return true;
}

/*
 * Opening a headless rule clears the desk: an opaque cover in walkdown's
 * own colors takes the sheet's place, so the previous screen cannot keep
 * masquerading as the rule's. Covering rather than navigating keeps the
 * application's state intact underneath.
 */
function syncHeadlessCover() {
  const show = S.docked && S.view !== 'list' && isHeadless(S.selected);
  if (!show) { S.headlessCover?.remove(); S.headlessCover = null; return; }
  if (!S.headlessCover) {
    S.headlessCover = document.createElement('div');
    document.body.appendChild(S.headlessCover);
  }
  const cs = getComputedStyle(D.side);
  S.headlessCover.style.cssText = `position:fixed; top:${HEAD}px; left:${GAP}px;
    width:calc(100vw - ${W + GAP * 3}px); height:calc(100vh - ${HEAD + GAP}px);
    z-index:2147482000; border-radius:10px; overflow:hidden;
    background:${cs.backgroundColor}; color:${cs.color};
    box-shadow:0 1px 2px rgba(0,0,0,.28), 0 12px 32px rgba(0,0,0,.34);
    display:flex; align-items:center; justify-content:center; text-align:center;
    font:13px/1.6 system-ui, sans-serif;`;
  // cssText above is wholesale, so the peek's dimming must be re-said here
  // or a repaint mid-peek snaps the cover back to full strength.
  S.headlessCover.style.opacity = S.hideAppOn ? '0.1' : '';
  S.headlessCover.innerHTML = `<div style="max-width:26rem; padding:2rem; opacity:.9">
    <div style="font-size:15px; font-weight:700; margin-bottom:.5rem">No screen belongs to this rule</div>
    It is judged by its checks and recorded behavior, not by looking.<br>
    The page you were reviewing is untouched underneath.</div>`;
}

export function elsewhere(r) {
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

function sayVerdict(msg) {
  const el = D.host.querySelector('#wdp-vsay');
  if (!el) return toast(msg, { tone: 'error' });
  el.textContent = msg;
  el.classList.remove('hidden');
}

/** File the feedback box's text as a note on the rule; null on refusal. */
async function postRuleNote(rule, body) {
  /*
   * Refuse rather than let the server choose a name for us.
   *
   * This sent `author: undefined` when the sitting had no actor, the field
   * dropped out of the JSON, and the server filled it in from the machine's
   * own username - so a note went into the ledger under a name the panel had
   * never put on screen. `panel.identity.attribution-visible` says a defaulted
   * identity is always visible BEFORE it is used, and this was the one path
   * that used one nobody had seen. Finish already refused; the note-filing
   * half did not, so a fail could be recorded, and its reason attributed,
   * under a stranger.
   *
   * Found by an agent walkdown on 2026-08-28 emptying Settings and pressing
   * Fail. n-0116 had looked at the same screen and judged it harmless on the
   * belief that every attributed action was refused; that belief was true of
   * every path but this one.
   */
  const author = (S.session.actor ?? '').trim();
  if (!author || author === 'agent') {
    sayVerdict('A note is recorded under a person\u2019s name \u2014 set it in Settings (the gear).');
    openActorSettings();
    return null;
  }
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
  (S.data?.threads ?? []).some((t) => t.anchor?.rule === rule &&
    S.session?.started && String(t.created ?? '') >= S.session.started);

function wireVerdict() {
  const note = D.host.querySelector('#wdp-vnote');
  if (note) note.oninput = () => { S.verdictNote = note.value; };
  D.host.querySelectorAll('[data-v]').forEach((b) => {
    b.onclick = async () => {
      const status = b.dataset.v;
      const rule = S.selected.rule;
      const text = (D.host.querySelector('#wdp-vnote')?.value ?? '').trim();
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
        (S.session.threads[rule] ??= []).push(tid);
        saveSession();
      }
      S.session.verdicts[rule] = status;
      saveSession();
      S.verdictNote = '';
      // A pass or approval moves you on; fail and refine keep you here, so
      // the reason can be written or pinned where the rule is. Staying put
      // is the whole of it - pin mode is a tool you reach for, not a mode a
      // verdict puts you in.
      if (status === 'pass' || status === 'approved') {
        const next = owedRows()[0];
        if (next) { open(next.rule); load(); return; }
        S.view = 'list';
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
/*
 * Carry on where the sitting left off: the next rule still owing a verdict.
 * A sitting resumed from disk lands here too - the draft survives crossing to
 * another blueprint and back, so "continue" is a real offer rather than a
 * word for "start over".
 */
function continueWalkdown() {
  const next = owedRows()[0];
  if (!next) {
    S.view = 'list';
    render();
    // Nothing owed is the good end of a walk, not an error.
    return toast('Nothing left owing a verdict in this blueprint — <b>Finish walkdown</b> records the sitting.',
      { tone: 'success' });
  }
  open(next.rule);
}

/** Append the session to the runs ledger — the same write the viewer makes. */
async function finishWalkdown() {
  // A double-click on Finish must not append the same record twice - but a
  // refused or failed attempt must hand the button back, or one hiccup
  // silently bricks Finish for the rest of the session.
  if (S.session.posting) return;
  S.session.posting = true;
  // Each verdict carries its why: the notes the feedback box filed, plus
  // any pins dropped on the rule during this session.
  const results = Object.entries(S.session.verdicts).map(([rule, status]) => {
    const pins = (S.data?.threads ?? [])
      .filter((t) => t.anchor?.rule === rule && String(t.created ?? '') >= S.session.started)
      .map((t) => t.id);
    const threads = [...new Set([...(S.session.threads?.[rule] ?? []), ...pins])];
    return { rule, status, ...(threads.length && { threads }) };
  });
  if (!results.length) { S.session = null; saveSession(); render(); return; }
  const actor = (S.session.actor ?? '').trim();
  if (!actor || actor === 'agent') {
    S.session.posting = false;
    toast('A walkdown is recorded under a person’s name — set it in Settings (the gear).',
      { tone: 'error' });
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
    if (!res.ok) {
      S.session.posting = false;
      return toast(`Not recorded: ${esc(out.error ?? 'request failed')}`, { tone: 'error' });
    }
    S.session = null;
    saveSession();
    S.view = 'list';
    S.selected = null;
    await load();
    toast(`Recorded ${results.length} verdict${results.length === 1 ? '' : 's'} as <b>${esc(out.run_id)}</b>`,
      { tone: 'success' });
  } catch {
    S.session.posting = false;
    toast('walkdown server unreachable — nothing recorded.', { tone: 'error' });
  }
}

export function open(ruleId) {
  S.selected = S.data.rows.find((r) => r.rule === ruleId) ?? S.selected;
  S.view = 'detail';
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
  const want = ruleScreen(S.selected);
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
  if (!S.ghost || !frame) return;
  const { availW, availH } = frameSpace();
  // At a preset the ghost lays out at that width too, scaling down whole
  // when the stage is narrower - the same rule the app frame follows.
  const gs = S.ghostWidth ? Math.min(1, availW / S.ghostWidth) : 1;
  S.ghost.style.width = `${availW}px`;
  S.ghost.style.height = `${availH}px`;
  S.ghost.style.alignItems = S.ghostWidth ? 'flex-start' : 'center';
  frame.style.width = `${S.ghostWidth || availW}px`;
  frame.style.height = `${gs < 1 ? availH / gs : availH}px`;
  frame.style.transform = gs < 1 ? `scale(${gs})` : '';
  frame.style.transformOrigin = 'top center';
  frame.style.maxWidth = 'none';
  frame.style.maxHeight = 'none';
  frame.style.flex = 'none';
}

export function setGhost(on) {
  if (!on) {
    S.ghost?.remove();
    S.ghost = null;
    S.ghostSrc = null;
    S.ghostReady = false;     // whatever was in there is gone with it
    S.ghostOverride = null;   // the detour ends with the overlay
    S.protoShare = null;      // and the dial goes back to following the page
    render();
    return;
  }
  const screen = screenById(S.ghostOverride) ?? currentScreen();
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
  if (S.ghost && S.ghostSrc === url) {
    sizeGhost();
    S.ghost.style.opacity = S.ghostOpacity;
    paintGhostReach();
    render();
    return;
  }
  S.ghost?.remove();
  S.ghostReady = false;
  S.ghostSrc = url;
  // The stage owns the opacity so the backdrop fades with the prototype: at
  // full strength the app is properly covered, not blended into. The
  // checkerboard says "nothing is here" where the prototype does not reach,
  // so an uncovered strip never reads as design. Inline styles: this element
  // is in the host document, where our stylesheet has no reach.
  S.ghost = document.createElement('div');
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
  S.ghost.style.cssText = `position:fixed; top:${HEAD}px; left:${GAP}px; bottom:${GAP}px;
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
    opacity:${S.ghostOpacity};`;
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
    if (S.ghostReady) return;
    if (S.ghostOpacity === 1) PIN.set(false);
    renderBar();
  });
  S.ghost.appendChild(frame);
  // Built while the panel is put away, it must be built full-bleed: the box
  // stated at creation is the docked one.
  placeGhost(S.docked);
  // A proposal is an agent's sketch, not design's work. It says so on its
  // face, so nobody walks a screen down against a drawing we made up.
  if (src.proposed) {
    const flag = document.createElement('div');
    flag.textContent = '\u26a0 Proposed sketch \u2014 not from design';
    flag.style.cssText = `position:absolute; top:0; left:0; right:0; z-index:1; text-align:center;
      background:#d97706; color:#fff; font:600 11px/1 -apple-system, sans-serif;
      letter-spacing:.06em; padding:6px 8px;`;
    S.ghost.appendChild(flag);
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
  D.sr.insertBefore(S.ghost, D.host);
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
const ghostFrame = () => S.ghost?.querySelector('iframe') ?? null;

function pinsForScreen(id) {
  if (!id) return [];
  return (S.data?.threads ?? [])
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
  Boolean(S.ghost) && S.ghostOpacity === 1 && S.ghostReady && PIN.isOn();

function paintGhostReach() {
  if (S.ghost) S.ghost.style.pointerEvents = ghostHasReach() ? 'auto' : 'none';
}

/*
 * What the copy inside the ghost needs in order to behave: which screen it
 * is showing, which surface it counts as, whether pinning is live, and the
 * pins already on that screen. Same message the viewer sent its panes.
 */
function pushContext(frame, surface, pinMode) {
  const sc = screenById(S.ghostOverride) ?? currentScreen();
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
  if (D.appFrame) pushContext(D.appFrame, pageSurface(), PIN.isOn() && !ghostHasReach());
}

/** Which surface a message came from, or null if it is not one of ours. */
function surfaceOfSource(src) {
  if (!src) return null;
  if (src === ghostFrame()?.contentWindow) return ghostSurface();
  if (D.appFrame && src === D.appFrame.contentWindow) return pageSurface();
  return null;
}


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


/*
 * Three questions, asked once each and then not again: is there a server,
 * which blueprint is this site, and then the actual work. A script tag has
 * already answered the second, so it goes straight past the picker.
 */
export async function start() {
  let payload;
  try {
    payload = await (await fetch(api('/api/blueprint'))).json();
  } catch {
    S.phase = 'connect';
    return renderGate();
  }
  S.projects = payload.projects ?? [];
  S.servedRoot = payload.root ?? null;
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
  if (!S.BP && S.projects.length > 1) {
    try {
      // Framed, the page under review is the one in the frame, not walkdown's
      // own address — asking about ourselves would answer about nothing.
      const asking = S.frameUrl;
      const whose = asking
        ? await (await fetch(api(`/api/whose?url=${encodeURIComponent(asking)}`))).json()
        : null;
      if (whose?.match?.id && S.projects.some((pr) => pr.id === whose.match.id)) S.BP = whose.match.id;
    } catch { /* the server is old or unreachable; memory and the picker remain */ }
  }
  if (!S.BP && S.projects.length > 1) {
    const remembered = await store.get(CHOICE);
    if (remembered && S.projects.some((pr) => pr.id === remembered)) S.BP = remembered;
  }
  if (!S.BP && S.projects.length > 1) {
    S.phase = 'choose';
    return renderGate();
  }
  S.phase = 'ready';
  S.data = S.BP ? await (await fetch(api('/api/blueprint'))).json() : payload;
  await loadSeen();
  await restoreSession();
  if (S.jumpOnLoad) {
    S.jumpOnLoad = false;
    /*
     * Only when the blueprint you have just chosen says nothing about the
     * page you are on. If it does cover this page, you are already where the
     * choice meant to put you, and moving would be the panel overruling you.
     */
    const first = (S.data.storyboard ?? []).find((sc) => screenUrl(sc, 'app') ?? screenUrl(sc, 'prototype'));
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
  if (S.phase === 'connect') {
    D.side.innerHTML = `
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
          <input id="wdp-server" data-testid="start.server" class="input input-sm flex-1" value="${esc(S.SERVER)}"
                 aria-label="walkdown server address">
          <button class="btn btn-sm btn-primary" id="wdp-retry" data-testid="start.connect">Connect</button>
        </div>
        <p class="text-[11.5px] opacity-40">Then every blueprint under that folder is listed here.</p>
      </div>`;
    wireBlueprints(D.side);
    return;
  }
  D.side.innerHTML = `
    <div class="p-4 pb-2">
      <div class="text-[15px] font-semibold">Which blueprint?</div>
      <p class="mt-1 text-[12.5px] leading-relaxed opacity-60">Remembered for
        <b>${esc(location.origin)}</b>, and changeable later from the Blueprints tab.</p>
    </div>
    <div class="flex-1 overflow-y-auto">${blueprintsPane()}</div>`;
  wireBlueprints(D.side);
}



/*
 * Every listener the panel hangs on the document or the window.
 *
 * They used to sit where each one was relevant, at the top level of the
 * IIFE, which was safe because the once-per-page guard returned before them.
 * With the wrapper gone the guard cannot reach them, and a second injection
 * would have registered every one of these twice — so they are gathered here
 * and boot() calls this once, after the guard has had its say.
 */
function wireGlobals() {
  document.addEventListener(
    'pointerdown',
    (e) => { if (S.screensOpen || S.deskOpen) dismissPopovers(e.composedPath()); },
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
    if (shotsOpen()) return closeShots();
    if (S.screensOpen) return closeScreenPanel();
    if (S.deskOpen) return closeDeskPanel();
    if (PIN.isOn()) PIN.set(false);
  });
  addEventListener('resize', () => {
    placeAppFrame(S.docked);
    placeGhost(S.docked);
    if (!S.docked) return;
    // The ghost states its size in pixels, so it has to be told about a resize
    // rather than being carried along by percentages - re-measured, not
    // rebuilt, or every drag of the window edge reloads the page inside it.
    sizeGhost();
    if (S.hideAppOn) hideApp(true);
    syncHeadlessCover();
    syncZoomBadge();
  });
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
        S.ghostReady = true;
        paintGhostReach();
        pushContexts();
        return renderBar();
      }
      /*
       * The application saying where it is. Framed we cannot read that across
       * origins, and this is also how an SPA reports moving — so a hash route
       * or a pushState inside the frame re-answers which screen this is.
       */
      const moved = msg.href && msg.href !== S.frameUrl;
      S.frameUrl = msg.href ?? S.frameUrl;
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
      S.openThread = msg.id;
      markSeen(msg.id);
      S.view = 'thread';
      const t = (S.data?.threads ?? []).find((x) => x.id === msg.id);
      const row = t?.anchor?.rule ? S.data.rows.find((r) => r.rule === t.anchor.rule) : null;
      // The rule behind it, when it has one, so going back from the thread
      // lands on it. A pin with no rule still opens - the thread screen is
      // about the thread, not about what it happens to be attached to.
      S.selected = row ?? null;
      return render();
    }

    if (msg.type === 'walkdown:new-pin') {
      const sc = screenById(S.ghostOverride) ?? currentScreen();
      /*
       * A pin is a thread, so it is attributed work, so it needs a name that
       * has been on screen. The embed sends none - it has no identity of its
       * own - and this spread let the key fall out of the JSON, after which
       * lib/serve.js filled it from the machine's username. Third path
       * tonight with the same shape after postRuleNote and postReply, and the
       * one that mattered most: the panel drew the resulting thread under a
       * name an inch above its own composer offering "set your name...".
       *
       * The panel is the thing that knows who you are, so the panel names the
       * pin. Refusing here rather than in the embed keeps the embed free of
       * an identity it has no way to ask for.
       */
      const pinAuthor = (msg.author ?? '').trim() || whoAmI();
      if (!pinAuthor || pinAuthor === 'agent') {
        toast('A pin is recorded under a person\u2019s name \u2014 set it in Settings (the gear).',
          { tone: 'error' });
        openActorSettings();
        return;
      }
      await fetch(api('/api/threads'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: msg.kind, body: msg.body,
          author: pinAuthor,
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
            ...(S.view !== 'list' && S.selected && { rule: S.selected.rule }),
          },
        }),
      }).catch(() => {});
      await load();
      pushContexts();
    }
  });
  // Hold G to peek at the prototype at full strength.
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'g' && S.ghost && !e.metaKey && !e.ctrlKey && !typing(e)) S.ghost.style.opacity = 1;
  });
  addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'g' && S.ghost) S.ghost.style.opacity = S.ghostOpacity;
  });
}

function boot() {
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

  /*
   * The panel reviews a page by framing it, and a page cannot frame itself - so
   * there is always a frame, and whoever started us said which. The extension's
   * bootstrap and walkdown's own review page both refuse to load us without one.
   */
  if (!cfg.frame?.url) {
    console.warn('[walkdown] no page to review — the panel needs a frame url');
    return;
  }

  wireGlobals();
  /*
   * Boot, in the one order that works: the chrome exists, then the stylesheet
   * is asked for (it lands in the shadow root whenever it arrives), then the
   * frame, then the panel is put out.
   *
   * This sequence is the reason nothing above it may READ D at module level.
   * Writing D from a builder is fine and is the point of the holder; reading
   * it while the file is still evaluating is not, because after the split an
   * import graph decides who evaluates first and no shard should have to know
   * the answer. (One statement did read it — the frame's load listener, which
   * asked `if (D.appFrame)` at module level and would have quietly registered
   * nothing once the frame stopped existing that early. It moved into
   * buildAppFrame, which is where it belongs.)
   */
  buildChrome();
  loadStylesheet();
  buildPutAwayControls();
  buildAppFrame();
  setDocked(true);
  // Pin mode has one owner — the embed. The bar mirrors it rather than keeping
  // a second copy that Escape would have to remember to update.
  PIN.watch(() => {
    paintGhostReach();
    pushContexts();
    if (S.phase === 'ready') renderBar();
  });

  store.get(IDENTITY_KEY).then(async (v) => {
    const saved = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
    if (saved && typeof saved === 'object') {
      /*
       * An emptied field is an answer, and it has to survive the reload.
       *
       * These two lines used to require a NON-EMPTY string, so the empty pair
       * the panel had just written was read back and thrown away: whoAmI fell
       * through to git, and somebody who had deliberately removed their name
       * got it silently reinstated by the next refresh - along with the
       * ability to attribute work under it, which the emptied state exists to
       * refuse. The comment on this feature already said "clearing a box is
       * how you undo"; the code only honoured that until the tab closed.
       *
       * The distinction the null-coalescing in whoAmI relies on is between
       * ABSENT (no override, fall through to what the server derived) and
       * EMPTY (an override that says nobody), so an empty string has to be
       * restored as an empty string rather than skipped.
       */
      if (typeof saved.username === 'string') identityOverride.username = saved.username.trim();
      if (typeof saved.name === 'string') identityOverride.name = saved.name.trim();
      // Same distinction one field over: an empty array is "none of these",
      // and only a missing key means nothing was ever said.
      if (Array.isArray(saved.roles))
        identityOverride.roles = saved.roles.map((r) => String(r).trim()).filter(Boolean);
      return;
    }
    /*
     * The single field this replaced becomes the FULL NAME, not the username.
     * It was seeded from `git config user.name` and in practice held a
     * person's name, so that is the box it belongs in; the username goes back
     * to being derived. Whatever was already recorded under the old value
     * stays recorded under it - the ledger is history, and history does not
     * get edited to match a later opinion about field names.
     */
    const legacy = await store.get(ACTOR_KEY).catch(() => null);
    if (typeof legacy === 'string' && legacy.trim()) {
      identityOverride.name = legacy.trim();
      saveIdentity();
    }
  });
  store.get(DESK_KEY).then((v) => {
    try {
      const saved = typeof v === 'string' ? JSON.parse(v) : v;
      if (!saved || typeof saved !== 'object') return;
      S.desk = { ...DESK_DEFAULTS, ...saved };
      if (S.docked) paintDesk(true);
    } catch { /* a malformed save loses to the defaults */ }
  });
  store.get(CHOICE + ':server').then((at) => { if (at) S.SERVER = at; }).finally(start);
}

boot();