/*
 * Fixtures for group g4's cli screens: how `walkdown status` derives a cell
 * from the runs ledger - latest wins, staleness, places, excuses, and who
 * has signed. Runs are written as JSON straight into the blueprint's runs/
 * folder, as a reporter or the panel would have left them.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeRunRecord } from '../../lib/run-record.js';
import { parse } from '../../vendor/yaml.js';

/*
 * `checkout` holding exactly the rules given, each `[suffix, statement,
 * ...extra yaml lines]`, hashed. Gives back each rule's current hash.
 */
function checkout(m, rules) {
  m.ok(['blueprints', 'new', 'checkout']);
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
      ...rules.flatMap(([rule, statement, ...extra]) => [
        `      - id: checkout.basics.${rule}`,
        `        statement: ${statement}`,
        ...extra.map((l) => `        ${l}`),
        '        steps:',
        '          then: [It does]',
      ]),
      '',
    ].join('\n'),
  );
  m.ok(['hash', '--write', '--blueprint', 'checkout']);
  return hashes(m);
}

/* Each rule's current statement hash, as `hash --write` left it. */
function hashes(m) {
  const f = parse(readFileSync(join(m.specOf('checkout'), 'features', 'checkout.yml'), 'utf8'));
  return Object.fromEntries(f.stories[0].rules.map((r) => [r.id.split('.').pop(), r.steps?.statement_hash]));
}

/* A run record, as the ledger keeps it, in checkout's runs/. */
function run(m, id, fields, results) {
  const dir = join(m.specOf('checkout'), 'runs');
  mkdirSync(dir, { recursive: true });
  const record = { run_id: id, created: id.replace(/T(\d\d)-(\d\d)-(\d\d)Z.*/, 'T$1:$2:$3Z'), ...fields, results };
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

/* A check suite in ~/shop/tests that claims these rules. */
function suite(m, ...rules) {
  mkdirSync(join(m.shop, 'tests'), { recursive: true });
  writeFileSync(
    join(m.shop, 'tests', 'checkout.spec.js'),
    rules.map((r) => `test('${r} @rule:checkout.basics.${r}', async () => {});\n`).join(''),
  );
}

const CHECKS = { actor: 'ci', kind: 'checks', target: 'local', base_url: 'http://localhost:3000' };
const AGENT = { actor: 'agent', kind: 'walkdown', target: 'local', base_url: 'http://localhost:3000' };
const WALK = { actor: 'topher', kind: 'walkdown', target: 'local', base_url: 'http://localhost:3000' };

export default {
  /*
   * `pays` passed at local on Monday and failed there on Wednesday; the
   * Monday run's file sorts last. Staging passed it on Tuesday.
   */
  'g4-latest-wins'(m) {
    const h = checkout(m, [['pays', 'A card payment goes through.', 'verify: [checks]']]);
    const spec = join(m.specOf('checkout'), 'spec.yml');
    writeFileSync(
      spec,
      readFileSync(spec, 'utf8')
        .replace('    # staging:\n', '    staging:\n')
        .replace('    #   base_url: https://staging.example.com\n', '      base_url: https://staging.example.com\n'),
    );
    suite(m, 'pays');
    const pays = (status, message) => [{ rule: 'checkout.basics.pays', status, statement_hash: h.pays, message }];
    // Named so the older run sorts after the newer: file order is not time.
    run(m, '2026-09-30T09-00-00Z-local-02', CHECKS, pays('pass', 'Monday: the card payment went through'));
    run(m, '2026-10-01T09-00-00Z-staging-01', { ...CHECKS, target: 'staging', base_url: 'https://staging.example.com' }, pays('pass', 'Tuesday: the card payment went through'));
    run(m, '2026-10-02T09-00-00Z-local-01', CHECKS, pays('fail', 'Wednesday: the payment form never submitted'));
  },

  /*
   * Two rules that both passed, then both had their wording changed: `pays`
   * reworded with --reword (words only), `totals` given a new meaning.
   */
  'g4-reworded'(m) {
    const h = checkout(m, [
      ['pays', 'A card payment goes through.', 'verify: [checks]'],
      ['totals', 'The total is the sum of the cart.', 'verify: [checks]'],
    ]);
    suite(m, 'pays', 'totals');
    run(m, '2026-10-01T09-00-00Z-local-01', CHECKS, [
      { rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays },
      { rule: 'checkout.basics.totals', status: 'pass', statement_hash: h.totals },
    ]);
    const f = join(m.specOf('checkout'), 'features', 'checkout.yml');
    writeFileSync(
      f,
      readFileSync(f, 'utf8')
        .replace('A card payment goes through.', 'A payment by card goes through.')
        .replace('The total is the sum of the cart.', 'The total is the sum of the cart, less any discount.'),
    );
    // Only `pays` is declared words-only; then `totals` is hashed as a new rule.
    const t = readFileSync(f, 'utf8');
    writeFileSync(f, t.replace('The total is the sum of the cart, less any discount.', 'The total is the sum of the cart.'));
    m.ok(['hash', '--write', '--reword', 'plainer English, same rule', '--blueprint', 'checkout']);
    writeFileSync(f, readFileSync(f, 'utf8').replace('The total is the sum of the cart.', 'The total is the sum of the cart, less any discount.'));
    m.ok(['hash', '--write', '--blueprint', 'checkout']);
  },

  /*
   * The review target used to point at pr-1 and now points at pr-2. `pays`
   * passed only at pr-1; `totals` passed in a run that recorded no address.
   */
  'g4-moved-target'(m) {
    const h = checkout(m, [
      ['pays', 'A card payment goes through.', 'verify: [checks]'],
      ['totals', 'The total is the sum of the cart.', 'verify: [checks]'],
    ]);
    const spec = join(m.specOf('checkout'), 'spec.yml');
    writeFileSync(
      spec,
      readFileSync(spec, 'utf8')
        .replace(/    local:\n      base_url: http:\/\/localhost:3000\n      env: .*\n/, '    review:\n      base_url: https://pr-2.review.app\n'),
    );
    suite(m, 'pays', 'totals');
    run(m, '2026-10-01T09-00-00Z-review-01', { ...CHECKS, target: 'review', base_url: 'https://pr-1.review.app' }, [
      { rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays },
    ]);
    run(m, '2026-10-01T10-00-00Z-review-01', { actor: 'ci', kind: 'checks', target: 'review' }, [
      { rule: 'checkout.basics.totals', status: 'pass', statement_hash: h.totals },
    ]);
  },

  /* Both rules passed their checks; the suite now tags only `totals`. */
  'g4-untagged'(m) {
    const h = checkout(m, [
      ['pays', 'A card payment goes through.', 'verify: [checks]'],
      ['totals', 'The total is the sum of the cart.', 'verify: [checks]'],
    ]);
    suite(m, 'totals');
    run(m, '2026-10-01T09-00-00Z-local-01', CHECKS, [
      { rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays, checks: ['tests/checkout.spec.js:1'] },
      { rule: 'checkout.basics.totals', status: 'pass', statement_hash: h.totals, checks: ['tests/checkout.spec.js:2'] },
    ]);
  },

  /* `pays` passes its checks and its agent walkdown, and nobody has signed. */
  'g4-evidence-only'(m) {
    const h = checkout(m, [['pays', 'A card payment goes through.', 'verify: [checks]']]);
    suite(m, 'pays');
    run(m, '2026-10-01T09-00-00Z-local-01', CHECKS, [{ rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays }]);
    run(m, '2026-10-01T10-00-00Z-local-01', { ...AGENT, roles: ['eng'] }, [
      { rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays, reasoning: 'Paid with the test card; the receipt showed the order.' },
    ]);
  },

  /* `pays` asks eng and product; every tier passes and eng alone has signed. */
  'g4-one-of-two'(m) {
    const h = checkout(m, [['pays', 'A card payment goes through.', 'verify: [checks]', 'signoff: [eng, product]']]);
    suite(m, 'pays');
    const ok = [{ rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays }];
    run(m, '2026-10-01T09-00-00Z-local-01', CHECKS, ok);
    run(m, '2026-10-01T10-00-00Z-local-01', AGENT, ok);
    run(m, '2026-10-01T11-00-00Z-local-01', { ...WALK, signatures: [{ role: 'eng', signer: 'topher' }] }, ok);
  },

  /* `pays` says nothing about how it is verified. */
  'g4-says-nothing'(m) {
    checkout(m, [['pays', 'A card payment goes through.']]);
  },

  /* `pays` excuses the agent tier, with a reason. */
  'g4-excused'(m) {
    checkout(m, [
      [
        'pays',
        'A card payment goes through.',
        'verify: [checks]',
        'unverifiable:',
        "  agent: The payment page is the bank's, and no agent may type a real card into it.",
      ],
    ]);
  },

  /* Three excuses that do not argue their case. */
  'g4-weak-excuses'(m) {
    checkout(m, [
      ['pays', 'A card payment goes through.', 'unverifiable:', '  agent: hard'],
      ['totals', 'The total is the sum of the cart.', 'unverifiable:', '  human: Product reads every total by hand before a release.'],
      [
        'receipt',
        'A receipt is emailed after payment.',
        'unverifiable:',
        '  checks: The email leaves through a provider no test can reach from here.',
        "  agent: No agent can open the shopper's inbox to see the receipt arrive.",
      ],
    ]);
  },

  /* `pays` with no signoff line, `totals` naming only product, `receipt` an empty list. */
  'g4-signoff-product'(m) {
    checkout(m, [
      ['pays', 'A card payment goes through.'],
      ['totals', 'The total is the sum of the cart.', 'signoff: [product]'],
      ['receipt', 'A receipt is emailed after payment.', 'signoff: []'],
    ]);
  },

  /*
   * `pays` asks eng and product. A walkdown from before roles existed passed
   * it, then one recorded under product alone; topher is in design today.
   */
  'g4-roles-on-runs'(m) {
    const h = checkout(m, [['pays', 'A card payment goes through.', 'signoff: [eng, product]']]);
    writeFileSync(join(m.home, 'profile.yml'), 'identity:\n  username: topher\n  roles: [design]\n');
    const ok = [{ rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays }];
    run(m, '2026-10-01T09-00-00Z-local-01', AGENT, ok);
    run(m, '2026-09-01T09-00-00Z-local-01', { actor: 'sam', kind: 'walkdown', target: 'local' }, ok);
    run(m, '2026-10-01T11-00-00Z-local-01', { ...WALK, roles: ['product'] }, ok);
  },

  /*
   * Both rules approved by eng. `totals` has since passed its checks, so
   * there is a build to judge; `pays` has none.
   */
  'g4-approved'(m) {
    const h = checkout(m, [
      ['pays', 'A card payment goes through.', 'verify: [checks]'],
      ['totals', 'The total is the sum of the cart.', 'verify: [checks]'],
    ]);
    suite(m, 'pays', 'totals');
    run(m, '2026-10-01T09-00-00Z-local-01', { ...WALK, signatures: [{ role: 'eng', signer: 'topher' }] }, [
      { rule: 'checkout.basics.pays', status: 'approved', statement_hash: h.pays },
      { rule: 'checkout.basics.totals', status: 'approved', statement_hash: h.totals },
    ]);
    const built = [{ rule: 'checkout.basics.totals', status: 'pass', statement_hash: h.totals }];
    run(m, '2026-10-01T10-00-00Z-local-01', CHECKS, built);
    run(m, '2026-10-01T11-00-00Z-local-01', AGENT, built);
  },

  /* `pays` passes every tier, and topher looked and sent it back. */
  'g4-sent-back'(m) {
    const h = checkout(m, [['pays', 'A card payment goes through.', 'verify: [checks]']]);
    suite(m, 'pays');
    const ok = [{ rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays }];
    run(m, '2026-10-01T09-00-00Z-local-01', CHECKS, ok);
    run(m, '2026-10-01T10-00-00Z-local-01', AGENT, ok);
    run(m, '2026-10-01T11-00-00Z-local-01', { ...WALK, signatures: [{ role: 'eng', signer: 'topher' }] }, [
      { rule: 'checkout.basics.pays', status: 'refining', statement_hash: h.pays, message: 'The spinner never stops after a declined card.' },
    ]);
  },

  /*
   * A walkdown topher drove, signing eng himself and product for Pat beside
   * him, written by the same writer the panel's door uses.
   */
  'g4-signed-for-pat'(m) {
    const h = checkout(m, [['pays', 'A card payment goes through.', 'signoff: [eng, product]']]);
    writeRunRecord({
      blueprintDir: m.specOf('checkout'),
      runsDir: join(m.specOf('checkout'), 'runs'),
      codeRoot: m.shop,
      target: 'local',
      baseUrl: 'http://localhost:3000',
      actor: 'topher',
      kind: 'walkdown',
      signatures: [{ role: 'eng', signer: 'topher' }, { role: 'product', signer: 'pat' }],
      results: [{ rule: 'checkout.basics.pays', status: 'pass', statement_hash: h.pays }],
    });
  },
};
