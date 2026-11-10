import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadBlueprint } from '../lib/blueprint.js';
import { fixturesFor, keepFixtures, keptFixturesPath } from '../lib/fixtures.js';
import { lint } from '../lib/lint.js';
import { walkdownHome } from '../lib/locations.js';
import { resolveSetup, setupOf, setupSignature } from '../lib/setup.js';
import { declaredHome } from '../tools/test-home.mjs';

const root = mkdtempSync(join(tmpdir(), 'walkdown-setup-'));
after(() => rmSync(root, { recursive: true, force: true }));

/* A home with the given storyboard and targets, and one rule per screen. */
function home(name, { screens, recipes = '', targets }) {
  const h = declaredHome(join(root, name));
  mkdirSync(join(h.spec, 'features'), { recursive: true });
  writeFileSync(join(h.spec, 'spec.yml'), `blueprint: ${name}\nrunner:\n  targets:\n${targets}\n`);
  writeFileSync(join(h.spec, 'storyboard.yml'), `screens:\n${screens}\n${recipes}`);
  return h;
}
const load = (h) => loadBlueprint(h.spec, { cwd: h.root });
const about = (h, category) =>
  lint(load(h), { checks: false }).findings.filter((f) => f.category === category);

const SCREEN = (id, app) =>
  `  - id: ${id}\n    design: /${id}/20261023.html\n    app: ${app}\n    anchors: [${id}.body]`;

test('a setup is prose, steps, or a recipe; a recipe and its steps written out are one setup @rule:screens.setup.steps-or-prose', () => {
  const storyboard = { recipes: { as_admin: [{ visit: '/dev/as/{fixtures.admin}' }] } };
  assert.equal(setupOf({ app: { setup: 'Sign in first.' } }, storyboard).kind, 'prose');
  assert.equal(setupOf({ app: {} }, storyboard).kind, 'none');
  const named = { app: { setup: { recipe: 'as_admin' }, path: '/a/{fixtures.id}' } };
  const written = { app: { setup: [{ visit: '/dev/as/{fixtures.admin}' }], path: '/a' } };
  assert.equal(setupSignature(named, storyboard), setupSignature(written, storyboard));
  assert.equal(setupOf({ app: { setup: { recipe: 'nobody' } } }, storyboard).missingRecipe, true);

  // What the panel is handed: every fixture filled in, and the ones with no value named.
  const run = resolveSetup(named, storyboard, { admin: 7 });
  assert.deepEqual(run.steps, [{ kind: 'visit', value: '/dev/as/7' }]);
  assert.equal(run.path, '/a/{fixtures.id}');
  assert.deepEqual(run.missing, ['id']);
});

test('fixtures set on this machine are merged key by key, win over spec.yml, and are written nowhere near the blueprint @rule:screens.setup.fixtures-set-keeps-this-machines-values @rule:screens.setup.fixtures-per-target', () => {
  const h = home('kept', {
    screens: SCREEN('expense', '{ path: "/expenses/{fixtures.expense}" }'),
    targets:
      '    local:\n      base_url: http://localhost:3000\n      fixtures: { expense: 1, manager: 2 }',
  });
  const bp = load(h);
  const id = bp.at.id;
  const before = readdirSync(h.spec).sort();
  assert.deepEqual(fixturesFor(bp.config, id, 'local'), {
    values: { expense: 1, manager: 2 },
    kept: false,
  });

  keepFixtures(id, 'local', { expense: 412 });
  keepFixtures(id, 'local', { remember: true });
  // The value that was set wins; a key only spec.yml gives is still there;
  // the second run kept the first run's key.
  assert.deepEqual(fixturesFor(bp.config, id, 'local'), {
    values: { expense: 412, manager: 2, remember: true },
    kept: true,
  });
  // Another target is untouched.
  assert.equal(fixturesFor(bp.config, id, 'review').kept, false);

  const file = keptFixturesPath(id, 'local');
  assert.ok(file.startsWith(join(walkdownHome(), 'fixtures')), file);
  assert.ok(existsSync(file));
  assert.deepEqual(readdirSync(h.spec).sort(), before);
});

test('a pair that ties on one target is warned about there, by name; two states of one page are not @rule:screens.setup.setup-is-identity', () => {
  const h = home('ties', {
    screens: [
      SCREEN('team', '{ setup: { recipe: as_team }, path: "/expenses/{fixtures.shared}" }'),
      SCREEN('org', '{ setup: { recipe: as_org }, path: "/expenses/{fixtures.shared}" }'),
      SCREEN('mine', '{ setup: { recipe: as_team }, path: "/expenses/{fixtures.mine}" }'),
      SCREEN('theirs', '{ setup: { recipe: as_team }, path: "/expenses/{fixtures.theirs}" }'),
    ].join('\n'),
    recipes:
      'recipes:\n  as_team:\n    - visit: /dev/as/team\n  as_org:\n    - visit: /dev/as/org\n',
    targets: [
      '    local:',
      '      base_url: http://localhost:3000',
      '      fixtures: { shared: 1, mine: 2, theirs: 3 }',
      '    review:',
      '      base_url: https://review.example.test',
      '      fixtures: { shared: 1, mine: 9, theirs: 9 }',
    ].join('\n'),
  });
  const ties = about(h, 'storyboard').filter((f) => /a tie is never matched/.test(f.message));
  // team and org share a path and differ in setup: two states, no warning.
  // mine and theirs fill in to one path on review alone.
  assert.equal(ties.length, 1, JSON.stringify(ties, null, 2));
  assert.equal(ties[0].subject, 'theirs');
  assert.match(
    ties[0].message,
    /^on `review`, app path \/expenses\/\{fixtures\.theirs\} fills in to \/expenses\/9, and so does screen `mine`'s/,
  );
});

test('two screens sharing a design ref are warned about as before, whatever their setups @rule:screens.setup.setup-is-identity', () => {
  const h = home('designs', {
    screens: [
      '  - id: one\n    prototype: /screens/same.html\n    app: { setup: [{ visit: /a }], path: /x }\n    anchors: [one.body]',
      '  - id: two\n    prototype: /screens/same.html\n    app: { setup: [{ visit: /b }], path: /x }\n    anchors: [two.body]',
    ].join('\n'),
    targets: '    local:\n      base_url: http://localhost:3000',
  });
  const ties = about(h, 'storyboard').filter((f) => /a tie is never matched/.test(f.message));
  assert.equal(ties.length, 1);
  assert.match(
    ties[0].message,
    /^design ref "\/screens\/same\.html" is already claimed by screen `one`/,
  );
});
