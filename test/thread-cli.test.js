/*
 * What `walkdown thread` SAYS, as opposed to what it does. The mutations
 * themselves are covered next door in thread-mutations.test.js; this is about
 * the report, which is a contract of its own: a command whose output looks the
 * same whether or not it changed anything sends people to run a second command
 * to find out, and a loop over several threads scrolls the answer away.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
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
      ...(thread.waived_by ? [`waived_by: ${thread.waived_by}`] : []),
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

test('a refused transition refuses the whole mutation - the reply never lands @rule:threads.lifecycle.says-what-it-did', () => {
  // Found by the judging agent on 2026-08-31 (n-0125, second round): the
  // reply used to be written BEFORE the transition validated, so the output
  // denied a change that had happened, and a retry duplicated the reply.
  const bp = fixture('mixed', { id: 'n-0006', status: 'open' });
  const file = join(bp, 'threads', 'n-0006.yml');
  const before = readFileSync(file, 'utf8');
  assert.throws(
    () => run(['n-0006', '--actor', 'A Person', '--reply', 'and verified', '--verify'], bp),
    (err) => err.status === 2 && /illegal transition/.test(String(err.stderr)),
  );
  assert.equal(readFileSync(file, 'utf8'), before, 'a refused command must have written nothing');
});

test('an empty reply is refused, not read back - and drops no status change @rule:threads.lifecycle.says-what-it-did', () => {
  // Round three (n-0125): `--reply "$MSG"` with an empty variable used to be
  // treated as no reply at all - alone it printed the conversation, and with
  // a status it applied the transition while silently dropping the reply.
  const bp = fixture('empty', { id: 'n-0007', status: 'open' });
  const file = join(bp, 'threads', 'n-0007.yml');
  const before = readFileSync(file, 'utf8');
  for (const args of [
    ['n-0007', '--actor', 'A Person', '--reply', ''],
    ['n-0007', '--actor', 'A Person', '--reply', '', '--status', 'addressed'],
  ]) {
    assert.throws(
      () => run(args, bp),
      (err) => err.status === 2 && /reply body required/.test(String(err.stderr)),
    );
    assert.equal(readFileSync(file, 'utf8'), before, 'refused whole, nothing landed');
  }
});

test('a mutating --json call reports the change, never the thread @rule:threads.lifecycle.says-what-it-did', () => {
  // Round four (n-0125): the json branch ran first, so a mutation's stdout
  // was byte-identical to a read - round one's invisibility, machine-readable.
  const bp = fixture('jsonmut', { id: 'n-0008', status: 'open' });
  const doc = JSON.parse(run(['n-0008', '--actor', 'agent', '--status', 'addressed', '--json'], bp));
  assert.equal(doc.was, 'open');
  assert.equal(doc.status, 'addressed');
  assert.equal(doc.by, 'agent', 'recorded-under survives into the machine format');
  assert.equal(doc.replies_added, 0);
  assert.equal(doc.body, undefined, 'a mutation must not print the conversation');
});

test('a present-but-empty actor defaults visibly, and the report matches the disk @rule:threads.lifecycle.says-what-it-did', () => {
  // Round four (n-0125): `--actor "$WHO"` with an unset variable named nobody
  // in the report while the disk recorded `author: unknown`.
  const me = userInfo().username;
  const bp = fixture('noactor', { id: 'n-0009', status: 'open' });
  const out = run(['n-0009', '--actor', '', '--reply', 'noted'], bp);
  assert.match(out, new RegExp(`by ${me}`), 'the default is named, never an empty string');
  const disk = readFileSync(join(bp, 'threads', 'n-0009.yml'), 'utf8');
  assert.match(disk, new RegExp(`author: ${me}`), 'the ledger records the same name the report gave');
});

test("a reply to a terminal thread is recorded under its own actor, not the status holder @rule:threads.lifecycle.says-what-it-did", () => {
  // Round five (n-0125): the report named the waiver for someone else's
  // reply, putting another person's name on a change they did not make.
  const bp = fixture('terminal', { id: 'n-0010', status: 'waived', waived_by: 'Probe Human' });
  const out = run(['n-0010', '--actor', 'agent', '--reply', 'noting this for later'], bp);
  assert.match(out, /still waived/);
  assert.match(out, /by agent/, "the reply's author is who the change was recorded under");
  assert.doesNotMatch(out, /by Probe Human/, 'the status holder did not make this change');
  const disk = readFileSync(join(bp, 'threads', 'n-0010.yml'), 'utf8');
  assert.match(disk, /author: agent/, 'and the disk agrees');
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
