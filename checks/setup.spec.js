/*
 * Screen setup, in a browser (ADR 0017): the panel runs a screen's steps in
 * the App pane before it loads the screen, says which step failed when one
 * does, tells two states of one page apart, points the App pane at another
 * target, and shows a rule's verdict on each.
 *
 * Driven against an app with sign-in (checks/fixtures/expenses-app.mjs) and a
 * blueprint of the checkspace's own, `expenses`. The app keeps a log of what
 * was asked of it, which is how a check knows what the panel ran, and in
 * what order.
 */
import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { EXPENSES_ORIGIN, EXPENSES_REVIEW_ORIGIN, FIXTURE } from '../playwright.config.js';
import { CHECKSPACE, EXPENSES_CHECKOUT } from './checkspace.mjs';

const APP = 'iframe[title="the application under review"]';
const REVIEW_PORT = Number(new URL(EXPENSES_REVIEW_ORIGIN).port);

/* The panel over the expenses blueprint, with the app frame on a page that needs no setup. */
function panelOn(frame = `${EXPENSES_ORIGIN}/expenses/7`) {
  const u = new URL(FIXTURE);
  u.searchParams.set('bp', 'expenses');
  u.searchParams.set('frame', frame);
  return u.href;
}

async function start(page, frame) {
  await page.goto(panelOn(frame));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
}

/* Open a rule from the list, from wherever the panel is. */
async function openRule(page, name) {
  const back = page.getByTestId('detail.back');
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByTestId('panel.rules-list').locator('button', { hasText: name }).first().click();
  await expect(page.getByTestId('detail.rule-id')).toContainText(name);
}

// Navigations of the frame only: the panel also asks an address whether it
// answers before it sends the frame there, and that is not a step.
const log = async (page) =>
  (await (await page.request.get(`${EXPENSES_ORIGIN}/__log`)).json()).filter((r) => r.frame);
/* What the app was asked, oldest first, as `METHOD /path`. */
const asked = async (page) =>
  (await log(page)).map((r) => `${r.port === REVIEW_PORT ? 'review ' : ''}${r.method} ${r.url}`);

test("opening a rule runs its screen's setup steps in order, then loads the screen", {
  tag: '@rule:screens.setup.runs-before-the-screen',
}, async ({ page }) => {
  await start(page);
  // Held, so the step it is on can be read while it runs.
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  await page.route(`${EXPENSES_ORIGIN}/dev/session`, async (route) => {
    await held;
    await route.continue();
  });

  await openRule(page, 'team-no-approve');
  const progress = page.getByTestId('panel.setup-progress');
  await expect(progress).toContainText('Setting up this screen: step 2 of 3');
  await expect(progress).toContainText('Posting the form to /dev/session.');
  await expect(progress).toContainText('Then /expenses/412 opens here.');
  // The steps, one row each, under the setup heading.
  const steps = page.getByTestId('detail.setup-steps').locator('li[data-step]');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveAttribute('data-state', 'done');
  await expect(steps.nth(1)).toHaveAttribute('data-state', 'now');
  await expect(steps.nth(2)).toHaveAttribute('data-state', 'todo');
  await expect(steps.nth(1)).toContainText('/dev/session');
  await expect(steps.nth(1)).toContainText('user_id 14');
  await expect(steps.nth(2)).toContainText('nav.signed-in');
  await expect(page.getByTestId('detail.setup-steps')).toContainText('Then open /expenses/412');
  release();

  // Visit, post, wait, and only then the screen's path, with its fixtures filled in.
  const app = page.frameLocator(APP);
  await expect(app.getByTestId('expense.title')).toContainText('Expense 412');
  await expect(app.getByTestId('nav.user')).toHaveText('14');
  await expect(progress).toHaveCount(0);
  expect(await asked(page)).toEqual([
    'GET /dev/impersonate?id=1',
    'POST /dev/session',
    'GET /expenses/412',
  ]);
  expect((await log(page))[1].form).toEqual({ user_id: '14' });
  for (const i of [0, 1, 2]) await expect(steps.nth(i)).toHaveAttribute('data-state', 'done');
  // No sideways scroll in the sidebar (n-0632).
  const list = page.getByTestId('detail.setup-steps');
  expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

  // Another rule on the same screen runs nothing.
  await openRule(page, 'team-note');
  await expect(page.getByTestId('detail.setup-steps')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await asked(page)).toHaveLength(3);

  // A rule on another screen does.
  await openRule(page, 'org-note');
  await expect.poll(async () => (await asked(page)).length).toBe(5);
  await expect(app.getByTestId('nav.user')).toHaveText('31');
  expect((await asked(page)).slice(3)).toEqual(['POST /dev/session', 'GET /expenses/412']);

  // And the rule's own control runs them again, from the first step.
  await page.getByTestId('detail.setup-again').click();
  await expect.poll(async () => (await asked(page)).length).toBe(7);
  expect((await asked(page)).slice(5)).toEqual(['POST /dev/session', 'GET /expenses/412']);

  // Prose is shown, as before, and nothing is run.
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
  await openRule(page, 'by-hand');
  await expect(page.getByTestId('detail.setup')).toHaveText('Sign in as any manager first.');
  await expect(page.getByTestId('detail.setup-steps')).toHaveCount(0);
  await expect(app.getByTestId('expense.title')).toContainText('Expense 7');
  expect(await asked(page)).toEqual(['GET /expenses/7']);
});

test('a setup step that fails stops the setup, and the App pane says which and why', {
  tag: '@rule:screens.setup.failure-stops-it',
}, async ({ page }) => {
  test.setTimeout(60_000);
  await start(page);

  // A step that answers 500.
  await openRule(page, 'broken');
  const failed = page.getByTestId('panel.setup-failed');
  await expect(failed).toContainText('Setup stopped at step 2 of 3');
  await expect(failed).toContainText('2, post');
  await expect(failed).toContainText('/dev/broken');
  await expect(failed).toContainText('500 Internal Server Error');
  await expect(failed).toContainText(
    '/expenses/500 was not loaded, so this is not the screen yet.',
  );
  expect(await asked(page)).toEqual(['GET /dev/impersonate?id=14', 'POST /dev/broken']);
  const steps = page.getByTestId('detail.setup-steps').locator('li[data-step]');
  await expect(steps.nth(0)).toHaveAttribute('data-state', 'done');
  await expect(steps.nth(1)).toHaveAttribute('data-state', 'failed');
  await expect(steps.nth(2)).toHaveAttribute('data-state', 'todo');
  await expect(page.getByTestId('detail.setup-state')).toHaveText('stopped at step 2');

  // Again, from its first step.
  await page.getByTestId('detail.setup-again').click();
  await expect.poll(async () => (await asked(page)).length).toBe(4);
  expect((await asked(page)).slice(2)).toEqual(['GET /dev/impersonate?id=14', 'POST /dev/broken']);
  await expect(failed).toContainText('Setup stopped at step 2 of 3');

  // A fixture the target lacks: nothing is run at all.
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
  await openRule(page, 'unseeded');
  await expect(failed).toContainText('Setup did not run');
  await expect(failed).toContainText('expense_draft');
  await expect(failed).toContainText('local');
  await expect(failed).toContainText('/expenses/{fixtures.expense_draft}');
  await expect(failed.locator('.cmd')).toHaveText(
    'walkdown fixtures set --blueprint expenses --target local',
  );
  await expect(page.getByTestId('detail.setup-state')).toHaveText('not run');
  expect(await asked(page)).toEqual([]);

  // An anchor that never appears: ten seconds, and it is named.
  await openRule(page, 'slow');
  await expect(failed).toContainText('Setup stopped at step 2 of 2', { timeout: 20_000 });
  await expect(failed).toContainText('2, wait for');
  await expect(failed).toContainText('nav.signed-in');
  await expect(failed).toContainText('Not on the page after ten seconds');
  expect(await asked(page)).toEqual(['GET /dev/slow']);
});

test('two states of one page: the panel takes the one it set up, and asks when it set up neither', {
  tag: '@rule:screens.identity.setup-tells-states-apart',
}, async ({ page }) => {
  await start(page);
  const picker = page.getByTestId('panel.screen-picker');
  const app = page.frameLocator(APP);

  // Opened by its rule: the second of the two, though the first shares its address.
  await openRule(page, 'org-note');
  await expect(app.getByTestId('nav.user')).toHaveText('31');
  await expect(picker).toContainText('Expense, view-only org manager');
  await expect(page.getByTestId('panel.screen-tied')).toHaveCount(0);

  // The same address in a fresh tab: nothing says which, so it asks.
  await start(page, `${EXPENSES_ORIGIN}/expenses/412`);
  const tied = page.getByTestId('panel.screen-tied');
  await expect(tied).toBeVisible();
  await expect(tied).toContainText('Two screens share /expenses/412.');
  await expect(tied).toContainText('They differ only in how they are set up');
  const rows = page.getByTestId('panel.screen-tied-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Expense, view-only team manager');
  await expect(rows.nth(1)).toContainText('Expense, view-only org manager');
  await expect(rows.nth(1)).toContainText(
    'Recipe as_view_only_org_manager: post /dev/session with user_id 31',
  );
  await expect(tied).toContainText('Nothing is filed under either until you do.');
  // Neither, until one is picked.
  await expect(picker).toContainText('Which screen?');

  // Picking one runs its setup, as opening a rule on it would.
  await rows.nth(1).click();
  await expect.poll(async () => (await asked(page)).length).toBe(2);
  await expect(app.getByTestId('nav.user')).toHaveText('31');
  await expect(picker).toContainText('Expense, view-only org manager');
  expect(await asked(page)).toEqual(['POST /dev/session', 'GET /expenses/412']);
});

test('the App pane can be pointed at another target, and the screen is set up there first', {
  tag: '@rule:panel.targets.switch-the-app-pane',
}, async ({ page }) => {
  await start(page);
  const target = page.getByTestId('panel.target');
  const app = page.frameLocator(APP);

  // With no choice made, local.
  await expect(target.locator('button').first()).toContainText('local');
  await openRule(page, 'team-no-approve');
  await expect(app.getByTestId('expense.title')).toContainText('Expense 412');

  // local first, then review; staging has no base URL and no row.
  await target.locator('button').first().click();
  const options = target.getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText('local');
  await expect(options.nth(0)).toContainText(EXPENSES_ORIGIN);
  await expect(options.nth(1)).toContainText('review');
  await expect(options.nth(1)).toContainText(EXPENSES_REVIEW_ORIGIN);
  await expect(target).not.toContainText('staging');

  // review: its base URL, its fixtures, the setup and then the path.
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
  await options.nth(1).click();
  await expect(app.getByTestId('expense.title')).toContainText(`Expense 9 on :${REVIEW_PORT}`);
  await expect(app.getByTestId('nav.user')).toHaveText('77');
  expect(await asked(page)).toEqual([
    'review GET /dev/impersonate?id=1',
    'review POST /dev/session',
    'review GET /expenses/9',
  ]);
  expect((await log(page))[1].form).toEqual({ user_id: '77' });
  await expect(page.getByTestId('detail.setup-steps')).toContainText('user_id 77');

  // Still chosen after a reload.
  await page.reload();
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect(page.getByTestId('panel.target').locator('button').first()).toContainText('review');
});

test("a rule's evidence has a row for each tier on each target that has a run", {
  tag: '@rule:panel.targets.verdict-on-each',
}, async ({ page }) => {
  await start(page);
  await openRule(page, 'team-no-approve');
  const ev = page.getByTestId('detail.evidence');
  const rows = ev.locator('.evrow:not(.evline):not(.evshot)');
  const local = rows.filter({ hasText: 'checks/local' });
  const review = rows.filter({ hasText: 'checks/review' });
  await expect(local).toHaveCount(1);
  await expect(review).toHaveCount(1);
  await expect(ev).not.toContainText('staging');

  // Each agrees with `walkdown status --target` for its target.
  // Its exit code says whether anything is failing, which is not the question here.
  const cli = (t) =>
    JSON.parse(
      spawnSync(
        process.execPath,
        ['../../../bin/walkdown.js', 'status', '--blueprint', 'expenses', '--target', t, '--json'],
        {
          cwd: EXPENSES_CHECKOUT,
          encoding: 'utf8',
          env: { ...process.env, WALKDOWN_HOME: `${CHECKSPACE}/home` },
        },
      ).stdout,
    ).rows.find((r) => r.rule === 'expenses.view.team-no-approve').cells[t];
  await expect(local).toContainText(cli('local').state);
  await expect(review).toContainText('✗ fail');
  expect(cli('review').state).toBe('fail');
  // Its date, and what the check said.
  await expect(review).toContainText('checks-person');
  await expect(review).toContainText(/ago|yesterday|\d/);
  const lines = ev.getByTestId('detail.evidence-line');
  await expect(lines.filter({ hasText: 'expected no Approve button, and found one' })).toHaveCount(
    1,
  );
  await expect(lines.filter({ hasText: 'spec/expenses.spec.ts:41' })).toHaveCount(2);

  // No other block in the detail repeats these verdicts.
  const detail = page.locator('.wdp-detail');
  expect((await detail.innerText()).match(/checks\/review/g)).toHaveLength(1);
});
