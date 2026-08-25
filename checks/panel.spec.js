/*
 * Browser checks for the docked panel. These drive the real panel in a real
 * page — the surface the rules describe. Selection is by anchor
 * (getByTestId), never by CSS path, per blueprint/AGENTS.md.
 */
import { expect, test } from '@playwright/test';

// The host page the panel docks into. Absolute, because baseURL names the
// system under test — walkdown itself — not the fixture that hosts it.
const FIXTURE = 'http://localhost:4712/docked.html';

/** Open the fixture and wait for the panel to have drawn its chrome. */
async function docked(page) {
  await page.goto(FIXTURE);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  return page;
}

test(
  'the actor arrives filled in from the repository identity, and stays editable',
  { tag: '@rule:panel.identity.default-actor' },
  async ({ page }) => {
    await docked(page);
    await page.getByTestId('panel.walk').click();          // start a walkdown
    // The name is on screen without anyone typing it: nobody is attributed silently.
    const name = page.getByTestId('panel.actor-name');
    await expect(name).toBeVisible();
    await expect(name).not.toHaveText('set your name…');
    const shown = (await name.textContent()).trim();
    expect(shown.length).toBeGreaterThan(0);

    // And it is a button into Settings rather than a label — it stays editable.
    await name.click();
    await expect(page.getByTestId('settings.actor')).toBeVisible();
  }
);

/** Start a session and open the first rule in the list. */
async function session(page) {
  await docked(page);
  await page.getByTestId('panel.walk').click();
  await expect(page.getByTestId('panel.actor')).toBeVisible();
  await page.getByTestId('panel.rules-list').locator('button').first().click();
  await expect(page.getByTestId('detail.rule-id')).toBeVisible();
  return page.getByTestId('detail.rule-id').textContent();
}

/** What the server currently holds as the unfinished sitting. */
const draft = (page) =>
  page.evaluate(async () => {
    const r = await fetch('http://localhost:4700/api/draft');
    return r.ok ? r.json() : null;
  });

test(
  'a verdict is written to the project as it is given, and survives the browser',
  { tag: '@rule:panel.walkdown.draft-on-disk' },
  async ({ page }) => {
    const rule = await session(page);
    expect(await draft(page)).toMatchObject({ draft: null });

    await page.getByTestId('detail.verdict').locator('button').first().click();
    await expect(page.getByTestId('detail.judged')).toHaveText(/1 judged/);

    // On disk the moment it was given — not held in the tab until Finish.
    const d = await draft(page);
    expect(d.draft.draft).toBe(true);
    expect(d.draft.run_id ?? null).toBeNull();   // a draft is not a run
    expect(Object.keys(d.draft.verdicts)).toContain(rule.trim());

    // And it survives the browser: reload, and the sitting is still running.
    await page.reload();
    await expect(page.getByTestId('panel.actor')).toBeVisible();
    expect((await draft(page)).draft.verdicts[rule.trim()]).toBeTruthy();
  }
);

/*
 * panel.signoff.spec-pair-derived is deliberately NOT covered here yet. A first
 * attempt drove the rule stepper and hung; shipping a flaky check would put the
 * rule back to green on evidence nobody trusts, which is the exact failure this
 * whole suite exists to undo. It stays in the agent's cover queue.
 */
