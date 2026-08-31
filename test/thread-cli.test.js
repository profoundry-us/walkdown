/*
 * What `walkdown thread` SAYS, as opposed to what it does. The mutations
 * themselves are covered next door in thread-mutations.test.js; this is about
 * the report, which is a contract of its own: a command whose output looks the
 * same whether or not it changed anything sends people to run a second command
 * to find out, and a loop over several threads scrolls the answer away.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'walkdown-thread-cli-'));
after(() => rmSync(root, { recursive: true, force: true }));
const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;

function fixture(name, thread) {
  const bp = join(root, name);
  mkdirSync(join(bp, 'threads'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: thread-cli-fixture\n');
  writeFileSync(
    join(bp, 'threads', `${thread.id}.yml`),
    [
      `id: ${thread.id}`,
      'kind: note',
      'author: someone',
      'created: 2026-01-01T00:00:00Z',
      'anchor: {}',
      `status: ${thread.status}`,
      'body: A thing that is wrong.',
    ].join('\n'),
  );
  return bp;
}

/** Run the CLI, stripping colour so assertions read the words, not the escapes. */
const run = (args, dir) =>
  execFileSync(process.execPath, [CLI, 'thread', ...args, '--dir', dir], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  }).replace(/\x1b\[[0-9;]*m/g, '');

test('a transition reports where the thread came from and where it landed @rule:threads.lifecycle.says-what-it-did', () => {
  const bp = fixture('moved', { id: 'n-0001', status: 'addressed' });
  const out = run(
    ['n-0001', '--actor', 'A Person', '--waive', '--reason', 'not valid any more'],
    bp,
  );
  assert.match(out, /n-0001/);
  assert.match(out, /addressed → waived/, 'the report must name both ends of the move');
  assert.match(out, /A Person/, 'waiving is recorded under somebody, and says so');
  assert.match(out, /\+1 reply/, 'the reason landed as a reply and the count says so');
  // The whole point: it is a report, not the thread read back at you.
  assert.doesNotMatch(out, /A thing that is wrong/, 'a mutation must not print the conversation');
});

test('a reply with no transition says the status did not move @rule:threads.lifecycle.says-what-it-did', () => {
  const bp = fixture('replied', { id: 'n-0002', status: 'open' });
  const out = run(['n-0002', '--actor', 'agent', '--reply', 'looking at it'], bp);
  assert.match(out, /still open/, 'silence about the status would imply it changed');
  assert.match(out, /by agent/, 'recorded under is named even when nothing moved');
  assert.match(out, /\+1 reply/);
  assert.doesNotMatch(out, /→/, 'nothing moved, so nothing may be reported as having moved');
});

test('every mutation names who it was recorded under @rule:threads.lifecycle.says-what-it-did', () => {
  // The mistake this line exists to surface: --actor forgotten, the machine
  // username silently recorded. n-0125 found only the waive path said so.
  const bp = fixture('under', { id: 'n-0005', status: 'open' });
  const out = run(['n-0005', '--actor', 'A Person', '--status', 'addressed'], bp);
  assert.match(out, /open → addressed/);
  assert.match(out, /by A Person/, 'a plain transition names its actor, not only a waive');
});

test('reading a thread still prints the conversation @rule:threads.lifecycle.says-what-it-did', () => {
  const bp = fixture('read', { id: 'n-0003', status: 'open' });
  const out = run(['n-0003'], bp);
  assert.match(out, /A thing that is wrong/, 'reading is a different ask from changing');
  assert.doesNotMatch(out, /→/);
});

test('a refused transition says so and exits non-zero @rule:threads.lifecycle.says-what-it-did', () => {
  const bp = fixture('refused', { id: 'n-0004', status: 'open' });
  assert.throws(
    () => run(['n-0004', '--actor', 'A Person', '--verify'], bp),
    (err) => {
      assert.equal(err.status, 2, 'a loop must be able to stop on the failure');
      assert.match(String(err.stderr), /illegal transition/);
      return true;
    },
  );
});
