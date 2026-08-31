/*
 * The Blueprints tab: which server, which blueprint, and what crossing to
 * another one does to a sitting already in progress.
 */
import { html } from '../../vendor/lit.js';
import { saveSession, start } from './app.js';
import { CHOICE, D, REINJECTS, S, store } from './state.js';
import { toast } from './toast.js';
import { api, esc } from './util.js';

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
        <button class="btn btn-xs btn-outline btn-primary" id="wdp-retry">Connect</button>
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
        data-pick="${pr.id}">
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

/** Server address and blueprint choice, wired the same wherever they appear. */
/*
 * Offered rather than decided: a sitting is somebody's work in progress, and
 * a picker that silently discarded it - or silently carried it - would be
 * making that call for them.
 */
export function askAboutSitting(nextBp) {
  const name = S.projects.find((p) => p.id === nextBp)?.name ?? nextBp;
  toast(
    `A walkdown is running on <b>${esc(S.data.project)}</b>, with <b>${
      Object.keys(S.session.verdicts).length
    } judged</b>. It cannot come with you to ${esc(name)}.` +
      ` <button class="link" data-sitting="keep">Keep it as a draft</button>` +
      ` · <button class="link" data-sitting="discard">Discard it</button>`,
    {
      sticky: true,
      tone: 'warning',
      on: {
        keep: () => crossTo(nextBp), // the draft is already on disk
        discard: async () => {
          await discardSitting();
          crossTo(nextBp);
        },
      },
    },
  );
}

/** End the sitting and take nothing with it. */
export async function discardSitting() {
  S.session = null;
  saveSession();
  await fetch(api('/api/draft'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ discard: true }),
  }).catch(() => {});
}

export function crossTo(nextBp) {
  S.session = null; // left behind, on disk, waiting to be resumed
  S.BP = nextBp;
  store.set(CHOICE, S.BP);
  S.listTab = 'rules';
  S.view = 'list';
  S.selected = null;
  S.phase = 'loading';
  S.jumpOnLoad = true;
  start();
}

export function wireBlueprints(root) {
  const retry = root.querySelector('#wdp-retry');
  if (retry)
    retry.onclick = () => {
      const at = root.querySelector('#wdp-server').value.trim();
      if (at) {
        S.SERVER = at.replace(/\/+$/, '');
        store.set(CHOICE + ':server', S.SERVER);
      }
      S.phase = 'loading';
      start();
    };
  root.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = async () => {
      /*
       * A walkdown belongs to the blueprint it was started in - its verdicts
       * name that blueprint's rules and nothing else. Carrying a sitting
       * across would either write those verdicts into a project they do not
       * describe or drop them on the floor, so the crossing has to be
       * settled first. The draft is already on disk, which is what makes
       * "keep it and come back" a real offer rather than a promise.
       */
      if (S.session && b.dataset.pick !== S.BP) return askAboutSitting(b.dataset.pick);
      S.BP = b.dataset.pick;
      await store.set(CHOICE, S.BP);
      S.listTab = 'rules';
      S.view = 'list';
      S.selected = null;
      S.phase = 'loading';
      // A picker that changes the panel and not the page is only half a
      // choice — but where to go depends on the blueprint that is still
      // loading, so it is settled there.
      S.jumpOnLoad = true;
      start();
    };
  });
}
