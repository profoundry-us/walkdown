#!/usr/bin/env node
/*
 * ADR 0005, Migration: one pass, run once, that says why every existing note
 * exists and closes the findings a person's signed pass already looked at.
 *
 *   node tools/migrate-reasons.mjs            # what it would do
 *   node tools/migrate-reasons.mjs --write    # do it, and record the run
 *
 * Classification, in the ADR's order and no other: a note cited by a run
 * result is a `finding`; a machine's note (authored agent, or via agent) not
 * cited is an `observation`, unless its body opens with "Decision" or it is a
 * rule's `origin:` and carries no fix, in which case it is a `decision`; a
 * note anchored to a screen with no rule is a `request`; a person's note with
 * no via is `feedback`. Then §2 against the ledger as it stands: a finding at
 * `addressed` whose rule has a signed human pass recorded after the fix was
 * claimed closes now, `via: verdict <run>`, under the signer's name - the
 * same writer a walkdown's Finish uses, so the record is the same record.
 *
 * Nothing is deleted or rewritten: a thread gains `reason` (and a decision at
 * `open`/`addressed` goes to `recorded`, which is what a decision is filed
 * as), a closed finding gains its verdict reply, and the run says which.
 * Questions carry no reason and are not touched. A thread that already has a
 * reason is left alone, so the pass is safe to run twice - and the second run
 * writes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { collectRules, loadBlueprint } from '../lib/blueprint.js';
import { defaultActor } from '../lib/identity.js';
import { resolveLocations } from '../lib/locations.js';
import { writeRunRecord } from '../lib/run-record.js';
import { closeByVerdict } from '../lib/threads.js';
import { closesOnVerdict, isMachineName } from '../lib/vocab.js';
import { parse, stringify } from '../vendor/yaml.js';

const write = process.argv.includes('--write');
const cwd = process.cwd();
const at = resolveLocations({ cwd });
const bp = loadBlueprint(at.spec.path, { cwd });

// Every thread a run result cites, with the rule and the run that cited it.
const cited = new Map();
for (const { data: run } of bp.runs)
  for (const res of run?.results ?? [])
    for (const id of res?.threads ?? []) (cited.get(id) ?? cited.set(id, []).get(id)).push({ rule: res.rule, run: run.run_id });
// Every thread a rule names as where it came from.
const origins = new Set();
for (const { rule } of collectRules(bp.features))
  if (typeof rule?.origin === 'string' && rule.origin.startsWith('thread:')) origins.add(rule.origin.slice('thread:'.length));

const machine = (t) => isMachineName(t.author) || Boolean(t.via);
/*
 * Three readings of the body the ADR's rules assume and this ledger's habits
 * make explicit. A decision opens with the word, or says "Decision (" in its
 * first breath ("Why numbered homes came back. Decision (2026-09-02, Topher):
 * ..."), or is "Direction, set by ...". A design request has always said so
 * in its first words. And a person's note an agent typed opens with the
 * person's name and the date ("Topher, 2026-09-13, on reviewing ...") - that
 * is dictation, which is what `via` was for, and it is their feedback, not
 * the machine's observation.
 */
const opensAsDecision = (t) => /^\s*(decision\b|direction,)/i.test(t.body ?? '') || /^[\s\S]{0,160}\bDecision \(/.test(t.body ?? '');
const opensAsRequest = (t) => /^\s*design request\b/i.test(t.body ?? '');
const dictated = (t) =>
  Boolean(t.via) && !isMachineName(t.author) && new RegExp(`^[\\s\\S]{0,20}\\b${String(t.author).split(/\s/)[0]}\\b`, 'i').test(t.body ?? '');
// "Carries no fix": nothing in the thread claims work - it was never at
// addressed, and no reply says anything was done.
const carriesNoFix = (t) => t.status === 'open' && !(t.replies ?? []).length;

function classify(t) {
  if (cited.has(t.id)) return 'finding';
  if (opensAsDecision(t)) return 'decision';
  if (opensAsRequest(t) || (t.anchor?.screen && !t.anchor?.rule)) return 'request';
  if (machine(t) && origins.has(t.id) && carriesNoFix(t)) return 'decision';
  if (machine(t) && !dictated(t)) return 'observation';
  return 'feedback';
}

const classified = [];
const buckets = { finding: [], observation: [], decision: [], request: [], feedback: [], skipped: [] };
for (const { file, data: t } of bp.threads) {
  if (t?.kind !== 'note') continue;
  if (t.reason) {
    buckets.skipped.push(t.id);
    continue;
  }
  const reason = classify(t);
  buckets[reason].push(t.id);
  classified.push({ file, t, reason });
}

// §2: the signed human passes on each rule, newest first, as the ledger has them.
const passes = [];
for (const { data: run } of bp.runs) {
  if (run?.kind !== 'walkdown' || isMachineName(run.actor) || !run.created) continue;
  const signed = Array.isArray(run.signatures)
    ? run.signatures.filter((s) => s?.role).map((s) => String(s.signer ?? run.actor))
    : (run.roles ?? []).filter(Boolean).map(() => String(run.actor));
  if (!signed.length) continue;
  for (const res of run.results ?? [])
    if (res?.status === 'pass' && res.rule) passes.push({ rule: res.rule, signer: signed[0], runId: run.run_id, created: run.created });
}
passes.sort((a, b) => a.created.localeCompare(b.created));

console.log(`${bp.threads.length} threads; ${classified.length} notes to classify, ${buckets.skipped.length} already say why.`);
for (const k of ['finding', 'feedback', 'observation', 'request', 'decision'])
  console.log(`  ${k.padEnd(12)} ${String(buckets[k].length).padStart(4)}  ${buckets[k].join(' ')}`);

if (!write) {
  // Say what §2 would close, without touching the files: the same walk the
  // write takes, read-only.
  const would = [];
  for (const { t, reason } of classified) {
    // The same test the writer applies: a finding, or a person's own
    // feedback, that was answered before a signed pass on its rule (§2, §3).
    if (t.status !== 'addressed' || !closesOnVerdict({ ...t, reason })) continue;
    const claimed = (t.replies ?? []).map((r) => r?.created).filter(Boolean).sort().at(-1) ?? t.created;
    const secs = (iso) => Math.floor(Date.parse(iso) / 1000);
    const pass = passes.find((p) => p.rule === t.anchor?.rule && secs(claimed) <= secs(p.created));
    if (pass) would.push(`${t.id} (${pass.signer}, ${pass.runId})`);
  }
  console.log(`\nWould close ${would.length} addressed finding(s)/feedback on a later signed pass:\n  ${would.join('\n  ')}`);
  console.log('\nDry run. Pass --write to apply and record the run.');
  process.exit(0);
}

// Write the reasons. A decision is filed closed; one already terminal keeps
// the ending it has.
const recorded = [];
for (const { file, t, reason } of classified) {
  const fresh = parse(readFileSync(file, 'utf8'));
  fresh.reason = reason;
  if (reason === 'decision' && ['open', 'addressed'].includes(fresh.status)) {
    fresh.status = 'recorded';
    recorded.push(t.id);
  }
  writeFileSync(file, stringify(fresh));
  t.reason = reason;
  t.status = fresh.status;
}

// §2, through the one writer that closes on a verdict. Oldest pass first so a
// finding closes under the FIRST look that accepted it, the way it would
// have had this been running then.
const closed = [];
for (const p of passes) {
  const ids = closeByVerdict(bp, { rule: p.rule, signer: p.signer, runId: p.runId, created: p.created });
  for (const id of ids) closed.push({ id, rule: p.rule, run: p.runId, signer: p.signer });
}

const who = defaultActor().username ?? 'unknown';
const { record } = writeRunRecord({
  blueprintDir: at.spec.path,
  cwd,
  target: 'local',
  baseUrl: null,
  actor: who,
  kind: 'migration',
  results: [],
});
// The run writer keeps its record shape; the migration's own account rides
// beside it under keys nothing else reads.
const file = `${at.runs.path}/${record.run_id}.json`;
const full = JSON.parse(readFileSync(file, 'utf8'));
full.why = 'ADR 0005 migration: every note says why it exists; findings a signed pass already looked at close under that pass.';
full.classified = Object.fromEntries(['finding', 'feedback', 'observation', 'request', 'decision'].map((k) => [k, buckets[k]]));
full.recorded = recorded;
full.closed = closed;
writeFileSync(file, JSON.stringify(full, null, 2) + '\n');

console.log(`\nWrote reasons on ${classified.length} notes; ${recorded.length} decision(s) filed as recorded.`);
console.log(`Closed ${closed.length} finding(s)/feedback on signed passes:`);
for (const c of closed) console.log(`  ${c.id} — ${c.rule}, ${c.signer}, ${c.run}`);
console.log(`Recorded as ${record.run_id}.`);
