/*
 * Which storyboard screen a location is — the one answer three separate
 * programs have to agree on.
 *
 * The panel resolves it to label the page and aim the ghost, the embed
 * resolves it to stamp pins, and the server resolves it again for pins that
 * arrive from a standalone embed. If those three ever disagree, a pin lands on
 * the wrong screen and nothing says so — so the logic lives here once and is
 * copied verbatim into the two browser files by tools/sync-shared.mjs. They
 * ship as single self-contained scripts down two delivery paths and cannot
 * import anything; a copy that a tool keeps honest beats three hand-written
 * near-matches.
 *
 * Everything between the markers must stay dependency-free and browser-safe.
 */

// --- screen-match:start ---
/**
 * A screen is identified by origin + path + fragment (docs/06 §2). The
 * storyboard writes that as one string, the way a URL is written:
 *
 *   prototype: /screens/waitlist-admin.html#invite-batch
 *   app: { path: /waitlist#invite-batch }
 *
 * A query may also be written, and it is treated differently on purpose: the
 * fragment is part of identity, the query is not. `?page=2` is the same screen
 * holding different data, and forking the storyboard on every filter would be
 * absurd. What a declared query does is break ties between screens that share
 * a path — /confirm.html and /confirm.html?already=1 are two screens, and the
 * constraint that a page belongs to exactly one blueprint is still checked on
 * path and fragment alone.
 */
function splitScreenRef(ref) {
  if (!ref) return null;
  const s = String(ref);
  const h = s.indexOf('#'); // the fragment starts at the FIRST #,
  const fragment = h < 0 ? '' : s.slice(h); // so "#/order?id=1" stays whole
  const head = h < 0 ? s : s.slice(0, h);
  const q = head.indexOf('?');
  return { path: q < 0 ? head : head.slice(0, q), query: q < 0 ? '' : head.slice(q), fragment };
}

/** An empty hash and a bare "#" are the same absence. */
function normalizeFragment(hash) {
  if (!hash || hash === '#') return '';
  return String(hash).startsWith('#') ? String(hash) : '#' + hash;
}

/** The canonical identity of one surface of one screen, for collision checks. */
function screenKey(ref) {
  const parts = splitScreenRef(ref);
  return parts ? parts.path + parts.fragment : null;
}

function pathMatches(refPath, pathname) {
  if (!refPath) return false;
  return pathname === refPath || String(pathname).endsWith(refPath);
}

/**
 * The two surfaces a screen can be reached at, as parsed refs. The prototype
 * comes first because app paths are the loose ones — an app path of "/" is a
 * suffix of every URL there is — and a page that is genuinely the design
 * should never be reported as the running app.
 */
function screenRefs(screen) {
  const out = [];
  const proto = splitScreenRef(screen?.prototype);
  if (proto) out.push({ surface: 'prototype', ref: proto });
  const app = splitScreenRef(screen?.app?.path);
  if (app) out.push({ surface: 'app', ref: app });
  return out;
}

/**
 * How well a declared ref fits a location: -1 for "not this one", otherwise
 * higher is more specific.
 *
 * A declared fragment must match exactly, because it is part of what the
 * screen IS. A ref with no fragment still matches a location that has one, and
 * scores lower — that fallback is what keeps an SPA usable before anyone has
 * enumerated its routes: at /orders#/order/1234 with only `/orders` in the
 * storyboard you are still, correctly, on the orders screen. Enumerating the
 * route later makes the answer sharper without breaking the one you had.
 */
function scoreRef(ref, loc) {
  if (!pathMatches(ref.path, loc.pathname ?? '')) return -1;
  if (ref.fragment && ref.fragment !== normalizeFragment(loc.hash)) return -1;
  const want = new URLSearchParams(ref.query);
  const have = new URLSearchParams(loc.search ?? '');
  let bonus = 0;
  for (const [k, v] of want) {
    if (have.get(k) !== v) return -1;
    bonus += 1;
  }
  return (ref.fragment ? 100 : 0) + bonus;
}

/** Resolve a location to the most specific storyboard screen that claims it. */
function matchScreen(screens, loc) {
  let best = null;
  for (const screen of screens ?? []) {
    for (const { surface, ref } of screenRefs(screen)) {
      const score = scoreRef(ref, loc ?? {});
      if (score < 0 || (best && score <= best.score)) continue;
      best = { screen, surface, fragment: ref.fragment, score };
    }
  }
  return best;
}

/** The identity-bearing parts of a URL string, for callers holding one. */
function locationOfUrl(url) {
  try {
    const u = new URL(url);
    return { pathname: u.pathname, search: u.search, hash: u.hash };
  } catch {
    return null;
  }
}

// --- screen-match:end ---

export {
  locationOfUrl,
  matchScreen,
  normalizeFragment,
  pathMatches,
  scoreRef,
  screenKey,
  screenRefs,
  splitScreenRef,
};
