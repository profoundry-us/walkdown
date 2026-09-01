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
