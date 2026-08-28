/*
 * The Rules tab: the rail of rules, the box that filters it, and the marks
 * that say where each rule stands.
 */
import { MSG } from '../../lib/message-stream.js';
import { open, render } from './app.js';
import { icon } from './icons.js';
import { D, S } from './state.js';
import { esc } from './util.js';
import { LBL, needsYou, shortName, threadsFor } from './vocab.js';

/**
 * The list glyph: SHAPE carries the lifecycle, COLOR carries ownership.
 * □ designed · ✍︎ approved, awaiting build · ✎︎ refining · ○ built,
 * awaiting verification · ✓ verified · ✗ failing. Warning tint plus the
 * right-edge badge mean the rule waits on you, and the badge names the
 * work: sign for a sign-off, walk for a walkdown. The pencils carry
 * U+FE0E - as emoji they take their own colors and the ownership channel
 * goes silent.
 */
export function ruleState(row, mine) {
  if (row.verdict === 'pass') return { glyph: '✓', cls: 'text-success', why: 'verified' };
  if (row.verdict === 'fail') return { glyph: '✗', cls: 'text-error', why: 'failing — the build was rejected' };
  const tint = mine ? 'text-warning' : 'opacity-30';
  if (!row.built) {
    if (row.signoff === 'refining')
      return { glyph: '✎︎', cls: 'text-warning', why: 'refining — sent back for spec rework' };
    if (row.signoff === 'approved')
      return { glyph: '✍︎', cls: 'opacity-60', why: 'approved — spec signed off, awaiting build' };
    return { glyph: '□', cls: tint, why: `designed — awaiting ${mine ? 'your ' : ''}sign-off` };
  }
  return { glyph: '○', cls: tint, why: mine ? 'built — awaiting your walkdown' : 'built — awaiting verification' };
}

/*
 * The search box over the rule list.
 *
 * It is drawn OUTSIDE the scrolling wrapper, as a sibling above it, which is
 * the whole of the trick. `position: sticky` is the reflex here and it is
 * the wrong tool: the pane itself is what scrolls, so a sticky child sticks
 * to a scrollport that is moving with it, and the box either rides away or
 * needs a second scroller underneath it to have something to stick to. A
 * column with a fixed head and a growing body says the same thing with no
 * stacking, no offsets, and nothing to go wrong when the list is short.
 */
export function searchBox() {
  return `<div class="shrink-0 border-b border-base-300 px-3.5 py-2">
    <input id="wdp-search" type="search" data-testid="panel.rules-search"
      class="input input-xs w-full" spellcheck="false" autocomplete="off"
      aria-label="Search rules" placeholder="Search rules…" value="${esc(S.ruleQuery)}">
  </div>`;
}

/*
 * Which rules a query leaves standing.
 *
 * Matching is over three fields, and the choice is deliberate: the group
 * heading (the story id, which carries its feature as its first segment), the
 * rule id, and the rule's statement. So "panel" reaches every rule in the
 * panel feature because every story under it is named for it; "panel.rules"
 * reaches that story alone; and words nobody put in an id - "scroll",
 * "ghost" - still find the rule, because the statement is the part of a rule
 * written for people to read.
 *
 * A heading matching takes its whole group with it. A rule matching brings
 * only itself, but its heading is drawn anyway by the grouping below, because
 * a filtered list that loses the hierarchy stops saying where anything lives.
 */
export const matchesQuery = (s, q) => String(s ?? '').toLowerCase().includes(q);
export function matchingRows() {
  const q = S.ruleQuery.trim().toLowerCase();
  if (!q) return S.data.rows;
  const groups = new Set(
    S.data.rows.map((r) => r.story).filter((story) => matchesQuery(story, q))
  );
  return S.data.rows.filter((row) =>
    groups.has(row.story) || matchesQuery(row.rule, q) || matchesQuery(row.statement, q));
}

/*
 * The marks a BUILT rule wears: checks, then agent, then who has accepted it.
 * A rule verified by one tier and a rule verified by all of them both used to
 * read as a single ✓, which hid the thing worth seeing - how much of the
 * ledger is actually standing behind a green rule.
 *
 * The first two are machine results and stay glyphs. The third used to be a
 * glyph too - the human TIER - and is now a stack of dots, one per role,
 * because acceptance is a set of PEOPLE and "somebody signed" was never the
 * question. See signoffStack below.
 *
 * Every built rule, not only the verified ones. A rule reaches 'verified'
 * only when every tier it asks for holds a current pass, so on a verified
 * rule these marks can be nothing but green or grey - the red, the open
 * circle and the tilde were unreachable, and they are the ones that answer
 * the question the row is here to answer: which tiers is this rule missing.
 * A rule that is not built at all has no tiers to report and keeps its
 * lifecycle shape.
 *
 * Same vocabulary as the detail pane's evidence rows, so the panel says one
 * thing in one language: shape carries what happened, colour carries whether
 * it is owed. Grey · is "this rule never asked for that tier". The two
 * in-between states keep their own shapes rather than borrowing either end -
 * ○ for a tier that is required and has never run, ~ for a pass whose
 * statement has since moved - both in warning yellow when the rule is
 * waiting on YOU, quiet otherwise. Colour carries ownership here exactly as
 * it does for the single lifecycle glyph (panel.rules.lifecycle-legible),
 * and the shape carries what happened either way, so a tier nobody has run
 * is never read as one the rule never asked for.
 */
export const TIER_MARK = {
  pass: ['✓', 'text-success', 'passed'],
  fail: ['✗', 'text-error', 'failed'],
  stale: ['~', 'text-warning', 'stale — it passed, then the statement moved'],
  never: ['○', 'text-warning', 'required, but no run has touched it'],
  skipped: ['–', 'opacity-40', 'skipped'],
  blocked: ['⊘', 'text-warning', 'blocked'],
  /*
   * Sign-off is not a verdict. A human can approve the wording of a rule, or
   * send it back for refining, without ever walking the built thing - and when
   * that is the latest human run, the human TIER still owes a verdict. Both
   * states were missing here, so they fell through to `na` and a rule somebody
   * had signed drew as one nobody had to: the mark said "this rule does not
   * ask for a human" about a rule a human had just put their name to.
   *
   * One glyph for the pair on purpose. The distinction between approved and
   * refining is about the wording and belongs in the detail; what the rail
   * needs to say is that the human tier is still owed. Which glyph it should
   * be is a design question - n-0118 asks it.
   */
  approved: ['✎︎', 'text-warning', 'the wording is signed off — no walkdown verdict yet'],
  refining: ['✎︎', 'text-warning', 'sent back for refining — no walkdown verdict yet'],
  /*
   * A tier the rule never asked for is a hollowed-out version of the same
   * check, not a different glyph. Three marks of three different widths do
   * not line up down a list of ninety rules, and a row you cannot scan in a
   * column is not a row you can scan at all (n-0109).
   */
  na: ['✓', 'opacity-20', 'not applicable — this rule does not ask for it'],
};

/*
 * The checks tier is per target, and the marks are per rule, so the targets
 * have to come down to one state. Worst-news-first, the way the verdict
 * itself aggregates: a rule that fails anywhere has not passed.
 */
export function checksTier(row) {
  const states = (S.data?.targets ?? Object.keys(row.cells ?? {}))
    .map((t) => row.cells?.[t]?.state)
    .filter((state) => state && state !== 'na');
  if (!states.length) return 'na';
  for (const worse of ['fail', 'blocked', 'never', 'stale', 'skipped'])
    if (states.includes(worse)) return worse;
  return states.every((state) => state === 'pass') ? 'pass' : 'never';
}

/** Tier states that are work somebody still owes, rather than settled news. */
export const TIER_OWED = new Set(['never', 'stale', 'blocked', 'approved', 'refining']);

/*
 * A stale mark has two causes now, and saying the wrong one is worse than
 * saying nothing: a verdict goes stale when the rule's wording moves under it,
 * and it goes stale when a sweep asks for the whole tier to be earned again.
 * The cell says which - a swept cell carries the marker's id - so the mark can
 * name the reason instead of guessing at the commoner one.
 */
const whyStale = (cell) =>
  cell?.sweptBy
    ? `stale — a sweep asked for this tier again (${cell.sweptBy})`
    : TIER_MARK.stale[2];

/*
 * Who has to accept a rule, and where each of them sits.
 *
 * A fixed slot per role, top to bottom, so the stack reads by POSITION and
 * colour is only a confirmation: product on top because it is the more final
 * signature, eng at the bottom because it is the one everything else stands
 * on, and any other role a team names in between - which is also the order
 * signoffList declares them in, eng last. Sorting is stable, so two middle
 * roles keep the order the rule wrote them in.
 *
 * The tints are a map keyed by role rather than a branch, because custom
 * roles are coming and a team adding "design" should be a line of data. A
 * role nobody has tinted draws in the panel's own ink instead of failing.
 */
export const ROLE_TINT = { eng: 'text-blue-400', product: 'text-purple-400' };
const ROLE_RANK = { product: 0, eng: 2 };
export const stackOrder = (acceptance) =>
  [...(acceptance ?? [])].sort((a, b) => (ROLE_RANK[a.role] ?? 1) - (ROLE_RANK[b.role] ?? 1));

/*
 * What each acceptance state says, in the tooltip's words. `signed` is the
 * built thing; `approved` is the wording only, which is a real answer to a
 * question nobody has built yet and not a half-hearted signature.
 */
export const SIGN_SAY = {
  signed: 'signed the build',
  approved: 'approved the wording, not the build',
  'sent-back': 'sent it back — not yet',
  stale: 'signed an older wording',
  none: 'has not signed',
};

/*
 * One role's slot. Every shape is legible at 5px, which rules out most of
 * the obvious ideas - a dashed ring is mush at this size and a faded disc is
 * hard to tell from a ring - so the four states differ by FILL and SIZE:
 *
 *   signed    a solid disc: their name is on the built thing
 *   approved  half a disc, filled from the bottom: half a signature, because
 *             approving the wording is not accepting the build
 *   stale     a small solid disc: the signature is still there but no longer
 *             covers what the rule now says, so it has shrunk back to a point
 *   none      an outline ring: the slot is there and empty
 *   sent-back a red ✗, not a dot - somebody looked and disagreed, which is
 *             the one thing on this strip that is not an absence
 *
 * The half fill is an inline gradient rather than a class: it is one
 * declaration used in one place, and a two-tone 5px box is not something the
 * utility vocabulary has a name for.
 */
function signoffDot(a, mine) {
  const tint = ROLE_TINT[a.role] ?? 'text-base-content';
  if (a.state === 'sent-back')
    return `<span class="text-[8px] leading-none text-error">✗</span>`;
  const shape = {
    signed: 'size-[5px] bg-current',
    approved: 'size-[5px] border border-current',
    stale: 'size-[3px] bg-current',
  }[a.state] ?? 'size-[5px] border border-current';
  const half = a.state === 'approved'
    ? ' style="background:linear-gradient(to top, currentColor 50%, transparent 50%)"'
    : '';
  // Owed slots dim when the rule is not waiting on you, exactly as the tier
  // glyphs beside them do — the strip has one language for "your turn".
  const dim = a.state !== 'signed' && !mine ? ' opacity-60' : '';
  return `<span class="block rounded-full ${shape} ${tint}${dim}"${half}></span>`;
}

/*
 * Three slots is what fits beside a 12px glyph. A rule naming more roles than
 * that keeps the two that carry the most - product on top, eng at the bottom -
 * and collapses everything between them into a +N, which the tooltip then
 * spells out in full. Dropping from the middle rather than the end keeps the
 * two fixed slots fixed, which is the whole reason the stack reads.
 */
const MAX_SLOTS = 3;
function signoffStack(acceptance, mine) {
  const all = stackOrder(acceptance);
  if (!all.length) return '';
  const slots = all.length > MAX_SLOTS
    ? [all[0], { role: '+', state: 'more', n: all.length - 2 }, all.at(-1)]
    : all;
  return `<span class="flex w-3 shrink-0 flex-col items-center justify-center"
    data-testid="panel.rule-signoff" data-signoff="${esc(all.map((a) => `${a.role}:${a.state}`).join(' '))}"
    >${slots.map((a) => `<span class="flex h-[7px] items-center justify-center">${
      a.state === 'more'
        ? `<span class="text-[7px] leading-none opacity-60">+${a.n}</span>`
        : signoffDot(a, mine)}</span>`).join('')}</span>`;
}

/*
 * ONE tooltip for the whole strip, not one per mark.
 *
 * Six little native tooltips said six unrelated things and never the sentence
 * a reader actually wants — where does this rule stand. So the strip is the
 * hover target and the bubble answers for every tier and every role at once,
 * naming the signer where the ledger knows it.
 *
 * daisyUI rather than a title attribute, for the reason the footer counts use
 * one (n-0091): a native tooltip cannot hold four lines of explanation, and
 * the panel already says these words this way. It opens to the RIGHT because
 * the strip sits on the left edge of a pane as wide as the whole panel -
 * there is 340px of room that way and 14px the other, and a bubble opening up
 * or down would be centred on that same 14px. Kept to short lines anyway:
 * this one is read at a glance, on the way past.
 */
function stripTip(tiers, acceptance) {
  const cells = tiers.map(([kind, state, cell]) =>
    [kind, state === 'stale' ? whyStale(cell) : (TIER_MARK[state] ?? TIER_MARK.na)[2]]);
  const signs = stackOrder(acceptance).map((a) => [
    a.role,
    `${SIGN_SAY[a.state] ?? a.state}${a.actor ? ` · ${a.actor}` : ''}${
      a.created ? ` · ${MSG.ago(a.created)}` : ''}`,
  ]);
  const line = ([label, said]) =>
    `<span class="opacity-60">${esc(label)}</span><span>${esc(said)}</span>`;
  return `<span class="tooltip-content w-60 whitespace-normal text-left text-[11px] leading-snug"
    data-testid="panel.rule-tiers-tip"><span class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">${
      cells.map(line).join('')}${signs.length
        ? `<span class="col-span-2 mt-0.5 opacity-40">accepted by</span>${signs.map(line).join('')}`
        : ''}</span></span>`;
}

export function tierMarks(row, mine = false) {
  const tiers = [
    ['checks', checksTier(row), null],
    ['agent', row.agent?.state ?? 'na', row.agent],
  ];
  // title="" is not a leftover: the row around this is a button carrying its
  // own native title, and a native tooltip is inherited from the nearest
  // ancestor that has one. An empty title stops that here, so hovering the
  // strip opens the strip's bubble and nothing else.
  return `<span class="tooltip tooltip-right flex w-8 shrink-0 items-center justify-center gap-px text-[10px] leading-none"
    title="" data-testid="panel.rule-tiers" data-tiers="${esc(tiers.map((t) => `${t[0]}:${t[1]}`).join(' '))}"
    >${stripTip(tiers, row.acceptance)}${tiers.map(([, state, cell]) => {
      const [glyph, cls] = TIER_MARK[state] ?? TIER_MARK.na;
      return `<span class="inline-block w-3 text-center ${
        TIER_OWED.has(state) && !mine ? 'opacity-60' : cls}">${glyph}</span>`;
    }).join('')}${signoffStack(row.acceptance, mine)}</span>`;
}

export function listPane() {
  if (!S.data.rows.length)
    return '<p class="p-3.5 text-[12.5px] opacity-40">No rules in this blueprint.</p>';
  const rows = matchingRows();
  if (!rows.length)
    return `<p class="p-3.5 text-[12.5px] opacity-40" data-testid="panel.rules-empty">No rule matches ${
      esc(S.ruleQuery.trim())}.</p>`;
  let html = '';
  let story = null;
  for (const row of rows) {
    if (row.story !== story) {
      story = row.story;
      html += `<div class="px-3.5 pb-1 pt-2.5 ${LBL}">${esc(story)}</div>`;
    }
    const mine = needsYou(row.rule);
    const picked = S.session?.verdicts[row.rule];
    const state = picked
      ? { glyph: { pass: '✓', fail: '✗', approved: '✍︎', refining: '✎︎' }[picked],
          cls: { pass: 'text-success', fail: 'text-error', approved: 'text-success', refining: 'text-warning' }[picked],
          why: 'judged this session' }
      : ruleState(row, mine);
    const owes = mine && !picked ? (row.built ? 'walk' : 'sign') : '';
    const short = shortName(row);
    const thr = threadsFor(row.rule).length;
    html += `<button class="flex w-full cursor-pointer items-center gap-2 px-3.5 py-1.5 text-left text-[13px] hover:bg-base-200"
      data-rule="${esc(row.rule)}" title="${esc(row.rule)} — ${esc(state.why)}">
      ${!picked && row.built ? tierMarks(row, mine)
        : `<span class="w-8 shrink-0 text-center ${state.cls}">${state.glyph}</span>`}
      <span class="truncate">${esc(short)}</span>
      ${owes || thr ? `<span class="ml-auto shrink-0 text-[10.5px] font-semibold text-warning">${
        owes}${thr ? ` ${thr}⚑` : ''}</span>` : ''}
    </button>`;
  }
  return html;
}

/** Opening a rule is a click on its row, wherever the row was just drawn. */
export function wireRuleRows() {
  D.host.querySelectorAll('[data-rule]').forEach((el) => {
    el.onclick = () => open(el.dataset.rule);
  });
}

/*
 * Filtering repaints the LIST and nothing else. A full render() would work -
 * the caret is put back either way - but the filter has to feel like the
 * letters are doing the work, and rebuilding the bar, the tabs and two other
 * panes on every keystroke is a lot of work to do behind a caret. Repainting
 * one element never touches the input, so there is no caret to restore and
 * no chance of restoring it a frame late.
 */
export function paintRules() {
  const list = D.host.querySelector('.wdp-list');
  if (!list) return;
  list.innerHTML = listPane();
  list.scrollTop = 0;   // a filtered list is a new list; showing its middle is not helpful
  wireRuleRows();
}

export function wireSearch() {
  const box = D.host.querySelector('#wdp-search');
  if (!box) return;
  box.oninput = () => { S.ruleQuery = box.value; paintRules(); };
  box.onkeydown = (e) => {
    // Escape clears the box rather than reaching the page behind it, where it
    // would end pin mode and leave the list still filtered.
    if (e.key !== 'Escape' || !S.ruleQuery) return;
    e.stopPropagation();
    S.ruleQuery = '';
    box.value = '';
    paintRules();
  };
}
