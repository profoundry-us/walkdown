/*
 * The Blueprints tab: which server, which blueprint, and what crossing to
 * another one does to a sitting already in progress.
 */
import { html, nothing } from '../../vendor/lit.js';
import { S } from './state.js';
import { fire } from './util.js';

/*
 * Which screen is this page? The panel guesses from the URL and is usually
 * right; this is where you say otherwise, and where you see which screens
 * have a design on file to compare against at all.
 */
/*
 * The address row: a box holding the server address and a button that goes
 * there. It lives here because it is drawn in two places - this tab, and the
 * start gate before any blueprint is open - and it was written out twice,
 * with the SAME element ids and a handler on only one of them. The gate's
 * copy was therefore inert: typing a live address into it and pressing
 * Connect sent no request anywhere, so the one screen whose whole job is
 * reaching a server could not reach one (n-0236). One component, one
 * handler, drawn wherever it is needed.
 */
export function serverRow(size = 'xs', { caption = false } = {}) {
  /*
   * The caption is drawn where the design draws it - on the start screen,
   * where the box arrives with no heading over it and the whole screen turns
   * on knowing that the thing you type is a SERVER. On the Blueprints tab
   * the row already sits under "walkdown server", and a second caption there
   * would be the same word twice.
   *
   * A label rather than a span beside it, so the caption focuses the box, and
   * the title is the design's sentence verbatim.
   */
  return html`
    <label class="flex items-center gap-2">
      ${caption ? html`<span class="shrink-0 text-xs opacity-60">Server</span>` : nothing}
      <input id="wdp-server" data-testid="start.server" class="input input-${size} flex-1" value="${S.SERVER}"
             title="Where walkdown serve is listening — a server, not a folder"
             aria-label="walkdown server address">
      <button class="btn btn-${size} ${size === 'xs' ? 'btn-outline ' : ''}btn-primary" id="wdp-retry"
        data-testid="start.connect"
        @click=${(e) => {
          const box = e.currentTarget.closest('label')?.querySelector('#wdp-server');
          fire(e.currentTarget, 'connect', { server: (box?.value ?? '').trim() });
        }}>Connect</button>
    </label>`;
}

/*
 * The list is the ACTIVE PROJECT's blueprints, not the server's (ADR 0001
 * §10). A server offers every project this machine has imported, and a tab
 * listing all of them at once would be a filing cabinet rather than a place
 * you are working; the project switcher in the bar is how you reach another.
 *
 * Blueprints claiming the page under review come first and say so, because
 * that is the only thing on this screen the address can tell you.
 *
 * `server: false` draws the list without the address row above it - the
 * several-claimants case is already connected, and a box for changing the
 * address in the middle of "two blueprints claim this page" answers a
 * question nobody asked.
 */
export function blueprintsPane({ server = true, notice = null } = {}) {
  const mine = S.project ? S.projects.filter((pr) => pr.project?.id === S.project) : S.projects;
  const claims = (pr) => S.claimants.some((m) => m.key === pr.key);
  const rows = [...mine.filter(claims), ...mine.filter((pr) => !claims(pr))];
  return html`
    ${
      server
        ? html`<div class="px-3.5 pb-2 pt-1">
            <div class="mb-1 text-[11px] font-bold uppercase tracking-wider opacity-50">walkdown server</div>
            ${serverRow('xs')}
          </div>`
        : nothing
    }
    <div class="px-3.5 pb-2 ${server ? '' : 'pt-1'}">
      ${
        S.project
          ? html`<p class="text-[11px] leading-relaxed opacity-50" data-testid="start.folder">Blueprints in
            <span class="font-mono break-all opacity-80">${S.project}</span> — switch projects from the bar.</p>`
          : html`<p class="text-[11px] leading-relaxed opacity-40">Not connected. Run
            <code>walkdown serve</code>, then <code>walkdown import</code> the project you want.</p>`
      }
      ${
        notice
          ? html`<p class="mt-1.5 text-[12px] leading-relaxed opacity-70" data-testid="start.notice">${notice}</p>`
          : nothing
      }
    </div>
    <div data-testid="start.options">${
      rows.length
        ? rows.map((pr) => {
            const on = pr.key === S.BP;
            return html`<button class="block w-full border-t border-base-300 px-3.5 py-2.5 text-left hover:bg-base-200"
        data-pick="${pr.key ?? pr.id}" ?data-claims=${claims(pr)}
        @click=${(e) => fire(e.currentTarget, 'pick-blueprint', { id: pr.key ?? pr.id })}>
        <span class="flex items-center gap-2">
          <span class="w-3.5 shrink-0 text-center ${on ? 'text-primary' : 'opacity-30'}">${on ? '\u25c9' : '\u25cb'}</span>
          <span class="text-[13px] font-semibold">${pr.name}</span>
          ${
            claims(pr)
              ? html`<span class="badge badge-primary badge-xs" data-testid="start.claims">claims this page</span>`
              : nothing
          }
        </span>
        <span class="mt-0.5 block pl-5.5 text-[12px] leading-snug opacity-60">${
          pr.description ?? 'No description \u2014 add one to this blueprint\u2019s walkdown.yml.'
        }</span>
        <span class="mt-0.5 block pl-5.5 font-mono text-[10.5px] opacity-35">${pr.id}</span>
      </button>`;
          })
        : html`<p class="px-3.5 py-3 text-[12.5px] opacity-40">This project declares no blueprint walkdown can read.</p>`
    }</div>`;
}
