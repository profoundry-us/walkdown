/*
 * The rule detail: the whole of one rule — its statement, its steps, what each
 * tier has recorded, the check's own source behind a disclosure, and the
 * conversations anchored to it.
 */
import { MSG } from '../../lib/message-stream.js';
import { declaredAnchors, elsewhere, open, render } from './app.js';
import { threadCard } from './thread-pane.js';
import { openShots } from './shots.js';
import { S } from './state.js';
import { api, esc } from './util.js';
import { tierMarks } from './rules-list.js';
import { LBL, isHeadless, needsYou, ruleScreen, screenById, shortName, threadsFor, whoAmI } from './vocab.js';

/*
 * Where this rule's check source lives.
 *
 * The ledger is asked first, because a recorded ref is the truth about what
 * a run actually went through. But a rule whose checks have never been run
 * still HAS check source, and a disclosure that stays empty until the first
 * recorded run is a disclosure nobody ever finds - which is exactly what was
 * reported (n-0084). So the suite's own scan is the fallback.
 */
export const checkRefs = (row) => {
  const recorded = [...new Set((S.data?.targets ?? []).flatMap((t) => row.cells?.[t]?.checks ?? []))];
  return recorded.length ? recorded : (S.data?.checkSource?.[row.rule] ?? []);
};

/*
 * Fetch the source behind a rule's checks, keep it, and repaint.
 *
 * Kept rather than written straight into the disclosure: the answer outlives
 * several rebuilds of the pane that asked for it. A request the reader has
 * moved on from is dropped on arrival rather than painted over whatever they
 * are reading now.
 */
export async function loadCheckSource(rule) {
  if (S.srcCache.rule === rule && S.srcCache.html) return;
  S.srcCache = { rule, html: null };
  let html;
  try {
    const res = await fetch(api(`/api/checks?rule=${encodeURIComponent(rule)}`));
    const out = await res.json();
    html = (out.checks ?? []).map((c) => c.missing
      ? `<div class="text-warning">${esc(c.ref)} — no longer in the tree</div>`
      : `<div class="mb-1"><div class="font-mono text-[10.5px] opacity-60">${esc(c.ref)}</div>
          <pre class="overflow-x-auto whitespace-pre rounded bg-base-300/40 p-1.5 text-[10.5px] leading-snug">${
            esc(c.source)}</pre></div>`).join('') || 'No source recorded.';
  } catch {
    html = 'walkdown server unreachable.';
  }
  if (S.srcCache.rule !== rule) return;
  S.srcCache.html = html;
  render();
}

/*
 * What the rule's standing rests on: the latest ledger result for each kind
 * of evidence it asks for, who or what produced it, and when. The chain of
 * trust belongs where the rule is judged - a verdict you cannot see the
 * basis of is a verdict you have to take on faith.
 */
export function evidenceRows(row) {
  const STATE = {
    pass: ['✓', 'text-success'], fail: ['✗', 'text-error'], stale: ['~', 'text-warning'],
    approved: ['✍︎', 'text-warning'], refining: ['✎︎', 'text-warning'],
    skipped: ['–', 'opacity-50'], blocked: ['⊘', 'text-warning'], never: ['○', 'opacity-50'],
    na: ['·', 'opacity-40'],
  };
  const line = (label, cell) => {
    const [glyph, cls] = STATE[cell?.state] ?? STATE.na;
    const who = cell?.actor ? ` · ${esc(cell.actor)}` : '';
    const when = cell?.created ? ` · ${esc(MSG.ago(cell.created))}` : '';
    const said = cell?.state === 'never' ? 'never run'
      : cell?.state === 'na' ? 'not required'
      : `${esc(cell.state)}${who}${when}`;
    return `<div class="evrow" title="${esc(cell?.runId ?? '')}">
      <span class="src">${esc(label)}</span>
      <span class="${cls}">${glyph} ${said}</span></div>`;
  };
  /*
   * The screenshots an agent's run attached. They are that run's evidence,
   * not a tier of their own, so they hang under the agent's row as a bullet
   * rather than standing beside it as a fourth kind of verdict (n-0100) -
   * and they are a link, because a count of pictures nobody can look at is
   * not evidence.
   */
  const shots = (cell) => {
    const shot = cell?.evidence ?? [];
    if (!shot.length) return '';
    return `<div class="evrow evshot">
      <span class="src"></span>
      <span class="opacity-70">• Screenshots —
        <button class="link link-hover text-primary" data-testid="detail.screenshots"
          data-shots="${esc(JSON.stringify(shot))}"
          title="Open the ${shot.length} screenshot${shot.length > 1 ? 's' : ''} this run attached"
          >open ${shot.length}</button></span></div>`;
  };
  /*
   * A tier the rule declares it cannot honestly have, said in the row that
   * tier's evidence would have occupied. An excuse nobody can read is one
   * nobody can argue with, which is the whole reason it is written down
   * rather than left as an omission - so it is a line on the page, not a
   * tooltip and not a silence where a row used to be.
   */
  const excuse = (label, why) => `<div class="evrow" data-testid="detail.excuse">
    <span class="src">${esc(label)}</span>
    <span class="opacity-70">— not checkable here: ${esc(why)}</span></div>`;
  const rows = [
    ...(row.verify.includes('checks')
      ? (S.data?.targets ?? []).map((t) => line(`checks/${t}`, row.cells?.[t]))
      : []),
    row.excuses?.checks ? excuse('checks', row.excuses.checks) : '',
    ...(row.verify.includes('agent') ? [line('agent', row.agent), shots(row.agent)] : []),
    row.excuses?.agent ? excuse('agent', row.excuses.agent) : '',
    ...(row.verify.includes('human') ? [line('human', row.human)] : []),
  ].filter(Boolean);
  // A rule with nothing recorded says so, rather than showing an empty box.
  return rows.length
    ? rows.join('')
    : '<div class="text-[13px] opacity-50">Nothing recorded yet.</div>';
}

export function detailPane() {
  const r = S.selected;
  // A pin with no rule has no rule screen: it opens on the thread screen
  // itself, and this slot is only what slides past on the way there.
  if (!r) return `
    <div class="flex items-center px-2 pt-2">
      <button class="wdp-back btn btn-ghost btn-xs text-primary" data-testid="detail.back">← All rules</button>
    </div>
    <div class="px-3.5 pt-1 text-[12.5px] opacity-60">This thread is not attached to a rule.</div>`;
  const threads = threadsFor(r.rule);
  /*
   * A step writes the things it is about in backticks - anchors and screen
   * ids, the same tokens lint scans for. An anchor among them is a pointer:
   * hovering it lights the element up on the surface under review, so
   * reading a step and finding what it means are one act rather than a hunt
   * (n-0087). Only DECLARED anchors get the treatment; anything else in
   * backticks is a screen id or prose and stays plain type.
   */
  const anchors = declaredAnchors();
  const steps = r.steps
    ? Object.entries(r.steps).map(([ph, items]) =>
        `<span class="${LBL} pt-1">${esc(ph)}</span><span>${items.map((s) =>
          esc(s).replace(/`([^`]+)`/g, (_m, tok) => (anchors.has(tok)
            ? `<code class="wdp-anchor cursor-help rounded bg-base-200 px-1 text-xs underline decoration-dotted underline-offset-2" data-anchor="${tok}" title="Show this on the surface">${tok}</code>`
            : `<code class="rounded bg-base-200 px-1 text-xs">${tok}</code>`))).join('<br>')}</span>`).join('')
    : '';
  const picked = S.session?.verdicts[r.rule];
  // Step through the rules in the order the list shows them, without going
  // back to it. The back link keeps its word ("All rules") so the bare
  // arrows beside it read as the stepper rather than as a second way out.
  const at = S.data.rows.findIndex((x) => x.rule === r.rule);
  const step = (row, cls, glyph, label) =>
    `<div class="tooltip tooltip-left" data-tip="${esc(row ? `${label} rule: ${shortName(row)}` : `No ${label.toLowerCase()} rule`)}">
      <button class="${cls} btn btn-ghost btn-xs" data-testid="detail.stepper" ${row ? `data-goto="${esc(row.rule)}"` : 'disabled'}>${glyph}</button>
    </div>`;
  return `
    <div class="flex items-center px-2 pt-2">
      <button class="wdp-back btn btn-ghost btn-xs text-primary" data-testid="detail.back">← All rules</button>
      <div class="ml-auto flex gap-0.5">
        ${step(at > 0 ? S.data.rows[at - 1] : null, 'wdp-prev', '←', 'Previous')}
        ${step(at >= 0 && at < S.data.rows.length - 1 ? S.data.rows[at + 1] : null, 'wdp-next', '→', 'Next')}
      </div>
    </div>
    <div class="flex flex-col gap-3 px-3.5 pb-3.5 pt-1">
      <div>
        <!-- The same strip the list drew, in the same order, so opening a
             rule does not cost you the marks you opened it for. It is the
             list's own function, not a copy: two drawings of one vocabulary
             is how the CLI and the panel came to disagree about ✍︎ (n-0118). -->
        <div class="flex items-center gap-2">
          ${tierMarks(r, needsYou(r.rule))}
          <div class="break-all font-mono text-[11px] opacity-40" data-testid="detail.rule-id">${esc(r.rule)}</div>
        </div>
        <p class="text-[15px] leading-relaxed" data-testid="detail.statement">${esc(r.statement)}</p>
        ${elsewhere(r)}
      </div>
      ${S.session ? `<div class="flex flex-col gap-1.5">
        <!-- The box rides ABOVE the buttons: write the why, then judge. -->
        <textarea id="wdp-vnote" data-testid="detail.feedback" class="textarea textarea-xs h-14 w-full" placeholder="${r.built
          ? 'Why? Anything written here is filed as a note with your verdict.'
          : 'What should change? Refine files this as the rule’s feedback.'}">${esc(S.verdictNote)}</textarea>
        ${r.built ? `<div class="flex gap-2" data-testid="detail.verdict">
          <button class="btn btn-sm flex-1 ${picked === 'pass' ? 'btn-success' : 'btn-outline btn-success'}" data-v="pass">✓ Pass</button>
          <button class="btn btn-sm flex-1 ${picked === 'fail' ? 'btn-error' : 'btn-outline btn-error'}" data-v="fail">✗ Fail</button>
        </div>` : `<div class="flex gap-2" data-testid="detail.verdict">
          <button class="btn btn-sm flex-1 ${picked === 'approved' ? 'btn-success' : 'btn-outline btn-success'}" data-v="approved">✍︎ Approve</button>
          <button class="btn btn-sm flex-1 ${picked === 'refining' ? 'btn-warning' : 'btn-outline btn-warning'}" data-v="refining">✎︎ Refine</button>
        </div>
        <div class="text-[11px] opacity-50">No build evidence yet — you are signing off the rule, not judging a build.</div>`}
        <div id="wdp-vsay" data-testid="detail.say" class="hidden text-[11px] text-warning"></div>
        <div class="text-[11.5px] opacity-50" data-testid="detail.judged">${Object.keys(S.session.verdicts).length} judged this session</div>
      </div>` : ''}
      ${(() => {
        /*
         * A screen can be a STATE rather than an address - a filtered list,
         * an open drawer, the second time you submit the same form - and a
         * state shares its URL with the page it is a state of. Walking to a
         * rule about one navigates to that shared address and lands you on
         * the page, not in the state, so the storyboard's setup is the rest
         * of the sentence: it says what to do on arrival. Above the steps,
         * because it happens before them.
         */
        const setup = ruleScreen(r)?.app?.setup;
        return setup ? `<div>
          <!-- "Setup" is the storyboard's own word for this field, and the
               panel calling it something else made a reviewer translate
               between the two (n-0099). -->
          <div class="${LBL} mb-1.5">Setup</div>
          <div class="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[13px] leading-relaxed"
            data-testid="detail.setup">${esc(setup)}</div>
        </div>` : '';
      })()}
      ${(() => {
        /*
         * Which screen this rule is about, said plainly and above the steps.
         *
         * It was only ever implicit before - the surface moved when you opened
         * the rule, and if it moved somewhere wrong the rule looked wrong
         * instead. A rule pointed at the wrong screen is a common and quiet
         * error in a blueprint this size, and it cannot be corrected by
         * somebody who cannot see what was chosen.
         *
         * A flow is drawn as the chain it is, because the LAST screen of a
         * flow is the one the rule is judged on (ruleScreen) and a chain that
         * did not show its end would answer a different question.
         */
        const ids = r.flow?.length ? r.flow : (r.screens ?? []);
        const sep = r.flow?.length ? ' → ' : ', ';
        const name = (id) => {
          const sc = screenById(id);
          return `<span class="${sc ? '' : 'text-warning'}">${esc(sc?.title ?? id)}</span>${
            sc?.title ? ` <code class="rounded bg-base-200 px-1 text-[11px] opacity-70">${esc(id)}</code>` : ''}`;
        };
        return `<div>
          <div class="${LBL} mb-1.5">Screen</div>
          <div class="text-[13px] leading-relaxed" data-testid="detail.screen">${
            ids.length
              ? ids.map(name).join(sep)
              : `<span class="opacity-50">${isHeadless(r)
                  ? 'No screen — this rule is judged without one.'
                  : 'No screen named.'}</span>`}</div>
        </div>`;
      })()}
      ${steps ? `<div><div class="${LBL} mb-1.5">Steps</div>
        <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[13px] leading-relaxed"
          data-testid="detail.steps">${steps}</div>
        ${checkRefs(r).length ? `<!-- The steps are the rule; the source that checks them is a
             technical detail, so it waits behind a disclosure until asked for. -->
          <details class="mt-2 rounded border border-base-300 bg-base-200/60 px-2 py-1 text-[11.5px]"
            data-testid="detail.technical-disclosure" data-checks="${esc(r.rule)}"${
              S.srcOpenFor === r.rule ? ' open' : ''}>
            <summary class="cursor-pointer opacity-60">Check source · ${
              checkRefs(r).map((c) => esc(c)).join(', ')}</summary>
            <div class="wdp-check-src mt-1 opacity-70">${
              S.srcCache.rule === r.rule && S.srcCache.html ? S.srcCache.html : 'Loading…'}</div>
          </details>` : ''}</div>` : ''}
      <div>
        <div class="${LBL} mb-1.5">Evidence</div>
        <div data-testid="detail.evidence">${evidenceRows(r)}</div>
      </div>
      <div>
        <div class="${LBL} mb-1.5">Verify</div>
        <div class="text-[13px]" data-testid="detail.verify">${esc(r.verify.join(', '))}</div>
      </div>
      ${threads.length ? `<div class="-mx-3.5" data-testid="detail.threads">
        <div class="${LBL} mb-0.5 flex items-center gap-2 px-3.5">Threads
          ${threads.filter((t) => t.status === 'addressed').length > 1
            /*
             * A rule whose fixes all landed together is verified together.
             * Going through a dozen threads one at a time is the same
             * judgment repeated, and the repetition is what makes people
             * stop reading them - so the sweep is offered where the pile is,
             * and it is still a person pressing it.
             */
            ? `<button class="btn btn-xs btn-outline btn-success ml-auto" data-verify-all="${esc(r.rule)}"
                 title="Verify every addressed thread on this rule, under your name">
                 Verify all ${threads.filter((t) => t.status === 'addressed').length}</button>`
            : ''}
        </div>
        ${threads.map(threadCard).join('')}</div>` : ''}
      <!--
        A rule is a place to have a conversation, and until now it was only
        that DURING a walkdown - the feedback box belongs to the sitting, and
        outside one there was nowhere on a rule to say anything. So a note
        about a rule you were only reading had to be filed as a pin on a page,
        or not at all.

        Deliberately below the threads rather than above them: this is how you
        add to the conversation, and a composer that sits above what it
        answers reads as a headline. Same shape and same words as the thread
        composer, because it does the same thing.
      -->
      <div class="-mx-3.5 border-t border-base-300 px-3.5 pt-2" data-testid="detail.new-thread">
        <textarea id="wdp-rulenote" data-testid="detail.new-thread-box" rows="2"
          class="textarea textarea-xs w-full resize-none"
          placeholder="Start a conversation about this rule…">${esc(S.ruleNote)}</textarea>
        <div class="mt-1 flex items-center gap-2">
          <span class="text-[10px] opacity-40">as <button id="wdp-nactor" class="link">${
            esc(whoAmI() || 'set your name…')}</button></span>
          <button class="btn btn-xs btn-outline ml-auto" data-testid="detail.new-thread-post"
            data-note-rule="${esc(r.rule)}">Start thread</button>
        </div>
        <div class="mt-1 hidden text-[11px] text-warning" data-testid="detail.new-thread-say" id="wdp-nsay"></div>
      </div>
    </div>`;
}
