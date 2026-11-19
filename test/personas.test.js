import assert from 'node:assert/strict';
import { test } from 'node:test';
import { peopleOf, signedInAs, signInSteps, userSetup } from '../lib/personas.js';
import { resolveSetup, setupSignature } from '../lib/setup.js';
import { run } from '../tools/cli-scenarios.mjs';

const storyboard = {
  personas: [
    {
      id: 'manager',
      title: 'Manager',
      users: [
        { id: 'team', title: 'Team manager', setup: [{ visit: '/dev/as/{fixtures.team}' }] },
        { id: 'org', title: 'Org manager', setup: { recipe: 'as_org' } },
      ],
    },
    { id: 'visitor', title: 'Visitor' },
  ],
  recipes: { as_org: [{ post: '/dev/session', fields: { id: '{fixtures.org}' } }] },
};
const people = peopleOf({ dir: '/nowhere', storyboard });
const at = (app) => ({ id: 'x', app });

test("a screen's as names a user, or a persona alone for its first user, or nobody @rule:screens.setup.as-names-a-user", () => {
  assert.equal(people.state, 'own');
  assert.equal(signedInAs(at({ path: '/a' }), people).kind, 'none');
  assert.equal(signedInAs(at({ as: 'manager.org' }), people).id, 'manager.org');
  // A persona alone is its first user.
  assert.equal(signedInAs(at({ as: 'manager' }), people).id, 'manager.team');
  // A persona with no users is one nobody signs in as, and is still a name that holds.
  assert.equal(signedInAs(at({ as: 'visitor' }), people).kind, 'nobody');
  assert.deepEqual(signInSteps(at({ as: 'visitor' }), people), []);
  assert.equal(signedInAs(at({ as: 'auditor' }), people).kind, 'no-persona');
  assert.equal(signedInAs(at({ as: 'manager.admin' }), people).kind, 'no-user');
  // A user's recipe is read from the storyboard that declares the user.
  assert.equal(userSetup(storyboard.personas[0].users[1], people).recipe, 'as_org');
  // People that could not be read name nobody, and are no fault of the screen's.
  assert.equal(signedInAs(at({ as: 'manager' }), { known: false }).kind, 'unread');
});

test("who a screen is signed in as is part of which screen it is, and a user's steps written out are that user @rule:screens.identity.user-is-identity", () => {
  const sig = (app) => setupSignature(at(app), storyboard, signInSteps(at(app), people));
  assert.notEqual(sig({ as: 'manager.team', path: '/e' }), sig({ as: 'manager.org', path: '/e' }));
  assert.equal(
    sig({ as: 'manager.org', path: '/e' }),
    sig({ setup: { recipe: 'as_org' }, path: '/e' }),
  );
  assert.equal(sig({ as: 'manager', path: '/e' }), sig({ as: 'manager.team', path: '/e' }));
  // Prose is not run, so a screen with `as:` and prose is its user's steps and its path.
  assert.equal(
    sig({ as: 'manager.team', setup: 'Then open the menu.', path: '/e' }),
    sig({ as: 'manager.team', path: '/e' }),
  );
  // Nobody signed in, and no setup, reads as it always has.
  assert.equal(sig({ as: 'visitor', path: '/e' }), '');
});

test("the user's steps run first and say whose they are; the screen's own follow @rule:screens.setup.as-names-a-user", () => {
  const screen = at({ as: 'manager.team', setup: [{ visit: '/inbox' }], path: '/e/{fixtures.e}' });
  const r = resolveSetup(screen, storyboard, { team: 18, e: 412 }, signInSteps(screen, people));
  assert.deepEqual(r.steps, [
    { kind: 'visit', value: '/dev/as/18', whose: 'user' },
    { kind: 'visit', value: '/inbox' },
  ]);
  assert.equal(r.path, '/e/412');
  // A fixture the user's step names and the target lacks is missing, as a screen's would be.
  assert.deepEqual(
    resolveSetup(screen, storyboard, { e: 1 }, signInSteps(screen, people)).missing,
    ['team'],
  );
});

test('a sibling may name a persona or user the blueprint it names declares, and is refused one it does not @rule:personas.declared.shared-by-siblings', () => {
  const out = run({ fixture: 'personas-from-sibling', cwd: 'expenses', command: ['lint'] });
  assert.equal(out.status, 1, out.text);
  // travel's story is `as: manager` and one screen `as: manager.view-only-team`: neither is said.
  assert.doesNotMatch(out.text, /travel\.view: `as:`/);
  assert.doesNotMatch(out.text, /trip-team: `as:`/);
  assert.match(
    out.text,
    /✗ \[personas\] travel\/storyboard\.yml › trip-audit: `as:` names `auditor`, which is not a persona/,
  );
  // And the blueprint that declares them is not told its personas are unused.
  assert.doesNotMatch(out.text, /no story and no screen names this persona/);
});

test('a storyboard with no groups is not asked for one, and a persona with no users is accepted @rule:personas.declared.named-and-distinct', () => {
  const none = peopleOf({ dir: '/nowhere', storyboard: { screens: [] } });
  assert.deepEqual([none.state, none.personas.length, none.groups.length], ['own', 0, 0]);
  assert.equal(people.groups.length, 0);
});

test('a screen nobody signs in as is warned about only after one a user does, and only with no setup of its own @rule:screens.setup.nobody-after-a-user-is-warned', () => {
  const said = /nobody signs in for this screen/g;
  const out = run({ fixture: 'nobody-after-a-user', cwd: 'expenses', command: ['lint'] });
  assert.equal(out.status, 0, out.text);
  assert.equal(out.text.match(said)?.length, 1, out.text);
  // expense-help is as the same persona, and signs out in a step of its own.
  assert.doesNotMatch(out.text, /expense-help/);
  // Where no persona has a user, no session is left over for a screen to meet.
  const none = run({ fixture: 'nobody-signs-in', cwd: 'expenses', command: ['lint'] });
  assert.equal(none.status, 0, none.text);
  assert.doesNotMatch(none.text, said);
});
