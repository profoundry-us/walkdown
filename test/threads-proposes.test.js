/*
 * ownership.design.request-names-its-version - `walkdown threads set
 * --proposes` names the version a design request proposes, on a throwaway
 * machine of its own.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/*
 * The judge is handed the proposed version too. It used to read only the
 * storyboard's `proposal:`, which `walkdown upgrade` drops, so a screen whose
 * one design was a request's proposed version gave the judge no design
 * address at all.
 */
test(`the judge is given the proposed version beside the accepted one, and told it is not yet accepted ${R}`, () => {
  const judge = () => {
    const r = m.wd(['judge', 'checkout.basics.pays', '--blueprint', 'checkout']);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  };
  // The test above left n-0002 naming the accepted version itself.
  assert.equal(set('n-0002', '--proposes', '/receipt/20261012.html', '--as-agent').status, 0);
  const both = judge();
  assert.match(both, /^ {4}accepted {3}\S+\/prototype\/receipt\/20260921\.html$/m);
  assert.match(both, /^ {4}proposed {3}\S+\/prototype\/receipt\/20261012\.html$/m);
  assert.match(
    both,
    /the proposed version on n-0002, awaiting a person's acceptance and not yet accepted/,
  );
  assert.match(both, /the accepted version above is what it would replace/);
  assert.doesNotMatch(both, /a sketch, not design authority/);

  // A screen whose only design is the proposed version still has an address.
  const board = join(m.specOf('checkout'), 'storyboard.yml');
  const was = readFileSync(board, 'utf8');
  writeFileSync(board, was.replace('design: /receipt/20260921.html', 'design: null'));
  try {
    const alone = judge();
    assert.doesNotMatch(alone, /^ {4}accepted /m);
    assert.match(alone, /^ {4}proposed {3}\S+\/prototype\/receipt\/20261012\.html$/m);
    assert.match(alone, /not yet accepted\. Judge against it, and say so when you do\)$/m);
    assert.doesNotMatch(alone, /no address on either surface/);
    const json = JSON.parse(
      m.wd(['judge', 'checkout.basics.pays', '--blueprint', 'checkout', '--json']).stdout,
    );
    const receipt = json.screens.find((s) => s.id === 'receipt');
    assert.equal(receipt.prototype, null);
    assert.match(receipt.proposed, /\/prototype\/receipt\/20261012\.html$/);
    assert.equal(receipt.proposed_request, 'n-0002');
  } finally {
    writeFileSync(board, was);
  }
});

test(`an accepted request is refused ${R}`, () => {
  m.ok(['threads', 'set', 'n-0002', '--status', 'addressed', '--blueprint', 'checkout']);
  const v = m.wd(['threads', 'set', 'n-0002', '--verify', '--blueprint', 'checkout']);
  assert.equal(v.status, 0, v.stderr);
  const r = set('n-0002', '--proposes', '/receipt/20261012.html');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /n-0002 was accepted.*A new version goes on a new request/);
});
