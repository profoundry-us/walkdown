/*
 * ownership.design.request-names-its-version - `walkdown threads set
 * --proposes` names the version a design request proposes, on a throwaway
 * machine of its own.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';
import { parse } from '../vendor/yaml.js';

const m = machine();
after(() => m.done());
FIXTURES['g2-request-proposes'](m);

const R = '@rule:ownership.design.request-names-its-version';
const thread = (id) => {
  const dir = join(m.specOf('checkout'), 'threads');
  return readdirSync(dir)
    .map((f) => parse(readFileSync(join(dir, f), 'utf8')))
    .find((t) => t.id === id);
};
const set = (...args) => m.wd(['threads', 'set', ...args, '--blueprint', 'checkout']);

test(`a version no file under the design root has is refused by name, and nothing is written ${R}`, () => {
  const before = JSON.stringify(thread('n-0002'));
  for (const bad of ['/receipt/20261013.html', '/../spec.yml', '/receipt']) {
    const r = set('n-0002', '--proposes', bad, '--as-agent');
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /is no file under the design root, designs\/\. Draw it there first/);
    assert.match(r.stderr, /^Nothing was changed\.$/m);
  }
  assert.equal(JSON.stringify(thread('n-0002')), before);
});

test(`a thread that is not a design request is refused the same way ${R}`, () => {
  const r = set('n-0001', '--proposes', '/receipt/20261012.html', '--as-agent');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /n-0001 is not a design request/);
  assert.equal(thread('n-0001').proposes, undefined);
});

test(`the request names the version, a reply says who named it, and the walk shows it ${R}`, () => {
  const r = set('n-0002', '--proposes', '/receipt/20261012.html');
  assert.equal(r.status, 0, r.stderr);
  const t = thread('n-0002');
  assert.equal(t.proposes, '/receipt/20261012.html');
  assert.match(
    t.replies.at(-1).body,
    /named \/receipt\/20261012\.html as the version this request proposes, in place of none/,
  );
  assert.equal(t.replies.at(-1).author, 'topher');
  // Read on the machine's own registry, as the walk reads it.
  const lib = new URL('../lib/blueprint.js', import.meta.url).href;
  const out = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { loadBlueprint } = await import(${JSON.stringify(lib)});
       const bp = loadBlueprint(${JSON.stringify(m.specOf('checkout'))});
       console.log(JSON.stringify(bp.storyboard.screens.find((s) => s.id === 'receipt')));`,
    ],
    { env: m.env, encoding: 'utf8' },
  );
  assert.equal(out.status, 0, out.stderr);
  const receipt = JSON.parse(out.stdout);
  assert.equal(receipt.prototype, '/receipt/20260921.html');
  assert.deepEqual(receipt.proposed, {
    path: '/prototype/receipt/20261012.html',
    request: 'n-0002',
  });
  // Naming another records what it named before.
  const again = set('n-0002', '--proposes', '/receipt/20260921.html', '--as-agent');
  assert.match(again.stdout, /\(was \/receipt\/20261012\.html\) · by agent/);
});

test(`an accepted request is refused ${R}`, () => {
  m.ok(['threads', 'set', 'n-0002', '--status', 'addressed', '--blueprint', 'checkout']);
  const v = m.wd(['threads', 'set', 'n-0002', '--verify', '--blueprint', 'checkout']);
  assert.equal(v.status, 0, v.stderr);
  const r = set('n-0002', '--proposes', '/receipt/20261012.html');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /n-0002 was accepted.*A new version goes on a new request/);
});
