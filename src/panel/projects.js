/*
 * Projects: the two-level model, and the screen that asks which one.
 *
 * A PROJECT is a directory somebody imported - normally a repository. A
 * BLUEPRINT is a specification inside one. The panel had only the second word
 * for both, which is how "project" came to mean a blueprint everywhere in the
 * payload while meaning a repository everywhere in conversation (ADR 0001 §2).
 *
 * The modal here is the one screen for every case where the address cannot
 * decide on its own: nothing claims this page, several projects do, or there
 * is no page to route from at all because you are looking at the server's own
 * root. One screen rather than three, because they are one question - which
 * project am I working in - and three screens asking it were three places for
 * the answer to differ (ADR 0001 §7).
 */
import { html, nothing } from '../../vendor/lit.js';
import { S } from './state.js';
import { fire } from './util.js';

/** Which project a listed blueprint belongs to, by id. Server-supplied. */
export const projectIdOf = (bp) => bp?.project?.id ?? null;

/** The blueprints this server holds for one project, in payload order. */
export const blueprintsOf = (id) => S.projects.filter((bp) => projectIdOf(bp) === id);

/**
 * The projects this server holds, each with its blueprints and whichever of
 * them claim the page under review.
 *
 * Grouped here rather than by the server because the server answers two
 * questions - what it holds, and who claims an address - and the join between
 * them is the panel's own business.
 */
export function projectsHeld() {
  const byId = new Map();
  for (const bp of S.projects) {
    const id = projectIdOf(bp) ?? bp.key ?? bp.id;
    if (!byId.has(id)) byId.set(id, { id, root: bp.project?.root ?? null, blueprints: [], claims: [] });
    const row = byId.get(id);
    row.blueprints.push(bp);
    if (S.claimants.some((m) => m.key === bp.key)) row.claims.push(bp);
  }
  return [...byId.values()];
}

/** Matching projects first; the rest keep the order the server listed them in. */
export const rankedProjects = () => {
  const all = projectsHeld();
  return [...all.filter((p) => p.claims.length), ...all.filter((p) => !p.claims.length)];
};

/*
 * What a person can do from here that is not "pick one of these". Two
 * commands and a sentence each, and they sit ABOVE the list on purpose: a
 * machine with twenty projects would push them off the bottom of the screen,
 * and they are the whole answer for somebody whose project is not listed yet
 * (Topher, 2026-09-09).
 *
 * Neither ever runs from the browser. `init` and `import` write to a person's
 * disk and to their personal config, and a button here would be walkdown
 * adopting a directory on the strength of a click in a web page
 * (ownership.writes.spec-never-implementation, ADR 0001 §4).
 */
function commands(here) {
  return html`
    <div class="flex flex-col gap-3 border-b border-base-300 px-4 py-3" data-testid="project.commands">
      ${
        here
          ? html`<div class="flex flex-col gap-1.5">
              <p class="text-[11px] uppercase tracking-wider opacity-50">Make this page reviewable</p>
              <p class="text-[12.5px] leading-relaxed opacity-70">Add its address to a blueprint's
                storyboard as a screen's <span class="font-mono text-[11px]">app</span> path, or as a
                target's <span class="font-mono text-[11px]">base_url</span> — then walkdown knows
                this page is part of that blueprint.</p>
              <code class="rounded-box bg-base-200 px-2 py-1.5 text-[11px] break-all"
                >walkdown claims --url ${here}</code>
              <p class="text-[11px] leading-relaxed opacity-50">says which blueprints, if any, claim
                an address today.</p>
            </div>`
          : nothing
      }
      <div class="flex flex-col gap-1.5" data-testid="project.new">
        <p class="text-[11px] uppercase tracking-wider opacity-50">Or bring a project in</p>
        <code class="rounded-box bg-base-200 px-2 py-1.5 text-[11px]">walkdown import &lt;path&gt;</code>
        <p class="text-[11px] leading-relaxed opacity-50">takes a repository's blueprints into this
          machine's registry. <span class="font-mono">walkdown init</span> starts one where there is
          nothing yet. Both are commands you run — walkdown never adopts a directory from a browser.</p>
      </div>
    </div>`;
}

/**
 * The project modal. Drawn over everything, including the panel, because
 * until this is answered there is nothing behind it worth reading.
 *
 * @param {{ here: string|null, closable: boolean }} opts
 */
export function projectModal({ here, closable }) {
  const rows = rankedProjects();
  const claimed = S.claimants.length;
  return html`
    <div class="absolute inset-0 bg-base-300/70" @click=${(e) => closable && fire(e.currentTarget, 'close-projects')}></div>
    <div class="absolute left-1/2 top-12 flex max-h-[80vh] w-[min(560px,92vw)] -translate-x-1/2 flex-col
                overflow-hidden rounded-box border border-primary/45 bg-base-100 text-base-content shadow-2xl"
         data-theme="blueprint" data-testid="project.modal">
      <div class="flex items-start gap-3 px-4 pt-3.5 pb-2.5">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="text-[15px] font-semibold">Which project?</div>
          ${
            here
              ? html`<p class="break-all font-mono text-[11px] opacity-55" data-testid="project.address">${here}</p>
                <p class="text-[12px] leading-relaxed opacity-60" data-testid="project.why">${
                  claimed
                    ? `${claimed} blueprints claim this page, in more than one project.`
                    : 'No blueprint claims this page.'
                }</p>`
              : html`<p class="text-[12px] leading-relaxed opacity-60" data-testid="project.why">There is no page
                  to route from here — this is walkdown's own server. Pick what you are working on.</p>`
          }
        </div>
        ${
          closable
            ? html`<button class="btn btn-ghost btn-xs" data-testid="project.close"
                @click=${(e) => fire(e.currentTarget, 'close-projects')}>Close</button>`
            : nothing
        }
      </div>
      ${commands(here)}
      ${
        rows.length
          ? html`<div class="min-h-0 flex-1 overflow-y-auto" data-testid="project.list">${rows.map(
              (p) => html`
              <button class="block w-full border-b border-base-300 px-4 py-2.5 text-left last:border-b-0 hover:bg-base-200"
                data-project="${p.id}" ?data-claims=${p.claims.length > 0}
                @click=${(e) => fire(e.currentTarget, 'pick-project', { id: p.id })}>
                <span class="flex items-center gap-2">
                  <span class="text-[13px] font-semibold ${p.id === S.project ? 'text-primary' : ''}">${p.id}</span>
                  ${
                    p.claims.length
                      ? html`<span class="badge badge-primary badge-xs" data-testid="project.claims"
                          >claims this page</span>`
                      : nothing
                  }
                  <span class="ml-auto shrink-0 text-[11px] opacity-45">${p.blueprints.length} blueprint${
                    p.blueprints.length === 1 ? '' : 's'
                  }</span>
                </span>
                ${
                  p.claims.length
                    ? html`<span class="mt-0.5 block text-[11.5px] leading-snug opacity-65">via ${p.claims
                        .map((b) => b.name)
                        .join(', ')}</span>`
                    : nothing
                }
                ${
                  p.root
                    ? html`<span class="mt-0.5 block font-mono text-[10.5px] opacity-35">${p.root}</span>`
                    : nothing
                }
              </button>`,
            )}</div>`
          : html`<p class="px-4 py-4 text-[12.5px] opacity-45" data-testid="project.none">This server holds no
              projects. Import one above.</p>`
      }
    </div>`;
}
