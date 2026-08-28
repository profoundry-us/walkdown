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
test.beforeEach(async ({ page }) => { await declaredResolvesHere(page); });

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

test(
  'the actor arrives filled in from the repository identity, and stays editable',
  { tag: '@rule:panel.identity.default-actor' },
  async ({ page }) => {
    await review(page);
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
    await page.getByTestId('panel.walk').click();   // the same control that started it
    await expect(page.getByTestId('panel.actor')).toBeHidden();
  }
}

/** Start a session and open the first rule in the list. */
async function session(page) {
  await review(page);
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
    await review(page);
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
    await review(page);
    await endSession(page);
    const { rows } = await payload(page);
    const rule = rows.find((r) => r.built && r.verify.includes('human')).rule;
    const before = (await payload(page)).rows.find((r) => r.rule === rule).human.state;

    // Discarded: a sitting with nothing judged leaves the ledger as it was.
    await ensureSession(page);
    await page.getByTestId('panel.walk').click();   // the same control that started it
    await expect(page.getByTestId('panel.actor')).toBeHidden();
    expect((await payload(page)).rows.find((r) => r.rule === rule).human.state).toBe(before);

    // Finished: the verdict given in the panel is what the ledger gains.
    await ensureSession(page);
    await openRuleForVerdict(page, rule);
    await page.getByTestId('detail.verdict').locator('button').first().click();
    await expect(page.getByTestId('detail.judged')).toHaveText(/1 judged/);
    await page.getByTestId('panel.walk').click();   // the same control that started it
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
  FIXTURE + `&build=${encodeURIComponent(build)}`;

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
    await review(page);
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
  'choosing a blueprint about another page takes you there',
  { tag: '@rule:panel.rules.takes-you-there' },
  async ({ page }) => {
    // The example blueprint's first screen lives on a host we do not run here.
    // Standing in for it keeps the check about the decision, not the server.
    await page.route('**/index.html', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<h1>The other project</h1>' }));

    await page.goto(fixtureFor({ build: 'stale', bp: '' }));
    // The panel remembers a choice per origin; clear it where it was made.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    // No blueprint declared and two on the server: the panel must ask.
    await expect(page.getByText(/Which blueprint/i)).toBeVisible();
    await page.getByText(/walkdown-example/i).first().click();

    /*
     * walkdown owns the frame, so it simply goes. There is no longer a delivery
     * that has to offer the trip instead: that was the docked panel, which
     * navigating would have unloaded, and it went on 2026-08-26.
     */
    await expect
      .poll(() => page.frames().some((f) => f.url().includes('index.html')), { timeout: 10000 })
      .toBe(true);
  }
);
test(
  'a screen you are already on is not navigated to again',
  { tag: '@rule:panel.rules.takes-you-there' },
  async ({ page }) => {
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
    await expect.poll(() => loads).toBeGreaterThan(0);   // the first load
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
  }
);

test(
  'the frame says it is loading rather than showing the screen you just left',
  { tag: '@rule:panel.rules.takes-you-there' },
  async ({ page }) => {
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
    const held = new Promise((r) => { release = r; });
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
  }
);

test(
  'put away, the badge still crosses between the design and what shipped',
  { tag: '@rule:panel.dock.toolbar' },
  async ({ page }) => {
    // A framed review of a screen that HAS a design on file — there has to be
    // something to cross to for the offer to mean anything.
    const framed = `${WD_ORIGIN}/prototype/screens/review.html`;
    await page.goto(fixtureFor({ build: 'stale', frame: framed }));
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
      .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/stand-in/`)),
        { message: 'the app surface is the walkdown this run started', timeout: 10000 })
      .toBe(true);
    for (const f of page.frames())
      if (f !== page.mainFrame() && /^https?:/.test(f.url()))
        expect(f.url().startsWith(WD_ORIGIN), `a surface off this run's server: ${f.url()}`).toBe(true);

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
        .poll(async () => {
          const win = page.viewportSize();
          const boxes = await Promise.all(
            (await page.locator('iframe').all()).map((f) => f.boundingBox())
          );
          return boxes.length > 0 && boxes.every((b) => b && b.x < 4 && b.y < 4 &&
            b.width > win.width - 4 && b.height > win.height - 4);
        }, { message: 'every surface fills the window the panel gave back' })
        .toBe(true);
    }
  }
);

test(
  'a rule whose fixes all landed can be verified in one pass, under a name',
  { tag: '@rule:panel.threads.claim-never-accept' },
  async ({ page }) => {
    await review(page);
    await endSession(page);
    const { rows, threads } = await payload(page);
    // A rule carrying more than one addressed thread — the pile the sweep is for.
    // It also has to be a rule the list still DRAWS: a retired rule keeps its id
    // so the threads anchored to it stay valid, and can therefore collect a pile
    // like any other, but it has left the report and has no row to open. Which
    // rule qualifies depends on the day's thread statuses, so this picked a
    // retired one the first time a walkdown left one holding two.
    const listed = new Set((rows ?? []).map((r) => r.rule));
    const counts = {};
    for (const t of threads ?? [])
      if (t.status === 'addressed' && t.anchor?.rule) counts[t.anchor.rule] = (counts[t.anchor.rule] ?? 0) + 1;
    const rule = Object.keys(counts).find((r) => counts[r] > 1 && listed.has(r));
    expect(rule, 'need a listed rule with several addressed threads').toBeTruthy();
    const before = counts[rule];

    await openRule(page, rule);
    const sweep = page.getByTestId('detail.threads').getByRole('button', { name: /Verify all/i });
    await expect(sweep).toBeVisible();

    // With no name set it must refuse, exactly as verifying one does: an agent
    // may claim work and never accept it.
    await page.getByTestId('panel.desk-tuner').click();
    await page.getByTestId('settings.actor').fill('');
    await page.getByTestId('panel.desk-tuner').click();
    await sweep.click();
    await expect(page.getByTestId('settings.panel')).toBeVisible();
    expect((await payload(page)).threads.filter(
      (t) => t.anchor?.rule === rule && t.status === 'addressed').length).toBe(before);

    // With a name, the whole pile goes at once — and under that name.
    await page.getByTestId('settings.actor').fill('Test Reviewer');
    await page.getByTestId('panel.desk-tuner').click();
    await sweep.click();
    await expect
      .poll(async () => (await payload(page)).threads.filter(
        (t) => t.anchor?.rule === rule && t.status === 'addressed').length)
      .toBe(0);
  }
);

test(
  'a screen that is a state, not an address, says how to get there',
  { tag: '@rule:panel.rules.setup-says-how-to-arrive' },
  async ({ page }) => {
    /*
     * The example blueprint has the real case: waitlist-already is the
     * confirmation page told apart by a query, so it shares that page's
     * address and the walk lands one step short of the state.
     */
    await page.route('**/index.html', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<h1>The other project</h1>' }));
    await page.goto(FIXTURE + '&bp=&reinjects=0');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByText(/Which blueprint/i)).toBeVisible();
    await page.getByText(/walkdown-example/i).first().click();

    const openRule = async (name) => {
      // The panes slide; the list is off screen while a rule is open.
      const back = page.getByTestId('detail.back');
      // The pane is slid out of the way rather than removed, so waiting on the
      // slide (300ms, panel.js) is what makes the list clickable again.
      if (await back.count()) { await back.click(); await page.waitForTimeout(400); }
      await page.getByTestId('panel.rules-list').locator('button', { hasText: name }).first().click();
      await expect(page.getByTestId('detail.rule-id')).toBeVisible();
    };

    await openRule('already-joined');
    const setup = page.getByTestId('detail.setup');
    await expect(setup).toBeVisible();
    await expect(setup).toContainText(/already on the list/i);

    // Above the steps, because arriving comes before doing.
    const order = await page.getByTestId('detail.steps').evaluate(
      (steps, s) => steps.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING,
      await setup.elementHandle()
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
  }
);

test(
  'threads have a view of their own, ended ones included',
  { tag: '@rule:panel.threads.own-view' },
  async ({ page }) => {
    await review(page);

    /*
     * What the ledger says, before the panel says anything. The count on the
     * tab and the "Awaiting you" filter are both claims about the attention
     * queue, and a check that read them only from the panel could not tell a
     * right answer from a consistent wrong one.
     */
    const bp = await (await page.request.get(`${WD_ORIGIN}/api/blueprint`)).json();
    const owed = new Set((bp.attention ?? [])
      .filter((i) => i.who === 'human' && i.thread).map((i) => i.thread));
    const TERMINAL = ['verified', 'incorporated', 'waived'];
    const ended = bp.threads.filter((t) => TERMINAL.includes(t.status));
    expect(ended.length, 'the fixture blueprint has no ended threads to go back to').toBeGreaterThan(0);

    await page.getByTestId('panel.tabs').getByText(/Threads/).click();
    const list = page.getByTestId('panel.threads-list');
    await expect(list).toBeVisible();

    // Active is what is live — an ended conversation is not in it.
    const gone = ended[0].id;
    await expect(list).not.toContainText(gone);

    // ...and All reaches it, which nothing else in the panel can do.
    const filter = page.getByTestId('panel.thread-filter');
    await filter.getByText('All', { exact: false }).click();
    await expect(list).toContainText(gone);

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
    const shownIds = (await list.locator('[data-open-thread]').evaluateAll(
      (els) => els.map((e) => e.dataset.openThread)));
    expect(new Set(shownIds)).toEqual(owed);

    // The same number rides on the tab, so it is legible from any tab.
    await expect(page.getByTestId('panel.tabs')).toContainText(String(owed.size));

    // A thread opens beside the list, and the way back is the list of threads —
    // not a rule nobody opened.
    const first = list.locator('[data-open-thread]').first();
    const openedId = await first.getAttribute('data-open-thread');
    await first.click();
    const pane = page.getByTestId('thread.panel');
    await expect(pane).toBeVisible();
    await expect(pane.getByTestId('thread.provenance')).toContainText(openedId);
    const back = pane.getByTestId('thread.close');
    await expect(back).toContainText('All threads');
    await back.click();
    await expect(list).toBeVisible();
  }
);

test(
  'the screen picker opens over the design, not underneath it',
  { tag: '@rule:panel.dock.toolbar' },
  async ({ page }) => {
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
      .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/stand-in/review`)),
        { timeout: 10000 })
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
  }
);

test(
  'a screen picked by hand stays picked after the frame lands on it',
  { tag: '@rule:panel.dock.toolbar' },
  async ({ page }) => {
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
      .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/stand-in/rule-detail`)),
        { timeout: 10000 })
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
  }
);

test(
  'Escape leaves pin mode, after whatever is more local than pin mode',
  { tag: '@rule:panel.dock.chrome-not-a-pin-target' },
  async ({ page }) => {
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
  }
);

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

test(
  'the evidence names every tier, and a run\'s screenshots hang under the run that took them',
  { tag: '@rule:panel.rules.evidence-visible' },
  async ({ page }) => {
    await ownRule(page, 'evidence-visible');
    const ev = page.getByTestId('detail.evidence');
    // One line per verify type the rule asks for — the chain of trust, in full.
    await expect(ev).toContainText('checks/local');
    await expect(ev).toContainText('agent');
    await expect(ev).toContainText('human');

    /*
     * The screenshots belong TO the agent's run, so they read as a line under
     * it rather than as a tier of their own standing beside it (n-0100). The
     * link is found by its anchor; only the question "what is the row above
     * this one" needs the DOM.
     */
    const shots = page.getByTestId('detail.screenshots');
    await expect(shots).toBeVisible();
    const above = await shots.evaluate((el) =>
      (el.closest('.evrow')?.previousElementSibling?.textContent ?? '').trim());
    expect(above, 'the screenshots hang under the agent row').toMatch(/^agent/);

    // And they open to be looked at: a count of pictures nobody can see is not
    // evidence, so the check insists the picture actually loaded.
    await shots.click();
    const modal = page.getByTestId('detail.screenshots-modal');
    await expect(modal).toBeVisible();
    await expect
      .poll(() => modal.locator('img').first().evaluate((img) => img.naturalWidth), { timeout: 10000 })
      .toBeGreaterThan(0);

    // Escape puts it away — the most local thing open is the first to close.
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  }
);

test(
  'the steps are read outright and the check source waits behind a disclosure',
  { tag: '@rule:panel.rules.steps-not-an-appendix' },
  async ({ page }) => {
    await ownRule(page, 'steps-not-an-appendix');
    // The steps are the rule: nothing is clicked to read them.
    await expect(page.getByTestId('detail.steps')).toBeVisible();

    const src = page.getByTestId('detail.technical-disclosure');
    await expect(src).toBeVisible();
    await expect(src).toContainText('Check source');
    await expect(src, 'the source is a technical detail, closed until asked for')
      .not.toHaveAttribute('open', /.*/);
    // Closed, it is a summary line and nothing else: the source is not merely
    // scrolled past, it has not been fetched.
    await expect(src).not.toContainText('await ownRule(page,');

    // Opened, it is the source itself — this very check, fetched from the
    // server by the ref the suite carries for this rule.
    await src.locator('summary').click();
    // Generous: opening it is a round trip to the server, which re-derives the
    // whole ledger to answer.
    await expect(src).toContainText('await ownRule(page,', { timeout: 15000 });
  }
);

test(
  'hovering an anchor a step names points at it on the surface',
  { tag: '@rule:panel.rules.steps-not-an-appendix' },
  async ({ page }) => {
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
  }
);

test(
  'the rule list is filtered from a box that stays above it',
  { tag: '@rule:panel.rules.search-the-list' },
  async ({ page }) => {
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
    expect(new Set(shown), 'every rule in the group survives, and only those')
      .toEqual(new Set(inGroup.map((r) => r.rule)));

    // A query naming one rule hides the rest — but not the heading it lives
    // under, or a filtered list would stop saying where anything belongs.
    const one = inGroup[0].rule;
    const leaf = one.slice(group.length + 1);
    await box.fill(leaf);
    await expect(rows).toHaveCount(1, { timeout: 1000 });
    await expect(rows.first()).toHaveAttribute('data-rule', one);
    await expect(list, 'the group heading is still drawn above it')
      .toContainText(storyOf.get(one));

    // A query matching nothing says so rather than showing an empty pane.
    await box.fill('zzz-no-such-rule');
    await expect(rows).toHaveCount(0, { timeout: 1000 });
    await expect(list.getByTestId('panel.rules-empty')).toBeVisible();

    // And emptying the box gives the whole list back.
    await box.fill('');
    await expect(rows).toHaveCount(bp.rows.length, { timeout: 1000 });
  }
);

test(
  'a built rule wears one mark per tier, checks then agent then human',
  { tag: '@rule:panel.rules.tiers-at-a-glance' },
  async ({ page }) => {
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
    const tiersOf = (row) => [
      ['checks', checksTier(row)],
      ['agent', row.agent.state],
      ['human', row.human.state],
    ];
    // Shape carries what happened, with one deliberate exception: a tier the
    // rule never asked for is the same check hollowed out rather than a glyph
    // of its own, so the three marks line up down the list (n-0109). Colour
    // separates it from a real pass. This is the whole vocabulary; a state the
    // panel could draw and this map does not know would fail loudly.
    const GLYPH = {
      pass: '✓', fail: '✗', stale: '~', never: '○', skipped: '–', blocked: '⊘', na: '✓',
      // Sign-off states: the human tier's latest run can be an approval of the
      // wording rather than a verdict on the build, and the tier still owes one.
      approved: '✎', refining: '✎',
    };

    const built = bp.rows.filter((r) => r.built);
    expect(built.length, 'the blueprint has built rules to read').toBeGreaterThan(0);
    const verified = built.filter((r) => r.verdict === 'pass');
    /*
     * Four shapes of the same row, and the last is the point of it: a rule
     * only reaches 'verified' when every tier it asks for holds a current
     * pass, so on a verified rule these marks can be nothing but green or
     * grey. A rule with a tier that failed, never ran or went stale is the one
     * carrying news, and until this row was drawn on unverified rules too
     * there was nowhere to see it.
     */
    const all3 = verified.find((r) => ['checks', 'agent', 'human'].every((v) => r.verify.includes(v)));
    const partial = verified.find((r) => !r.verify.includes('checks'));
    const missing = built.find((r) =>
      tiersOf(r).some(([, state]) => ['fail', 'never', 'stale'].includes(state)));
    /*
     * Sample by the SHAPES the ledger currently offers rather than by naming
     * three it must hold. The rule is about how a row is drawn for whatever
     * states it has, and demanding a fully-verified rule exist made this check
     * depend on the ledger's mood: declaring a sweep empties the agent tier on
     * every rule at once - legitimately, that is what a sweep is for - and the
     * assertion that failed was "the blueprint holds both verified shapes",
     * which is a claim about the fixture and never about the panel.
     *
     * So: every distinct shape present is checked, and at least two must be,
     * because one shape proves nothing about a mark that varies. Each row is
     * still asserted exactly as strictly as before.
     */
    const byShape = new Map();
    for (const r of [all3, partial, missing, ...built].filter(Boolean)) {
      const shape = tiersOf(r).map(([, st]) => st).join('/');
      if (!byShape.has(shape)) byShape.set(shape, r);
    }
    const sample = [...byShape.values()].slice(0, 6);
    expect(byShape.size, 'the blueprint offers more than one shape of row').toBeGreaterThan(1);
    expect(Boolean(missing), 'including one with a tier still owed').toBe(true);

    for (const row of sample) {
      const marks = list.locator(`[data-rule="${row.rule}"]`).getByTestId('panel.rule-tiers');
      await expect(marks, `${row.rule} shows its tiers`).toHaveCount(1);
      await expect(marks.locator('span'), 'always three, never fewer').toHaveCount(3);
      // Always in that order, and each mark is the ledger's own answer for
      // that tier rather than a second reading of it.
      const tiers = tiersOf(row);
      await expect(marks).toHaveAttribute('data-tiers', tiers.map((t) => t.join(':')).join(' '));
      for (const [i, [kind, state]] of tiers.entries()) {
        const mark = marks.locator('span').nth(i);
        await expect(mark).toHaveAttribute('title', new RegExp(`^${kind} `));
        await expect(mark, `${row.rule} ${kind} draws its own shape`)
          .toHaveText(GLYPH[state]);
        // Passed reads green; a tier the rule does not ask for is greyed out.
        // A tier still owed is neither - it is the news this row exists for.
        if (state === 'pass') await expect(mark).toHaveClass(/text-success/);
        if (state === 'na') await expect(mark).toHaveClass(/opacity-20/);
        if (['fail', 'never', 'stale'].includes(state))
          await expect(mark).not.toHaveClass(/text-success/);
      }
    }

    // And a rule that is not built keeps the single lifecycle shape it had:
    // an unbuilt rule has no evidence tiers to report on.
    const unbuilt = bp.rows.find((r) => !r.built);
    await expect(list.locator(`[data-rule="${unbuilt.rule}"]`).getByTestId('panel.rule-tiers'))
      .toHaveCount(0);
  }
);


/* ---- appended for n-0107 (screen picker in Detect mode) ------------------ */

test(
  'in Detect mode the picker reports the page, in the bar and in the open list',
  { tag: '@rule:panel.dock.toolbar' },
  async ({ page }) => {
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
    const app = page.frames().find((f) => f.url().startsWith(`${WD_ORIGIN}/stand-in/review`));
    await app.evaluate(() => { location.href = '/stand-in/settings'; });
    await expect
      .poll(() => page.frames().some((f) => f.url().startsWith(`${WD_ORIGIN}/stand-in/settings`)),
        { timeout: 10000 })
      .toBe(true);

    await expect(picker).toContainText('Settings');
    await expect(list).toBeVisible();
    await expect(detect).toContainText('◉');
    await expect(detect).toContainText('settings');
    await expect(detect).not.toContainText('review');
  }
);

/* ==========================================================================
 * APPENDED BLOCK — added for thread n-0104 (identity vs display name).
 * Kept together at the end of the file so it is easy to move or reconcile
 * with concurrent edits elsewhere in this spec.
 * ========================================================================== */

test(
  'the identity is a username to record under and a full name to show, both editable',
  { tag: '@rule:panel.identity.default-actor' },
  async ({ page }) => {
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
    await expect(handle).toBeVisible();
    const fullName = (await shown.textContent()).trim();
    const username = (await handle.textContent()).trim();
    expect(fullName).not.toBe('set your name…');
    expect(username.length).toBeGreaterThan(0);
    expect(username).not.toContain(' ');       // a handle, not a full name
    expect(username).not.toBe(fullName);

    // Settings shows the same two, in two fields, saying which is which.
    await shown.click();
    const actorField = page.getByTestId('settings.actor');
    const nameField = page.getByTestId('settings.display-name');
    await expect(actorField).toHaveValue(username);
    await expect(nameField).toHaveValue(fullName);

    // The display name is only ever shown: editing it moves the strip's name
    // and leaves the recorded handle exactly where it was.
    await nameField.fill('Someone Else');
    await nameField.blur();
    await expect(shown).toHaveText('Someone Else');
    await expect(handle).toHaveText(username);

    // The username is the record: editing it moves what the sitting is filed
    // under, live, the way the single field always did.
    await shown.click();
    await page.getByTestId('settings.actor').fill('someone');
    await page.getByTestId('settings.actor').blur();
    await expect(handle).toHaveText('someone');
    await expect(shown).toHaveText('Someone Else');

    /*
     * Both fields take an edit from empty, which is the case the split exists
     * for: somebody whose git knows neither has to be able to type both in.
     * Emptying the full name is an answer too - \"show me by my username\" - and
     * then there is one name on the strip rather than two, because the name
     * shown and the name recorded have become the same string.
     */
    await shown.click();
    await page.getByTestId('settings.display-name').fill('');
    await page.getByTestId('settings.display-name').blur();
    await expect(shown).toHaveText('someone');
    await expect(page.getByTestId('panel.actor-handle')).toHaveCount(0);

    // Put a full name back, from empty, and the two are told apart again.
    await shown.click();
    await page.getByTestId('settings.display-name').fill('Someone Else');
    await page.getByTestId('settings.display-name').blur();
    await expect(shown).toHaveText('Someone Else');
    await expect(page.getByTestId('panel.actor-handle')).toHaveText('someone');

    /*
     * And both edits outlive the page. A sitting with no verdicts in it is not
     * restored (that is panel.walkdown.session-survives-reload's business, and
     * it needs a verdict to have something to survive), so the strip is brought
     * back the same way it was raised the first time - what is being checked
     * here is that the identity it comes back under is the edited one.
     */
    await page.reload();
    await expect(page.getByTestId('panel.bar')).toBeVisible();
    await ensureSession(page);
    await expect(page.getByTestId('panel.actor-name')).toHaveText('Someone Else');
    await expect(page.getByTestId('panel.actor-handle')).toHaveText('someone');

    await endSession(page);
  }
);
