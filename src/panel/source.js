/*
 * A check's source, over the whole desk (n-0318).
 *
 * The rule detail used to fold the source into a disclosure under the
 * steps, in a pre eleven pixels tall; reading a forty-line check there was
 * scrolling a letterbox. It is the evidence layer's own shape instead: the
 * same backdrop, the same Close, Escape to dismiss - one way to read a
 * thing that is bigger than the pane. Each check carries a link to the same
 * lines on GitHub, opened in a new tab, when the tree has one.
 */
import { D } from './state.js';
import { api, esc } from './util.js';

let layer = null;
export const sourceOpen = () => Boolean(layer);
export function closeSource() {
  layer?.remove();
  layer = null;
}

/** GitHub's address for a check's lines, or null when the tree has no GitHub remote. */
export const sourceLink = (repo, c) => {
  if (!repo?.web || !repo.sha) return null;
  const file = c.ref.replace(/:\d+$/, '');
  const start = Number(c.startLine) || Number(c.ref.match(/:(\d+)$/)?.[1]) || 1;
  const lines = String(c.source ?? '').split('\n').length;
  return `${repo.web}/blob/${repo.sha}/${file}#L${start}-L${start + lines - 1}`;
};

export async function openSource(rule) {
  closeSource();
  layer = document.createElement('div');
  layer.dataset.theme = 'blueprint';
  layer.dataset.testid = 'detail.source-modal';
  layer.style.cssText = `position:fixed; inset:0; z-index:10; pointer-events:auto;
    background:rgba(16,20,30,.78); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
    display:flex; flex-direction:column; gap:10px;
    align-items:center; justify-content:flex-start; overflow:auto; padding:20px;`;
  layer.innerHTML = `
    <div class="flex w-full max-w-4xl items-center gap-2 text-base-100">
      <span class="text-[12px] font-semibold uppercase tracking-widest opacity-80">Check source</span>
      <span class="font-mono text-[11px] opacity-70">${esc(rule)}</span>
      <button class="btn btn-xs ml-auto" data-testid="detail.source-close">Close</button>
    </div>
    <div class="wdp-source w-full max-w-4xl text-base-100 opacity-80">Loading…</div>`;
  layer.onclick = (e) => {
    if (e.target === layer) closeSource();
  };
  layer.querySelector('[data-testid="detail.source-close"]').onclick = closeSource;
  D.sr.appendChild(layer);

  const box = layer.querySelector('.wdp-source');
  try {
    const res = await fetch(api(`/api/checks?rule=${encodeURIComponent(rule)}`));
    const out = await res.json();
    if (layer?.querySelector('.wdp-source') !== box) return; // closed, or another opened
    const checks = out.checks ?? [];
    box.innerHTML = checks.length
      ? checks
          .map((c) => {
            const link = sourceLink(out.repo, c);
            return `<figure class="mb-3 w-full" data-check="${esc(c.ref)}">
        <figcaption class="mb-1 flex items-center gap-2 rounded bg-neutral/90 px-2 py-1 font-mono text-[11px] text-neutral-content">
          <span>${esc(c.ref)}</span>${
            c.recorded ? `<span class="text-warning">· was ${esc(c.recorded)} when last recorded</span>` : ''
          }${
            link
              ? `<a class="link ml-auto font-sans text-[11px] no-underline" target="_blank" rel="noreferrer"
                 href="${esc(link)}" data-testid="detail.source-github">Open on GitHub ↗</a>`
              : ''
          }
        </figcaption>
        ${
          c.missing
            ? `<div class="rounded border border-warning bg-base-100 p-2 text-[12px] text-warning">No longer in the tree.</div>`
            : `<pre class="max-h-[70vh] w-full overflow-auto rounded border border-base-300 bg-base-100 p-2 text-[11.5px] leading-relaxed text-base-content">${esc(c.source ?? '')}</pre>`
        }
      </figure>`;
          })
          .join('')
      : '<div class="text-[12px]">No source recorded for this rule.</div>';
  } catch {
    if (layer?.querySelector('.wdp-source') === box) box.textContent = 'walkdown server unreachable.';
  }
}
