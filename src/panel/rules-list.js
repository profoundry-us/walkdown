/*
 * The Rules tab: the rail of rules, the box that filters it, and the marks
 * that say where each rule stands.
 */
import { MSG } from '../../lib/message-stream.js';
import { open, render } from './app.js';
import { icon } from './icons.js';
import { D, S } from './state.js';
import { esc } from './util.js';
import {
  LBL,
  groupedRows,
  needsYou,
  screenById,
  screenIdOf,
  shortName,
  storyLabels,
  threadsFor,
} from './vocab.js';

/**
 * Where a rule stands, in a sentence, for the row's own title.
 *
 * This used to also pick a GLYPH - □ designed, ✍︎ approved, ✎︎ refining, ○
 * built-unverified - drawn alone in the space a built rule fills with three
 * marks. That second display mode was the whole trouble: a lone yellow □ in a
 * column of ✓✓● read as an alarm about a rule whose only sin was not being
 * built yet, and the two pencils were indistinguishable at 12px anyway.
 *
 * There is one language now (see tierMarks). Lifecycle is not a mark of its
 * own; it is what the strip already says - nothing filled is designed, half a
 * dot is approved, owed glyphs are built-but-unwalked, all filled is verified.
 * So this returns only the words, and the shapes are somebody else's job.
 */
export function ruleWhy(row, mine) {
  if (row.verdict === 'pass') return 'verified';
  if (row.verdict === 'fail') return 'failing — the build was rejected';
  if (!row.built) {
    if (row.signoff === 'refining') return 'refining — sent back for spec rework';
    if (row.signoff === 'approved') return 'approved — spec signed off, awaiting build';
    return `designed — awaiting ${mine ? 'your ' : ''}sign-off`;
  }
  return mine ? 'built — awaiting your walkdown' : 'built — awaiting verification';
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
 * only itself, but its headings are drawn anyway by the grouping below,
 * because a filtered list that loses the hierarchy stops saying where anything
 * lives.
 *
 * The screen is a heading too now, and searchable as one: typing a screen's
 * name gives you every rule judged on it. That is the question the grouping
 * invites, and a heading you can see but not search for reads as broken.
 */
export const matchesQuery = (s, q) =>
  String(s ?? '')
    .toLowerCase()
    .includes(q);
export function matchingRows() {
  const q = S.ruleQuery.trim().toLowerCase();
  if (!q) return S.data.rows;
  const groups = new Set(S.data.rows.map((r) => r.story).filter((story) => matchesQuery(story, q)));
  const screens = new Set(
    (S.data.storyboard ?? [])
      .filter((sc) => matchesQuery(sc.title, q) || matchesQuery(sc.id, q))
      .map((sc) => sc.id),
  );
  return S.data.rows.filter(
    (row) =>
      groups.has(row.story) ||
      screens.has(screenIdOf(row)) ||
      matchesQuery(row.rule, q) ||
      matchesQuery(row.statement, q),
  );
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
  /*
   * `skipped` had the dash too, on the argument that it and `na` are the same
   * news to somebody scanning. An agent walkdown disagreed and was right
   * (n-0122): one glyph for two states meant the legend had to pick which one
   * to explain, and whichever it picked was a wrong answer for the other. A
   * run that went past this rule is not the same as a rule that never asked -
   * the first might run tomorrow.
   */
  skipped: ['⋯', 'opacity-40', 'skipped — a run went past this rule'],
  blocked: ['⊘', 'text-warning', 'blocked'],
  /*
   * The two ways a tier can have no verdict coming. They were one dot for a
   * while and that was too quiet to be worth drawing: at 12px a dot says
   * nothing at all, and it said the same nothing for both states.
   *
   * `unbuilt` is a tier with nothing to judge yet, and it wears a grey tick:
   * the rule is not waiting on this tier, and the shape it will eventually
   * wear is already the shape it wears now. `na` is a tier the rule has
   * declared it cannot honestly have, and it wears a dash: a line through
   * where a verdict would go, which is what an excuse is.
   */
  unbuilt: ['✓', 'opacity-25', 'nothing to judge yet — the rule is not built'],
  na: ['–', 'opacity-30', 'not applicable — this rule does not ask for it'],
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
 *   stale     a hollow ring around a point: the signature is still there but
 *             no longer covers what the rule says, so it has pulled back from
 *             the edge without vanishing
 *   none      an outline ring: the slot is there and empty
 *   sent-back a red ✗, not a dot - somebody looked and disagreed, which is
 *             the one thing on this strip that is not an absence
 *
 * Stale was a smaller solid disc first, and that was wrong. Size alone needs
 * a neighbour to be read against, and the common case is one dot with nothing
 * beside it - so a stale signature read as a signature, which is the exact lie
 * `status.derived.stale-never-passes` exists to forbid. The ring differs from
 * a solid disc in kind, not degree, and needs no reference to be seen.
 *
 * The half fill and the ring's centre are inline gradients rather than
 * classes: each is one declaration used in one place, and a two-tone 5px box
 * is not something the utility vocabulary has a name for.
 */
function signoffDot(a, mine) {
  const tint = ROLE_TINT[a.role] ?? 'text-base-content';
  if (a.state === 'sent-back') return `<span class="text-[8px] leading-none text-error">✗</span>`;
  const shape =
    {
      signed: 'size-[6px] bg-current',
      approved: 'size-[6px] border border-current',
      stale: 'size-[6px] border border-current',
    }[a.state] ?? 'size-[6px] border border-current';
  const fill =
    {
      approved: ' style="background:linear-gradient(to top, currentColor 50%, transparent 50%)"',
      stale: ' style="background:radial-gradient(currentColor 0 1.25px, transparent 1.25px)"',
    }[a.state] ?? '';
  // Owed slots dim when the rule is not waiting on you, exactly as the tier
  // glyphs beside them do — the strip has one language for "your turn".
  const dim = a.state !== 'signed' && !mine ? ' opacity-60' : '';
  return `<span class="block rounded-full ${shape} ${tint}${dim}"${fill}></span>`;
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
  const slots =
    all.length > MAX_SLOTS
      ? [all[0], { role: '+', state: 'more', n: all.length - 2 }, all.at(-1)]
      : all;
  return `<span class="flex w-4 shrink-0 flex-col items-center justify-center"
    data-testid="panel.rule-signoff" data-signoff="${esc(all.map((a) => `${a.role}:${a.state}`).join(' '))}"
    >${slots
      .map(
        (a) =>
          `<span class="flex h-[9px] items-center justify-center">${
            a.state === 'more'
              ? `<span class="text-[8px] leading-none opacity-60">+${a.n}</span>`
              : signoffDot(a, mine)
          }</span>`,
      )
      .join('')}</span>`;
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
  const cells = tiers.map(([kind, state, cell]) => [
    kind,
    state === 'stale' ? whyStale(cell) : (TIER_MARK[state] ?? TIER_MARK.na)[2],
  ]);
  const signs = stackOrder(acceptance).map((a) => [
    a.role,
    `${SIGN_SAY[a.state] ?? a.state}${a.actor ? ` · ${a.actor}` : ''}${
      a.created ? ` · ${MSG.ago(a.created)}` : ''
    }`,
  ]);
  const line = ([label, said]) =>
    `<span class="opacity-60">${esc(label)}</span><span>${esc(said)}</span>`;
  /*
   * z-20 clears the sticky screen band, which sits at z-10.
   *
   * This is the second time a z-index has been put on this bubble. The first
   * was wrong - it was fixing a fade caught mid-transition by a screenshot,
   * and measuring it at daisyUI's own z-index of 2 showed the bubble opaque
   * and on top. Nothing had changed by the time it came out again.
   *
   * What changed is the band, which sits at z-10. The row directly under it is
   * the one row whose tooltip extends up behind it, and at daisyUI's z-index
   * the band clips the bubble's first line off.
   *
   * Confirmed by looking, not by elementFromPoint - the bubble carries
   * `pointer-events: none`, so that call reports whatever is behind it and
   * would have said "covered" whichever z-index was set. Two screenshots of
   * the same hover, one at z-2 and one at z-20, are what settled it.
   */
  return `<span class="tooltip-content z-20 w-60 whitespace-normal text-left text-[11px] leading-snug"
    data-testid="panel.rule-tiers-tip"><span class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">${cells
      .map(line)
      .join('')}${
      signs.length
        ? `<span class="col-span-2 mt-0.5 opacity-40">accepted by</span>${signs.map(line).join('')}`
        : ''
    }</span></span>`;
}

export function tierMarks(row, mine = false) {
  /*
   * An unbuilt rule has the same three slots as any other, both evidence
   * tiers reading "nothing to judge yet". It is not that the tiers are
   * absent - they are owed by the BUILD, which does not exist, and saying so
   * in the same three positions is what lets the eye run down the column.
   */
  /*
   * `unbuilt` stands in only for a tier that has NEVER run. Blanketing both
   * tiers with it the moment a rule was unbuilt threw away real news: a rule
   * can be unbuilt and still carry an agent run that came back blocked, and
   * that run is the reason it is not built. What the strip owes an unbuilt
   * rule is "nothing has judged this, and nothing could have" - which is what
   * `never` means here - not silence about what did happen.
   */
  const quiet = (state) => (!row.built && state === 'never' ? 'unbuilt' : state);
  const tiers = [
    ['checks', quiet(checksTier(row)), null],
    ['agent', quiet(row.agent?.state ?? 'na'), row.agent],
  ];
  // title="" is not a leftover: the row around this is a button carrying its
  // own native title, and a native tooltip is inherited from the nearest
  // ancestor that has one. An empty title stops that here, so hovering the
  // strip opens the strip's bubble and nothing else.
  return `<span class="tooltip tooltip-right flex w-11 shrink-0 items-center justify-center gap-0.5 text-[12px] leading-none"
    title="" data-testid="panel.rule-tiers" data-tiers="${esc(tiers.map((t) => `${t[0]}:${t[1]}`).join(' '))}"
    >${stripTip(tiers, row.acceptance)}${tiers
      .map(([, state, cell]) => {
        const [glyph, cls] = TIER_MARK[state] ?? TIER_MARK.na;
        return `<span class="inline-block w-4 text-center ${
          TIER_OWED.has(state) && !mine ? 'opacity-60' : cls
        }">${glyph}</span>`;
      })
      .join('')}${signoffStack(row.acceptance, mine)}</span>`;
}

/*
 * The header a screen's rules sit under.
 *
 * It carries the same icon the bar's screen picker does, because they name the
 * same thing and a reviewer should not have to learn that twice. The title is
 * allowed to wrap: a storyboard title says what state it is - "Rule detail
 * (state - open a rule on the Rules tab)" - and truncating that to an ellipsis
 * in a 384px rail throws away the half that distinguishes it.
 *
 * `data-screen-group`, not `data-screen`: the bar's screen picker already owns
 * that attribute, and giving it a second meaning in the list made
 * `[data-screen="rule-detail"]` resolve to a heading nobody could click
 * instead of the option it was written for.
 *
 * Sticky to the top of the list's own scrollport, so the screen you are
 * reading rules for is named however far down the group you are - forty-two
 * rules hang off the review page, and the heading scrolled away long before
 * you stopped needing it. The fill is opaque for the same reason: a
 * translucent band with rows sliding under it is unreadable exactly when it
 * is doing its job.
 */
function screenHeader(id) {
  const sc = screenById(id);
  const title = sc ? (sc.title ?? sc.id) : id;
  return `<div class="sticky top-0 z-10 flex items-start gap-2 border-b border-t border-base-300 bg-base-200 px-3.5 py-3 first:border-t-0"
    data-testid="panel.rules-screen" data-screen-group="${esc(id ?? '')}">
    <span class="mt-0.5 shrink-0 ${id ? 'text-primary' : 'opacity-30'}">${icon('frame-corners', 'size-3.5')}</span>
    <span class="min-w-0 text-[12.5px] font-semibold leading-snug">${
      title ? esc(title) : 'No screen'
    }${id ? '' : '<span class="ml-1.5 font-normal opacity-40">judged without looking</span>'}</span>
  </div>`;
}

/** One rule, as the rail draws it. */
function ruleRow(row) {
  const mine = needsYou(row.rule);
  /*
   * A verdict picked this sitting is the one thing that still draws its own
   * mark instead of the strip, and deliberately: it is not in the ledger
   * yet. Standing outside the strip's vocabulary is how the row says the
   * judgment is yours and unfiled.
   */
  const picked = S.session?.verdicts[row.rule];
  const why = picked ? 'judged this session' : ruleWhy(row, mine);
  const owes = mine && !picked ? (row.built ? 'walk' : 'sign') : '';
  const thr = threadsFor(row.rule).length;
  /*
   * Two right-hand columns, always drawn, even when empty. What you owe and
   * how much is being said about a rule are different questions, and run
   * together in one warning-yellow string they read as one word - "walk 2"
   * looked like a quantity of walking. Fixed widths so both answers stack
   * into columns you can run an eye down; the thread count in plain ink at
   * half strength, because it is context rather than a claim on you.
   */
  return `<button class="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-[14px] hover:bg-base-200"
      data-rule="${esc(row.rule)}" title="${esc(row.rule)} — ${esc(why)}">
      ${
        picked
          ? `<span class="w-11 shrink-0 text-center ${
              {
                pass: 'text-success',
                fail: 'text-error',
                approved: 'text-success',
                refining: 'text-warning',
              }[picked]
            }">${{ pass: '✓', fail: '✗', approved: '✍︎', refining: '✎︎' }[picked]}</span>`
          : tierMarks(row, mine)
      }
      <span class="truncate">${esc(shortName(row))}</span>
      <span class="ml-auto flex shrink-0 items-center gap-2 text-[11.5px] font-semibold">
        <span class="w-7 text-right text-warning">${owes}</span>
        <span class="w-7 text-right font-normal text-base-content/45">${thr ? `${thr}⚑` : ''}</span>
      </span>
    </button>`;
}

/*
 * The rail: screens, then the stories on them, then the rules.
 *
 * Grouping by story alone put `invites.batch` and `invites.list` next to each
 * other and never said where either was judged - so the reviewer held the
 * mapping from feature to screen in their head, on the one screen where it
 * matters most. The screen is the heading now, and the story keeps only what
 * the screen does not already say.
 */
export function listPane() {
  if (!S.data.rows.length)
    return '<p class="p-3.5 text-[13.5px] opacity-40">No rules in this blueprint.</p>';
  const rows = matchingRows();
  if (!rows.length)
    return `<p class="p-3.5 text-[13.5px] opacity-40" data-testid="panel.rules-empty">No rule matches ${esc(
      S.ruleQuery.trim(),
    )}.</p>`;
  let html = '';
  for (const group of groupedRows(rows)) {
    html += screenHeader(group.screen);
    const labels = storyLabels(group.stories.map((g) => g.story));
    for (const { story, rows: within } of group.stories) {
      html += `<div class="px-3.5 pb-1 pt-2.5 ${LBL}" data-story="${esc(story)}">${esc(
        labels.get(story),
      )}</div>`;
      html += within.map((row) => ruleRow(row)).join('');
    }
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
  list.scrollTop = 0; // a filtered list is a new list; showing its middle is not helpful
  wireRuleRows();
}

export function wireSearch() {
  const box = D.host.querySelector('#wdp-search');
  if (!box) return;
  box.oninput = () => {
    S.ruleQuery = box.value;
    paintRules();
  };
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

/*
 * The legend: what every mark on the rail means, in one hover.
 *
 * Built FROM the same maps the rail draws from - TIER_MARK for the glyphs,
 * signoffDot for the dots - rather than from a hand-written copy of them.
 * A legend that is a second description of the vocabulary is a legend that
 * goes quietly wrong the first time the vocabulary moves, and this one has
 * already moved twice this week.
 *
 * The role passed to signoffDot is deliberately one nobody has tinted, so the
 * shapes draw in the panel's own ink: the legend is teaching SHAPE, and a
 * blue dot beside "signed" would read as though blue were part of the answer.
 * Colour is explained in its own line instead.
 */
/*
 * Ordered worst-news-first, then anything the map holds that this list has not
 * named. Spelling the states out by hand let one go missing - `skipped` was
 * absent while the rail could still draw it (n-0122) - and a legend that is
 * silently incomplete is worse than none, because a reader who consults it
 * and finds nothing concludes the mark means what the nearest row says.
 * Deriving the tail means a new state appears here the moment it exists.
 */
const LEGEND_ORDER = ['pass', 'fail', 'stale', 'never', 'blocked', 'skipped', 'unbuilt', 'na'];
const LEGEND_TIERS = [
  ...LEGEND_ORDER.filter((k) => k in TIER_MARK),
  ...Object.keys(TIER_MARK).filter((k) => !LEGEND_ORDER.includes(k)),
];
const LEGEND_SIGNS = ['signed', 'approved', 'stale', 'none', 'sent-back'];

export function legendControl() {
  const head = (t) =>
    `<span class="col-span-2 pt-1 text-[10px] font-bold uppercase tracking-widest opacity-40">${t}</span>`;
  const tierLine = (state) => {
    const [glyph, cls, why] = TIER_MARK[state];
    return `<span class="text-center ${cls}">${glyph}</span><span>${esc(why)}</span>`;
  };
  const signLine = (state) =>
    `<span class="flex justify-center">${signoffDot({ role: '_', state }, true)}</span>
     <span>${esc(SIGN_SAY[state])}</span>`;
  return `<span class="tooltip tooltip-top shrink-0" data-testid="panel.legend">
    <!-- z-50 here is load-bearing, and unlike the rule strip's bubble it was
         measured rather than assumed: this one opens UPWARD across the whole
         scrolling list from the last row in the panel, and at daisyUI's own
         z-index of 2 the rules paint over it. The rule strip opens sideways
         within the list and needs nothing. -->
    <span class="tooltip-content z-50 w-72 whitespace-normal text-left text-[11.5px] leading-snug"
      data-testid="panel.legend-tip"
      ><span class="grid grid-cols-[1.25rem_1fr] items-center gap-x-2 gap-y-0.5">
      ${head('Evidence — checks, then agent')}${LEGEND_TIERS.map(tierLine).join('')}
      ${head('Signatures — one slot per role')}${LEGEND_SIGNS.map(signLine).join('')}
      ${head('And around them')}
      <span class="text-center text-warning">◆</span><span>Warning yellow anywhere means the rule is waiting on <b>you</b>.</span>
      <span class="text-center text-warning">▪</span><span><b>sign</b> is a spec to accept; <b>walk</b> is a build to judge.</span>
      <span class="text-center opacity-45">⚑</span><span>Open conversations on the rule.</span>
    </span></span>
    <span class="flex cursor-help items-center gap-1 opacity-50">${icon('info', 'size-3.5')}Legend</span>
  </span>`;
}
