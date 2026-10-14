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
export function runHashCommand(blueprint, { write = false, reword = null, only = null } = {}) {
  const rows = [];
  let changedFiles = 0;
  const named = only?.length ? new Set(only) : null;

  /*
   * A rewording keeps every verdict, so it may not set a tier aside that was
   * not set aside when the rule was last stamped (q-0593). The hash cannot say
   * which tiers those were, so each stamp records them under `steps.excused`;
   * a rule stamped with none recorded excused nothing. Every such rule is
   * named before anything is written, and then nothing is.
   */
  if (write && reword) {
    const refused = [];
    for (const { file } of blueprint.features)
      for (const story of parseDocument(readFileSync(file, 'utf8')).toJS()?.stories ?? [])
        for (const rule of story?.rules ?? []) {
          if (!rule?.id || !rule?.statement || rule.retired || !rule.steps) continue;
          if (named && !named.has(rule.id)) continue;
          if (rule.steps.statement_hash === formatHash(rule)) continue;
          const was = excusedTiers(rule.steps.excused);
          const now = excusedTiers(rule.unverifiable);
          const added = now.filter((t) => !was.includes(t));
          if (added.length)
            refused.push({
              rule: rule.id,
              was,
              added: added.map((tier) => ({ tier, excuse: String(rule.unverifiable[tier]) })),
            });
        }
    if (refused.length) return { rows: [], changedFiles: 0, refused, exitCode: 2 };
  }

  for (const { file } of blueprint.features) {
    const doc = parseDocument(readFileSync(file, 'utf8'));
    const data = doc.toJS();
    let changed = false;

    (data?.stories ?? []).forEach((story, si) => {
      (story?.rules ?? []).forEach((rule, ri) => {
        // A retired rule's steps describe something we stopped meaning; there is
        // no wording left to keep a hash current against.
        if (!rule?.id || !rule?.statement || rule.retired) return;
        // Named rules only, when any are named: the rest stay as they are.
        if (named && !named.has(rule.id)) return;
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
            const kept = (rule.steps.reworded ?? []).map((r) =>
              typeof r === 'string' ? { hash: r } : r,
            );
            if (!kept.some((r) => r.hash === stored))
              kept.push({
                hash: stored,
                at: isoNow(),
                why:
                  status === 'legacy'
                    ? 'the hash covers the steps now; this one named the statement alone'
                    : reword,
              });
            doc.setIn([...at, 'reworded'], kept);
          } else if (status === 'stale' && rule.steps.reworded) doc.deleteIn([...at, 'reworded']);
          /*
           * A plain write over a stale hash says the MEANING moved, so every
           * earlier wording stops naming the rule - not only the one just
           * replaced. The list used to survive it, and a signature from
           * before the change went on counting through an older rewording
           * (found 2026-09-23 on delivery.install.clone-is-the-install and
           * threads.question.one-ask). The history stays in git.
           */
          doc.setIn([...at, 'statement_hash'], expected);
          status = status === 'stale' && reword ? 'reworded' : 'written';
          changed = true;
        }
        // What the stamp excused, so a later rewording can tell an excuse it
        // rewords from one it would add. Filled in on any write, for a rule
        // stamped before it was recorded.
        if (write && rule.steps && status !== 'missing') {
          const now = excusedTiers(rule.unverifiable);
          const recorded = excusedTiers(rule.steps.excused);
          const at = ['stories', si, 'rules', ri, 'steps', 'excused'];
          if (now.join() !== recorded.join()) {
            if (now.length) doc.setIn(at, doc.createNode(now, { flow: true }));
            else doc.deleteIn(at);
            changed = true;
          }
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

/** The tiers a rule's `unverifiable` (or a stamp's `excused`) names, sorted. */
export function excusedTiers(v) {
  if (Array.isArray(v)) return [...v].map(String).sort();
  return v && typeof v === 'object' ? Object.keys(v).sort() : [];
}
