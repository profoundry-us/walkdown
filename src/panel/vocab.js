/*
 * The panel's shared vocabulary: the small questions every pane asks of the
 * data, and the two class strings they all label with.
 *
 * None of it decides anything or draws anything — each is a plain reading of
 * S — which is why it can sit below every pane in the import graph and be
 * reached from all of them without a cycle. When one pane needed a helper the
 * next pane also needed, this is where it went.
 */
import { locationOfUrl, matchScreen } from '../../lib/screen-match.js';
import { FLOWS } from '../../lib/vocab.js';
import { identityOverride, S } from './state.js';
import { api } from './util.js';

/*
 * The domain terms come from the same file the server enforces them with —
 * bundled in, like screen-match. Re-exported here so panes keep one door to
 * the vocabulary; this module adds only the presentation layer (labels,
 * badge classes, readings of S).
 */
export { CHIP, FLOWS, HUMAN_ONLY, NEEDS_REASON, TERMINAL } from '../../lib/vocab.js';

// ---- data -----------------------------------------------------------------
/*
 * The walk's own work list: rules owing you a verdict, less the ones you
 * have already judged this sitting. Four copies of this predicate had grown
 * up - the footer's counts, the tab badge, the pass-advance, Continue - and
 * they only agreed by hand. One definition, and the number on the tab is by
 * construction the list Continue walks.
 */
export const owedRows = () =>
  orderedRows().filter((r) => needsYou(r.rule) && !(S.session?.verdicts ?? {})[r.rule]);

/** The screen a rule is filed under: the end of its flow, or the first it names. */
export const screenIdOf = (r) => r?.flow?.at(-1) ?? r?.screens?.[0] ?? null;

/*
 * The rail's own order, and the only definition of it.
 *
 * Rules are grouped by the SCREEN they are about, in storyboard order, then by
 * story in blueprint order. A screen is where a reviewer actually stands, so
 * it is the grouping that matches how the work is done - and the storyboard is
 * already a sequence, so its order is the one to walk in.
 *
 * Rules with no screen come last, together. A third of this blueprint is
 * headless - ledger law, CLI contracts, policies - and those are judged by
 * reading rather than by looking, so they are a destination of their own
 * rather than an awkward remainder scattered through the screens.
 *
 * The list, the detail's stepper and Continue all read THIS, because the
 * stepper promises to move in the order the list shows and Continue promises
 * to walk the list. Two orderings would break both promises quietly.
 */
export function groupedRows(rows = S.data?.rows ?? []) {
  const board = (S.data?.storyboard ?? []).map((s) => s.id);
  const rank = new Map(board.map((id, i) => [id, i]));
  // Unknown screen ids sort after every known one; no screen at all sorts last.
  const at = (id) => (id === null ? Infinity : (rank.get(id) ?? board.length));
  const groups = new Map();
  for (const row of rows) {
    const sid = screenIdOf(row) ?? null;
    if (!groups.has(sid)) groups.set(sid, new Map());
    const stories = groups.get(sid);
    if (!stories.has(row.story)) stories.set(row.story, []);
    stories.get(row.story).push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => at(a) - at(b))
    .map(([screen, stories]) => ({
      screen,
      stories: [...stories.entries()].map(([story, rs]) => ({ story, rows: rs })),
    }));
}

/** The same order, flat - what the stepper and the walk step through. */
export const orderedRows = (rows) =>
  groupedRows(rows).flatMap((g) => g.stories.flatMap((s) => s.rows));

/*
 * What a story is called once its screen is named above it. The feature
 * prefix is the screen's job now, so `invites.batch` reads as BATCH - unless
 * two stories under one screen would end up with the same word, and then both
 * keep their full id rather than the list drawing one label over two things.
 */
export function storyLabels(stories) {
  const leaf = (s) => String(s).split('.').at(-1);
  const tally = {};
  for (const s of stories) tally[leaf(s)] = (tally[leaf(s)] ?? 0) + 1;
  return new Map(stories.map((s) => [s, tally[leaf(s)] > 1 ? s : leaf(s)]));
}

export const needsYou = (rule) =>
  (S.data?.attention ?? []).some((i) => i.who === 'human' && !i.thread && i.rule === rule);
export const threadsFor = (rule) =>
  (S.data?.threads ?? []).filter(
    (t) => t.anchor?.rule === rule && !['incorporated', 'verified', 'waived'].includes(t.status),
  );

export const screenById = (id) => (S.data?.storyboard ?? []).find((s) => s.id === id) ?? null;

export const LBL = 'text-[10.5px] font-bold uppercase tracking-widest opacity-40';
/** A rule id with its story prefix dropped — what the rail calls it. */
export const shortName = (row) =>
  row.rule.startsWith(row.story + '.') ? row.rule.slice(row.story.length + 1) : row.rule;

/**
 * A thread in the detail pane. Collapsed it is a line of provenance and the
 * note; open it carries its replies, a reply box and the transitions its
 * state allows — feedback gets answered where it is read, without leaving
 * the app under review.
 */

/** Who a reply and a transition are recorded as - one answer, as everywhere. */
export const whoAmI = () =>
  (identityOverride.username ?? S.session?.actor ?? S.data?.identity?.username ?? '').trim();

/** The screen a rule is about: the end of its flow, or the one it names. */
export const ruleScreen = (r) => screenById(r?.flow?.at(-1) ?? r?.screens?.[0]);

/*
 * When a rule lives on a screen you are not looking at, say so — and, now
 * that walkdown can move the surface, offer the trip as something it will
 * actually make rather than as a link out of the tool.
 */
export const isHeadless = (r) => Boolean(r) && !r.screens?.length && !r.flow?.length;

/** Last time anything was said - what a list of conversations sorts by. */
export const threadTouched = (t) => String((t?.replies ?? []).at(-1)?.created ?? t?.created ?? '');

// ---- where the reviewer is standing ---------------------------------------
// Readings of the frame URL against the storyboard - which screen, which
// surface, what the ghost would show. Moved from app.js because they decide
// nothing and draw nothing, which is this module's admission test.

export const hereLocation = () => locationOfUrl(S.frameUrl) ?? {};

export function pageSurface() {
  const sc = currentScreen();
  if (!sc) return 'app';
  return matchScreen([sc], hereLocation())?.surface ?? 'app';
}

/** Which storyboard screen this page is, by URL — same trick the embed uses. */
export function currentScreen() {
  const screens = S.data?.storyboard ?? [];
  if (S.pickedScreen) return screens.find((s) => s.id === S.pickedScreen) ?? null;
  return matchScreen(screens, hereLocation())?.screen ?? null;
}

/** Where a screen lives on one surface, as a URL walkdown can navigate to. */
export function screenUrl(screen, surface) {
  if (!screen) return null;
  if (surface === 'prototype')
    return screen.prototype && S.data?.hasPrototype ? api('/prototype' + screen.prototype) : null;
  return screen.app?.path && S.data?.appBase ? S.data.appBase + screen.app.path : null;
}

/*
 * Where a surface goes when the page is not a screen. Without this the fade
 * control was dead everywhere except the handful of pages walkdown happens to
 * recognise - so crossing between the design and the build, the single most
 * frequent thing a reviewer does, depended on where you already were.
 */
export const defaultScreen = () =>
  screenById(S.data?.defaultScreen) ??
  (S.data?.storyboard ?? []).find((sc) => screenUrl(sc, 'app') ?? screenUrl(sc, 'prototype')) ??
  null;

/** The screen a surface control should act on: this page, or the front door. */
export const screenInHand = () => screenById(S.ghostOverride) ?? currentScreen() ?? defaultScreen();

/**
 * What the ghost should draw for a screen: the design if there is one, and
 * otherwise a proposal sketch — flagged, because a sketch that reads as the
 * design is exactly the confusion the ownership rules exist to prevent.
 */
export function ghostSource(screen) {
  if (pageSurface() === 'prototype') {
    // Standing on the design, the other surface is the running app — and it
    // lives at its own origin, so the ghost takes an absolute URL.
    return screen?.app?.path && S.data.appBase
      ? { url: S.data.appBase + screen.app.path, proposed: false }
      : null;
  }
  if (screen?.prototype && S.data.hasPrototype)
    return { path: '/prototype' + screen.prototype, proposed: false };
  if (screen?.proposal) return { path: '/proposals' + screen.proposal, proposed: true };
  return null;
}

/** Every anchor the storyboard declares, on any screen. */
export const declaredAnchors = () =>
  new Set((S.data?.storyboard ?? []).flatMap((s) => s.anchors ?? []));

/*
 * The verbs are the panel's; which transitions exist is the lifecycle's.
 * This used to be a hand-copy of the whole FLOWS table with labels attached,
 * which is precisely the two-runtimes drift vocab.js exists to end: the menu
 * now cannot offer a move the server would refuse, or hide one it allows.
 */
const VERB = {
  addressed: 'Addressed',
  verified: '\u2713 Verify',
  answered: 'Answer',
  incorporated: 'Incorporated',
  open: 'Reopen',
  waived: 'Waive',
};

/** Short verbs, and only the transitions this kind and status allow. */
export function threadActions(t) {
  return (
    (FLOWS[t.kind] ?? FLOWS.note)[t.status]?.map((next) => [
      VERB[next],
      // Answering is a reply that carries the transition, not a bare status
      // change — the panel routes it through the reply box.
      t.kind === 'question' && next === 'answered' ? '__answer' : next,
      // The one visually-marked action: waiving buries work.
      next === 'waived' || undefined,
    ]) ?? []
  );
}
