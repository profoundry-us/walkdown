/*
 * THE CLI'S SCENARIOS, AS CHECKS (ADR 0013 §8), a quarter at a time.
 *
 * Each file in test/cli/scenarios/ is one moment at a terminal, and here it
 * is a check of the rule it names: the command ends with the exit code the
 * scenario says, prints every line it expects, and places every anchor it
 * declares. tools/cli-captures.mjs draws the same runs as the app side of
 * each `cli` screen, so what is judged by eye and what is checked here are
 * one run of one command.
 *
 * Every scenario spawns the CLI synchronously, so one file runs them one
 * after another: at ninety-odd scenarios that was a minute on its own, the
 * whole of the unit suite's budget (2026-10-08). node --test runs files side
 * by side, so the scenarios are dealt across test/cli.test.js and
 * test/cli-{2,3,4}.test.js.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeAnchors, run, scenarios } from '../../tools/cli-scenarios.mjs';

export const SHARDS = 4;

/** Register the checks for every scenario whose place in the list falls to `shard`. */
export function checkShard(shard) {
  scenarios().forEach((s, i) => {
    if (i % SHARDS !== shard) return;
    test(`${s.title} (${s.screen}) ${'@'}rule:${s.rule}`, () => {
      const out = run(s);
      assert.equal(out.status, s.exit, `exit ${out.status}, wanted ${s.exit}\n${out.text}`);
      for (const re of s.expect) assert.match(out.text, re);
      const placed = placeAnchors(out.text.split('\n'), s.anchors);
      for (const a of s.anchors ?? [])
        assert.ok(placed.has(a.id), `anchor ${a.id} matched no line:\n${out.text}`);
    });
  });
}
