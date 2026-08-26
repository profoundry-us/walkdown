import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseDocument } from 'yaml';
import { formatHash, hashMatches } from './hash.js';

/**
 * Report (and with `write`, repair) statement_hash for every rule with steps.
 * Uses the YAML document API so --write only touches the hash scalar and
 * preserves the file's formatting and comments.
 */
export function runHashCommand(blueprint, { write = false } = {}) {
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
        const expected = formatHash(rule.statement);
        const stored = rule.steps?.statement_hash;
        let status;
        if (!rule.steps) status = 'no-steps';
        else if (!stored) status = 'missing';
        else status = hashMatches(stored, rule.statement) ? 'ok' : 'stale';

        if (write && (status === 'missing' || status === 'stale')) {
          doc.setIn(['stories', si, 'rules', ri, 'steps', 'statement_hash'], expected);
          status = 'written';
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
