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
  tag: ['@rule:embed.pin.both-surfaces', '@rule:embed.pin.anchored-target', '@rule:embed.pin.follows-the-visible-surface'],
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
  const onApp = await pinOnSurface(`${WD_ORIGIN}/as-built/review.html`);

  expect(onProto.anchor.element).toBe(ANCHOR);
  expect(onApp.anchor.element).toBe(ANCHOR);
  expect(onProto.anchor.surface).toBe('prototype');
  expect(onApp.anchor.surface).toBe('app');
  // Same screen, both times — the surface is what differs, not the screen.
  expect(onApp.anchor.screen).toBe(onProto.anchor.screen);

  /*
   * And each stays where it was put. The anchor exists on both surfaces, so
   * an anchored pin used to draw on both - a note about the design's frame
   * showing up on the app's (n-0255). Surface wins: the pin is about what
   * the reviewer was looking at, and the anchor only says where on it.
   */
  const drawn = async (url) => {
    await carryWalkdown(page, url, 'blueprint');
    await page.waitForLoadState('networkidle');
    await expect(app(page).getByTestId(ANCHOR)).toBeVisible();
    return (id) => app(page).locator(`[data-testid="pin.marker"][data-thread="${id}"]`);
  };
  const onProtoAgain = await drawn(`${WD_ORIGIN}/prototype/screens/review.html`);
  await expect(onProtoAgain(onProto.id)).toBeVisible();
  await expect(onProtoAgain(onApp.id)).toHaveCount(0);
  const onAppAgain = await drawn(`${WD_ORIGIN}/as-built/review.html`);
  await expect(onAppAgain(onApp.id)).toBeVisible();
  await expect(onAppAgain(onProto.id)).toHaveCount(0);
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

/*
 * The other half of the same rule: a tag ON THE PAGE naming a blueprint does
 * not redirect a write. The panel has one open, and that is the thing being
 * reviewed. The embed used to read its own tag first for the requests it made
 * itself, while pins went through the panel - so a page carrying a tag had
 * its pin filed in one blueprint and its reply sent to another, where the
 * thread did not exist (n-0274).
 *
 * Every write the framed page makes is watched, not only the pin: the tag
 * names a blueprint this server really holds, so a request that did read the
 * tag would succeed silently rather than 404.
 */
test('a tag on the page naming another blueprint does not redirect a write', {
  tag: '@rule:embed.pin.right-project',
}, async ({ page }) => {
  const { blueprints } = await (await fetch(`${WD_ORIGIN}/api/blueprint`)).json();
  // What the fixture's panel opens, by key - the panel names its blueprint
  // by key from the moment the server answers, whatever form it was asked in.
  const open = blueprints.find((b) => b.id === 'blueprint').key;
  const other = blueprints.map((b) => b.key).find((k) => k !== open);
  expect(other, 'the server must hold a second blueprint for this to be about anything').toBeTruthy();

  const writes = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/')) writes.push(new URL(r.url()));
  });

  await pinning(page, { bp: other }); // the framed page's own tag names the other one
  const cta = app(page).getByTestId('host.cta');
  const box = await cta.boundingBox();
  const { thread } = await pinAt(page, Math.round(box.x + 8), Math.round(box.y + 8));
  expect(thread.anchor.element).toBe('host.cta');

  expect(writes.length).toBeGreaterThan(0);
  for (const u of writes) {
    expect(u.searchParams.get('bp'), `${u.pathname} filed against what the panel has open`).toBe(open);
  }
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
    .find((f) => f !== page.mainFrame() && f.url().includes('/as-built/review.html'));
  const shown = await reviewed.evaluate(() => window.__tipShown);
  expect(shown, 'a pin showed its tooltip with no pointer on it').toBe(0);

  // On contact it is there, and it says which thread and what state. The
  // LAST pin drawn: two of the project's own pins share a spot, and the one
  // underneath cannot be touched - which is a fact about the pins, not the
  // tooltip.
  const marker = pins.last();
  const thread = await marker.getAttribute('data-thread');
  await marker.hover();
  const tip = app(page).locator(`[data-testid="pin.marker"][data-thread="${thread}"] [data-testid="pin.tip"]`);
  await expect(tip).toContainText(thread);
  await expect
    .poll(async () => Number(await tip.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.9);

  /*
   * Every pin's card stays inside the frame, whichever edge the pin is near
   * (n-0326): a pin in the bottom band used to draw its card from its own
   * top and lose the last line under the frame's edge.
   */
  const frame = await page.getByTestId('panel.app-frame').boundingBox();
  for (const pin of await pins.all()) {
    const id = await pin.getAttribute('data-thread');
    const at = await pin.boundingBox();
    if (!at) continue;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    const card = app(page).locator(`[data-testid="pin.marker"][data-thread="${id}"] [data-testid="pin.tip"]`);
    // Two of the project's pins share a spot; the one underneath cannot be
    // touched, so a card that never shows is skipped, not failed.
    let shown = false;
    for (let i = 0; i < 10 && !shown; i++) {
      shown = Number(await card.evaluate((el) => getComputedStyle(el).opacity)) > 0.9;
      if (!shown) await page.waitForTimeout(100);
    }
    if (!shown) continue;
    const c = await card.boundingBox();
    expect(c.y, `${id}: card top inside the frame`).toBeGreaterThanOrEqual(frame.y - 1);
    expect(c.y + c.height, `${id}: card bottom inside the frame`).toBeLessThanOrEqual(frame.y + frame.height + 1);
    expect(c.x, `${id}: card left inside the frame`).toBeGreaterThanOrEqual(frame.x - 1);
    expect(c.x + c.width, `${id}: card right inside the frame`).toBeLessThanOrEqual(frame.x + frame.width + 1);
  }
});

/*
 * A screenshot pasted into the pin form goes on the pin (n-0096): shown
 * small before filing, named on the record, served by name, drawn under the
 * words as a thumbnail that opens. The paste is a real ClipboardEvent with a
 * File on it, which is what a screenshot on the clipboard arrives as.
 */
test('a screenshot dropped on the pin form goes on the pin, and opens from the stream', {
  tag: '@rule:embed.threads.picture-on-a-pin',
}, async ({ page }) => {
  await page.goto(FIXTURE);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('panel.pin-mode').click();
  const frame = app(page);
  const box = await page.getByTestId('panel.app-frame').boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);
  const note = frame.getByTestId('pin.note');
  await expect(note).toBeVisible();
  // A 1x1 PNG, dragged from the desk and dropped on the box (n-0328): a
  // real DragEvent with a File on its transfer, which is what a drop is.
  const drop = (el) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
  };
  // The form says it will take the picture: ready while a file is in the
  // air over the page, over while it is over the form, nothing for text
  // (Topher, 2026-09-21).
  const form = frame.getByTestId('pin.form');
  const air = (el, [what, type]) => {
    const dt = new DataTransfer();
    if (type === 'Files') dt.items.add(new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    else dt.setData('text/plain', 'words');
    // composed: a native drag event crosses the embed's shadow root on its
    // way to the window; a synthetic one only does when told to.
    el.dispatchEvent(new DragEvent(what, { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
  };
  await frame.locator('body').evaluate(air, ['dragenter', 'text']);
  await expect(form).not.toHaveAttribute('data-drag', /ready|over/);
  await frame.locator('body').evaluate(air, ['dragenter', 'Files']);
  await expect(form).toHaveAttribute('data-drag', 'ready');
  await form.evaluate(air, ['dragenter', 'Files']);
  await expect(form).toHaveAttribute('data-drag', 'over');
  await form.evaluate(air, ['dragleave', 'Files']);
  await expect(form).toHaveAttribute('data-drag', 'ready');
  await note.evaluate(drop);
  await expect(form).not.toHaveAttribute('data-drag', /ready|over/);
  await expect(frame.getByTestId('pin.shots').locator('img'), 'shown small before it is filed').toHaveCount(1);
  await note.fill('The corner is clipped, see the picture.');
  await frame.getByTestId('pin.save').click();

  // On disk: the record names the picture, and the file is served by that name.
  let thread;
  await expect.poll(async () => {
    const bp = await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json();
    thread = bp.threads.find((t) => t.body === 'The corner is clipped, see the picture.');
    return thread?.attachments?.length ?? 0;
  }).toBe(1);
  expect(thread.attachments[0].file).toMatch(/^attachments\/n-\d{4}-1\.png$/);
  expect(thread.attachments[0].name).toBe('shot.png');
  const served = await page.request.get(`${WD_ORIGIN}/${thread.attachments[0].file}?bp=blueprint`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toMatch(/image\/png/);
  expect((await page.request.get(`${WD_ORIGIN}/attachments/../${thread.id}.yml?bp=blueprint`)).status()).toBe(404);

  // In the stream: a thumbnail under the words, which opens the picture.
  await page.getByTestId('panel.pin-mode').click();
  await frame.locator(`[data-testid="pin.marker"][data-thread="${thread.id}"]`).click();
  const shot = page.getByTestId('thread.panel').locator('[data-attachment]').first();
  await expect(shot.locator('img')).toBeVisible();
  await shot.click();
  const modal = page.getByTestId('detail.evidence-modal');
  await expect(modal.locator('img')).toHaveCount(1);
  expect(await modal.locator('img').evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
  await page.getByTestId('detail.evidence-close').click();
  // The same drop on the thread's own composer puts the picture on the reply.
  await page.getByTestId('thread.reply').evaluate(drop);
  await expect(page.getByTestId('thread.shots').locator('img'), 'held above the box until sent').toHaveCount(1);
  // And a drop that misses the box - on the messages above it - is taken
  // by the screen the same way, rather than by the browser, which opened
  // the file in a new tab (Topher, 2026-09-21, n-0328).
  await page.getByTestId('thread.body').evaluate(drop);
  await expect(page.getByTestId('thread.shots').locator('img'), 'the screen is the target, not the box').toHaveCount(2);
  expect(page.context().pages().length, 'no tab opened on the file').toBe(1);
});

/*
 * The standalone popover — the embed with no panel around it, which is the
 * script-tag delivery — renders a message through the same MSG as the panel,
 * so its ids arrive marked as refs. It has no rule screen and no thread
 * screen of its own to open them on, and a ref that does nothing when clicked
 * is what n-0294 found. Here a thread id opens that thread when it is a pin
 * on this page, an evidence key is a link to the file, and a rule id is the
 * words the author typed.
 */
test('beside the pin, an id is a link only where the popover can open it', {
  tag: '@rule:threads.conversation.one-stream',
}, async ({ page }) => {
  // Two pins on the as-built page, filed through the door: the second refers to
  // the first, to a rule, and to an evidence key.
  const file = async (body) => {
    const res = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
      data: {
        kind: 'note',
        body,
        anchor: { screen: 'review', element: 'panel.bar', surface: 'app', position: { x: 40, y: 20 } },
      },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).id;
  };
  const first = await file('The first pin, referred to by the second.');
  const second = await file(
    `Refs: ${first}, n-0001 (not pinned here), rule threads.conversation.one-stream, and runs/evidence/2026-09-14T19-09-05Z/one-stream-source-check.txt`,
  );

  // The as-built page on its own, top-level: no panel, so the dot opens the
  // embed's popover rather than handing the thread across a frame.
  await page.goto(`${WD_ORIGIN}/as-built/review.html`);
  const chrome = page.locator('[data-walkdown-chrome]');
  await expect(chrome).toBeAttached();
  const dot = page.locator(`[data-testid="pin.marker"][data-thread="${second}"] .wd-dot`);
  await expect(dot).toBeVisible();
  await dot.click();
  const popover = page.getByTestId('thread.panel');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(second);

  // The evidence key is a real link to the file the server resolves it to.
  const ev = popover.locator('[data-evidence-ref]');
  await expect(ev).toHaveAttribute('href', /\/evidence\/runs\/evidence\/2026-09-14T19-09-05Z\//);
  await expect(ev).toHaveAttribute('target', '_blank');
  // A rule id, and a thread not pinned on this page: nothing in this popover
  // can open them, so they link OUT to the panel at its own address, in a
  // new tab (n-0297) - never a link that does nothing.
  const ruleRef = popover.locator('[data-rule-ref]');
  await expect(ruleRef).toHaveCount(1);
  await expect(ruleRef).toHaveJSProperty('tagName', 'A');
  // Named by KEY, the one spelling the server never has to guess at, since
  // this page never said which blueprint it belongs to.
  await expect(ruleRef).toHaveAttribute('href', new RegExp(`^${WD_ORIGIN}/\\?bp=.*0001-walkdown.*&rule=threads\\.conversation\\.one-stream$`));
  await expect(ruleRef).toHaveAttribute('target', '_blank');
  const away = popover.locator('[data-thread-ref="n-0001"]');
  await expect(away).toHaveJSProperty('tagName', 'A');
  await expect(away).toHaveAttribute('href', new RegExp(`^${WD_ORIGIN}/\\?bp=.*&thread=n-0001$`));
  // Before the click, under the cursor: what the id names, and that the
  // link leaves (n-0298) - the rule's statement and verdict, the thread's
  // status, author and first line. A pin this popover can open itself
  // gets the same card, without the leaving line.
  const card = chrome.locator('[data-testid="ref.preview"]');
  await ruleRef.hover();
  await expect(card).toBeVisible();
  // Over the popover it was summoned from, not under it (n-0299).
  const above = await card.evaluate((el, pop) => {
    const z = (n) => Number(getComputedStyle(n).zIndex) || 0;
    return z(el) > z(pop);
  }, await popover.elementHandle());
  expect(above).toBe(true);
  await expect(card).toContainText('threads.conversation.one-stream');
  await expect(card).toContainText('one stream');
  await expect(card).toContainText('Opens in walkdown');
  await away.hover();
  await expect(card).toContainText('n-0001');
  await expect(card.locator('.badge')).not.toHaveCount(0);
  await expect(card).toContainText('Opens in walkdown');
  await popover.locator(`[data-thread-ref="${first}"]`).hover();
  await expect(card).toContainText('The first pin, referred to by the second.');
  await expect(card).not.toContainText('Opens in walkdown');
  await popover.locator('h3, .wd-stream').first().hover();
  await expect(card).toBeHidden();
  // And the address the link names opens the thing: the panel, on that rule.
  const ruleHref = await ruleRef.getAttribute('href');
  const there = await page.context().newPage();
  await there.goto(ruleHref);
  await expect(there.getByTestId('detail.rule-id')).toHaveText('threads.conversation.one-stream');
  await there.goto(await away.getAttribute('href'));
  await expect(there.getByTestId('thread.body')).toBeVisible();
  await expect(there.getByTestId('thread.provenance')).toContainText('n-0001');
  await there.close();
  // The other pin's id opens that pin's conversation, in the same popover.
  const ref = popover.locator(`[data-thread-ref="${first}"]`);
  await expect(ref).toHaveCount(1);
  await ref.click();
  await expect(page.getByTestId('thread.panel')).toContainText('The first pin');
  await expect(page.getByTestId('thread.panel')).not.toContainText(second);
  // And it opened on the page, not past its edge.
  const box = await page.getByTestId('thread.panel').boundingBox();
  const width = await page.evaluate(() => window.innerWidth);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
});

/*
 * ADR 0005 §5: the standalone popover offers Verify beside the pin - only to
 * a declared person, only on an answered note that waits on one - and
 * pressing it closes the thread under that name and takes the pin away. The
 * checks home declares `checks-person`, so the button is offered; the pins
 * are filed through the door so the reason is the door's.
 */
test('beside the pin, Verify is offered to a declared person on an answered note, and closes it', {
  tag: '@rule:embed.threads.actions-in-context',
}, async ({ page }) => {
  // Each pin at its own offset along the bar: a marker stacked on another
  // swallows the click meant for the one beneath.
  let x = 0;
  const file = async (body, extra = {}) => {
    x += 140;
    const res = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
      data: {
        kind: 'note',
        body,
        anchor: { screen: 'review', element: 'panel.bar', surface: 'app', offset: { x, y: 14 } },
        ...extra,
      },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).id;
  };
  const answered = await file('Feedback, answered.');
  const claim = await page.request.post(`${WD_ORIGIN}/api/threads/${answered}/status?bp=blueprint`, {
    data: { status: 'addressed', via: 'agent', reason: 'Done.' },
  });
  expect(claim.ok()).toBeTruthy();
  const open = await file('Feedback, not answered.');
  const observed = await file('Something the agent noticed.', { via: 'agent', reason: 'observation' });
  const settled = await page.request.post(`${WD_ORIGIN}/api/threads/${observed}/status?bp=blueprint`, {
    data: { status: 'settled', via: 'agent', reason: 'Tidied.' },
  });
  expect(settled.ok()).toBeTruthy();

  await page.goto(`${WD_ORIGIN}/as-built/review.html`);
  await expect(page.locator('[data-walkdown-chrome]')).toBeAttached();
  const openPin = async (id) => {
    await page.keyboard.press('Escape');
    const dot = page.locator(`[data-testid="pin.marker"][data-thread="${id}"] .wd-dot`);
    await expect(dot).toBeVisible();
    await dot.click();
    const popover = page.getByTestId('thread.panel');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(id);
    return popover;
  };

  // Not offered where nothing waits on a person: an open note, or an
  // observation the agent already settled (whose pin has left the page).
  await expect(page.locator(`[data-testid="pin.marker"][data-thread="${observed}"]`)).toHaveCount(0);
  await expect((await openPin(open)).getByTestId('thread.verify')).toHaveCount(0);

  // Offered on the answered one, under the declared name.
  const popover = await openPin(answered);
  const verify = popover.getByTestId('thread.verify');
  await expect(verify).toBeVisible();
  await expect(verify).toHaveAttribute('title', /checks-person/);
  await verify.click();

  // The pin leaves the page, and the ledger has the thread verified under
  // the person - never a machine.
  await expect(page.locator(`[data-testid="pin.marker"][data-thread="${answered}"]`)).toHaveCount(0);
  await expect(page.getByTestId('thread.panel')).toHaveCount(0);
  const { threads } = await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json();
  const t = threads.find((x) => x.id === answered);
  expect(t.status).toBe('verified');
  expect(t.verified_by).toBe('checks-person');
});
