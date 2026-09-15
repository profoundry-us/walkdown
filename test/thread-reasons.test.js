/*
 * ADR 0005 - a thread closes where it was asked. A note says why it exists,
 * a machine's finding is signed by the machine, a decision is filed closed,
 * an observation is the agent's to settle, and a person's signed pass on a
 * rule verifies the findings and feedback that were waiting on exactly that
 * look. Exercised through the doors the browser and the CLI use, on a
 * throwaway home with a declared person at it.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { createWalkdownServer } from '../lib/serve.js';
import { closeByVerdict } from '../lib/threads.js';
import { finishWalkdown, mutateThread, openThread } from '../lib/writes.js';
import { declaredHome } from '../tools/test-home.mjs';
import { parse } from '../vendor/yaml.js';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'walkdown-reasons-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.yml'), 'identity:\n  username: reasons-person\n');
  process.env.WALKDOWN_HOME = home;
  const h = declaredHome(join(root, 'proj'), 'reasons-fixture');
  const bp = h.spec;
  mkdirSync(join(bp, 'features'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'blueprint: reasons-fixture\n');
  writeFileSync(join(bp, 'storyboard.yml'), 'screens: []\n');
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    [
      'feature: demo',
      'stories:',
      '  - id: demo.main',
      '    rules:',
      '      - id: demo.main.thing',
      '        statement: The visitor can do the thing.',
      '        verify: [checks]',
      '        signoff: [eng]',
      '      - id: demo.main.other',
      '        statement: The visitor can do the other thing.',
      '        verify: [checks]',
    ].join('\n'),
  );
  const load = () => loadBlueprint(bp, { cwd: h.root });
  const onDisk = (id) => parse(readFileSync(join(load().at.threads.path, `${id}.yml`), 'utf8'));
  return { root, h, bp, load, onDisk, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const RULE = 'demo.main.thing';

test('a note says why it exists, and the machine signs its own @rule:threads.lifecycle.says-why-it-exists', () => {
  const p = project();
  try {
    // A judge's finding and an agent's observation are the machine's own
    // account: authored agent, never under the person whose machine it is,
    // and never marked as typed FOR that person.
    const finding = openThread(p.load(), { kind: 'note', body: 'seen', anchor: { rule: RULE }, via: 'agent', reason: 'finding' });
    assert.equal(finding.thread.reason, 'finding');
    assert.equal(finding.thread.author, 'agent');
    assert.equal(finding.thread.via, undefined);
    assert.equal(finding.thread.status, 'open');
    const obs = openThread(p.load(), { kind: 'note', body: 'noticed', anchor: { rule: RULE }, via: 'agent' });
    assert.equal(obs.thread.reason, 'observation', 'a machine with nothing said is observing');
    assert.equal(obs.thread.author, 'agent');
    // A person's words are feedback, under their name, unless they say otherwise.
    const fb = openThread(p.load(), { kind: 'note', body: 'hm', anchor: { rule: RULE } });
    assert.equal(fb.thread.reason, 'feedback');
    assert.equal(fb.thread.author, 'reasons-person');
    // A person's words a machine typed keep the mark - that is what via is for.
    const dictated = openThread(p.load(), { kind: 'note', body: 'said', anchor: { rule: RULE }, via: 'agent', reason: 'feedback' });
    assert.equal(dictated.thread.author, 'reasons-person');
    assert.equal(dictated.thread.via, 'agent');
    // A decision is a record: filed closed, in no queue.
    const dec = openThread(p.load(), { kind: 'note', body: 'we decided', anchor: { rule: RULE }, reason: 'decision' });
    assert.equal(dec.thread.status, 'recorded');
    assert.equal(p.onDisk(dec.id).status, 'recorded');
    // A word nothing knows is refused, and a question carries none.
    assert.throws(() => openThread(p.load(), { kind: 'note', body: 'x', anchor: { rule: RULE }, reason: 'hunch' }), /unknown reason/);
    assert.throws(() => openThread(p.load(), { kind: 'question', body: 'x?', anchor: { rule: RULE }, reason: 'feedback' }), /question carries no reason/);
    const q = openThread(p.load(), { kind: 'question', body: 'x?', anchor: { rule: RULE } });
    assert.equal(q.thread.reason, undefined);
    // An empty reason is no reason: the default answers, and a machine's
    // note still signs as the machine (n-0295).
    const blank = openThread(p.load(), { kind: 'note', body: 'blank', anchor: { rule: RULE }, via: 'agent', reason: '  ' });
    assert.equal(blank.thread.reason, 'observation');
    assert.equal(blank.thread.author, 'agent');
    assert.equal(blank.thread.via, undefined);
    const blankPerson = openThread(p.load(), { kind: 'note', body: 'blank', anchor: { rule: RULE }, reason: '' });
    assert.equal(blankPerson.thread.reason, 'feedback');
  } finally {
    p.cleanup();
  }
});

test('an observation is settled by the agent; nothing else is @rule:threads.lifecycle.closes-where-it-was-asked', () => {
  const p = project();
  try {
    const obs = openThread(p.load(), { kind: 'note', body: 'noticed', anchor: { rule: RULE }, via: 'agent', reason: 'observation' });
    const done = mutateThread(p.load(), obs.id, { body: 'changed it', status: 'settled', via: 'agent' });
    assert.equal(done.thread.status, 'settled');
    assert.equal(p.onDisk(obs.id).status, 'settled');
    // Feedback, a finding and a request wait on a person's look.
    for (const reason of ['feedback', 'finding', 'request']) {
      const t = openThread(p.load(), { kind: 'note', body: reason, anchor: { rule: RULE }, reason });
      assert.throws(
        () => mutateThread(p.load(), t.id, { status: 'settled', via: 'agent' }),
        /only an observation is settled/,
        reason,
      );
    }
  } finally {
    p.cleanup();
  }
});

test('a signed pass verifies the findings and feedback addressed before it @rule:threads.lifecycle.closes-where-it-was-asked', () => {
  const p = project();
  try {
    const file = (reason, rule = RULE) =>
      openThread(p.load(), { kind: 'note', body: reason, anchor: { rule }, reason, via: reason === 'finding' ? 'agent' : null }).id;
    const finding = file('finding');
    const feedback = file('feedback');
    const request = file('request');
    const elsewhere = file('finding', 'demo.main.other');
    const stillOpen = file('finding');
    for (const id of [finding, feedback, request, elsewhere])
      mutateThread(p.load(), id, { body: 'fixed', status: 'addressed', via: 'agent' });

    // A walkdown signed in a role, passing the rule: the finding and the
    // feedback on it close under the signer's name; the request waits on a
    // person as ever, the other rule's finding is not this look, and an open
    // note has no fix to accept.
    const record = finishWalkdown(p.load(), {
      target: 'local',
      baseUrl: null,
      roles: ['eng'],
      signatures: [{ role: 'eng', signer: 'reasons-person' }],
      results: [{ rule: RULE, status: 'pass' }],
    });
    assert.deepEqual([...record.closed].sort(), [feedback, finding].sort());
    for (const id of [finding, feedback]) {
      const t = p.onDisk(id);
      assert.equal(t.status, 'verified', id);
      assert.equal(t.verified_by, 'reasons-person');
      assert.equal(t.verified_via, record.run_id);
      assert.match(t.replies.at(-1).body, /Verified by reasons-person's pass/);
      assert.equal(t.replies.at(-1).via, 'verdict');
    }
    assert.equal(p.onDisk(request).status, 'addressed');
    assert.equal(p.onDisk(elsewhere).status, 'addressed');
    assert.equal(p.onDisk(stillOpen).status, 'open');

    // A fix claimed AFTER the pass is not what the person looked at.
    const later = file('finding');
    mutateThread(p.load(), later, { body: 'fixed', status: 'addressed', via: 'agent' });
    const closed = closeByVerdict(p.load(), {
      rule: RULE,
      signer: 'reasons-person',
      runId: 'earlier',
      created: '2020-01-01T00:00:00Z',
    });
    assert.deepEqual(closed, []);
    assert.equal(p.onDisk(later).status, 'addressed');

    // A fail closes nothing, an unsigned walkdown accepts nothing, and a
    // machine's pass is never a person's look.
    const failed = finishWalkdown(p.load(), {
      target: 'local',
      baseUrl: null,
      roles: ['eng'],
      signatures: [{ role: 'eng', signer: 'reasons-person' }],
      results: [{ rule: RULE, status: 'fail' }],
    });
    assert.deepEqual(failed.closed, []);
    const unsigned = finishWalkdown(p.load(), {
      target: 'local',
      baseUrl: null,
      roles: [],
      signatures: [],
      results: [{ rule: RULE, status: 'pass' }],
    });
    assert.deepEqual(unsigned.closed, []);
    assert.equal(p.onDisk(later).status, 'addressed');
    assert.deepEqual(closeByVerdict(p.load(), { rule: RULE, signer: 'agent', runId: 'x', created: '2099-01-01T00:00:00Z' }), []);
  } finally {
    p.cleanup();
  }
});

test('the browser doors carry the reason and say what a pass closed @rule:threads.lifecycle.closes-where-it-was-asked', async () => {
  const p = project();
  const server = createWalkdownServer(p.bp, { cwd: p.h.root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => ({ ok: r.ok, data: await r.json() }));
  try {
    const dec = await post('/api/threads', { kind: 'note', body: 'we decided', reason: 'decision', anchor: { rule: RULE } });
    assert.ok(dec.ok, JSON.stringify(dec.data));
    assert.equal(p.onDisk(dec.data.id).status, 'recorded');
    const bad = await post('/api/threads', { kind: 'note', body: 'x', reason: 'hunch', anchor: { rule: RULE } });
    assert.equal(bad.ok, false);

    const fb = await post('/api/threads', { kind: 'note', body: 'my note', anchor: { rule: RULE } });
    assert.equal(p.onDisk(fb.data.id).reason, 'feedback');
    assert.ok((await post(`/api/threads/${fb.data.id}/status`, { status: 'addressed', via: 'agent' })).ok);
    const sealed = await post('/api/walkdowns', {
      target: 'local',
      signatures: [{ role: 'eng', signer: 'reasons-person' }],
      results: [{ rule: RULE, status: 'pass' }],
    });
    assert.ok(sealed.ok, JSON.stringify(sealed.data));
    assert.deepEqual(sealed.data.closed, [fb.data.id]);
    assert.equal(p.onDisk(fb.data.id).status, 'verified');
  } finally {
    server.closeAllConnections();
    server.close();
    p.cleanup();
  }
});
