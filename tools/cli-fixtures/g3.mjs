/*
 * Fixtures for group g3's cli screens: a thread's lifecycle (who may move
 * it, what each move says, why a note exists) and the status report's
 * sweep and attention lists, which need a ledger with verdicts in it.
 *
 * Verdicts go in through lib's own doors, in a node process standing in
 * ~/shop with the machine's environment, so a run is stamped, attributed
 * and closes threads exactly as a recorded run does - never a hand-written
 * JSON file that could drift from what the ledger actually holds.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

/* A check in ~/shop/tests claiming each of checkout's rules named, so none reads as uncovered. */
function checked(m, ...names) {
  mkdirSync(join(m.shop, 'tests'), { recursive: true });
  writeFileSync(
    join(m.shop, 'tests', 'checkout.test.js'),
    names.map((r) => `checkout.basics.${r}`).map((id) => `test('${id} @rule:${id}', () => {});`).join('\n') + '\n',
  );
}

/*
 * `checkout`'s rules, written whole: [suffix, statement, { verify, signoff, retired }].
 * The `feature` helper writes `verify: [checks]` alone, and the attention
 * list is about the agent tier and the signers.
 */
function rules(m, list) {
  const dir = join(m.specOf('checkout'), 'features');
  for (const f of readdirSync(dir)) rmSync(join(dir, f));
  writeFileSync(
    join(dir, 'checkout.yml'),
    [
      'feature: checkout',
      'stories:',
      '  - id: checkout.basics',
      '    title: The basics of checkout',
      '    statement: As a shopper I pay for what is in my cart.',
      '    rules:',
      ...list.flatMap(([rule, statement, o = {}]) => [
        `      - id: checkout.basics.${rule}`,
        `        statement: ${statement}`,
        `        verify: [${(o.verify ?? ['checks']).join(', ')}]`,
        ...(o.signoff ? [`        signoff: [${o.signoff.join(', ')}]`] : []),
        ...(o.retired ? [`        retired: ${o.retired}`] : []),
        '        steps:',
        '          then: [It does]',
      ]),
      '',
    ].join('\n'),
  );
  m.ok(['hash', '--write', '--blueprint', 'checkout']);
}

/*
 * Record runs into `checkout` through lib: `checks` and agent `walkdown`
 * runs via writeRunRecord, dated as asked; a `signed` walkdown via
 * finishWalkdown, the door the panel's Finish goes through, which closes
 * the rule's notes. A result with `old: true` carries a statement hash the
 * rule no longer has, as a verdict from before a rewording does.
 */
function record(m, runs) {
  const code = `
    import { resolveLocations } from '${REPO}/lib/locations.js';
    import { loadBlueprint, collectRules } from '${REPO}/lib/blueprint.js';
    import { formatHash } from '${REPO}/lib/hash.js';
    import { writeRunRecord } from '${REPO}/lib/run-record.js';
    import { finishWalkdown } from '${REPO}/lib/writes.js';
    const bp = loadBlueprint(resolveLocations({ blueprint: 'checkout' }).spec.path);
    const byId = new Map(collectRules(bp.features).map(({ rule }) => [rule.id, rule]));
    const stamp = (results) => results.map(({ rule, status, old }) => ({
      rule, status,
      ...(['pass', 'fail'].includes(status) && { statement_hash: old ? 'sha256:0123456789ab' : formatHash(byId.get(rule)) }),
    }));
    for (const r of ${JSON.stringify(runs)}) {
      if (r.signed) finishWalkdown(bp, { target: 'local', baseUrl: 'http://localhost:3000', signatures: r.signed, results: stamp(r.results) });
      else writeRunRecord({ blueprintDir: bp.dir, runsDir: bp.at.runs.path, codeRoot: bp.codeRoot, target: 'local',
        actor: r.actor, kind: r.kind, results: stamp(r.results), date: r.at ? new Date(r.at) : new Date(Date.now() + 2000) });
    }`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: m.shop, env: m.env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture: recording runs exited ${r.status}\n${r.stderr}`);
}

const LAST_WEEK = '2026-09-28T15:00:00Z';
const pays = 'checkout.basics.pays';
const note = (m, body, ...more) => m.ok(['threads', 'new', '--rule', pays, '--body', body, ...more, '--blueprint', 'checkout']);

export default {
  /* n-0001 addressed by the agent, on a machine where nobody has written down who is sitting here. */
  'g3-addressed-nobody-named'(m, h) {
    h.fixtures['a-note'](m);
    m.ok(['threads', 'set', 'n-0001', '--status', 'addressed', '--as-agent', '--reply', "A declined card now shows the bank's message.", '--blueprint', 'checkout']);
    writeFileSync(join(m.home, 'profile.yml'), 'identity: {}\n');
  },
  /* An open question on checkout.basics.pays, q-0002, beside the note. */
  'g3-a-question'(m, h) {
    h.fixtures['a-note'](m);
    note(m, 'Should a declined card keep the cart?', '--kind', 'question');
  },
  /* n-0001 with the agent's own reply, then the person's words relayed with the agent's beside them. */
  'g3-relayed'(m, h) {
    h.fixtures['a-note'](m);
    const reply = (...args) => m.ok(['threads', 'reply', 'n-0001', ...args, '--as-agent', '--blueprint', 'checkout']);
    reply('I traced it to the card form: the decline never reaches the page.');
    reply('--said', 'Leave the cart as it is when a card is declined.', '--added', 'Relayed from the chat; the cart is kept today.');
  },
  /* n-0001 waived by topher, with his reason. */
  'g3-waived'(m, h) {
    h.fixtures['a-note'](m);
    m.ok(['threads', 'set', 'n-0001', '--waive', '--reason', 'Declined cards move to the payments team.', '--blueprint', 'checkout']);
  },
  /* A finding topher filed from the CLI with no --as-agent: the only thread on checkout. */
  'g3-a-finding'(m, h) {
    h.fixtures['one-blueprint'](m);
    rules(m, [['pays', 'A card payment goes through.']]);
    note(m, 'The receipt total is off by the shipping fee.', '--reason', 'finding');
  },
  /*
   * checkout.basics.pays with four notes - topher's feedback and the agent's
   * finding, both addressed by the agent, an open note nobody has touched,
   * and a decision - a note on checkout.basics.totals, then topher's
   * walkdown, signed for eng, passing checkout.basics.pays.
   */
  'g3-signed-pass'(m, h) {
    h.fixtures['one-blueprint'](m);
    rules(m, [['pays', 'A card payment goes through.', { verify: ['checks', 'agent'], signoff: ['eng'] }], ['totals', 'The total is the sum of the cart.']]);
    checked(m, 'pays', 'totals');
    note(m, 'The pay button does nothing on a declined card.');
    note(m, 'The receipt total is off by the shipping fee.', '--reason', 'finding', '--as-agent');
    note(m, 'The pay button flickers on load.');
    note(m, 'A declined card keeps the cart.', '--reason', 'decision');
    m.ok(['threads', 'new', '--rule', 'checkout.basics.totals', '--body', 'The total ignores the coupon.', '--blueprint', 'checkout']);
    m.ok(['threads', 'set', 'n-0001', '--status', 'addressed', '--as-agent', '--reply', 'Declines show the bank message now.', '--blueprint', 'checkout']);
    m.ok(['threads', 'set', 'n-0002', '--status', 'addressed', '--as-agent', '--reply', 'Shipping is in the receipt total now.', '--blueprint', 'checkout']);
    record(m, [{ signed: [{ role: 'eng' }], results: [{ rule: pays, status: 'pass' }] }]);
  },
  /* checkout.basics.pays retired, its concern moved; and a note filed on it before it was. */
  'g3-retired-rule'(m, h) {
    h.fixtures['one-blueprint'](m);
    rules(m, [['pays', 'A card payment goes through.'], ['charges', 'A card is charged once for the cart.']]);
    note(m, 'The pay button does nothing on a declined card.');
    rules(m, [
      ['pays', 'A card payment goes through.', { retired: 'Split in two; a card charge is checkout.basics.charges now.' }],
      ['charges', 'A card is charged once for the cart.'],
    ]);
  },
  /*
   * Three rules whose checks and agent tier both passed last week, then a
   * sweep over the checks tier, and checkout.basics.pays checked again since.
   */
  'g3-swept'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    rules(m, [
      ['pays', 'A card payment goes through.', { verify: ['checks', 'agent'] }],
      ['totals', 'The total is the sum of the cart.', { verify: ['checks', 'agent'] }],
      ['receipt', 'The receipt lists what was bought.', { verify: ['checks', 'agent'] }],
    ]);
    checked(m, 'pays', 'totals', 'receipt');
    const all = ['pays', 'totals', 'receipt'].map((r) => ({ rule: `checkout.basics.${r}`, status: 'pass' }));
    record(m, [
      { kind: 'checks', actor: 'topher', at: LAST_WEEK, results: all },
      { kind: 'walkdown', actor: 'agent', at: LAST_WEEK, results: all },
    ]);
    m.ok(['sweep', '--tiers', 'checks', '--why', 'the payment form was rewritten', '--blueprint', 'checkout']);
    record(m, [{ kind: 'checks', actor: 'topher', results: [{ rule: pays, status: 'pass' }] }]);
  },
  /* checkout.basics.pays built, judged by the agent, and waiting on eng and product to sign. */
  'g3-two-roles-owed'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    rules(m, [['pays', 'A card payment goes through.', { verify: ['checks', 'agent'], signoff: ['eng', 'product'] }]]);
    checked(m, 'pays');
    record(m, [
      { kind: 'checks', actor: 'topher', at: LAST_WEEK, results: [{ rule: pays, status: 'pass' }] },
      { kind: 'walkdown', actor: 'agent', at: LAST_WEEK, results: [{ rule: pays, status: 'pass' }] },
    ]);
  },
  /* sam, who has said his username and his full name, passing checkout.basics.pays signed for eng. */
  'g3-sam-signs'(m, h) {
    writeFileSync(join(m.home, 'profile.yml'), 'identity:\n  username: sam\n  name: Sam Shopper\n');
    h.fixtures['one-blueprint'](m);
    rules(m, [['pays', 'A card payment goes through.', { verify: ['checks', 'agent'], signoff: ['eng'] }]]);
    record(m, [{ signed: [{ role: 'eng' }], results: [{ rule: pays, status: 'pass' }] }]);
  },
};
