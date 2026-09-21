/*
 * The choices a question offers, drawn the same way wherever the question
 * is asked - on the rule's detail and on the question's own screen (n-0319:
 * an ask has to be answerable from either place). One pick at a time, held
 * in S.askChoice until Answer sends it.
 */
import { html, nothing } from '../../vendor/lit.js';
import { requestRender } from './shell.js';
import { S } from './state.js';

export const pickAsk = (label) => {
  S.askChoice = S.askChoice === label ? null : label;
  requestRender();
};

export function askOptions(asked) {
  if (!asked?.options?.length) return nothing;
  return html`<div class="mt-1.5 flex flex-col gap-1" data-testid="detail.ask-options">${asked.options.map(
    (o) => html`<button type="button" class="flex items-start gap-2 rounded border px-2 py-1 text-left ${S.askChoice === o.label ? 'border-primary bg-primary/15' : 'border-base-300 bg-base-100/60'}"
        data-option="${o.label}" aria-pressed="${S.askChoice === o.label}" @click=${() => pickAsk(o.label)}>
        <span class="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-full border ${S.askChoice === o.label ? 'border-primary bg-primary' : 'border-base-content/50'}"></span>
        <span><b class="block text-[11.5px]">${o.label}</b>${o.why ? html`<span class="block opacity-70">${o.why}</span>` : nothing}</span>
      </button>`,
  )}</div>`;
}
