/*
 * Fixtures for group g2's cli screens: design ownership, authoring, screen
 * identity and time.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  },
};
