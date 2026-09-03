import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse } from '../vendor/yaml.js';
import { collectRules, verifyList } from './blueprint.js';
import { extractRuleRefs, runListCommand, scanCheckFiles } from './checks.js';
import { hashMatches } from './hash.js';
import { applyShape, RULE_SHAPE, RUN_SHAPE, THREAD_SHAPE } from './schema.js';
import { canon, expand, walkdownRoot } from './locations.js';
import { screenKey } from './screen-match.js';
import { TERMINAL } from './vocab.js';

const BACKTICK_TOKEN = /`([A-Za-z0-9][A-Za-z0-9._-]*)`/g;

/*
 * Lint is a reader now. What a blueprint may SAY - the fields, their
 * vocabularies, and the exact wording of every complaint - is declared in
 * lib/schema.js, and this file applies those shapes and keeps only what a
 * shape cannot know: the checks that need the whole blueprint in hand.
 * Duplicate ids, statement-hash currency, checks coverage, storyboard claims
 * and drift are relations between documents, not properties of one.
 */

/**
 * Lint a loaded blueprint. Returns findings: { level: 'error'|'warn', category,
 * file, subject, message }. Pass { checks: false } to skip running runner.list.
 */
export function lint(blueprint, { checks = true } = {}) {
  const { dir, projectRoot, config, storyboard, features, threads, runs, problems } = blueprint;
  // Display ids stay spec-relative; anything reaching for CODE - the list
  // command, the check scan - hangs off the code root instead (issue #7).
  const codeRoot = blueprint.codeRoot ?? projectRoot;
  const findings = [];
  /*
   * Shown relative to whichever root actually holds the file. Blueprint files
   * read against the spec, check files against the code, and with the spec
   * out of the repository those are different directories - relativising
   * everything against one of them printed the other as a ladder of `../`
   * that named a real file and helped nobody.
   */
  const display = (file) => {
    if (!file) return null;
    for (const root of [projectRoot, codeRoot])
      if (file === root || file.startsWith(root + '/')) return relative(root, file);
    return file;
  };
  const add = (level, category, file, subject, message) =>
    findings.push({ level, category, file: display(file), subject, message });

  for (const p of problems) add('error', 'schema', p.file, null, p.message);

  /*
   * The committed config that answered, read for the one shape a person can
   * write that no writer here will: an entry whose spec lies under ANOTHER
   * `.walkdown`. That directory already answers for it; a second declaration
   * from above is the boundary crossing one-walkdown-answers forbids, by
   * hand (q-0168). Named with both files so the reader knows which to edit.
   */
  const wd = blueprint.at?.walkdown?.path;
  const cfgFile = wd ? join(wd, 'config.yml') : null;
  if (cfgFile && existsSync(cfgFile)) {
    let entries = [];
    try {
      entries = parse(readFileSync(cfgFile, 'utf8'))?.projects ?? [];
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e?.spec) continue;
      const spec = expand(String(e.spec), dirname(wd));
      const theirs = walkdownRoot(dirname(spec));
      if (theirs && canon(theirs) !== canon(wd))
        add(
          'error',
          'locations',
          cfgFile,
          String(e.id ?? e.spec),
          `\`${e.id ?? '?'}\` declares spec ${e.spec}, which lies under ${theirs} — that .walkdown answers for it; declare it there, or list a copy with \`walkdown project add --ephemeral\``,
        );
    }
  }

  const screens = new Map((storyboard?.screens ?? []).map((s) => [s?.id, s]));
  const declaredAnchors = new Set((storyboard?.screens ?? []).flatMap((s) => s?.anchors ?? []));
  const rules = collectRules(features);
  const ruleIds = new Map();
  const registries = { screens, anchors: declaredAnchors, rules: ruleIds };

  // --- features: shape, then currency and step references --------------------
  for (const { file, story, rule } of rules) {
    const id = rule?.id;
    if (!id) {
      add('error', 'schema', file, story?.id, 'rule is missing an id');
      continue;
    }
    if (ruleIds.has(id))
      add('error', 'ids', file, id, `duplicate rule id (also in ${ruleIds.get(id)})`);
    ruleIds.set(id, relative(projectRoot, file));

    const { halted } = applyShape(rule, RULE_SHAPE, { story: story?.id, registries }, (l, c, m) =>
      add(l, c, file, id, m),
    );
    if (halted) continue; // retired: registered, then left alone

    /*
     * Currency, not shape: whether the steps still describe THIS statement is
     * a relation between two fields and the hash that pinned them together.
     */
    if (rule.statement && rule.steps) {
      const stored = rule.steps.statement_hash;
      if (!stored)
        add(
          'warn',
          'stale-steps',
          file,
          id,
          'steps have no statement_hash (run `walkdown hash --write`)',
        );
      else if (!hashMatches(stored, rule.statement))
        add(
          'error',
          'stale-steps',
          file,
          id,
          'statement_hash does not match the statement — steps are stale',
        );

      for (const phase of ['given', 'when', 'then']) {
        for (const step of rule.steps[phase] ?? []) {
          // An unquoted ": " turns a YAML scalar into a map, and the panel
          // renders that as [object Object] — always an authoring mistake.
          if (typeof step !== 'string') {
            add(
              'error',
              'steps',
              file,
              id,
              `a ${phase} step is not a string — an unquoted ": " in YAML parses as a map`,
            );
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
    const listed = runListCommand(config, codeRoot);
    if (listed?.error) {
      add('warn', 'coverage', null, 'runner.list', `list command failed: ${listed.error}`);
    } else if (listed) {
      const refs = extractRuleRefs(listed.raw);
      for (const { file, rule } of rules) {
        if (!rule?.id || !rule.statement || rule.retired) continue;
        // A warning, not an error: a blueprint may legitimately run ahead of
        // the build, and status already reports the unrun tier as `never`.
        if (verifyList(rule).includes('checks') && !refs.has(rule.id))
          add(
            'warn',
            'coverage',
            file,
            rule.id,
            'verify includes checks but no check references this rule yet',
          );
      }
      for (const ref of refs)
        if (!ruleIds.has(ref))
          add(
            'error',
            'coverage',
            null,
            ref,
            'a check references this rule id, but no such rule exists',
          );
    }
  }

  // stale check comments: a sha256 near a rule ref that no longer matches
  for (const hit of scanCheckFiles(config, codeRoot)) {
    if (!hit.hash || !ruleIds.has(hit.ruleId)) continue;
    const rule = rules.find((r) => r.rule?.id === hit.ruleId)?.rule;
    if (rule?.statement && !hashMatches(hit.hash, rule.statement))
      add(
        'warn',
        'stale-check',
        hit.file,
        hit.ruleId,
        `check (line ${hit.line}) was written against an older statement (hash mismatch)`,
      );
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
      if (first === undefined) {
        claimed.set(key, s2.id);
        continue;
      }
      add(
        'warn',
        'storyboard',
        join(dir, 'storyboard.yml'),
        s2.id,
        `${surface} ref "${key}" is already claimed by screen \`${first}\` — a tie is never matched, ` +
          `so this screen can only be reached by picking it by hand`,
      );
    }
  }

  // --- drift: spec ahead of its sources must be routed, never silent ----------
  const activeThreadScreens = new Set(
    threads
      .filter((t) => !TERMINAL.includes(t.data?.status))
      .map((t) => t.data?.anchor?.screen)
      .filter(Boolean),
  );
  for (const s of storyboard?.screens ?? []) {
    if (!s?.id || s.prototype || s.retired) continue;
    if (!activeThreadScreens.has(s.id))
      add(
        'warn',
        'drift',
        join(dir, 'storyboard.yml'),
        s.id,
        'screen has no design and no open design-request thread — file one (a proposal alone is not a request)',
      );
    if (s.proposal && !existsSync(join(codeRoot, 'proposals', s.proposal.replace(/^\//, ''))))
      add(
        'error',
        'drift',
        join(dir, 'storyboard.yml'),
        s.id,
        `proposal file not found: proposals${s.proposal}`,
      );
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
    applyShape(t ?? {}, THREAD_SHAPE, { registries }, (l, c, m) => add(l, c, file, id, m));
  }

  // --- runs ------------------------------------------------------------------
  for (const { file, data: run } of runs) {
    const id = run?.run_id ?? relative(projectRoot, file);
    applyShape(run ?? {}, RUN_SHAPE, { registries }, (l, c, m) => add(l, c, file, id, m));
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
