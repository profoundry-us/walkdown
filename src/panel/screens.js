/*
 * The Screens tab: which screen this page is, and which screens have a design
 * on file to compare against at all.
 */

import { html, nothing } from '../../vendor/lit.js';
import { S, store } from './state.js';
import { api, fire } from './util.js';
import { currentScreen, ghostSource } from './vocab.js';

/** Where the picker's view is remembered - this browser's, like a collapsed section. */
export const SCREENS_VIEW_KEY = 'walkdown:screens-view';
export async function loadScreensView() {
  const v = await store.get(SCREENS_VIEW_KEY).catch(() => null);
  if (v === 'board' || v === 'list') S.screensView = v;
}

/*
 * The picker has two views of the same storyboard (Topher, n-0095): the
 * list, which answers "which screen is this page" a row at a time, and the
 * board, which lays every screen out small so the whole product is taken in
 * at a glance. Same rows, same pick, same Detect; only the drawing differs.
 */
function viewTabs() {
  const tab = (id, label) => html`<button role="tab" class="tab tab-xs ${S.screensView === id ? 'tab-active' : ''}"
    data-testid="panel.screens-view" data-view="${id}" aria-selected="${S.screensView === id}"
    @click=${(e) => fire(e.currentTarget, 'screens-view', { view: id })}>${label}</button>`;
  return html`<div role="tablist" class="tabs tabs-boxed tabs-xs mx-3.5 mb-1 w-fit" data-testid="panel.screens-views">
    ${tab('list', 'List')}${tab('board', 'Storyboard')}
  </div>`;
}

/*
 * The board: one card per screen in storyboard order, each a small picture
 * of the page - photographed by the server once and kept until Redraw asks
 * again (lib/screenshots.js). It was a live frame per screen first, and
 * seven pages rendering inside the page reviewing them wreaked havoc on the
 * host's CSS (Topher, 2026-09-21). The picture is of the build where the
 * screen has a path, the design otherwise; a screen with neither says so.
 */
// 1280 x 800 scaled to a size the page can be READ at: the first cut was 196
// wide, and at that size nothing on the card could be made out (Topher, 2026-09-21).
/*
 * A page that redirected - most often to a sign-in, since the server's
 * browser has none of the reviewer's cookies - is not a picture of the screen
 * its card names. The card says where it landed instead of passing a login
 * page off as the dashboard (2026-09-23).
 */
function landedMark(img, id) {
  fetch(api(`/api/screenshot?screen=${encodeURIComponent(id)}&meta=1`))
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      const frame = img.parentElement;
      if (!m?.landed || !frame || frame.querySelector('[data-testid="panel.screens-card-landed"]')) return;
      const tag = document.createElement('span');
      tag.dataset.testid = 'panel.screens-card-landed';
      tag.className = 'absolute inset-x-0 bottom-0 truncate bg-warning px-1.5 py-0.5 text-[10.5px] font-semibold text-warning-content';
      let where = m.landed;
      try {
        const u = new URL(m.landed);
        where = u.pathname + u.search;
      } catch {
        /* keep the whole address */
      }
      tag.textContent = `landed on ${where}`;
      tag.title = `Asked for ${m.page}, and the page went to ${m.landed} - a sign-in, most likely. The server's browser is not signed in.`;
      frame.appendChild(tag);
    })
    .catch(() => {});
}

const CARD_W = 280;
const CARD_H = 175;
let redrawn = 0; // bumps the pictures' addresses so the browser asks again
function board(screens, here) {
  return html`<div class="grid grid-cols-3 gap-2 px-3.5 pb-2" data-testid="panel.screens-board">
    ${screens.map((sc) => {
      const on = S.pickedScreen === sc.id;
      const is = !S.pickedScreen && here?.id === sc.id;
      const design = ghostSource(sc);
      const drawable = Boolean(sc.app?.path || design);
      const src = drawable ? api(`/api/screenshot?screen=${encodeURIComponent(sc.id)}${redrawn ? `&refresh=1&r=${redrawn}` : ''}`) : null;
      return html`<button class="flex flex-col gap-1 rounded-box border p-1.5 text-left hover:bg-base-200 ${
        on || is ? 'border-primary' : 'border-base-300'
      }" data-screen="${sc.id}" data-testid="panel.screens-card" title="${sc.title ?? sc.id}"
        @click=${(e) => fire(e.currentTarget, 'pick-screen', { id: sc.id })}>
        <span class="relative block overflow-hidden rounded bg-base-200" style="width:${CARD_W}px;height:${CARD_H}px">
          ${
            src
              ? html`<img src="${src}" alt="${sc.title ?? sc.id}" loading="lazy" decoding="async" draggable="false"
                  class="block h-full w-full object-cover object-top"
                  @load=${(e) => landedMark(e.currentTarget, sc.id)}
                  @error=${(e) => {
                    const gone = document.createElement('span');
                    gone.className = 'flex h-full items-center justify-center px-2 text-center text-[10.5px] text-warning';
                    gone.dataset.testid = 'panel.screens-card-undrawn';
                    gone.textContent = 'could not draw it';
                    e.currentTarget.replaceWith(gone);
                  }}>`
              : html`<span class="flex h-full items-center justify-center text-[10.5px] opacity-40">nothing to draw</span>`
          }
          ${on || is ? html`<span class="absolute right-1 top-1 rounded bg-primary px-1 text-[9px] font-bold uppercase text-primary-content">${on ? 'picked' : 'here'}</span>` : nothing}
        </span>
        <span class="min-w-0" style="width:${CARD_W}px">
          <span class="block truncate text-[13px]">${sc.title ?? sc.id}</span>
          <span class="flex items-center gap-1 font-mono text-[10.5px] opacity-40">
            <span class="truncate">${sc.id}</span>
            <span class="ml-auto shrink-0 font-sans ${design ? '' : 'text-warning opacity-100'}">${
              design ? (design.proposed ? 'sketch' : 'design') : 'no design'
            }</span>
          </span>
        </span>
      </button>`;
    })}
    <!-- The pictures are kept until asked for again: a page that changed shape
         is redrawn from here, not by clearing anything. -->
    <div class="col-span-3 flex justify-end">
      <button class="btn btn-ghost btn-xs" data-testid="panel.screens-redraw" title="Photograph every screen again"
        @click=${(e) => {
          e.stopPropagation();
          redrawn = Date.now();
          fire(e.currentTarget, 'screens-view', { view: 'board' });
        }}>Redraw</button>
    </div>
  </div>`;
}

/**
 * Wire a rendered screen list. Lives apart from the list itself because the
 * two are now in different places: the rows are drawn into the bar's picker,
 * and picking one closes it - a chooser that stayed open over the screen it
 * just took you to would be covering its own result.
 */

export function screensPane() {
  const screens = S.data.storyboard ?? [];
  if (!screens.length)
    return html`<p class="p-3.5 text-[12.5px] opacity-40">No screens in this blueprint — headless rules only.</p>`;
  const here = currentScreen();
  const auto = !S.pickedScreen;
  return html`
    ${viewTabs()}
    <button class="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12.5px] hover:bg-base-200"
      data-screen="" @click=${(e) => fire(e.currentTarget, 'pick-screen', { id: null })}>
      <span class="w-3.5 shrink-0 text-center ${auto ? 'text-primary' : 'opacity-30'}">${auto ? '\u25c9' : '\u25cb'}</span>
      <span>Detect from the page</span>
      ${auto && here ? html`<span class="ml-auto text-[11px] opacity-50">${here.id}</span>` : nothing}
    </button>
    <div class="mx-3.5 my-1 border-t border-base-300"></div>
    ${S.screensView === 'board' ? board(screens, here) : screens.map((sc) => {
      const on = S.pickedScreen === sc.id;
      const design = ghostSource(sc);
      return html`<button class="flex w-full items-start gap-2 px-3.5 py-2 text-left hover:bg-base-200"
        data-screen="${sc.id}" @click=${(e) => fire(e.currentTarget, 'pick-screen', { id: sc.id })}>
        <span class="w-3.5 shrink-0 pt-0.5 text-center ${on ? 'text-primary' : 'opacity-30'}">${on ? '\u25c9' : '\u25cb'}</span>
        <span class="min-w-0">
          <span class="block truncate text-[13px]">${sc.title ?? sc.id}</span>
          <span class="block truncate font-mono text-[10.5px] opacity-40">${sc.id}</span>
        </span>
        <span class="ml-auto shrink-0 pt-0.5 text-[10.5px] ${design ? 'opacity-50' : 'text-warning'}">${
          design ? (design.proposed ? 'sketch' : 'design') : 'no design'
        }</span>
      </button>`;
    })}`;
}
