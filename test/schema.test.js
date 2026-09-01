import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyShape, RULE_SHAPE, RUN_SHAPE, THREAD_SHAPE } from '../lib/schema.js';
import { RESULT_STATUSES, ROLES, THREAD_KINDS, TIERS } from '../lib/vocab.js';

/*
 * The shapes get their behaviour tested through lint (test/lint.test.js reads
 * every message through the reader). What is pinned HERE is the contract of
 * the schema itself: that it is data lint can trust, and that the interpreter
 * refuses what it does not know rather than skipping it.
 */

const collect = (doc, shape, ctx = {}) => {
  const out = [];
  const r = applyShape(doc, shape, ctx, (level, category, message) =>
    out.push({ level, category, message }),
  );
  return { out, halted: r.halted };
};

test('an unknown check kind throws instead of silently passing', () => {
  assert.throws(() => collect({}, [{ kind: 'telepathy' }]), /unknown schema check kind/);
});

test('a retired rule is a gate: one complaint at most, then silence', () => {
  const { out, halted } = collect({ retired: true, statement: null }, RULE_SHAPE);
  assert.equal(halted, true, 'the gate closes the document');
  assert.equal(out.length, 1);
  assert.match(out[0].message, /retired must say why/);
  const ok = collect({ retired: 'we stopped meaning this', statement: null }, RULE_SHAPE);
  assert.equal(ok.halted, true);
  assert.equal(ok.out.length, 0, 'a sentence satisfies the gate');
});

test('the shapes draw their vocabularies from vocab.js, never a copy', () => {
  const verify = RULE_SHAPE.find((c) => c.field === 'verify');
  assert.equal(verify.options, TIERS);
  assert.equal(RULE_SHAPE.find((c) => c.kind === 'signoff').roles, ROLES);
  assert.equal(RULE_SHAPE.find((c) => c.kind === 'excuses').tiers, TIERS);
  assert.equal(THREAD_SHAPE.find((c) => c.kind === 'lifecycle').kinds, THREAD_KINDS);
  const results = RUN_SHAPE.find((c) => c.kind === 'each');
  assert.equal(results.shape.find((c) => c.field === 'status').options, RESULT_STATUSES);
});

test('every finding a shape can make carries its level, category and wording as data', () => {
  const flat = (shape) => shape.flatMap((c) => (c.kind === 'each' ? [c, ...c.shape] : [c]));
  for (const check of [...flat(RULE_SHAPE), ...flat(THREAD_SHAPE), ...flat(RUN_SHAPE)]) {
    assert.ok(check.kind, 'a check names its kind');
    if (check.kind === 'each') continue;
    assert.ok(
      check.category || check.mustBeSentence?.category,
      `${check.kind} says which category it files under`,
    );
    const wording = [
      check.message,
      check.mustBeSentence?.message,
      check.empty,
      check.omitsEng,
      check.unknownRole,
      check.unknownTier,
      check.unknownTierHuman,
      check.tooThin,
      check.allExcused,
      check.unknownKind,
      check.badStatus,
      check.notAList,
    ].filter(Boolean);
    assert.ok(wording.length, `${check.kind} carries its own words`);
  }
});

test('a ref answers from the registry it names, and an empty registry can opt out', () => {
  const shape = [
    {
      kind: 'ref',
      field: 'anchor.element',
      registry: 'anchors',
      skipWhenRegistryEmpty: true,
      level: 'warn',
      category: 'threads',
      message: 'anchored to undeclared anchor "{value}"',
    },
  ];
  const doc = { anchor: { element: 'no.such' } };
  const silent = collect(doc, shape, { registries: { anchors: new Set() } });
  assert.equal(silent.out.length, 0, 'a storyboard declaring no anchors has opted out');
  const loud = collect(doc, shape, { registries: { anchors: new Set(['panel.bar']) } });
  assert.equal(loud.out.length, 1);
  assert.equal(loud.out[0].message, 'anchored to undeclared anchor "no.such"');
});
