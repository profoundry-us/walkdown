/*
 * What a blueprint may say, as data.
 *
 * walkdown's subject is specification, and for a while the specification OF a
 * blueprint was the one thing not specified anywhere - it lived inside
 * lib/lint.js as a sequence of hand-rolled checks, and the only way to learn
 * what a rule may contain was to read the function that would complain. These
 * tables are that answer made declarative: each document kind lists what its
 * fields may hold, and every finding's level, category and exact wording is
 * data beside the constraint it belongs to. Lint READS this; it no longer IS
 * it.
 *
 * Two things stay out on purpose. Anything relational - duplicate ids,
 * statement-hash currency, checks coverage, storyboard claims, drift - needs
 * the whole blueprint in hand and remains lint's own code. And the wording is
 * carried verbatim from the checks it replaced: these messages are walkdown's
 * voice, some are quoted by threads and run records, and a schema migration
 * that rephrased them would be a behaviour change wearing a refactor's label.
 *
 * The interpreter (`applyShape`) is deliberately small. A check kind earns its
 * place by being needed twice or by replacing a whole hand-rolled block, not
 * by generality - the moment this file wants a predicate language, the answer
 * is a new kind with a name, or honest code back in lint.js.
 */
import { RESULT_STATUSES, ROLES, statusesFor, THREAD_KINDS, TIERS } from './vocab.js';

/** The shortest excuse anybody could argue with. Under this it is a shrug. */
export const MIN_EXCUSE = 20;

/**
 * @typedef {{ level: 'error'|'warn', category: string, message: string }} Say
 * @typedef {{ halted: boolean }} ShapeResult
 * @typedef {(level: 'error'|'warn', category: string, message: string) => void} Report
 */

/** Fill "{name}" slots in a message template. */
const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

/** A field that may be a scalar or a list, read as a list. */
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/*
 * What a rule may still DECLARE in `verify`.
 *
 * Not the same list as the tiers a rule ends up with. `agent` is assumed now
 * and `checks` is opt-in (lib/blueprint.js), so the only word that earns a
 * declaration is `checks` - but `agent` is spelled out in plenty of files and
 * saying so is merely redundant, never wrong. `human` is the one that has to
 * be caught: it used to mean "a person accepts this", it now means nothing at
 * all, and a rule carrying it reads as asking for a signature it is not asking
 * for. That is a lie in the file, which is what lint is for.
 */
export const RULE_SHAPE = [
  /*
   * A retired rule is registered and then left alone. Its id must keep
   * resolving, or every run record that ever named it becomes a warning about
   * a rule nobody can look up - but nothing else is asked of it: no coverage,
   * no fresh hash, no screen that still has to exist. It describes something
   * we stopped meaning.
   */
  {
    kind: 'gate',
    field: 'retired',
    mustBeSentence: {
      level: 'error',
      category: 'schema',
      message: 'retired must say why, in a sentence',
    },
  },
  {
    kind: 'required',
    field: 'statement',
    level: 'error',
    category: 'schema',
    message: 'rule is missing a statement',
  },
  {
    kind: 'id-extends-story',
    level: 'warn',
    category: 'ids',
    message: 'rule id does not extend its story id "{story}."',
  },
  /*
   * Checked against what was DECLARED rather than against verifyList's answer,
   * which filters to the two real tiers and so could never disagree with
   * itself. The interesting error is not a word the deriver does not know, it
   * is a word the deriver quietly drops.
   */
  {
    kind: 'vocab',
    field: 'verify',
    options: TIERS,
    level: 'error',
    category: 'schema',
    message: 'unknown verify type "{value}" (expected {options})',
    overrides: {
      human: {
        level: 'warn',
        message:
          'verify lists "human", which no longer means anything — acceptance is `signoff: [<roles>]` now, ' +
          'so this rule reads as asking for a signature it is not asking for',
      },
    },
  },
  /*
   * Who accepts this rule. signoffList forces `eng` in whatever the file says,
   * because somebody has to own that the thing was built right - so a declared
   * list omitting it is not a rule that engineering does not sign, it is a
   * file describing a rule that does not exist. The reader is the one misled,
   * which is why this warns rather than being silently repaired and forgotten.
   */
  {
    kind: 'signoff',
    field: 'signoff',
    roles: ROLES,
    category: 'signoff',
    empty: 'signoff is empty — omit it to mean `[eng]`, which is what it means anyway',
    omitsEng:
      'signoff [{list}] omits eng, but engineering always signs — ' +
      'the file says something the report will not do',
    unknownRole:
      'signoff names "{value}", which is not a role a run can be recorded under ' +
      '({roles}) — nobody can ever satisfy it',
  },
  /*
   * An excuse is the whole point of the inversion: every tier is assumed, and
   * a rule that cannot honestly have one says why in words a person can argue
   * with. "n/a" is not an argument - it is the silence the old
   * default-to-checks schema allowed, wearing a key.
   */
  {
    kind: 'excuses',
    field: 'unverifiable',
    tiers: TIERS,
    minLength: MIN_EXCUSE,
    category: 'evidence',
    unknownTier:
      'unverifiable names "{key}", which is not a tier ({tiers}) — ' +
      'the excuse is filed against nothing and removes nothing',
    unknownTierHuman:
      'unverifiable names "{key}", which is not a tier ({tiers}) — ' +
      'acceptance is `signoff` now, and a role cannot be excused',
    tooThin:
      'the {key} excuse is too thin to argue with — say why this rule cannot honestly be ' +
      'verified there, in a sentence (got {got} characters)',
    allExcused:
      'both tiers are excused — nothing verifies this rule but a signature. That is sometimes the ' +
      'honest answer, and it should stay a decision somebody made rather than one that accumulated',
  },
  {
    kind: 'ref',
    field: 'screens',
    registry: 'screens',
    level: 'error',
    category: 'storyboard',
    message: 'references unknown screen "{value}"',
  },
];

export const THREAD_SHAPE = [
  {
    kind: 'lifecycle',
    kindField: 'kind',
    statusField: 'status',
    kinds: THREAD_KINDS,
    category: 'threads',
    unknownKind: 'unknown thread kind "{value}"',
    badStatus: 'invalid status "{value}" for a {kind}',
  },
  {
    kind: 'flag',
    when: { field: 'status', is: 'answered' },
    level: 'warn',
    category: 'threads',
    message: 'answered but not incorporated — fold the answer into the rule',
  },
  {
    kind: 'require-when',
    when: { field: 'status', is: 'waived' },
    field: 'waived_by',
    level: 'error',
    category: 'threads',
    message: 'waived without waived_by — waiving requires a person',
  },
  {
    kind: 'ref',
    field: 'anchor.rule',
    skipFalsy: true,
    registry: 'rules',
    level: 'error',
    category: 'threads',
    message: 'anchored to unknown rule "{value}"',
  },
  {
    kind: 'ref',
    field: 'anchor.screen',
    skipFalsy: true,
    registry: 'screens',
    level: 'error',
    category: 'threads',
    message: 'anchored to unknown screen "{value}"',
  },
  // Anchors are declared screen by screen, and a storyboard that declares none
  // has opted out of the vocabulary - only then is silence the right answer.
  {
    kind: 'ref',
    field: 'anchor.element',
    skipFalsy: true,
    registry: 'anchors',
    skipWhenRegistryEmpty: true,
    level: 'warn',
    category: 'threads',
    message: 'anchored to undeclared anchor "{value}"',
  },
];

/*
 * A role nobody recognises is a signature that satisfies nothing. The write
 * paths refuse one, so a record carrying it was hand-edited or came from a
 * version of walkdown that knew a role this one does not - either way the rule
 * it was meant to accept is silently still waiting, and only lint can say so.
 * Never an error: the ledger is history, and history is not corrected by
 * refusing to read it.
 */
export const RUN_SHAPE = [
  {
    kind: 'require-all',
    fields: ['kind', 'target', 'actor'],
    level: 'warn',
    category: 'runs',
    message: 'missing kind, target, or actor',
  },
  /*
   * A record carrying verdicts but no date is in the ledger and invisible on
   * the board. Nothing orders it, so it never wins a cell and never goes stale
   * against a sweep either - and until this check it passed lint in silence,
   * which is how a recorded FAIL came to read as a pass (n-0191).
   *
   * Only a hand-written record can be in this state: `writeRunRecord` stamps
   * the field, and `walkdown judge` now prints it already filled in. So this is
   * a warning, like the rest of the shape - the ledger is history, and history
   * is not corrected by refusing to read it. It says what the record is worth,
   * and re-judging the rule is the only thing that puts the verdict back.
   */
  {
    kind: 'require-with',
    field: 'created',
    whenList: 'results',
    level: 'warn',
    category: 'runs',
    message:
      'no `created` — nothing orders these verdicts, so the record fills no cell and ages against no sweep; judge the rules again to put them on the board',
  },
  {
    kind: 'vocab',
    field: 'roles',
    options: ROLES,
    listOnly: true,
    level: 'warn',
    category: 'runs',
    notAList: 'roles is not a list — the run reads as signed by nobody in particular',
    message: 'signed under "{value}", which is not a role ({options}) — it accepts nothing',
  },
  {
    kind: 'each',
    field: 'results',
    shape: [
      {
        kind: 'scalar-vocab',
        field: 'status',
        options: RESULT_STATUSES,
        level: 'error',
        category: 'runs',
        message: 'invalid result status "{value}" for rule "{rule}"',
      },
      {
        kind: 'ref',
        field: 'rule',
        skipFalsy: true,
        registry: 'rules',
        level: 'warn',
        category: 'runs',
        message: 'result references unknown rule "{value}"',
      },
    ],
  },
];

/** Read a dotted path off a document. */
const at = (doc, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);

/**
 * Apply one shape to one document. `registries` maps a registry name to a Set
 * (or Map) whose membership answers `ref` checks; `story` is the enclosing
 * story id for rules. Findings go through `report`; the return says whether a
 * gate closed the document (a retired rule is registered and then left alone).
 *
 * @param {any} doc
 * @param {any[]} shape
 * @param {{ registries?: Record<string, {has(v: any): boolean, size?: number}>, story?: string }} ctx
 * @param {Report} report
 * @returns {ShapeResult}
 */
export function applyShape(doc, shape, ctx, report) {
  const registries = ctx.registries ?? {};
  for (const check of shape) {
    if (check.when && at(doc, check.when.field) !== check.when.is) continue;
    switch (check.kind) {
      case 'gate': {
        const v = doc[check.field];
        if (!v) break;
        const m = check.mustBeSentence;
        if (typeof v !== 'string' || !v.trim()) report(m.level, m.category, m.message);
        return { halted: true };
      }
      case 'required':
        if (!doc[check.field]) report(check.level, check.category, check.message);
        break;
      case 'require-when':
      case 'flag': {
        const missing = check.kind === 'flag' ? true : !doc[check.field];
        if (missing) report(check.level, check.category, check.message);
        break;
      }
      case 'require-all':
        if (check.fields.some((f) => !doc[f])) report(check.level, check.category, check.message);
        break;
      // A field that only matters once another one carries something.
      case 'require-with': {
        const list = doc[check.whenList];
        if (!Array.isArray(list) || !list.length) break;
        if (!doc[check.field]) report(check.level, check.category, check.message);
        break;
      }
      case 'id-extends-story': {
        if (ctx.story && doc.id && !String(doc.id).startsWith(`${ctx.story}.`))
          report(check.level, check.category, fill(check.message, { story: ctx.story }));
        break;
      }
      case 'vocab': {
        const raw = doc[check.field];
        if (raw == null) break;
        if (check.listOnly && !Array.isArray(raw)) {
          report(check.level, check.category, check.notAList);
          break;
        }
        for (const value of asList(raw)) {
          if (check.options.includes(value)) continue;
          const o = check.overrides?.[value];
          report(
            o?.level ?? check.level,
            check.category,
            fill(o?.message ?? check.message, { value, options: check.options.join('|') }),
          );
        }
        break;
      }
      case 'scalar-vocab': {
        if (!check.options.includes(doc[check.field]))
          report(
            check.level,
            check.category,
            fill(check.message, { value: doc[check.field], rule: doc.rule }),
          );
        break;
      }
      case 'signoff': {
        if (doc[check.field] == null) break;
        const declared = asList(doc[check.field])
          .map((r) => String(r ?? '').trim())
          .filter(Boolean);
        if (!declared.length) report('warn', check.category, check.empty);
        else if (!declared.includes('eng'))
          report('warn', check.category, fill(check.omitsEng, { list: declared.join(', ') }));
        for (const role of declared)
          if (!check.roles.includes(role))
            report(
              'warn',
              check.category,
              fill(check.unknownRole, { value: role, roles: check.roles.join('|') }),
            );
        break;
      }
      case 'excuses': {
        const excuses = doc[check.field] ?? {};
        if (typeof excuses !== 'object' || Array.isArray(excuses)) break;
        const tiers = check.tiers.join('|');
        for (const [key, why] of Object.entries(excuses)) {
          if (!check.tiers.includes(key))
            report(
              'warn',
              check.category,
              fill(key === 'human' ? check.unknownTierHuman : check.unknownTier, { key, tiers }),
            );
          else if (typeof why !== 'string' || why.trim().length < check.minLength)
            report(
              'warn',
              check.category,
              fill(check.tooThin, {
                key,
                got: typeof why === 'string' ? why.trim().length : 0,
              }),
            );
        }
        if (check.tiers.every((t) => typeof excuses[t] === 'string' && excuses[t].trim()))
          report('warn', check.category, check.allExcused);
        break;
      }
      case 'ref': {
        const registry = registries[check.registry];
        if (!registry) break;
        if (check.skipWhenRegistryEmpty && !(registry.size ?? 0)) break;
        for (const value of asList(at(doc, check.field))) {
          if (check.skipFalsy && !value) continue;
          if (!registry.has(value))
            report(check.level, check.category, fill(check.message, { value }));
        }
        break;
      }
      case 'lifecycle': {
        const kind = doc[check.kindField];
        if (!check.kinds.includes(kind))
          report('error', check.category, fill(check.unknownKind, { value: kind }));
        else if (!statusesFor(kind).includes(doc[check.statusField]))
          report(
            'error',
            check.category,
            fill(check.badStatus, { value: doc[check.statusField], kind }),
          );
        break;
      }
      case 'each': {
        for (const item of doc[check.field] ?? [])
          applyShape(item, check.shape, ctx, report);
        break;
      }
      default:
        throw new Error(`unknown schema check kind "${check.kind}"`);
    }
  }
  return { halted: false };
}
