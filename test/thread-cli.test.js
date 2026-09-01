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

/*
 * `thread new` - the creation door. Filing a finding used to take a running
 * serve or a hand-edited YAML; now the same front door that mutates threads
 * can open one, under the same report discipline: one line saying what
 * happened and under whom, never the thread read back.
 */
function ruleFixture(name) {
  const bp = join(root, name);
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'threads'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: thread-cli-fixture\n');
  writeFileSync(
    join(bp, 'features', 'f.yml'),
    [
      'feature: F',
      'stories:',
      '  - id: f.s',
      '    rules:',
      '      - id: f.s.rule',
      '        statement: A statement.',
    ].join('\n'),
  );
  return bp;
}

test('thread new opens an anchored thread and reports under whom @rule:threads.lifecycle.says-what-it-did', () => {
  const bp = ruleFixture('new-note');
  const out = run(
    ['new', '--kind', 'note', '--rule', 'f.s.rule', '--body', 'Seen: a thing.', '--actor', 'agent'],
    bp,
  );
  assert.match(out, /n-0001 opened · note · by agent/);
  assert.doesNotMatch(out, /Seen: a thing/, 'a report, not the thread read back');
  const disk = readFileSync(join(bp, 'threads', 'n-0001.yml'), 'utf8');
  assert.match(disk, /author: agent/);
  assert.match(disk, /rule: f\.s\.rule/);
  assert.match(disk, /status: open/);
  const q = run(['new', '--kind', 'question', '--rule', 'f.s.rule', '--body', 'Which?', '--actor', 'agent'], bp);
  assert.match(q, /q-0002 opened · question/, 'questions take their own prefix');
});

test('thread new refuses an unknown rule, an empty body, and a strange kind', () => {
  const bp = ruleFixture('new-refuse');
  for (const args of [
    ['new', '--rule', 'no.such.rule', '--body', 'x'],
    ['new', '--rule', 'f.s.rule', '--body', '   '],
    ['new', '--kind', 'rumor', '--rule', 'f.s.rule', '--body', 'x'],
    ['new', '--body', 'x'],
  ]) {
    assert.throws(
      () => run(args, bp),
      (err) => err.status === 2 && err.stdout === '',
    );
  }
  assert.throws(() => readFileSync(join(bp, 'threads', 'n-0001.yml')), 'no refusal filed anything');
});

test('thread new is creation only - mutation flags on it are refused', () => {
  const bp = ruleFixture('new-mixed');
  assert.throws(
    () => run(['new', '--rule', 'f.s.rule', '--body', 'x', '--verify'], bp),
    (err) => err.status === 2 && /exists/.test(String(err.stderr)),
  );
});

/*
 * The accept gate at the CLI door (n-0130). The username default keeps
 * ordinary mutations attributed; an acceptance may never ride on it - the
 * name must be SAID, with --actor or WALKDOWN_ACTOR, or the command refuses
 * before the gate ever sees a substitute.
 */
const runBare = (args, dir, env = {}) =>
  execFileSync(process.execPath, [CLI, 'thread', ...args, '--dir', dir], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', WALKDOWN_ACTOR: '', ...env },
  }).replace(/\x1b\[[0-9;]*m/g, '');

test('a no-actor verify is refused, never attributed to the machine username @rule:threads.lifecycle.claim-never-accept', () => {
  const bp = fixture('noactor-verify', { id: 'n-0011', status: 'addressed' });
  const before = readFileSync(join(bp, 'threads', 'n-0011.yml'), 'utf8');
  assert.throws(
    () => runBare(['n-0011', '--verify'], bp),
    (err) => {
      assert.equal(err.status, 2);
      assert.match(String(err.stderr), /say it with --actor/);
      assert.doesNotMatch(String(err.stderr), new RegExp(userInfo().username));
      return true;
    },
  );
  assert.equal(readFileSync(join(bp, 'threads', 'n-0011.yml'), 'utf8'), before, 'disk untouched');
});

test('a no-actor waive is refused the same way @rule:threads.lifecycle.claim-never-accept', () => {
  const bp = fixture('noactor-waive', { id: 'n-0012', status: 'open' });
  assert.throws(
    () => runBare(['n-0012', '--waive', '--reason', 'x'], bp),
    (err) => err.status === 2 && /say it with --actor/.test(String(err.stderr)),
  );
  const disk = readFileSync(join(bp, 'threads', 'n-0012.yml'), 'utf8');
  assert.match(disk, /status: open/, 'the thread never moved');
});

test('the agent actor is refused in any spelling, at the CLI too @rule:threads.lifecycle.claim-never-accept', () => {
  const bp = fixture('spelled-agent', { id: 'n-0013', status: 'addressed' });
  for (const spelled of ['Agent', 'AGENT']) {
    assert.throws(
      () => runBare(['n-0013', '--actor', spelled, '--verify'], bp),
      (err) => err.status === 2 && /named human actor/.test(String(err.stderr)),
    );
  }
  const disk = readFileSync(join(bp, 'threads', 'n-0013.yml'), 'utf8');
  assert.doesNotMatch(disk, /verified_by/, 'no spelling stood as accepter');
});

test('WALKDOWN_ACTOR is a said name and satisfies the accept gate @rule:threads.lifecycle.claim-never-accept', () => {
  const bp = fixture('env-actor', { id: 'n-0014', status: 'addressed' });
  const out = runBare(['n-0014', '--verify'], bp, { WALKDOWN_ACTOR: 'Env Person' });
  assert.match(out, /by Env Person/);
  const disk = readFileSync(join(bp, 'threads', 'n-0014.yml'), 'utf8');
  assert.match(disk, /verified_by: Env Person/);
});

/*
 * Concurrent filers must never overwrite each other. Two judges computed the
 * same next id within a minute of each other on 2026-09-01 and the second
 * write clobbered the first thread; openThread now creates exclusively and
 * re-scans on collision.
 */
test('ten concurrent filers get ten threads, none overwritten', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const bp = ruleFixture('new-race');
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      exec(
        process.execPath,
        [CLI, 'thread', 'new', '--rule', 'f.s.rule', '--body', `finding ${i}`, '--actor', 'agent', '--dir', bp],
        { env: { ...process.env, NO_COLOR: '1' } },
      ),
    ),
  );
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(join(bp, 'threads')).filter((f) => f.endsWith('.yml'));
  assert.equal(files.length, 10, 'every filer landed a file');
  const bodies = files.map((f) => readFileSync(join(bp, 'threads', f), 'utf8'));
  for (let i = 0; i < 10; i++)
    assert.ok(
      bodies.some((b) => b.includes(`finding ${i}`)),
      `finding ${i} survived - nothing was overwritten`,
    );
});
