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
