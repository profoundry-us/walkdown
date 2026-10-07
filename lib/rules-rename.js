/*
 * RENAMING A RULE (ADR 0014, n-0355).
 *
 * A rule's id is what every record about it says: run results, thread
 * anchors, the tags on the tests that check it. Changing the id in the
 * feature file alone would leave all of that naming a rule that no longer
 * exists, and every verdict would have to be earned again.
 *
 * So the old id stays on the rule, in `formerly:`, and the readers resolve
 * it (formerIds). Nothing in the ledger is edited. The threads anchored to
 * the rule are the one thing rewritten, because a thread is a conversation
 * about the rule as it is now and its anchor says where it shows.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from '../vendor/yaml.js';
import { resolveLocations } from './locations.js';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const emit = (doc) => doc.toString({ lineWidth: 0, flowCollectionPadding: false });

const featureFiles = (specDir) => {
  const dir = join(specDir, 'features');
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('_'))
        .sort()
        .map((f) => join(dir, f))
    : [];
};

/**
 * What renaming `from` to `to` in the blueprint at `specDir` would change,
 * and why it cannot, if it cannot. Writes nothing.
 *
 * @param {{ specDir: string, from: string, to: string }} ask
 */
export function planRename({ specDir, from, to }) {
  const refusals = [];
  let hit = null;
  const ids = new Map();
  const formers = new Map();
  for (const file of featureFiles(specDir)) {
    const data = parseDocument(readFileSync(file, 'utf8')).toJS() ?? {};
    (data.stories ?? []).forEach((story, si) =>
      (story?.rules ?? []).forEach((rule, ri) => {
        if (!rule?.id) return;
        ids.set(String(rule.id), file);
        for (const old of [rule.formerly ?? []].flat()) formers.set(String(old), String(rule.id));
        if (String(rule.id) === from) hit = { file, si, ri, story, rule };
      }),
    );
  }
  if (!hit) refusals.push(`no rule \`${from}\` in this blueprint`);
  if (!ID.test(to))
    refusals.push(
      `\`${to}\` is not a rule id - lowercase words joined by dashes, in parts joined by dots, such as \`locations.several.new-makes-another\``,
    );
  else if (ids.has(to)) refusals.push(`\`${to}\` is already a rule in this blueprint`);
  else if (formers.has(to) && formers.get(to) !== from)
    refusals.push(`\`${to}\` was an id of \`${formers.get(to)}\`, and an old id names one rule`);
  if (from === to) refusals.push('the new id is the id it already has');

  const threadsDir = resolveLocations({ spec: specDir }).threads.path;
  const threads = [];
  if (threadsDir && existsSync(threadsDir))
    for (const f of readdirSync(threadsDir)
      .filter((x) => /\.ya?ml$/.test(x))
      .sort()) {
      const path = join(threadsDir, f);
      const t = parseDocument(readFileSync(path, 'utf8')).toJS() ?? {};
      if (String(t?.anchor?.rule ?? '') === from) threads.push({ path, id: String(t.id ?? f) });
    }
  return { from, to, specDir, hit, threads, refusals };
}

/** Make the change a plan describes. */
export function applyRename(plan) {
  const { hit, from, to } = plan;
  const doc = parseDocument(readFileSync(hit.file, 'utf8'));
  const at = ['stories', hit.si, 'rules', hit.ri];
  doc.setIn([...at, 'id'], to);
  const kept = [hit.rule.formerly ?? []]
    .flat()
    .map(String)
    .filter((x) => x !== to);
  if (!kept.includes(from)) kept.push(from);
  const node = doc.createNode(kept);
  node.flow = true;
  /*
   * Beside the id, where a reader looking for where a rule went will look.
   * setIn would append it after the steps.
   */
  const rule = doc.getIn(at);
  const existing = rule.items.findIndex((p) => String(p.key?.value ?? p.key) === 'formerly');
  if (existing >= 0) rule.items[existing].value = node;
  else rule.items.splice(1, 0, doc.createPair('formerly', node));
  writeFileSync(hit.file, emit(doc));
  for (const t of plan.threads) {
    const td = parseDocument(readFileSync(t.path, 'utf8'));
    td.setIn(['anchor', 'rule'], to);
    writeFileSync(t.path, emit(td));
  }
}
