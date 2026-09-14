import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseDocument } from '../vendor/yaml.js';
import { formatHash, hashMatches } from './hash.js';
import { isoNow } from './time.js';

/**
 * Report (and with `write`, repair) statement_hash for every rule with steps.
 * Uses the YAML document API so --write only touches the hash scalar and
 * preserves the file's formatting and comments.
 *
 * `reword` is a person saying the words moved and the meaning did not. The
 * old hash is kept under `steps.reworded` with when and why, so a verdict
 * recorded against it still counts (hashMatches). Without it a re-stamp
 * discards the old hash and every verdict on the rule reads stale - which
 * is right when the rule now asks for something else, and a tax on better
 * English otherwise.
 */
export function runHashCommand(blueprint, { write = false, reword = null } = {}) {
  const rows = [];
  let changedFiles = 0;

  for (const { file } of blueprint.features) {
    const doc = parseDocument(readFileSync(file, 'utf8'));
    const data = doc.toJS();
    let changed = false;

    (data?.stories ?? []).forEach((story, si) => {
      (story?.rules ?? []).forEach((rule, ri) => {
        // A retired rule's steps describe something we stopped meaning; there is
        // no wording left to keep a hash current against.
        if (!rule?.id || !rule?.statement || rule.retired) return;
        const expected = formatHash(rule);
        const stored = rule.steps?.statement_hash;
        let status;
        if (!rule.steps) status = 'no-steps';
        else if (!stored) status = 'missing';
        // A hash of the statement alone still matches (it was the whole hash
        // once) but is not the current form; re-stamped on --write, and the
        // verdicts carrying it stay current the same way.
        else if (stored === expected) status = 'ok';
        else status = hashMatches(stored, rule) ? 'legacy' : 'stale';

        if (write && ['missing', 'stale', 'legacy'].includes(status)) {
          const at = ['stories', si, 'rules', ri, 'steps'];
          /*
           * A legacy hash is kept as well, not only a reworded one. It still
           * names the rule today by matching the statement alone - but the
           * next rewording breaks that, and the verdicts carrying it (every
           * run from before the steps were hashed) would read stale for a
           * change somebody declared harmless. Kept, it rides along.
           */
          const keep = (status === 'stale' && reword) || status === 'legacy';
          if (keep) {
            const kept = (rule.steps.reworded ?? []).map((r) => (typeof r === 'string' ? { hash: r } : r));
            if (!kept.some((r) => r.hash === stored))
              kept.push({
                hash: stored,
                at: isoNow(),
                why: status === 'legacy' ? 'the hash covers the steps now; this one named the statement alone' : reword,
              });
            doc.setIn([...at, 'reworded'], kept);
          }
          doc.setIn([...at, 'statement_hash'], expected);
          status = status === 'stale' && reword ? 'reworded' : 'written';
          changed = true;
        }
        rows.push({ file: relative(blueprint.projectRoot, file), rule: rule.id, status, expected });
      });
    });

    if (changed) {
      writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
      changedFiles++;
    }
  }

  const pending = rows.filter((r) => r.status === 'missing' || r.status === 'stale').length;
  return { rows, changedFiles, exitCode: pending > 0 ? 1 : 0 };
}
