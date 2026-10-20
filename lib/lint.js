import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parse } from '../vendor/yaml.js';
import { anchorId } from './anchor-id.js';
import {
  collectRules,
  formerIds,
  loadBlueprint,
  proposalsDir,
  prototypeDir,
  verifyList,
} from './blueprint.js';
import { extractRuleRefs, runListCommand, scanCheckFiles } from './checks.js';
import { hashMatches } from './hash.js';
import {
  blueprintFlag,
  blueprintNameFlag,
  canon,
  escapingLinks,
  expand,
  KINDS,
  SPEC_FILE,
  within,
} from './locations.js';
import { siblingsOf, threadIdsIn } from './project.js';
import { applyShape, RULE_SHAPE, RUN_SHAPE, THREAD_SHAPE } from './schema.js';
import { screenKey } from './screen-match.js';
import { tracking } from './standard.js';
import { labelClashes } from './threads.js';
import { DESIGNERS, isLiveRequest } from './vocab.js';
import { voiceFindings } from './voice.js';

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
  // Every command a finding names writes into this blueprint, so it names it.
  const bp = blueprintFlag(blueprint.dir);
  /*
   * The other blueprints in this one's project, read once and only when a
   * check needs them: their rule ids and their thread ids.
   */
  let sibling = null;
  const project = () => {
    if (sibling) return sibling;
    sibling = { rules: new Set(), threads: new Set(), screens: new Set() };
    for (const s of siblingsOf(blueprint.dir)) {
      try {
        const b = loadBlueprint(s.dir);
        for (const { rule } of collectRules(b.features)) if (rule?.id) sibling.rules.add(rule.id);
        // And the ids its rules used to have, which the shared ledger still names.
        for (const old of formerIds(b.features).keys()) sibling.rules.add(old);
        for (const sc of b.storyboard?.screens ?? [])
          if (sc?.id) sibling.screens.add(String(sc.id));
      } catch {
        // A sibling that will not load is its own lint's to report.
      }
      for (const id of threadIdsIn(s.threads)) sibling.threads.add(id);
    }
    return sibling;
  };
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
   * What git sees, set against what the tree promises. A rule hiding the
   * spec, a root `.gitignore` swallowing `.walkdown/`, an ignore file that
   * keeps nothing out, a promise the rule does not keep for a home standing
   * elsewhere - each is a project that is not set up the way it says, and
   * lint is where that has to be loud (n-0179, n-0180, n-0181). Asked only
   * of a declared project inside a git repository; anything else has no
   * promise to break.
   */
  /*
   * And the layout itself. Every blueprint walkdown answers for lives in a
   * home - one folder, spec.yml in it, with threads, runs, evidence and
   * drafts beside (ADR 0014 §5) - and its row names that home. A row that
   * does not is one walkdown did not write, and this is the flag a person
   * needs before their agent goes looking for records no path leads to.
   */
  if (blueprint.at?.blueprint) {
    const at = blueprint.at;
    const cfg = at.config.registry?.path ?? at.config.path;
    if (at.spec.path && !existsSync(join(at.spec.path, SPEC_FILE)))
      add(
        'error',
        'locations',
        cfg,
        at.id,
        `\`${at.id}\`'s home ${at.spec.path} holds no ${SPEC_FILE} — every blueprint lives in one folder with its spec.yml in it: \`walkdown blueprints new\` lays one out, \`walkdown upgrade\` flattens an old one.`,
      );
    /*
     * A home kept on this machine whose folder name a teammate has since
     * committed: `blueprints commit` would refuse it, and the moment to hear
     * that is before anybody tries (ADR 0014 §7).
     */
    const checkout = at.blueprint?.checkout ? canon(expand(String(at.blueprint.checkout))) : null;
    if (checkout && at.homeDir && !within(canon(at.homeDir), checkout)) {
      const there = join(checkout, '.walkdown', 'blueprints', basename(at.homeDir));
      if (existsSync(there))
        add(
          'warn',
          'locations',
          cfg,
          at.id,
          `\`${at.id}\` is kept in ${at.homeDir}, and ${there} is already committed under the same folder name — \`blueprints commit\` would refuse it. \`walkdown blueprints rename ${at.id} <name> --folder <folder>\` gives it another.`,
        );
    }
    for (const kind of KINDS)
      if (!at[kind]?.path)
        add(
          'error',
          'locations',
          cfg,
          at.id,
          `\`${at.id}\` has nowhere to keep ${kind} — ${at[kind]?.why ?? 'the entry names no path and no home'}.`,
        );
    /*
     * A line in the personal config that the resolver set aside because of
     * THIS blueprint - a default that would have filed its records beside
     * its home (#18). Said here as well as in `where`, because lint is what
     * an agent runs, and "0 threads" over nine it had just written is the
     * failure that went unnoticed.
     */
    for (const ig of at.config.ignored ?? [])
      if (String(ig.key).startsWith('defaults.') && ig.id === at.blueprint?.id)
        add(
          'warn',
          'locations',
          at.config.path,
          at.id,
          `profile.yml's \`${ig.key}: ${ig.value}\` is not used — it ${ig.why}.`,
        );
  }
  /*
   * And the doors out of it. A symlink under the home whose target sits
   * outside is a path walkdown's writers will write through, so scaffolding
   * this blueprint edits a file nobody named - which is how `init --force`
   * once truncated lib/templates/AGENTS.md through the link that was
   * blueprint/AGENTS.md, with every other check still green. A warning, not
   * an error: linking outward can be deliberate, and the reader is the one
   * who knows.
   */
  const wd = blueprint.at?.homeDir ?? null;
  if (wd)
    for (const link of escapingLinks(wd))
      add(
        'warn',
        'locations',
        link.path,
        null,
        `symlink to \`${link.target}\`, which resolves outside the home (${link.resolved}) — walkdown writes through it, so scaffolding this blueprint edits that file instead. Replace it with a copy, or point it inside the home.`,
      );

  if (blueprint.at?.blueprint)
    for (const f of tracking(blueprint.at).findings)
      add(
        f.level,
        'tracking',
        blueprint.at.walkdown?.path ? join(blueprint.at.walkdown.path, '.gitignore') : null,
        null,
        f.message,
      );

  const screens = new Map((storyboard?.screens ?? []).map((s) => [s?.id, s]));
  const declaredAnchors = new Set((storyboard?.screens ?? []).flatMap((s) => s?.anchors ?? []));
  const rules = collectRules(features);
  const ruleIds = new Map();
  const registries = { screens, anchors: declaredAnchors, rules: ruleIds };
  let both = null;
  const projectRegistries = () => {
    if (both) return both;
    const sib = project();
    if (!sib.rules.size && !sib.screens.size) return (both = registries);
    // Each registry keeps its own shape - a Map stays a Map - with the
    // siblings' ids added; the shape checks only ever ask `.has`.
    const plus = (reg, ids) => {
      const out = reg instanceof Map ? new Map(reg) : new Set(reg);
      for (const id of ids)
        if (!out.has(id))
          out instanceof Map ? out.set(id, /** @type {any} */ ({ id })) : out.add(id);
      return out;
    };
    return (both = {
      ...registries,
      screens: plus(screens, sib.screens),
      rules: plus(ruleIds, sib.rules),
    });
  };
  const retiredIds = new Set(rules.filter((r) => r.rule?.retired).map((r) => r.rule.id));
  // Ids a rule used to have (`walkdown rules rename`), old -> new.
  const was = formerIds(features);
  const now = (id) => was.get(String(id)) ?? id;
  // Open and answered wait on an agent. An addressed thread waits on the
  // person, and the panel's Threads view already lists those it cannot walk to.
  const OPEN_ON = new Set(['open', 'answered']);

  /*
   * A former id resolves to its rule, so a record or a thread that still
   * names it is not a reference to nothing. One that is also a live id, or
   * a former id of two rules, would mean two things at once.
   */
  const formerSeen = new Map();
  for (const { file, rule } of rules)
    for (const old_ of [rule?.formerly ?? []].flat().map(String)) {
      if (rules.some((r) => String(r.rule?.id) === old_))
        add(
          'error',
          'ids',
          file,
          rule.id,
          `former id \`${old_}\` is also the id of a rule - an old id names one rule or none`,
        );
      else if (formerSeen.has(old_))
        add(
          'error',
          'ids',
          file,
          rule.id,
          `former id \`${old_}\` is also a former id of ${formerSeen.get(old_)}`,
        );
      formerSeen.set(old_, rule.id);
    }

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
    /*
     * The statement is the claim; the reason lives in `because` and what
     * happened in `history`, neither of which is hashed. A "because" inside
     * the statement is rationale that will stale every verdict the next time
     * somebody improves its English (2026-09-13).
     */
    if (rule.statement && /\b(because|so that)\b/i.test(String(rule.statement)))
      add(
        'warn',
        'statement-carries-why',
        file,
        id,
        'the statement argues for itself — move the reason to `because:` (and what happened to `history:`); the statement is the claim alone',
      );
    /*
     * The statement is the goal in a breath, read by product and design as
     * much as by whoever builds it. Past forty-five words or three sentences
     * it has started restating its own steps, or arguing, or narrating -
     * the shape every voice problem arrives in (ADR 0004). The median here is
     * thirty-one. And a `because` past thirty-five words is usually carrying
     * what happened - a date, a count, a past tense - which is `history`.
     */
    const words = (s) =>
      String(s ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
    const sentences = (s) => (String(s ?? '').match(/[.!?](\s|$)/g) ?? []).length;
    if (rule.statement && (words(rule.statement) > 45 || sentences(rule.statement) >= 3))
      add(
        'warn',
        'statement-reads-as-a-paragraph',
        file,
        id,
        `the statement is ${words(rule.statement)} words in ${sentences(rule.statement) || 1} sentence(s) — say the goal in one breath and let the steps carry the rest`,
      );
    if (rule.because && words(rule.because) > 35)
      add(
        'warn',
        'because-carries-history',
        file,
        id,
        `the because is ${words(rule.because)} words — a reason is timeless; what happened, with its date or count, belongs in \`history:\``,
      );
    /*
     * The voice, field by field (docs/13-voice.md, n-0323): the faults that
     * keep a sentence from reading to a stranger, each named with what to
     * do instead. Warnings, like the two above - a person decides.
     */
    const thenSteps = Array.isArray(rule.steps?.then) ? rule.steps.then.map(String) : [];
    const voiced = [
      ['statement', rule.statement, { field: 'statement', steps: thenSteps }],
      ['because', rule.because, { field: 'because' }],
      ['history', rule.history, { field: 'history' }],
      ...['given', 'when', 'then'].flatMap((phase) =>
        (Array.isArray(rule.steps?.[phase]) ? rule.steps[phase] : [])
          .filter((st) => typeof st === 'string')
          .map((st) => [`${phase} step`, st, { field: 'step' }]),
      ),
    ];
    for (const [what, text, opts] of voiced)
      for (const f of voiceFindings(text, opts))
        add('warn', 'voice', file, id, `${what}: ${f.message}`);
    /*
     * Where opening the rule takes the panel (ADR 0016). It has to be an
     * anchor one of the rule's screens declares: a focus nothing carries
     * would open the rule at the top while claiming to open at an element.
     */
    if (rule.focus != null) {
      const own = (Array.isArray(rule.screens) ? rule.screens : [])
        .map((sid) => screens.get(sid))
        .filter(Boolean);
      const anchors = [...new Set(own.flatMap((s) => s?.anchors ?? []))];
      // A screen id nobody declared is already its own error, which says
      // what to fix; saying the rule names no screen as well would mislead.
      const typo = !own.length && Array.isArray(rule.screens) && rule.screens.length;
      if (!typo && !anchors.includes(rule.focus)) {
        const either = (xs) =>
          xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`;
        const names = own.map((s) => s.id);
        const shown = anchors.slice(0, 5).join(', ');
        const more = anchors.length > 5 ? ` and ${anchors.length - 5} more` : '';
        add(
          'error',
          'storyboard',
          file,
          id,
          !names.length
            ? `focus \`${rule.focus}\` is set, but the rule names no screen — add the screen it is on to \`screens\``
            : `focus \`${rule.focus}\` is not an anchor on its ${names.length === 1 ? 'screen' : 'screens'}, ${either(names)} — declare it on ${names.length === 1 ? names[0] : 'one of them'} in the storyboard${anchors.length ? `, or point focus at an anchor ${names.length === 1 ? 'it declares' : 'they declare'}: ${shown}${more}` : ''}`,
        );
      }
    }
    if (rule.statement && rule.steps) {
      const stored = rule.steps.statement_hash;
      if (!stored)
        add(
          'warn',
          'stale-steps',
          file,
          id,
          `steps have no statement_hash (run \`walkdown hash --write${bp}\`)`,
        );
      else if (!hashMatches(stored, rule))
        add(
          'error',
          'stale-steps',
          file,
          id,
          `statement_hash does not match the statement and steps — the wording moved; \`walkdown hash --write${bp}\` re-stamps it (add \`--reword "<why>"\` if the meaning did not change, and verdicts stay current)`,
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
            /*
             * Declared is declared, dot or no dot: an anchor named
             * `level-icon-organization` is as much an anchor as `home.cta`,
             * and the panel already highlights it as one (#6). The dot only
             * guesses which of the two a token NOBODY declared meant to be.
             */
            if (declaredAnchors.has(token) || screens.has(token)) continue;
            if (token.includes('.')) {
              if (declaredAnchors.size)
                add('warn', 'storyboard', file, id, `step mentions undeclared anchor \`${token}\``);
            } else {
              add('warn', 'storyboard', file, id, `step mentions unknown screen \`${token}\``);
            }
          }
        }
      }
    }
  }

  // --- checks: coverage and reverse linkage ---------------------------------
  /*
   * What the suite claims: the framework's own list when the blueprint names
   * one, and otherwise the rule tags written in the files under
   * authoring.location - the scan this lint makes below anyway. The scaffold
   * used to name Playwright's lister, which costs over a second a lint in a
   * project with no Playwright, so a cheap read is the default and a
   * framework's lister is for tags the files cannot show.
   */
  for (const [old_, id] of was) if (!ruleIds.has(old_)) ruleIds.set(old_, `formerly, now ${id}`);
  const listed = !checks
    ? null
    : config?.runner?.list
      ? runListCommand(config, codeRoot)
      : config?.authoring?.location
        ? {
            error: null,
            raw: scanCheckFiles(config, codeRoot)
              .map((h) => `@rule:${h.ruleId}`)
              .join('\n'),
          }
        : null;
  if (listed) {
    if (listed.error) {
      add('warn', 'coverage', null, 'runner.list', `list command failed: ${listed.error}`);
    } else {
      const refs = extractRuleRefs(listed.raw);
      for (const { file, rule } of rules) {
        if (!rule?.id || !rule.statement || rule.retired) continue;
        // A warning, not an error: a blueprint may legitimately run ahead of
        // the build, and status already reports the unrun tier as `never`.
        if (
          verifyList(rule).includes('checks') &&
          !refs.has(rule.id) &&
          ![rule.formerly ?? []].flat().some((o) => refs.has(String(o)))
        )
          add(
            'warn',
            'coverage',
            file,
            rule.id,
            'verify includes checks but no check references this rule yet',
          );
      }
      /*
       * A project's blueprints share its test suite (ADR 0013 §2): a check
       * tagged with a sibling's rule is the sibling's, not a missing rule.
       */
      const siblingRules = project().rules;
      for (const ref of refs)
        if (was.has(ref))
          add(
            'warn',
            'renamed',
            null,
            ref,
            `a check is tagged with \`${ref}\`, which was renamed - tag it \`${was.get(ref)}\``,
          );
        else if (!ruleIds.has(ref) && !siblingRules.has(ref))
          add(
            'error',
            'coverage',
            null,
            ref,
            'a check references this rule id, but no such rule exists',
          );
    }
  }

  /*
   * A check that counts for nothing, two ways (2026-09-16: two rules were
   * built and checked and still read as unbuilt, so the panel offered
   * "approve the wording" where Pass/Fail was due, and the person approved
   * and then had to come back).
   *
   * One: a check is tagged with a rule that never asked for the checks tier.
   * The tier is opt-in per rule, so the check runs, passes, and fills no
   * cell. An error - nobody writes a check for a rule and means it to be
   * ignored. Two: the tier is asked for and the check exists, and the
   * ledger holds no checks run for the rule at all - the suite was only
   * ever run unrecorded. A warning - the build is there, the record is not.
   */
  const written = scanCheckFiles(config, codeRoot);
  const checkedIds = new Set(written.map((h) => now(h.ruleId)));
  const recorded = new Set(
    (blueprint.runs ?? [])
      .map((r) => r.data)
      .filter((r) => r?.kind === 'checks')
      .flatMap((r) => (r.results ?? []).map((x) => x?.rule))
      .filter(Boolean)
      .map(now),
  );
  for (const { file, rule } of rules) {
    if (!rule?.id || rule.retired || !checkedIds.has(rule.id)) continue;
    const where = written.find((h) => now(h.ruleId) === rule.id);
    if (!verifyList(rule).includes('checks'))
      add(
        'error',
        'coverage',
        file,
        rule.id,
        `a check references this rule (${display(where.file)}:${where.line}) but the rule does not ask for the checks tier - the check fills no cell until \`verify: [checks]\` is on it`,
      );
    else if (!recorded.has(rule.id))
      add(
        'warn',
        'coverage',
        file,
        rule.id,
        'checked but never recorded - the ledger holds no checks run for this rule, so it reads as unbuilt and asks for an approval where a pass is due; a recorded run of the suite fills the cell',
      );
  }

  // stale check comments: a sha256 near a rule ref that no longer matches
  for (const hit of written) {
    if (!hit.hash || !ruleIds.has(hit.ruleId)) continue;
    const rule = rules.find((r) => r.rule?.id === hit.ruleId)?.rule;
    if (rule?.statement && !hashMatches(hit.hash, rule))
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
        `${surface === 'prototype' ? 'design' : surface} ref "${key}" is already claimed by screen \`${first}\` — a tie is never matched, ` +
          `so this screen can only be reached by picking it by hand`,
      );
    }
  }

  // --- drift: spec ahead of its sources must be routed, never silent ----------
  // A design request, and only one: any other note on the screen is queued
  // for the agent, where design never sees it (ADR 0009 §3).
  const activeThreadScreens = new Set(
    threads
      .filter((t) => isLiveRequest(t.data))
      .map((t) => t.data?.anchor?.screen)
      .filter(Boolean),
  );
  const by = config?.design?.by;
  if (by !== undefined && !DESIGNERS.includes(by))
    add(
      'error',
      'config',
      join(dir, SPEC_FILE),
      'design.by',
      `design.by is "${by}" — it is \`person\` or \`agent\`, and a person draws when it says nothing`,
    );
  /*
   * A person accepted a later version than the storyboard names (ADR 0015
   * §8). The record already reads it as accepted; the pointer should say so
   * too, because the storyboard is what a person reads.
   */
  for (const s of storyboard?.screens ?? [])
    if (s?.id && s.behind !== undefined)
      add(
        'warn',
        'storyboard',
        join(dir, 'storyboard.yml'),
        s.id,
        `a design request accepted ${s.prototype}, and the storyboard still names ${s.behind ?? 'no design'} — point \`design:\` at ${s.prototype}`,
      );
  for (const s of storyboard?.screens ?? []) {
    if (!s?.id || s.prototype || s.retired) continue;
    if (!activeThreadScreens.has(s.id))
      add(
        'warn',
        'drift',
        join(dir, 'storyboard.yml'),
        s.id,
        `screen has no design and no open design request — file one with \`walkdown threads new --screen <id>${bp}\` (a proposed version counts only once a request's \`proposes:\` names it)`,
      );
    if (s.proposal && !existsSync(join(proposalsDir(blueprint), s.proposal.replace(/^\//, ''))))
      add(
        'error',
        'drift',
        join(dir, 'storyboard.yml'),
        s.id,
        `the retired \`proposal:\` names ${join(proposalsDir(blueprint), s.proposal.replace(/^\//, ''))}, and nothing is there — drop the key, and name a proposed version with a design request's \`proposes:\``,
      );
  }
  /*
   * A live request's version is a file the panel opens from the design root
   * (`/prototype<proposes>`, as readDesigns names it). Moved away, the walk
   * shows "not found" beside the rules and lint said nothing (n-0592,
   * 2026-10-19). Resolved here exactly as the server resolves it, so the two
   * cannot disagree about where it is.
   */
  const designAt = prototypeDir(blueprint);
  // By the name the fix is run with, in the project lint is read in.
  const byName = blueprintNameFlag(blueprint.dir);
  const byId = (a, b) =>
    String(a.data?.id).localeCompare(String(b.data?.id), 'en', { numeric: true });
  for (const { file, data: t } of [...threads].sort(byId)) {
    if (!isLiveRequest(t) || typeof t.proposes !== 'string' || !t.proposes.trim()) continue;
    const ref = t.proposes.startsWith('/') ? t.proposes : `/${t.proposes}`;
    const at = designAt && join(designAt, `.${ref}`);
    if (at && existsSync(at)) continue;
    add(
      'error',
      'threads',
      file,
      t.id,
      at
        ? `proposes ${ref}, and nothing is at ${at}, so the walk would show "not found" there — put the version back, or name where it is now with \`walkdown threads set ${t.id} --proposes <path>${byName}\``
        : `proposes ${ref}, and this blueprint declares no design root to find it under — declare \`design.root\` in spec.yml, or name a version with \`walkdown threads set ${t.id} --proposes <path>${byName}\``,
    );
  }
  /*
   * A blueprint still on the design layout from before 0.5.0 (ADR 0015).
   * Every old key still loads, so nothing else says so, and the person finds
   * out only when a new design lands in a folder per screen beside the old
   * ones. Once per blueprint, naming each old thing, because the one fix is
   * one command for all of them.
   */
  const old = oldDesignLayout(blueprint);
  if (old.length)
    add(
      'warn',
      'upgrade',
      join(dir, SPEC_FILE),
      'design',
      `this blueprint keeps its designs as before 0.5.0 (${old.join('; ')}) — \`walkdown upgrade --dry-run\` shows what would move, then \`walkdown upgrade\` moves it`,
    );
  /*
   * Every screen is named by a rule, because a screen reaches a person only
   * with the rules it must show (ADR 0015 §8): those rules are the design's
   * review. A retired rule names nothing any more, so a screen only it
   * names has no rule.
   */
  const named = new Set(
    rules
      .filter(({ rule }) => rule && !rule.retired)
      .flatMap(({ rule }) => (Array.isArray(rule.screens) ? rule.screens : [])),
  );
  for (const s of storyboard?.screens ?? [])
    if (s?.id && !s.retired && !named.has(s.id))
      add(
        'error',
        'storyboard',
        join(dir, 'storyboard.yml'),
        s.id,
        `no rule names this screen — write the rules it must show, with \`screens: [${s.id}]\`, before it reaches anyone`,
      );
  /*
   * A rule names a screen, or says why there is nothing to look at (q-0593's
   * neighbour, 2026-10-12). Only an excuse for the agent tier says that: the
   * agent is what looks, so excusing checks alone leaves a rule nobody sees.
   */
  const tierWords = (ts) =>
    ts.length === 1 ? `the ${ts[0]} tier` : `the ${ts.join(' and ')} tiers`;
  for (const { file, rule } of rules) {
    if (!rule?.id || rule.retired) continue;
    if (Array.isArray(rule.screens) && rule.screens.length) continue;
    const excused = Object.keys(
      rule.unverifiable && typeof rule.unverifiable === 'object' ? rule.unverifiable : {},
    );
    if (excused.includes('agent')) continue;
    const fix =
      'name the screen it is on, with `screens: [<id>]`, or excuse the agent tier and say why there is nothing to look at';
    add(
      'error',
      'evidence',
      file,
      rule.id,
      excused.length
        ? `names no screen, and excuses only ${tierWords(excused)}, which says nothing about a screen — ${fix}`
        : `names no screen and excuses no tier, so nobody ever looks at it — ${fix}`,
    );
  }
  /*
   * A live rule on a retired screen is one no walk reaches, and retired
   * screens are not linted, so the finding is on the rule (q-0598). A screen
   * retired with `replaced_by:` says where the rule belongs now.
   */
  for (const { file, rule } of rules) {
    if (!rule?.id || rule.retired || !Array.isArray(rule.screens)) continue;
    for (const sid of rule.screens) {
      const s = screens.get(sid);
      if (!s?.retired) continue;
      const next = typeof s.replaced_by === 'string' && s.replaced_by.trim();
      add(
        'error',
        'storyboard',
        file,
        rule.id,
        next
          ? `names the retired screen ${sid}, which ${next} replaced — point it at ${next}, or retire the rule too`
          : `names the retired screen ${sid} — point it at a live screen, or retire the rule too`,
      );
    }
  }
  for (const { file, rule } of rules) {
    if (rule?.retired) continue;
    const m = typeof rule?.origin === 'string' && rule.origin.match(/^thread:(.+)$/);
    if (m && !threads.some((t) => t.data?.id === m[1]) && !project().threads.has(m[1]))
      add('warn', 'drift', file, rule.id, `origin references unknown thread "${m[1]}"`);
  }

  // --- threads ---------------------------------------------------------------
  /*
   * Anchors move; records do not (q-0252). A screen's `renames` says where an
   * anchor went, and a thread filed under the old name is read through it -
   * the thread keeps the name it was filed under, and lint stops warning
   * about a rename forever. A rename that ends nowhere declared is the thing
   * worth a warning instead.
   */
  const renamesOf = new Map((storyboard?.screens ?? []).map((sc) => [sc?.id, sc?.renames ?? {}]));
  const throughRenames = (screen, element) => {
    let cur = element;
    const seen = new Set();
    while (renamesOf.get(screen)?.[cur] && !seen.has(cur)) {
      seen.add(cur);
      cur = String(renamesOf.get(screen)[cur]);
    }
    return cur;
  };
  for (const sc of storyboard?.screens ?? [])
    for (const [from, to] of Object.entries(sc?.renames ?? {})) {
      const end = throughRenames(sc.id, from);
      if (declaredAnchors.size && !declaredAnchors.has(end))
        add(
          'warn',
          'storyboard',
          'storyboard.yml',
          sc.id,
          `\`${from}\` is renamed to \`${to}\`, which is not a declared anchor`,
        );
    }
  /*
   * A label two threads share (ADR 0014 §9): a merge of two branches that
   * each filed one. Both conversations are kept; which one a label in a
   * commit message means is the question, and a person settles it.
   */
  for (const { label, threads: ts } of labelClashes(threads))
    add(
      'warn',
      'label-clash',
      threads.find((t) => t.data?.uuid === ts.at(-1).uuid)?.file,
      label,
      `${label} labels ${ts.length} threads (${ts.map((t) => t.uuid).join(', ')}) — \`walkdown threads relabel ${label}${bp}\` gives the newer one a label of its own`,
    );
  for (const { file, data: t } of threads) {
    // A picture a message names is there (n-0096): the record is the only
    // thing that says the file exists, and a thumbnail that will not load
    // says nothing about which.
    for (const m of [t, ...(t?.replies ?? [])])
      for (const a of m?.attachments ?? [])
        if (!existsSync(join(blueprint.at.threads.path, String(a?.file ?? ''))))
          add(
            'warn',
            'attachment-missing',
            file,
            t.id,
            `names a picture that is not there: ${a?.file}`,
          );
    const id = t?.id ?? relative(projectRoot, file);
    /*
     * An open question offers its ways out as choices, or a person meets it
     * in a walkdown with nothing to press (Topher, 2026-09-22: q-0335 was
     * filed as prose and sat unanswerable). Only an open one is warned about:
     * the questions asked before choices existed are answered or waived, and
     * nothing is owed on them.
     */
    /*
     * An open thread on a retired rule is a conversation nobody's walk will
     * reach, about a thing we stopped meaning (q-0317, q-0335). Closed ones
     * are history and stay where they were filed.
     */
    if (t?.anchor?.rule && OPEN_ON.has(t?.status) && retiredIds.has(t.anchor.rule))
      add(
        'warn',
        'thread-on-retired-rule',
        file,
        id,
        `open on \`${t.anchor.rule}\`, which is retired - move it to the rule or screen that carries the concern now, or close it`,
      );
    /*
     * A question on one rule while another was written from its answer
     * (threads.lifecycle.no-question-asked-twice): the walk would ask the
     * question and the rule as two stops, and they can be answered two ways.
     */
    // One answer may be written as two rules: on either, it is asked once.
    const writtenFrom =
      t?.kind === 'question' && t?.status === 'open'
        ? rules
            .map(({ rule }) => rule)
            .filter((r) => r?.id && !r.retired && r.origin === `thread:${t.id}`)
        : [];
    if (!writtenFrom.some((r) => r.id === t.anchor?.rule))
      for (const rule of writtenFrom)
        add(
          'error',
          'threads',
          file,
          id,
          `open on ${t.anchor?.rule ?? `screen ${t.anchor?.screen}`}, but ${rule.id} was written from its answer, so the walk would ask it twice — move it onto that rule with \`walkdown threads set ${t.id} --written-as ${rule.id}${bp}\``,
        );
    if (t?.kind === 'question' && t?.status === 'open' && !t.options?.length)
      add(
        'warn',
        'question-without-choices',
        file,
        id,
        `an open question with no choices - offer two to six with \`walkdown threads set <id> --option "<label> :: <why>"${bp}\`, so it is answered by picking`,
      );
    // Read the way the door now writes: a selector-shaped anchor names the
    // element inside it, and three threads filed before the door unwrapped
    // them are not undeclared for that.
    const read = t?.anchor?.element
      ? {
          ...t,
          anchor: {
            ...t.anchor,
            element: throughRenames(
              t.anchor.screen,
              anchorId(t.anchor.element, config?.embed?.anchor_attribute ?? 'data-testid'),
            ),
          },
        }
      : t;
    /*
     * A thread whose rule moved here keeps the screen it was filed on, and
     * that screen may be a sibling's (ADR 0013 §5) - known to the project,
     * so not unknown.
     */
    applyShape(read ?? {}, THREAD_SHAPE, { registries: projectRegistries() }, (l, c, m) =>
      add(l, c, file, id, m),
    );
  }

  // --- runs ------------------------------------------------------------------
  for (const { file, data: run } of runs) {
    const id = run?.run_id ?? relative(projectRoot, file);
    /*
     * A result for a rule a sibling holds now is a verdict that moved with
     * its rule (ADR 0013 §5): the record stays, append-only, and the result
     * is read by nothing here - as with a retired rule.
     */
    applyShape(run ?? {}, RUN_SHAPE, { registries: projectRegistries() }, (l, c, m) =>
      add(l, c, file, id, m),
    );
    /*
     * A run recorded against an address its target no longer points at is
     * evidence about a different system (status.derived.verdict-belongs-to-
     * a-place), so the board drops it - and did so in silence: it lints, it
     * validates, and it fills no cell (n-0264). Said here, once, with the
     * address the target does point at, since re-recording is the only way
     * a verdict gets back on the board.
     */
    const want = config?.runner?.targets?.[run?.target]?.base_url ?? null;
    if (want && run?.base_url && run.base_url !== want && (run.results ?? []).length)
      add(
        'warn',
        'runs',
        file,
        id,
        `recorded against ${run.base_url}, and target \`${run.target}\` points at ${want} - a verdict belongs to a place, so this record fills no cell`,
      );
  }

  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.length - errors;
  return {
    findings,
    summary: {
      errors,
      warnings,
      // Live ones only; the retired are counted apart (ownership.design.retired-counted-apart).
      rules: rules.filter(({ rule }) => rule?.id && !rule.retired).length,
      screens: [...screens.values()].filter((sc) => sc?.id && !sc.retired).length,
      retiredRules: retiredIds.size,
      retiredScreens: [...screens.values()].filter((sc) => sc?.id && sc.retired).length,
      anchors: declaredAnchors.size,
      threads: threads.length,
      runs: runs.length,
    },
    exitCode: errors > 0 ? 1 : 0,
  };
}

/**
 * What of a blueprint's design layout is from before 0.5.0: the storyboard as
 * written (loadBlueprint has already read `design:` into `prototype:`), the
 * spec's key, and the sorting folders under the design root.
 *
 * @param {{ dir: string, config?: any, codeRoot?: string, projectRoot?: string }} blueprint
 * @returns {string[]}
 */
export function oldDesignLayout(blueprint) {
  const found = [];
  let screens = [];
  try {
    const file = join(blueprint.dir, 'storyboard.yml');
    if (existsSync(file)) screens = parse(readFileSync(file, 'utf8'))?.screens ?? [];
  } catch {
    // An unreadable storyboard is reported by the schema; it holds no keys here.
  }
  const has = (key) => Array.isArray(screens) && screens.some((sc) => sc && key in sc);
  if (has('prototype')) found.push('storyboard `prototype:` keys');
  if (has('proposal')) found.push('storyboard `proposal:` keys');
  if (blueprint.config?.prototype?.root != null) found.push('`prototype.root` in spec.yml');
  const root = prototypeDir(blueprint);
  if (root) {
    const folders = ['screens', 'drafts', 'proposals'].filter((f) => existsSync(join(root, f)));
    if (folders.length)
      found.push(`${folders.map((f) => `\`${f}/\``).join(' and ')} under ${basename(root)}/`);
  }
  return found;
}
