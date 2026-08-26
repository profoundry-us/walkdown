/*
 * Which blueprint a page belongs to.
 *
 * A page belongs to exactly one blueprint (docs/06 §2, settled in q-0019). That
 * is a hard constraint rather than a preference: it is what lets the panel open
 * the right project without asking, and what stops a pin having to ask which
 * project it is feedback about.
 *
 * The constraint is invisible from inside any one blueprint — `walkdown lint`
 * validates one at a time — so it lives here, where the set is in view.
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
 * Where two blueprints claim the same page. Returns
 * [{ key, claimants: [{ blueprint, screen, target }, ...] }], empty when clean.
 */
export function findCollisions(blueprints) {
  const byKey = new Map();
  for (const bp of blueprints)
    for (const c of claimsOf(bp.blueprint ?? bp)) {
      const id = bp.id ?? bp.blueprint?.id ?? '(unnamed)';
      if (!byKey.has(c.key)) byKey.set(c.key, []);
      byKey.get(c.key).push({ blueprint: id, screen: c.screen, target: c.target });
    }
  const clashes = [];
  for (const [key, claimants] of byKey) {
    // Several screens of ONE blueprint on one key is that blueprint's business
    // — a page in two states. Several BLUEPRINTS is the thing we forbid.
    const projects = new Set(claimants.map((c) => c.blueprint));
    if (projects.size > 1) clashes.push({ key, claimants });
  }
  return clashes;
}

/**
 * The blueprint a URL belongs to, or null. Matched on origin plus path, most
 * specific first: a declared fragment beats one without, so an SPA route that
 * has been enumerated wins over the page it lives on.
 */
export function blueprintForUrl(blueprints, url) {
  let loc;
  try {
    loc = new URL(url);
  } catch {
    return null;
  }
  let best = null;
  for (const entry of blueprints) {
    for (const c of claimsOf(entry.blueprint ?? entry)) {
      if (c.origin !== loc.origin) continue;
      const ref = splitScreenRef(c.path);
      if (!ref) continue;
      const pathHit = loc.pathname === ref.path || loc.pathname.endsWith(ref.path);
      if (!pathHit) continue;
      if (ref.fragment && ref.fragment !== (loc.hash || '')) continue;
      const score = (ref.fragment ? 100 : 0) + ref.path.length;
      if (!best || score > best.score)
        best = { id: entry.id ?? null, screen: c.screen, target: c.target, score };
    }
  }
  return best;
}
