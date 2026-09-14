/*
 * When things happened: written as UTC instants, read on the reader's clock
 * (n-0290). The library first, then every stamp this repo's own ledger holds,
 * since a rule about what walkdown writes is best checked against what it has
 * written.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { MSG } from '../lib/message-stream.js';
import { dateIn, isoNow, knownZone, readerZone, whenIn } from '../lib/time.js';
import { parse } from '../vendor/yaml.js';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

test('now is written as a whole-second UTC instant @rule:time.records.stored-as-utc', () => {
  assert.match(isoNow(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('a declared zone is read; an unknown one falls back to the machine and says so @rule:time.records.read-in-your-zone', () => {
  assert.equal(knownZone('America/Chicago'), 'America/Chicago');
  assert.equal(knownZone('Mars/Olympus_Mons'), null);
  assert.equal(knownZone(''), null);
  assert.equal(knownZone(42), null);
  const said = readerZone('Asia/Tokyo');
  assert.deepEqual(said, { zone: 'Asia/Tokyo', source: 'config', problem: null });
  const unsaid = readerZone(undefined);
  assert.equal(unsaid.source, 'machine');
  assert.equal(unsaid.problem, null);
  assert.ok(knownZone(unsaid.zone), 'the machine zone is a real one');
  const wrong = readerZone('Mars/Olympus_Mons');
  assert.equal(wrong.source, 'machine');
  assert.match(wrong.problem, /Mars\/Olympus_Mons/);
  assert.match(wrong.problem, /America\/Chicago/, 'the message shows what a zone name looks like');
});

test('an instant reads as a clock in the zone, with the zone beside it @rule:time.records.read-in-your-zone', () => {
  const at = '2026-01-01T00:00:00Z';
  assert.equal(whenIn(at, 'Asia/Tokyo'), 'Jan 1, 2026, 9:00 AM GMT+9');
  assert.equal(whenIn(at, 'America/Chicago'), 'Dec 31, 2025, 6:00 PM CST');
  assert.equal(dateIn(at, 'Asia/Tokyo'), '2026-01-01');
  assert.equal(dateIn(at, 'America/Chicago'), '2025-12-31');
  // What is not a time is handed back, not turned into "Invalid Date".
  assert.equal(whenIn('undated', 'Asia/Tokyo'), 'undated');
  assert.equal(whenIn(null, 'Asia/Tokyo'), '');
});

test('the message stream reads its clocks in the zone it is given @rule:time.records.read-in-your-zone', () => {
  const at = '2026-01-01T00:00:00Z';
  const was = MSG.zone;
  try {
    MSG.zone = 'Asia/Tokyo';
    assert.match(MSG.stamp(at), /9:00.*AM.*GMT\+9/);
    MSG.zone = 'America/Chicago';
    assert.match(MSG.stamp(at), /6:00.*PM.*CST/);
    assert.match(MSG.lastReply(at), /6:00 PM$/);
  } finally {
    MSG.zone = was;
  }
});

/*
 * The ledger itself. Every thread, reply, run, draft and reworded entry in
 * this repo's own blueprint stamps an instant with a Z - and none names a
 * zone. Read as text so a stamp YAML would have turned into a Date is seen
 * as it was written.
 */
const HOME = new URL('../.walkdown/blueprints/0001-walkdown/', import.meta.url).pathname;
const files = (dir, ext) => {
  let out = [];
  try {
    out = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return out.flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : []));
};

test('every stamp in this blueprint\'s own records is a UTC instant and none names a zone @rule:time.records.stored-as-utc', () => {
  const stamped = [];
  for (const f of files(join(HOME, 'threads'), '.yml')) {
    const t = parse(readFileSync(f, 'utf8'));
    stamped.push([f, t.created]);
    for (const r of t.replies ?? []) stamped.push([f, r.created]);
  }
  for (const f of files(join(HOME, 'runs'), '.json')) {
    const r = JSON.parse(readFileSync(f, 'utf8'));
    // A run with no date at all is lint's finding (it fills no cell); this
    // is about the shape of the dates that were written.
    if (r.created !== undefined) stamped.push([f, r.created]);
  }
  for (const f of files(join(HOME, 'blueprint', 'features'), '.yml')) {
    const y = parse(readFileSync(f, 'utf8'));
    for (const s of y.stories ?? [])
      for (const r of s.rules ?? [])
        for (const w of r.steps?.reworded ?? [])
          // The entries before n-0290 were stamped as bare dates; those are
          // history and stay. Anything written since is an instant.
          if (typeof w.at === 'string' && w.at.includes('T')) stamped.push([f, w.at]);
  }
  assert.ok(stamped.length > 500, `the ledger is not empty (${stamped.length})`);
  const wrong = stamped.filter(([, at]) => !INSTANT.test(String(at)));
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} stamp(s) are not UTC instants`);
  for (const f of files(join(HOME, 'threads'), '.yml'))
    assert.doesNotMatch(readFileSync(f, 'utf8'), /^\s*(timezone|tz|zone):/m, `${f} names a zone`);
});
