import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectRules, verifyList } from './blueprint.js';
import { extractRuleRefs, runListCommand, scanCheckFiles } from './checks.js';
import { hashMatches } from './hash.js';
import { screenKey } from './screen-match.js';

const EVIDENCE_TYPES = ['checks', 'agent', 'human'];
const QUESTION_STATUSES = ['open', 'answered', 'incorporated', 'waived'];
const NOTE_STATUSES = ['open', 'addressed', 'verified', 'waived'];
const RUN_STATUSES = ['pass', 'fail', 'skipped', 'blocked', 'approved', 'refining'];
const BACKTICK_TOKEN = /`([A-Za-z0-9][A-Za-z0-9._-]*)`/g;

/**
 * Lint a loaded blueprint. Returns findings: { level: 'error'|'warn', category,
 * file, subject, message }. Pass { checks: false } to skip running runner.list.
 */
export function lint(blueprint, { checks = true } = {}) {
  const { dir, projectRoot, config, storyboard, features, threads, runs, problems } = blueprint;
  const findings = [];
  const add = (level, category, file, subject, message) =>
    findings.push({ level, category, file: file ? relative(projectRoot, file) : null, subject, message });

  for (const p of problems) add('error', 'schema', p.file, null, p.message);

  const screens = new Map((storyboard?.screens ?? []).map((s) => [s?.id, s]));
  const declaredAnchors = new Set((storyboard?.screens ?? []).flatMap((s) => s?.anchors ?? []));
  const rules = collectRules(features);
  const ruleIds = new Map();

  // --- features: ids, statements, verify, screens, staleness -----------------
  for (const { file, story, rule } of rules) {
    const id = rule?.id;
    if (!id) {
      add('error', 'schema', file, story?.id, 'rule is missing an id');
      continue;
    }
    if (ruleIds.has(id)) add('error', 'ids', file, id, `duplicate rule id (also in ${ruleIds.get(id)})`);
    ruleIds.set(id, relative(projectRoot, file));
    /*
     * A retired rule is registered and then left alone. Its id must keep
     * resolving, or every run record that ever named it becomes a warning about
     * a rule nobody can look up - but nothing else is asked of it: no coverage,
     * no fresh hash, no screen that still has to exist. It describes something
     * we stopped meaning.
     */
    if (rule.retired) {
      if (typeof rule.retired !== 'string' || !rule.retired.trim())
        add('error', 'schema', file, id, 'retired must say why, in a sentence');
      continue;
    }

    if (!rule.statement) add('error', 'schema', file, id, 'rule is missing a statement');
    if (story?.id && !id.startsWith(`${story.id}.`))
      add('warn', 'ids', file, id, `rule id does not extend its story id "${story.id}."`);

    for (const v of verifyList(rule))
      if (!EVIDENCE_TYPES.includes(v))
        add('error', 'schema', file, id, `unknown verify type "${v}" (expected ${EVIDENCE_TYPES.join('|')})`);

    for (const s of rule.screens ?? [])
      if (!screens.has(s)) add('error', 'storyboard', file, id, `references unknown screen "${s}"`);

    if (rule.statement && rule.steps) {
      const stored = rule.steps.statement_hash;
      if (!stored)
        add('warn', 'stale-steps', file, id, 'steps have no statement_hash (run `walkdown hash --write`)');
      else if (!hashMatches(stored, rule.statement))
        add('error', 'stale-steps', file, id, 'statement_hash does not match the statement — steps are stale');

      for (const phase of ['given', 'when', 'then']) {
        for (const step of rule.steps[phase] ?? []) {
          // An unquoted ": " turns a YAML scalar into a map, and the panel
          // renders that as [object Object] — always an authoring mistake.
          if (typeof step !== 'string') {
            add('error', 'steps', file, id, `a ${phase} step is not a string — an unquoted ": " in YAML parses as a map`);
            continue;
          }
          for (const m of String(step).matchAll(BACKTICK_TOKEN)) {
            const token = m[1];
            if (token.includes('.')) {
              if (declaredAnchors.size && !declaredAnchors.has(token))
                add('warn', 'storyboard', file, id, `step mentions undeclared anchor \`${token}\``);
            } else if (!screens.has(token)) {
              add('warn', 'storyboard', file, id, `step mentions unknown screen \`${token}\``);
            }
          }
        }
      }
    }
  }

  // --- checks: coverage and reverse linkage ---------------------------------
  if (checks && config?.runner?.list) {
    const listed = runListCommand(config, projectRoot);
    if (listed?.error) {
      add('warn', 'coverage', null, 'runner.list', `list command failed: ${listed.error}`);
    } else if (listed) {
      const refs = extractRuleRefs(listed.raw);
      for (const { file, rule } of rules) {
        if (!rule?.id || !rule.statement || rule.retired) continue;
        // A warning, not an error: a blueprint may legitimately run ahead of
        // the build, and status already reports the unrun tier as `never`.
        if (verifyList(rule).includes('checks') && !refs.has(rule.id))
          add('warn', 'coverage', file, rule.id, 'verify includes checks but no check references this rule yet');
      }
      for (const ref of refs)
        if (!ruleIds.has(ref))
          add('error', 'coverage', null, ref, 'a check references this rule id, but no such rule exists');
    }
  }

  // stale check comments: a sha256 near a rule ref that no longer matches
  for (const hit of scanCheckFiles(config, projectRoot)) {
    if (!hit.hash || !ruleIds.has(hit.ruleId)) continue;
    const rule = rules.find((r) => r.rule?.id === hit.ruleId)?.rule;
    if (rule?.statement && !hashMatches(hit.hash, rule.statement))
      add('warn', 'stale-check', hit.file, hit.ruleId,
        `check (line ${hit.line}) was written against an older statement (hash mismatch)`);
  }

  /*
   * Two screens claiming the same address on one surface. Matching is a
   * contest and a tie is skipped (screen-match.js), so the second screen's ref
   * can never win - it is a dead ref that navigates fine and identifies
   * nothing, which is worse than no ref because nothing says so.
   *
   * It is how a state that is not URL-addressable gets written down today: a
   * filtered list or an open drawer is its own screen with no address of its
   * own, so both screens end up spelling the same one. Warned rather than
   * refused, because until `setup` is executable that spelling is the honest
   * one - the warning says which screen loses the tie, not that the blueprint
   * is wrong.
   */
  for (const surface of ['prototype', 'app']) {
    const claimed = new Map();
    for (const s2 of storyboard?.screens ?? []) {
      const key = screenKey(surface === 'prototype' ? s2?.prototype : s2?.app?.path);
      if (!s2?.id || !key) continue;
      const first = claimed.get(key);
      if (first === undefined) { claimed.set(key, s2.id); continue; }
      add('warn', 'storyboard', join(dir, 'storyboard.yml'), s2.id,
        `${surface} ref "${key}" is already claimed by screen \`${first}\` — a tie is never matched, `
        + `so this screen can only be reached by picking it by hand`);
    }
  }

  // --- drift: spec ahead of its sources must be routed, never silent ----------
  const activeThreadScreens = new Set(
    threads
      .filter((t) => !['incorporated', 'verified', 'waived'].includes(t.data?.status))
      .map((t) => t.data?.anchor?.screen)
      .filter(Boolean)
  );
  for (const s of storyboard?.screens ?? []) {
    if (!s?.id || s.prototype) continue;
    if (!activeThreadScreens.has(s.id))
      add('warn', 'drift', join(dir, 'storyboard.yml'), s.id,
        'screen has no design and no open design-request thread — file one (a proposal alone is not a request)');
    if (s.proposal && !existsSync(join(projectRoot, 'proposals', s.proposal.replace(/^\//, ''))))
      add('error', 'drift', join(dir, 'storyboard.yml'), s.id, `proposal file not found: proposals${s.proposal}`);
  }
  for (const { file, rule } of rules) {
    if (rule?.retired) continue;
    const m = typeof rule?.origin === 'string' && rule.origin.match(/^thread:(.+)$/);
    if (m && !threads.some((t) => t.data?.id === m[1]))
      add('warn', 'drift', file, rule.id, `origin references unknown thread "${m[1]}"`);
  }

  // --- threads ---------------------------------------------------------------
  for (const { file, data: t } of threads) {
    const id = t?.id ?? relative(projectRoot, file);
    const statuses = t?.kind === 'question' ? QUESTION_STATUSES : NOTE_STATUSES;
    if (!['question', 'note'].includes(t?.kind))
      add('error', 'threads', file, id, `unknown thread kind "${t?.kind}"`);
    else if (!statuses.includes(t?.status))
      add('error', 'threads', file, id, `invalid status "${t?.status}" for a ${t.kind}`);

    if (t?.status === 'answered')
      add('warn', 'threads', file, id, 'answered but not incorporated — fold the answer into the rule');
    if (t?.status === 'waived' && !t?.waived_by)
      add('error', 'threads', file, id, 'waived without waived_by — waiving requires a person');

    const a = t?.anchor ?? {};
    if (a.rule && !ruleIds.has(a.rule)) add('error', 'threads', file, id, `anchored to unknown rule "${a.rule}"`);
    if (a.screen && !screens.has(a.screen)) add('error', 'threads', file, id, `anchored to unknown screen "${a.screen}"`);
    if (a.element && declaredAnchors.size && !declaredAnchors.has(a.element))
      add('warn', 'threads', file, id, `anchored to undeclared anchor "${a.element}"`);
  }

  // --- runs ------------------------------------------------------------------
  for (const { file, data: run } of runs) {
    const id = run?.run_id ?? relative(projectRoot, file);
    if (!run?.kind || !run?.target || !run?.actor)
      add('warn', 'runs', file, id, 'missing kind, target, or actor');
    for (const result of run?.results ?? []) {
      if (!RUN_STATUSES.includes(result?.status))
        add('error', 'runs', file, id, `invalid result status "${result?.status}" for rule "${result?.rule}"`);
      if (result?.rule && !ruleIds.has(result.rule))
        add('warn', 'runs', file, id, `result references unknown rule "${result.rule}"`);
    }
  }

  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.length - errors;
  return {
    findings,
    summary: {
      errors,
      warnings,
      rules: ruleIds.size,
      screens: screens.size,
      anchors: declaredAnchors.size,
      threads: threads.length,
      runs: runs.length,
    },
    exitCode: errors > 0 ? 1 : 0,
  };
}
