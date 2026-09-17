/*
 * The conversation both deliveries draw. One module, because the panel and
 * the embed must not disagree about what a message looks like.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MSG } from '../lib/message-stream.js';

/*
 * Provenance is shown beside the author, never instead of it
 * (@rule:threads.lifecycle.acts-for-a-person). An agent acting on somebody's
 * behalf records under that person - the instruction was theirs - so the only
 * way a reader can tell which sentences a person actually typed is if the
 * stream says so. It was written to disk and rendered nowhere, which made it a
 * field with no reader (n-0142).
 */
test('a message an agent typed says so, beside the person it was for @rule:threads.lifecycle.acts-for-a-person', () => {
  const html = MSG.stream({
    author: 'topher',
    via: 'agent',
    created: '2026-09-01T10:00:00Z',
    body: 'filed on your behalf',
    replies: [
      { author: 'topher', created: '2026-09-01T10:05:00Z', body: 'and this one I typed myself' },
      { author: 'topher', via: 'agent', created: '2026-09-02T09:00:00Z', body: 'this one it did' },
    ],
  });
  // Both names are the same person, so the author line cannot carry the
  // distinction on its own - which is the whole reason for the second field.
  assert.match(html, /Topher/i, 'the person, however the panel chooses to show their handle');
  assert.equal((html.match(/via agent/g) ?? []).length, 2, 'both agent messages, and only those');

  // A person typing is the ordinary case and is not annotated: an "authored by
  // a human" badge on nearly every message says nothing and costs a line.
  const plain = MSG.stream({
    author: 'topher',
    created: '2026-09-01T10:00:00Z',
    body: 'typed by hand',
  });
  assert.doesNotMatch(plain, /via/);
});

/*
 * And it survives the GROUPING, which is where it went missing (n-0147).
 *
 * Consecutive messages from one author drop the repeated name and tile, and
 * `via` was drawn on the first message of a run only, like the name it sits
 * beside. But an agent records under the person it acts for - this rule's own
 * first clause - so a person's message followed by their agent's always
 * grouped, and the one `via` the run was allowed sat on the person's message,
 * where it was not rendered because the person has none. A field with no
 * reader again, in exactly the case it exists for.
 *
 * A run is now one author AND one provenance: same speaker, and a machine
 * typing for somebody is a different speaker from that somebody.
 */
test('provenance survives grouping, and a machine is never grouped under the person @rule:threads.lifecycle.acts-for-a-person', () => {
  const seconds = (n) => `2026-09-01T20:0${n}:00Z`;
  const html = MSG.stream({
    author: 'topher',
    created: seconds(0),
    body: 'a person opens',
    replies: [
      { author: 'topher', created: seconds(1), body: 'the person again, a minute later' },
      { author: 'topher', via: 'agent', created: seconds(2), body: 'a sentence a machine typed' },
      { author: 'topher', via: 'agent', created: seconds(3), body: 'and another' },
      { author: 'topher', created: seconds(4), body: 'the person back' },
    ],
  });
  // Every one of these is within the grouping window and under one name, so
  // author alone would have made them a single run.
  assert.equal((html.match(/via agent/g) ?? []).length, 1, 'said once for the run, never zero');
  assert.equal(
    (html.match(/class="wd-who"/g) ?? []).length,
    3,
    'three runs: the person, the machine, the person again',
  );
});

/*
 * n-0298: the card under an id says what the id names. A rule: statement
 * and verdict. A thread: status, author, when, how it begins. Nothing for
 * an id the board does not know - an empty card is a box that says nothing.
 */
test('a reference previews the rule or thread it names, and nothing for one unknown @rule:threads.conversation.one-stream', () => {
  const rule = MSG.preview({
    rule: {
      rule: 'a.b.c',
      statement: 'Statement <b>as written</b>',
      verdict: 'fail',
      threads: [{ id: 'n-0001' }, { id: 'n-0002' }],
    },
    leaves: true,
  });
  assert.match(rule, /a\.b\.c/);
  assert.match(rule, /badge-error">fail/);
  assert.match(rule, /Statement &lt;b&gt;as written&lt;\/b&gt;/);
  assert.match(rule, /2 open threads/);
  assert.match(rule, /Opens in walkdown, in a new tab/);

  const thread = MSG.preview({
    thread: {
      id: 'n-0042',
      kind: 'note',
      reason: 'finding',
      status: 'addressed',
      author: 'topher',
      via: 'agent',
      created: new Date(Date.now() - 3 * 3600_000).toISOString(),
      body: 'The **first** line, with `code`.\n\nAnd a second paragraph nobody previews.',
      replies: [{}],
    },
    names: { topher: 'Topher Fangio' },
  });
  assert.match(thread, /n-0042/);
  assert.match(thread, /finding/);
  assert.match(thread, /badge-info">addressed/);
  assert.match(thread, /Topher Fangio/);
  assert.match(thread, /via agent/);
  assert.match(thread, /3h ago/);
  assert.match(thread, /1 reply/);
  assert.match(thread, /The first line, with code\./);
  assert.doesNotMatch(thread, /second paragraph/);
  assert.doesNotMatch(thread, /Opens in walkdown/);
  // Feedback is the default reason, so it is not worth a chip.
  assert.doesNotMatch(MSG.preview({ thread: { id: 'n-1', kind: 'note', reason: 'feedback', status: 'open' } }), /feedback/);

  assert.equal(MSG.preview({}), '');
  assert.equal(MSG.preview({ rule: undefined, thread: undefined }), '');
});

test('the first line of a body is its opening paragraph as plain words, cut to fit', () => {
  assert.equal(MSG.firstLine('- a list item\nwrapped'), 'a list item wrapped');
  assert.equal(MSG.firstLine('See [the doc](http://x) now'), 'See the doc now');
  assert.equal(MSG.firstLine('x'.repeat(200)).length, 160);
  assert.match(MSG.firstLine('x'.repeat(200)), /…$/);
  assert.equal(MSG.firstLine(null), '');
});

/*
 * A question's first line is the question, and the thread draws it as the
 * headline - a decision buried in a paragraph was a decision nobody saw
 * (n-0202). A note's opening message is its body, unchanged.
 */
test('a question opens with its first line as the headline; a note does not @rule:threads.conversation.one-stream', () => {
  const q = MSG.opening('question', 'Should the prompt hand out a port?\n\nContext: two judges collided.');
  assert.match(q, /^<div class="wd-ask">/);
  assert.match(q, /wd-ask">Should the prompt hand out a port\?<\/div>/);
  assert.match(q, /Context: two judges collided\./);
  assert.doesNotMatch(q, /wd-ask">[^<]*Context/);
  // One line only: the whole of it is the question.
  assert.equal(MSG.opening('question', 'Just this?'), '<div class="wd-ask">Just this?</div>');
  assert.doesNotMatch(MSG.opening('note', 'First line.\n\nMore.'), /wd-ask/);
  // And the stream draws it on the opening message alone, never a reply.
  const html = MSG.stream({
    kind: 'question', author: 'topher', created: '2026-01-01T00:00:00Z', body: 'Which?\nContext.',
    replies: [{ author: 'agent', created: '2026-01-01T01:00:00Z', body: 'This one.\nBecause.' }],
  });
  assert.equal((html.match(/wd-ask/g) ?? []).length, 1);
});
