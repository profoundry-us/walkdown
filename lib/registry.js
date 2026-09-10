/*
 * The claims index: which addresses each blueprint on this machine covers.
 *
 * Routing used to be a question for one repository, answered by loading every
 * blueprint that repository declared and reading its storyboard. Since ADR
 * 0001 the scope is the MACHINE - every project you have imported - and
 * loading all of them on every request is not something a panel can wait for.
 * q-0019 said as much on the day routing was designed: "with dozens of
 * blueprints per repo the panel must route by page, not by origin, which needs
 * a light projects index rather than loading every blueprint".
 *
 * So the claims are written down once, by `import`, and rebuilt by `serve` at
 * startup. This file is a CACHE and is treated as one: it is derived from the
 * specs, it is thrown away and rebuilt without ceremony, and it is never the
 * authority on anything. Editing a storyboard leaves it stale until the next
 * serve, which is a known and accepted cost - the alternative is a watcher,
 * and a watcher is a second thing that can be wrong.
 *
 * It lives beside the personal config rather than in a repository, because it
 * describes what THIS machine has imported and nothing a clone should inherit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { listedBlueprints, loadBlueprint } from './blueprint.js';
import { bestClaim, claimsOf } from './claims.js';
import { walkdownHome } from './locations.js';

/** Where the cache sits. Beside the config it is derived from. */
export const indexPath = () => join(walkdownHome(), 'claims.json');

/**
 * Read every declared blueprint's claims. Slow by construction - it loads each
 * spec - which is why it happens at import and at serve, and never per
 * request.
 */
export function buildIndex({ cwd = process.cwd() } = {}) {
  const blueprints = [];
  for (const bp of listedBlueprints({ cwd })) {
    let claims;
    try {
      claims = claimsOf(loadBlueprint(bp.dir, { cwd })).map(({ origin, path, screen, target }) => ({
        origin,
        path,
        screen,
        target,
      }));
    } catch {
      /*
       * A blueprint that will not load claims nothing today. It is left out
       * rather than allowed to throw: one unreadable spec among twenty must
       * not stop the other nineteen being routable, and `walkdown lint` is
       * where a broken spec is reported.
       */
      continue;
    }
    blueprints.push({ id: bp.id, key: bp.key, name: bp.name, dir: bp.dir, claims });
  }
  return { built: new Date().toISOString(), blueprints };
}

export function writeIndex(index) {
  mkdirSync(dirname(indexPath()), { recursive: true });
  writeFileSync(indexPath(), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/** The cache as it stands, or null where there is not one yet. */
export function readIndex() {
  try {
    return JSON.parse(readFileSync(indexPath(), 'utf8'));
  } catch {
    return null;
  }
}

/** Rebuild and write. What `import` and `serve` both call. */
export function refreshIndex(opts) {
  return writeIndex(buildIndex(opts));
}

/**
 * Every blueprint in the index claiming an address, in index order - which
 * carries no precedence. One entry per blueprint, its own best claim, exactly
 * as `blueprintsForUrl` answers from the specs themselves: the two must agree,
 * which is why both take their matching from `bestClaim` rather than each
 * having a loop of its own.
 */
export function claimantsFor(index, url) {
  let loc;
  try {
    loc = new URL(url);
  } catch {
    return [];
  }
  const out = [];
  for (const bp of index?.blueprints ?? []) {
    const best = bestClaim(bp.claims ?? [], loc);
    if (best) out.push({ id: bp.id, key: bp.key, name: bp.name, ...best });
  }
  return out;
}

/** Whether a cache exists at all — `serve` writes one, so this is rare. */
export const hasIndex = () => existsSync(indexPath());
