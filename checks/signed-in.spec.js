/*
 * A screen signed in `as:` a user, in a browser (ADR 0018 §3): the panel runs
 * that user's steps, then the screen's own, then loads its path, and the
 * rule's detail says who is signed in.
 *
 * Driven against the app with sign-in (checks/fixtures/expenses-app.mjs) and
 * the checkspace's `expenses` blueprint, whose storyboard declares a manager
 * with three users and a visitor with none; and `travel`, whose personas are
 * in a blueprint the checkspace never registers.
 */
import { expect, test } from '@playwright/test';
import { EXPENSES_ORIGIN, FIXTURE } from '../playwright.config.js';

const APP = 'iframe[title="the application under review"]';

function panelOn(bp) {
  const u = new URL(FIXTURE);
  u.searchParams.set('bp', bp);
  u.searchParams.set('frame', `${EXPENSES_ORIGIN}/dev/slow`);
  return u.href;
}

async function start(page, bp = 'expenses') {
  await page.goto(panelOn(bp));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
}

async function openRule(page, name) {
  const back = page.getByTestId('detail.back');
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByTestId('panel.rules-list').locator('button', { hasText: name }).first().click();
  await expect(page.getByTestId('detail.rule-id')).toContainText(name);
}

/* What the app's frame asked of it, oldest first, as `METHOD /path`. */
const asked = async (page) =>
  (await (await page.request.get(`${EXPENSES_ORIGIN}/__log`)).json())
    .filter((r) => r.frame)
    .map((r) => `${r.method} ${r.url}`);

/* Hold a request until released, so the step it is can be read while it runs. */
async function hold(page, path) {
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  await page.route(`${EXPENSES_ORIGIN}${path}`, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

test("a screen signed in as a user runs the user's steps, then its own, then loads its path", {
  tag: '@rule:screens.setup.signs-in-as-the-user',
}, async ({ page }) => {
  await start(page);
  const signedIn = page.getByTestId('detail.signed-in');
  const progress = page.getByTestId('panel.setup-progress');
  const steps = page.getByTestId('detail.setup-steps');

  // The second user, on a screen with two steps of its own. Held on the user's one step.
  let release = await hold(page, '/dev/session');
  await openRule(page, 'as-org');
  await expect(progress).toContainText('Setting up this screen: step 1 of 3');
  await expect(progress).toContainText('A step of signing in as View-only org manager.');
  await expect(progress).toContainText('Posting the sign-in form to /dev/session.');
  // While the user's steps run it has not happened yet, and the line says so.
  await expect(signedIn).toHaveText(/^\s*Signing in as View-only org manager, a Manager\.\s*$/);
  // One list: the user's steps under its name, then the screen's own, numbered straight through.
  await expect(steps.locator('li.group')).toHaveText([
    'View-only org manager signs in',
    "Then this screen's own steps",
  ]);
  const rows = steps.locator('li[data-step]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-whose', 'user');
  await expect(rows.nth(0)).toContainText('user_id 31');
  await expect(rows.nth(1)).toHaveAttribute('data-whose', 'screen');
  await expect(rows.nth(1)).toContainText('/expenses/7');
  await expect(steps).toContainText('Then open /expenses/11');

  // Held again on the screen's own first step: the sign-in has passed.
  const own = await hold(page, '/expenses/7');
  release();
  await expect(progress).toContainText('Setting up this screen: step 2 of 3');
  await expect(progress).toContainText(
    "One of this screen's own steps. View-only org manager is signed in.",
  );
  await expect(signedIn).toHaveText(/^\s*Signed in as View-only org manager, a Manager\.\s*$/);
  own();

  // The user's step, the screen's step, then the path: in that order, and as that user.
  const app = page.frameLocator(APP);
  await expect(app.getByTestId('expense.title')).toHaveText(/Expense 11 /);
  await expect(app.getByTestId('nav.user')).toHaveText('31');
  expect(await asked(page)).toEqual(['POST /dev/session', 'GET /expenses/7', 'GET /expenses/11']);
  await expect(signedIn).toContainText('Signed in as View-only org manager, a Manager.');

  // A persona alone is its first user.
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
  await openRule(page, 'as-manager');
  await expect(app.getByTestId('expense.title')).toHaveText(/Expense 8 /);
  await expect(app.getByTestId('nav.user')).toHaveText('14');
  await expect(signedIn).toContainText('Signed in as View-only team manager, a Manager.');
  expect(await asked(page)).toEqual([
    'GET /dev/impersonate?id=1',
    'POST /dev/session',
    'GET /expenses/8',
  ]);
  // No steps of the screen's own, so no second heading.
  await expect(steps.locator('li.group')).toHaveText(['View-only team manager signs in']);

  // A persona with no users: nothing signs in, and the detail says so.
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
  await openRule(page, 'as-visitor');
  await expect(signedIn).toContainText('Nobody signs in as Visitor.');
  await expect(signedIn).toContainText('No sign-in runs.');
  // Only the path is asked for: no step of anybody's ran first.
  await expect.poll(() => asked(page)).toEqual(['GET /expenses/9']);
  await expect(app.locator('h1')).toHaveText(/Expense 9 |Sign in/);

  // A user's step that fails stops the setup, and the App pane says whose it was.
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
  await openRule(page, 'as-locked-out');
  const failed = page.getByTestId('panel.setup-failed');
  await expect(failed).toContainText('Sign-in stopped at step 2 of 2');
  await expect(failed.locator('dl')).toContainText('WhoseSigning in as Locked-out manager');
  await expect(failed).toContainText('500 Internal Server Error');
  await expect(failed).toContainText(
    "This was a step of signing in as Locked-out manager, not one of this screen's own.",
  );
  await expect(failed).toContainText(
    '/expenses/501 was not loaded, so this is not the screen yet.',
  );
  await expect(signedIn).toContainText('Signs in as Locked-out manager, a Manager.');
  await expect(signedIn).toContainText('The sign-in did not finish.');
  expect(await asked(page)).toEqual(['GET /dev/impersonate?id=14', 'POST /dev/broken']);

  // `as:` above prose: the user's steps run, the prose is shown, and it is never run.
  await page.request.post(`${EXPENSES_ORIGIN}/__reset`);
  release = await hold(page, '/dev/session');
  await openRule(page, 'as-prose');
  await expect(progress).toContainText('Setting up this screen: step 1 of 1');
  await expect(progress).toContainText(
    "This screen's own setup is written as prose. It is shown in the rule, and it is not run.",
  );
  release();
  await expect(app.getByTestId('expense.title')).toHaveText(/Expense 10 /);
  await expect(page.getByTestId('detail.setup')).toContainText(
    "This screen's own setup, shown and not run",
  );
  await expect(page.getByTestId('detail.setup-prose')).toHaveText(
    'Filter the list to submitted expenses before opening this one.',
  );
  expect(await asked(page)).toEqual(['POST /dev/session', 'GET /expenses/10']);
});

test('a screen whose user could not be read runs no sign-in, and the detail says which blueprint to register', {
  tag: '@rule:screens.setup.unread-personas-run-no-sign-in',
}, async ({ page }) => {
  await start(page, 'travel');
  const release = await hold(page, '/dev/slow');
  await openRule(page, 'trip');
  const progress = page.getByTestId('panel.setup-progress');
  await expect(progress).toContainText('Setting up this screen: step 1 of 1');
  await expect(progress).toContainText("One of this screen's own steps.");
  await expect(progress).toContainText(
    'No sign-in ran. manager.view-only-team could not be read, because the blueprint acme-people is not registered on this machine. The rule says how to register it.',
  );
  release();

  // The screen's own step and its path still ran, and nothing signed in.
  const app = page.frameLocator(APP);
  await expect(app.getByTestId('app.sign-in')).toBeVisible();
  expect(await asked(page)).toEqual(['GET /dev/slow', 'GET /expenses/412']);

  // The user as written, that it could not be read, and the blueprint to register.
  const signedIn = page.getByTestId('detail.signed-in');
  await expect(signedIn).toContainText(
    'manager.view-only-team could not be read, so nobody is signed in.',
  );
  await expect(signedIn).toContainText(
    'Its personas are in the blueprint acme-people, which is not registered on this machine. Register it, then run the setup again.',
  );
  await expect(signedIn.locator('.cmd')).toHaveText(
    'walkdown blueprints import <home of acme-people>',
  );
  await expect(page.getByTestId('detail.setup-steps').locator('li.group')).toHaveText([
    "This screen's own steps",
  ]);
});
