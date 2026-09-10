/*
 * Which blueprint a page belongs to.
 *
 * A page may be claimed by SEVERAL blueprints (ADR 0001). It was one, from
 * q-0019 until 2026-09-09, and the constraint bought a great deal: the panel
 * opened without asking and a pin never had to ask which project it belonged
 * to. It was withdrawn because two efforts about different functionality of one
 * page are not two pages, and no amount of splitting screens makes them so.
 *
 * What replaces it is a list and a question. Nothing here decides between
 * claimants - deciding is the person's, and a silent pick among them is the
 * panel deciding whose page you are on.
 *
 * None of this is visible from inside one blueprint - `walkdown lint` validates
 * one at a time - so it lives here, where the set is in view.
 *
 * A claim is an ORIGIN plus a PATH. The origin comes from a target's base_url,
 * so a blueprint with several targets claims its paths on several origins, and
 * the same path on two different origins is not a collision. The path is
 * compared by `screenKey`: fragment kept, query dropped. Within one blueprint
 * `/confirm.html` and `/confirm.html?already=1` are legitimately two screens;
 * across blueprints, two projects each claiming `/confirm.html` under different
 * queries would satisfy a naive check while plainly violating the intent.
 */
import { screenKey, splitScreenRef } from './screen-match.js';

/** Every (origin, path) a blueprint claims, as [{ key, origin, path, screen, target }]. */
export function claimsOf(blueprint) {
  const targets = blueprint?.config?.runner?.targets ?? {};
  const screens = blueprint?.storyboard?.screens ?? [];
  const out = [];
  for (const [target, cfg] of Object.entries(targets)) {
    let origin;
    try {
      origin = new URL(cfg?.base_url).origin;
    } catch {
      continue; // a target with no usable address claims nothing
    }
    for (const screen of screens) {
      const path = screenKey(screen?.app?.path);
      if (!path) continue;
      out.push({ key: `${origin}${path}`, origin, path, screen: screen.id, target });
    }
  }
  return out;
}

/**
 * Pages claimed by more than one blueprint. Returns
 * [{ key, claimants: [{ blueprint, screen, target }, ...] }], empty when none.
 *
 * An inventory, not a fault list. Until 2026-09-09 this answered "what is
 * wrong"; now it answers "what is shared", and the difference is only in who
 * reads it - a person deciding whether they meant it (ADR 0001).
 */
export function sharedPages(blueprints) {
  const byKey = new Map();
  for (const bp of blueprints)
    for (const c of claimsOf(bp.blueprint ?? bp)) {
      const id = bp.id ?? bp.blueprint?.id ?? '(unnamed)';
      if (!byKey.has(c.key)) byKey.set(c.key, []);
      byKey.get(c.key).push({ blueprint: id, screen: c.screen, target: c.target });
    }
  const shared = [];
  for (const [key, claimants] of byKey) {
    // Several screens of ONE blueprint on one key is that blueprint's business
    // - a page in two states. Several BLUEPRINTS is what this reports.
    const owners = new Set(claimants.map((c) => c.blueprint));
    if (owners.size > 1) shared.push({ key, claimants });
  }
  return shared;
}

/**
 * Every blueprint a URL belongs to, in the order the blueprints were given.
 * One entry per blueprint - its own best claim on this address - and never a
 * choice between them.
 *
 * Ranking survives WITHIN a blueprint, because it is how a screen is
 * identified at all: a declared fragment beats one without, so an enumerated
 * SPA route wins over the page it lives on. It is abandoned ACROSS blueprints,
 * where the highest score used to win outright and nothing was reported. That
 * silent pick is the panel deciding whose page this is, which is exactly the
 * fault four judgings removed in September (ADR 0001). The order here is the
 * caller's own and carries no precedence: a caller that reads [0] as "the
 * answer" has reintroduced the bug.
 */
export function blueprintsForUrl(blueprints, url) {
  let loc;
  try {
    loc = new URL(url);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of blueprints) {
    const best = bestClaim(claimsOf(entry.blueprint ?? entry), loc);
    if (best) out.push({ id: entry.id ?? null, ...best });
  }
  return out;
}

/**
 * One blueprint's best claim on an address, or null. The matcher itself, kept
 * in one place because two of them exist to disagree: the index in
 * `lib/registry.js` answers the same question from a cache, and a second loop
 * there would be a second opinion about which screen you are on - which is
 * what `screens.identity.one-matcher` is about.
 *
 * Scoring is WITHIN a blueprint only, and is how a screen is identified: a
 * declared fragment beats one without, and a longer path beats a shorter one.
 */
export function bestClaim(claims, loc) {
  let best = null;
  for (const c of claims) {
    if (c.origin !== loc.origin) continue;
    const ref = splitScreenRef(c.path);
    if (!ref) continue;
    const pathHit = loc.pathname === ref.path || loc.pathname.endsWith(ref.path);
    if (!pathHit) continue;
    if (ref.fragment && ref.fragment !== (loc.hash || '')) continue;
    const score = (ref.fragment ? 100 : 0) + ref.path.length;
    if (!best || score > best.score) best = { screen: c.screen, target: c.target, score };
  }
  return best;
}
