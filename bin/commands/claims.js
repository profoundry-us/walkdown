import { parseArgs } from 'node:util';
import { listedBlueprints, loadBlueprint } from '../../lib/blueprint.js';
import { resolveLocations } from '../../lib/locations.js';
import { blueprintsForUrl, claimsOf, sharedPages } from '../../lib/claims.js';
import { end } from './context.js';

/*
 * Who claims what, across every blueprint under the served folder. Two jobs in
 * one place because they are one question: with `--url`, which blueprints a
 * page belongs to; without, which pages are covered by more than one.
 *
 * The second half was a constraint until 2026-09-09 and is an inventory now
 * (ADR 0001). A shared page is a thing to know, not a thing to fix, so this
 * exits 0 either way - the only failure left is asking about an address
 * nothing claims.
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
  // The set the `.walkdown` here declares - not the one beside wherever the
  // spec sits, which may be another project's (n-0159).
  const projects = listedBlueprints({ cwd: process.cwd() }).map((p) => ({
    id: p.id,
    blueprint: loadBlueprint(p.dir),
  }));

  if (values.url) {
    const hits = blueprintsForUrl(projects, values.url);
    if (values.json) {
      console.log(JSON.stringify({ url: values.url, matches: hits }, null, 2));
      return end(0);
    }
    if (!hits.length) {
      console.log(`no blueprint claims ${values.url}`);
      return end(1);
    }
    // Every claimant, never a pick between them: the order is the config's
    // and means nothing (ADR 0001).
    console.log(values.url);
    for (const hit of hits) console.log(`  ${hit.id} — screen ${hit.screen} (target ${hit.target})`);
    if (hits.length > 1) console.log(`\n${hits.length} blueprints claim it. Opening one is a person's choice.`);
    return end(0);
  }

  const shared = sharedPages(projects);
  const total = projects.reduce((n, p) => n + claimsOf(p.blueprint).length, 0);
  if (values.json) {
    console.log(
      JSON.stringify({ blueprints: projects.map((p) => p.id), shared }, null, 2),
    );
    return end(0);
  }
  console.log(`${projects.length} blueprint(s), ${total} claim(s)`);
  if (!shared.length) return end(0);
  console.log(`\n${shared.length} page(s) covered by more than one blueprint:`);
  for (const c of shared) {
    console.log(`  ${c.key}`);
    for (const who of c.claimants)
      console.log(`    ${who.blueprint} — screen ${who.screen} (target ${who.target})`);
  }
  console.log('\nwalkdown asks which one you mean when you open such a page.');
  return end(0);
}
