/*
 * Browser checks for the embed's pinning. These are the rules that spent weeks
 * green on the strength of server tests that POSTed a ready-made anchor and
 * inspected the filing (thread q-0070). What matters here is what the EMBED
 * works out for itself: which element is under the pointer, where in the
 * surface the click landed, and what viewport it was placed at.
 */
import { expect, test } from '@playwright/test';

// The host page the panel docks into — absolute, because baseURL names the
// system under test (walkdown itself), not the fixture that hosts it. Both
// come from the config so the two run modes address the same pair of servers.
import { EXAMPLE_ORIGIN, FIXTURE, WD_ORIGIN } from '../playwright.config.js';

/*
 * The application under review is a FRAME inside walkdown's page - that is the
 * only delivery there is since 2026-08-26. So the embed's own markup (the pin,
 * its form, the hover highlight) is in the frame, and the panel that arms pin
 * mode is outside it. `app(page)` is the inside; bare page locators are the
 * outside.
 */
const APP = (params = {}) => {
  const u = new URL(FIXTURE);
  const inner = new URL(u.searchParams.get('frame'));
  inner.pathname = '/app.html';
  inner.host = u.host; // the fixture server, not walkdown's
  inner.searchParams.set('wd', WD_ORIGIN);
  for (const [k, v] of Object.entries(params)) inner.searchParams.set(k, v);
  u.searchParams.set('frame', inner.href);
  return u.href;
};
const app = (page) => page.frameLocator('iframe[title="the application under review"]');
/*
 * The framed document itself, for the handful of assertions that need to run
 * inside it. Explicitly not the main frame: the fixture's own URL carries
 * "app.html" in its `frame=` parameter, so a bare url match finds the wrong one.
 */
const appFrame = (page) =>
  page.frames().find((f) => f !== page.mainFrame() && f.url().includes('/app.html'));

/*
 * Carry walkdown onto a page that has no tag of its own, the way the extension
 * does: the panel and the embed together, the panel owning the pin-mode
 * control. There is no badge to fall back on — an embed with no panel had one,
 * and it was removed once the only page that could reach it turned out to be
 * one nobody opens (n-0058).
 */
async function carryWalkdown(page, url, bp) {
  /*
   * A page that carries no walkdown tag at all — an application nobody can
   * edit. The extension puts the embed there itself (extension/boot.js runs in
   * the framed document and does exactly this); an init script is how a check
   * stands in for a content script. Deliberately no `data-bp`: with nothing
   * declaring a project, the address the page reports is the only thing that
   * can say where a pin belongs, which is the whole point of the rule.
   */
  await page.addInitScript((server) => {
    if (window.parent === window) return; // walkdown's own page
    if (document.querySelector('script[data-walkdown]')) return; // already carries it
    window.__walkdownConfig = { server, bp: '', anchorAttribute: 'data-testid' };
    const tag = document.createElement('script');
    tag.src = `${server}/embed.js`;
    tag.setAttribute('data-walkdown', '');
    const put = () => document.body.appendChild(tag);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put);
    else put();
  }, WD_ORIGIN);
  const u = new URL(FIXTURE);
  u.searchParams.set('frame', url);
  u.searchParams.set('bp', bp ?? '');
  await page.goto(u.href);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
}

/*
 * The panel walkdown is RUNNING, as opposed to the one drawn on the page.
 * Reviewing walkdown with walkdown means the prototype screens are mockups of
 * this very panel and carry the same anchors — so on those pages a bare
 * getByTestId matches both. The running one marks itself as walkdown's own
 * chrome; a drawing of it does not.
 */
const realPanel = (page) =>
  page
    .locator('[data-walkdown-chrome]')
    .filter({ has: page.getByTestId('panel.bar') })
    .first();

/** Arm pin mode from the panel — the one control that owns it. */
async function armPinMode(page) {
  await realPanel(page).getByTestId('panel.pin-mode').click();
  await expect(app(page).locator('html')).toHaveClass(/wd-pinning/);
}

/** The fixture with pin mode armed, ready to receive a click. */
async function pinning(page, params) {
  await page.goto(APP(params));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect(app(page).getByTestId('host.cta')).toBeVisible();
  await page.getByTestId('panel.pin-mode').click();
  // The class lands in the framed document: that is the surface being pinned.
  await expect(app(page).locator('html')).toHaveClass(/wd-pinning/);
  return page;
}

/*
 * Place a pin at a point and return what the embed actually filed. The
 * server's answer is the record itself, so the check reads the anchor the
 * EMBED computed rather than anything the check handed over.
 */
async function pinAt(page, x, y, note = 'Placed by a browser check.') {
  await page.mouse.click(x, y);
  await expect(app(page).getByTestId('pin.form')).toBeVisible();
  await app(page).getByTestId('pin.note').fill(note);
  const posted = page.waitForResponse(
    (r) => r.url().includes('/api/threads') && r.request().method() === 'POST',
  );
  await app(page).getByTestId('pin.save').click();
  const { id, thread } = await (await posted).json();
  return { id, thread };
}

test('a pin lands on the anchored element under the pointer, and keeps the spot', {
  tag: '@rule:embed.pin.anchored-target',
}, async ({ page }) => {
  await pinning(page);
  const box = await app(page).getByTestId('host.cta').boundingBox();
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
  const marker = app(page).locator('[data-testid="pin.marker"][data-thread="' + id + '"]');
  await expect(marker).toBeVisible();
  const m = await marker.boundingBox();
  expect(Math.abs(m.x + m.width / 2 - x)).toBeLessThan(14);
});

test('a pin records the viewport it was placed at', {
  tag: '@rule:embed.pin.viewport-recorded',
}, async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 700 });
  await pinning(page);
  const box = await app(page).getByTestId('host.card').boundingBox();
  const { thread: t } = await pinAt(page, Math.round(box.x + 40), Math.round(box.y + 20));

  // The viewport a pin records is the SURFACE's, not the window's. Framed,
  // those genuinely differ - the frame is the window minus the panel - and
  // that difference is the point: feedback about a layout has to be read
  // against the width the layout actually had.
  const inner = await appFrame(page).evaluate(() => window.innerWidth);
  expect(t.anchor.viewport).toBeTruthy();
  expect(t.anchor.viewport.width).toBe(inner);
  expect(inner).toBeLessThan(812);
  expect(typeof t.anchor.viewport.name).toBe('string');
});

test('a pin dropped where no anchor sits is still placed, kept by position', {
  tag: '@rule:embed.pin.coordinate-fallback',
}, async ({ page }) => {
  await pinning(page);
  // Empty margin: no anchored element anywhere under this point.
  const { id, thread: t } = await pinAt(page, 700, 60, 'Nothing anchored here.');
  expect(t.anchor.element ?? null).toBeNull();
  expect(t.anchor.position).toBeTruthy();
  expect(typeof t.anchor.position.x).toBe('number');
  await expect(
    app(page).locator('[data-testid="pin.marker"][data-thread="' + id + '"]'),
  ).toBeVisible();
});

test('positions are recorded in the surface coordinate space, not the screen', {
  tag: '@rule:embed.pin.surface-coordinates',
}, async ({ page }) => {
  await pinning(page);
  // Scroll the SURFACE first — the framed document, not the page holding the
  // panel. A pin recorded in screen pixels would lose this offset, which is
  // exactly what makes a pin drift when the page moves.
  await appFrame(page).evaluate(() => window.scrollTo(0, 400));
  const scrolled = await appFrame(page).evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0); // the fixture must really scroll

  const box = await app(page).getByTestId('host.second').boundingBox();
  const y = Math.round(box.y + 24);
  const { thread: t } = await pinAt(page, Math.round(box.x + 30), y);
  // Where the frame sits in the window: the click is in window pixels, the
  // record is in the surface's own, and this is the whole of the difference.
  const frame = await page.locator('iframe[title="the application under review"]').boundingBox();

  // Document space, so the recorded point carries the scroll. In screen
  // pixels it would equal y, and the pin would drift the moment anyone
  // scrolled - which is the failure this rule exists to prevent.
  expect(t.anchor.position.y).toBeCloseTo(y - frame.y + scrolled, -1);
});

test('the same anchors exist on both surfaces, and a pin records which it was placed on', {
  tag: '@rule:embed.pin.both-surfaces',
}, async ({ page }) => {
  /*
   * Reviewing walkdown with walkdown: the review screen is a DRAWING of this
   * panel, so most of its anchors also exist in the running panel injected
   * over it. This one is in the design and not in the build, which keeps the
   * check about the two surfaces rather than about that coincidence.
   */
  const ANCHOR = 'panel.app-frame';

  /* Place a pin on one surface of the review screen and return the record. */
  const pinOnSurface = async (url) => {
    await carryWalkdown(page, url, 'blueprint');
    // The embed fetches the project's threads and draws their pins after
    // load. Scanning for a free spot before that has settled picks a point a
    // marker then covers — which is what made this check flaky.
    await page.waitForLoadState('networkidle');
    const target = app(page).getByTestId(ANCHOR);
    await expect(target, `${ANCHOR} must exist on ${url}`).toBeVisible();
    await armPinMode(page);
    const box = await target.boundingBox();
    /*
     * The review screen already carries pins from the project's own threads,
     * and a marker sitting on this anchor would swallow the click and open
     * that conversation instead. Markers live in the embed's shadow root, so
     * elementFromPoint cannot see them — their geometry can.
     */
    const markers = await app(page).getByTestId('pin.marker').all();
    const taken = (await Promise.all(markers.map((m) => m.boundingBox()))).filter(Boolean);
    const clear = (px, py) =>
      !taken.some(
        (b) =>
          px >= b.x - 4 && px <= b.x + b.width + 4 && py >= b.y - 4 && py <= b.y + b.height + 4,
      );
    let spot = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    outer: for (let fx = 0.1; fx <= 0.9; fx += 0.08)
      for (let fy = 0.2; fy <= 0.8; fy += 0.3) {
        const px = Math.round(box.x + box.width * fx),
          py = Math.round(box.y + box.height * fy);
        if (clear(px, py)) {
          spot = { x: px, y: py };
          break outer;
        }
      }

    const posted = page.waitForResponse(
      (r) => r.url().includes('/api/threads') && r.request().method() === 'POST',
    );
    await page.mouse.click(spot.x, spot.y);
    await expect(app(page).getByTestId('pin.form')).toBeVisible();
    await app(page).getByTestId('pin.note').fill(`Pinned on ${url}`);
    await app(page).getByTestId('pin.save').click();
    return (await (await posted).json()).thread;
  };

  // The design, and the running thing. The same anchor carries a pin on both
  // — which is what makes a note about the design answerable in the build.
  const onProto = await pinOnSurface(`${WD_ORIGIN}/prototype/screens/review.html`);
  const onApp = await pinOnSurface(`${WD_ORIGIN}/stand-in/review`);

  expect(onProto.anchor.element).toBe(ANCHOR);
  expect(onApp.anchor.element).toBe(ANCHOR);
  expect(onProto.anchor.surface).toBe('prototype');
  expect(onApp.anchor.surface).toBe('app');
  // Same screen, both times — the surface is what differs, not the screen.
  expect(onApp.anchor.screen).toBe(onProto.anchor.screen);
});

test('a pin files against the project the page belongs to, not the server default', {
  tag: '@rule:embed.pin.right-project',
}, async ({ page }) => {
  /*
   * The example project's own app, which carries no walkdown tag at all —
   * the case of a page nobody can edit, reviewed through the extension. With
   * nothing to declare its project, the address it reports is the only thing
   * that can say where a pin belongs.
   */
  await carryWalkdown(page, `${EXAMPLE_ORIGIN}/index.html`); // no project named
  await armPinMode(page);
  const target = app(page).getByTestId('waitlist.email');
  await expect(target).toBeVisible();
  const box = await target.boundingBox();

  const posted = page.waitForResponse(
    (r) => r.url().includes('/api/threads') && r.request().method() === 'POST',
  );
  await page.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await expect(app(page).getByTestId('pin.form')).toBeVisible();
  await app(page).getByTestId('pin.note').fill('Filed from the example app.');
  await app(page).getByTestId('pin.save').click();
  const { thread } = await (await posted).json();

  // Resolved from the address: a screen of the EXAMPLE blueprint, which is
  // not the project this server serves by default.
  expect(thread.anchor.screen).toBe('waitlist-join');
  expect(thread.anchor.element).toBe('waitlist.email');
});

test('a pin says what it is on contact, and says nothing until then', {
  tag: '@rule:embed.pin.tooltip-says-what-it-is',
}, async ({ page }) => {
  /*
   * The tooltip is walkdown's own markup rather than a title attribute, which
   * is what makes it appear on contact - and what made it appear without any
   * contact at all. Its resting state used to come only from the stylesheet
   * the embed FETCHES, so between the pins being drawn and the sheet landing
   * every tooltip on the page was simply a visible box of text, faded away
   * again on arrival: a flash on every load (n-0106). So the load is watched
   * from the framed document's first frame, not merely inspected once it has
   * settled - by then the flash is over.
   */
  await page.addInitScript(() => {
    if (window.parent === window) return; // walkdown's own page
    window.__tipShown = 0;
    const tick = () => {
      const sr = document.querySelector('[data-walkdown-chrome]')?.shadowRoot;
      // Painted, by the browser's own reckoning: not hidden, not
      // transparent, not collapsed out of the layout.
      for (const t of sr?.querySelectorAll('[data-testid="pin.tip"]') ?? [])
        if (t.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
          window.__tipShown++;
      if (performance.now() < 4000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // The review screen as the app: the surface the project's own pins were
  // placed on, so there are several of them to draw.
  await page.goto(FIXTURE);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const pins = app(page).getByTestId('pin.marker');
  await expect(pins.first()).toBeVisible();
  const drawn = await pins.count();
  expect(drawn, 'the screen needs pins for this to be about anything').toBeGreaterThan(0);

  // Nothing was ever painted while the pointer was nowhere near a pin.
  await page.waitForTimeout(1500);
  const reviewed = page
    .frames()
    .find((f) => f !== page.mainFrame() && f.url().includes('/stand-in/review'));
  const shown = await reviewed.evaluate(() => window.__tipShown);
  expect(shown, 'a pin showed its tooltip with no pointer on it').toBe(0);

  // On contact it is there, and it says which thread and what state.
  const marker = pins.first();
  const thread = await marker.getAttribute('data-thread');
  await marker.hover();
  const tip = app(page).getByTestId('pin.tip').first();
  await expect(tip).toContainText(thread);
  await expect
    .poll(async () => Number(await tip.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.9);
});
