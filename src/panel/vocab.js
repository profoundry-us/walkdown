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
import { canTransition, isMachineName, TERMINAL, whoseMove } from '../../lib/vocab.js';
import { identityOverride, S } from './state.js';
import { api } from './util.js';

/*
 * The domain terms come from the same file the server enforces them with —
 * bundled in, like screen-match. Re-exported here so panes keep one door to
 * the vocabulary; this module adds only the presentation layer (labels,
 * badge classes, readings of S).
 */
export { CHIP, duringSession, FLOWS, HUMAN_ONLY, NEEDS_REASON, TERMINAL } from '../../lib/vocab.js';

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
    (t) => t.anchor?.rule === rule && !TERMINAL.includes(t.status),
  );
/** Every thread ever filed on a rule, ended ones included: the rule's whole conversation. */
export const conversationOf = (rule) =>
  (S.data?.threads ?? []).filter((t) => t.anchor?.rule === rule);

/*
 * Is this thread on a rule the walk can still reach? Then it is that rule's
 * conversation, and the rule's verdict is what it waits on (ADR 0006): the
 * composer offers no Done or Reopen on it, the Threads tab leaves it to the
 * walk, and the walk lists the rule once. A thread on no rule, or on a
 * retired one, stands on its own as before.
 */
export const onWalkableRule = (t) =>
  Boolean(t?.anchor?.rule) && (S.data?.rows ?? []).some((r) => r.rule === t.anchor.rule);

/*
 * What kind of ask a rule is making of you, in one short word for the
 * list's owed column - the walk lists every rule that needs you, whatever
 * the ask, and the word says which (ADR 0006 §4). Read off the attention
 * items, never re-derived: `asks` when a question on the rule waits on an
 * answer, `fixed` when a claimed fix waits on the verdict, else the verdict
 * itself - `sign` a wording, `walk` a build.
 */
export function askOf(row) {
  const mine = (S.data?.attention ?? []).filter((i) => i.who === 'human' && !i.thread && i.rule === row.rule);
  if (!mine.length) return '';
  if (mine.some((i) => i.action === 'answer')) return 'asks';
  if (mine.some((i) => i.action === 'verify')) return 'fixed';
  return row.built ? 'walk' : 'sign';
}

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
/*
 * Who this panel is. Not a local choice: the server records under the
 * machine's configured identity whatever a request claims, so this reports
 * that answer rather than competing with it. An override used to come first
 * and a running session's actor second, which is how the panel came to offer
 * Verify under a name nobody had typed (n-0143).
 */
export const whoAmI = () => (S.data?.identity?.username ?? '').trim();

/*
 * And whether that name was WRITTEN DOWN or merely guessed at. Accepting work
 * asks for a person, and a login name is what a machine is called.
 */
export const iAmDeclared = () => Boolean(S.data?.identity?.declared);

/*
 * And WHICH file to say it in. Every sentence here used to name
 * `~/.walkdown/config.yml` as a literal, and the file the server actually
 * reads is configPath(), which honours WALKDOWN_HOME - so under a redirected
 * home the panel sent people to edit a file nothing reads (n-0204). The
 * browser cannot work the path out; the server sends it with the identity,
 * and the literal is the fallback for a payload made before it did.
 */
export const whereIdentityLives = () =>
  S.data?.identity?.config_path || '~/.walkdown/config.yml';

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
 *
 * It offered every legal move to everyone, and read as a control panel:
 * Addressed beside Verify beside Waive, with nothing saying which of them
 * was yours to press (Topher, 2026-09-17). What a composer offers now is
 * WHOSE MOVE it is, in three words: the buttons are the ones this reader's
 * role takes from this state, and a move that is legal but somebody else's
 * is simply not drawn. A person is never offered the agent's claim
 * (addressed, settled, incorporated) and the agent is never offered the
 * person's acceptance (verified, waived) - the same law lib/threads.js
 * enforces, read off the same tables.
 *
 * "Done" is deliberately one word for two records: a person's Done is
 * verified, the agent's Done is addressed or incorporated. The record keeps
 * its own name; the button says what pressing it means from where you sit.
 */

/** Which side of the table this panel is sitting at. */
export const myRole = () => (isMachineName(whoAmI()) ? 'agent' : 'human');

/** Whose move a thread is, from the shared lifecycle. */
export { whoseMove } from '../../lib/vocab.js';

/*
 * What the composer offers, by kind, status and the reader's role:
 * `[label, act, tone]`, in the order they are drawn - Waive first and
 * alone at the far left, because it buries work and should not sit
 * beside the buttons a hand reaches for (Topher, 2026-09-17); then the
 * quiet ones, and the primary last on the right. `act` is a status
 * from FLOWS, or one of the composer's own two: `__reply` and `__answer`,
 * which are replies that may carry a transition.
 */
const REPLY = ['Reply', '__reply', 'quiet'];
const WAIVE = ['Waive', 'waived', 'warn'];
const REOPEN = ['Reopen', 'open', 'quiet'];
/*
 * An ended thread offers a person Reply and Reopen: the conversation stays
 * append-only - reopening adds its reason and moves the status, unsaying
 * nothing - and a thread that regressed is the same thread. Only a person
 * reopens an accepted one (lib/threads.js); the agent files afresh.
 */
const ENDED = [REPLY, REOPEN];
const OFFERS = {
  human: {
    note: {
      open: [WAIVE, REPLY],
      addressed: [WAIVE, REOPEN, ['Done', 'verified', 'primary']],
      verified: ENDED,
      waived: ENDED,
      settled: ENDED,
    },
    question: {
      open: [WAIVE, REPLY, ['Answer', '__answer', 'primary']],
      answered: [WAIVE, REPLY, REOPEN],
      incorporated: ENDED,
      waived: ENDED,
    },
  },
  agent: {
    note: {
      // An observation is the agent's to settle; anything else it addresses
      // and hands to a person (ADR 0005 §2). Both are Done from its seat.
      open: (t) => [REPLY, ['Done', t.reason === 'observation' ? 'settled' : 'addressed', 'primary']],
    },
    question: {
      answered: [REPLY, ['Done', 'incorporated', 'primary']],
    },
  },
};

/*
 * On a rule the walk can reach, a note is the rule's conversation and its
 * endings are the rule's verdict: a pass ends it, a fail continues it, so a
 * person is offered neither Done nor Reopen on it - only Reply, and Waive
 * for "never mind" (ADR 0006 §3). The agent's offers do not change: it still
 * addresses and settles, and a question is still answered in place.
 */
const ON_RULE = {
  note: {
    open: [WAIVE, REPLY],
    addressed: [WAIVE, REPLY],
    verified: [REPLY],
    waived: [REPLY],
    settled: [REPLY],
  },
};

/** Short verbs, and only the moves this reader takes from this kind and status. */
export function threadActions(t, role = myRole(), { onRule = onWalkableRule(t) } = {}) {
  const kind = t.kind === 'question' ? 'question' : 'note';
  const offer =
    (role === 'human' && onRule ? ON_RULE[kind]?.[t.status] : null) ?? OFFERS[role]?.[kind]?.[t.status];
  const list = (typeof offer === 'function' ? offer(t) : offer) ?? [REPLY];
  // Never a button the server would refuse: the offers are written against
  // the lifecycle, and this is the seam that keeps them honest if it moves.
  return list.filter(
    ([, act]) => act.startsWith('__') || canTransition(t.kind, t.status, act),
  );
}

/*
 * The turn line: whose move it is, and what that party does next, from
 * where THIS reader sits. `party` colours the line - a person's move is
 * amber, the agent's is blue, an ended thread is green - and `label` says
 * "your move" when the party is the reader.
 */
export function turnLine(t, role = myRole(), { person = 'the person', endedBy = null, endedAt = null, onRule = onWalkableRule(t) } = {}) {
  const party = whoseMove(t);
  const note = t.kind !== 'question';
  if (!party) {
    const how = t.status === 'waived' ? 'Waived' : t.status === 'recorded' ? 'Recorded' : t.status[0].toUpperCase() + t.status.slice(1);
    // On a rule, the way back is a fail on the rule, not a Reopen here.
    const back = role !== 'human' || t.status === 'recorded' ? '' : onRule && note ? '; a fail on the rule reopens it' : '; reopen if it comes back';
    return {
      party: 'closed',
      label: 'Closed',
      text: `${how}${endedBy ? ` by ${endedBy}` : ''}${endedAt ? `, ${endedAt}` : ''}. Replies still land here${back}.`,
    };
  }
  const yours = party === role;
  const label = yours ? 'Your move' : party === 'agent' ? "Agent's move" : `${person}'s move`;
  const q = t.kind === 'question';
  const obs = t.reason === 'observation';
  const finding = t.reason === 'finding';
  let text;
  if (role === 'human') {
    if (q && t.status === 'open') text = 'The agent is asking you. Answer records your answer; Reply just talks.';
    else if (q) text = 'You answered. It folds the answer into the rule on its next run and closes this.';
    else if (t.status === 'open' && obs) text = 'It noticed this itself and closes it itself on its next run. It never comes back to you.';
    else if (t.status === 'open' && finding) text = 'A judge failed the rule on this. The agent fixes it on its next run; a signed pass on the rule closes it.';
    else if (t.status === 'open') text = 'It does what you asked here on its next run, then hands it back to you.';
    // Addressed, on a rule: the verdict is the acceptance (ADR 0006 §3).
    else if (onRule) text = 'The agent says this is done. Judge the rule: a signed pass ends this conversation, a fail continues it.';
    else if (finding) text = 'The agent says this is fixed. Judge the rule again - a signed pass closes it; Reopen if it is not.';
    else text = 'The agent says this is done. Look: Done if it is, Reopen if it is not.';
  } else {
    if (q && t.status === 'open') text = `${person} has not answered yet. Reply if there is more to ask.`;
    else if (q) text = 'Fold the answer into the rule, say where it went, then mark it Done. That closes the question.';
    else if (t.status === 'open' && obs) text = 'You noticed this. Say what changed, then mark it Done - nobody else is asked.';
    else if (t.status === 'open') text = `Do what this asks, say what you did, then mark it Done. It goes back to ${person} to look.`;
    else text = `${person} is looking at what you did. Reply if there is more to say.`;
  }
  return { party, label, text };
}

/** What the box invites, by state: the answer, the reason, or a reply. */
export function composerPlaceholder(t, role = myRole(), opts = {}) {
  const acts = threadActions(t, role, opts).map(([, act]) => act);
  if (acts.includes('__answer')) return 'Answer\u2026';
  // A box whose only use is a reason says so; one that also replies is a
  // reply box first, and the reason is what the reply becomes if you press
  // Reopen or Waive instead of Enter.
  const reasons = ['Reopen', 'Waive'].filter((v, i) => acts.includes(['open', 'waived'][i]));
  return !acts.includes('__reply') && reasons.length ? `For ${reasons.join(' or ')}, say why\u2026` : 'Reply\u2026';
}
