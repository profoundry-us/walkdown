/*
 * The Blueprints tab: which server, which blueprint, and what crossing to
 * another one does to a sitting already in progress.
 */
import { html } from '../../vendor/lit.js';
import { S } from './state.js';
import { fire } from './util.js';

/*
 * Which screen is this page? The panel guesses from the URL and is usually
 * right; this is where you say otherwise, and where you see which screens
 * have a design on file to compare against at all.
 */
export function blueprintsPane() {
  return html`
    <div class="px-3.5 pb-2 pt-1">
      <div class="mb-1 text-[11px] font-bold uppercase tracking-wider opacity-50">walkdown server</div>
      <div class="flex items-center gap-2">
        <input id="wdp-server" class="input input-xs flex-1" value="${S.SERVER}"
               aria-label="walkdown server address">
        <button class="btn btn-xs btn-outline btn-primary" id="wdp-retry"
          @click=${(e) => {
            const box = e.currentTarget.closest('div')?.querySelector('#wdp-server');
            fire(e.currentTarget, 'connect', { server: (box?.value ?? '').trim() });
          }}>Connect</button>
      </div>
      ${
        S.servedRoot
          ? html`<p class="mt-1.5 text-[11px] leading-relaxed opacity-50" data-testid="start.folder">Serving
            <span class="font-mono opacity-80">${S.servedRoot}</span> \u2014 every blueprint
            under it is listed below.</p>`
          : html`<p class="mt-1.5 text-[11px] leading-relaxed opacity-40">Not connected. Run
            <code>walkdown serve</code> in the folder holding your blueprints.</p>`
      }
    </div>
    <div data-testid="start.options">${
      S.projects.length
        ? S.projects.map((pr) => {
            const on = pr.id === S.BP;
            return html`<button class="block w-full border-t border-base-300 px-3.5 py-2.5 text-left hover:bg-base-200"
        data-pick="${pr.id}" @click=${(e) => fire(e.currentTarget, 'pick-blueprint', { id: pr.id })}>
        <span class="flex items-center gap-2">
          <span class="w-3.5 shrink-0 text-center ${on ? 'text-primary' : 'opacity-30'}">${on ? '\u25c9' : '\u25cb'}</span>
          <span class="text-[13px] font-semibold">${pr.name}</span>
        </span>
        <span class="mt-0.5 block pl-5.5 text-[12px] leading-snug opacity-60">${
          pr.description ?? 'No description \u2014 add one to this blueprint\u2019s walkdown.yml.'
        }</span>
        <span class="mt-0.5 block pl-5.5 font-mono text-[10.5px] opacity-35">${pr.id}</span>
      </button>`;
          })
        : html`<p class="px-3.5 py-3 text-[12.5px] opacity-40">Nothing found under that folder.</p>`
    }</div>`;
}
