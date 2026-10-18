/*
 * Fixtures for group g5's cli screens: a question moved onto the rule written
 * from its answer, answered by approving that rule, and lint refusing one left
 * where it was asked.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WRITES = new URL('../../lib/writes.js', import.meta.url).href;
const BLUEPRINT = new URL('../../lib/blueprint.js', import.meta.url).href;

/* `checkout` holding the stories given, each `[story, [[rule, statement, ...yaml]]]`, hashed. */
function checkout(m, stories, screens) {
  m.ok(['blueprints', 'new', 'checkout']);
  const dir = join(m.specOf('checkout'), 'features');
  for (const f of readdirSync(dir)) rmSync(join(dir, f));
  writeFileSync(
    join(dir, 'checkout.yml'),
    [
      'feature: checkout',
      'stories:',
      ...stories.flatMap(([story, rules]) => [
        `  - id: checkout.${story}`,
        `    title: The ${story}`,
        '    rules:',
        ...rules.flatMap(([rule, statement, ...extra]) => [
          `      - id: checkout.${story}.${rule}`,
          `        statement: ${statement}`,
          ...extra.map((l) => `        ${l}`),
          '        steps:',
          '          then: [It does]',
        ]),
      ]),
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(m.specOf('checkout'), 'storyboard.yml'),
    `screens:\n${screens
      .map(
        ([id, anchors]) =>
          `  - id: ${id}\n    prototype: /screens/${id}.html\n    anchors: [${anchors.join(', ')}]\n`,
      )
      .join('')}`,
  );
  m.ok(['hash', '--write', '--blueprint', 'checkout']);
}

const ask = (m, rule, body, options = []) =>
  m.ok([
    'threads',
    'new',
    '--kind',
    'question',
    '--rule',
    rule,
    '--body',
    body,
    ...options.flatMap((o) => ['--option', o]),
    '--blueprint',
    'checkout',
  ]);

/* Who this machine's person is, as profile.yml says. */
const as = (m, name) =>
  writeFileSync(join(m.home, 'profile.yml'), `identity:\n  username: ${name}\n`);

export default {
  /*
   * threads-written-as: q-0001 and q-0002 open on checkout.cart.add;
   * checkout.cart.empty written from q-0001's answer, not yet approved;
   * checkout.cart.coupons retired, its note naming checkout.cart.discounts.
   */
  'g5-question-written-as'(m) {
    checkout(
      m,
      [
        [
          'cart',
          [
            ['add', 'An item can be added to the cart.', 'screens: [cart]'],
            [
              'empty',
              'An empty cart hides the checkout button and says it is empty.',
              'origin: thread:q-0001',
              'screens: [cart]',
            ],
            [
              'coupons',
              'A coupon takes its amount off the total.',
              'retired: Folded into checkout.cart.discounts.',
              'screens: [cart]',
            ],
            ['discounts', 'A discount, coupon or code, comes off the total.', 'screens: [cart]'],
          ],
        ],
      ],
      [['cart', ['cart.items', 'cart.total', 'cart.checkout']]],
    );
    const options = ['Hide it :: and say the cart is empty', 'Keep it :: disabled'];
    ask(m, 'checkout.cart.add', 'Should an empty cart still offer the checkout button?', options);
    ask(m, 'checkout.cart.add', 'Should a coupon and a code stack?', options);
  },

  /*
   * question-answered-by-approval: q-0001 asked by dana on checkout.cart.add,
   * answered in words by topher, moved onto checkout.cart.empty, which topher
   * then approved signed as product.
   */
  'g5-question-answered'(m) {
    checkout(
      m,
      [
        [
          'cart',
          [
            ['add', 'An item can be added to the cart.', 'screens: [cart]'],
            [
              'empty',
              'An empty cart hides the checkout button and says it is empty.',
              'origin: thread:q-0001',
              'screens: [cart]',
            ],
          ],
        ],
      ],
      [['cart', ['cart.items', 'cart.total', 'cart.checkout']]],
    );
    as(m, 'dana');
    ask(m, 'checkout.cart.add', 'Should an empty cart still offer the checkout button?');
    as(m, 'topher');
    m.ok([
      'threads',
      'reply',
      'q-0001',
      'No. Hide it, and say the cart is empty instead.',
      '--blueprint',
      'checkout',
    ]);
    m.ok([
      'threads',
      'set',
      'q-0001',
      '--written-as',
      'checkout.cart.empty',
      '--blueprint',
      'checkout',
    ]);
    // The approval, recorded the way the panel records a finished walk.
    const r = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { finishWalkdown } = await import(${JSON.stringify(WRITES)});
         const { loadBlueprint } = await import(${JSON.stringify(BLUEPRINT)});
         finishWalkdown(loadBlueprint(${JSON.stringify(m.specOf('checkout'))}), {
           target: 'local', baseUrl: null, roles: ['product'],
           signatures: [{ role: 'product', signer: 'topher' }],
           results: [{ rule: 'checkout.cart.empty', status: 'approved' }],
         });`,
      ],
      { cwd: m.shop, env: m.env, encoding: 'utf8' },
    );
    if (r.status) throw new Error(`fixture: the approval failed\n${r.stderr}`);
  },

  /*
   * lint-question-asked-twice: q-0001 open on checkout.cart.add while
   * checkout.cart.empty was written from it; q-0002 already on
   * checkout.cart.totals, written from it, draws nothing.
   */
  'g5-question-asked-twice'(m) {
    checkout(
      m,
      [
        [
          'cart',
          [
            ['add', 'An item can be added to the cart.', 'screens: [cart]'],
            [
              'empty',
              'An empty cart hides the checkout button and says it is empty.',
              'origin: thread:q-0001',
              'screens: [cart]',
            ],
            [
              'totals',
              'The total is the sum of the cart.',
              'origin: thread:q-0002',
              'screens: [cart]',
            ],
          ],
        ],
        ['receipt', [['email', 'A receipt is emailed after payment.', 'screens: [receipt]']]],
      ],
      [
        ['cart', ['cart.items', 'cart.total']],
        ['receipt', ['receipt.number', 'receipt.email']],
      ],
    );
    const options = ['Hide it :: and say the cart is empty', 'Keep it :: disabled'];
    ask(m, 'checkout.cart.add', 'Should an empty cart still offer the checkout button?', options);
    ask(m, 'checkout.cart.totals', 'Does the total include shipping?', [
      'Yes :: once an address is known',
      'No :: shipping is shown apart',
    ]);
  },
};
