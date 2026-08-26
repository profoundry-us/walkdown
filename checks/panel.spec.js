/*
 * Browser checks for the docked panel. These drive the real panel in a real
 * page — the surface the rules describe. Selection is by anchor
 * (getByTestId), never by CSS path, per blueprint/AGENTS.md.
 */
import { expect, test } from '@playwright/test';

// The host page the panel docks into — absolute, because baseURL names the
// system under test (walkdown itself), not the fixture that hosts it. Both
// come from the config so the two run modes address the same pair of servers.
import { FIXTURE, WD_ORIGIN } from '../playwright.config.js';

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
    await ensureSession(page);                              // a walkdown is running
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

/*
 * Make sure a sitting is running. The button toggles, and the panel restores an
 * unfinished sitting from the server on load — so a bare click can END one that
 * a previous check left open rather than starting a new one.
 */
async function ensureSession(page) {
  if ((await page.getByTestId('panel.actor').count()) === 0)
    await page.getByTestId('panel.walk').click();
  await expect(page.getByTestId('panel.actor')).toBeVisible();
}

/** End whatever sitting is running, so the next check starts from nothing. */
async function endSession(page) {
  if (await page.getByTestId('panel.actor').count()) {
    await page.getByTestId('panel.finish').click();
    await expect(page.getByTestId('panel.actor')).toBeHidden();
  }
}

/** Start a session and open the first rule in the list. */
async function session(page) {
  await docked(page);
  await ensureSession(page);
  await page.getByTestId('panel.rules-list').locator('button').first().click();
  await expect(page.getByTestId('detail.rule-id')).toBeVisible();
  return page.getByTestId('detail.rule-id').textContent();
}

/** What the ledger currently says about one rule's human tier. */
const humanState = (page, rule) =>
  page.evaluate(async ([origin, id]) => {
    const r = await fetch(`${origin}/api/blueprint`);
    const row = (await r.json()).rows.find((x) => x.rule === id);
    return row ? row.human.state : null;
  }, [WD_ORIGIN, rule]);

/** What the server currently holds as the unfinished sitting. */
const draft = (page) =>
  page.evaluate(async (origin) => {
    const r = await fetch(`${origin}/api/draft`);
    return r.ok ? r.json() : null;
  }, WD_ORIGIN);

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

    // Put the server back: an unfinished sitting is exactly what the next
    // check would otherwise inherit.
    await endSession(page);
  }
);

/** The ledger's own view, straight from the server. */
const payload = (page) =>
  page.evaluate(async (origin) => (await fetch(`${origin}/api/blueprint`)).json(), WD_ORIGIN);

/** Open one rule by id, from the list. */
async function openRule(page, rule) {
  // Scoped to the list: rule ids also appear on cross-references inside an
  // open rule, and those are off-screen in a slid-away pane.
  const row = page.getByTestId('panel.rules-list').locator(`[data-rule="${rule}"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.getByTestId('detail.rule-id')).toHaveText(rule);
  await expect(page.getByTestId('detail.statement')).toBeVisible();
}

/*
 * The verdict pair only exists while a sitting is running, and the pane
 * re-renders once the session is in hand — so callers that read the pair wait
 * for it rather than the render that arrives a tick earlier without it.
 */
async function openRuleForVerdict(page, rule) {
  await openRule(page, rule);
  await expect(page.getByTestId('detail.verdict').locator('button').first()).toBeVisible();
}

test(
  'which verdict pair a rule shows is derived from the ledger, not fixed chrome',
  { tag: '@rule:panel.signoff.spec-pair-derived' },
  async ({ page }) => {
    await docked(page);
    await endSession(page);
    const { rows } = await payload(page);
    const built = rows.find((r) => r.built && r.verify.includes('human'));
    const unbuilt = rows.find((r) => !r.built && r.verify.includes('human'));
    expect(built, 'the blueprint needs a built rule to compare').toBeTruthy();
    expect(unbuilt, 'and one with no build evidence').toBeTruthy();

    await ensureSession(page);

    // Evidence in the ledger: a build verdict.
    await openRuleForVerdict(page, built.rule);
    const withEvidence = (await page.getByTestId('detail.verdict').locator('button').allTextContents()).join(' ');
    expect(withEvidence).toMatch(/Pass/);
    expect(withEvidence).not.toMatch(/Approve/);

    // None: sign-off, and the panel says why it is offering that instead.
    await page.getByTestId('detail.back').click();
    await openRuleForVerdict(page, unbuilt.rule);
    const without = (await page.getByTestId('detail.verdict').locator('button').allTextContents()).join(' ');
    expect(without).toMatch(/Approve/);
    expect(without).toMatch(/Refine/);
    await expect(page.getByText(/No build evidence yet/)).toBeVisible();
  }
);

test(
  'finishing appends a verdict under a named person; discarding records nothing',
  { tag: '@rule:panel.walkdown.records-to-ledger' },
  async ({ page }) => {
    await docked(page);
    await endSession(page);
    const { rows } = await payload(page);
    const rule = rows.find((r) => r.built && r.verify.includes('human')).rule;
    const before = (await payload(page)).rows.find((r) => r.rule === rule).human.state;

    // Discarded: a sitting with nothing judged leaves the ledger as it was.
    await ensureSession(page);
    await page.getByTestId('panel.finish').click();
    await expect(page.getByTestId('panel.actor')).toBeHidden();
    expect((await payload(page)).rows.find((r) => r.rule === rule).human.state).toBe(before);

    // Finished: the verdict given in the panel is what the ledger gains.
    await ensureSession(page);
    await openRuleForVerdict(page, rule);
    await page.getByTestId('detail.verdict').locator('button').first().click();
    await expect(page.getByTestId('detail.judged')).toHaveText(/1 judged/);
    await page.getByTestId('panel.finish').click();
    await expect(page.getByTestId('panel.actor')).toBeHidden();

    await expect
      .poll(async () => (await payload(page)).rows.find((r) => r.rule === rule).human.state)
      .toBe('pass');
    // And attributed to the person who gave it, never to an agent.
    const cell = (await payload(page)).rows.find((r) => r.rule === rule).human;
    expect(cell.actor).toBeTruthy();
    expect(cell.actor).not.toBe('agent');
  }
);

const EXT_FIXTURE = (build) =>
  FIXTURE.replace('docked.html', 'extension.html') + `&build=${encodeURIComponent(build)}`;

test(
  'the panel says plainly when the copy it is running has gone stale',
  { tag: '@rule:panel.delivery.stale-copy-says-so' },
  async ({ page }) => {
    // The extension's vendored copy only updates when the extension is
    // reloaded, so the panel compares what it is running against what the
    // server ships. A build that does not match must say so.
    await page.goto(EXT_FIXTURE('a-build-that-is-not-current'));
    await expect(page.getByTestId('panel.bar')).toBeVisible();
    const notice = page.getByTestId('panel.stale');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/reload the extension/i);

    // And a copy that matches says nothing — a warning that is always on is
    // a warning nobody reads.
    const { panelHash } = await payload(page);
    expect(panelHash, 'the server must publish the build it ships').toBeTruthy();
    await page.goto(EXT_FIXTURE(panelHash));
    await expect(page.getByTestId('panel.bar')).toBeVisible();
    await expect(page.getByTestId('panel.stale')).toHaveCount(0);
  }
);

test(
  'the panel will not accept work without a named person, and asks for the reason',
  { tag: '@rule:panel.threads.claim-never-accept' },
  async ({ page }) => {
    await docked(page);
    await endSession(page);
    const { rows, threads } = await payload(page);
    const addressed = (threads ?? []).find((t) => t.status === 'addressed' && t.anchor?.rule);
    expect(addressed, 'the blueprint needs an addressed thread to accept').toBeTruthy();

    await openRule(page, addressed.anchor.rule);
    // Open the conversation: the thread is a screen of its own.
    await page.locator(`[data-open-thread="${addressed.id}"]`).first().click();
    const verify = page.getByTestId('thread.actions').filter({ hasText: /Verify/ }).first();
    await expect(verify).toBeVisible();

    // Clear the name, then try to accept: agents may claim work, only a person
    // accepts it, and the panel obeys that rather than trusting the server to.
    await page.getByTestId('panel.desk-tuner').click();
    await page.getByTestId('settings.actor').fill('');
    await page.getByTestId('panel.desk-tuner').click();
    await verify.click();
    await expect(page.getByTestId('thread.say')).toBeVisible();
    await expect(page.getByTestId('thread.say')).toContainText(/name/i);

    // The thread is untouched: nothing was accepted under nobody's name.
    const after = (await payload(page)).threads.find((t) => t.id === addressed.id);
    expect(after.status).toBe('addressed');
  }
);

test(
  'a trip that means a real page load is taken when walkdown survives it, offered when it does not',
  { tag: '@rule:panel.rules.takes-you-there' },
  async ({ page }) => {
    // The example blueprint's first screen lives on a host we do not run here.
    // Standing in for it keeps the check about the decision, not the server.
    await page.route('**/index.html', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<h1>The other project</h1>' }));

    const start = async (reinjects) => {
      const url = FIXTURE.replace('docked.html', 'extension.html') +
        `&build=stale&bp=&reinjects=${reinjects}`;
      // Land on the fixture's own origin first, then forget any remembered
      // choice THERE — the panel remembers per origin, and clearing it from
      // whatever page the last trip ended on clears the wrong one.
      await page.goto(url);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      // No blueprint declared and two on the server: the panel must ask.
      await expect(page.getByText(/Which blueprint/i)).toBeVisible();
      await page.getByText(/walkdown-example/i).first().click();
    };

    /*
     * Carried by the extension: its content script runs on the next page too,
     * so walkdown is waiting on the other side and simply goes.
     */
    await start('1');
    await page.waitForURL(/index\.html/, { timeout: 10000 });
    expect(page.url()).toContain('index.html');

    /*
     * Carried by a script tag: navigating would unload the very script drawing
     * the panel, so the trip is offered rather than taken.
     */
    await start('0');
    const link = page.locator('a.link', { hasText: /open/i }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /index\.html/);
    expect(page.url(), 'a script tag delivery must stay put').toContain('extension.html');
  }
);

test(
  'a screen you are already on is not navigated to again',
  { tag: '@rule:panel.rules.takes-you-there' },
  async ({ page }) => {
    const framed = `${WD_ORIGIN}/prototype/screens/review.html`;
    const url = FIXTURE.replace('docked.html', 'extension.html') +
      `&build=stale&frame=${encodeURIComponent(framed)}`;

    // Count real loads of the framed page. A reload IS a navigation, so this
    // is the only thing that tells "moved" apart from "re-fetched".
    let loads = 0;
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame() && f.url().includes('review.html')) loads++;
    });

    await page.goto(url);
    await expect(page.getByTestId('panel.bar')).toBeVisible();
    await expect.poll(() => loads).toBeGreaterThan(0);   // the first load
    const settled = loads;

    // Ask for the screen the frame is already showing. The panel should
    // recognise it is already there and do nothing: re-navigating throws away
    // scroll position and form state, and on a slow app you watch it rebuild
    // for nothing.
    await page.getByTestId('panel.tabs').getByText(/Screens/i).click();
    const row = page.locator('[data-screen="review"]').first();
    await expect(row).toBeVisible();
    await row.click();

    // Give a stray navigation time to appear before declaring there was none.
    await page.waitForTimeout(800);
    expect(loads, 'the frame reloaded for a screen it was already on').toBe(settled);
  }
);

test(
  'the frame says it is loading rather than showing the screen you just left',
  { tag: '@rule:panel.rules.takes-you-there' },
  async ({ page }) => {
    const framed = `${WD_ORIGIN}/prototype/screens/review.html`;
    const url = FIXTURE.replace('docked.html', 'extension.html') +
      `&build=stale&frame=${encodeURIComponent(framed)}`;
    await page.goto(url);
    await expect(page.getByTestId('panel.bar')).toBeVisible();

    // A screen that takes its time. Without a veil the PREVIOUS screen stays on
    // display, which reads as a walkdown that went somewhere wrong.
    let release;
    const held = new Promise((r) => { release = r; });
    // Matched by regex: the panel appends its own bp parameter, and a glob
    // ending at .html misses the URL that actually goes out.
    await page.route(/screens\/rule-detail\.html/, async (route) => {
      await held;
      await route.fulfill({ contentType: 'text/html', body: '<h1>Arrived</h1>' });
    });

    await page.getByTestId('panel.tabs').getByText(/Screens/i).click();
    await page.locator('[data-screen="rule-detail"]').first().click();

    const veil = page.getByTestId('panel.frame-loading');
    await expect(veil).toBeVisible();
    await expect(veil).toContainText(/loading/i);

    // And it gets out of the way the moment the page arrives.
    release();
    await expect(veil).toHaveCount(0);
  }
);

test(
  'put away, the badge still crosses between the design and what shipped',
  { tag: '@rule:panel.dock.toolbar' },
  async ({ page }) => {
    // A framed review of a screen that HAS a design on file — there has to be
    // something to cross to for the offer to mean anything.
    const framed = `${WD_ORIGIN}/prototype/screens/review.html`;
    await page.goto(FIXTURE.replace('docked.html', 'extension.html') +
      `&build=stale&frame=${encodeURIComponent(framed)}`);
    await expect(page.getByTestId('panel.bar')).toBeVisible();
    // Put walkdown away: only the tab is left.
    await page.getByTestId('panel.bar').getByTitle(/Put walkdown away/i).click();
    // The panel slides off rather than being removed, so the tab appearing is
    // what says it is away.
    await expect(page.getByText('WALKDOWN', { exact: true })).toBeVisible();

    // The swap is there, and it names where it will take you rather than where
    // you already are.
    const swap = page.getByTestId('panel.tab-swap');
    await expect(swap).toBeVisible();
    const first = (await swap.textContent()).trim();
    expect(['APP', 'PROTOTYPE']).toContain(first);

    await swap.click();
    await expect(swap).not.toHaveText(first);   // it crossed; the offer flipped

    // Crossing did not cost re-opening the panel.
    await expect(page.getByText('WALKDOWN', { exact: true })).toBeVisible();
  }
);
