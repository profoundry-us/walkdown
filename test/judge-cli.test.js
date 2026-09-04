/*
 * What `walkdown judge` HANDS an agent. The command judges nothing - it
 * assembles the prompt (docs/11-architecture.md, "Where the agent tier goes
 * next") - so what is on trial here is the assembly: that everything a
 * judging agent needs to start arrived, resolved through the blueprint
 * rather than guessed, and that the rules with nothing to judge say so
 * instead of printing a prompt that would be acted on.
 */
import { declareProject, suiteHome } from '../tools/test-home.mjs';

/** This file's own personal home — declaring into a shared one races. */
const HOME = suiteHome('judge');
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { formatHash } from '../lib/hash.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'walkdown-judge-cli-'));
after(() => rmSync(root, { recursive: true, force: true }));

const STATEMENT = 'Submitting the form lands the visitor on the done screen.';

function fixture(name, governance = []) {
  const bp = join(root, name, 'blueprint');
  // Beside the spec, not inside it: the home's layout is the only one
  // walkdown answers for, and `declareProject` writes the entry to match.
  const runs = join(root, name, 'runs');
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(runs, { recursive: true });
  writeFileSync(
    join(bp, 'walkdown.yml'),
    [
      'project: judge-fixture',
      'runner:',
      '  targets:',
      '    local:',
      '      base_url: http://localhost:9999',
      '    staging:',
      '      base_url: https://staging.example.test',
      ...(governance.length
        ? ['governance:', ...governance.map((g) => `  - ${g}`)]
        : []),
    ].join('\n'),
  );
  writeFileSync(
    join(bp, 'storyboard.yml'),
    [
      'screens:',
      '  - id: form',
      '    title: The form',
      '    prototype: /screens/form.html',
      '    app:',
      '      path: /form',
      '    anchors: [form.submit]',
      '  - id: done',
      '    title: All done',
      '    prototype: /screens/done.html',
      '    app:',
      '      path: /done',
      '      setup: Submit the form first - the address alone lands short of it.',
    ].join('\n'),
  );
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.walks',
      `        statement: ${STATEMENT}`,
      '        verify: [agent]',
      '        steps:',
      '          given:',
      '            - The visitor is on screen `form`',
      '          when:',
      '            - Click anchor `form.submit`',
      '          then:',
      '            - The visitor is on screen `done`',
      '      - id: demo.main.headless',
      '        statement: The ledger never loses a record.',
      '        verify: [agent]',
      '      - id: demo.main.excused',
      '        statement: The toolbar button opens the panel.',
      '        unverifiable:',
      '          agent: Browser chrome is not in the page, and no tool an agent drives reaches it.',
      '        verify: [checks]',
      '      - id: demo.main.retired',
      '        retired: We stopped meaning this (2026-01-01).',
    ].join('\n'),
  );
  return bp;
}

const run = (args, dir) =>
  execFileSync(process.execPath, [CLI, 'judge', ...args, '--project', declareProject(HOME, dir)], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: HOME },
  }).replace(/\x1b\[[0-9;]*m/g, '');

test('the prompt carries everything a judging agent needs to start', () => {
  const bp = fixture('full');
  const out = run(['demo.main.walks'], bp);
  assert.match(out, /RULE demo\.main\.walks/);
  assert.match(out, new RegExp(STATEMENT.replace(/[.]/g, '\\.')), 'the statement is the rule');
  assert.match(out, /GIVEN\s+The visitor is on screen `form`/, 'steps arrive as authored');
  assert.match(
    out,
    /http:\/\/localhost:9999\/form/,
    'app addresses resolve through the target base_url',
  );
  assert.match(out, /\/prototype\/screens\/done\.html/, 'prototype addresses go through serve');
  assert.match(out, /SETUP — done is a state, not an address/, 'a setup screen says how to arrive');
  assert.match(out, /ANCHORS the steps name: form\.submit/);
  assert.match(
    out,
    new RegExp(formatHash(STATEMENT)),
    'the hash to stamp is computed from the statement, not copied from anywhere',
  );
  assert.match(out, /runs\/evidence\//, 'evidence goes under the logical key');
  assert.match(out, /Never write "verified" or "waived"/, 'governance rides along');
  assert.doesNotMatch(
    out,
    /disposable/,
    'the built-ins never presume what the target is - wherever judges run is already theirs to dirty',
  );
});

test("the project's own governance rides into the prompt", () => {
  const LINE =
    'The app stores joins in the browser - clear site data between attempts instead of restarting anything.';
  const bp = fixture('governed', [LINE]);
  const out = run(['demo.main.walks'], bp);
  assert.match(out, /clear site data between attempts/, 'the config line arrives verbatim');
  const doc = JSON.parse(run(['demo.main.walks', '--json'], bp));
  assert.deepEqual(doc.governance, [LINE], '--json carries the same lines');
});

test('a screenless rule is told to judge without looking', () => {
  const bp = fixture('headless');
  const out = run(['demo.main.headless'], bp);
  assert.match(out, /No screen belongs to this rule/);
  assert.doesNotMatch(out, /SETUP/, 'no screen, no setup');
});

test('--target picks the address the verdict will be judged against', () => {
  const bp = fixture('target');
  const out = run(['demo.main.walks', '--target', 'staging'], bp);
  assert.match(out, /https:\/\/staging\.example\.test\/form/);
  assert.match(out, /"target": "staging"/, 'the run record names the same target');
});

test('excused and retired rules end the conversation instead of prompting', () => {
  const bp = fixture('silent');
  const excused = run(['demo.main.excused'], bp);
  assert.match(excused, /excused/);
  assert.match(excused, /Browser chrome is not in the page/, 'the excuse is quoted, not summarised');
  assert.match(excused, /Nothing to judge/);
  assert.doesNotMatch(excused, /VERDICT/, 'no verdict block for a rule with nothing to judge');
  const retired = run(['demo.main.retired'], bp);
  assert.match(retired, /retired/);
  assert.match(retired, /Nothing to judge/);
});

test('an unknown rule is a usage error, not an empty prompt', () => {
  const bp = fixture('unknown');
  assert.throws(
    () => run(['no.such.rule'], bp),
    (e) => e.status === 2 && /No rule "no\.such\.rule"/.test(e.stderr),
  );
});

test('--json is the same assembly, structured', () => {
  const bp = fixture('json');
  const doc = JSON.parse(run(['demo.main.walks', '--json'], bp));
  assert.equal(doc.rule, 'demo.main.walks');
  assert.equal(doc.statement_hash, formatHash(STATEMENT));
  assert.equal(doc.base_url, 'http://localhost:9999');
  assert.deepEqual(doc.anchors, ['form.submit']);
  assert.deepEqual(
    doc.screens.map((s) => s.id),
    ['form', 'done'],
    'screens arrive in step order',
  );
  assert.equal(doc.screens[1].setup, 'Submit the form first - the address alone lands short of it.');
  assert.match(doc.evidence.key_prefix, /^runs\/evidence\//);
});
