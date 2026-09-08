/*
 * The evidence an agent walkdown left behind, shown over the whole desk.
 *
 * Not "screenshots": what a run attaches has not been only pictures for a
 * long time - the agent tier attaches transcripts as a matter of course, and
 * a rule whose only evidence is a .txt was being handed a broken image with a
 * caption under it (n-0241, n-0242). The file was there; the reader simply
 * could not read it.
 */
import { D } from './state.js';
import { api, esc } from './util.js';

/*
 * What a path is, by its extension - which is all we have, since the ledger
 * records keys and not content types.
 *
 * A picture goes in an <img>; anything text-shaped is fetched and shown as
 * text; anything else is a link to the file, because a name you can open
 * beats a picture that will not load. Unknown is deliberately the LINK case
 * and not the image case: guessing "image" is what produced the broken
 * pictures this module exists to stop.
 */
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const TEXT = /\.(txt|log|json|md|ya?ml|csv|diff|patch)$/i;
const kindOf = (p) => (IMAGE.test(p) ? 'image' : TEXT.test(p) ? 'text' : 'file');

let layer = null;
export const evidenceOpen = () => Boolean(layer);
export function closeEvidence() {
  layer?.remove();
  layer = null;
}

/*
 * The evidence itself, over the whole desk.
 *
 * Deliberately NOT a native <dialog showModal()>: the shell is already a
 * manual popover in the browser's top layer, and promoting a second element
 * into it from inside the first is exactly the pairing that left the rule
 * list unable to take a wheel event at all (n-0086). A plain layer inside
 * the same shadow root is a modal by every behaviour that matters here -
 * it covers the surface, it takes the pointer, and Escape closes it.
 */
export function openEvidence(paths) {
  closeEvidence();
  layer = document.createElement('div');
  layer.dataset.theme = 'blueprint';
  layer.dataset.testid = 'detail.evidence-modal';
  layer.style.cssText = `position:fixed; inset:0; z-index:10; pointer-events:auto;
    background:rgba(16,20,30,.72); display:flex; flex-direction:column; gap:10px;
    align-items:center; justify-content:flex-start; overflow:auto; padding:20px;`;
  const frame = (p, inner) => `<figure class="w-full max-w-4xl" data-evidence="${esc(p)}">
      ${inner}
      <figcaption class="mt-1 font-mono text-[10.5px] text-base-100 opacity-70">${esc(p)}</figcaption>
    </figure>`;
  layer.innerHTML = `
    <div class="flex w-full max-w-4xl items-center gap-2 text-base-100">
      <span class="text-[12px] font-semibold uppercase tracking-widest opacity-80">Evidence</span>
      <button class="btn btn-xs ml-auto" data-testid="detail.evidence-close">Close</button>
    </div>
    ${paths
      .map((p) => {
        const href = esc(api('/evidence/' + p));
        if (kindOf(p) === 'image')
          return frame(
            p,
            `<img src="${href}" alt="${esc(p)}"
        class="w-full rounded border border-base-300 bg-base-100">`,
          );
        if (kindOf(p) === 'text')
          // Same frame the pictures use, so a transcript and a screenshot are
          // one reading rather than two. Filled in below, once fetched.
          return frame(
            p,
            `<pre class="wdp-evidence-text max-h-[70vh] w-full overflow-auto rounded border border-base-300
        bg-base-100 p-2 text-[11.5px] leading-relaxed">Loading…</pre>`,
          );
        return frame(
          p,
          `<a href="${href}" target="_blank" rel="noreferrer"
        class="link link-hover block rounded border border-base-300 bg-base-100 p-2 text-[12px]">Open ${esc(p)}</a>`,
        );
      })
      .join('')}`;
  // The backdrop dismisses, the evidence does not: a click meant for a
  // picture - or a drag meant to select a line of a transcript - must not
  // close the thing it is looking at.
  layer.onclick = (e) => {
    if (e.target === layer) closeEvidence();
  };
  layer.querySelector('[data-testid="detail.evidence-close"]').onclick = closeEvidence;
  D.sr.appendChild(layer);

  /*
   * And the text, fetched after the frame is up. A file that will not load
   * says so in its own frame rather than leaving "Loading…" standing: the
   * reader is owed the difference between "slow" and "gone", and the other
   * files on the page are unaffected either way.
   */
  for (const p of paths.filter((x) => kindOf(x) === 'text')) {
    const pre = layer.querySelector(`[data-evidence="${CSS.escape(p)}"] .wdp-evidence-text`);
    if (!pre) continue;
    fetch(api('/evidence/' + p))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((text) => {
        pre.textContent = text;
      })
      .catch((err) => {
        pre.textContent = `Could not read this file (${err.message}). It is still on disk at ${p}.`;
      });
  }
}
