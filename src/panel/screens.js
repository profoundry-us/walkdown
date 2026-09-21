/*
 * The Screens tab: which screen this page is, and which screens have a design
 * on file to compare against at all.
 */

import { html, nothing } from '../../vendor/lit.js';
import { S, store } from './state.js';
import { api, fire } from './util.js';
import { currentScreen, ghostSource, screenUrl } from './vocab.js';

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
 * The board: one card per screen in storyboard order, each a live frame of
 * the screen laid out at a desktop width and scaled to the card - a small
 * picture of the page as it is, from the same address the picker would take
 * you to, rather than a capture that goes stale. The build is shown where it
 * has a path, the design where it has none, so every card that can be drawn
 * is. The frame takes no pointer: the card is the control. Its scripts run,
 * so an application renders; what its copy of walkdown says to this window
 * is ignored, since it is not one of the panel's own frames.
 */
const CARD_W = 196;
const LAID_OUT_W = 1280;
const LAID_OUT_H = 800;
function board(screens, here) {
  const scale = CARD_W / LAID_OUT_W;
  return html`<div class="grid grid-cols-3 gap-2 px-3.5 pb-2" data-testid="panel.screens-board">
    ${screens.map((sc) => {
      const on = S.pickedScreen === sc.id;
      const is = !S.pickedScreen && here?.id === sc.id;
      const design = ghostSource(sc);
      const src = screenUrl(sc, 'app') ?? screenUrl(sc, 'prototype') ?? (design?.path ? api(design.path) : null);
      return html`<button class="group flex flex-col gap-1 rounded-box border p-1.5 text-left hover:bg-base-200 ${
        on || is ? 'border-primary' : 'border-base-300'
      }" data-screen="${sc.id}" data-testid="panel.screens-card" title="${sc.title ?? sc.id}"
        @click=${(e) => fire(e.currentTarget, 'pick-screen', { id: sc.id })}>
        <span class="relative block overflow-hidden rounded bg-base-200" style="width:${CARD_W}px;height:${Math.round(LAID_OUT_H * scale)}px">
          ${
            src
              ? html`<iframe src="${src}" title="${sc.title ?? sc.id}" tabindex="-1" loading="lazy"
                  sandbox="allow-scripts allow-same-origin"
                  class="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-base-100"
                  style="width:${LAID_OUT_W}px;height:${LAID_OUT_H}px;transform:scale(${scale})"></iframe>`
              : html`<span class="flex h-full items-center justify-center text-[10.5px] opacity-40">nothing to show</span>`
          }
          ${on || is ? html`<span class="absolute right-1 top-1 rounded bg-primary px-1 text-[9px] font-bold uppercase text-primary-content">${on ? 'picked' : 'here'}</span>` : nothing}
        </span>
        <span class="min-w-0" style="width:${CARD_W}px">
          <span class="block truncate text-[12px]">${sc.title ?? sc.id}</span>
          <span class="flex items-center gap-1 font-mono text-[10px] opacity-40">
            <span class="truncate">${sc.id}</span>
            <span class="ml-auto shrink-0 font-sans ${design ? '' : 'text-warning opacity-100'}">${
              design ? (design.proposed ? 'sketch' : 'design') : 'no design'
            }</span>
          </span>
        </span>
      </button>`;
    })}
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
