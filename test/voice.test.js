/*
 * The voice, fault by fault (docs/13-voice.md). Each case is one habit the
 * gate names, and one sentence that has the habit's shape without the
 * habit - a quoted line of copy, a short aside between dashes, "no kind of
 * record" - so the check stays a check of shape and never of meaning.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { voiceFindings } from '../lib/voice.js';

const codes = (text, opts) => voiceFindings(text, opts).map((f) => f.code);

test('a clean sentence in a rule and on a thread passes every check @rule:ownership.authoring.machine-words-pass-the-voice', () => {
  const s = 'The panel shows the last thing said on the rule. Its history opens one slide to the right.';
  assert.deepEqual(codes(s, { field: 'statement' }), []);
  assert.deepEqual(codes('I looked at it and the pin sits where the step says.', { field: 'thread' }), []);
  assert.deepEqual(codes('', { field: 'thread' }), []);
});

test('a long sentence, a dash-chain, a hedge and throat-clearing are each named once @rule:ownership.authoring.machine-words-pass-the-voice', () => {
  const long = Array.from({ length: 41 }, (_, i) => `word${i}`).join(' ') + '.';
  assert.deepEqual(codes(long), ['long-sentence']);
  assert.deepEqual(codes('The strip names who is recording - the name they go by, with the username held in the title for anyone who hovers - and the roles they sign for sit under it.'), ['dash-clause']);
  assert.deepEqual(codes('The pin is drawn as a marker - a filled pin, tip down.'), [], 'one dash is punctuation');
  assert.deepEqual(codes('It waits - seconds, not milliseconds - so the veil is seen.'), [], 'a short aside between dashes is punctuation');
  assert.deepEqual(codes('It is probably the ghost that takes the pointer.'), ['hedge']);
  assert.deepEqual(codes('No kind of record sits inside another.'), [], '"kind of" counts things; it is not a hedge');
  assert.deepEqual(codes('Note that the ghost takes the pointer.'), ['throat-clearing']);
  assert.deepEqual(codes('It works!'), ['exclamation']);
});

test('house words are named with the plain word, but not inside a code span or a quote @rule:ownership.authoring.machine-words-pass-the-voice', () => {
  const [f] = voiceFindings('The run records its provenance.');
  assert.equal(f.code, 'house-word');
  assert.match(f.message, /where it came from/);
  assert.deepEqual(codes('The rule `locations.travel.provenance-not-currency` passes.'), []);
  assert.deepEqual(codes('The tooltip reads "provenance".'), []);
});

test('a rule is not in the first person; a thread may be; a statement does not restate its steps @rule:ownership.authoring.machine-words-pass-the-voice', () => {
  assert.deepEqual(codes('From the detail I can step to the next rule.', { field: 'statement' }), ['first-person']);
  assert.deepEqual(codes('We keep the ledger append-only.', { field: 'step' }), ['first-person']);
  assert.deepEqual(codes('I can see the ledger is append-only.', { field: 'thread' }), []);
  const step = 'Anchor `x` shows the last thing said on the rule tagged with who said it';
  assert.deepEqual(
    codes('The detail shows the last thing said on the rule tagged with who said it.', { field: 'statement', steps: [step] }),
    ['restates-steps'],
  );
  assert.deepEqual(codes('The detail shows only the newest message.', { field: 'statement', steps: [step] }), []);
  assert.deepEqual(
    codes('Anchor `x` reads "you\'re already on the list" after the second join.', { field: 'statement', steps: ['Anchor `y` reads "you\'re already on the list"'] }),
    [],
    'quoted copy shared with a step is a name, not a restatement',
  );
});
