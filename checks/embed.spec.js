/*
 * Browser checks for the embed's pinning. These are the rules that spent weeks
 * green on the strength of server tests that POSTed a ready-made anchor and
 * inspected the filing (thread q-0070). What matters here is what the EMBED
 * works out for itself: which element is under the pointer, where in the
 * surface the click landed, and what viewport it was placed at.
 */
import { expect, test } from '@playwright/test';

// The host page the panel docks into. Absolute, because baseURL names the
// system under test — walkdown itself — not the fixture that hosts it.
const FIXTURE = 'http://localhost:4712/docked.html';

/** The fixture with pin mode armed, ready to receive a click. */
async function pinning(page) {
  await page.goto(FIXTURE);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.getByTestId('panel.pin-mode').click();
  await expect(page.locator('html')).toHaveClass(/wd-pinning/);
  return page;
}

/*
 * Place a pin at a point and return what the embed actually filed. The
 * server's answer is the record itself, so the check reads the anchor the
 * EMBED computed rather than anything the check handed over.
 */
async function pinAt(page, x, y, note = 'Placed by a browser check.') {
  await page.mouse.click(x, y);
  await expect(page.getByTestId('pin.form')).toBeVisible();
  await page.getByTestId('pin.note').fill(note);
  const posted = page.waitForResponse(
    (r) => r.url().includes('/api/threads') && r.request().method() === 'POST'
  );
  await page.getByTestId('pin.save').click();
  const { id, thread } = await (await posted).json();
  return { id, thread };
}

test(
  'a pin lands on the anchored element under the pointer, and keeps the spot',
  { tag: '@rule:embed.pin.anchored-target' },
  async ({ page }) => {
    await pinning(page);
    const box = await page.getByTestId('host.cta').boundingBox();
    // Deliberately off-centre: a pin that records the element but forgets the
    // point would still pass a centre-of-element assertion.
    const x = Math.round(box.x + box.width * 0.75);
    const y = Math.round(box.y + box.height * 0.75);

    const { id, thread: t } = await pinAt(page, x, y);

    // The element the embed decided was under the pointer — not one we told it.
    expect(t.anchor.element).toBe('host.cta');
    // And the spot, both in the surface and within the element.
    expect(t.anchor.position).toBeTruthy();
    expect(t.anchor.offset).toBeTruthy();
    expect(t.anchor.offset.x).toBeGreaterThan(box.width * 0.5);

    // The pin draws where it was put, not at a corner of the element.
    const marker = page.locator('[data-testid="pin.marker"][data-thread="' + id + '"]');
    await expect(marker).toBeVisible();
    const m = await marker.boundingBox();
    expect(Math.abs(m.x + m.width / 2 - x)).toBeLessThan(14);
  }
);

test(
  'a pin records the viewport it was placed at',
  { tag: '@rule:embed.pin.viewport-recorded' },
  async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 700 });
    await pinning(page);
    const box = await page.getByTestId('host.card').boundingBox();
    const { thread: t } = await pinAt(page, Math.round(box.x + 40), Math.round(box.y + 20));
    // Measured by the embed from the surface it was placed on, and named.
    expect(t.anchor.viewport).toBeTruthy();
    expect(t.anchor.viewport.width).toBe(812);
    expect(typeof t.anchor.viewport.name).toBe('string');
  }
);

test(
  'a pin dropped where no anchor sits is still placed, kept by position',
  { tag: '@rule:embed.pin.coordinate-fallback' },
  async ({ page }) => {
    await pinning(page);
    // Empty margin: no anchored element anywhere under this point.
    const { id, thread: t } = await pinAt(page, 700, 60, 'Nothing anchored here.');
    expect(t.anchor.element ?? null).toBeNull();
    expect(t.anchor.position).toBeTruthy();
    expect(typeof t.anchor.position.x).toBe('number');
    await expect(
      page.locator('[data-testid="pin.marker"][data-thread="' + id + '"]')
    ).toBeVisible();
  }
);

test(
  'positions are recorded in the surface coordinate space, not the screen',
  { tag: '@rule:embed.pin.surface-coordinates' },
  async ({ page }) => {
    await pinning(page);
    // Scroll first: a pin recorded in screen pixels would lose this offset,
    // which is exactly what makes a pin drift when the page moves.
    await page.evaluate(() => window.scrollTo(0, 400));
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(0); // the fixture must really scroll

    const box = await page.getByTestId('host.second').boundingBox();
    const y = Math.round(box.y + 24);
    const { thread: t } = await pinAt(page, Math.round(box.x + 30), y);

    // Document space, so the recorded point carries the scroll. In screen
    // pixels it would equal y, and the pin would drift the moment anyone
    // scrolled - which is the failure this rule exists to prevent.
    expect(t.anchor.position.y).toBeCloseTo(y + scrolled, -1);
  }
);
