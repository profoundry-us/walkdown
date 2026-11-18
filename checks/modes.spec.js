/*
 * The three modes of one window (the panel.modes story, ADR 0018 §7).
 *
 * Walked on the example blueprint, which has two boards and two personas,
 * with its own app in the frame. The walkdown blueprint has no board, and is
 * the case of a blueprint without one.
 */
import { expect, test } from '@playwright/test';

import { EXAMPLE_ORIGIN, FIXTURE, WD_ORIGIN } from '../playwright.config.js';

const EXAMPLE = '0002-cs-example';

function fixtureFor(params = {}) {
  const u = new URL(FIXTURE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.href;
}

/** The panel on the example blueprint, its join page in the frame. */
async function example(page, params = {}) {
  await page.goto(fixtureFor({ bp: EXAMPLE, frame: `${EXAMPLE_ORIGIN}/index.html`, ...params }));
  await expect(page.getByTestId('panel.modes')).toBeVisible();
}

const switcher = (page) => page.getByTestId('panel.modes');

async function choose(page, mode) {
  await switcher(page).click();
  await page.getByTestId('modes.menu').locator(`[data-mode="${mode}"]`).click();
  await expect(switcher(page)).toHaveAttribute('data-mode', mode);
}

const sheet = (page) => page.getByTestId('modes.page').locator('[data-board-sheet]');
const placeOf = (page) =>
  sheet(page).evaluate((el) => ({ x: el.dataset.x, y: el.dataset.y, zoom: el.dataset.zoom }));

test('one switcher, named for the chosen mode, lists the three modes', {
  tag: '@rule:panel.modes.one-switcher',
}, async ({ page }) => {
  await example(page);
  const sw = switcher(page);

  // One button where the walkdown name stood: after the gear, before the project.
  await expect(page.getByTestId('panel.bar').getByTestId('panel.modes')).toHaveCount(1);
  await expect(page.getByTestId('panel.bar').getByText('walkdown', { exact: true })).toHaveCount(0);
  const gear = await page.getByTestId('panel.desk-tuner').boundingBox();
  const at = await sw.boundingBox();
  const project = await page.getByTestId('panel.project').boundingBox();
  expect(at.x).toBeGreaterThan(gear.x);
  expect(at.x).toBeLessThan(project.x);

  // Walkdown when the address names no mode: its icon, then its name.
  expect(new URL(page.url()).searchParams.get('mode')).toBeNull();
  await expect(sw).toHaveText('Walkdown');
  await expect(sw).toHaveAccessibleName('Mode: Walkdown');
  const iconAt = await sw.locator('svg').first().boundingBox();
  const nameAt = await sw.locator('span', { hasText: 'Walkdown' }).boundingBox();
  expect(iconAt.x).toBeLessThan(nameAt.x);

  // The list: three modes in order, each with an icon and a line.
  await sw.click();
  const rows = page.getByTestId('modes.menu').getByRole('menuitemradio');
  // The list can be seen, and is not cut off by the bar it hangs from.
  const shown = () =>
    page.getByTestId('modes.menu').evaluate((el) => {
      const b = el.getBoundingClientRect();
      const hit = el.getRootNode().elementFromPoint(b.x + b.width / 2, b.y + b.height - 12);
      return el.contains(hit);
    });
  expect(await shown()).toBe(true);
  await expect(rows.locator('.name')).toHaveText(['Walkdown', 'Boards', 'Personas']);
  for (const row of await rows.all()) {
    await expect(row.locator('svg')).toBeVisible();
    await expect(row.locator('.line')).toHaveText(/\w+ .+\./);
  }
  await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'false');

  // Choosing Boards closes it; opened again, Boards is marked and Walkdown not.
  await rows.nth(1).click();
  await expect(page.getByTestId('modes.menu')).toHaveCount(0);
  await expect(sw).toHaveText('Boards');
  await expect(sw).toHaveAccessibleName('Mode: Boards');
  await sw.click();
  await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'false');
  expect(await shown()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('modes.menu')).toHaveCount(0);

  // In the same place in all three modes, with the settings beside it.
  expect((await sw.boundingBox()).x).toBe(at.x);
  await page.getByTestId('panel.desk-tuner').click();
  await expect(page.getByTestId('modes.settings')).toContainText('Boards settings');
  await page.keyboard.press('Escape');
  await choose(page, 'personas');
  await expect(sw).toHaveText('Personas');
  expect((await sw.boundingBox()).x).toBe(at.x);
  await page.getByTestId('panel.desk-tuner').click();
  await expect(page.getByTestId('modes.settings')).toContainText('Personas settings');
  await page.keyboard.press('Escape');
  await choose(page, 'walkdown');
  expect((await sw.boundingBox()).x).toBe(at.x);
  await page.getByTestId('panel.desk-tuner').click();
  await expect(page.getByTestId('settings.panel')).toBeVisible();

  // A blueprint with no board still offers Boards, and its page says so.
  await page.goto(FIXTURE);
  await expect(switcher(page)).toBeVisible();
  await choose(page, 'boards');
  await expect(page.getByTestId('modes.page')).toContainText('This blueprint has no boards.');
  await expect(page.getByTestId('modes.board-picker')).toHaveCount(0);
});

test('Boards and Personas take the whole window, and the app keeps running underneath', {
  tag: '@rule:panel.modes.whole-window',
}, async ({ page }) => {
  await example(page);
  await page.getByTestId('panel.rules-list').locator('button[data-rule]').first().click();
  const rule = await page.getByTestId('detail.rule-id').textContent();
  const framed = page.frameLocator('[data-testid="panel.app-frame"]');
  const field = framed.locator('input').first();
  await expect(field).toBeVisible();
  await field.fill('kept@example.com');
  const surface = await page.getByTestId('panel.surface-build').getAttribute('class');
  const screen = await page.getByTestId('panel.screen-picker').textContent();

  const appFrame = await page.getByTestId('panel.app-frame').elementHandle();
  const inFrame = await appFrame.contentFrame();
  let loads = 0;
  page.on('framenavigated', (f) => {
    if (f === inFrame) loads += 1;
  });

  for (const mode of ['boards', 'personas']) {
    await choose(page, mode);
    const pageEl = page.getByTestId('modes.page');
    await expect(pageEl).toBeVisible();
    const box = await pageEl.boundingBox();
    const bar = await page.getByTestId('panel.bar').boundingBox();
    const view = page.viewportSize();
    expect(box.x).toBe(0);
    expect(box.width).toBe(view.width);
    expect(Math.round(box.y)).toBe(Math.round(bar.y + bar.height));
    expect(Math.round(box.y + box.height)).toBe(view.height);
    await expect(page.getByTestId('panel.rules-list')).toBeHidden();
    await expect(page.getByTestId('detail.rule-id')).toBeHidden();
    await expect(page.getByTestId('panel.app-frame')).toBeHidden();
  }

  await choose(page, 'walkdown');
  await expect(page.getByTestId('modes.page')).toBeHidden();
  await expect(page.getByTestId('detail.rule-id')).toBeVisible();
  await expect(page.getByTestId('detail.rule-id')).toHaveText(rule);
  await expect(page.getByTestId('panel.screen-picker')).toHaveText(screen);
  await expect(page.getByTestId('panel.surface-build')).toHaveClass(surface);
  await expect(page.getByTestId('panel.app-frame')).toBeVisible();
  // Not loaded again, and what was typed is still there.
  await expect(field).toHaveValue('kept@example.com');
  expect(loads).toBe(0);
});

test('a mode left and chosen again is where it was left', {
  tag: '@rule:panel.modes.each-keeps-its-place',
}, async ({ page }) => {
  await example(page, { mode: 'boards', board: 'running-the-list' });
  await expect(page.getByTestId('modes.board-picker')).toHaveText('Running the list');
  const opened = await placeOf(page);

  // Moved and zoomed away from where it opened.
  const canvas = await page.getByTestId('modes.page').boundingBox();
  await page.mouse.move(canvas.x + 500, canvas.y + 300);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 640, canvas.y + 390, { steps: 4 });
  await page.mouse.up();
  await page.getByTitle('Zoom in').click();
  await page.getByTitle('Zoom in').click();
  const left = await placeOf(page);
  expect(left).not.toEqual(opened);
  expect(left.zoom).toBe('120');

  await choose(page, 'walkdown');
  await choose(page, 'boards');
  await expect(page.getByTestId('modes.board-picker')).toHaveText('Running the list');
  expect(await placeOf(page)).toEqual(left);

  await page.reload();
  await expect(page.getByTestId('modes.board-picker')).toHaveText('Running the list');
  expect(await placeOf(page)).toEqual(left);

  // Personas, scrolled down and left for another mode.
  await page.setViewportSize({ width: 520, height: 300 });
  await choose(page, 'personas');
  const people = page.getByTestId('modes.page');
  await people.evaluate((el) => {
    el.scrollTop = 90;
  });
  await expect.poll(() => people.evaluate((el) => el.scrollTop)).toBe(90);
  await choose(page, 'boards');
  await choose(page, 'personas');
  await expect.poll(() => people.evaluate((el) => el.scrollTop)).toBe(90);
});

test('the address names the mode and the board, and a link opens there', {
  tag: '@rule:panel.modes.address-names-the-mode',
}, async ({ page, context }) => {
  await example(page);
  const q = () => new URL(page.url()).searchParams;
  expect(q().get('mode')).toBeNull();

  await choose(page, 'boards');
  await expect.poll(() => q().get('mode')).toBe('boards');
  expect(q().get('board')).toBe('getting-a-spot');

  await page.getByTestId('modes.board-picker').click();
  await page.locator('[data-board="running-the-list"]').click();
  await expect(page.getByTestId('modes.board-picker')).toHaveText('Running the list');
  await expect.poll(() => q().get('board')).toBe('running-the-list');

  // The address, opened in a new window, with no choice made in it.
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(switcher(other)).toHaveText('Boards');
  await expect(other.getByTestId('modes.board-picker')).toHaveText('Running the list');
  await expect(
    other.getByTestId('modes.page').locator('[data-board="running-the-list"]'),
  ).toBeVisible();
  await other.close();

  // Back and Forward move between what was chosen.
  await page.goBack();
  await expect(page.getByTestId('modes.board-picker')).toHaveText('Getting a spot');
  await page.goBack();
  await expect(switcher(page)).toHaveText('Walkdown');
  await expect(page.getByTestId('modes.page')).toBeHidden();
  await page.goForward();
  await expect(switcher(page)).toHaveText('Boards');
  await expect(page.getByTestId('modes.board-picker')).toHaveText('Getting a spot');

  // A board the blueprint does not have.
  await example(page, { mode: 'boards', board: 'refunds' });
  await expect(switcher(page)).toHaveText('Boards');
  await expect(page.getByTestId('modes.page')).toContainText(
    'There is no board called refunds here.',
  );
  expect(q().get('board')).toBe('refunds');
});

test('Finish walkdown is offered on Walkdown only, and the sitting stays open', {
  tag: '@rule:panel.modes.finish-only-on-walkdown',
}, async ({ page }) => {
  await example(page);
  const walk = page.getByTestId('panel.walk');

  // A sitting under way, with two rules judged.
  if ((await page.getByTestId('panel.actor').count()) === 0) {
    await walk.click();
    const go = page.getByTestId('walkdown.signing.start');
    await expect(go.or(page.getByTestId('panel.actor'))).toBeVisible();
    if (await go.isVisible()) {
      if (await go.isDisabled()) await page.getByTestId('walkdown.signing.role').first().check();
      await go.click();
    }
  }
  await expect(page.getByTestId('panel.actor')).toBeVisible();
  const { rows } = await page.evaluate(
    async ([origin, bp]) => (await fetch(`${origin}/api/blueprint?bp=${bp}`)).json(),
    [WD_ORIGIN, EXAMPLE],
  );
  const verdict = page
    .getByTestId('detail.verdict')
    .locator('[data-v="pass"], [data-v="approved"]');
  let judged = 0;
  for (const { rule } of rows) {
    if (judged === 2) break;
    if (await page.getByTestId('detail.back').isVisible())
      await page.getByTestId('detail.back').click();
    const row = page.getByTestId('panel.rules-list').locator(`[data-rule="${rule}"]`).first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await expect(page.getByTestId('detail.rule-id')).toHaveText(rule);
    await expect(verdict).toBeVisible();
    await verdict.click();
    judged += 1;
    await expect(page.getByTestId('panel.judged')).toHaveText(new RegExp(`^\\+${judged}/\\d+$`));
  }
  const count = await page.getByTestId('panel.judged').textContent();
  await expect(walk).toHaveText('Finish walkdown');

  for (const mode of ['boards', 'personas']) {
    await choose(page, mode);
    await expect(walk).toHaveCount(0);
    // Nor the button that puts walkdown away: the switcher is the way back.
    await expect(page.getByTitle('Put walkdown away')).toHaveCount(0);
    await expect(switcher(page)).toBeVisible();
  }

  await choose(page, 'walkdown');
  await expect(walk).toHaveText('Finish walkdown');
  await expect(page.getByTestId('panel.judged')).toHaveText(count);

  // End it, so the next check starts from nothing.
  await walk.click();
  await expect(page.getByTestId('panel.actor')).toBeHidden();
});
