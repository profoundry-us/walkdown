/*
 * The screenshots an agent walkdown left behind, shown over the whole desk.
 */
import { D } from './state.js';
import { api, esc } from './util.js';

/*
 * The screenshots themselves, over the whole desk.
 *
 * Deliberately NOT a native <dialog showModal()>: the shell is already a
 * manual popover in the browser's top layer, and promoting a second element
 * into it from inside the first is exactly the pairing that left the rule
 * list unable to take a wheel event at all (n-0086). A plain layer inside
 * the same shadow root is a modal by every behaviour that matters here -
 * it covers the surface, it takes the pointer, and Escape closes it.
 */
let shotLayer = null;
export const shotsOpen = () => Boolean(shotLayer);
export function closeShots() {
  shotLayer?.remove();
  shotLayer = null;
}
export function openShots(paths) {
  closeShots();
  shotLayer = document.createElement('div');
  shotLayer.dataset.theme = 'blueprint';
  shotLayer.dataset.testid = 'detail.screenshots-modal';
  shotLayer.style.cssText = `position:fixed; inset:0; z-index:10; pointer-events:auto;
    background:rgba(16,20,30,.72); display:flex; flex-direction:column; gap:10px;
    align-items:center; justify-content:flex-start; overflow:auto; padding:20px;`;
  shotLayer.innerHTML = `
    <div class="flex w-full max-w-4xl items-center gap-2 text-base-100">
      <span class="text-[12px] font-semibold uppercase tracking-widest opacity-80">Screenshots</span>
      <button class="btn btn-xs ml-auto" data-testid="detail.screenshots-close">Close</button>
    </div>
    ${paths.map((p) => `<figure class="w-full max-w-4xl">
      <img src="${esc(api('/evidence/' + p))}" alt="${esc(p)}"
        class="w-full rounded border border-base-300 bg-base-100">
      <figcaption class="mt-1 font-mono text-[10.5px] text-base-100 opacity-70">${esc(p)}</figcaption>
    </figure>`).join('')}`;
  // The backdrop dismisses, the pictures do not: a click meant for an image
  // must not close the thing it is looking at.
  shotLayer.onclick = (e) => { if (e.target === shotLayer) closeShots(); };
  shotLayer.querySelector('[data-testid="detail.screenshots-close"]').onclick = closeShots;
  D.sr.appendChild(shotLayer);
}
