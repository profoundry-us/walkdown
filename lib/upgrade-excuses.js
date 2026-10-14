/*
 * `walkdown upgrade`, for excuses: a stamp from before stamps recorded what
 * they excused gets `steps.excused`, the tiers its rule excuses now
 * (locations.keeping.upgrade-records-excuses, q-0599).
 *
 * `hash --write --reword` refuses a rewording that adds an excuse, and reads
 * a stamp with no record as having excused nothing, so in a project stamped
 * before 0.5.0 it refused every excused rule. The hash is not touched: the
 * record is beside it, so no verdict goes stale on its account, and a rule
 * whose hash is already stale is recorded the same.
 *
 * Only a person's upgrade does this, never `--layout-only`: a hook that kept
 * a home current would otherwise record an excuse written after the last
 * stamp as one the stamp had already excused.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseDocument } from '../vendor/yaml.js';
import { loadBlueprint } from './blueprint.js';
import { excusedTiers } from './hash-cmd.js';
import { isHome } from './locations.js';

/**
 * Every blueprint with a stamp to fill in, and the rules on it.
 *
 * @param {Iterable<string>} homes
 * @returns {{ name: string, files: { file: string, rules: { id: string, at: number[], tiers: string[] }[] }[] }[]}
 */
export function planExcuses(homes) {
  const plans = [];
  for (const home of homes) {
    if (!isHome(home)) continue;
    let bp;
    try {
      bp = loadBlueprint(home);
    } catch {
      continue; // said by every other command; the upgrade does what it can read
    }
    const files = [];
    for (const { file } of bp.features) {
      let data;
      try {
        data = parseDocument(readFileSync(file, 'utf8')).toJS();
      } catch {
        continue;
      }
      const rules = [];
      (data?.stories ?? []).forEach((story, si) =>
        (story?.rules ?? []).forEach((rule, ri) => {
          if (!rule?.id || rule.retired || !rule.steps?.statement_hash) return;
          if (rule.steps.excused !== undefined) return;
          const tiers = excusedTiers(rule.unverifiable);
          if (tiers.length) rules.push({ id: rule.id, at: [si, ri], tiers });
        }),
      );
      if (rules.length) files.push({ file, rules });
    }
    if (files.length) plans.push({ name: bp.config?.blueprint ?? basename(bp.dir), files });
  }
  return plans;
}

/** Write one blueprint's records, leaving every hash as it is. */
export function runExcuses(plan) {
  for (const { file, rules } of plan.files) {
    const doc = parseDocument(readFileSync(file, 'utf8'));
    for (const { at, tiers } of rules)
      doc.setIn(
        ['stories', at[0], 'rules', at[1], 'steps', 'excused'],
        doc.createNode(tiers, { flow: true }),
      );
    writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
  }
}
