/*
 * THE CLI'S SCENARIOS, AS CHECKS (ADR 0013 §8).
 *
 * Each file in test/cli/scenarios/ is one moment at a terminal, and here it
 * is a check of the rule it names: the command ends with the exit code the
 * scenario says, prints every line it expects, and places every anchor it
 * declares. tools/cli-captures.mjs draws the same runs as the app side of
 * each `cli` screen, so what is judged by eye and what is checked here are
 * one run of one command.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeAnchors, run, scenarios } from '../tools/cli-scenarios.mjs';

for (const s of scenarios()) {
  test(`${s.title} (${s.screen}) @rule:${s.rule}`, () => {
    const out = run(s);
    assert.equal(out.status, s.exit, `exit ${out.status}, wanted ${s.exit}\n${out.text}`);
    for (const re of s.expect) assert.match(out.text, re);
    const placed = placeAnchors(out.text.split('\n'), s.anchors);
    for (const a of s.anchors ?? []) assert.ok(placed.has(a.id), `anchor ${a.id} matched no line:\n${out.text}`);
  });
}
