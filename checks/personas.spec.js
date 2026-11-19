/*
 * The Personas page (ADR 0018 §7, the panel.personas story): who the lanes
 * are, who signs in as each, where their stories stand and which boards they
 * are on.
 *
 * Driven on the checkspace's `staff` blueprint: three groups with personas in
 * two of them, two systems, a manager with two users and four stories, and
 * two boards. `payroll` takes its people from it; `expenses` declares neither
 * a group nor a system.
 */
import { expect, test } from '@playwright/test';
import { EXPENSES_ORIGIN, FIXTURE } from '../playwright.config.js';

async function personasOf(page, bp) {
  const u = new URL(FIXTURE);
  u.searchParams.set('bp', bp);
  u.searchParams.set('frame', `${EXPENSES_ORIGIN}/dev/slow`);
  await page.goto(u.href);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.getByTestId('panel.modes').click();
  await page.getByTestId('modes.menu').locator('[data-mode="personas"]').click();
  await expect(page.getByTestId('modes.page')).toBeVisible();
  return page.getByTestId('modes.page');
}

const card = (on, id) => on.locator(`[data-testid="personas.card"][data-persona="${id}"]`);

test('Personas lists each persona under its group, and the systems after them as small cards', {
  tag: '@rule:panel.personas.listed-by-group',
}, async ({ page }) => {
  const on = await personasOf(page, 'staff');
  // Two of the three groups have a persona. The third has no heading.
  const groups = on.getByTestId('personas.group');
  await expect(groups).toHaveText(['Customers', 'The back office']);
  // Each persona is one card, in the storyboard's order under its group.
  const cards = on.getByTestId('personas.card');
  await expect(cards.locator('.top b')).toHaveText(['Team manager', 'Visitor', 'Auditor']);
  const order = await on
    .locator('[data-testid="personas.group"], [data-testid="personas.card"] .top b, [data-systems]')
    .allTextContents();
  expect(order).toEqual([
    'Customers',
    'Team manager',
    'Visitor',
    'The back office',
    'Auditor',
    'Systems nobody signs in as',
  ]);
  const manager = card(on, 'manager');
  await expect(manager.locator('.top small')).toHaveText('of a client company');
  await expect(manager.locator('.blurb')).toHaveText('Runs a team and approves what it spends.');
  await expect(manager.locator('dl')).toContainText('The expenses app, at a desk.');

  // The systems come last, under one heading, as small dashed cards with a title and nothing else.
  const systems = on.getByTestId('personas.system');
  await expect(systems.locator('b')).toHaveText(['Platform jobs', 'Bank feed']);
  await expect(systems.nth(1)).toContainText('(outside)');
  for (const system of await systems.all()) {
    expect(await system.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
    await expect(system.locator('dl')).toHaveCount(0);
  }
  const small = await systems.first().boundingBox();
  const big = await manager.boundingBox();
  expect(small.height).toBeLessThan(big.height / 2);
  expect(small.y).toBeGreaterThan((await card(on, 'auditor').boundingBox()).y);

  // A blueprint with no groups and no systems: the personas, under no heading at all.
  const plain = await personasOf(page, 'expenses');
  await expect(plain.getByTestId('personas.card').locator('.top b')).toHaveText([
    'Manager',
    'Visitor',
  ]);
  await expect(plain.getByTestId('personas.group')).toHaveCount(0);
  await expect(plain.locator('h2')).toHaveCount(0);
  await expect(plain.getByTestId('personas.system')).toHaveCount(0);

  // A blueprint that takes its personas from another lists that one's.
  const taken = await personasOf(page, 'payroll');
  await expect(taken.getByTestId('personas.group')).toHaveText(['Customers', 'The back office']);
  await expect(taken.getByTestId('personas.card').locator('.top b')).toHaveText([
    'Team manager',
    'Visitor',
    'Auditor',
  ]);
  await expect(taken.getByTestId('personas.system')).toHaveCount(2);
});

test("a persona's card lists its users, and says for each target whether the user has an account there", {
  tag: '@rule:panel.personas.users-per-target',
}, async ({ page }) => {
  const on = await personasOf(page, 'staff');
  const users = card(on, 'manager').getByTestId('personas.users').locator('.user');
  await expect(users.locator('b')).toHaveText(['View-only team manager', 'View-only org manager']);
  // The first is the one a screen `as:` the persona alone signs in as.
  await expect(users.nth(0)).toContainText('· default');
  await expect(users.nth(1)).not.toContainText('default');
  // Each names its fixture, and each target says whether it has a value.
  await expect(users.nth(0).locator('code')).toHaveText('{fixtures.team_manager}');
  await expect(users.nth(0).locator('.tg')).toHaveText(['localhas a value', 'reviewhas a value']);
  await expect(users.nth(1).locator('code')).toHaveText('{fixtures.org_manager}');
  const targets = users.nth(1).locator('.tg');
  await expect(targets.nth(0)).toHaveText('localhas a value');
  await expect(targets.nth(1)).toContainText('review');
  await expect(targets.nth(1)).toContainText(
    'no value, so nothing signed in as this user can be walked or pictured there',
  );
  await expect(targets.nth(1)).toHaveClass(/none/);
  await expect(targets.nth(0)).not.toHaveClass(/none/);
  // A persona with no users says so.
  await expect(card(on, 'visitor').getByTestId('personas.users')).toHaveText(
    'Nobody signs in as this persona.',
  );
});

test("a persona's card counts its stories by where they stand, and names the boards it is on", {
  tag: '@rule:panel.personas.stories-and-boards',
}, async ({ page }) => {
  const on = await personasOf(page, 'staff');
  // The key says what each mark means, in the order the cards count them.
  await expect(on.locator('.key span')).toHaveText([
    '✕ failing',
    '○ not built',
    '● waiting on you',
    '◐ waiting on an agent',
    '✓ passing',
  ]);
  const manager = card(on, 'manager');
  const stories = manager.getByTestId('personas.stories');
  await expect(stories).toContainText('4 stories');
  // One at each of four marks, and none waiting on an agent, so that mark is not shown.
  await expect(stories.locator('.count')).toHaveText(['✕ 1', '○ 1', '● 1', '✓ 1']);
  await expect(stories.locator('.count').nth(2)).toHaveAttribute('title', '1 waiting on you');
  const audit = card(on, 'auditor').getByTestId('personas.stories');
  await expect(audit).toContainText('1 story');
  await expect(audit.locator('.count')).toHaveText(['◐ 1']);

  // The persona with no story says so, and is on no board.
  const visitor = card(on, 'visitor');
  await expect(visitor.getByTestId('personas.stories')).toHaveText('none yet');
  await expect(visitor.getByTestId('personas.boards')).toHaveText('none yet');
  await expect(visitor.getByTestId('personas.boards').locator('button')).toHaveCount(0);

  // The manager is on one of the two boards, and choosing it opens Boards on that board.
  const boards = manager.getByTestId('personas.boards').locator('button');
  await expect(boards).toHaveText(['Closing the month →']);
  await expect(card(on, 'auditor').getByTestId('personas.boards').locator('button')).toHaveText([
    'The quarterly audit →',
  ]);
  await boards.first().click();
  await expect(page.getByTestId('panel.modes')).toHaveAttribute('data-mode', 'boards');
  await expect(page.getByTestId('modes.board-picker')).toContainText('Closing the month');
  await expect(page.locator('.modes-canvas')).toHaveAttribute('data-board', 'month-end');
  expect(new URL(page.url()).searchParams.get('board')).toBe('month-end');
  // One step back is Personas again.
  await page.goBack();
  await expect(page.getByTestId('panel.modes')).toHaveAttribute('data-mode', 'personas');
});
