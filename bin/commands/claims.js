import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { listedBlueprints, loadBlueprint } from '../../lib/blueprint.js';
import { resolveLocations } from '../../lib/locations.js';
import { blueprintForUrl, claimsOf, findCollisions } from '../../lib/claims.js';
import { end } from './context.js';

/*
 * Who claims what, across every blueprint under the served folder. Two jobs in
 * one place because they are one question: with `--url`, which blueprint a page
 * belongs to; without, whether any page is claimed by more than one, which is
 * the constraint that makes the first question answerable at all.
 *
 * It lives outside `lint` on purpose - lint validates ONE blueprint, and this
 * is only visible across the set.
 */
export function run(args) {
  const { values } = parseArgs({
    args,
    options: { project: { type: 'string' }, url: { type: 'string' }, json: { type: 'boolean' } },
  });
  const at = resolveLocations({ project: values.project });
  const dir = at.spec?.missing ? null : at.spec?.path;
  if (!dir) {
    console.error(`No blueprint here. Nothing in ${at.config.repo?.path ?? at.config.path} claims this directory.`);
    return end(2);
  }
  const projects = listedBlueprints({ cwd: dirname(resolve(dir)) }).map((p) => ({
    id: p.id,
    blueprint: loadBlueprint(p.dir),
  }));

  if (values.url) {
    const hit = blueprintForUrl(projects, values.url);
    if (values.json) {
      console.log(JSON.stringify({ url: values.url, match: hit }, null, 2));
      return end(0);
    }
    if (!hit) {
      console.log(`no blueprint claims ${values.url}`);
      return end(1);
    }
    console.log(`${values.url}\n  ${hit.id} — screen ${hit.screen} (target ${hit.target})`);
    return end(0);
  }

  const clashes = findCollisions(projects);
  if (values.json) {
    console.log(
      JSON.stringify({ projects: projects.map((p) => p.id), collisions: clashes }, null, 2),
    );
    return end(clashes.length ? 1 : 0);
  }
  if (!clashes.length) {
    const total = projects.reduce((n, p) => n + claimsOf(p.blueprint).length, 0);
    console.log(
      `\u2713 ${projects.length} blueprint(s), ${total} claim(s) — no page claimed twice`,
    );
    return end(0);
  }
  for (const c of clashes) {
    console.log(
      `\u2717 ${c.key} is claimed by ${new Set(c.claimants.map((x) => x.blueprint)).size} blueprints:`,
    );
    for (const who of c.claimants)
      console.log(`    ${who.blueprint} — screen ${who.screen} (target ${who.target})`);
  }
  console.log(
    `\n${clashes.length} page(s) claimed more than once. A page belongs to exactly one blueprint.`,
  );
  return end(1);
}
