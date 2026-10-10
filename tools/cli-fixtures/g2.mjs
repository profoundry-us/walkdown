/*
 * Fixtures for group g2's cli screens: design ownership, authoring, screen
 * identity and time.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/* `checkout` with one rule, `checkout.basics.pays`, and nothing else in features/. */
function checkout(m, h) {
  m.ok(['blueprints', 'new', 'checkout']);
  const dir = join(m.specOf('checkout'), 'features');
  for (const f of readdirSync(dir)) rmSync(join(dir, f));
  h.feature(m, 'checkout', 'checkout', [['pays', 'A card payment goes through.']]);
}

/* A storyboard of the given screens, written into `checkout`. */
function storyboard(m, screens) {
  writeFileSync(join(m.specOf('checkout'), 'storyboard.yml'), `screens:\n${screens.join('\n')}\n`);
}

/* Undrawn screens, cart (unless left out) and receipt, and a design request on receipt alone. */
function undrawn(m, { cart = true } = {}) {
  storyboard(m, [
    ...(cart
      ? ['  - id: cart', '    title: Cart', '    prototype: null', '    app: { path: /cart }']
      : []),
    '  - id: receipt',
    '    title: Receipt',
    '    prototype: null',
    '    app: { path: /receipt }',
  ]);
  m.ok([
    'threads',
    'new',
    '--screen',
    'receipt',
    '--body',
    'Draw the receipt a shopper sees after paying.',
    '--blueprint',
    'checkout',
  ]);
}

export default {
  /* `checkout`'s note n-0001, replied to by the agent and set to addressed. */
  'g2-note-addressed'(m, h) {
    h.fixtures['a-note'](m);
    m.ok([
      'threads',
      'set',
      'n-0001',
      '--status',
      'addressed',
      '--as-agent',
      '--reply',
      "The pay button shows the bank's message now.",
      '--blueprint',
      'checkout',
    ]);
  },
  /* `checkout` whose storyboard has a page, /cart, and a fragment state of it, /cart#coupon. */
  'g2-routes'(m, h) {
    checkout(m, h);
    storyboard(m, [
      '  - id: cart',
      '    title: Cart',
      '    prototype: null',
      '    app: { path: /cart }',
      '  - id: cart-coupon',
      '    title: Cart, with the coupon drawer open',
      '    prototype: null',
      '    app: { path: "/cart#coupon" }',
    ]);
  },
  /* `checkout` with orders, and its returns tab declared by its query (n-0491). */
  'g2-query-screens'(m, h) {
    checkout(m, h);
    storyboard(m, [
      '  - id: orders',
      '    title: Orders',
      '    prototype: null',
      '    app: { path: /orders }',
      '  - id: orders-returns',
      '    title: Orders, on the returns tab',
      '    prototype: null',
      '    app: { path: "/orders?tab=returns" }',
    ]);
  },
  /*
   * `checkout` with three rules: one as it should be, one with a statement
   * and no steps, and one whose statement has grown into a paragraph.
   */
  'g2-authoring'(m, h) {
    checkout(m, h);
    writeFileSync(
      join(m.specOf('checkout'), 'features', 'refunds.yml'),
      [
        'feature: refunds',
        'stories:',
        '  - id: refunds.basics',
        '    title: A shopper gets their money back',
        '    statement: As a shopper I can return what I bought.',
        '    rules:',
        '      - id: refunds.basics.partial',
        '        statement: A refund can be for part of an order.',
        '        verify: [checks]',
        '      - id: refunds.basics.to-the-card',
        '        statement: >-',
        '          A refund goes back to the card the order was paid with. When that card has expired',
        '          or been cancelled, the bank forwards it to the new card on the account. When the bank',
        '          cannot, the shopper gets store credit instead, and an email that says how much and why.',
        '        because: >-',
        '          On 2 October a shopper whose card had expired waited three weeks for a refund that the',
        '          bank had bounced, and support only found out when she wrote in, so the refund has to land',
        '          somewhere she can see it.',
        '        verify: [checks]',
        '        steps:',
        '          given: [An order paid by card]',
        '          when: [It is refunded]',
        '          then: [The money goes back to the card]',
        '',
      ].join('\n'),
    );
    m.ok(['hash', '--write', '--blueprint', 'checkout']);
  },
  /* `checkout` with two pay screens declaring seven anchors, and a rule whose focus neither declares (ADR 0016). */
  'g2-focus-undeclared'(m, h) {
    checkout(m, h);
    const spec = m.specOf('checkout');
    writeFileSync(
      join(spec, 'storyboard.yml'),
      [
        'screens:',
        '  - id: pay',
        '    title: Pay for the order',
        '    prototype: /screens/pay.html',
        '    anchors: [pay.card-form, pay.card-number, pay.total, pay.submit]',
        '  - id: pay-error',
        '    title: The card was declined',
        '    prototype: /screens/pay-error.html',
        '    anchors: [pay-error.message, pay-error.retry, pay-error.other-card]',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(spec, 'features', 'pay.yml'),
      [
        'feature: pay',
        'stories:',
        '  - id: checkout.pay',
        '    title: A shopper pays for the order',
        '    statement: As a shopper I can pay for what is in my cart.',
        '    rules:',
        '      - id: checkout.pay.card-declined',
        '        statement: A declined card says so, and offers another way to pay.',
        '        verify: [checks]',
        '        signoff: [eng, product]',
        '        screens: [pay, pay-error]',
        '        focus: pay.decline-banner',
        '        steps:',
        '          given: [A card the bank declines]',
        '          when: [The shopper pays with it]',
        '          then: [The decline is said, and another card can be tried]',
        '',
      ].join('\n'),
    );
    m.ok(['hash', '--write', '--blueprint', 'checkout']);
  },
  /* `checkout` with a drawn receipt screen whose anchors are receipt.items and receipt.total. */
  'g2-receipt-drawn'(m, h) {
    checkout(m, h);
    storyboard(m, [
      '  - id: receipt',
      '    title: Receipt',
      '    prototype: /screens/receipt.html',
      '    app: { path: /receipt }',
      '    anchors: [receipt.items, receipt.total]',
    ]);
  },
  /* `checkout`, no rules yet, whose spec.yml says an agent draws its design, and an undrawn receipt screen with a design request. */
  'g2-design-by-agent'(m, h) {
    checkout(m, h);
    const spec = join(m.specOf('checkout'), 'spec.yml');
    writeFileSync(
      spec,
      readFileSync(spec, 'utf8').replace(
        /^blueprint: checkout$/m,
        'blueprint: checkout\n\ndesign:\n  by: agent',
      ),
    );
    undrawn(m, { cart: false });
  },
  /* `checkout` with two undrawn screens, cart and receipt; only receipt has a design request. */
  'g2-undrawn-screens'(m, h) {
    checkout(m, h);
    undrawn(m);
    // Both screens have their rule, so the one warning is the missing request.
    const file = join(m.specOf('checkout'), 'features', 'checkout.yml');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        '        verify: [checks]\n',
        '        verify: [checks]\n        screens: [cart, receipt]\n',
      ),
    );
  },
  /*
   * `shop`, from before ADR 0015: checkout and search keep their designs in
   * prototype/screens/, prototype/drafts/ and proposals/, committed on the
   * days the upgrade dates them by, with a pending request on receipt and on
   * shipping, a draft and a sketch nothing names, a page git does not hold,
   * and two redlines in as-built/redlines.json.
   */
  'g2-old-prototypes'(m, h) {
    h.realRepo(m);
    const page = (rel) => {
      const f = join(m.shop, rel);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, `<!doctype html><title>${rel}</title>\n`);
    };
    const commit = (day, files) => {
      for (const f of files) page(f);
      const at = `${day}T12:00:00-05:00`;
      const r = spawnSync('git', ['add', '-A'], { cwd: m.shop, env: m.env });
      const c = spawnSync('git', ['commit', '-q', '-m', `designs ${day}`], {
        cwd: m.shop,
        env: { ...m.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
      });
      if (r.status || c.status) throw new Error(`fixture: commit on ${day} failed\n${c.stderr}`);
    };
    commit('2026-09-18', ['prototype/screens/cart.html', 'prototype/screens/payment.html']);
    commit('2026-09-21', ['prototype/screens/receipt.html', 'prototype/drafts/receipt.html']);
    commit('2026-09-25', ['prototype/screens/results.html']);
    commit('2026-09-30', ['prototype/drafts/cart-old.html', 'proposals/payment-sketch.html']);
    commit('2026-10-06', ['proposals/shipping.html']);
    page('proposals/payment-notes.html');

    for (const [name, screens] of [
      [
        'checkout',
        [
          ['cart', '/screens/cart.html'],
          ['payment', '/screens/payment.html'],
          ['receipt', '/screens/receipt.html'],
          ['shipping', 'null'],
        ],
      ],
      ['search', [['results', '/screens/results.html']]],
    ]) {
      m.ok(['blueprints', 'new', name]);
      const spec = m.specOf(name);
      writeFileSync(
        join(spec, 'spec.yml'),
        `${readFileSync(join(spec, 'spec.yml'), 'utf8')}\nprototype:\n  root: prototype/\n`,
      );
      writeFileSync(
        join(spec, 'storyboard.yml'),
        `screens:\n${screens
          .map(
            ([id, path]) =>
              `  - id: ${id}\n    title: ${id}\n    prototype: ${path}\n    app: { path: /${id} }\n`,
          )
          .join('')}`,
      );
    }
    for (const [screen, body] of [
      ['receipt', 'Draw the receipt with the order number first.'],
      ['shipping', 'Draw the shipping step.'],
    ])
      m.ok(['threads', 'new', '--screen', screen, '--body', body, '--blueprint', 'checkout']);
    mkdirSync(join(m.shop, 'as-built'), { recursive: true });
    writeFileSync(
      join(m.shop, 'as-built', 'redlines.json'),
      `${JSON.stringify(
        {
          cart: {
            title: 'Cart',
            redlines: ['The build totals the cart in <code>cart.total</code> above the list.'],
          },
          receipt: { title: 'Receipt', redlines: ['The build leaves out the printed logo.'] },
        },
        null,
        2,
      )}\n`,
    );
  },
};
