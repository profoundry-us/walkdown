import { test, expect } from '@playwright/test';

// Checks for blueprint/features/waitlist.yml — one rule per test, tagged @rule:<id>,
// anchors only (getByTestId), never CSS paths. statement_hash of the rule each check
// was written against is noted for staleness detection.

test(
  'a visitor must provide a valid email before joining', // sha256:2fd5ce31a84c
  { tag: '@rule:waitlist.join.email-required' },
  async ({ page }) => {
    await page.goto('/index.html');

    // Blank email
    await page.getByTestId('waitlist.submit').click();
    await expect(page.getByTestId('waitlist.email-error')).toHaveText(/valid email/i);
    await expect(page).toHaveURL(/index\.html/);

    // Email without "@"
    await page.getByTestId('waitlist.email').fill('not-an-email');
    await page.getByTestId('waitlist.submit').click();
    await expect(page.getByTestId('waitlist.email-error')).toHaveText(/valid email/i);
    await expect(page).toHaveURL(/index\.html/);
  }
);

test(
  'an already-joined email sees the already-on-the-list state',
  { tag: '@rule:waitlist.join.already-joined' },
  async ({ page }) => {
    await page.goto('/index.html');
    await page.getByTestId('waitlist.email').fill('repeat@profoundry.us');
    await page.getByTestId('waitlist.submit').click();
    await expect(page).toHaveURL(/confirm\.html/);

    await page.goto('/index.html');
    await page.getByTestId('waitlist.email').fill('repeat@profoundry.us');
    await page.getByTestId('waitlist.submit').click();
    await expect(page.getByTestId('waitlist.already-message')).toHaveText(/already on the list/i);
    await expect(page.getByTestId('waitlist.confirmed-email')).toHaveText('repeat@profoundry.us');
  }
);

test(
  'the confirmation redirects to join when no email was submitted',
  { tag: '@rule:waitlist.join.confirm-requires-email' },
  async ({ page }) => {
    await page.goto('/confirm.html');
    await expect(page).toHaveURL(/index\.html/);
  }
);

test(
  'a valid email leads to a confirmation showing that email', // sha256:8f7e3fe03fdf
  { tag: '@rule:waitlist.join.confirmation' },
  async ({ page }) => {
    await page.goto('/index.html');
    await page.getByTestId('waitlist.email').fill('topher@profoundry.us');
    await page.getByTestId('waitlist.submit').click();

    await expect(page).toHaveURL(/confirm\.html/);
    await expect(page.getByTestId('waitlist.confirmed-email')).toHaveText('topher@profoundry.us');
  }
);
