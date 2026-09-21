/*
 * The rule detail: the whole of one rule — its statement, its steps, what each
 * tier has recorded, the check's own source behind a disclosure, and the
 * conversations anchored to it.
 */
import { MSG } from '../../lib/message-stream.js';
import { html, live, nothing, unsafeHTML } from '../../vendor/lit.js';
import { answerOnRule, asksOn, laterOnRule, liveNoteOn, names, openQuestionOn, openThreadView, pendingReplies, sayFiling, sayOnRule, waiveOnRule } from './conversation.js';
import { tierMarks } from './rules-list.js';
import { requestReload, requestRender } from './shell.js';
import { openEvidence } from './evidence.js';
import { S } from './state.js';
import { api, fire } from './util.js';
import {
  conversationOf,
  currentScreen,
  declaredAnchors,
  isHeadless,
  LBL,
  needsYou,
  orderedRows,
  pageSurface,
  ruleScreen,
  screenById,
  screenUrl,
  shortName,
  threadsFor,
} from './vocab.js';

/*
 * Where this rule's check source lives.
 *
 * The ledger is asked first, because a recorded ref is the truth about what
 * a run actually went through. But a rule whose checks have never been run
 * still HAS check source, and a disclosure that stays empty until the first
 * recorded run is a disclosure nobody ever finds - which is exactly what was
 * reported (n-0084). So the suite's own scan is the fallback.
 */
/*
 * "This rule is on another screen." Lived in app.js while navigation wiring
 * did; the note is the detail pane's own sentence, and the trip it offers is
 * an event the shell answers.
 */
function elsewhere(r) {
  const here = currentScreen();
  const want = ruleScreen(r);
  // A headless rule must say so - otherwise whatever is on the desk reads
  // as the rule's screen, and it is not.
  if (!want && isHeadless(r))
    return html`<div class="mt-1.5 text-[11.5px] opacity-60">Headless — no screen belongs to
      this rule, so what is on the desk is beside the point. It is judged by its
      checks and recorded behavior, not by looking.</div>`;
  if (!want || !here || want.id === here.id) return nothing;
  const can = Boolean(
    screenUrl(want, pageSurface()) ?? screenUrl(want, 'app') ?? screenUrl(want, 'prototype'),
  );
  return html`<div class="mt-1.5 text-[11.5px] opacity-60">This rule is on
    <b>${want.id}</b>; you are on <b>${here.id}</b>.
    ${
      can
        ? html`<button class="link link-primary" data-goscreen="${want.id}"
            @click=${(e) => fire(e.currentTarget, 'go-screen', { screen: want.id })}>Go there</button>`
        : nothing
    }</div>`;
}

export const checkRefs = (row) => {
  const recorded = [
    ...new Set((S.data?.targets ?? []).flatMap((t) => row.cells?.[t]?.checks ?? [])),
  ];
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
  S.srcCache = { rule, view: null };
  let view;
  try {
    const res = await fetch(api(`/api/checks?rule=${encodeURIComponent(rule)}`));
    const out = await res.json();
    const checks = out.checks ?? [];
    /*
     * A drifted ref names its provenance: the server serves the source from
     * where the test sits NOW, and `recorded` is the stale address the last
     * run wrote before the file was edited above it. Shortened to ":NNN"
     * when the file is the same, which it nearly always is.
     */
    const wasAt = (c) =>
      c.recorded?.startsWith(c.ref.slice(0, c.ref.lastIndexOf(':') + 1))
        ? c.recorded.slice(c.recorded.lastIndexOf(':'))
        : c.recorded;
    view = checks.length
      ? checks.map((c) =>
          c.missing
            ? html`<div class="text-warning">${c.ref} — no longer in the tree</div>`
            : html`<div class="mb-1"><div class="font-mono text-[10.5px] opacity-60">${c.ref}${
                c.recorded
                  ? html` <span class="text-warning">· was ${wasAt(c)} when last recorded</span>`
                  : ''
              }</div>
          <pre class="overflow-x-auto whitespace-pre rounded bg-base-300/40 p-1.5 text-[10.5px] leading-snug">${c.source}</pre></div>`,
        )
      : 'No source recorded.';
  } catch {
    view = 'walkdown server unreachable.';
  }
  if (S.srcCache.rule !== rule) return;
  S.srcCache.view = view;
  requestRender();
}

/*
 * What the rule's standing rests on: the latest ledger result for each kind
 * of evidence it asks for, who or what produced it, and when. The chain of
 * trust belongs where the rule is judged - a verdict you cannot see the
 * basis of is a verdict you have to take on faith.
 */
export function evidenceRows(row) {
  const STATE = {
    pass: ['✓', 'text-success'],
    fail: ['✗', 'text-error'],
    stale: ['~', 'text-warning'],
    approved: ['✍︎', 'text-warning'],
    refining: ['✎︎', 'text-warning'],
    skipped: ['–', 'opacity-50'],
    blocked: ['⊘', 'text-warning'],
    never: ['○', 'opacity-50'],
    na: ['·', 'opacity-40'],
  };
  const line = (label, cell) => {
    const [glyph, cls] = STATE[cell?.state] ?? STATE.na;
    const who = cell?.actor ? ` · ${cell.actor}` : '';
    const when = cell?.created ? ` · ${MSG.ago(cell.created)}` : '';
    const said =
      cell?.state === 'never'
        ? 'never run'
        : cell?.state === 'na'
          ? 'not required'
          : `${cell.state}${who}${when}`;
    return html`<div class="evrow" title="${cell?.runId ?? ''}">
      <span class="src">${label}</span>
      <span class="${cls}">${glyph} ${said}</span></div>`;
  };
  /*
   * The files an agent's run attached. They are that run's evidence, not a
   * tier of their own, so they hang under the agent's row as a bullet rather
   * than standing beside it as a fourth kind of verdict (n-0100) - and they
   * are a link, because a count of files nobody can open is not evidence.
   *
   * "Screenshots" until n-0242: what a run attaches has not been only
   * pictures for a long time, and the word quietly told a reader that the
   * transcript sitting in the list did not belong there.
   */
  const attached = (cell) => {
    const files = cell?.evidence ?? [];
    if (!files.length) return '';
    return html`<div class="evrow evshot">
      <span class="src"></span>
      <span class="opacity-70">• Evidence —
        <button class="link link-hover text-primary" data-testid="detail.evidence-open"
          data-evidence="${JSON.stringify(files)}"
          title="Open the ${files.length} file${files.length > 1 ? 's' : ''} this run attached"
          @click=${() => openEvidence(files)}
          >open ${files.length}</button></span></div>`;
  };
  /*
   * A tier the rule declares it cannot honestly have, said in the row that
   * tier's evidence would have occupied. An excuse nobody can read is one
   * nobody can argue with, which is the whole reason it is written down
   * rather than left as an omission - so it is a line on the page, not a
   * tooltip and not a silence where a row used to be.
   */
  const excuse = (label, why) => html`<div class="evrow" data-testid="detail.excuse">
    <span class="src">${label}</span>
    <span class="opacity-70">— not checkable here: ${why}</span></div>`;
  const rows = [
    ...(row.verify.includes('checks')
      ? (S.data?.targets ?? []).map((t) => line(`checks/${t}`, row.cells?.[t]))
      : []),
    row.excuses?.checks ? excuse('checks', row.excuses.checks) : '',
    ...(row.verify.includes('agent') ? [line('agent', row.agent), attached(row.agent)] : []),
    row.excuses?.agent ? excuse('agent', row.excuses.agent) : '',
    ...(row.verify.includes('human') ? [line('human', row.human)] : []),
  ].filter(Boolean);
  // A rule with nothing recorded says so, rather than showing an empty box.
  return rows.length ? rows : html`<div class="text-[13px] opacity-50">Nothing recorded yet.</div>`;
}

function backToList() {
  S.view = 'list';
  requestRender();
}

/** Say the composer's text on the rule - into its conversation, or opening one - then refresh. */
async function replyOnRule(button, rule) {
  const text = (S.verdictNote ?? '').trim();
  if (!text) return sayFiling('Write something first \u2014 a reply is what you have to say.');
  button.disabled = true;
  const tid = await sayOnRule(rule, text);
  button.disabled = false;
  if (!tid) return; // the refusal is on screen
  S.verdictNote = '';
  S.composerSay = '';
  await requestReload(); // pull the reply into the stream and repaint
}

/*
 * How the turn line is drawn, by whose move it is - the thread screen's
 * palette, so a rule's line reads the same as a thread's: a person's move
 * is amber, the agent's blue and dashed, nothing owed is green.
 */
const TURN = {
  human: { line: 'border-warning', chip: 'bg-warning text-warning-content' },
  agent: { line: 'border-info', chip: 'bg-info text-info-content' },
  closed: { line: 'border-success', chip: 'bg-success text-success-content' },
};

/*
 * Whose move the RULE is, and what that party does next - read off the
 * attention items rather than re-derived, so the line under the rule agrees
 * with the badge on the tab and the list on the Threads tab by construction
 * (ADR 0006 §4). The rule is the unit: a claimed fix, an unanswered question
 * and an unjudged build are all "your move" here, and the sentence says
 * which.
 */
function ruleTurn(r) {
  const items = (S.data?.attention ?? []).filter((i) => i.rule === r.rule);
  const mine = items.filter((i) => i.who === 'human' && !i.thread);
  const live = threadsFor(r.rule).filter((t) => t.kind !== 'question').length;
  if (mine.length) {
    const asks = mine.find((i) => i.action === 'answer');
    const fixed = mine.find((i) => i.action === 'verify');
    const parts = [];
    if (asks) parts.push(`The rule asks ${asks.threads.length === 1 ? 'a question' : `${asks.threads.length} questions`} \u2014 anything you say below is the answer, and the agent folds it in.`);
    if (fixed) parts.push(`The agent says its fix is done.`);
    if (asks) return { party: 'human', label: 'Your move', text: parts.join(' ') };
    if (!S.session) parts.push(r.built ? 'Start a walkdown to judge the build.' : 'Start a walkdown to approve the wording, or send it back.');
    else if (r.built) parts.push(`Pass ends this conversation${live ? ` (${live} note${live === 1 ? '' : 's'})` : ''}; Fail continues it with your why.`);
    else parts.push('No build yet: Approve signs the wording; Refine sends it back with what should change.');
    return { party: 'human', label: 'Your move', text: parts.join(' ') };
  }
  const theirs = items.filter((i) => i.who === 'agent');
  if (theirs.length) {
    const what = {
      address: 'It has a note here to address.',
      settle: 'It settles an observation of its own here.',
      rejudge: 'It re-judges the claimed fix before you are asked to.',
      cover: 'It owes this rule a check.',
      incorporate: 'It folds your answer into the rule and closes the question.',
    };
    return { party: 'agent', label: "Agent's move", text: [...new Set(theirs.map((i) => what[i.action]).filter(Boolean))].join(' ') };
  }
  return { party: 'closed', label: 'Nothing owed', text: 'Nothing waits on anyone here. Replies still land; a fail reopens the conversation.' };
}

/*
 * The rule asking, one question at a time. The agent files each decision
 * it needs as its own question, with the ways out as options when it knows
 * them; this draws the head of that queue - the question's first line, its
 * context, the choices as something to pick - above its own answer box,
 * with a count and a dot per ask on the rule. Answer moves the pick and
 * the words onto the question and draws the next; Later sends this one to
 * the back; Waive is never mind. The stream below stays in the order
 * things were said, so a week of settled notes after the ask no longer
 * buries it (q-0277), and the rule no longer reads as asking three
 * questions when one was a person's own thoughts (q-0019, 2026-09-19).
 */
function askCard(r, asked, open) {
  const queue = asksOn(r.rule);
  // Done ones count for the dots, so "2 of 3" stays 3 as the asks go.
  const done = threadsFor(r.rule).filter((t) => t.kind === 'question' && t.status === 'answered').length;
  const total = queue.length + done;
  const at = done + 1;
  const first = { ...MSG.messages(asked)[0], options: undefined, thread: asked.id, tag: `${asked.id} \u00b7 question \u00b7 open` };
  const pick = (label) => {
    S.askChoice = S.askChoice === label ? null : label;
    requestRender();
  };
  return html`<div class="relative mt-3 mb-1.5 rounded border border-primary/60 bg-primary/5 px-2 pt-2.5 pb-2 text-[11px] leading-snug"
      data-testid="detail.ask" data-question="${asked.id}">
    <span class="absolute -top-[7px] left-2 rounded bg-primary px-1 text-[9px] font-bold uppercase leading-[14px] tracking-wider text-primary-content">The agent asks</span>
    <span class="absolute -top-[7px] right-2 flex items-center gap-1 rounded bg-base-100 px-1 text-[9px] leading-[14px] opacity-70" data-testid="detail.ask-count" title="${total} ask${total === 1 ? '' : 's'} on this rule">
      ${at} of ${total}
      ${Array.from({ length: total }, (_, i) => html`<i class="inline-block h-[6px] w-[6px] rounded-full ${i < done ? 'bg-success' : i === done ? 'bg-primary' : 'bg-base-300'}"></i>`)}
    </span>
    <div class="wd-stream max-h-56 overflow-y-auto" @click=${open}>${unsafeHTML(
      MSG.stream({ replies: [first] }, { rules: (S.data?.rows ?? []).map((x) => x.rule), names: names() }),
    )}</div>
    ${
      asked.options?.length
        ? html`<div class="mt-1.5 flex flex-col gap-1" data-testid="detail.ask-options">${asked.options.map(
            (o) => html`<button type="button" class="flex items-start gap-2 rounded border px-2 py-1 text-left ${S.askChoice === o.label ? 'border-primary bg-primary/15' : 'border-base-300 bg-base-100/60'}"
                data-option="${o.label}" aria-pressed="${S.askChoice === o.label}" @click=${() => pick(o.label)}>
                <span class="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-full border ${S.askChoice === o.label ? 'border-primary bg-primary' : 'border-base-content/50'}"></span>
                <span><b class="block text-[11.5px]">${o.label}</b>${o.why ? html`<span class="block opacity-70">${o.why}</span>` : nothing}</span>
              </button>`,
          )}</div>`
        : nothing
    }
    <textarea id="wdp-answer" data-testid="detail.answer" rows="2" class="textarea textarea-xs mt-1.5 w-full resize-none"
      placeholder="${asked.options?.length ? 'Anything to add, or a different answer\u2026' : 'Your answer\u2026'}"
      .value=${live(S.verdictNote)}
      @input=${(e) => {
        S.verdictNote = e.currentTarget.value;
      }}></textarea>
    <div class="mt-1 flex flex-wrap items-center gap-1" data-testid="detail.ask-actions">
      <button class="btn btn-xs btn-outline btn-warning" data-v="waived" title="Never mind: close this question with a reason"
        @click=${() => waiveOnRule(r.rule, (S.verdictNote ?? '').trim())}>Waive</button>
      ${
        queue.length > 1
          ? html`<button class="btn btn-xs btn-ghost" data-v="later" title="Put this one off: the next ask comes up, and this comes round again after it"
              @click=${() => laterOnRule(r.rule)}>Later</button>`
          : nothing
      }
      <button class="btn btn-xs btn-primary ml-auto" data-v="answer" data-question="${asked.id}"
        @click=${() => answerOnRule(r.rule, (S.verdictNote ?? '').trim(), S.askChoice)}>${queue.length > 1 ? 'Answer \u2192 next' : 'Answer'}</button>
    </div>
  </div>`;
}

/*
 * The rule's conversation: every thread ever filed on it, as ONE stream
 * (ADR 0006 §1). A rule used to draw its threads as cards and its verdict
 * box somewhere else, so the fail-why, the agent's fix and the pass that
 * accepted it were three places to read one exchange. Here each thread's
 * opening message carries a tag naming the thread and what it is; the tag
 * is the door to the thread's own screen, which is still where a pin's
 * sketch and a question's Answer live.
 */
function conversation(r, picked) {
  const known = (S.data?.rows ?? []).map((x) => x.rule);
  const all = conversationOf(r.rule);
  const messages = all
    .flatMap((t) =>
      MSG.messages(t).map((m, i) =>
        i ? m : { ...m, thread: t.id, tag: `${t.id} \u00b7 ${t.kind === 'question' ? 'question' : (t.reason ?? 'feedback')} \u00b7 ${t.status}` },
      ),
    )
    .sort((a, b) => String(a.created ?? '').localeCompare(String(b.created ?? '')));
  const note = liveNoteOn(r.rule);
  const asked = openQuestionOn(r.rule);
  // Answered and not yet folded in: the rule is the agent's, and a verdict
  // now would be on words about to move - so the pair waits with the rule
  // (status.attention.blocked-queues; Topher, 2026-09-18).
  const folding = threadsFor(r.rule).some((t) => t.kind === 'question' && t.status === 'answered');
  const turn = ruleTurn(r);
  const placeholder = asked
    ? 'Reply\u2026'
    : folding
    ? 'Reply\u2026'
    : S.session
    ? r.built
      ? 'Reply, or say why \u2014 for Fail or Waive\u2026'
      : 'Reply, or say what should change \u2014 for Refine or Waive\u2026'
    : note
      ? 'Reply\u2026'
      : 'Start a conversation about this rule\u2026';
  const open = (e) => {
    const tag = e.target?.closest?.('.wd-tag[data-thread]');
    if (tag) openThreadView(tag.dataset.thread);
  };
  return html`<div class="-mx-3.5 border-t border-base-300 px-3.5 pt-2" data-testid="detail.conversation">
    <div class="${LBL} mb-1">Conversation${all.length ? html` <span class="font-normal normal-case tracking-normal opacity-70">\u00b7 ${all.length} thread${all.length === 1 ? '' : 's'}</span>` : nothing}</div>
    ${
      messages.length
        ? html`<div class="wd-stream" data-testid="detail.stream" @click=${open}>${unsafeHTML(
            MSG.stream({ replies: messages }, { rules: known, pending: note ? (pendingReplies.get(note.id) ?? []) : [], names: names() }),
          )}</div>`
        : html`<p class="pb-1 text-[12.5px] opacity-50">Nothing said on this rule yet.</p>`
    }
    ${
      asked
        ? askCard(r, asked, open)
        : html`<div class="relative mt-3 mb-1.5 rounded border border-dashed px-2 pt-2.5 pb-1.5 text-[11px] leading-snug ${TURN[turn.party].line}"
      data-testid="detail.turn" data-party="${turn.party}">
      <span class="absolute -top-[7px] left-2 rounded px-1 text-[9px] font-bold uppercase leading-[14px] tracking-wider ${TURN[turn.party].chip}">${turn.label}</span>
      <span class="opacity-75">${turn.text}</span>
    </div>`
    }
    <!-- One box for everything said on the rule: a reply, a fail's why, a
         waive's reason. It rides ABOVE the buttons, so the why is typed
         where the verdict is pressed (Topher, 2026-09-18). -->
    <textarea id="wdp-vnote" data-testid="detail.feedback" rows="2" class="textarea textarea-xs w-full resize-none"
      placeholder="${placeholder}"
      .value=${live(S.verdictNote)}
      @input=${(e) => {
        S.verdictNote = e.currentTarget.value;
      }}></textarea>
    <!-- Waive alone at the far left, the reach-for buttons on the right,
         the verdict last: the thread screen's row, on the rule. No "as
         <name>" beside them: who is recorded is chosen once, when a
         walkdown starts and each role is signed for, and never re-offered
         at the moment of an action (Topher, 2026-09-18). -->
    <div class="mt-1 flex flex-wrap items-center justify-end gap-1" data-testid="detail.verdict">
      ${
        // While the rule asks, Waive lives on the ask card with the answer;
        // here the row is Reply alone, because a reply is the only thing
        // this box does until the asks are answered.
        note && !asked
          ? html`<button class="btn btn-xs btn-outline btn-warning mr-auto" data-v="waived" title="Never mind: close the rule\u2019s conversation with a reason"
            @click=${() => waiveOnRule(r.rule, (S.verdictNote ?? '').trim())}>Waive</button>`
          : nothing
      }
      <button class="btn btn-xs btn-outline border-base-300 text-base-content/70" data-v="reply" data-note-rule="${r.rule}"
        @click=${(e) => replyOnRule(e.currentTarget, r.rule)}>Reply</button>
      ${
        !S.session || asked || folding
          ? nothing
          : r.built
            ? html`<button class="btn btn-xs ${picked === 'fail' ? 'btn-error' : 'btn-outline btn-error'}" data-v="fail" @click=${(e) => fire(e.currentTarget, 'verdict', { status: 'fail' })}>\u2717 Fail</button>
        <button class="btn btn-xs ${picked === 'pass' ? 'btn-success' : 'btn-outline btn-success'}" data-v="pass" @click=${(e) => fire(e.currentTarget, 'verdict', { status: 'pass' })}>\u2713 Pass</button>`
            : html`<button class="btn btn-xs ${picked === 'refining' ? 'btn-warning' : 'btn-outline btn-warning'}" data-v="refining" @click=${(e) => fire(e.currentTarget, 'verdict', { status: 'refining' })}>\u270e\ufe0e Refine</button>
        <button class="btn btn-xs ${picked === 'approved' ? 'btn-success' : 'btn-outline btn-success'}" data-v="approved" @click=${(e) => fire(e.currentTarget, 'verdict', { status: 'approved' })}>\u270d\ufe0e Approve</button>`
      }
    </div>
    ${
      S.verdictSay || S.composerSay
        ? html`<div data-testid="detail.say" class="mt-1 text-[11px] text-warning">${S.verdictSay || S.composerSay}</div>`
        : nothing
    }
  </div>`;
}

export function detailPane() {
  const r = S.selected;
  // A pin with no rule has no rule screen: it opens on the thread screen
  // itself, and this slot is only what slides past on the way there.
  if (!r)
    return html`
    <div class="flex items-center px-2 pt-2">
      <button class="wdp-back btn btn-ghost btn-xs text-primary" data-testid="detail.back" @click=${backToList}>← All rules</button>
    </div>
    <div class="px-3.5 pt-1 text-[12.5px] opacity-60">This thread is not attached to a rule.</div>`;
  /*
   * The rule's own words - statement, because, history, and the steps - are
   * markdown, read through the same renderer a thread body is (n-0288): a
   * backticked path is code, a list is a list, and both sides of the panel
   * spell an anchor the same way (Topher, 2026-09-13). Most fields are one
   * paragraph and sit inline beside a label, so a lone <p> is unwrapped.
   *
   * A step writes the things it is about in backticks - anchors and screen
   * ids, the same tokens lint scans for. An anchor among them is a pointer:
   * hovering it lights the element up on the surface under review, so
   * reading a step and finding what it means are one act rather than a hunt
   * (n-0087). Only DECLARED anchors get the treatment; anything else in
   * backticks is a screen id or prose and stays plain type. The hover is
   * delegated from the field, since the code spans are rendered as HTML
   * rather than as templates.
   */
  const anchors = declaredAnchors();
  const known = (S.data?.rows ?? []).map((x) => x.rule);
  const prose = (text) => {
    const tpl = document.createElement('template');
    tpl.innerHTML = MSG.body(text, { rules: known });
    for (const c of tpl.content.querySelectorAll('code')) {
      const tok = c.textContent;
      if (!anchors.has(tok) || c.closest('pre')) continue;
      c.classList.add('wdp-anchor', 'cursor-help', 'underline', 'decoration-dotted', 'underline-offset-2');
      c.dataset.anchor = tok;
      c.title = 'Show this on the surface';
    }
    const kids = tpl.content.children;
    return unsafeHTML(kids.length === 1 && kids[0].tagName === 'P' ? kids[0].innerHTML : tpl.innerHTML);
  };
  const anchorOf = (e) => e.target?.closest?.('code[data-anchor]');
  const hoverIn = (e) => {
    const c = anchorOf(e);
    if (c) fire(c, 'highlight', { anchor: c.dataset.anchor });
  };
  const hoverOut = (e) => {
    if (anchorOf(e)) fire(e.currentTarget, 'highlight', { anchor: null });
  };
  // The inherit variant keeps the field's own size; .wd-text alone is a chat line.
  const TEXT = 'wd-text wd-inherit';
  /*
   * Given and when are the situation and the act - read as prose beside
   * their label. Then is the list of things to look for: one bullet per
   * clause (a run-on paragraph hid where one ended, n-0235), dropped BELOW
   * its label rather than beside it, because the clauses are the long part
   * and a narrow column beside a label wraps every one of them (Topher,
   * 2026-09-13).
   */
  const steps = r.steps
    ? Object.entries(r.steps).map(([ph, items]) =>
        ph === 'then'
          ? html`<div class="col-span-2 pt-1"><div class="${LBL}">${ph}</div>
              <ul class="${TEXT} list-disc pl-4 pt-0.5" data-testid="detail.then" @mouseover=${hoverIn} @mouseenter=${hoverIn} @mouseout=${hoverOut}>${items.map(
                (s) => html`<li>${prose(s)}</li>`,
              )}</ul></div>`
          : html`<span class="${LBL} pt-1">${ph}</span><div class="${TEXT}" data-testid="detail.${ph}" @mouseover=${hoverIn} @mouseenter=${hoverIn} @mouseout=${hoverOut}>${items.map(
              (s, i) => html`${i ? html`<br />` : nothing}${prose(s)}`,
            )}</div>`,
      )
    : null;
  const picked = S.session?.verdicts[r.rule];
  // Step through the rules in the order the list shows them, without going
  // back to it. The back link keeps its word ("All rules") so the bare
  // arrows beside it read as the stepper rather than as a second way out.
  /*
   * The list groups by screen now, so blueprint order and rail order are two
   * different sequences. The stepper follows the RAIL - it exists to move
   * through the rules the way they are shown, and arrows that jumped to
   * whatever came next in a file would land somewhere the reviewer was not
   * looking.
   */
  const walk = orderedRows();
  const at = walk.findIndex((x) => x.rule === r.rule);
  const step = (row, cls, glyph, label) =>
    html`<div class="tooltip tooltip-left" data-tip="${row ? `${label} rule: ${shortName(row)}` : `No ${label.toLowerCase()} rule`}">
      <button class="${cls} btn btn-ghost btn-xs" data-testid="detail.stepper" data-goto="${row ? row.rule : nothing}" ?disabled=${!row}
        @click=${row ? (e) => fire(e.currentTarget, 'open-rule', { rule: row.rule }) : nothing}>${glyph}</button>
    </div>`;
  /*
   * A screen can be a STATE rather than an address - a filtered list, an open
   * drawer, the second time you submit the same form - and a state shares its
   * URL with the page it is a state of. Walking to a rule about one navigates
   * to that shared address and lands you on the page, not in the state, so
   * the storyboard's setup is the rest of the sentence: it says what to do on
   * arrival. Above the steps, because it happens before them.
   */
  const setup = ruleScreen(r)?.app?.setup;
  /*
   * Which screen this rule is about, said plainly and above the steps.
   *
   * It was only ever implicit before - the surface moved when you opened the
   * rule, and if it moved somewhere wrong the rule looked wrong instead. A
   * rule pointed at the wrong screen is a common and quiet error in a
   * blueprint this size, and it cannot be corrected by somebody who cannot
   * see what was chosen.
   *
   * A flow is drawn as the chain it is, because the LAST screen of a flow is
   * the one the rule is judged on (ruleScreen) and a chain that did not show
   * its end would answer a different question.
   */
  const ids = r.flow?.length ? r.flow : (r.screens ?? []);
  const sep = r.flow?.length ? ' → ' : ', ';
  /*
   * A screen the storyboard does not carry says so IN WORDS, and wears the
   * error colour rather than the warning one (n-0123). It used to be the
   * bare id in warning yellow and nothing else - which a reader who did not
   * know the convention read as a screen that exists, and which borrowed the
   * panel's "waiting on you" colour to say something untrue about who was
   * blocked. Marked by colour is not marked as unknown.
   */
  const name = (id) => {
    const sc = screenById(id);
    if (!sc)
      return html`<span class="text-error">${id}</span>
            <span class="text-[11.5px] opacity-60">— not in the storyboard</span>`;
    return html`<span>${sc.title ?? id}</span>${
      sc.title
        ? html` <code class="rounded bg-base-200 px-1 text-[11px] opacity-70">${id}</code>`
        : nothing
    }`;
  };
  return html`
    <div class="flex items-center px-2 pt-2">
      <button class="wdp-back btn btn-ghost btn-xs text-primary" data-testid="detail.back" @click=${backToList}>← All rules</button>
      <div class="ml-auto flex gap-0.5">
        ${step(at > 0 ? walk[at - 1] : null, 'wdp-prev', '←', 'Previous')}
        ${step(at >= 0 && at < walk.length - 1 ? walk[at + 1] : null, 'wdp-next', '→', 'Next')}
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
          <div class="break-all font-mono text-[11px] opacity-40" data-testid="detail.rule-id">${r.rule}</div>
        </div>
        <p class="${TEXT} text-[15px] leading-relaxed" data-testid="detail.statement" @mouseover=${hoverIn} @mouseenter=${hoverIn} @mouseout=${hoverOut}>${prose(r.statement)}</p>
        <!-- The reason and the story behind it, under the claim and quieter
             than it: read when you want to argue with the rule, skipped when
             you want to judge it. Neither is hashed, so neither is the rule. -->
        ${
          r.because
            ? html`<p class="${TEXT} pt-1.5 text-[13px] leading-relaxed opacity-70" data-testid="detail.because" @mouseover=${hoverIn} @mouseenter=${hoverIn} @mouseout=${hoverOut}><span class="${LBL}">because</span> ${prose(r.because)}</p>`
            : nothing
        }
        ${
          r.history
            ? html`<p class="${TEXT} pt-1 text-[12.5px] leading-relaxed opacity-55" data-testid="detail.history" @mouseover=${hoverIn} @mouseenter=${hoverIn} @mouseout=${hoverOut}><span class="${LBL}">history</span> ${prose(r.history)}</p>`
            : nothing
        }
        ${elsewhere(r)}
      </div>
      ${
        setup
          ? html`<div>
          <!-- "Setup" is the storyboard's own word for this field, and the
               panel calling it something else made a reviewer translate
               between the two (n-0099). -->
          <div class="${LBL} mb-1.5">Setup</div>
          <div class="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[13px] leading-relaxed"
            data-testid="detail.setup">${setup}</div>
        </div>`
          : nothing
      }
      <div>
        <div class="${LBL} mb-1.5">Screen</div>
        <div class="text-[13px] leading-relaxed" data-testid="detail.screen">${
          ids.length
            ? ids.map((id, i) => html`${i ? sep : nothing}${name(id)}`)
            : html`<span class="opacity-50">${
                isHeadless(r) ? 'No screen — this rule is judged without one.' : 'No screen named.'
              }</span>`
        }</div>
      </div>
      ${
        steps
          ? html`<div><div class="${LBL} mb-1.5">Steps</div>
        <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[13px] leading-relaxed"
          data-testid="detail.steps">${steps}</div></div>`
          : nothing
      }
      ${
        /*
         * The check source, which hangs off the rule's CHECK REFS and not off
         * its steps.
         *
         * It used to be drawn inside the Steps block, so a rule with no steps
         * had no disclosure at all - and the rules with no steps were exactly
         * the ones whose check IS the specification: screenless derivation
         * law, judged by reading a test rather than by looking at a screen.
         * The panel said "checks passed" and offered the one thing that says
         * what passed nowhere at all (n-0245). Steps are now required of every
         * rule, so this can no longer bite the same way, but the nesting was
         * wrong on its own terms: these are two different things about a rule.
         */
        checkRefs(r).length
          ? html`<!-- The steps are the rule; the source that checks them is a
             technical detail, so it waits behind a disclosure until asked for. -->
        <details class="rounded border border-base-300 bg-base-200/60 px-2 py-1 text-[11.5px]"
          data-testid="detail.technical-disclosure" data-checks="${r.rule}" ?open=${S.srcOpenFor === r.rule}
          @toggle=${(e) => {
            // A pane rebuilt with the disclosure already open fires this
            // too; only a real change is one.
            const el = e.currentTarget;
            if (el.open === (S.srcOpenFor === r.rule)) return;
            S.srcOpenFor = el.open ? r.rule : null;
            if (el.open) loadCheckSource(r.rule);
          }}>
          <summary class="cursor-pointer opacity-60">Check source · ${checkRefs(r).join(', ')}</summary>
          <div class="wdp-check-src mt-1 opacity-70">${
            S.srcCache.rule === r.rule && S.srcCache.view ? S.srcCache.view : 'Loading…'
          }</div>
        </details>`
          : nothing
      }
      <div>
        <div class="${LBL} mb-1.5">Evidence</div>
        <div data-testid="detail.evidence">${evidenceRows(r)}</div>
      </div>
      <div>
        <div class="${LBL} mb-1.5">Verify</div>
        <div class="text-[13px]" data-testid="detail.verify">${r.verify.join(', ')}</div>
      </div>
      ${conversation(r, picked)}
    </div>`;
}
