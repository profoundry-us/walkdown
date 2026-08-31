/*
 * The Screens tab: which screen this page is, and which screens have a design
 * on file to compare against at all.
 */

import { html, nothing } from '../../vendor/lit.js';
import {
  closeScreenPanel,
  currentScreen,
  ghostSource,
  goTo,
  pageSurface,
  render,
  setFade,
  setGhost,
} from './app.js';
import { S } from './state.js';
import { screenById } from './vocab.js';

/**
 * Wire a rendered screen list. Lives apart from the list itself because the
 * two are now in different places: the rows are drawn into the bar's picker,
 * and picking one closes it - a chooser that stayed open over the screen it
 * just took you to would be covering its own result.
 */
export function wireScreens(root) {
  root.querySelectorAll('[data-screen]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.screen || null;
      S.ghostOverride = null;
      closeScreenPanel();
      const reghost = () => {
        if (S.ghost) {
          setGhost(false);
          setFade(S.ghostOpacity || 1);
        } else render();
      };
      // "Detect from the page" is a reset, not a destination.
      if (!id) {
        S.pickedScreen = null;
        return reghost();
      }
      // Picked by hand, so the pick rides along and survives the arrival.
      if (goTo(screenById(id), pageSurface(), id)) return;
      // Nowhere to go: a screen with no URL on either surface. Then the only
      // thing the picker can do is what it always did — record that this
      // page is that screen.
      S.pickedScreen = id;
      reghost();
    };
  });
}

export function screensPane() {
  const screens = S.data.storyboard ?? [];
  if (!screens.length)
    return html`<p class="p-3.5 text-[12.5px] opacity-40">No screens in this blueprint — headless rules only.</p>`;
  const here = currentScreen();
  const auto = !S.pickedScreen;
  return html`
    <button class="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12.5px] hover:bg-base-200"
      data-screen="">
      <span class="w-3.5 shrink-0 text-center ${auto ? 'text-primary' : 'opacity-30'}">${auto ? '\u25c9' : '\u25cb'}</span>
      <span>Detect from the page</span>
      ${auto && here ? html`<span class="ml-auto text-[11px] opacity-50">${here.id}</span>` : nothing}
    </button>
    <div class="mx-3.5 my-1 border-t border-base-300"></div>
    ${screens.map((sc) => {
      const on = S.pickedScreen === sc.id;
      const design = ghostSource(sc);
      return html`<button class="flex w-full items-start gap-2 px-3.5 py-2 text-left hover:bg-base-200"
        data-screen="${sc.id}">
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
