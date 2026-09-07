/*
 * One schema for a sitting, and proof that every field survives the trip.
 *
 * A walkdown in progress crosses four hands before it is on disk — the
 * panel's session, the draft door, writes.js, writeDraft — and for a while
 * each of them named the fields it carried in its own object literal. A
 * field named in three of the four was silently dropped by the fourth: roles
 * twice, signatures twice, four instances of one bug in a fortnight, and
 * every one of them found by a person reading JSON after the fact.
 *
 * These tests are the thing that would have caught all four. The fixture
 * below holds one distinctive value per field in SITTING_FIELDS, and the
 * completeness check means a field added to the list with no fixture fails
 * here rather than shipping untested. Everything else pushes that fixture
 * through a hop and demands it come out whole.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeDraft } from '../lib/draft.js';
import { SITTING_FIELDS, sitting } from '../lib/sitting.js';

/** A sitting with every field carrying something recognisable. */
const FULL = {
  started: '2026-09-07T12:00:00Z',
  signatures: [
    { role: 'eng', signer: 'topher' },
    { role: 'product', signer: 'sam' },
  ],
  verdicts: { 'demo.main.thing': 'pass' },
  threads: { 'demo.main.thing': ['n-0001'] },
};

test('the fixture covers the whole schema, so a new field cannot go untested', () => {
  assert.deepEqual(
    Object.keys(FULL).sort(),
    [...SITTING_FIELDS].sort(),
    'add the new field to FULL in this file — every hop below is checked against it',
  );
});

test('sitting() carries every field, and nothing a caller may not name', () => {
  assert.deepEqual(sitting(FULL), FULL);
  // Order is the schema's, not the caller's: two drafts written from the same
  // session read identically whatever order the keys arrived in.
  assert.deepEqual(Object.keys(sitting({ threads: FULL.threads, started: FULL.started })), [
    'started',
    'threads',
  ]);
  // `actor` and `target` are not the caller's to name — writes.js stamps who
  // is acting, and the target is routing. Neither survives this door.
  assert.deepEqual(sitting({ ...FULL, actor: 'somebody-else', target: 'prod', draft: true }), FULL);
  // Empty is absent, so a default behind a spread is not overwritten by
  // nothing: a sitting from before signatures existed does not claim to have
  // chosen to have none.
  assert.deepEqual(sitting({ signatures: [], threads: {}, verdicts: {}, started: '  ' }), {});
  assert.deepEqual(sitting(null), {});
});

test('writeDraft puts every field of a sitting on disk @rule:panel.walkdown.draft-on-disk', () => {
  const drafts = mkdtempSync(join(tmpdir(), 'wd-sitting-'));
  const written = writeDraft(drafts, { target: 'local', actor: 'topher', ...FULL });
  const onDisk = JSON.parse(readFileSync(join(drafts, 'local.json'), 'utf8'));
  for (const field of SITTING_FIELDS) {
    assert.deepEqual(written[field], FULL[field], `writeDraft returned no ${field}`);
    assert.deepEqual(onDisk[field], FULL[field], `${field} never reached the file`);
  }
  // The writer's own bookkeeping, which no caller may name.
  assert.equal(onDisk.draft, true);
  assert.equal(onDisk.actor, 'topher');
  assert.ok(onDisk.updated);
});

test('a session with no start of its own is given one, not left without', () => {
  const drafts = mkdtempSync(join(tmpdir(), 'wd-sitting-'));
  const { started } = writeDraft(drafts, { actor: 'topher', started: undefined, ...{ verdicts: FULL.verdicts } });
  assert.match(started, /^\d{4}-\d{2}-\d{2}T/);
});

/*
 * The structural half. The tests above prove the field list works; this one
 * proves each hop is actually using it, because a hop that goes back to
 * spelling its own fields out passes every round-trip above right up until
 * somebody adds a field.
 */
test('every hop takes its fields from the one list, never its own', () => {
  const hops = ['lib/api.js', 'lib/draft.js', 'src/panel/app.js'];
  for (const hop of hops) {
    const src = readFileSync(new URL(`../${hop}`, import.meta.url), 'utf8');
    assert.match(
      src,
      /import \{ sitting \} from '.*sitting\.js'/,
      `${hop} carries a session and does not take its shape from lib/sitting.js`,
    );
  }
});
