/*
 * Identity vs display name (thread n-0104).
 *
 * Two facts about a person, told apart: the USERNAME, which is the only thing
 * a record is ever written under, and the DISPLAY NAME, which is what a person
 * reads and which nothing stores. This file covers the half of that split the
 * ledger has to guarantee - that the records already in it, written under a
 * full name back when there was one field, are still attributed to the person
 * who made them, and are never edited to match the newer shape.
 *
 * The panel's own behaviour - what the strip shows, what Settings offers - is a
 * browser check under panel.identity.default-actor, not this file.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MSG } from '../lib/message-stream.js';

/** What the server reports for a machine that knows both facts about its user. */
const identity = {
  username: 'topher',
  name: 'Topher Fangio',
  handles: ['topher', 'topherfangio', 'Topher Fangio'],
};

test('one person, every handle they have ever signed with @rule:status.attribution.username-is-the-record', () => {
  const names = MSG.nameMap(identity);

  // Written today: the username. Written last week, before the split: the
  // full name. Written by the CLI, which has always used the OS username.
  // Three strings, one person, one name on screen.
  for (const recorded of ['topher', 'Topher Fangio', 'topherfangio'])
    assert.equal(
      MSG.displayName(recorded, names),
      'Topher Fangio',
      `a record signed "${recorded}" still reads as its author`,
    );

  // Same face, too - an old verdict must not sit under a different colour
  // from the new one beside it.
  assert.equal(
    MSG.tint(MSG.displayName('Topher Fangio', names)),
    MSG.tint(MSG.displayName('topher', names)),
  );

  // The agent stays the agent, and a stranger is shown as recorded. Guessing
  // that two unrelated handles are one person is the failure this avoids.
  assert.equal(MSG.displayName('agent', names), 'Agent');
  assert.equal(MSG.displayName('dana', names), 'Dana');
});

test('a machine with no full name is known by its username alone @rule:status.attribution.username-is-the-record', () => {
  // Plenty of people have no `user.name`, which is exactly why the username
  // is the identity and the full name is not. Nothing here may fall over.
  const names = MSG.nameMap({ username: 'topher', name: '', handles: ['topher', 'topherfangio'] });
  assert.equal(MSG.displayName('topher', names), 'topher');
  assert.equal(MSG.displayName('topherfangio', names), 'topher');
  assert.deepEqual(MSG.nameMap({ username: '', name: '', handles: [] }), { agent: 'Agent' });
});

test('the old single-name form still resolves @rule:status.attribution.username-is-the-record', () => {
  // Callers that have only ever had one name - and the embed, until it was
  // handed the whole identity - pass a bare string. It reads as the display
  // name it always was, so nothing recorded under it is orphaned.
  const names = MSG.nameMap('Topher Fangio');
  assert.equal(MSG.displayName('Topher Fangio', names), 'Topher Fangio');
  assert.equal(MSG.displayName('topher', names), 'Topher Fangio');
});

test('a username that is not a string counts as nobody and names its file @rule:panel.identity.default-actor', async () => {
  /*
   * A list or a number under `identity.username:` used to be a TypeError out
   * of defaultActor - which took the panel down at GET /api/blueprint with a
   * stack trace and no word about which file to fix (n-0148). Read as nothing
   * said: not declared, the guess falls back to git or the OS, and `problem`
   * names the file and the shape so the refusal can point at the line.
   */
  const { defaultActor } = await import('../lib/identity.js');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'walkdown-identity-'));
  writeFileSync(join(home, 'config.yml'), 'identity:\n  username: [agent]\n  name: 7\n');
  const was = process.env.WALKDOWN_HOME;
  process.env.WALKDOWN_HOME = home;
  try {
    const who = defaultActor(process.cwd());
    assert.equal(who.declared, false);
    assert.notEqual(who.source, 'config');
    assert.ok(who.username, 'the guess is still a name, so the report still boots');
    assert.match(who.problem, /identity\.username.*config\.yml.*a list/);
    assert.notEqual(who.name, 7, 'a number is not a display name either');
    writeFileSync(join(home, 'config.yml'), 'identity:\n  username: " person "\n');
    const fine = defaultActor(process.cwd());
    assert.equal(fine.problem, null);
    assert.equal(fine.username, 'person');
    assert.equal(fine.declared, true);
  } finally {
    process.env.WALKDOWN_HOME = was;
  }
});
