/*
 * The Rules tab: the rail of rules, the box that filters it, and the marks
 * that say where each rule stands.
 */
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
 * The three marks a BUILT rule wears: checks, agent, human, in that order,
 * always all three. A rule verified by one tier and a rule verified by all
 * three both used to read as a single ✓, which hid the thing worth seeing -
 * how much of the ledger is actually standing behind a green rule.
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
export const TIER_OWED = new Set(['never', 'stale', 'blocked']);

export function tierMarks(row, mine = false) {
  const tiers = [
    ['checks', checksTier(row)],
    ['agent', row.agent?.state ?? 'na'],
    ['human', row.human?.state ?? 'na'],
  ];
  return `<span class="flex w-8 shrink-0 items-center justify-center gap-px text-[10px] leading-none"
    data-testid="panel.rule-tiers" data-tiers="${esc(tiers.map((t) => t.join(':')).join(' '))}"
    >${tiers.map(([kind, state]) => {
      const [glyph, cls, why] = TIER_MARK[state] ?? TIER_MARK.na;
      return `<span class="inline-block w-3 text-center ${
        TIER_OWED.has(state) && !mine ? 'opacity-60' : cls}"
        title="${esc(kind)} — ${esc(why)}">${glyph}</span>`;
    }).join('')}</span>`;
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
