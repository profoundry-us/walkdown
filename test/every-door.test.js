/*
 * One table of asks, put through every door walkdown offers.
 *
 * The doors used to answer separately. The MECHANICS were shared — both ended
 * in lib/threads.js, so a legal transition meant the same thing at each — but
 * who a write was recorded under, and whether this machine may accept work at
 * all, were written out twice in the same words. Two copies of a rule is two
 * chances to be right: the accept gate was given to the CLI and not to the
 * HTTP API, and neither suite noticed, because each tested its own door. A
 * judging agent walked through the gap and verified a thread under a name it
 * invented (n-0142, n-0143).
 *
 * So this file does not test the CLI, or the API. It tests the POLICY, and
 * asks every door the same questions. A gate added to one and not another
 * fails here immediately — which is the whole reason the door is one module
 * now, and the reason a third interface can be added without a fourth copy.
 */
import { declareProject } from '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from '../vendor/yaml.js';
import { loadBlueprint } from '../lib/blueprint.js';
import { createWalkdownServer } from '../lib/serve.js';
import * as writes from '../lib/writes.js';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A project, a home that may or may not name a person, and a thread to act on. */
function fixture({ declared = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wd-doors-'));
  roots.push(root);
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  if (declared)
    writeFileSync(join(home, 'config.yml'), 'identity:\n  username: door-person\n');
  const bp = join(root, 'blueprint');
  mkdirSync(join(bp, 'features'), { recursive: true });
  mkdirSync(join(bp, 'threads'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'project: doors\n');
  writeFileSync(join(bp, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(
    join(bp, 'features', 'f.yml'),
    [
      'feature: f',
      'stories:',
      '  - id: f.s',
      '    rules:',
      '      - id: f.s.rule',
      '        statement: A statement.',
    ].join('\n'),
  );
  writeFileSync(
    join(bp, 'threads', 'n-0001.yml'),
    [
      'id: n-0001',
      'kind: note',
      'author: someone',
      'created: 2026-01-01T00:00:00Z',
      'anchor: { rule: f.s.rule }',
      'status: addressed',
      'body: A thing that is wrong.',
    ].join('\n'),
  );
  return { root, home, bp, thread: () => parse(readFileSync(join(bp, 'threads', 'n-0001.yml'), 'utf8')) };
}

/*
 * The doors. Each takes the same ask and reports the same two things: did it
 * refuse, and what name reached the ledger. How it says so is its own
 * business — an exit code, an HTTP status — and is exactly what an interface
 * is FOR; everything else about the ask must be identical.
 */
const doors = {
  /** In-process, which is what a future MCP server would be holding. */
  library: {
    async verify({ bp, home }) {
      process.env.WALKDOWN_HOME = home;
      try {
        writes.transition(loadBlueprint(bp), 'n-0001', { status: 'verified' });
        return { refused: false };
      } catch (err) {
        return { refused: true, why: err.message };
      }
    },
    async claim({ bp, home }) {
      process.env.WALKDOWN_HOME = home;
      try {
        writes.reply(loadBlueprint(bp), 'n-0001', { body: 'looked at it' });
        return { refused: false };
      } catch (err) {
        return { refused: true, why: err.message };
      }
    },
  },

  cli: {
    async verify({ bp, home }) {
      return run(['n-0001', '--verify', '--project', declareProject(home, bp)], home);
    },
    async claim({ bp, home }) {
      return run(['n-0001', '--reply', 'looked at it', '--project', declareProject(home, bp)], home);
    },
  },

  http: {
    async verify(f) {
      return post(f, { status: 'verified' });
    },
    async claim(f) {
      return post(f, null, 'replies', { body: 'looked at it' });
    },
  },
};

function run(args, home) {
  try {
    execFileSync(process.execPath, [CLI, 'thread', ...args], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', WALKDOWN_HOME: home },
    });
    return { refused: false };
  } catch (err) {
    return { refused: true, why: String(err.stderr) };
  }
}

async function post({ bp, home }, statusBody, action = 'status', replyBody = null) {
  process.env.WALKDOWN_HOME = home;
  const server = createWalkdownServer(bp);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/threads/n-0001/${action}`, {
      method: 'POST',
      // `connection: close` so the socket does not outlive the assertion and
      // hold the test runner open on a keep-alive nobody is using.
      headers: { 'content-type': 'application/json', connection: 'close' },
      /*
       * Carrying a name on purpose. This is the shape of the request that
       * verified a thread under an invented person, and every door must be
       * deaf to it — not merely the one that was patched.
       */
      body: JSON.stringify({
        ...(statusBody ?? {}),
        ...(replyBody ?? {}),
        actor: 'mallory',
        author: 'mallory',
      }),
    });
    return { refused: !res.ok, why: res.ok ? null : (await res.json()).error };
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

const NAMES = Object.keys(doors);

test('no door lets the caller name who a write is recorded under @rule:threads.lifecycle.acts-for-a-person', async () => {
  for (const name of NAMES) {
    const f = fixture();
    const out = await doors[name].claim(f);
    assert.equal(out.refused, false, `${name}: claiming is not accepting and must go through`);
    const reply = f.thread().replies.at(-1);
    assert.equal(reply.author, 'door-person', `${name}: recorded under this machine's person`);
    assert.notEqual(reply.author, 'mallory', `${name}: never under a name the ask carried`);
  }
});

test('no door accepts work on a machine that only has a guess @rule:threads.lifecycle.claim-never-accept', async () => {
  for (const name of NAMES) {
    const f = fixture({ declared: false });
    const out = await doors[name].verify(f);
    assert.equal(out.refused, true, `${name}: a guessed name is not a signature`);
    assert.match(out.why, /identity:/, `${name}: and every door says where to write one down`);
    assert.equal(f.thread().status, 'addressed', `${name}: the thread never moved`);
    assert.equal(f.thread().verified_by, undefined, `${name}: and nobody stood as accepter`);
  }
});

test('every door accepts work where the machine does name a person @rule:threads.lifecycle.claim-never-accept', async () => {
  for (const name of NAMES) {
    const f = fixture();
    const out = await doors[name].verify(f);
    assert.equal(out.refused, false, `${name}: ${out.why}`);
    assert.equal(f.thread().status, 'verified');
    assert.equal(f.thread().verified_by, 'door-person', `${name}: under the declared person`);
  }
});

test('claiming stays open to a machine that is guessing, at every door', async () => {
  // The gate is about ACCEPTING. An agent on an unnamed machine must still be
  // able to say what it did — refusing that would make the tool unusable for
  // the work it exists to support.
  for (const name of NAMES) {
    const f = fixture({ declared: false });
    const out = await doors[name].claim(f);
    assert.equal(out.refused, false, `${name}: claiming is not accepting`);
    assert.ok(f.thread().replies.at(-1).body.includes('looked at it'));
  }
});
