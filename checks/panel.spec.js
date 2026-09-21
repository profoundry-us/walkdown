/*
 * Browser checks for the panel. These drive the real panel over a real framed
 * page — the surface the rules describe. Selection is by anchor
 * (getByTestId), never by CSS path, per blueprint/AGENTS.md.
 */
import { expect, test } from '@playwright/test';

// The host page the panel docks into — absolute, because baseURL names the
// system under test (walkdown itself), not the fixture that hosts it. Both
// come from the config so the two run modes address the same pair of servers.
import { DECLARED, FIXTURE, WD_ORIGIN } from '../playwright.config.js';

/*
 * Where a verdict is RECORDED and where a check NAVIGATES are two different
 * things (playwright.config.js says so at length), and the app surface is the
 * one place they had been collapsed into one. A screen's app URL is
 * `base_url + app.path` — walkdown's own blueprint declares 4700 for that, the
 * port a person keeps `walkdown serve` on to review with, and the port this
 * suite deliberately never binds. So a check that swapped to the app was
 * reaching a server this run never started: green on the machine that happened
 * to have one up, red on the machine that did not (n-0112).
 *
 * Rewriting the declared address in the disposable copy is NOT the fix: a
 * verdict is a claim about a place (lib/status.js), so relocating the copy's
 * target empties out every run record it inherited and the tier checks go dark.
 * The declared address stays declared. What changes is only that this run
 * resolves it to the server it brought up — an alias, applied in the browser,
 * so the navigation lands on this suite's own walkdown and nothing on 4700 is
 * ever contacted. A redirect rather than a proxy, so the frame ends up at the
 * address that really served it and can be asserted.
 */
const DECLARED_ORIGIN = new URL(DECLARED).origin;
async function declaredResolvesHere(page) {
  if (DECLARED_ORIGIN === WD_ORIGIN) return;
  await page.route(`${DECLARED_ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({
      status: 302,
      headers: { location: `${WD_ORIGIN}${u.pathname}${u.search}` },
    });
  });
}
test.beforeEach(async ({ page }) => {
  await declaredResolvesHere(page);
});

/**
 * The fixture URL with parameters overridden rather than appended — a second
 * `frame=` would be shadowed by the first, which is a silent way to test the
 * wrong page.
 */
function fixtureFor(params = {}) {
  const u = new URL(FIXTURE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.href;
}

/** Open the fixture and wait for the panel to have drawn its chrome. */
async function review(page) {
  await page.goto(FIXTURE);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  return page;
}

test('the actor arrives filled in from the repository identity, and stays editable', {
  tag: '@rule:panel.identity.default-actor',
}, async ({ page }) => {
  await review(page);
  await ensureSession(page); // a walkdown is running
  // The name is on screen without anyone typing it: nobody is attributed silently.
  const name = page.getByTestId('panel.actor-name');
  await expect(name).toBeVisible();
  await expect(name).not.toHaveText('set your name…');
  const shown = (await name.textContent()).trim();
  expect(shown.length).toBeGreaterThan(0);

  // And it is a button into Settings rather than a label — it stays editable.
  await name.click();
  await expect(page.getByTestId('settings.actor')).toBeVisible();
});

/*
 * Make sure a sitting is running. The button toggles, and the panel restores an
 * unfinished sitting from the server on load — so a bare click can END one that
 * a previous check left open rather than starting a new one.
 */
async function ensureSession(page) {
  if ((await page.getByTestId('panel.actor').count()) === 0) {
    await page.getByTestId('panel.walk').click();
    /*
     * Starting one asks who is signing before it begins
     * (panel.walkdown.who-signs-is-declared). This helper predates that
     * question, so every check that needed a sitting simply stopped at a
     * dialog nobody answered — six of them, all failing on a missing
     * `panel.actor` rather than on anything they were about.
     */
    const go = page.getByTestId('walkdown.signing.start');
    await expect(go).toBeVisible();
    // A machine whose config names no role has nothing ticked, and the
    // dialog is right to refuse: pick one, since a sitting is somebody
    // accepting something.
    if (await go.isDisabled()) await page.getByTestId('walkdown.signing.role').first().check();
    await go.click();
  }
  await expect(page.getByTestId('panel.actor')).toBeVisible();
}

/** End whatever sitting is running, so the next check starts from nothing. */
async function endSession(page) {
  if (await page.getByTestId('panel.actor').count()) {
    await page.getByTestId('panel.walk').click(); // the same control that started it
    await expect(page.getByTestId('panel.actor')).toBeHidden();
  }
}

/** Open the first rule in the list, whatever it happens to be. */
async function firstRule(page) {
  await page.getByTestId('panel.rules-list').locator('button').first().click();
  await expect(page.getByTestId('detail.rule-id')).toBeVisible();
  return page.getByTestId('detail.rule-id').textContent();
}

/** Start a session and open the first rule in the list. */
async function session(page) {
  await review(page);
  await ensureSession(page);
  return firstRule(page);
}

/** What the server currently holds as the unfinished sitting. */
const draft = (page) =>
  page.evaluate(async (origin) => {
    const r = await fetch(`${origin}/api/draft`);
    return r.ok ? r.json() : null;
  }, WD_ORIGIN);

test('the fail refusal names both ways to give a why, and dies with the rule it refused', {
  tag: '@rule:panel.walkdown.fail-requires-why',
}, async ({ page }) => {
  await session(page);
  // A built rule is one whose verdict pair offers Fail; walk until found.
  let idx = 0;
  while (!(await page.locator('[data-v="fail"]').count()) && idx < 6) {
    idx += 1;
    await page.getByTestId('detail.back').click();
    await page.getByTestId('panel.rules-list').locator('button').nth(idx).click();
    await expect(page.getByTestId('detail.rule-id')).toBeVisible();
  }
  const judged = await page.getByTestId('panel.judged').textContent();
  await page.locator('[data-v="fail"]').click();
  const say = page.getByTestId('detail.say');
  await expect(say).toBeVisible();
  await expect(say).toContainText('write it in the box');
  await expect(say).toContainText('Pin mode');
  await expect(page.getByTestId('panel.judged')).toHaveText(judged ?? '', {
    useInnerText: true,
  }); // refused means refused: nothing recorded
  /*
   * The refusal belongs to the moment it refused. It used to be written
   * straight into the DOM, so it stood on the next rule's pane - Fail
   * wording on a pane with no Fail button (found in passing by the agent
   * sitting of 2026-08-31, round three on note-with-any-verdict).
   */
  await page.getByTestId('detail.back').click();
  await page.getByTestId('panel.rules-list').locator('button').nth(idx === 0 ? 1 : 0).click();
  await expect(page.getByTestId('detail.rule-id')).toBeVisible();
  await expect(page.getByTestId('detail.say')).toHaveCount(0);
});

test('a verdict is written to the project as it is given, and survives the browser', {
  tag: '@rule:panel.walkdown.draft-on-disk',
}, async ({ page }) => {
  const rule = await session(page);
  expect(await draft(page)).toMatchObject({ draft: null });

  await acceptVerdict(page).click();
  await expect(page.getByTestId('panel.judged')).toHaveText(/^\+1\/\d+$/);

  // On disk the moment it was given — not held in the tab until Finish.
  const d = await draft(page);
  expect(d.draft.draft).toBe(true);
  expect(d.draft.run_id ?? null).toBeNull(); // a draft is not a run
  expect(Object.keys(d.draft.verdicts)).toContain(rule.trim());

  // And it survives the browser: reload, and the sitting is still running.
  await page.reload();
  await expect(page.getByTestId('panel.actor')).toBeVisible();
  expect((await draft(page)).draft.verdicts[rule.trim()]).toBeTruthy();

  // Put the server back: an unfinished sitting is exactly what the next
  // check would otherwise inherit.
  await endSession(page);
});

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
 * The accepting verdict - Pass on a built rule, Approve on an unbuilt one.
 * It is the LAST button of the row, not the first: the rule's composer puts
 * Waive alone at the far left and Reply before the verdict pair (ADR 0006
 * §4), so "the first button" stopped meaning the verdict.
 */
const acceptVerdict = (page) =>
  page.getByTestId('detail.verdict').locator('[data-v="pass"], [data-v="approved"]');

/*
 * The verdict pair only exists while a sitting is running, and the pane
 * re-renders once the session is in hand — so callers that read the pair wait
 * for it rather than the render that arrives a tick earlier without it.
 */
async function openRuleForVerdict(page, rule) {
  await openRule(page, rule);
  await expect(acceptVerdict(page)).toBeVisible();
}

test('which verdict pair a rule shows is derived from the ledger, not fixed chrome', {
  tag: '@rule:panel.signoff.spec-pair-derived',
}, async ({ page }) => {
  await review(page);
  await endSession(page);
  const { rows } = await payload(page);
  /*
   * Any built rule against any unbuilt one. This used to filter for
   * `verify.includes('human')`, which no longer selects anything: acceptance
   * left the verify list and became `signoff`, so the filter silently
   * matched nothing and the check died on an undefined row rather than on
   * anything it was written to catch. The pair it wants was never about the
   * tiers anyway - it is build evidence versus none.
   */
  const built = rows.find((r) => r.built);
  const unbuilt = rows.find((r) => !r.built);
  expect(built, 'the blueprint needs a built rule to compare').toBeTruthy();
  expect(unbuilt, 'and one with no build evidence').toBeTruthy();

  await ensureSession(page);

  // Evidence in the ledger: a build verdict.
  await openRuleForVerdict(page, built.rule);
  const withEvidence = (
    await page.getByTestId('detail.verdict').locator('button').allTextContents()
  ).join(' ');
  expect(withEvidence).toMatch(/Pass/);
  expect(withEvidence).not.toMatch(/Approve/);

  // None: sign-off, and the panel says why it is offering that instead.
  await page.getByTestId('detail.back').click();
  await openRuleForVerdict(page, unbuilt.rule);
  const without = (
    await page.getByTestId('detail.verdict').locator('button').allTextContents()
  ).join(' ');
  expect(without).toMatch(/Approve/);
  expect(without).toMatch(/Refine/);
  await expect(page.getByTestId('detail.turn')).toContainText(/No build yet/);
});

test('finishing appends a verdict under a named person; discarding records nothing', {
  tag: '@rule:panel.walkdown.records-to-ledger',
}, async ({ page }) => {
  await review(page);
  await endSession(page);
  const { rows } = await payload(page);
  // Any built rule: `verify.includes('human')` selects nothing now that
  // acceptance is `signoff` rather than a tier, and this check has never
  // needed more than a rule with something to judge.
  const rule = rows.find((r) => r.built).rule;
  const before = (await payload(page)).rows.find((r) => r.rule === rule).human.state;

  // Discarded: a sitting with nothing judged leaves the ledger as it was.
  await ensureSession(page);
  await page.getByTestId('panel.walk').click(); // the same control that started it
  await expect(page.getByTestId('panel.actor')).toBeHidden();
  expect((await payload(page)).rows.find((r) => r.rule === rule).human.state).toBe(before);

  // Finished: the verdict given in the panel is what the ledger gains.
  await ensureSession(page);
  await openRuleForVerdict(page, rule);
  await acceptVerdict(page).click();
  await expect(page.getByTestId('panel.judged')).toHaveText(/^\+1\/\d+$/);
  await page.getByTestId('panel.walk').click(); // the same control that started it
  await expect(page.getByTestId('panel.actor')).toBeHidden();

  await expect
    .poll(async () => (await payload(page)).rows.find((r) => r.rule === rule).human.state)
    .toBe('pass');
  // And attributed to the person who gave it, never to an agent.
  const cell = (await payload(page)).rows.find((r) => r.rule === rule).human;
  expect(cell.actor).toBeTruthy();
  expect(cell.actor).not.toBe('agent');
});

const EXT_FIXTURE = (build) => FIXTURE + `&build=${encodeURIComponent(build)}`;

test('the panel says plainly when the copy it is running has gone stale', {
  tag: '@rule:panel.delivery.stale-copy-says-so',
}, async ({ page }) => {
  // The extension's vendored copy only updates when the extension is
  // reloaded, so the panel compares what it is running against what the
  // server ships. A build that does not match must say so.
  await page.goto(EXT_FIXTURE('a-build-that-is-not-current'));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  const notice = page.getByTestId('panel.stale');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/reload the extension/i);
  // Said WHOLE, at a laptop's width: the badge is the one thing in the bar's
  // left cluster that never gives way. At 1280 it once read "reload the ex"
  // (n-0292).
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(notice).toBeVisible();
  const whole = await notice.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(whole, 'the stale badge is clipped at 1280').toBe(true);
  await expect(notice).toContainText(/^\s*Stale — reload the extension/);

  // And a copy that matches says nothing — a warning that is always on is
  // a warning nobody reads.
  const { panelHash } = await payload(page);
  expect(panelHash, 'the server must publish the build it ships').toBeTruthy();
  await page.goto(EXT_FIXTURE(panelHash));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect(page.getByTestId('panel.stale')).toHaveCount(0);
});

test('the panel will not accept work without a named person, and asks for the reason', {
  tag: '@rule:panel.threads.claim-never-accept',
}, async ({ page }) => {
  await review(page);
  await endSession(page);
  const { threads, rows } = await payload(page);
  // On nothing the walk can reach: a thread on a live rule is that rule's
  // conversation and ends with the rule's verdict, never with a Done of its
  // own (ADR 0006 §3) - so the one the panel offers Done on is a thread with
  // no rule, or on a retired rule.
  const listed = new Set((rows ?? []).map((r) => r.rule));
  const addressed = (threads ?? []).find(
    (t) => t.status === 'addressed' && t.kind !== 'question' && !listed.has(t.anchor?.rule),
  );
  expect(addressed, 'the blueprint needs an addressed thread the walk cannot reach').toBeTruthy();

  // From the Threads tab, which opens on what waits on a person.
  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  await page.locator(`[data-open-thread="${addressed.id}"]`).first().click({ position: { x: 8, y: 6 } });
  // Done, from a person's seat, records verified - the button says what
  // pressing it means, the record keeps its name.
  const verify = page.locator('[data-testid="thread.actions"][data-act="verified"]').first();
  await expect(verify).toBeVisible();

  /*
   * Make this a machine that has not been told who is sitting at it, then try
   * to accept. Agents may claim work, only a person accepts it, and the panel
   * obeys that rather than trusting the server to.
   *
   * Done by answering the identity question differently rather than by
   * emptying a box, because the box is gone: the username was a text field
   * whose value rode up on every write, and the server wrote records under
   * whatever arrived (n-0142). What the panel must now read is whether the
   * machine's config DECLARES a person - a git email and a login name are
   * still there to fall back on, and accepting under one of those is exactly
   * the click that went through in n-0143.
   */
  await page.route('**/api/blueprint*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.identity) body.identity = { ...body.identity, declared: false };
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  await page.locator(`[data-open-thread="${addressed.id}"]`).first().click({ position: { x: 8, y: 6 } });
  await verify.click();
  await expect(page.getByTestId('thread.say')).toBeVisible();
  await expect(page.getByTestId('thread.say')).toContainText(/name/i);

  // The thread is untouched: nothing was accepted under nobody's name.
  const after = (await payload(page)).threads.find((t) => t.id === addressed.id);
  expect(after.status).toBe('addressed');

  // And the refusal belongs to the moment it refused: leave the screen and
  // come back, and it is gone rather than standing over the next reading.
  await page.getByTestId('thread.close').click();
  await page.locator(`[data-open-thread="${addressed.id}"]`).first().click({ position: { x: 8, y: 6 } });
  await expect(page.getByTestId('thread.actions').first()).toBeVisible();
  await expect(page.getByTestId('thread.say')).toHaveCount(0);
});

test('choosing a blueprint about another page takes you there', {
  tag: '@rule:panel.rules.takes-you-there',
}, async ({ page }) => {
  // The example blueprint's first screen lives on a host we do not run here.
  // Standing in for it keeps the check about the decision, not the server.
  await page.route('**/index.html', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>The other project</h1>' }),
  );

  await page.goto(fixtureFor({ build: 'stale', bp: '' }));
  // No blueprint declared and nothing claiming this page: which project, then
  // which of its blueprints. Nothing is remembered, so this is the same two
  // questions every time (ADR 0001 §7, §9).
  await expect(page.getByTestId('project.modal')).toBeVisible();
  await page.getByTestId('project.list').locator('[data-project]').first().click();
  await page
    .getByTestId('start.options')
    .getByText(/walkdown-example/i)
    .first()
    .click();

  /*
   * walkdown owns the frame, so it simply goes. There is no longer a delivery
   * that has to offer the trip instead: that was the docked panel, which
   * navigating would have unloaded, and it went on 2026-08-26.
   */
  await expect
    .poll(() => page.frames().some((f) => f.url().includes('index.html')), { timeout: 10000 })
    .toBe(true);
});
test('a screen you are already on is not navigated to again', {
  tag: '@rule:panel.rules.takes-you-there',
}, async ({ page }) => {
  const framed = `${WD_ORIGIN}/prototype/screens/review.html`;
  const url = fixtureFor({ build: 'stale', frame: framed });

  // Count real loads of the framed page. A reload IS a navigation, so this
  // is the only thing that tells "moved" apart from "re-fetched".
  let loads = 0;
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame() && f.url().includes('review.html')) loads++;
  });

  await page.goto(url);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect.poll(() => loads).toBeGreaterThan(0); // the first load
  const settled = loads;

  // Ask for the screen the frame is already showing. The panel should
  // recognise it is already there and do nothing: re-navigating throws away
  // scroll position and form state, and on a slow app you watch it rebuild
  // for nothing.
  await page.getByTestId('panel.screen-picker').click();
  const row = page.locator('[data-screen="review"]').first();
  await expect(row).toBeVisible();
  await row.click();

  // Give a stray navigation time to appear before declaring there was none.
  await page.waitForTimeout(800);
  expect(loads, 'the frame reloaded for a screen it was already on').toBe(settled);
});

test('the frame says it is loading rather than showing the screen you just left', {
  tag: '@rule:panel.rules.takes-you-there',
}, async ({ page }) => {
  const framed = `${WD_ORIGIN}/prototype/screens/review.html`;
  const url = fixtureFor({ build: 'stale', frame: framed });
  await page.goto(url);
  await expect(page.getByTestId('panel.bar')).toBeVisible();

  // A screen that takes its time. Without a veil the PREVIOUS screen stays on
  // display, which reads as a walkdown that went somewhere wrong.
  //
  // The wait is manufactured here, because this suite owns both ends of it and
  // a held response is the shortest way to hold one open. To see the same
  // thing BY HAND against a page that is genuinely slow, open the example
  // project's `waitlist-export` screen — example/app/export.html holds its own
  // load event for about three seconds, so the veil can be watched arriving
  // and lifting rather than only asserted. example/README.md says how.
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  // Matched by regex: the panel appends its own bp parameter, and a glob
  // ending at .html misses the URL that actually goes out.
  await page.route(/screens\/rule-detail\.html/, async (route) => {
    await held;
    await route.fulfill({ contentType: 'text/html', body: '<h1>Arrived</h1>' });
  });

  await page.getByTestId('panel.screen-picker').click();
  await page.locator('[data-screen="rule-detail"]').first().click();

  const veil = page.getByTestId('panel.frame-loading');
  await expect(veil).toBeVisible();
  // Not just "something is happening" — WHICH screen is being fetched. A veil
  // that only said "Loading…" would leave the same doubt the previous screen
  // did: you would still not know walkdown had heard you ask for this one.
  await expect(veil).toContainText(/loading/i);
  await expect(veil).toContainText('Rule detail');

  // And it gets out of the way the moment the page arrives.
  release();
  await expect(veil).toHaveCount(0);
});

test('put away, the badge still crosses between the design and what shipped', {
  tag: '@rule:panel.dock.toolbar',
}, async ({ page }) => {
  // A framed review of a screen that HAS a design on file — there has to be
  // something to cross to for the offer to mean anything.
  const framed = `${WD_ORIGIN}/prototype/screens/review.html`;
  await page.goto(fixtureFor({ build: 'stale', frame: framed }));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  // Put walkdown away: only the tab is left.
  await page
    .getByTestId('panel.bar')
    .getByTitle(/Put walkdown away/i)
    .click();
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
  await expect(swap).not.toHaveText(first); // it crossed; the offer flipped

  /*
   * And it crossed to the app THIS run brought up. The app surface is
   * `appBase + screen.app.path`, and appBase is the served target's declared
   * base_url — so while the disposable copy still declared 4700, the swap
   * reached whatever `walkdown serve` a person had left running there, and
   * this check passed or failed on whether anyone had (n-0112). The declared
   * address now resolves to the server this run started, and asserting the
   * origin is what keeps that from drifting back unnoticed.
   */
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/as-built/`)), {
      message: 'the app surface is the walkdown this run started',
      timeout: 10000,
    })
    .toBe(true);
  for (const f of page.frames())
    if (f !== page.mainFrame() && /^https?:/.test(f.url()))
      expect(f.url().startsWith(WD_ORIGIN), `a surface off this run's server: ${f.url()}`).toBe(
        true,
      );

  // Crossing did not cost re-opening the panel.
  await expect(page.getByText('WALKDOWN', { exact: true })).toBeVisible();

  /*
   * And whichever surface you land on fills the window. Put away, the panel
   * occupies nothing — so a surface still inset by its width sits in a box
   * the size of the old stage with the other one showing along the edges,
   * which is what Topher saw (n-0072). Both surfaces, because the swap moves
   * between them and either can be the one in front.
   */
  for (const surface of [0, 1]) {
    if (surface) await swap.click();
    // The box eases over ~220ms, so this is what it settles at, not what it
    // was passing through. Every surface, not the front one: the swap moves
    // between them and the one behind is the one you cross back to.
    await expect
      .poll(
        async () => {
          const win = page.viewportSize();
          const boxes = await Promise.all(
            (await page.locator('iframe').all()).map((f) => f.boundingBox()),
          );
          return (
            boxes.length > 0 &&
            boxes.every(
              (b) =>
                b && b.x < 4 && b.y < 4 && b.width > win.width - 4 && b.height > win.height - 4,
            )
          );
        },
        { message: 'every surface fills the window the panel gave back' },
      )
      .toBe(true);
  }
});

test('waiving a rule\u2019s conversation needs a person and a reason, like waiving anywhere', {
  tag: '@rule:panel.threads.claim-never-accept',
}, async ({ page }) => {
  await review(page);
  await endSession(page);
  const { rows, threads } = await payload(page);
  // A listed rule carrying a live note: the conversation the composer's
  // Waive would close (ADR 0006 §4). Which rule depends on the day's
  // statuses, so it is found rather than named.
  const listed = new Set((rows ?? []).map((r) => r.rule));
  const rule = (threads ?? []).find(
    (t) => t.kind !== 'question' && ['open', 'addressed'].includes(t.status) && listed.has(t.anchor?.rule),
  )?.anchor.rule;
  expect(rule, 'need a listed rule with a live note').toBeTruthy();
  const live = () =>
    payload(page).then(({ threads: all }) =>
      all.filter((t) => t.anchor?.rule === rule && t.kind !== 'question' && ['open', 'addressed'].includes(t.status)).length,
    );
  const before = await live();

  await openRule(page, rule);
  const waive = page.getByTestId('detail.verdict').locator('[data-v="waived"]');
  await expect(waive).toBeVisible();

  /*
   * On a machine nobody has been named on it must refuse, exactly as
   * waiving from the thread's own screen does: an agent may claim work and
   * never accept it. Answered by intercepting the identity rather than by
   * emptying a field, because the username is not a field any more - the
   * server records under the config's identity whatever a request says
   * (n-0142), so what the panel reads is whether that config DECLARES a
   * person or is guessing from a login name.
   */
  let declared = false;
  await page.route('**/api/blueprint*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.identity) body.identity = { ...body.identity, declared };
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  await openRule(page, rule);
  await page.getByTestId('detail.feedback').fill('never mind this one');
  await waive.click();
  await expect(page.getByTestId('settings.panel')).toBeVisible();
  expect(await live()).toBe(before);

  // Named, but with nothing written: waiving is recorded with a reason.
  declared = true;
  await page.reload();
  await openRule(page, rule);
  await waive.click();
  await expect(page.getByTestId('detail.say')).toContainText(/reason/);
  expect(await live()).toBe(before);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a screen that is a state, not an address, says how to get there', {
  tag: '@rule:panel.rules.setup-says-how-to-arrive',
}, async ({ page }) => {
  /*
   * The example blueprint has the real case: waitlist-already is the
   * confirmation page told apart by a query, so it shares that page's
   * address and the walk lands one step short of the state.
   */
  await page.route('**/index.html', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>The other project</h1>' }),
  );
  await page.goto(FIXTURE + '&bp=&reinjects=0');
  await expect(page.getByTestId('project.modal')).toBeVisible();
  await page.getByTestId('project.list').locator('[data-project]').first().click();
  await page
    .getByTestId('start.options')
    .getByText(/walkdown-example/i)
    .first()
    .click();

  const openRule = async (name) => {
    // The panes slide; the list is off screen while a rule is open.
    const back = page.getByTestId('detail.back');
    // The pane is slid out of the way rather than removed, so waiting on the
    // slide (300ms, panel.js) is what makes the list clickable again.
    if (await back.count()) {
      await back.click();
      await page.waitForTimeout(400);
    }
    await page.getByTestId('panel.rules-list').locator('button', { hasText: name }).first().click();
    await expect(page.getByTestId('detail.rule-id')).toBeVisible();
  };

  await openRule('already-joined');
  const setup = page.getByTestId('detail.setup');
  await expect(setup).toBeVisible();
  await expect(setup).toContainText(/already on the list/i);

  // Above the steps, because arriving comes before doing.
  const order = await page
    .getByTestId('detail.steps')
    .evaluate(
      (steps, s) => steps.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING,
      await setup.elementHandle(),
    );
  expect(order, 'the setup must be read before the steps').toBeTruthy();

  // And it wears the storyboard's own word for the field. The panel used to
  // call it "To get here", which left a reviewer translating between the
  // blueprint and the tool reading it (n-0099).
  const label = await setup.evaluate((el) => el.parentElement.firstElementChild.textContent.trim());
  expect(label, 'the setup block is labelled Setup').toBe('Setup');

  // And nothing is said where there is nothing to say: an empty instruction
  // is worse than none.
  await openRule('email-required');
  await expect(page.getByTestId('detail.setup')).toHaveCount(0);
});

test('threads have a view of their own, ended ones included', {
  tag: '@rule:panel.threads.own-view',
}, async ({ page }) => {
  await review(page);

  /*
   * What the ledger says, before the panel says anything. The count on the
   * tab and the "Awaiting you" filter are both claims about the attention
   * queue, and a check that read them only from the panel could not tell a
   * right answer from a consistent wrong one.
   */
  const bp = await (await page.request.get(`${WD_ORIGIN}/api/blueprint`)).json();
  const owed = new Set(
    (bp.attention ?? []).filter((i) => i.who === 'human' && i.thread).map((i) => i.thread),
  );
  const TERMINAL = ['verified', 'incorporated', 'waived'];
  const ended = bp.threads.filter((t) => TERMINAL.includes(t.status));
  expect(ended.length, 'the fixture blueprint has no ended threads to go back to').toBeGreaterThan(
    0,
  );

  await page
    .getByTestId('panel.tabs')
    .getByText(/Threads/)
    .click();
  const list = page.getByTestId('panel.threads-list');
  await expect(list).toBeVisible();

  /*
   * The list opens on what waits on you - the same set the tab's badge
   * counts - so the number and the list under it never disagree.
   */
  const filter = page.getByTestId('panel.thread-filter');
  await expect(filter.locator('button').first()).toHaveText(/Awaiting you/);
  await expect(filter.locator('button').first()).toHaveClass(/btn-primary/);
  expect(
    new Set(await list.locator('[data-open-thread]').evaluateAll((els) => els.map((e) => e.dataset.openThread))),
  ).toEqual(owed);
  await filter.getByText('Active', { exact: false }).click();

  /*
   * Active is what is live — an ended conversation is not in it.
   *
   * Asked of the list's ENTRIES rather than of its text: a thread id is a
   * short string like `n-0130`, and threads quote each other's ids in their
   * bodies all the time, so a text search finds an ended thread that is only
   * being talked about and calls the panel broken for it.
   */
  const gone = ended[0].id;
  /*
   * Counted rather than searched for as text, and counted across every copy
   * of the list: a thread id is a short string like `n-0130`, threads quote
   * each other's ids in their bodies constantly, and a text search finds an
   * ended thread that is merely being TALKED about and calls the panel broken
   * for it. Presence is the question here, not how many nodes carry it - the
   * panel keeps a list per layout, so one listed thread is more than one
   * element by design.
   */
  const listed = (id) =>
    page.getByTestId('panel.list-scroll').locator(`[data-open-thread="${id}"]`).count();
  expect(await listed(gone)).toBe(0);

  // ...and All reaches it, which nothing else in the panel can do.
  await filter.getByText('All', { exact: false }).click();
  await expect.poll(() => listed(gone)).toBeGreaterThan(0);

  /*
   * Docked to the top: with every thread listed, scrolling to the far end
   * leaves the filter exactly where it was. This is the assertion that fails
   * if the filter is ever put back inside the scrolling wrapper - there it
   * is the first thing to ride up and out.
   */
  const filterAt = await filter.boundingBox();
  await list.locator('[data-open-thread]').last().scrollIntoViewIfNeeded();
  await expect(filter).toBeInViewport();
  expect(Math.round((await filter.boundingBox()).y)).toBe(Math.round(filterAt.y));

  // Awaiting you is the ledger's own queue, not a second definition of it.
  await filter.getByText(/Awaiting you/).click();
  const shownIds = await list
    .locator('[data-open-thread]')
    .evaluateAll((els) => els.map((e) => e.dataset.openThread));
  expect(new Set(shownIds)).toEqual(owed);

  // The same number rides on the tab, so it is legible from any tab.
  await expect(page.getByTestId('panel.tabs')).toContainText(String(owed.size));

  // A thread opens beside the list, and the way back is the list of threads —
  // not a rule nobody opened.
  const first = list.locator('[data-open-thread]').first();
  const openedId = await first.getAttribute('data-open-thread');
  /*
   * Pressed at its top-left corner, not at its centre. Thread bodies render
   * every thread id in them as a link to that thread, so a card whose body
   * mentions another one has a live link somewhere in the middle of it - and
   * a centre click lands on the link and opens the OTHER thread. That is the
   * link doing its job; the card is what this check is about.
   */
  await first.click({ position: { x: 8, y: 6 } });
  const pane = page.getByTestId('thread.panel');
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId('thread.provenance')).toContainText(openedId);
  const back = pane.getByTestId('thread.close');
  await expect(back).toContainText('All threads');
  await back.click();
  await expect(list).toBeVisible();
});

/*
 * Markdown, sanitised. The body below is what a hostile or careless author
 * might type: a list and a code span (should render), a web link (should be
 * a link), a javascript: link and an image with a handler (must not be),
 * a heading (not on the list), and a thread id both in prose and in code.
 */
test('a message is read as the markdown it was written in, and nothing else reaches the page', {
  tag: '@rule:threads.conversation.written-in-markdown',
}, async ({ page }) => {
  const body = [
    'Two things, and a `code span with n-0001 inside`:',
    '',
    '- first, see n-0001',
    '- second, [the docs](https://example.com/docs)',
    '',
    '# not a heading',
    '',
    '[nope](javascript:alert(1)) <img src=x onerror="alert(1)"> <script>alert(1)</script>',
    '',
    'plain line one',
    'plain line two',
  ].join('\n');
  const res = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: { kind: 'note', body, anchor: { rule: 'threads.conversation.written-in-markdown' } },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();

  await page.goto(fixtureFor({ bp: 'blueprint' }));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  // The list opens on what waits on a person; a thread on a rule lives under the rule and is listed here only under All (ADR 0006 §3).
  await page.getByTestId('panel.thread-filter').getByText('All', { exact: false }).click();
  await page.getByTestId('panel.threads-list').locator(`[data-open-thread="${id}"]`).first().click({ position: { x: 8, y: 6 } });
  const text = page.getByTestId('thread.body').locator('.wd-text').first();
  await expect(text).toBeVisible();

  // Structure, not the characters that asked for it.
  await expect(text.locator('ul > li')).toHaveCount(2);
  await expect(text.locator('code').first()).toHaveText('code span with n-0001 inside');
  await expect(text).not.toContainText('- first');
  await expect(text).not.toContainText('`code');
  // A heading is not on the list, so the marker stays as text - a reply is not a document.
  await expect(text.locator('h1, h2, h3')).toHaveCount(0);
  // The web link is a link that leaves the pane; the javascript: one is not a link at all.
  const docs = text.locator('a[href="https://example.com/docs"]');
  await expect(docs).toHaveText('the docs');
  await expect(docs).toHaveAttribute('target', '_blank');
  await expect(text.locator('a[href^="javascript"]')).toHaveCount(0);
  // Not a link at all: not an underlined <a> with no address either. The
  // sanitizer drops the href; the words it wrapped stay as words (n-0291).
  await expect(text.locator('a:not([href])')).toHaveCount(0);
  await expect(text).toContainText('nope');
  // Nothing runs, loads or styles.
  await expect(text.locator('img, script, style')).toHaveCount(0);
  expect(await text.innerHTML()).not.toMatch(/onerror/);
  // The id in prose is a link; the same id inside the code span is plain.
  await expect(text.locator('li [data-thread-ref="n-0001"]')).toHaveCount(1);
  await expect(text.locator('code [data-thread-ref]')).toHaveCount(0);
  // And the plain lines are still two lines.
  const plain = await text.locator('p').last().innerHTML();
  expect(plain).toMatch(/plain line one<br>\s*plain line two/);
});

test('the screen picker opens over the design, not underneath it', {
  tag: '@rule:panel.dock.toolbar',
}, async ({ page }) => {
  // A screen with a design on file, so there is a prototype to raise over
  // the page: the picker's list hangs in exactly the area the ghosted
  // surface covers, and a list painted under it reads as a button that does
  // nothing at all (n-0107).
  await page.goto(fixtureFor({ frame: `${WD_ORIGIN}/prototype/screens/review.html` }));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.locator('[data-surface="app"]').click();
  // The app this run started, by origin and not merely by path: the app
  // surface resolves against the served target's base_url, and matching on
  // the path alone was satisfied by a stranger's server on 4700 (n-0112).
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/as-built/review.html`)), {
      timeout: 10000,
    })
    .toBe(true);
  await page.waitForLoadState('networkidle');

  await page.getByTestId('panel.screen-picker').click();
  const list = page.getByTestId('panel.screens-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Detect from the page');

  /*
   * And it is on screen, not merely in the DOM: a list painted under the
   * ghosted surface is visible by every measure except the only one that
   * matters. So the pixels where the list lies are compared with the same
   * pixels once it is dismissed - if the design is covering it, opening and
   * closing the list look exactly alike.
   */
  const clip = await list.boundingBox();
  const shown = await page.screenshot({ clip });
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  const hidden = await page.screenshot({ clip });
  expect(Buffer.compare(shown, hidden), 'the list opened behind the design').not.toBe(0);
});

test('a screen picked by hand stays picked after the frame lands on it', {
  tag: '@rule:panel.dock.toolbar',
}, async ({ page }) => {
  await review(page);
  // Nothing picked yet: the bar says it is detecting, and the list agrees.
  const picker = page.getByTestId('panel.screen-picker');
  await expect(picker).toHaveAttribute('title', /detected from its address/i);

  await picker.click();
  const list = page.getByTestId('panel.screens-list');
  await expect(list).toBeVisible();
  await list.locator('[data-screen="rule-detail"]').click();

  // It takes you there — and arriving is not the same as leaving, so the
  // choice survives the landing rather than being reset by it (n-0098).
  await expect
    .poll(
      () => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/as-built/rule-detail.html`)),
      { timeout: 10000 },
    )
    .toBe(true);
  await expect(picker).toHaveAttribute('title', /picked by hand/i);

  // Reopened, the list marks the picked screen rather than Detect.
  await picker.click();
  await expect(list).toBeVisible();
  await expect(list.locator('[data-screen="rule-detail"]')).toContainText('◉');
  await expect(list.locator('[data-screen=""]')).toContainText('○');

  // And Detect is the way back: picking it hands the answer to the page again.
  await list.locator('[data-screen=""]').click();
  await expect(picker).toHaveAttribute('title', /detected from its address/i);
});

test('Escape leaves pin mode, after whatever is more local than pin mode', {
  tag: '@rule:panel.dock.chrome-not-a-pin-target',
}, async ({ page }) => {
  await review(page);
  const pin = page.getByTestId('panel.pin-mode');
  await pin.click();
  await expect(pin).toHaveClass(/btn-warning/);
  // The framed surface is armed too — one pin mode, and this is what it means
  // on the page being pinned.
  const framed = page.frameLocator('iframe[title="the application under review"]');
  await expect(framed.locator('html')).toHaveClass(/wd-pinning/);

  /*
   * Escape does the most local thing first. With the screen picker open it
   * closes the picker and leaves pin mode alone: a key that closed both would
   * make the picker's own dismissal cost the mode you were working in.
   */
  await page.getByTestId('panel.screen-picker').click();
  await expect(page.getByTestId('panel.screens-list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel.screens-list')).toBeHidden();
  await expect(pin).toHaveClass(/btn-warning/);

  // With nothing more local open, the same key ends pin mode — the panel owns
  // the flag now, so it has to answer for Escape typed at its own chrome.
  await page.keyboard.press('Escape');
  await expect(pin).not.toHaveClass(/btn-warning/);
  await expect(framed.locator('html')).not.toHaveClass(/wd-pinning/);
});

/*
 * walkdown's own blueprint, and one of its rules open in the detail pane.
 *
 * The fixture defaults to the example project, which is the right default for
 * rules about reviewing somebody else's app - but these three are about the
 * panel itself, so they are read against walkdown's own storyboard. `frame`
 * puts a chosen surface under the panel; without it the fixture's own does.
 */
async function ownRule(page, name, frame = null) {
  await page.goto(fixtureFor({ bp: 'blueprint', ...(frame ? { frame } : {}) }));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  // The framed surface announces itself when it lands, and the panel repaints
  // on hearing it - so a pane opened before then is one that will be rebuilt
  // out from under whatever was clicked on it.
  await page.waitForLoadState('networkidle');
  await page.getByTestId('panel.rules-list').locator('button', { hasText: name }).first().click();
  await expect(page.getByTestId('detail.rule-id')).toBeVisible();
  return page;
}

test("the evidence names every tier, and a run's files hang under the run that took them", {
  tag: '@rule:panel.rules.evidence-visible',
}, async ({ page }) => {
  await ownRule(page, 'evidence-visible');
  const ev = page.getByTestId('detail.evidence');
  /*
   * One line per evidence tier the rule asks for — the chain of trust, in
   * full. There are two of them now: `human` was never evidence, it was
   * acceptance, and it has moved out of this pane and into its own, one line
   * per role that has to sign. So this check no longer looks for it here;
   * the roles are `status.acceptance.*`'s business, and what belongs in
   * EVIDENCE is the tiers that produce a verdict.
   */
  await expect(ev).toContainText('checks/local');
  await expect(ev).toContainText('agent');
  await expect(ev, 'acceptance is not an evidence tier any more').not.toContainText('human');

  /*
   * The attached files belong TO the agent's run, so they read as a line
   * under it rather than as a tier of their own standing beside it (n-0100).
   * The link is found by its anchor; only the question "what is the row above
   * this one" needs the DOM.
   */
  const shots = page.getByTestId('detail.evidence-open');
  await expect(shots).toBeVisible();
  const above = await shots.evaluate((el) =>
    (el.closest('.evrow')?.previousElementSibling?.textContent ?? '').trim(),
  );
  expect(above, 'the attached files hang under the agent row').toMatch(/^agent/);

  // And they open to be looked at: a count of files nobody can see is not
  // evidence, so the check insists the picture actually loaded.
  await shots.click();
  const modal = page.getByTestId('detail.evidence-modal');
  await expect(modal).toBeVisible();
  await expect
    .poll(
      () =>
        modal
          .locator('img')
          .first()
          .evaluate((img) => img.naturalWidth),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);

  // Escape puts it away — the most local thing open is the first to close.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('evidence that is not a picture is readable rather than a broken image', {
  tag: '@rule:panel.rules.evidence-visible',
}, async ({ page }) => {
  /*
   * n-0241: every attached path was built into an <img>, so a run that
   * attached a transcript handed the reader a broken picture with a caption
   * under it. The file was there all along - the evidence route serves
   * whatever is under the evidence key space - and only the rendering was
   * wrong. It is not a rare case either: the agent tier attaches transcripts
   * as a matter of course, and `latest-wins` has nothing else.
   */
  await ownRule(page, 'latest-wins');
  await page.getByTestId('detail.evidence-open').click();
  const modal = page.getByTestId('detail.evidence-modal');
  await expect(modal).toBeVisible();

  // The transcript, as text somebody can read - and its own caption, so the
  // reader still knows which file they are looking at.
  const text = modal.locator('.wdp-evidence-text').first();
  await expect(text).toBeVisible();
  await expect(text).not.toHaveText('Loading…', { timeout: 15000 });
  expect((await text.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
  await expect(modal).toContainText('.txt');

  // And nothing tried to be a picture that was never one.
  await expect(modal.locator('img'), 'a transcript is not an image').toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('the steps are read outright and the check source waits behind a disclosure', {
  tag: '@rule:panel.rules.steps-not-an-appendix',
}, async ({ page }) => {
  await ownRule(page, 'steps-not-an-appendix');
  // The steps are the rule: nothing is clicked to read them.
  await expect(page.getByTestId('detail.steps')).toBeVisible();
  /*
   * Given and when are prose; then is the list. The then clauses are the long
   * part, so the list sits BELOW its label with the pane's whole width, not
   * beside it in the label's narrow neighbour column (n-0286).
   */
  const steps = page.getByTestId('detail.steps');
  await expect(steps.getByTestId('detail.given').locator('li')).toHaveCount(0);
  await expect(steps.getByTestId('detail.when').locator('li')).toHaveCount(0);
  const then = steps.getByTestId('detail.then');
  expect(await then.locator('li').count()).toBeGreaterThan(1);
  const [labelBox, listBox] = await Promise.all([
    then.locator('xpath=preceding-sibling::*[1]').boundingBox(),
    then.boundingBox(),
  ]);
  expect(listBox.y, 'the then list starts below its label').toBeGreaterThanOrEqual(labelBox.y + labelBox.height - 1);
  const stepsBox = await steps.boundingBox();
  expect(listBox.width, 'and takes the width the steps have').toBeGreaterThan(stepsBox.width * 0.8);

  /*
   * The rule's words go through the thread body's renderer, so an anchor
   * written in backticks is a code span here exactly as it is in a
   * conversation - same element, same colour - rather than two lookalike
   * treatments that drift (Topher, 2026-09-13). This rule names
   * `detail.steps` in its own steps, so its own detail is the fixture.
   */
  const anchor = steps.locator('code[data-anchor="detail.steps"]');
  await expect(anchor, 'a declared anchor is a code span that knows what it points at').toHaveCount(1);
  await expect(steps.getByTestId('detail.when')).not.toContainText('`');
  const colour = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
  const stepCode = await colour(anchor);
  const stmt = page.getByTestId('detail.statement');
  await expect(stmt.locator('p'), 'a one-paragraph statement is not boxed in a paragraph of its own').toHaveCount(0);
  const body = await page.evaluate(() => {
    const root = [...document.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot;
    const probe = document.createElement('div');
    probe.className = 'wd-text';
    probe.innerHTML = '<code>x</code>';
    root.querySelector('[data-testid="detail.steps"]').append(probe);
    const c = getComputedStyle(probe.firstChild).color;
    probe.remove();
    return c;
  });
  expect(stepCode, 'the anchor is coloured as a thread body colours code').toBe(body);

  const src = page.getByTestId('detail.technical-disclosure');
  await expect(src).toBeVisible();
  await expect(src).toContainText('Check source');
  /*
   * And it stands on its own rather than inside the Steps block. It used to
   * be nested there, so a rule with no steps had no disclosure at all - and
   * the stepless rules were exactly the ones whose check IS the
   * specification, judged by reading a test rather than by looking at a
   * screen (n-0245). The disclosure hangs off the rule's check refs.
   */
  await expect(
    src.locator('xpath=ancestor::*[@data-testid="detail.steps"]'),
    'the check source is not nested inside the steps',
  ).toHaveCount(0);
  await expect(src, 'the source is a technical detail, closed until asked for').not.toHaveAttribute(
    'open',
    /.*/,
  );
  // Closed, it is a summary line and nothing else: the source is not merely
  // scrolled past, it has not been fetched.
  await expect(src).not.toContainText('await ownRule(page,');

  // Opened, it is the source itself — this very check, fetched from the
  // server by the ref the suite carries for this rule.
  await src.locator('summary').click();
  // Generous: opening it is a round trip to the server, which re-derives the
  // whole ledger to answer.
  await expect(src).toContainText('await ownRule(page,', { timeout: 15000 });
});

test('hovering an anchor a step names points at it on the surface', {
  tag: '@rule:panel.rules.steps-not-an-appendix',
}, async ({ page }) => {
  // Framed on the design of the screen the rule is about, so the anchor its
  // steps name is really there on the surface underneath.
  await ownRule(page, 'steps-not-an-appendix', `${WD_ORIGIN}/prototype/screens/rule-detail.html`);
  const surface = page
    .frameLocator('iframe[title="the application under review"]')
    .getByTestId('detail.steps');
  await expect(surface).toBeVisible();
  await expect(surface).not.toHaveClass(/wd-hover/);

  // The same token the lint scanner keys off, in the panel's own steps.
  const token = page.getByTestId('detail.steps').getByText('detail.steps', { exact: true });
  await token.hover();
  await expect(surface, 'the element the step names lights up').toHaveClass(/wd-hover/);

  // And it lets go. A highlight that never clears leaves the page pointing
  // at the last thing anyone read.
  await page.getByTestId('detail.statement').hover();
  await expect(surface).not.toHaveClass(/wd-hover/);
});

/*
 * The claim, then the reason, then what happened - apart, and in that order
 * of weight. A statement that argued for itself was the norm until n-0286.
 */
test('a rule leads with its claim and sets the reason and history beneath it', {
  tag: '@rule:panel.rules.claim-then-reason',
}, async ({ page }) => {
  await ownRule(page, 'claim-then-reason');
  const statement = page.getByTestId('detail.statement');
  const because = page.getByTestId('detail.because');
  await expect(because).toBeVisible();
  await expect(because).toContainText(/argues for itself/);
  await expect(because).toContainText(/because/i);
  const [sBox, bBox] = await Promise.all([statement.boundingBox(), because.boundingBox()]);
  expect(bBox.y).toBeGreaterThan(sBox.y);
  const size = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size(because)).toBeLessThan(await size(statement));
  // No history on this rule, so no history label either.
  await expect(page.getByTestId('detail.history')).toHaveCount(0);

  // And one that carries both: history under because, lighter again.
  await ownRule(page, 'nothing-in-the-tree');
  const history = page.getByTestId('detail.history');
  await expect(history).toBeVisible();
  await expect(history).toContainText(/history/i);
  const [b2, h2] = await Promise.all([page.getByTestId('detail.because').boundingBox(), history.boundingBox()]);
  expect(h2.y).toBeGreaterThan(b2.y);
  const opacity = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  expect(await opacity(history)).toBeLessThan(await opacity(page.getByTestId('detail.because')));
});

test('the rule list is filtered from a box that stays above it', {
  tag: '@rule:panel.rules.search-the-list',
}, async ({ page }) => {
  await review(page);
  // What the ledger holds, before the panel says anything — a filter is a
  // claim about which rules there are, and it needs a second opinion.
  const bp = await (await page.request.get(`${WD_ORIGIN}/api/blueprint`)).json();
  const storyOf = new Map(bp.rows.map((r) => [r.rule, r.story]));

  const list = page.getByTestId('panel.rules-list');
  const rows = list.locator('[data-rule]');
  await expect(rows).toHaveCount(bp.rows.length);

  const box = page.getByTestId('panel.rules-search');
  await expect(box).toBeVisible();

  /*
   * Stuck to the top: scrolling the list to its far end leaves the box
   * exactly where it was. This is the assertion that fails if the box is
   * ever moved back inside the scrolling wrapper — there it rides up and
   * out with everything else.
   */
  const before = await box.boundingBox();
  await rows.last().scrollIntoViewIfNeeded();
  await expect(box).toBeInViewport();
  expect(Math.round((await box.boundingBox()).y)).toBe(Math.round(before.y));

  /*
   * A query naming a group keeps that group whole. Typed a letter at a time,
   * and the list is expected to have settled inside a second — the filter
   * runs in the browser on each keystroke, so there is nothing to wait for.
   */
  const group = 'panel.rules';
  const inGroup = bp.rows.filter((r) => r.story === group);
  expect(inGroup.length, 'the blueprint has a group to filter to').toBeGreaterThan(1);
  await box.pressSequentially(group, { delay: 20 });
  await expect(rows).toHaveCount(inGroup.length, { timeout: 1000 });
  const shown = await rows.evaluateAll((els) => els.map((e) => e.dataset.rule));
  expect(new Set(shown), 'every rule in the group survives, and only those').toEqual(
    new Set(inGroup.map((r) => r.rule)),
  );

  /*
   * A query naming one rule hides the rest — but not the headings it lives
   * under, or a filtered list would stop saying where anything belongs.
   * There are two of them now: the screen the rule is judged on, and the
   * story within it. The story heading carries only its last segment, since
   * the screen above already says the rest.
   */
  const one = inGroup[0].rule;
  const leaf = one.slice(group.length + 1);
  await box.fill(leaf);
  await expect(rows).toHaveCount(1, { timeout: 1000 });
  await expect(rows.first()).toHaveAttribute('data-rule', one);

  const screenIdOf = (r) => r.flow?.at(-1) ?? r.screens?.[0] ?? null;
  const sid = screenIdOf(inGroup[0]);
  const sc = (bp.storyboard ?? []).find((x) => x.id === sid);
  const heads = list.getByTestId('panel.rules-screen');
  await expect(heads, 'one screen heading, for the one rule left').toHaveCount(1);
  await expect(heads.first(), 'and it names the screen the rule is judged on').toContainText(
    sc ? (sc.title ?? sc.id) : 'No screen',
  );
  await expect(
    list.locator('[data-story]'),
    'the story heading keeps only what the screen does not already say',
  ).toHaveText(storyOf.get(one).split('.').at(-1));

  /*
   * And the screen is searchable as well as visible. A heading a reader can
   * see but not type is a heading that only half exists — and "every rule
   * judged on this screen" is the question the grouping invites.
   */
  if (sc) {
    const onScreen = bp.rows.filter((r) => screenIdOf(r) === sid);
    await box.fill(sc.title ?? sc.id);
    await expect(rows).toHaveCount(onScreen.length, { timeout: 1000 });
  }

  // A query matching nothing says so rather than showing an empty pane.
  await box.fill('zzz-no-such-rule');
  await expect(rows).toHaveCount(0, { timeout: 1000 });
  await expect(list.getByTestId('panel.rules-empty')).toBeVisible();

  // And emptying the box gives the whole list back.
  await box.fill('');
  await expect(rows).toHaveCount(bp.rows.length, { timeout: 1000 });
});

test('a built rule wears one mark per tier, and one dot per role that must sign', {
  tag: '@rule:panel.rules.tiers-at-a-glance',
}, async ({ page }) => {
  await review(page);
  const bp = await (await page.request.get(`${WD_ORIGIN}/api/blueprint`)).json();
  const list = page.getByTestId('panel.rules-list');

  /*
   * The ledger's own answer for each tier, worked out here rather than read
   * off the panel - a row of marks is a claim about the ledger, and a check
   * that read it only from the panel could not tell a right answer from a
   * consistent wrong one. The checks tier is per target, so it comes down to
   * one state worst-news-first, the way the verdict itself aggregates.
   */
  const checksTier = (row) => {
    const states = (bp.targets ?? Object.keys(row.cells ?? {}))
      .map((t) => row.cells?.[t]?.state)
      .filter((state) => state && state !== 'na');
    if (!states.length) return 'na';
    for (const worse of ['fail', 'blocked', 'never', 'stale', 'skipped'])
      if (states.includes(worse)) return worse;
    return states.every((state) => state === 'pass') ? 'pass' : 'never';
  };
  /*
   * TWO tiers, not three. `human` was never an evidence tier - it was
   * acceptance wearing a tier's clothes, and counting a person's signature
   * once as a tier and again as a role made a one-person team's rule need
   * two different things that were the same thing. So the strip now carries
   * the evidence tiers, and the signatures ride beside it as one dot per
   * role the rule names.
   */
  const tiersOf = (row) => [
    ['checks', checksTier(row)],
    ['agent', row.agent.state],
  ];

  const built = bp.rows.filter((r) => r.built);
  expect(built.length, 'the blueprint has built rules to read').toBeGreaterThan(0);

  /*
   * Sample by the SHAPES the ledger currently offers rather than by naming
   * ones it must hold. The rule is about how a row is drawn for whatever
   * states it has, and demanding a fully-verified rule exist made this check
   * depend on the ledger's mood: declaring a sweep empties the agent tier on
   * every rule at once - legitimately, that is what a sweep is for.
   *
   * Every distinct shape present is checked, and at least two must be,
   * because one shape proves nothing about a mark that varies.
   */
  const byShape = new Map();
  for (const r of built) {
    const shape =
      tiersOf(r)
        .map(([, st]) => st)
        .join('/') +
      '|' +
      (r.acceptance ?? []).map((a) => a.state).join('/');
    if (!byShape.has(shape)) byShape.set(shape, r);
  }
  const sample = [...byShape.values()].slice(0, 6);
  expect(byShape.size, 'the blueprint offers more than one shape of row').toBeGreaterThan(1);
  /*
   * And no demand that an OWED tier be among them. This check once insisted
   * some built rule show fail/never/stale - written when there always was
   * one, to be sure the vary-state mark got exercised. On 2026-09-01 the
   * board went fully green for the first time and the demand turned the
   * check into its own counterexample: it failed for want of a failure, and
   * its own fail then supplied the owed tier for the next run. A check that
   * can only pass while something else fails measures the ledger's mood,
   * not the rule.
   */

  for (const row of sample) {
    const strip = list.locator(`[data-rule="${row.rule}"]`).getByTestId('panel.rule-tiers');
    await expect(strip, `${row.rule} shows its tiers`).toHaveCount(1);
    /*
     * Asserted through the strip's own data attribute rather than by
     * counting spans. The strip gained a tooltip and a signoff stack, both
     * made of spans, so a span count stopped meaning "one mark per tier" -
     * and a check whose failure message is a number nobody can interpret is
     * worse than no check. The attribute is the panel stating, in order,
     * what it believes each tier's state to be, which is the claim the rule
     * makes.
     */
    await expect(strip).toHaveAttribute(
      'data-tiers',
      tiersOf(row)
        .map((t) => t.join(':'))
        .join(' '),
    );

    /*
     * And the signatures beside them: one slot per role the rule names, in
     * the order it names them, so "product has not signed" is a different
     * thing to read from "one of two". A rule that named nobody would draw
     * no stack - but signoffList puts engineering on every rule, so there is
     * always at least one.
     */
    const acceptance = row.acceptance ?? [];
    expect(acceptance.length, `${row.rule} names at least one signer`).toBeGreaterThan(0);
    /*
     * Compared as a set rather than in order: the stack deliberately hangs
     * product at the top and eng at the bottom, which is a layout decision
     * of the panel's and not the order the ledger derives them in. What this
     * check owns is that every role the rule names is drawn and each carries
     * the ledger's own answer for it - re-asserting the panel's chosen
     * order here would only restate the panel to itself.
     */
    const signoff = list.locator(`[data-rule="${row.rule}"]`).getByTestId('panel.rule-signoff');
    const drawn = ((await signoff.getAttribute('data-signoff')) ?? '').split(' ').sort();
    expect(drawn, `${row.rule} draws a slot per role, each with the ledger's answer`).toEqual(
      acceptance.map((a) => `${a.role}:${a.state}`).sort(),
    );
  }

  /*
   * And an UNBUILT rule wears the same strip. It used to wear a lifecycle
   * glyph of its own instead, which is what this check asserted - one lone
   * mark where every neighbouring row had three. That was the defect, not
   * the design: the column stopped being a column exactly on the rows that
   * most needed scanning past. So the claim inverts. Both evidence tiers
   * read `unbuilt` (nothing to judge until there is a build), and the
   * signature slots are drawn as they are anywhere else, because a rule can
   * be approved before it is built and that is worth seeing.
   */
  const unbuilt = bp.rows.find((r) => !r.built);
  expect(unbuilt, 'the blueprint has an unbuilt rule to read').toBeTruthy();
  const unbuiltStrip = list
    .locator(`[data-rule="${unbuilt.rule}"]`)
    .getByTestId('panel.rule-tiers');
  await expect(unbuiltStrip, 'an unbuilt rule wears the strip too').toHaveCount(1);
  /*
   * Derived, not spelled out. `unbuilt` stands in only for a tier that has
   * NEVER run - an unbuilt rule can still carry an agent run that came back
   * blocked, and that run is usually the reason the rule is not built. An
   * expectation of "both tiers read unbuilt" passed only while the first
   * unbuilt rule in the ledger happened to have nothing recorded, and would
   * have demanded the panel throw that news away.
   */
  const expected = tiersOf(unbuilt)
    .map(([kind, st]) => `${kind}:${st === 'never' ? 'unbuilt' : st}`)
    .join(' ');
  await expect(unbuiltStrip).toHaveAttribute('data-tiers', expected);
  const unbuiltSigns = list
    .locator(`[data-rule="${unbuilt.rule}"]`)
    .getByTestId('panel.rule-signoff');
  expect(((await unbuiltSigns.getAttribute('data-signoff')) ?? '').split(' ').sort()).toEqual(
    (unbuilt.acceptance ?? []).map((a) => `${a.role}:${a.state}`).sort(),
  );
});

/* ---- appended for n-0107 (screen picker in Detect mode) ------------------ */

test('in Detect mode the picker reports the page, in the bar and in the open list', {
  tag: '@rule:panel.dock.toolbar',
}, async ({ page }) => {
  await review(page);
  const picker = page.getByTestId('panel.screen-picker');
  const list = page.getByTestId('panel.screens-list');

  // Nothing picked by hand: the control is reporting, not remembering.
  await expect(picker).toHaveAttribute('title', /detected from its address/i);
  await expect(picker).toContainText('The review page');
  await picker.click();
  await expect(list).toBeVisible();
  const detect = list.locator('[data-screen=""]');
  await expect(detect).toContainText('◉');
  await expect(detect).toContainText('review');

  /*
   * Now the page moves under the open list — the application navigating
   * itself, which is the one way the answer changes without anyone touching
   * the panel. Detect means the picker is reporting which screen this page
   * IS, so both halves of the control have to follow it: the label in the bar
   * and the row the list marks. Before n-0107 only the bar was repainted, and
   * the list went on naming the screen we had left.
   */
  // Matched on the whole origin, not just the path: a path-only match is
  // satisfied by any stranger's server that happens to be listening on the
  // declared address, which is the ambient dependency n-0112 removed.
  const app = page.frames().find((f) => f.url().startsWith(`${WD_ORIGIN}/as-built/review.html`));
  await app.evaluate(() => {
    location.href = '/as-built/settings.html';
  });
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/as-built/settings.html`)), {
      timeout: 10000,
    })
    .toBe(true);

  await expect(picker).toContainText('Settings');
  await expect(list).toBeVisible();
  await expect(detect).toContainText('◉');
  await expect(detect).toContainText('settings');
  await expect(detect).not.toContainText('review');
});

/* ==========================================================================
 * APPENDED BLOCK — added for thread n-0104 (identity vs display name).
 * Kept together at the end of the file so it is easy to move or reconcile
 * with concurrent edits elsewhere in this spec.
 * ========================================================================== */

test('the identity is a username to record under and a full name to show, both editable', {
  tag: '@rule:panel.identity.default-actor',
}, async ({ page }) => {
  await review(page);
  await ensureSession(page);

  /*
   * This repo's git knows both facts, so the strip carries both: the name a
   * person reads, and - beside it - the username the verdicts will actually
   * be filed under. The handle is on screen and not only in Settings because
   * panel.identity.attribution-visible says the name being RECORDED has to be
   * visible at the moment of the action, and showing only a full name while
   * writing down a handle would quietly stop being true.
   */
  const shown = page.getByTestId('panel.actor-name');
  const handle = page.getByTestId('panel.actor-handle');
  await expect(shown).toBeVisible();
  // The strip carries the name you go by and nothing beside it (n-0309);
  // the username is a hover away on it, and read in Settings.
  await expect(handle).toHaveCount(0);
  const fullName = (await shown.textContent()).trim();
  expect(fullName).not.toBe('set your name…');

  // Settings shows both, and says which is which - but only one of them is
  // a field.
  await shown.click();
  const actorShown = page.getByTestId('settings.actor');
  const nameField = page.getByTestId('settings.display-name');
  const username = (await actorShown.textContent()).trim();
  expect(username.length).toBeGreaterThan(0);
  expect(username).not.toContain(' '); // a handle, not a full name
  expect(username).not.toBe(fullName);
  await expect(nameField).toHaveValue(fullName);
  await expect(shown, 'the strip says which username it records').toHaveAttribute('title', new RegExp(username));

  /*
   * The username is READ. It was a text box once, and its value rode up on
   * every write while the server recorded under whatever arrived - so a POST
   * filed a verify under a name it invented, and this panel offered the same
   * click under a login name nobody had typed (n-0142, n-0143). A localhost
   * review server has no authentication and never will, so a name in a
   * request is asserted and never proved: records carry the machine's own
   * configured identity, and this says which one and where it comes from.
   */
  await expect(actorShown).not.toHaveJSProperty('tagName', 'INPUT');
  await expect(page.getByTestId('settings.actor-source')).toContainText(/config\.yml/);

  // The display name is only ever shown, so it stays the panel's to change:
  // editing it moves the strip's name and leaves the recorded handle put.
  await nameField.fill('Someone Else');
  await nameField.blur();
  await expect(shown).toHaveText('Someone Else');
  await expect(shown).toHaveAttribute('title', new RegExp(username));

  /*
   * It takes an edit from empty, which is the case the split exists for:
   * somebody whose git knows no full name has to be able to type one in.
   * Emptying it is an answer too - "show me by my username" - and then there
   * is one name on the strip rather than two, because the name shown and the
   * name recorded have become the same string.
   */
  await shown.click();
  await page.getByTestId('settings.display-name').fill('');
  await page.getByTestId('settings.display-name').blur();
  await expect(shown).toHaveText(username);
  await expect(page.getByTestId('panel.actor-handle')).toHaveCount(0);

  // Put a full name back, from empty, and the two are told apart again.
  await shown.click();
  await page.getByTestId('settings.display-name').fill('Someone Else');
  await page.getByTestId('settings.display-name').blur();
  await expect(shown).toHaveText('Someone Else');
  await expect(shown).toHaveAttribute('title', new RegExp(username));

  /*
   * And the edit outlives the page, while the username comes back from the
   * machine rather than from anything the browser kept. A sitting with no
   * verdicts in it is not restored (that is
   * panel.walkdown.session-survives-reload's business, and it needs a verdict
   * to have something to survive), so the strip is raised again the way it
   * was the first time.
   */
  await page.reload();
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await ensureSession(page);
  await expect(page.getByTestId('panel.actor-name')).toHaveText('Someone Else');
  await expect(page.getByTestId('panel.actor-name')).toHaveAttribute('title', new RegExp(username));

  await endSession(page);
});

/* ---- a rule's threads are one conversation --------------------------------- */

/*
 * Began life untagged, guarding one arity mistake: `threads.map(threadCard)`
 * handed each card its index as a `where`, so every card after the first
 * printed its position as a provenance line. The cards are gone - a rule
 * draws its threads as one stream now (ADR 0006 §1) - and what the check
 * asserts is the claim that replaced them: every thread on the rule is in
 * the stream, tagged, and nothing under the rule repeats which rule it is on.
 */
test('a rule draws its threads as one conversation, and never repeats which rule they are on', {
  tag: '@rule:panel.rules.one-conversation',
}, async ({ page }) => {
  await review(page);
  await endSession(page);
  const { rows, threads } = await payload(page);

  /*
   * A rule carrying MORE THAN ONE thread, because the defect this check
   * exists for skipped the first card. `threads.map(threadCard)` handed the
   * callback the array index as its second argument - which is the card's
   * `where` - so every card after the first printed its own position as a
   * provenance line. Index 0 is falsy, so the first card looked right and
   * the list grew a one-based counter starting at the second thread.
   */
  const listed = new Set((rows ?? []).map((r) => r.rule));
  const counts = {};
  for (const t of threads ?? [])
    if (t.anchor?.rule) counts[t.anchor.rule] = (counts[t.anchor.rule] ?? 0) + 1;
  const rule = Object.keys(counts).find((r) => counts[r] > 1 && listed.has(r));
  expect(rule, 'need a listed rule carrying several threads').toBeTruthy();

  await openRule(page, rule);
  // The rule shows the last thing said, tagged with its thread, and the
  // whole conversation is one slide to the right (n-0319): every message of
  // every thread as one stream (ADR 0006 §1), each thread's opening message
  // tagged with its name, and nothing repeating the rule it is under.
  await expect(page.getByTestId('detail.stream').locator('.wd-tag[data-thread]').first(), 'the last message says which thread it is on').toBeVisible();
  await page.getByTestId('detail.history-open').click();
  const under = page.getByTestId('history.stream');
  await expect(under.locator('.wd-tag[data-thread]').first(), 'the rule draws its threads').toBeVisible();
  // One opening tag per thread; a reply's "↳" tag names the thread it is on
  // where the stream changes thread, and is not a second listing of it.
  const opening = await under.locator('.wd-tag[data-thread]').evaluateAll((els) => els.filter((el) => !el.textContent.trim().startsWith('\u21b3')).length);
  expect(opening).toBe(counts[rule]);
  await expect(
    page.getByTestId('history.panel').getByTestId('thread.where'),
    'under a rule, nothing repeats the rule it is anchored to',
  ).toHaveCount(0);
  await page.getByTestId('history.back').click();

  // And a card on the Threads tab, which is scoped to nothing, does carry
  // it - otherwise this check would pass on a card that never draws the
  // line at all. Under All, because a rule's threads live under the rule
  // and the tab's live filters no longer list them.
  await page.getByTestId('detail.back').click();
  await page
    .getByTestId('panel.tabs')
    .getByText(/Threads/)
    .click();
  await page.getByTestId('panel.thread-filter').getByText('All', { exact: false }).click();
  await expect(
    page.getByTestId('panel.threads-list').getByTestId('thread.where').first(),
  ).toBeVisible();
});

/*
 * A rule that asks does so one question at a time, with the ways out as
 * choices: the head of its asks is a card above its own answer box, Answer
 * takes the pick and the words and draws the next, Later sends one to the
 * back. Reply on such a rule used to file a fresh note beside the question
 * (q-0254, n-0310), and three prose questions with the fork in their third
 * paragraph read as no question at all (q-0257, q-0262, 2026-09-19).
 */
test('a rule that asks draws one ask at a time with its choices, and Answer moves to the next', {
  tag: '@rule:panel.rules.one-conversation @rule:threads.question.one-ask',
}, async ({ page }) => {
  await review(page);
  const { rows } = await payload(page);
  const rule = rows.find((r) => r.built && !r.retired).rule;
  const file = async (body, options) => {
    const res = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
      data: { kind: 'question', body, anchor: { rule }, via: 'agent', ...(options ? { options } : {}) },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).id;
  };
  const q1 = await file('Should the sheet keep its shadow when the desk is hidden?\n\nThe ghost draws one today.', [
    { label: 'Keep it', why: 'the shadow is what says it is a sheet' },
    { label: 'Drop it' },
  ]);
  const q2 = await file('Does the ruling need a darker line every fifth row?');
  await page.reload();
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await ensureSession(page); // the verdict pair would be offered, were the rule not asking
  await openRule(page, rule);

  // One ask at a time: the older question first, its choices under it, a
  // count of the rule's asks, and no verdict while any stand.
  const ask = page.getByTestId('detail.ask');
  await expect(ask).toHaveAttribute('data-question', q1);
  await expect(ask).toContainText(/keep its shadow/);
  await expect(page.getByTestId('detail.ask-count')).toContainText('1 of 2');
  const options = ask.locator('[data-option]');
  await expect(options).toHaveText([/Keep it/, /Drop it/]);
  await expect(ask.locator('[data-v="later"]')).toBeVisible();
  await expect(page.getByTestId('detail.verdict').locator('[data-v="pass"], [data-v="fail"], [data-v="answer"]')).toHaveCount(0);
  await expect(page.getByTestId('detail.verdict').locator('[data-v="reply"]')).toBeVisible();
  // The tag is still the door to the thread, which draws the same choices.
  await ask.locator('.wd-tag[data-thread]').click();
  await expect(page.getByTestId('thread.ask')).toContainText(/keep its shadow/);
  await expect(page.getByTestId('thread.ask').locator('[data-option]')).toHaveCount(2);
  await expect(page.getByTestId('thread.actions').filter({ hasText: 'Answer' })).toBeVisible();
  await expect(page.getByTestId('thread.actions').filter({ hasText: 'Later' })).toBeVisible();
  await page.getByTestId('thread.close').click();

  // Later: the other ask comes up; this one comes round again after it.
  await ask.locator('[data-v="later"]').click();
  await expect(ask).toHaveAttribute('data-question', q2);
  await expect(page.getByTestId('detail.ask-count')).toContainText('1 of 2');
  await expect(ask.locator('[data-option]')).toHaveCount(0);
  await ask.locator('[data-v="later"]').click();
  await expect(ask).toHaveAttribute('data-question', q1);

  // A pick and a word: both land on the question, which moves to answered
  // and records the label; the next ask is drawn, still on the rule.
  await options.filter({ hasText: 'Keep it' }).click();
  await expect(options.filter({ hasText: 'Keep it' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('detail.answer').fill('Yes - the shadow is what says it is a sheet.');
  await ask.locator('[data-v="answer"]').click();
  await expect(ask).toHaveAttribute('data-question', q2);
  await expect(page.getByTestId('detail.ask-count')).toContainText('2 of 2');
  await expect.poll(() => page.locator('.wdp-track').evaluate((el) => el.style.transform)).toMatch(/translateX\(-33/);
  const threads = async () => (await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json()).threads;
  const first = (await threads()).find((t) => t.id === q1);
  expect(first.status).toBe('answered');
  expect(first.chosen).toBe('Keep it');
  expect(first.replies.at(-1).body).toMatch(/the shadow is what says/);
  // Answered in the whole conversation, one slide right: the choice taken
  // is marked, and the answer itself says which question it is on -
  // tagged, cut to a few lines, and its tag is the way back to the
  // question's own screen. The detail itself shows the last message only.
  await expect(page.getByTestId('detail.stream').locator('.wd-msg')).toHaveCount(1);
  await page.getByTestId('detail.history-open').click();
  const stream = page.getByTestId('history.stream');
  await expect(stream.locator('.wd-opt.chosen')).toHaveText(/Keep it/);
  // A reply on another thread than the message before it says so too.
  await expect(stream.locator('.wd-msg', { hasText: 'Does the ruling need a darker line' }).locator('.wd-tag')).toHaveText(`${q2} \u00b7 question \u00b7 open`);
  const answer = stream.locator('.wd-msg', { hasText: 'the shadow is what says it is a sheet.' }).last();
  await expect(answer.locator('.wd-tag')).toHaveText(`\u21b3 answer \u00b7 ${q1}`);
  await expect(answer.locator('.wd-text')).toHaveClass(/wd-clamp/);
  await answer.locator('.wd-tag[data-thread]').click();
  await expect(page.getByTestId('thread.provenance')).toContainText(q1);
  await page.getByTestId('thread.close').click();
  await expect(ask).toHaveAttribute('data-question', q2);

  // The last ask, answered in words alone: the card goes, the rule is the
  // agent's to fold in, and no verdict is offered until it has.
  await page.getByTestId('detail.answer').fill('No.');
  await ask.locator('[data-v="answer"]').click();
  await expect(ask).toHaveCount(0);
  const turn = page.getByTestId('detail.turn');
  await expect(turn).toHaveAttribute('data-party', 'agent');
  await expect(turn).toContainText(/folds your answer/i);
  await expect(page.getByTestId('detail.verdict').locator('[data-v="pass"], [data-v="fail"]')).toHaveCount(0);
  await expect(page.getByTestId('panel.rules-list').locator(`[data-rule="${rule}"] [data-ask]`)).toHaveCount(0);
  // Folded in, so the rule is a person's again for the checks that follow
  // (status.attention.blocked-queues).
  for (const id of [q1, q2])
    expect((await page.request.post(`${WD_ORIGIN}/api/threads/${id}/status?bp=blueprint`, {
      data: { status: 'incorporated', via: 'agent' },
    })).ok()).toBeTruthy();
});

test('no two signature states are drawn the same way', {
  tag: '@rule:panel.rules.tiers-at-a-glance',
}, async ({ page }) => {
  await review(page);
  const list = page.getByTestId('panel.rules-list');
  await expect(list).toBeVisible();

  /*
   * The claim, stated as the thing that can actually go wrong: a reader has
   * to be able to tell one signature state from another. Asserting the
   * SHAPES by name would restate the panel to itself and would need editing
   * every time the design moves; asserting that distinct states render
   * distinctly survives the design moving and still catches the defect.
   *
   * There are two claims, and the second is the one with teeth. Distinctness
   * alone would have passed the defect this was written for: `stale` was a
   * smaller filled dot beside `signed`'s larger filled dot, which IS
   * distinct - structurally, at least. It was unreadable for a different
   * reason, that size only means anything next to a neighbour, and the
   * common case is one slot with nothing beside it.
   *
   * A test reading the DOM cannot perceive that. What it can do is hold the
   * design to the rule that follows from it: size may accompany a
   * distinction but never carry one alone. Strip the size utilities and the
   * states must STILL be distinct - which fails on the smaller dot and
   * passes on the ring that replaced it.
   */
  const seen = await list.getByTestId('panel.rule-signoff').evaluateAll((els) =>
    els.map((el) => ({
      states: (el.getAttribute('data-signoff') ?? '')
        .split(' ')
        .filter(Boolean)
        .map((s) => s.split(':')[1]),
      marks: [...el.children].map((slot) => {
        const dot = slot.firstElementChild;
        return dot ? `${dot.className}|${dot.getAttribute('style') ?? ''}` : '';
      }),
    })),
  );

  /*
   * Role tint and dimming are stripped before comparing, and that is the
   * point rather than a convenience. One slot's colour says WHOSE signature
   * it is, and its opacity says whether the rule is waiting on you - both
   * vary while the state stays put, so a comparison that kept them would
   * call two identical rings different marks and prove nothing. What is
   * left is shape, which is the only channel carrying state, and it has to
   * carry it alone.
   */
  const shape = (mark) => {
    const [cls, style = ''] = mark.split('|');
    const kept = cls
      .split(' ')
      .filter((tok) => !/^(text-(blue|purple)-\d+|text-base-content|opacity-\d+)$/.test(tok));
    return `${kept.join(' ')}|${style}`;
  };

  const drawing = new Map();
  for (const { states, marks } of seen) {
    // The stack collapses its middle to a +N past three roles, so the slots
    // stop lining up with the states one for one. Nothing on this board does
    // that yet; skip rather than assert against a shape nobody is drawing.
    if (states.length !== marks.length) continue;
    states.forEach((state, i) => {
      if (!drawing.has(state)) drawing.set(state, new Set());
      drawing.get(state).add(shape(marks[i]));
    });
  }
  expect(
    drawing.size,
    'the board offers more than one signature state to tell apart',
  ).toBeGreaterThan(1);

  for (const [state, shapes] of drawing)
    expect([...shapes], `${state} is drawn one way, whoever is signing`).toHaveLength(1);

  const byShape = new Map();
  for (const [state, shapes] of drawing) {
    const only = [...shapes][0];
    expect(
      byShape.get(only),
      `${state} and ${byShape.get(only)} are drawn identically`,
    ).toBeUndefined();
    byShape.set(only, state);
  }

  // And distinct by more than their size, which is the claim that has teeth.
  const sizeless = new Map();
  for (const [state, shapes] of drawing) {
    const bare = [...shapes][0]
      .split(' ')
      .filter((t) => !/^size-\[/.test(t))
      .join(' ');
    expect(
      sizeless.get(bare),
      `${state} and ${sizeless.get(bare)} differ only in size - a slot is usually read alone, ` +
        'with no neighbour to judge it against',
    ).toBeUndefined();
    sizeless.set(bare, state);
  }
});

test('the rail groups by screen, in storyboard order, with the headless rules last', {
  tag: '@rule:panel.rules.grouped-by-screen',
}, async ({ page }) => {
  await review(page);
  const bp = await (await page.request.get(`${WD_ORIGIN}/api/blueprint`)).json();
  const list = page.getByTestId('panel.rules-list');
  await expect(list).toBeVisible();

  /*
   * The order the rail should be in, worked out from the ledger rather than
   * read off the panel — an order is a claim about the storyboard, and a
   * check that took it from the thing under test could not tell a right
   * answer from a consistently wrong one.
   */
  const screenIdOf = (r) => r.flow?.at(-1) ?? r.screens?.[0] ?? null;
  const board = (bp.storyboard ?? []).map((s) => s.id);
  const present = [...new Set(bp.rows.map(screenIdOf))];
  const expected = [
    ...board.filter((id) => present.includes(id)),
    ...(present.includes(null) ? [null] : []),
  ];

  const drawn = await list
    .getByTestId('panel.rules-screen')
    .evaluateAll((els) => els.map((e) => e.dataset.screenGroup));
  expect(
    drawn.map((g) => g || null),
    'every screen with rules, in storyboard order, headless last',
  ).toEqual(expected);

  // The story keeps only what the screen has not already said.
  const firstScreen = expected.find((id) => id !== null);
  const stories = [
    ...new Set(bp.rows.filter((r) => screenIdOf(r) === firstScreen).map((r) => r.story)),
  ];
  expect(stories.length, 'the first screen carries stories to label').toBeGreaterThan(0);
  const labels = await list
    .locator('[data-story]')
    .evaluateAll((els) => els.map((e) => ({ story: e.dataset.story, text: e.textContent.trim() })));
  for (const story of stories) {
    const drew = labels.find((l) => l.story === story);
    expect(drew, `${story} is drawn`).toBeTruthy();
    // Full id only when two stories on one screen would read the same word.
    const leaf = story.split('.').at(-1);
    const clash = stories.filter((s) => s.split('.').at(-1) === leaf).length > 1;
    expect(drew.text.toLowerCase()).toBe((clash ? story : leaf).toLowerCase());
  }

  /*
   * And the heading outlives its own group. Scrolled deep into the first
   * screen's rules, the heading pinned at the top of the list is still that
   * screen's — which is the whole point of a group that can run forty rules
   * long.
   */
  // The scroller is inside the pane: the search box is a fixed head above it,
  // so the pane itself does not move and a sticky heading sticks to this.
  const scroller = page.getByTestId('panel.list-scroll');
  const box = await scroller.boundingBox();
  await scroller.evaluate((el) => {
    el.scrollTop = 700;
  });
  await page.waitForTimeout(200);
  const pinned = await list.getByTestId('panel.rules-screen').evaluateAll(
    (els, top) =>
      els
        .map((e) => ({ g: e.dataset.screenGroup, t: e.getBoundingClientRect().top }))
        .filter((e) => Math.abs(e.t - top) < 2)
        .map((e) => e.g),
    box.y,
  );
  expect(pinned, 'the screen being read is still named at the top of the list').toEqual([
    firstScreen,
  ]);
});

/*
 * Provenance where a reader MEETS a thread (n-0147).
 *
 * An agent records under the person it acts for - that is the rule this
 * check claims - so the author line cannot carry the distinction and the
 * second field has to be drawn beside it. The thread list drew the name and
 * not the field, so every thread an agent filed read as the person's in the
 * one place a reader sees it before opening anything.
 *
 * Driven from the list rather than from the stream because the two render in
 * different modules and only one of them had the bug; the stream's half is a
 * unit test, which is where a pure render belongs.
 */
test('a thread an agent filed says so in the list, not only once it is opened', {
  tag: '@rule:threads.lifecycle.acts-for-a-person',
}, async ({ page }) => {
  await review(page);
  const { threads } = await payload(page);
  // Live ones only: the list does not draw terminal threads, so a verified
  // thread would be a card that is legitimately absent rather than a card
  // missing its line.
  const LIVE = (t) => !['verified', 'incorporated', 'waived', 'settled', 'recorded'].includes(t.status);
  const byAgent = (threads ?? []).find((t) => t.via && LIVE(t));
  expect(byAgent, 'the ledger holds a live thread some machine typed').toBeTruthy();
  const plain = (threads ?? []).find((t) => !t.via && LIVE(t));

  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  const list = page.getByTestId('panel.threads-list');
  // By the card's own id attribute, never by text: a thread whose BODY names
  // another thread matches a text selector for it, and .first() then picks
  // the wrong row.
  const card = list.locator(`[data-open-thread="${byAgent.id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.wd-via'), 'the card says a machine typed it').toBeVisible();
  await expect(card.locator('.wd-via')).toHaveText(new RegExp(byAgent.via));
  // The person is still named: provenance sits BESIDE attribution, and a
  // reader who wants to know whose decision it was must still be told.
  await expect(card.locator('.wd-who')).toBeVisible();

  // And a thread a person typed carries no such line - an "authored by a
  // human" badge on nearly every card says nothing and costs a row.
  if (plain) {
    const hand = list.locator(`[data-open-thread="${plain.id}"]`).first();
    await hand.scrollIntoViewIfNeeded();
    await expect(hand.locator('.wd-via')).toHaveCount(0);
  }
});

/*
 * Mid-fade the pin control closes, and a closed control that says nothing is
 * indistinguishable from a broken one. The reason used to live in the
 * button's own `title`, which a reviewer can never reach: a disabled button
 * computes `pointer-events: none`, so the pointer lands on whatever is behind
 * it and the browser has no title to open (n-0247).
 *
 * Measured the way a reviewer meets it - what is under the pointer, and what
 * that element shows on hover - rather than by asking whether an attribute
 * exists somewhere in the DOM. That question was the one the old title
 * answered, and it answered it wrongly.
 */
test('mid-fade, the reason pinning is closed is reachable by the pointer', {
  tag: '@rule:panel.dock.no-pin-mid-fade',
}, async ({ page }) => {
  await review(page);
  const fade = page.getByTestId('panel.fade');
  await expect(fade, 'this screen has a design to fade to').toBeEnabled();
  await fade.fill('50'); // half way: both surfaces at once

  const pin = page.getByTestId('panel.pin-mode');
  await expect(pin, 'pinning is closed while neither surface owns the view').toBeDisabled();

  // What the pointer actually hits at the button's centre carries the reason.
  const box = await pin.boundingBox();
  const hit = await page.evaluate(({ x, y }) => {
    const host = document.querySelector('[data-walkdown-chrome]')?.shadowRoot ?? document;
    const el = host.elementFromPoint(x, y);
    return el?.closest('[data-testid="panel.pin-why"]') ? 'the reason' : (el?.tagName ?? 'nothing');
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit, 'the element under the pointer is the one carrying the reason').toBe('the reason');

  const why = page.getByTestId('panel.pin-why');
  await expect(why).toContainText(/half-faded/);
  // And it opens: a tooltip whose content never becomes visible is a title
  // attribute with extra steps.
  await pin.hover({ force: true }); // force: the button beneath is disabled
  const content = why.locator('.tooltip-content');
  await expect
    .poll(() => content.evaluate((el) => Number(getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.5);

  // Landing on an end opens pinning again, and the sentence changes with it.
  await fade.fill('100');
  await expect(pin).toBeEnabled();
  await expect(why).toContainText(/Click anything to attach a note/);
});

/*
 * The other half of "on disk": what the panel does when the disk says no.
 *
 * Under an identity the ledger will not sign for, POST /api/draft answers 400
 * to every verdict, the panel swallowed each one, and the strip went on
 * counting "1/7 judged" over an empty drafts/ (n-0248). The refusal is
 * simulated here rather than reached through a refused identity, because the
 * panel's half of the bug is the same whatever the server's reason was: a
 * write it was told did not land must not read as one that did.
 */
test('a draft the server refuses is said out loud, once, not swallowed', {
  tag: '@rule:panel.walkdown.draft-on-disk',
}, async ({ page }) => {
  await review(page);
  // The pattern carries the query: the panel names its blueprint on every
  // call, and a bare `**/api/draft` matches nothing it actually sends.
  await page.route(/\/api\/draft(\?|$)/, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: '"agent" cannot sign for eng' }),
        })
      : route.continue(),
  );
  await ensureSession(page);
  await firstRule(page);
  await acceptVerdict(page).click();

  const said = page.locator('.toast', { hasText: 'Nothing is being kept on disk' });
  await expect(said, 'the reviewer is told the write did not land').toBeVisible();
  await expect(said).toContainText('cannot sign for eng'); // the server's own words
  // Said once for one reason: a sticky toast per rule would bury the panel.
  await page.getByTestId('detail.back').click();
  await firstRule(page);
  await acceptVerdict(page).click();
  await expect(page.locator('.toast')).toHaveCount(1);
});

/*
 * The same rule, reached by dragging rather than by pressing an end button.
 *
 * A drag is the only time the bar is PAINTED instead of rebuilt (the slider
 * cannot survive having the element under the pointer replaced), so the
 * painted path and the rendered path have to agree about the DOM they share.
 * They did not: the paint rewrote a text node lit owned, the next full render
 * committed into a node that was gone and threw — after PIN.set had already
 * armed pin mode, so the mode was on and the control read as off (n-0249).
 * A drag, then a press, then: nothing thrown.
 */
test('a fade dragged onto an end opens pinning, and nothing throws on the way', {
  tag: '@rule:panel.dock.no-pin-mid-fade',
}, async ({ page }) => {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e)));
  await review(page);

  const fade = page.getByTestId('panel.fade');
  await expect(fade).toBeEnabled();
  const box = await fade.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, y, { steps: 8 }); // through the middle
  await page.mouse.move(box.x + box.width - 2, y, { steps: 8 }); // and onto the far end
  await page.mouse.up();

  const pin = page.getByTestId('panel.pin-mode');
  await expect(pin, 'an end was reached, so pinning is open again').toBeEnabled();
  await pin.click();
  await expect(pin, 'and the control shows the mode it just entered').toHaveClass(/btn-warning/);

  // The paint and the render share the reason's DOM, so it has to survive
  // both: paint it during a drag, then render it afterwards, and the sentence
  // must still be the panel's to change. Clobbered, the render had nothing
  // left to write into - the bar threw where the judge stood, and the words
  // went stale here.
  await page.getByTestId('panel.fade').fill('50');
  await expect(page.getByTestId('panel.pin-why')).toContainText(/half-faded/);
  expect(thrown, 'nothing threw while the bar was painted mid-drag').toEqual([]);
});

/*
 * The first-run gate, driven rather than looked at. Its Connect button was
 * once a second copy of the Blueprints tab's markup with the same ids and no
 * handler, so the one screen whose whole job is reaching a server could not
 * reach one (n-0236) — and nothing in this suite pressed it, which is why
 * that survived. The caption is the design's own: the box says "Server",
 * because a person who reads it as a folder types a path and gets nowhere.
 */
test('the start gate says how to open a blueprint, and its address box actually connects', {
  tag: '@rule:panel.start.open-a-folder',
}, async ({ page }) => {
  // The panel loads from the real server but is told to talk to a port
  // nothing is listening on, so it comes up as first-run.
  await page.goto(fixtureFor({ srv: 'http://localhost:4999' }));
  await expect(page.getByTestId('start.message')).toBeVisible();
  await expect(page.getByTestId('start.message')).toContainText(/No blueprints open/);
  // The command that opens them, named rather than described.
  await expect(page.getByText('walkdown serve', { exact: true })).toBeVisible();

  // Labelled as a server, visibly - not only to a screen reader.
  const box = page.getByTestId('start.server');
  const caption = page.getByText('Server', { exact: true });
  await expect(caption, 'the box says what it wants: a server').toBeVisible();

  // Retried without a reload: type the real address and press Connect.
  await box.fill(WD_ORIGIN);
  await page.getByTestId('start.connect').click();
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect(page.getByTestId('start.message')).toHaveCount(0);
});

/*
 * The page nobody claims, and every other case where the address cannot
 * decide on its own: one modal, over the whole of walkdown's chrome.
 *
 * Behind `projects.length > 1` the question was never put on the commonest
 * first meeting with walkdown - one blueprint on the server, and an ordinary
 * page you had browsed to - so the panel opened that blueprint's whole board
 * over somebody else's site and said nothing (n-0256). The count was never
 * evidence: one blueprint on a server says nothing about who this page
 * belongs to, and since ADR 0001 several may claim one page.
 *
 * `bp=` empty is a page that declares nothing, which is what an ordinary site
 * with the extension on looks like.
 */
test('a page no blueprint claims asks which project, and opens nothing over it', {
  tag: '@rule:panel.start.which-project',
}, async ({ page }) => {
  await page.goto(fixtureFor({ bp: '' }));

  const modal = page.getByTestId('project.modal');
  await expect(modal, 'the panel asks rather than opening').toBeVisible();
  // Named, because a claim misses on a port or a fragment and "no blueprint"
  // without the address leaves you guessing which one was asked about.
  await expect(page.getByTestId('project.address'), 'it names the address').toContainText(WD_ORIGIN);
  await expect(page.getByTestId('project.why')).toContainText(/No blueprint claims this page/i);

  // How to make it reviewable, and how to bring a project in - both at the
  // top, where twenty projects cannot push them off the screen.
  await expect(page.getByTestId('project.commands')).toContainText('walkdown claims --url');
  await expect(page.getByTestId('project.new')).toContainText('walkdown import');
  await expect(page.getByTestId('project.new')).toContainText('walkdown init');

  // Nothing was opened: no board, no rules, no sitting to start.
  await expect(page.getByTestId('panel.rules-list')).toHaveCount(0);
  await expect(page.getByTestId('panel.walk')).toHaveCount(0);

  // And what this machine holds is one step away, never opened for you. This
  // project holds two blueprints, so choosing it asks the second question
  // rather than guessing between them.
  await page.getByTestId('project.list').locator('[data-project]').first().click();
  await expect(page.getByTestId('start.options').locator('[data-pick]').first()).toBeVisible();
  await page.getByTestId('start.options').locator('[data-pick]').first().click();
  await expect(page.getByTestId('panel.rules-list'), 'and then it opens').toBeVisible();
});

/*
 * The other half of the same rule, and the half that keeps it from being
 * merely annoying: a page walkdown DOES know about is never asked.
 */
test('a page a blueprint claims, or one that declares its own, is never asked', {
  tag: '@rule:panel.start.which-project',
}, async ({ page }) => {
  // Claimed by address: the frame is the app surface the blueprint declares.
  // The browser resolves that address to this suite's own server (see
  // declaredResolvesHere), but the question asked of /api/whose is the
  // declared one, which is the address the storyboard actually names.
  await page.goto(fixtureFor({ bp: '', frame: `${DECLARED_ORIGIN}/as-built/review.html` }));
  await expect(page.getByTestId('panel.rules-list'), 'a claimed page opens').toBeVisible();
  await expect(page.getByTestId('project.modal')).toHaveCount(0);
  // And the bar says where you landed, project first.
  await expect(page.getByTestId('panel.project')).toBeVisible();

  // Declaring your own blueprint answers the question before it is asked.
  await review(page);
  await expect(page.getByTestId('panel.rules-list')).toBeVisible();
  await expect(page.getByTestId('project.modal')).toHaveCount(0);
});

/*
 * Several claimants in one project is a question, and it is asked where the
 * answer is - the project's own Blueprints list, with the reason said out
 * loud and the ones that claim this page marked and first.
 *
 * The two claims are manufactured here because the server's own answer is
 * covered by the unit suite (test/import.test.js): what is being judged is
 * what the PANEL does with a list of two.
 */
test('two blueprints claiming one page is a question, asked with both named', {
  tag: '@rule:panel.start.choose-a-blueprint',
}, async ({ page }) => {
  let keys = [];
  await page.route('**/api/blueprint*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    keys = (body.blueprints ?? []).map((p) => p.key);
    await route.fulfill({ response: res, json: body });
  });
  await page.route(/\/api\/whose(\?|$)/, async (route) => {
    const url = new URL(route.request().url()).searchParams.get('url');
    await route.fulfill({
      json: { url, matches: keys.map((key) => ({ id: key, key, name: key, screen: 'review' })) },
    });
  });
  await page.goto(fixtureFor({ bp: '' }));

  // Not the modal: the project is not in doubt, only which of its blueprints.
  await expect(page.getByTestId('project.modal')).toHaveCount(0);
  await expect(page.getByTestId('start.notice')).toContainText(/2 blueprints/);
  await expect(page.getByTestId('start.notice')).toContainText(/asks each time/i);
  const marked = page.getByTestId('start.options').locator('[data-pick][data-claims]');
  await expect(marked, 'both are marked as claiming it').toHaveCount(2);
  await expect(page.getByTestId('panel.rules-list')).toHaveCount(0);
});

/*
 * Nothing is remembered (ADR 0001 §9). A pick used to be kept per site in the
 * browser, which is a second kind of memory about something the project
 * already knows - your laptop knew, your teammate did not. Asking twice is
 * cheap; a wrong memory is not.
 */
test('a blueprint picked for an unclaimed page is not remembered next time', {
  tag: '@rule:panel.start.which-project',
}, async ({ page }) => {
  const frameOn = (origin, path) => fixtureFor({ bp: '', frame: `${origin}${path}` });

  await page.goto(frameOn(WD_ORIGIN, '/nothing-claims-this.html'));
  await expect(page.getByTestId('project.modal')).toBeVisible();
  await page.getByTestId('project.list').locator('[data-project]').first().click();
  await page.getByTestId('start.options').locator('[data-pick]').first().click();
  await expect(page.getByTestId('panel.rules-list')).toBeVisible();

  // The same page again: nothing was written down, so it asks again.
  await page.goto(frameOn(WD_ORIGIN, '/nothing-claims-this.html'));
  await expect(
    page.getByTestId('project.modal'),
    'the pick was not remembered, here or anywhere',
  ).toBeVisible();
  await expect(page.getByTestId('panel.rules-list')).toHaveCount(0);
});

/*
 * One blueprint on offer is the case that used to open unasked.
 *
 * Behind `projects.length > 1` a folder holding ONE opened it over a page
 * nobody had claimed, while six were asked about (n-0256, n-0260). The count
 * is not evidence, so it changes nothing about the question.
 */
test('one blueprint on the server is not evidence that this page belongs to it', {
  tag: '@rule:panel.start.which-project',
}, async ({ page }) => {
  await page.route('**/api/blueprint*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.blueprints = (body.blueprints ?? []).slice(0, 1);
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(fixtureFor({ bp: '' }));

  await expect(page.getByTestId('project.modal'), 'it asks rather than opening').toBeVisible();
  await expect(page.getByTestId('panel.rules-list')).toHaveCount(0);
  // The one it holds is offered, never opened - and choosing its project goes
  // straight in, because one blueprint is not a question worth asking twice.
  await page.getByTestId('project.list').locator('[data-project]').first().click();
  await expect(page.getByTestId('panel.rules-list'), 'one blueprint opens on choosing').toBeVisible();
});

/*
 * The fourth road: a server that lists NOTHING.
 *
 * "Nothing to pick, so no question to put" opened a full board over somebody
 * else's site - the payload such a server sends still carries a whole
 * blueprint, so what "no choice" opened was exactly the board a count had
 * chosen, at zero instead of at one (n-0261). There is no count at which the
 * panel may decide whose page this is.
 */
test('a server that lists nothing still does not open itself over the page', {
  tag: '@rule:panel.start.which-project',
}, async ({ page }) => {
  await page.route('**/api/blueprint*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.blueprints = [];
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(fixtureFor({ bp: '' }));

  await expect(page.getByTestId('project.modal'), 'it says something rather than opening').toBeVisible();
  await expect(page.getByTestId('project.address')).toContainText(WD_ORIGIN);
  await expect(page.getByTestId('panel.rules-list')).toHaveCount(0);
  // Nothing is listed, so nothing is offered: the list is absent rather than
  // empty, because an empty list of projects is a promise of a door.
  await expect(page.getByTestId('project.list')).toHaveCount(0);
  await expect(page.getByTestId('project.none')).toBeVisible();
  // And what to do about it is still on screen, which is the whole reason the
  // commands sit above the list.
  await expect(page.getByTestId('project.new')).toContainText('walkdown import');
});

/*
 * And a server that cannot answer whose page this is at all. Every screen the
 * panel could draw here asserts something it failed to find out, so the honest
 * one is the server's: it answered a moment ago and cannot answer this.
 */
test('a server that cannot say whose page this is is a server problem, not a board', {
  tag: '@rule:panel.start.which-project',
}, async ({ page }) => {
  await page.route(/\/api\/whose(\?|$)/, (route) => route.fulfill({ status: 500, body: 'no' }));
  await page.goto(fixtureFor({ bp: '' }));

  await expect(page.getByTestId('start.message')).toBeVisible();
  await expect(page.getByTestId('panel.rules-list')).toHaveCount(0);
});

/*
 * A key from another server is not a reason to say there is no server.
 *
 * walkdown's own served review page bakes in the blueprint key of the server
 * that served it, so typing a second server's address carried the first one's
 * key across. That server answered 404, and the panel drew the screen for
 * having no server at all - over a live server holding two blueprints
 * (n-0265). A key this one does not have is a reason to ask it without one.
 */
test('a blueprint key this server does not have is dropped, not read as no server', {
  tag: '@rule:panel.start.open-a-folder',
}, async ({ page }) => {
  await page.goto(fixtureFor({ bp: '/somewhere/else/blueprint' }));

  await expect(
    page.getByTestId('start.message'),
    'a server that answers is never reported as absent',
  ).toHaveCount(0);
  // It asks which project instead, which is what having no key means - and
  // what this machine holds is listed, so it plainly answered.
  await expect(page.getByTestId('project.modal')).toBeVisible();
  await expect(page.getByTestId('project.list').locator('[data-project]')).not.toHaveCount(0);
});

/*
 * Crossing projects is a deliberate act, available at any time: the bar reads
 * project / blueprint / screen, and the project is a control rather than a
 * label (ADR 0001 §11). Without it there is no way to reach another project
 * except by changing the address.
 */
test('the bar names the project you are in, and opens the switcher at will', {
  tag: '@rule:panel.dock.toolbar',
}, async ({ page }) => {
  await review(page);
  await expect(page.getByTestId('panel.rules-list')).toBeVisible();

  const project = page.getByTestId('panel.project');
  await expect(project, 'the bar names the project').toBeVisible();
  // And the blueprint beside it, which is the narrower answer: project /
  // blueprint / screen, in that order.
  await expect(page.getByTestId('panel.blueprint')).toBeVisible();
  await expect(page.getByTestId('panel.screen-picker')).toBeVisible();

  await project.click();
  await expect(page.getByTestId('project.modal'), 'it opens the same modal').toBeVisible();
  // Over a board, it is something you can change your mind about.
  await page.getByTestId('project.close').click();
  await expect(page.getByTestId('project.modal')).toHaveCount(0);
  await expect(page.getByTestId('panel.rules-list')).toBeVisible();
});

/*
 * And Escape puts the switcher away too - the rule says so in as many words,
 * and every check here had closed it with the button, which is how an Escape
 * that did nothing went unnoticed (n-0279). The board comes back as it was.
 */
test('Escape closes the switcher and gives the board back', {
  tag: '@rule:panel.start.which-project',
}, async ({ page }) => {
  await review(page);
  await expect(page.getByTestId('panel.rules-list')).toBeVisible();
  await page.getByTestId('panel.project').click();
  await expect(page.getByTestId('project.modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('project.modal')).toHaveCount(0);
  await expect(page.getByTestId('panel.rules-list')).toBeVisible();
});

/*
 * The modal's own root. `walkdown serve` opened with no fragment has no page
 * to route from - what is on screen is walkdown - and the panel used to refuse
 * to boot at all without a frame, so this row of ADR 0001 §7 was unreachable
 * from every door (n-0272). Nothing is drawn there but the desk and the
 * modal, which cannot be dismissed because there is nothing behind it to go
 * back to; the chrome appears the moment a project is picked, and a blueprint
 * picked then takes you to a page it claims, since the root has none of its
 * own.
 */
test("walkdown's own root asks which project over the desk alone, and a pick brings the board", {
  tag: '@rule:panel.start.which-project',
}, async ({ page }) => {
  await page.route('**/index.html', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>The other project</h1>' }),
  );
  await page.goto(`${WD_ORIGIN}/`);

  const modal = page.getByTestId('project.modal');
  await expect(modal, 'the root is the modal').toBeVisible();
  await expect(page.getByTestId('project.why')).toContainText(/walkdown's own server/i);
  // Nothing to go back to, so nothing to close it with - not a button, and
  // not Escape either.
  await expect(page.getByTestId('project.close')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(modal, 'Escape leaves it standing').toBeVisible();
  // And nothing under it: no bar, no sheet - the desk ruling alone.
  await expect(page.getByTestId('panel.bar'), 'no bar at the bare root').toBeHidden();
  await expect(page.getByTestId('panel.app-frame'), 'no sheet at the bare root').toBeHidden();
  // And the backdrop blurs nothing there: only the desk ruling is behind the
  // modal, and a blur softened it into blotches (n-0303).
  const backdrop = modal.locator('xpath=preceding-sibling::div[1]');
  await expect
    .poll(() => backdrop.evaluate((el) => getComputedStyle(el).backdropFilter))
    .toBe('none');

  // The project holds two blueprints, so picking it asks which - on the
  // panel, beside a sheet with nothing in it yet.
  await page.getByTestId('project.list').locator('[data-project]').first().click();
  await expect(page.getByTestId('start.options').locator('[data-pick]').first()).toBeVisible();
  await expect(page.getByTestId('panel.bar'), 'the bar is back').toBeVisible();
  await expect(page.getByTestId('panel.app-frame'), 'and an empty sheet').toBeVisible();
  await expect(page.getByTestId('project.modal')).toHaveCount(0);

  // A blueprint picked from the root has no page under it to keep, so it goes
  // to one it claims (panel.rules.takes-you-there).
  await page.getByTestId('start.options').getByText(/walkdown-example/i).first().click();
  await expect(page.getByTestId('panel.rules-list')).toBeVisible();
  await expect
    .poll(() => page.frames().some((f) => f.url().includes('index.html')), { timeout: 10000 })
    .toBe(true);
});

/*
 * The reason the Blueprints pane gives is about the blueprints it is listing.
 * The claimants are gathered once, for the page; crossing to another project
 * kept that count, and the pane said "2 blueprints in this project claim this
 * page" over a list where none did (n-0273).
 */
test('crossing to a project that claims nothing here does not keep the old count', {
  tag: ['@rule:panel.start.choose-a-blueprint', '@rule:panel.start.which-project'],
}, async ({ page }) => {
  let keys = [];
  await page.route('**/api/blueprint*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    keys = (body.blueprints ?? []).map((p) => p.key);
    // A second project this machine holds, whose blueprints claim nothing on
    // this page. Two of them, so picking it asks rather than opening one.
    const other = { id: 'other', root: '~/elsewhere' };
    body.blueprints.push(
      { id: 'delta', key: '/elsewhere/0001-delta/blueprint', name: 'delta', project: other },
      { id: 'epsilon', key: '/elsewhere/0002-epsilon/blueprint', name: 'epsilon', project: other },
    );
    await route.fulfill({ response: res, json: body });
  });
  await page.route(/\/api\/whose(\?|$)/, async (route) => {
    const url = new URL(route.request().url()).searchParams.get('url');
    await route.fulfill({
      json: { url, matches: keys.map((key) => ({ id: key, key, name: key, screen: 'review' })) },
    });
  });
  await page.goto(fixtureFor({ bp: '' }));

  // Two claimants in one project: the question, with the reason.
  await expect(page.getByTestId('start.notice')).toContainText(/2 blueprints in this project claim/);
  await expect(page.getByTestId('start.options').locator('[data-pick][data-claims]')).toHaveCount(2);

  // Cross to the other project from the bar.
  await page.getByTestId('panel.project').click();
  await page.getByTestId('project.list').locator('[data-project="other"]').click();

  // Its two blueprints, neither claiming this page - and the notice says
  // that, rather than the count it gathered for the project you left.
  await expect(page.getByTestId('start.options').locator('[data-pick]')).toHaveCount(2);
  await expect(page.getByTestId('start.options').locator('[data-pick][data-claims]')).toHaveCount(0);
  await expect(page.getByTestId('start.notice')).toContainText(/holds more than one blueprint/);
  await expect(page.getByTestId('start.notice')).not.toContainText(/claim this page/);

  // Pick one of them, so a blueprint is open - and then the switcher, opened
  // again on the same page, still knows whose page it is: once a blueprint
  // was set the answer was dropped, and the modal named the address it had
  // just been asked about and said nothing claimed it (n-0282).
  await page.getByTestId('panel.project').click();
  await page.getByTestId('project.list').locator('[data-project]:not([data-project="other"])').click();
  await page.getByTestId('start.options').locator('[data-pick]').first().click();
  await expect(page.getByTestId('panel.rules-list')).toBeVisible();
  await page.getByTestId('panel.project').click();
  const list = page.getByTestId('project.list');
  await expect(list.locator('[data-project][data-claims]')).toHaveCount(1);
  await expect(list.locator('[data-project][data-claims]').first()).not.toHaveAttribute('data-project', 'other');
  // And counted right in both dimensions: two blueprints, one project. A
  // singly-claimed page once read "1 blueprints claim this page, in more
  // than one project" (n-0283).
  await expect(page.getByTestId('project.why')).toHaveText('2 blueprints claim this page, in one project.');
  await page.keyboard.press('Escape');
});

/*
 * Records carry UTC; the clock on screen is the reader's, said once in the
 * personal config (n-0290). The checks home declares Asia/Tokyo - not where
 * any laptop running this suite is - so a stamp read in it is provably the
 * config's zone and not the browser's.
 */
test('times read in the zone the person declared, and Settings says which @rule:time.records.read-in-your-zone', {
  tag: '@rule:time.records.read-in-your-zone',
}, async ({ page }) => {
  // A thread with a stamp whose Tokyo reading and UTC reading differ in date.
  const filed = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: { kind: 'note', body: 'when was this', anchor: { rule: 'panel.rules.steps-not-an-appendix' } },
  });
  expect(filed.ok()).toBeTruthy();
  const { id, thread } = await filed.json();
  // An instant with a Z, whole seconds or not: the door stamps milliseconds,
  // other writers do not, and the rule asks for neither in particular.
  expect(thread.created, 'the file says UTC').toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  await review(page);
  await ensureSession(page);
  await page.getByTestId('panel.actor-name').click();
  const zone = page.getByTestId('settings.timezone');
  await expect(zone).toHaveText('Asia/Tokyo');
  await expect(zone).toHaveAttribute('title', /config\.yml/);
  await expect(zone).not.toHaveJSProperty('tagName', 'INPUT');
  await page.keyboard.press('Escape');

  // The message's hover stamp carries the zone, and the hour is Tokyo's.
  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  // The list opens on what waits on a person; a thread on a rule lives under the rule and is listed here only under All (ADR 0006 §3).
  await page.getByTestId('panel.thread-filter').getByText('All', { exact: false }).click();
  await page.getByTestId('panel.threads-list').locator(`[data-open-thread="${id}"]`).first().click({ position: { x: 8, y: 6 } });
  const at = page.getByTestId('thread.body').locator('.wd-at[title]').first();
  await expect(at).toBeVisible();
  const title = await at.getAttribute('title');
  expect(title, 'the stamp says which clock read it').toMatch(/GMT\+9/);
  const [h, m] = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit' }).format(new Date(thread.created)).split(/[: ]/);
  expect(title, 'and the hour is Tokyo\'s, whatever zone the browser is in').toMatch(new RegExp(`\\b${h}:${m}:`));
});

/*
 * ADR 0006 §2: a person's Pass on a rule ends its conversation - every live
 * note on it, whoever filed it and whether or not the agent got to it - and
 * the line above the composer says so before they press anything. Filed
 * through the door, answered by an agent, then judged in a signed sitting:
 * the threads end `verified` under the signer's name and the Finish toast
 * names them.
 */
test('a pass ends the rule\u2019s conversation, and says so first', {
  tag: '@rule:panel.walkdown.pass-verifies-feedback',
}, async ({ page }) => {
  const { rows } = await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json();
  const rule = rows.find((r) => r.built).rule;

  // Feedback under the person, answered by the machine: what a pass verifies.
  const filed = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    // A first line longer than the pane is wide: the block cuts it short
    // rather than letting it set the width of everything on the screen.
    data: { kind: 'note', body: `The label reads wrong here, ${'and this note goes on at length about it '.repeat(6)}.`, anchor: { rule } },
  });
  expect(filed.ok()).toBeTruthy();
  const { id, thread } = await filed.json();
  expect(thread.reason).toBe('feedback');
  const answered = await page.request.post(`${WD_ORIGIN}/api/threads/${id}/status?bp=blueprint`, {
    data: { status: 'addressed', via: 'agent', reason: 'Reworded it.' },
  });
  expect(answered.ok()).toBeTruthy();
  // And one that is not answered yet: the pass is the look, and ends it too.
  const still = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: { kind: 'note', body: 'Not fixed yet.', anchor: { rule } },
  });
  const open = (await still.json()).id;
  // And an answered request: under ADR 0005 a person's to verify from its
  // own screen (n-0296); on a walkable rule it is the rule's conversation now.
  const asked = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: { kind: 'note', body: 'Could the design show this?', anchor: { rule }, reason: 'request' },
  });
  const request = (await asked.json()).id;
  expect((await page.request.post(`${WD_ORIGIN}/api/threads/${request}/status?bp=blueprint`, {
    data: { status: 'addressed', via: 'agent', reason: 'Drawn.' },
  })).ok()).toBeTruthy();

  // Opened after the filing, so the panel is reading the threads as they are.
  await review(page);
  await endSession(page);
  await ensureSession(page);
  await openRuleForVerdict(page, rule);
  // Said before the press: how many notes the pass ends, above the box.
  const says = page.getByTestId('detail.turn');
  await expect(says).toBeVisible();
  await expect(says).toContainText(/Pass ends this conversation \(\d+ notes?\)/);
  const liveNow = (await payload(page)).threads.filter(
    (t) => t.anchor?.rule === rule && t.kind !== 'question' && ['open', 'addressed'].includes(t.status),
  ).length;
  await expect(says).toContainText(`(${liveNow} note${liveNow === 1 ? '' : 's'})`);
  // Cut short, not run off the edge: the stream, and the statement above it,
  // end inside the panel. One unwrappable line used to set the width of
  // every pane on the track, and the whole detail ran off the right.
  const panel = await page.getByTestId('panel.bar').boundingBox();
  for (const loc of [page.getByTestId('detail.stream'), page.getByTestId('detail.statement')]) {
    // Polled: the detail slides in over 300ms, and a box read mid-slide
    // sits wherever the track was at that instant.
    await expect
      .poll(async () => {
        const box = await loc.boundingBox();
        return [box.x >= panel.x - 1, box.x + box.width <= panel.x + panel.width + 1];
      }, { message: 'wider than the panel' })
      .toEqual([true, true]);
  }

  await acceptVerdict(page).click();
  await expect(page.getByTestId('panel.judged')).toHaveText(/^\+1\/\d+$/);
  await page.getByTestId('panel.walk').click(); // the same control that started it
  // Whatever the panel said first: a refusal names itself in the failure,
  // rather than reading as a sitting that simply would not end.
  const said = page.locator('.toast').first();
  await expect(said).toBeVisible();
  expect(await said.textContent()).toMatch(/Recorded 1 verdict/);
  await expect(page.getByTestId('panel.actor')).toBeHidden();

  // The toast names what the pass closed; the ledger has every one of them
  // closed under the signer, with the run that carried the pass.
  await expect(said).toContainText(/verified \d+ threads? \(/);
  const after = (await payload(page)).threads;
  for (const tid of [id, open, request]) {
    await expect(said).toContainText(tid);
    const closed = after.find((t) => t.id === tid);
    expect(closed.status, tid).toBe('verified');
    expect(closed.verified_by).toBeTruthy();
    expect(closed.verified_by).not.toBe('agent');
    expect(closed.verified_via).toMatch(/\S/);
    expect(closed.replies.at(-1).via).toBe('verdict');
  }
});

/*
 * One claimant is never the reason a chooser is shown - the panel opens a
 * lone claimant unasked - so a project holding two blueprints of which one
 * claims the page asks the "which of several" question, not "1 blueprints in
 * this project claim this page ... rather than choosing for you" (n-0293).
 */
test('a project with one claimant among several is asked the several question, in the singular', {
  tag: '@rule:panel.start.choose-a-blueprint',
}, async ({ page }) => {
  // A second blueprint in THIS project, claiming nothing: the project's
  // lone claimant opens unasked at start, and picking the project again
  // from the switcher is what puts the chooser up.
  let keys = [];
  await page.route('**/api/blueprint*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (Array.isArray(body.blueprints) && body.blueprints.length) {
      const mine = body.blueprints[0];
      keys = [mine.key];
      body.blueprints.push({ ...mine, id: 'sibling', key: `${mine.key}-sibling`, name: 'sibling' });
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.route(/\/api\/whose(\?|$)/, async (route) => {
    const url = new URL(route.request().url()).searchParams.get('url');
    await route.fulfill({ json: { url, matches: keys.map((key) => ({ id: key, key, name: key, screen: 'review' })) } });
  });
  await review(page);
  await page.getByTestId('panel.project').click();
  await page.getByTestId('project.list').locator('[data-project]').first().click();

  // Two to choose from, one marked as claiming - and the reason given is
  // that there are two, never a count of one presented as a refusal to pick.
  expect(await page.getByTestId('start.options').locator('[data-pick]').count()).toBeGreaterThan(1);
  await expect(page.getByTestId('start.options').locator('[data-pick][data-claims]')).toHaveCount(1);
  const notice = page.getByTestId('start.notice');
  await expect(notice).toContainText(/holds more than one blueprint/);
  await expect(notice).not.toContainText(/1 blueprints/);
  await expect(notice).not.toContainText(/choosing for you/);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/*
 * walkdown's own page opens what its address names (n-0297): `?rule=` lands
 * on that rule, `?thread=` on that thread over its rule, an unknown id says
 * so. The address is what lets an id beside a pin be a link out.
 */
test("walkdown's own address opens the rule or thread it names, once", {
  tag: '@rule:panel.start.address-opens-what-it-names',
}, async ({ page }) => {
  const { rows, threads } = await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json();
  const thread = threads.find((t) => t.anchor?.rule && rows.some((r) => r.rule === t.anchor.rule));
  const rule = rows.find((r) => r.rule !== thread.anchor.rule).rule;

  // A rule, with no page to review named: the board opens on it.
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&rule=${encodeURIComponent(rule)}`);
  await expect(page.getByTestId('detail.rule-id')).toHaveText(rule);

  // A thread: opened over its rule's detail, so Back lands there.
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${thread.id}`);
  await expect(page.getByTestId('thread.provenance')).toContainText(thread.id);
  await page.getByTestId('thread.close').click();
  await expect(page.getByTestId('detail.rule-id')).toHaveText(thread.anchor.rule);

  // Once: moving on inside the panel is not undone by the address. The
  // panes slide, so "on the list" is the track standing at the list.
  await page.getByTestId('detail.back').click();
  const track = page.locator('.wdp-track');
  await expect.poll(() => track.evaluate((el) => el.style.transform)).toMatch(/translateX\(0%\)/);
  await page.waitForTimeout(500);
  expect(await track.evaluate((el) => el.style.transform)).toMatch(/translateX\(0%\)/);

  // An id the blueprint does not know is said, not silently nothing.
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&rule=no.such.rule`);
  await expect(page.locator('.toast', { hasText: 'No rule no.such.rule here' })).toBeVisible();
  await expect.poll(() => page.locator('.wdp-track').evaluate((el) => el.style.transform)).toMatch(/translateX\(0%\)/);
});

/*
 * The address says what you are looking at: the blueprint in `?bp=`, the
 * page in the frame after `#`. Written as each settles, so a reload of the
 * tab comes back to the same board on the same page - and only the address
 * carries it: a fresh open with no `?bp=` still asks (ADR 0001 §9).
 */
test("walkdown's own address keeps the blueprint and the page, so a reload comes back to them", {
  tag: '@rule:panel.start.address-keeps-the-pick',
}, async ({ page }) => {
  const { key } = await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json();
  const frame = `${WD_ORIGIN}/as-built/review.html`;
  await page.goto(`${WD_ORIGIN}/?bp=blueprint#${frame}`);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  // Named by key now - the one spelling that is never ambiguous.
  await expect.poll(() => new URL(page.url()).searchParams.get('bp')).toBe(key);

  // Move the frame, by picking a screen: the address follows it.
  await page.getByTestId('panel.screen-picker').click();
  await page.getByTestId('panel.screens-list').locator('[data-screen="rule-detail"]').click();
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).hash.slice(1)), { timeout: 10000 })
    .toMatch(new RegExp(`^${WD_ORIGIN}/as-built/rule-detail.html`));

  // Reload: no chooser, the same board, the frame on the same page.
  await page.reload();
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect(page.getByTestId('panel.project')).not.toContainText('Pick a project');
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/as-built/rule-detail.html`)), {
      timeout: 10000,
    })
    .toBe(true);
  expect(new URL(page.url()).searchParams.get('bp')).toBe(key);

  // Open a rule: the address names it, and a reload comes back to it.
  const rule = (await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json()).rows[0].rule;
  await page.getByTestId('panel.rules-list').locator(`[data-rule="${rule}"]`).first().click();
  await expect(page.getByTestId('detail.rule-id')).toHaveText(rule);
  await expect.poll(() => new URL(page.url()).searchParams.get('rule')).toBe(rule);
  await page.reload();
  await expect(page.getByTestId('detail.rule-id')).toHaveText(rule);

  // Back to the list drops it, so the next reload lands on the list - not
  // on the rule you had just left (Topher, 2026-09-18).
  await page.getByTestId('detail.back').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('rule')).toBeNull();
  await page.reload();
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect.poll(() => page.locator('.wdp-track').evaluate((el) => el.style.transform)).toMatch(/translateX\(0%\)/);
  expect(new URL(page.url()).searchParams.get('rule')).toBeNull();

  // The root with a blueprint named and no page: the board opens on its
  // front door, and the address says so - the first trip from the root used
  // to be the last thing written, so a reload came back to an empty sheet
  // (Topher, 2026-09-18).
  await page.goto(`${WD_ORIGIN}/?bp=blueprint`);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/as-built/review.html`)), {
      timeout: 10000,
    })
    .toBe(true);
  await expect.poll(() => decodeURIComponent(new URL(page.url()).hash.slice(1))).toMatch(
    new RegExp(`^${WD_ORIGIN}/as-built/review.html`),
  );
  await page.reload();
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/as-built/review.html`)), {
      timeout: 10000,
    })
    .toBe(true);

  // A blueprint this server does not have is dropped from the address too,
  // rather than carried along as a name that opens nothing (n-0265).
  await page.goto(`${WD_ORIGIN}/?bp=no.such.blueprint#${frame}`);
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('bp')).not.toBe('no.such.blueprint');
});

/*
 * A question's first line is the question, drawn as the headline of its
 * card and its screen (n-0202: two decisions sat for eleven days in the
 * third paragraph of a note). A reply is never headlined; a note's opening
 * message is drawn as before.
 */
test("a question leads with its question, in the list and on its own screen", {
  tag: '@rule:threads.conversation.question-leads-with-the-question',
}, async ({ page }) => {
  const rule = 'threads.conversation.one-stream';
  const ask = 'Should the prompt hand out a port to each judge?';
  const filed = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: { kind: 'question', body: `${ask}\n\nContext: two judges collided on the same port.`, anchor: { rule } },
  });
  expect(filed.ok()).toBeTruthy();
  const { id } = await filed.json();
  expect((await page.request.post(`${WD_ORIGIN}/api/threads/${id}/replies?bp=blueprint`, {
    data: { body: 'Yes, hand one out.\nBecause collisions.', author: 'topher' },
  })).ok()).toBeTruthy();
  const noted = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: { kind: 'note', body: 'The label reads wrong.\n\nOn the second screen.', anchor: { rule } },
  });
  const note = (await noted.json()).id;

  await page.goto(fixtureFor({ bp: 'blueprint' }));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  // Under All: a question on a rule is the rule's to answer and is listed
  // here only among everything (ADR 0006 §3).
  await page.getByTestId('panel.thread-filter').getByText('All', { exact: false }).click();
  const list = page.getByTestId('panel.threads-list');
  const weight = (loc) => loc.evaluate((el) => Number(getComputedStyle(el).fontWeight));
  const size = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  // In the list: the card leads with the question, bolder and larger than
  // the context under it.
  const card = list.locator(`[data-open-thread="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  const cardAsk = card.locator('.wd-ask');
  await expect(cardAsk).toHaveText(ask);
  const cardBody = card.locator('.wd-text > p').first();
  await expect(cardBody).toContainText('Context: two judges');
  expect(await weight(cardAsk)).toBeGreaterThan(await weight(cardBody));
  expect(await size(cardAsk)).toBeGreaterThan(await size(cardBody));
  // A note's card has no headline.
  await expect(list.locator(`[data-open-thread="${note}"]`).first().locator('.wd-ask')).toHaveCount(0);

  // Opened: the same headline on the opening message, and none on the reply.
  await card.click({ position: { x: 8, y: 6 } });
  const body = page.getByTestId('thread.body');
  const asks = body.locator('.wd-ask');
  await expect(asks).toHaveCount(1);
  await expect(asks).toHaveText(ask);
  await expect(body.locator('.wd-msg').first().locator('.wd-ask')).toHaveCount(1);
  await expect(body.locator('.wd-msg').last()).toContainText('Yes, hand one out.');
  await expect(body.locator('.wd-msg').last().locator('.wd-ask')).toHaveCount(0);
});

/*
 * n-0298: an id in a message says what it names before you follow it - a
 * card under the cursor, and under keyboard focus, with the rule's statement
 * and verdict or the thread's status, author and first line. Read at show
 * time from the board, so it says what is true now.
 */
test('an id in a message previews what it names, under the cursor and under focus', {
  tag: '@rule:threads.conversation.one-stream',
}, async ({ page }) => {
  const { rows, threads } = await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json();
  const about = rows.find((r) => r.rule === 'threads.conversation.one-stream');
  // Any thread whose opening line is plain prose, so the card's first line
  // is the body's first words verbatim.
  const other = threads.find((t) => t.anchor?.rule && /^[A-Z][a-z][^`*_[\n]{40}/.test(t.body ?? ''));
  const res = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: {
      kind: 'note',
      // Long enough that the ids sit out of view once the stream opens at
      // its newest message: focus has to scroll them in, and the card
      // has to survive that scroll (n-0299).
      body: `See ${other.id} and ${about.rule} before answering.\n\n${'A line of context.\n\n'.repeat(40)}That is all.`,
      anchor: { rule: about.rule, screen: 'thread-panel' },
    },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();

  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${id}`);
  const body = page.getByTestId('thread.body');
  await expect(body).toContainText(other.id);
  const card = page.getByTestId('ref.preview');
  await expect(card).toBeHidden();

  // At rest, both ids read as links: the thread id wears the same tint as
  // the rule id, not the prose's own colour (n-0299).
  const colour = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
  const threadColour = await colour(body.locator(`[data-thread-ref="${other.id}"]`));
  expect(threadColour).toBe(await colour(body.locator(`[data-rule-ref="${about.rule}"]`)));
  expect(threadColour).not.toBe(await colour(body.locator('.wd-text p').first()));

  // Under the cursor: the thread, as it stands.
  await body.locator(`[data-thread-ref="${other.id}"]`).hover();
  await expect(card).toBeVisible();
  await expect(card).toContainText(other.id);
  await expect(card).toContainText(other.status);
  await expect(card).toContainText(other.body.slice(0, 30));
  // The rule: its statement and where its verdict stands.
  await body.locator(`[data-rule-ref="${about.rule}"]`).hover();
  await expect(card).toContainText(about.rule);
  await expect(card).toContainText(about.verdict);
  await expect(card).toContainText(about.statement.slice(0, 40));
  // Away from any id, no card.
  await page.getByTestId('thread.provenance').hover();
  await expect(card).toBeHidden();

  // Under keyboard focus, the same card - and the ids are out of view, so
  // the browser scrolls them in on the way, which must not take the card
  // with it (n-0299). Escape takes it away.
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => body.locator(`[data-thread-ref="${other.id}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const b = el.closest('[data-testid="thread.body"]').getBoundingClientRect();
    return r.bottom < b.top || r.top > b.bottom;
  })).toBe(true);
  await body.locator(`[data-thread-ref="${other.id}"]`).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(card).toBeVisible();
  await expect(card).toContainText(other.id);
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

/*
 * The composer says whose move it is and offers only that reader's moves
 * (Topher, 2026-09-17: it offered every legal transition to everyone -
 * Addressed beside Verify beside Waive - and read as a control panel with
 * nothing saying which button was yours). Walked from both seats: a
 * person's, which the checks identity declares, and the agent's, stood in
 * for by answering the identity question as a machine would.
 */
test('the composer says whose move it is and offers only that reader’s moves', {
  tag: '@rule:threads.conversation.says-whose-move',
}, async ({ page }) => {
  const rule = 'threads.conversation.says-whose-move';
  /*
   * Off the walk: a thread on a rule the walk can reach is that rule's
   * conversation and ends with the rule's verdict, so Done and Reopen are
   * never offered on it (ADR 0006 §3). The lifecycle this check walks is the
   * one a thread on its own still has - a note on a screen, no rule.
   */
  const anchor = { screen: 'review' };
  const post = async (path, data) => {
    const res = await page.request.post(`${WD_ORIGIN}${path}?bp=blueprint`, { data });
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  // The button row, as a list: toHaveText with an array asserts count and order.
  const actions = page.getByTestId('thread.actions');
  const turn = page.getByTestId('thread.turn');
  const box = page.getByTestId('thread.reply');

  // A person's note, just filed: the agent's move. Nothing here is the
  // person's to press but Reply and Waive - no Done, because there is
  // nothing to accept yet.
  const { id: note } = await post('/api/threads', { kind: 'note', body: 'The label reads wrong.', anchor });
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${note}`);
  await expect(turn).toHaveAttribute('data-party', 'agent');
  await expect(turn).toContainText(/agent.s move/i);
  await expect(turn).toContainText(/hands it back to you/);
  await expect(actions).toHaveText(['Waive', 'Reply']);
  // The person's face is initials on a tile; there is no robot yet.
  await expect(page.getByTestId('thread.body').locator('.wd-msg .wd-ava').first()).toHaveText('AC');
  await expect(page.getByTestId('thread.body').locator('.wd-bot')).toHaveCount(0);

  // The agent claims it. Now it is the person's move: Reopen, Waive, Done -
  // Done last and primary, and Done RECORDS verified, whatever it is called.
  // The agent's reply is its own words, so it is the agent's: the robot in a
  // dashed ring, in the party's blue - the turn line's own.
  await post(`/api/threads/${note}/replies`, { body: 'Fixed the label.', via: 'agent' });
  await post(`/api/threads/${note}/status`, { status: 'addressed', via: 'agent' });
  await page.reload();
  await expect(turn).toHaveAttribute('data-party', 'human');
  await expect(turn).toContainText(/your move/i);
  await expect(actions).toHaveText(['Waive', 'Reopen', 'Done']);
  // Waive stands apart at the far left: a clear gap between it and the next button.
  const [w, r] = await Promise.all([actions.nth(0).boundingBox(), actions.nth(1).boundingBox()]);
  expect(r.x - (w.x + w.width)).toBeGreaterThan(24);
  await expect(page.getByTestId('thread.actions').last()).toHaveAttribute('data-act', 'verified');
  await expect(box).toHaveAttribute('placeholder', /Reopen or Waive/);
  const bot = page.getByTestId('thread.body').locator('.wd-msg .wd-bot');
  await expect(bot).toHaveCount(1);
  expect(await bot.evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed');
  expect(await bot.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%');
  await expect(bot.locator('svg')).toHaveCount(1);
  // No "as <name> · Enter sends" under the box, and no name in the header
  // either: who is recorded was chosen when the walkdown started.
  await expect(page.getByTestId('thread.actor')).toHaveCount(0);
  await expect(page.locator('#wdp-note ~ *')).not.toContainText(/Enter/);

  // Done: the thread is verified, the screen slides back, and the record
  // carries the person - not the word on the button.
  await page.getByTestId('thread.actions').last().click();
  await expect(turn).toHaveCount(0);
  const verified = (await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json())
    .threads.find((t) => t.id === note);
  expect(verified.status).toBe('verified');
  expect(verified.verified_by).toBe('checks-person');
  // Opened again: an ended thread is closed, offers a person Reply and
  // Reopen, and says how it ended and by whom.
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${note}`);
  await expect(turn).toHaveAttribute('data-party', 'closed');
  await expect(turn).toContainText(/Verified by A Checks Person/);
  await expect(actions).toHaveText(['Reply', 'Reopen']);
  // Reopening is append-only: the reason lands as a reply, the status goes
  // back to open, and the acceptance it undoes stays on the file.
  await box.fill('It came back at 375.');
  await page.locator('[data-testid="thread.actions"][data-act="open"]').click();
  await expect(turn).toHaveAttribute('data-party', 'agent');
  const reopened = (await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json())
    .threads.find((t) => t.id === note);
  expect(reopened.status).toBe('open');
  expect(reopened.verified_by).toBe('checks-person');
  expect(reopened.replies.at(-1).body).toBe('It came back at 375.');

  // On a rule the walk can reach, the same addressed note is the rule's
  // conversation: the line says the verdict ends it, and a person is offered
  // Reply and Waive only - the pass is the Done, the fail is the Reopen.
  const { id: onRule } = await post('/api/threads', { kind: 'note', body: 'The label reads wrong here too.', anchor: { rule } });
  await post(`/api/threads/${onRule}/status`, { status: 'addressed', via: 'agent' });
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${onRule}`);
  await expect(turn).toHaveAttribute('data-party', 'human');
  await expect(turn).toContainText(/signed pass ends this conversation/);
  await expect(actions).toHaveText(['Waive', 'Reply']);
  await expect(box).toHaveAttribute('placeholder', /Reply/);

  // A question is the person's move until they answer, and Enter IS the
  // answer: the reply lands and the status moves with it.
  const { id: q } = await post('/api/threads', { kind: 'question', body: 'Which port?', anchor });
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${q}`);
  await expect(turn).toHaveAttribute('data-party', 'human');
  await expect(actions).toHaveText(['Waive', 'Reply', 'Answer']);
  await expect(box).toHaveAttribute('placeholder', /Answer/);
  await box.fill('4730.');
  await box.press('Enter');
  await expect(turn).toHaveAttribute('data-party', 'agent');
  await expect(turn).toContainText(/You answered/);
  await expect(actions).toHaveText(['Waive', 'Reply', 'Reopen']);
  const answered = (await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json())
    .threads.find((t) => t.id === q);
  expect(answered.status).toBe('answered');
  expect(answered.replies.at(-1).body).toBe('4730.');

  // The agent's seat. It is offered its claims and never a person's
  // acceptance: Reply and Done on what waits on it, and Done here RECORDS
  // addressed or incorporated - the same word for its own kind of finished.
  await page.route('**/api/blueprint*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.identity) body.identity = { ...body.identity, username: 'agent', name: '', declared: false };
    await route.fulfill({ response: res, json: body });
  });
  const { id: note2 } = await post('/api/threads', { kind: 'note', body: 'Second label.', anchor });
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${note2}`);
  await expect(turn).toHaveAttribute('data-party', 'agent');
  await expect(turn).toContainText(/your move/i);
  await expect(turn).toContainText(/mark it Done/);
  await expect(actions).toHaveText(['Reply', 'Done']);
  await expect(page.getByTestId('thread.actions').last()).toHaveAttribute('data-act', 'addressed');
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${q}`);
  await expect(actions).toHaveText(['Reply', 'Done']);
  await expect(page.getByTestId('thread.actions').last()).toHaveAttribute('data-act', 'incorporated');
  // And where it is the person's move, or the thread has ended, the agent
  // only talks: a person's acceptance is not a machine's to take back.
  await post(`/api/threads/${note}/status`, { status: 'addressed', via: 'agent' });
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${note}`);
  await expect(actions).toHaveText(['Reply']);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/*
 * Attribution follows the words (2026-09-17). The board had filled with
 * "topher via agent" over paragraphs Topher never wrote; now a relayed
 * message keeps the person's words as typed under their own face, marked,
 * and what the machine added sits apart in a dashed box named as the agent's.
 */
test('a relayed message keeps the person\u2019s face and shows the agent\u2019s addition apart', {
  tag: '@rule:threads.lifecycle.acts-for-a-person',
}, async ({ page }) => {
  const rule = 'threads.lifecycle.acts-for-a-person';
  const res = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: {
      kind: 'note',
      said: 'The toast overlaps the field.',
      added: 'Seen at 375 on the confirmation screen; the rule names the field.',
      via: 'agent',
      anchor: { rule },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { id } = await res.json();
  await page.goto(`${WD_ORIGIN}/?bp=blueprint&thread=${id}`);
  const body = page.getByTestId('thread.body');
  const first = body.locator('.wd-msg').first();
  // The person's face, marked - not the robot.
  await expect(first.locator('.wd-ava')).toHaveText(/AC/);
  await expect(first.locator('.wd-ava.wd-relayed .wd-mark')).toBeVisible();
  await expect(first.locator('.wd-bot')).toHaveCount(0);
  await expect(first.locator('.wd-via')).toHaveText(/via agent/);
  // Their words as typed, and the addition apart, dashed and named.
  await expect(first.locator('.wd-text').first()).toHaveText('The toast overlaps the field.');
  const added = first.locator('.wd-added');
  await expect(added).toContainText('Seen at 375');
  await expect(added.locator('.wd-added-by')).toHaveText(/agent added/i);
  expect(await added.evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed');
  // Collapsed to start - two lines of peek, the whole of it on a press, and
  // back again - so a long addition costs the conversation two lines.
  await expect(added).not.toHaveAttribute('open', /.*/);
  await expect(added.locator('.wd-added-peek')).toBeVisible();
  await expect(added.locator('.wd-added-text')).toBeHidden();
  expect(await added.locator('.wd-added-peek').evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe('2');
  // A caret in the corner points down while closed and up once open.
  const caret = added.locator('.wd-added-caret');
  await expect(caret).toBeVisible();
  expect(await caret.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await added.locator('summary').click();
  await expect(added).toHaveAttribute('open', /.*/);
  await expect(caret).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  await expect(added.locator('.wd-added-text')).toBeVisible();
  await expect(added.locator('.wd-added-peek')).toBeHidden();
  await added.locator('summary').click();
  await expect(added.locator('.wd-added-text')).toBeHidden();
  // The list draws the same message the same way.
  await page.getByTestId('thread.close').click();
  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  // The list opens on what waits on a person; a thread on a rule lives under the rule and is listed here only under All (ADR 0006 §3).
  await page.getByTestId('panel.thread-filter').getByText('All', { exact: false }).click();
  const card = page.getByTestId('panel.threads-list').locator(`[data-open-thread="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.wd-added')).toContainText('Seen at 375');
  await expect(card.locator('.wd-ava.wd-relayed')).toHaveCount(1);
});

/*
 * Whose pointer it is, sheet by sheet (n-0306). Fully faded to the design,
 * the design is what you are looking at, so it is what you can touch - its
 * pins included, whether or not pin mode is armed; pin mode only decides
 * whether a click PLACES one (q-0285). Part-way between, both sheets are on
 * screen at once and neither takes the pointer. Measured by what the
 * document says is under the pointer, not by reading a style back.
 */
test('the surface in front takes the pointer, and mid-fade neither does', {
  tag: '@rule:embed.pin.tooltip-says-what-it-is',
}, async ({ page }) => {
  await review(page);
  const fade = page.getByTestId('panel.fade');
  await expect(fade, 'this screen has a design to fade to').toBeEnabled();
  // Pin mode stays OFF for the whole of this: reaching is not placing.
  await expect(page.getByTestId('panel.pin-mode')).not.toHaveAttribute('aria-pressed', 'true');

  const under = async () => {
    const box = await page.getByTestId('panel.app-frame').boundingBox();
    return page.evaluate(({ x, y }) => {
      // The ghost lives in walkdown's own shadow root; the app frame is in
      // the page. Ask the root first, then the document.
      const root = document.querySelector('[data-walkdown-chrome]')?.shadowRoot;
      const inRoot = root?.elementFromPoint(x, y);
      if (inRoot?.closest?.('[data-walkdown-ghost]')) return 'ghost';
      const el = document.elementFromPoint(x, y);
      if (el?.dataset?.testid === 'panel.app-frame') return 'app';
      return el?.tagName ?? 'nothing';
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  };

  // The slider reads 0 at the design and 100 at the app.
  await fade.fill('0');
  await expect.poll(under, 'fully faded to the design, the design takes the pointer').toBe('ghost');
  await fade.fill('50');
  await expect.poll(under, 'half way, neither sheet takes the pointer').not.toMatch(/^(ghost|app)$/);
  await fade.fill('100');
  await expect.poll(under, 'back on the page, the page takes the pointer').toBe('app');
});

/*
 * The signatures are a grid two dots tall (n-0118): as many columns as the
 * roles need, only as many dots as there are roles, and an odd last dot
 * centred between the rows on the right. Measured from the boxes, since a
 * grid class that resolved to nothing would still be a column.
 */
test('the sign-off dots stand two tall, in as many columns as the roles need', {
  tag: '@rule:panel.rules.tiers-at-a-glance',
}, async ({ page }) => {
  await review(page);
  const stacks = page.getByTestId('panel.rules-list').getByTestId('panel.rule-signoff');
  await stacks.first().waitFor();
  let odd = 0;
  for (const stack of (await stacks.all()).slice(0, 40)) {
    const n = ((await stack.getAttribute('data-signoff')) ?? '').split(' ').filter(Boolean).length;
    expect(Number(await stack.getAttribute('data-columns'))).toBe(Math.ceil(n / 2));
    const boxes = await stack.locator(':scope > span').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height }; }));
    expect(boxes.length, 'one dot per role, no more').toBe(n);
    const rows = new Set(boxes.map((b) => Math.round(b.y)));
    expect(rows.size, 'never taller than two dots').toBeLessThanOrEqual(2);
    if (n % 2 === 1 && n > 1) {
      odd++;
      const last = boxes.at(-1);
      const [top, bottom] = [boxes[0], boxes[1]];
      expect(last.x, 'the lone dot is on the right').toBeGreaterThan(top.x);
      const mid = (top.y + bottom.y + bottom.h) / 2;
      expect(Math.abs(last.y + last.h / 2 - mid), 'centred between the rows').toBeLessThanOrEqual(1.5);
    }
  }
  test.info().annotations.push({ type: 'odd-role-rules-seen', description: String(odd) });
});

/*
 * The strip's bubble on the rule detail hangs DOWN from the strip (n-0307).
 * The strip is the first thing in a pane that scrolls, and a bubble centred
 * on it ran its top rows up out of the pane and under the Recording-as strip,
 * where `checks` and the head of `agent` could not be read.
 */
test('the tiers bubble on a rule stays inside the pane that scrolls it', {
  tag: '@rule:panel.rules.tiers-at-a-glance',
}, async ({ page }) => {
  await review(page);
  await firstRule(page);
  const pane = page.locator('.wdp-detail');
  const strip = pane.getByTestId('panel.rule-tiers').first();
  await strip.hover();
  const tip = strip.getByTestId('panel.rule-tiers-tip');
  await expect.poll(() => tip.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
  const [t, p] = await Promise.all([tip.boundingBox(), pane.boundingBox()]);
  expect(t.y, 'the bubble starts no higher than the pane it is in').toBeGreaterThanOrEqual(p.y - 1);
  expect(t.y + t.height, 'and it ends inside it').toBeLessThanOrEqual(p.y + p.height + 1);
});

/*
 * The legend's ask badges sit beside their sentences, not on them (n-0308).
 * The mark column was sized for one glyph and the badges are wider than
 * that, so each was painted over the first word of its own line.
 */
test('the legend keeps every mark clear of the words beside it', {
  tag: '@rule:panel.rules.legend-on-demand',
}, async ({ page }) => {
  await review(page);
  const legend = page.getByTestId('panel.legend');
  await legend.hover();
  const tip = page.getByTestId('panel.legend-tip');
  await expect.poll(() => tip.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
  const badges = tip.locator('.badge');
  expect(await badges.count(), 'the legend explains the asks').toBeGreaterThan(0);
  for (const badge of await badges.all()) {
    const words = badge.locator('xpath=../following-sibling::span[1]');
    const [b, w] = await Promise.all([badge.boundingBox(), words.boundingBox()]);
    expect(b.x + b.width, `${await badge.textContent()} ends before its sentence starts`).toBeLessThanOrEqual(w.x + 0.5);
  }
});

/*
 * Skip (n-0309, q-0315): a rule set aside for THIS sitting. It leaves the
 * sitting's count, the run records it as skipped, and on the board it is
 * exactly what it was - a skip signs nothing and revokes nothing - so it
 * comes round next sitting. Quieter than Continue, because stepping past is
 * the exception.
 */
test('Skip sets a rule aside for this sitting only: recorded as skipped, unchanged on the board', {
  tag: '@rule:panel.walkdown.one-control-owns-the-sitting',
}, async ({ page }) => {
  const rule = (await session(page)).trim();
  const before = (await payload(page)).rows.find((r) => r.rule === rule);
  const skip = page.getByTestId('panel.skip');
  await expect(skip).toBeEnabled();
  await expect(skip, 'quieter than Continue').not.toHaveClass(/btn-warning/);
  await expect(page.getByTestId('panel.continue')).toHaveClass(/btn-warning/);

  await skip.click();
  await expect(page.getByTestId('panel.judged')).toHaveText(/^\+1\/\d+$/);
  expect((await draft(page)).draft.verdicts[rule]).toBe('skipped');
  // The row wears the sitting's own mark for it.
  await expect(page.getByTestId('panel.rules-list').locator(`[data-rule="${rule}"]`).first()).toContainText('↷');

  await page.getByTestId('panel.walk').click(); // Finish
  await expect(page.getByTestId('panel.actor')).toBeHidden();
  const after = (await payload(page)).rows.find((r) => r.rule === rule);
  expect(after.acceptance, 'a skip signs nothing and revokes nothing').toEqual(before.acceptance);
  expect(after.human?.state).toBe(before.human?.state);
});

/*
 * Continue stays put on a rule that owes a verdict and has none this sitting
 * (n-0327): a fresh sitting pressed Continue a few times and walked the whole
 * board with nothing recorded, which read as skipping without Skip. A verdict
 * or Skip is the only way past; from a judged rule Continue moves again.
 */
test('Continue stays put on an unjudged rule; a skip is the way past', {
  tag: '@rule:panel.walkdown.one-control-owns-the-sitting',
}, async ({ page }) => {
  await review(page);
  await ensureSession(page);
  const list = page.getByTestId('panel.rules-list');
  const owed = list.locator('[data-rule]:has([data-ask])').first();
  await expect(owed, 'a rule owing a verdict to open').toBeVisible();
  const rule = await owed.getAttribute('data-rule');
  await owed.click();
  await expect(page.getByTestId('detail.rule-id')).toHaveText(rule);

  const cont = page.getByTestId('panel.continue');
  await expect(cont, 'no verdict yet, so Continue does not move').toBeDisabled();
  await expect(cont).toHaveAttribute('title', /verdict/);
  await expect(page.getByTestId('panel.skip'), 'Skip is the way past').toBeEnabled();

  await page.getByTestId('panel.skip').click();
  await expect(page.getByTestId('detail.rule-id'), 'a skip moves on').not.toHaveText(rule);
  // Back on the skipped rule, it is judged this sitting, so Continue moves again.
  await page.getByTestId("detail.back").first().click();
  await list.locator(`[data-rule="${rule}"]`).first().click();
  await expect(page.getByTestId('detail.rule-id')).toHaveText(rule);
  await expect(cont, 'judged this sitting, so Continue moves').toBeEnabled();
  await cont.click();
  await expect(page.getByTestId('detail.rule-id')).not.toHaveText(rule);
});

/*
 * A proxy is offered next time, never assumed (q-0314): the name comes back
 * filled in with the box unticked, so signing for Sam again is one tick and
 * signing for Sam by accident is impossible.
 */
test('the last proxy is offered on the next walk, unticked', {
  tag: '@rule:panel.walkdown.who-signs-is-declared',
}, async ({ page }) => {
  await review(page);
  await endSession(page);
  await page.getByTestId('panel.walk').click();
  const product = page.locator('input[data-testid="walkdown.signing.role"][data-role="product"]');
  await expect(product).toBeVisible();
  await product.check();
  const i = await product.getAttribute('data-i');
  const signer = page.locator(`input[data-testid="walkdown.signing.signer"][data-i="${i}"]`);
  await signer.fill('sam');
  await signer.blur();
  await expect(page.getByTestId('walkdown.signing.summary')).toContainText('Signing for sam (product)');
  await page.getByTestId('walkdown.signing.start').click();
  await expect(page.getByTestId('panel.actor')).toBeVisible();
  await expect(page.getByTestId('panel.actor-signing')).toContainText('product for sam');
  await endSession(page); // no verdicts: nothing is recorded

  await page.getByTestId('panel.walk').click();
  await expect(product).toBeVisible();
  await expect(product, 'offered, not assumed').not.toBeChecked();
  await expect(signer).toHaveValue('sam');
  await expect(signer).toBeDisabled();
  await expect(page.locator(`[data-testid="walkdown.signing.offered"]`)).toBeVisible();
  await page.getByTestId('walkdown.signing.cancel').click();
});

/*
 * The board this panel opened is the only one it records against (q-0301).
 * The blueprint's key is its home on disk; a server restarted on the same
 * port for another copy answers with a different one, and a shared browser
 * can hand a judge exactly that (n-0202). Simulated by rewriting the answer,
 * because the panel's half is the same whatever put the other board there.
 */
test('a server answering for another blueprint ends the sitting, out loud', {
  tag: '@rule:panel.walkdown.records-to-ledger',
}, async ({ page }) => {
  await session(page);
  await page.route(/\/api\/blueprint(\?|$)/, async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, key: '/somewhere/else/entirely' } });
  });
  // The other board has no draft of ours - it is another board.
  await page.route(/\/api\/draft(\?|$)/, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { draft: null } }) : route.continue(),
  );
  // session() left the first rule open; its verdict pair arrives a tick later.
  await expect(acceptVerdict(page)).toBeVisible();
  await acceptVerdict(page).click();
  await expect(page.locator('.alert-error')).toContainText(/no longer answering for the blueprint/);
  await expect(page.getByTestId('panel.actor'), 'the sitting is gone').toBeHidden();
  await page.unroute(/\/api\/blueprint(\?|$)/);
  await page.unroute(/\/api\/draft(\?|$)/);
  // Put the server back: the draft written before the answer changed is
  // still on the real board, and the next check must not inherit it.
  await page.reload();
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  const walk = page.getByTestId('panel.walk');
  if (/finish/i.test((await walk.textContent()) ?? '')) {
    await walk.click();
    await expect(walk).not.toHaveText(/finish/i);
  }
});

/*
 * Anchors move; records do not (q-0252). n-0241 was filed against
 * detail.screenshots-modal on 2026-09-07 and the anchor became
 * detail.evidence-modal the same day; the storyboard records the rename.
 */
test('a thread under a renamed anchor shows the name it was filed under, marked renamed', {
  tag: '@rule:screens.anchors.renames-are-recorded',
}, async ({ page }) => {
  // Filed here under the OLD name, the way n-0241 was, so the check does not
  // depend on which threads the fixture happens to carry.
  const res = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: {
      kind: 'note',
      body: 'The modal clips its last row.',
      anchor: { rule: 'panel.rules.evidence-visible', screen: 'rule-detail', element: 'detail.screenshots-modal' },
    },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  const listed = (await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json()).threads;
  expect(listed.some((t) => t.id === id), 'the server lists what it just filed').toBeTruthy();
  await page.goto(fixtureFor({ bp: 'blueprint' }));
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  await page.getByTestId('panel.thread-filter').getByText('All', { exact: false }).click();
  await page.getByTestId('panel.threads-list').locator(`[data-open-thread="${id}"]`).first().click({ position: { x: 8, y: 6 } });
  const mark = page.getByTestId('thread.renamed');
  await expect(mark).toBeVisible();
  const where = mark.locator('xpath=..');
  await expect(where.locator('.font-mono')).toHaveText('detail.screenshots-modal');
  await expect(where).toHaveAttribute('data-tip', 'detail.screenshots-modal → detail.evidence-modal');
});

/*
 * The id copies itself (n-0320), and the toast that says so lands inside
 * the app frame, the same distance from its bottom as from its right, with
 * a size it cannot outgrow (n-0324, n-0325).
 */
test('the rule id copies itself, and the toast sits inside the frame with a cap', {
  tag: ['@rule:panel.rules.detail-slide', '@rule:panel.dock.own-skin'],
}, async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await review(page);
  const rule = (await firstRule(page)).trim();
  await page.getByTestId('detail.rule-id').click();
  const toast = page.getByTestId('panel.toast');
  await expect(toast).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(rule);

  const [t, f] = await Promise.all([toast.boundingBox(), page.getByTestId('panel.app-frame').boundingBox()]);
  const right = f.x + f.width - (t.x + t.width);
  const bottom = f.y + f.height - (t.y + t.height);
  expect(right, 'inside the frame, from the right').toBeGreaterThan(0);
  expect(bottom, 'inside the frame, from the bottom').toBeGreaterThan(0);
  expect(Math.abs(right - bottom), 'the same distance both ways').toBeLessThanOrEqual(2);
  const cap = await toast.evaluate((el) => ({ max: getComputedStyle(el).maxHeight, over: getComputedStyle(el).overflowY }));
  expect(cap.max).not.toBe('none');
  expect(cap.over).toBe('auto');
});

/* Headless is said once, in the Screen block, not twice (n-0321). */
test('a headless rule says so once', {
  tag: '@rule:panel.rules.headless-says-so',
}, async ({ page }) => {
  await review(page);
  await openRule(page, 'status.derived.latest-wins');
  const pane = page.locator('.wdp-detail');
  await expect(page.getByTestId('detail.screen')).toContainText(/judged without one/);
  const text = await pane.innerText();
  expect(text.match(/judged without one/g)?.length ?? 0).toBe(1);
  expect(text).not.toMatch(/Headless —/);
});

/* Check source opens over the desk, in full, with the same lines on GitHub a click away (n-0318). */
test('Check source opens the checks in a modal, with a GitHub link in a new tab', {
  tag: '@rule:panel.rules.evidence-visible',
}, async ({ page }) => {
  await review(page);
  await firstRule(page);
  await page.getByTestId('detail.technical-disclosure').click();
  const modal = page.getByTestId('detail.source-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('pre').first()).toContainText(/test\(|expect\(/);
  const link = modal.getByTestId('detail.source-github').first();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', /github\.com\/[^/]+\/[^/]+\/blob\/[0-9a-f]{40}\/[^#]+#L\d+-L\d+$/);
  await page.getByTestId('detail.source-close').click();
  await expect(modal).toHaveCount(0);
});

/*
 * A question is answered from its own screen as well as from the rule
 * (n-0319): the same choices under the quoted question, Answer sends the
 * pick, Later sends it to the back of the rule's asks.
 */
test('a question on a rule is answerable from its own screen, choices and all', {
  tag: ['@rule:panel.rules.one-conversation', '@rule:threads.question.one-ask'],
}, async ({ page }) => {
  await review(page);
  const res = await page.request.post(`${WD_ORIGIN}/api/threads?bp=blueprint`, {
    data: {
      kind: 'question',
      body: 'Should the legend open upward?',
      anchor: { rule: 'panel.rules.legend-on-demand' },
      options: [{ label: 'Upward', why: 'it is the last row' }, { label: 'Downward' }],
    },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  await page.reload();
  await expect(page.getByTestId('panel.bar')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('panel.tabs').getByText(/Threads/).click();
  await page.getByTestId('panel.thread-filter').getByText('All', { exact: false }).click();
  await page.getByTestId('panel.threads-list').locator(`[data-open-thread="${id}"]`).first().click({ position: { x: 8, y: 6 } });
  const ask = page.getByTestId('thread.ask');
  await expect(ask).toContainText(/legend open upward/);
  await ask.locator('[data-option]').filter({ hasText: 'Upward' }).click();
  await page.getByTestId('thread.actions').filter({ hasText: 'Answer' }).click();
  await expect.poll(async () => (await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json()).threads.find((t) => t.id === id)?.status).toBe('answered');
  const t = (await (await page.request.get(`${WD_ORIGIN}/api/blueprint?bp=blueprint`)).json()).threads.find((x) => x.id === id);
  expect(t.chosen).toBe('Upward');
  expect(t.replies.at(-1).body).toBe('Upward');
  // Folded in, so the rule is a person's again for the checks that follow.
  expect((await page.request.post(`${WD_ORIGIN}/api/threads/${id}/status?bp=blueprint`, { data: { status: 'incorporated', via: 'agent' } })).ok()).toBeTruthy();
});
