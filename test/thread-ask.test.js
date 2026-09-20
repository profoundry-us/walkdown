import { declaredHome } from '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { MSG } from '../lib/message-stream.js';
import { defer, offer, openThread, transition } from '../lib/writes.js';
import { parse } from '../vendor/yaml.js';

/*
 * A question is one ask, and the ways out of it are data: options the
 * agent offers, a `chosen` label the answer records, and `deferred` when
 * the person puts it off. The prose alternative - three paragraphs with
 * the fork somewhere in the third - is what q-0257 and q-0262 were.
 */
const root = mkdtempSync(join(tmpdir(), 'walkdown-ask-'));
const h = declaredHome(root, 'ask');
const bp = h.spec;
after(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  rmSync(h.threads, { recursive: true, force: true });
  mkdirSync(h.threads, { recursive: true });
  mkdirSync(join(bp, 'features'), { recursive: true });
  writeFileSync(join(bp, 'walkdown.yml'), 'blueprint: ask\n');
  writeFileSync(
    join(bp, 'features', 'demo.yml'),
    'feature: demo\nstories:\n  - id: demo.main\n    rules:\n      - id: demo.main.thing\n        statement: It works.\n        verify: [checks]\n',
  );
});

const load = () => loadBlueprint(bp, { cwd: h.root });
const onDisk = (id) => parse(readFileSync(join(h.threads, `${id}.yml`), 'utf8'));
const ask = (options) =>
  openThread(load(), {
    kind: 'question',
    body: 'Does this rule still have a job?\n\nTwo rules describe the same moment.',
    anchor: { rule: 'demo.main.thing' },
    via: 'agent',
    options,
  });

test('a question offers its choices as data, and the answer names one @rule:threads.question.one-ask', () => {
  const { id } = ask([
    { label: 'Retire it', why: 'which-project asks the same thing' },
    { label: 'Reword it' },
  ]);
  assert.deepEqual(onDisk(id).options, [{ label: 'Retire it', why: 'which-project asks the same thing' }, { label: 'Reword it' }]);

  // The answer records the label beside the reply; the stream marks it.
  transition(load(), id, { status: 'answered', reason: 'Yes - the other screen asks it.', chosen: 'Retire it' });
  const t = onDisk(id);
  assert.equal(t.status, 'answered');
  assert.equal(t.chosen, 'Retire it');
  assert.equal(t.replies.at(-1).body, 'Yes - the other screen asks it.');
  const drawn = MSG.stream(t);
  assert.match(drawn, /wd-opt chosen"><b>Retire it<\/b>/);
  assert.match(drawn, /wd-opt"><b>Reword it<\/b>/);
});

test('a choice the question never offered is refused, and so are malformed choices @rule:threads.question.one-ask', () => {
  const { id } = ask([{ label: 'A' }, { label: 'B' }]);
  assert.throws(() => transition(load(), id, { status: 'answered', reason: 'C', chosen: 'C' }), /not one of the choices/);
  assert.equal(onDisk(id).status, 'open');
  assert.throws(() => ask([{ label: 'Only one' }]), /two to six/);
  assert.throws(() => ask([{ label: 'Same' }, { label: 'Same' }]), /share a label/);
  assert.throws(() => ask([{ label: '' }, { label: 'B' }]), /needs a label/);
  assert.throws(
    () => openThread(load(), { kind: 'note', body: 'A note.', anchor: { rule: 'demo.main.thing' }, options: [{ label: 'A' }, { label: 'B' }] }),
    /a note offers none/,
  );
});

test('later stamps the ask deferred and changes nothing else @rule:threads.question.one-ask', () => {
  const { id } = ask(null);
  const before = onDisk(id);
  const { thread } = defer(load(), id);
  assert.match(thread.deferred, /^\d{4}-\d{2}-\d{2}T/);
  const after_ = onDisk(id);
  assert.equal(after_.status, 'open');
  assert.deepEqual({ ...after_, deferred: undefined }, { ...before, deferred: undefined });
  // An answered question has no queue to leave.
  transition(load(), id, { status: 'answered', reason: 'Yes.' });
  assert.throws(() => defer(load(), id), /not an open question/);
});

test('choices go on a question already asked, once, while it is open @rule:threads.question.one-ask', () => {
  const { id } = ask(null);
  offer(load(), id, [{ label: 'Leave it', why: 'a hand edit gets what it asked for' }, { label: 'Say so in the rule' }]);
  assert.deepEqual(onDisk(id).options.map((o) => o.label), ['Leave it', 'Say so in the rule']);
  assert.throws(() => offer(load(), id, [{ label: 'A' }, { label: 'B' }]), /already offers/);
  transition(load(), id, { status: 'answered', reason: 'The first.', chosen: 'Leave it' });
  assert.equal(onDisk(id).chosen, 'Leave it');
  const note = openThread(load(), { kind: 'note', body: 'A note.', anchor: { rule: 'demo.main.thing' } });
  assert.throws(() => offer(load(), note.id, [{ label: 'A' }, { label: 'B' }]), /not an open question/);
});
