import { declareProject } from '../tools/test-home.mjs';
/*
 * Two threads sharing a label (ADR 0014 §9). Two branches that each filed a
 * thread both took the next number, and the merge holds both: two files,
 * two UUIDs, one `n-0006`. Nothing is lost and nothing is guessed - walkdown
 * says so wherever threads are listed, and relabels the newer one only when
 * a person agrees, keeping the old label as an alias so a commit message
 * that cites it still finds its way.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'walkdown-thread-labels-'));
after(() => rmSync(root, { recursive: true, force: true }));

const OLDER = '11111111-1111-4111-8111-111111111111';
const NEWER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.yml'), 'identity:\n  username: A Person\n');
  const bp = join(root, 'merged');
  mkdirSync(join(bp, 'threads'), { recursive: true });
  mkdirSync(join(bp, 'runs'), { recursive: true });
  writeFileSync(join(bp, 'spec.yml'), 'blueprint: merged\n');
  const thread = (uuid, id, created, body) =>
    writeFileSync(
      join(bp, 'threads', `${uuid}.yml`),
      [
        `id: ${id}`,
        `uuid: ${uuid}`,
        'kind: note',
        'author: someone',
        `created: ${created}`,
        'anchor: {}',
        'status: open',
        `body: ${body}`,
        'replies:',
        '  - author: someone',
        `    created: ${created}`,
        '    body: Still so.',
        '',
      ].join('\n'),
    );
  thread(OLDER, 'n-0006', '2026-10-01T10:00:00Z', 'Filed on main.');
  thread(NEWER, 'n-0006', '2026-10-02T10:00:00Z', 'Filed on the branch.');
  thread(OTHER, 'n-0007', '2026-10-03T10:00:00Z', 'Filed after both.');
  writeFileSync(join(bp, 'runs', '2026-10-02T11-00-00Z-local-01.json'), '{"id":"2026-10-02T11-00-00Z-local-01","results":[],"note":"cites n-0006"}\n');
  const id = declareProject(home, bp);
  return { home, bp, id };
}

const cli = (f, args, extra = {}) =>
  spawnSync(process.execPath, [CLI, ...args, '--blueprint', f.id], {
    cwd: f.bp,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: f.home },
    ...extra,
  });

/*
 * At a terminal, answering the question once it is asked. Python's pty gives
 * the child a real terminal and waits for the prompt before typing.
 */
const PTY = `
import os, pty, sys, time, select
answer, prompt, argv = sys.argv[1], sys.argv[2].encode(), sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
out, sent, deadline = b"", False, time.time() + 20
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.1)
    if r:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    if not sent and prompt in out:
        os.write(fd, (answer + "\\n").encode())
        sent = True
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.decode("utf8", "replace"))
sys.exit(os.waitstatus_to_exitcode(status))
`;
const atTerminal = (f, args, answer, prompt) =>
  spawnSync('python3', ['-c', PTY, answer, prompt, process.execPath, CLI, ...args, '--blueprint', f.id], {
    cwd: f.bp,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: f.home },
  });

const snapshot = (bp) =>
  Object.fromEntries(
    ['threads', 'runs'].flatMap((k) => readdirSync(join(bp, k)).map((n) => [`${k}/${n}`, readFileSync(join(bp, k, n), 'utf8')])),
  );

test('two threads sharing a label are named, and relabelled only when a person agrees @rule:locations.threads.clashing-labels-ask', () => {
  const f = fixture();
  const before = snapshot(f.bp);

  // Both commands name the two threads and the label they share.
  const listed = cli(f, ['threads']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, new RegExp(`n-0006 labels 2 threads: ${OLDER}, ${NEWER}`));
  assert.match(listed.stdout, new RegExp(`\`walkdown threads relabel n-0006 --blueprint ${f.id}\``));
  const linted = cli(f, ['lint', '--json']);
  const clash = JSON.parse(linted.stdout).findings?.find?.((x) => x.category === 'label-clash') ??
    JSON.parse(linted.stdout).blueprints?.flatMap((b) => b.findings).find((x) => x.category === 'label-clash');
  assert.ok(clash, linted.stdout);
  assert.match(clash.message, new RegExp(`${OLDER}, ${NEWER}`));

  // A label two threads share is not guessed at by show either.
  const ambiguous = cli(f, ['threads', 'show', 'n-0006']);
  assert.equal(ambiguous.status, 2);
  assert.match(ambiguous.stderr, new RegExp(`${OLDER}[\\s\\S]*${NEWER}`));

  // Named by the OLDER one's UUID, it is still the newer that would move.
  const byOlder = cli(f, ['threads', 'relabel', OLDER]);
  assert.match(byOlder.stdout, new RegExp(`would be relabelled:\\n\\s+${NEWER}`));
  assert.deepEqual(snapshot(f.bp), before);

  // With no terminal, nothing is relabelled and the command that does it is named.
  const asked = cli(f, ['threads', 'relabel', 'n-0006']);
  assert.equal(asked.status, 2, asked.stdout);
  assert.match(asked.stdout, new RegExp(NEWER), 'the newer one is the one it would move');
  assert.match(asked.stderr, new RegExp(`Nothing was changed\\. \`walkdown threads relabel ${NEWER} --yes --blueprint ${f.id}\` does it`));
  assert.deepEqual(snapshot(f.bp), before, 'and nothing was');

  // Declining at a terminal changes nothing either.
  const declined = atTerminal(f, ['threads', 'relabel', 'n-0006'], 'n', '[y/N]');
  assert.equal(declined.status, 0, declined.stdout);
  assert.deepEqual(snapshot(f.bp), before);

  // Agreeing gives the newer thread the next free label and keeps n-0006 as its alias.
  const agreed = atTerminal(f, ['threads', 'relabel', 'n-0006'], 'y', '[y/N]');
  assert.equal(agreed.status, 0, agreed.stdout);
  assert.match(agreed.stdout, new RegExp(`${NEWER} is n-0008 now`));
  const newer = parse(readFileSync(join(f.bp, 'threads', `${NEWER}.yml`), 'utf8'));
  assert.equal(newer.id, 'n-0008', 'one past every label in the blueprint, n-0007 included');
  assert.deepEqual(newer.aliases, ['n-0006']);
  assert.equal(parse(readFileSync(join(f.bp, 'threads', `${OLDER}.yml`), 'utf8')).id, 'n-0006', 'the older keeps the label');

  // `threads show n-0006` names both, and says which holds the label now.
  const shown = cli(f, ['threads', 'show', 'n-0006']);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /Filed on main\./, 'the label reads the thread that holds it');
  assert.match(shown.stdout, new RegExp(`n-0006 has labelled 2 threads\\. It labels ${OLDER} now \\(this one\\)`));
  assert.match(shown.stdout, new RegExp(`${NEWER} was n-0006, and is n-0008 now`));
  assert.match(cli(f, ['threads', 'show', 'n-0008']).stdout, /Filed on the branch\./);

  // No run record or reply is edited.
  const after_ = snapshot(f.bp);
  for (const [k, v] of Object.entries(before)) if (k !== `threads/${NEWER}.yml`) assert.equal(after_[k], v, `${k} untouched`);
  assert.deepEqual(newer.replies, parse(before[`threads/${NEWER}.yml`]).replies);

  // And the clash is gone from the list and from lint.
  assert.doesNotMatch(cli(f, ['threads']).stdout, /labels 2 threads/);
  assert.doesNotMatch(cli(f, ['lint', '--json']).stdout, /label-clash/);
});

test('a label one thread holds has nothing to relabel @rule:locations.threads.clashing-labels-ask', () => {
  const f = fixture();
  const r = cli(f, ['threads', 'relabel', 'n-0007', '--yes']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /n-0007 labels one thread .* nothing to relabel/);
});
