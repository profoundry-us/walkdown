import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { stringify } from 'yaml';
import { formatHash } from '../lib/hash.js';
import { reasonsSince, sinceSigned, stepChanges, wordDiff } from '../lib/since-signed.js';

const root = mkdtempSync(join(tmpdir(), 'wd-since-signed-'));
after(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    encoding: 'utf8',
  });

const signed = {
  id: 'checkout.basics.receipt',
  statement: 'The receipt names every item bought.',
  steps: {
    given: ['A cart with a mug and a prototype sticker'],
    when: ['The order is placed'],
    then: [
      'The receipt lists the mug and the sticker',
      'A toast repeats the email for three seconds',
      'The total is in the store currency',
    ],
  },
};
const now = {
  ...signed,
  steps: {
    given: ['A cart with a mug and a design sticker'],
    when: ['The order is placed'],
    then: [
      'The receipt lists the mug and the sticker',
      'The total is in the store currency',
      'The receipt says how to return an item',
    ],
    changed: [
      { hash: formatHash(signed), at: '2026-10-20', why: 'ADR 0015 says design, not prototype.' },
      { hash: 'sha256:000000000000', at: '2026-09-01', why: 'Before anyone signed.' },
    ],
  },
};
const feature = (rule) =>
  stringify({ feature: 'checkout', stories: [{ id: 'checkout.basics', rules: [rule] }] });

function repo(name) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'features'), { recursive: true });
  git(dir, 'init', '-q');
  const file = join(dir, 'features', 'checkout.yml');
  writeFileSync(file, feature(signed));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'signed wording');
  writeFileSync(file, feature(now));
  git(dir, 'commit', '-qam', 'reworded');
  return file;
}

test('the wording a signature was given on is found in git and compared step by step @rule:panel.walkdown.what-changed-since-you-signed', () => {
  const file = repo('found');
  const out = sinceSigned(
    { file, rule: now },
    { hash: formatHash(signed), at: '2026-10-02T15:00:00Z' },
  );
  assert.equal(out.found, true);
  assert.deepEqual(
    out.changes.map((c) => [c.kind, c.phase]),
    [
      ['reworded', 'given'],
      ['removed', 'then'],
      ['added', 'then'],
    ],
  );
  const reworded = out.changes[0].runs;
  assert.deepEqual(
    reworded.filter((r) => r.kind !== 'same').map((r) => [r.kind, r.text]),
    [
      ['went', 'prototype'],
      ['came', 'design'],
    ],
  );
  assert.equal(out.changes[1].text, 'A toast repeats the email for three seconds');
  assert.equal(out.changes[2].text, 'The receipt says how to return an item');
  // Only the reasons recorded since the signature.
  assert.deepEqual(out.reasons, [
    { at: '2026-10-20', why: 'ADR 0015 says design, not prototype.' },
  ]);
});

test('a wording git never held, or a file outside git, is not found - never an empty list of changes @rule:panel.walkdown.what-changed-since-you-signed', () => {
  const file = repo('lost');
  const lost = sinceSigned(
    { file, rule: now },
    { hash: 'sha256:abcdefabcdef', at: '2026-10-02T15:00:00Z' },
  );
  assert.equal(lost.found, false);
  assert.deepEqual(lost.changes, []);
  assert.equal(lost.reasons.length, 1, 'the reasons are still shown');

  const loose = join(mkdtempSync(join(tmpdir(), 'wd-no-git-')), 'checkout.yml');
  writeFileSync(loose, feature(now));
  const outside = sinceSigned(
    { file: loose, rule: now },
    { hash: formatHash(signed), at: '2026-10-02' },
  );
  assert.equal(outside.found, false);
});

test('each signer is compared with the wording they signed @rule:panel.walkdown.what-changed-since-you-signed', () => {
  const file = repo('two-signers');
  const middle = { ...signed, steps: { ...signed.steps, when: ['The order is placed and paid'] } };
  writeFileSync(file, feature(middle));
  git(join(root, 'two-signers'), 'commit', '-qam', 'middle');
  writeFileSync(file, feature(now));
  git(join(root, 'two-signers'), 'commit', '-qam', 'now');
  const early = sinceSigned({ file, rule: now }, { hash: formatHash(signed), at: '2026-10-02' });
  const late = sinceSigned({ file, rule: now }, { hash: formatHash(middle), at: '2026-10-05' });
  assert.ok(
    !early.changes.some((c) => c.phase === 'when'),
    'the first wording had the same when-step',
  );
  assert.ok(late.changes.some((c) => c.phase === 'when' && c.kind === 'reworded'));
});

test('a reworded step joins back into both wordings exactly', () => {
  const was = 'The screen is named as having no design and no open design request';
  const is = `${was}, and the message says a proposed version counts`;
  const runs = wordDiff(was, is);
  assert.equal(
    runs
      .filter((r) => r.kind !== 'came')
      .map((r) => r.text)
      .join(''),
    was,
  );
  assert.equal(
    runs
      .filter((r) => r.kind !== 'went')
      .map((r) => r.text)
      .join(''),
    is,
  );
  assert.deepEqual(stepChanges({ statement: 'a' }, { statement: 'a' }), []);
  assert.deepEqual(reasonsSince({ steps: {} }, '2026-10-02'), []);
});
