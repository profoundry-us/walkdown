/*
 * The harness for a full agent walkdown.
 *
 * What an agent sitting actually costs is not the judging - it is driving the
 * panel into each state and getting a picture of it, which today was eight
 * throwaway scripts before a single rule was judged. That part is the same
 * every time, so it lives here, and the afternoon goes on the part that needs
 * a reader: comparing what is on screen against what the rule says.
 *
 *   node tools/sitting.mjs owed              what the agent tier still owes
 *   node tools/sitting.mjs capture           drive every state, save the evidence
 *   node tools/sitting.mjs record <verdicts.json>   append the run
 *
 * `owed` honours an open sweep: after `walkdown sweep --tiers agent` it lists
 * everything, which is the point of declaring one.
 *
 * Nothing here judges anything. It cannot: a rule says what a reviewer should
 * see, and only a reader can say whether they see it. A harness that scored
 * its own screenshots would be inventing evidence.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveLocations } from '../lib/locations.js';
import { parse } from '../vendor/yaml.js';

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, '..');
const BP = join(ROOT, 'blueprint');
const BASE = process.env.WALKDOWN_SITTING_URL ?? 'http://localhost:4700';

const [cmd, ...rest] = process.argv.slice(2);
const stamp = () =>
  new Date()
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replaceAll(':', '-');

/*
 * `walkdown status` exits non-zero when anything is failing, which is most of
 * the time and is not an error here - we want the report, not the verdict on
 * the report. The JSON is on stdout either way.
 */
const status = () => {
  try {
    return JSON.parse(
      execFileSync('node', [join(ROOT, 'bin/walkdown.js'), 'status', '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
};

/* ---- owed ------------------------------------------------------------- */

function owed() {
  const s = status();
  const sweep = (s.sweeps ?? []).find((x) => x.tier === 'agent');
  const rows = s.rows.filter((r) => (r.verify ?? []).includes('agent'));
  const need = rows.filter((r) => ['never', 'stale', 'fail', 'blocked'].includes(r.agent?.state));
  if (sweep)
    console.log(`sweep ${sweep.runId} — ${sweep.why}\n  ${sweep.done}/${sweep.of} judged since\n`);
  console.log(`${need.length} of ${rows.length} agent-tier rules owed:\n`);
  const byStory = {};
  for (const r of need) (byStory[r.story] ??= []).push(r);
  for (const story of Object.keys(byStory).sort()) {
    console.log(`  ${story}`);
    for (const r of byStory[story]) {
      const screens = [...new Set([...(r.flow ?? []), ...(r.screens ?? [])])];
      console.log(
        `    ${r.agent.state.padEnd(7)} ${r.rule}${screens.length ? `  [${screens.join(' ')}]` : '  [headless]'}`,
      );
    }
  }
  const screens = new Set();
  for (const r of need) for (const x of [...(r.flow ?? []), ...(r.screens ?? [])]) screens.add(x);
  console.log(`\nscreens to capture: ${[...screens].join(', ') || '(none — all headless)'}`);
}

/* ---- capture ---------------------------------------------------------- */

/*
 * Each state is a name and a short script against the live panel. They are
 * data rather than code so the list is the thing you edit when the panel grows
 * a surface, and so `capture` can be asked for one of them by name while you
 * are chasing a single rule.
 *
 * `sr` runs a function inside the panel's shadow root; `wait` is milliseconds.
 */
const STATES = [
  { name: 'panel-review', steps: [] },
  {
    name: 'panel-screens-list',
    steps: [
      ['sr', "r => r.querySelector('#wdp-screen-btn').click()"],
      ['wait', 400],
    ],
  },
  {
    name: 'panel-settings',
    steps: [
      ['sr', "r => r.querySelector('#wdp-desk-btn').click()"],
      ['wait', 400],
    ],
  },
  {
    name: 'panel-pin-mode',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 600],
    ],
  },
  { name: 'panel-tab-blueprints', steps: [['tab', 'blueprints']] },
  { name: 'panel-tab-rules', steps: [['tab', 'rules']] },
  { name: 'panel-tab-threads', steps: [['tab', 'threads']] },
  {
    name: 'panel-rule-detail',
    steps: [
      ['tab', 'rules'],
      ['sr', "r => r.querySelector('[data-rule]').click()"],
      ['wait', 800],
    ],
  },
  {
    name: 'detail-check-source',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.rules.tiers-at-a-glance')?.click()",
      ],
      ['wait', 900],
      [
        'sr',
        "r => { const d = r.querySelector('[data-testid=\"detail.technical-disclosure\"]'); (d?.querySelector('summary') ?? d)?.click(); }",
      ],
      ['wait', 1800],
      [
        'sr',
        "r => r.querySelector('[data-testid=\"detail.technical-disclosure\"]')?.scrollIntoView({ block: 'center' })",
      ],
      ['wait', 400],
    ],
  },
  {
    name: 'detail-screenshots-modal',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.identity.default-actor')?.click()",
      ],
      ['wait', 900],
      [
        'sr',
        "r => (r.querySelector('[data-testid=\"detail.screenshots\"]') ?? [...r.querySelectorAll('button')].find(x => /^open \\d+$/.test(x.textContent.trim())))?.click()",
      ],
      ['wait', 1200],
    ],
  },
  {
    name: 'rules-search-filtered',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => { const q = r.querySelector('input[placeholder*=\"Search\"]'); q.value = 'ghost'; q.dispatchEvent(new Event('input', { bubbles: true })); }",
      ],
      ['wait', 600],
    ],
  },
  {
    name: 'panel-thread-panel',
    steps: [
      ['tab', 'threads'],
      ['sr', "r => r.querySelector('[data-open-thread]')?.click()"],
      ['wait', 900],
    ],
  },
  {
    /* The governance one: with no name set, a verdict must be refused. */
    name: 'refuses-without-a-name',
    steps: [
      ['sr', "r => r.querySelector('#wdp-desk-btn').click()"],
      ['wait', 400],
      [
        'sr',
        "r => { for (const i of r.querySelectorAll('input')) if (/actor|name/i.test(i.dataset.testid ?? '')) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } }",
      ],
      ['wait', 600],
      ['key', 'Escape'],
      ['wait', 400],
      /* The refusal is the panel's own guard, which fires before any POST -
       * but this state runs against the real blueprint, so if that guard ever
       * regresses, the click below would file a real transition. Held, so a
       * regression shows up as a held write instead of as ledger damage. */
      ['no-writes'],
      ['tab', 'threads'],
      /* An OPEN thread offers no Verify - only an addressed one puts the
       * human-only action on screen, so the refusal this state exists to
       * photograph can actually be provoked. The first cut clicked the first
       * thread it saw, found no Verify button, and captured a state that
       * proved nothing. */
      [
        'sr',
        "r => [...r.querySelectorAll('[data-open-thread]')].find((x) => /addressed/.test(x.textContent)).click()",
      ],
      ['wait', 800],
      [
        'sr',
        "r => [...r.querySelectorAll('button')].find(x => /Verify/.test(x.textContent))?.click()",
      ],
      ['wait', 600],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const said = [...r.querySelectorAll('.wd-note, [role=alert], .toast, .alert')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim()); const chip = r.querySelector('[data-testid=\"thread.status\"]'); return { said: said.length ? said : r.textContent.match(/recorded under a person[^.]*\\./)?.slice(0, 1) ?? [], settingsOpened: !!r.querySelector('[data-testid=\"settings.username\"], [data-testid*=actor]'), threadStatusShown: chip ? chip.textContent.trim() : null }; }",
      ],
    ],
  },
  {
    name: 'panel-put-away',
    steps: [
      ['sr', "r => r.querySelector('#wdp-undock').click()"],
      ['wait', 1000],
    ],
  },

  /* ---- the rule pane's own states -------------------------------------- */

  /*
   * The steps expanded with the check source still shut. The disclosure sits
   * below the fold on most rules, so this scrolls to it rather than trusting
   * that a screenshot of the top of the pane says anything about the bottom.
   */
  {
    name: 'rules-steps-and-shut-disclosure',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.rules.tiers-at-a-glance')?.click()",
      ],
      ['wait', 900],
      [
        'sr',
        "r => r.querySelector('[data-testid=\"detail.technical-disclosure\"]')?.scrollIntoView({ block: 'center' })",
      ],
      ['wait', 400],
    ],
  },
  /* The evidence block, scrolled into view - a rule that has all three tiers
   * and a run with screenshots attached, so the bullet under the agent row
   * is in the picture rather than a claim about it. */
  {
    name: 'rules-evidence-block',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.identity.default-actor')?.click()",
      ],
      ['wait', 900],
      [
        'sr',
        "r => r.querySelector('[data-testid=\"detail.evidence\"]')?.scrollIntoView({ block: 'center' })",
      ],
      ['wait', 400],
    ],
  },
  /* The stepper at the top of the list: previous is disabled and says so. */
  {
    name: 'rules-stepper-at-the-start',
    steps: [
      ['tab', 'rules'],
      ['sr', "r => r.querySelector('[data-rule]').click()"],
      ['wait', 900],
      /* "Each control says where it lands": the tips are the saying, and at
       * the first rule the previous arrow must admit there is nowhere to go. */
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const steps = [...r.querySelectorAll('[data-testid=\"detail.stepper\"]')]; const before = r.querySelector('[data-testid=\"detail.rule-id\"]').textContent.trim(); /* read BEFORE clicking - lit updates these buttons in place, so a post-click read reports the NEXT rule's neighbours */ const seen = steps.map((b) => ({ tip: b.closest('.tooltip')?.dataset.tip ?? null, disabled: b.disabled, goesTo: b.dataset.goto || null })); steps.at(-1).click(); return { at: 'first rule', rule: before, steppers: seen }; }",
      ],
      ['wait', 900],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'stepped next', rule: r.querySelector('[data-testid=\"detail.rule-id\"]').textContent.trim(), steppers: [...r.querySelectorAll('[data-testid=\"detail.stepper\"]')].map((b) => ({ tip: b.closest('.tooltip')?.dataset.tip ?? null, disabled: b.disabled })) }; }",
      ],
      /* The stepper promises to follow the rail. The rail's own order is in
       * the DOM, so the two can be held side by side. */
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'order check', railHead: [...r.querySelectorAll('[data-rule]')].slice(0, 5).map((e) => e.dataset.rule), ruleIds: [...r.querySelectorAll('[data-testid=\"detail.rule-id\"]')].map((e) => e.textContent.trim()) }; }",
      ],
    ],
  },
  /* Hovering an anchor a step names lights that element up on the surface.
   * `panel.counts` is one the stand-in review page actually carries. */
  {
    name: 'rules-anchor-hover-highlights',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.rules.counts-legible')?.click()",
      ],
      ['wait', 900],
      [
        'sr',
        "r => { const a = [...r.querySelectorAll('.wdp-anchor')].find(x => x.dataset.anchor === 'panel.counts'); a.scrollIntoView({ block: 'center' }); a.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); }",
      ],
      ['wait', 700],
    ],
  },
  /* A rule with no screen: the desk is covered, in walkdown's own voice. */
  {
    name: 'rules-headless-cover',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'screens.identity.fragment-is-identity')?.click()",
      ],
      ['wait', 1000],
    ],
  },
  /* A rule open, then another tab picked: the tab shows its own content and
   * the rule detail is off the panel's edge rather than on top of it. */
  {
    name: 'rules-open-then-blueprints-tab',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.rules.detail-slide')?.click()",
      ],
      ['wait', 900],
      ['tab', 'blueprints'],
      ['wait', 600],
    ],
  },
  /* A query naming a group keeps every rule in it. */
  {
    name: 'rules-search-by-group',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => { const q = r.querySelector('#wdp-search'); q.value = 'panel.rules'; q.dispatchEvent(new Event('input', { bubbles: true })); }",
      ],
      ['wait', 600],
    ],
  },

  /*
   * Both of these cross to the sibling example blueprint first, because that
   * is the only blueprint here whose storyboard declares a `setup` - the
   * state a rule needs when its screen is a state rather than an address.
   *
   * Each crosses on its own rather than the second inheriting the first's
   * choice: the crossing is remembered in localStorage, but every state
   * reloads the page, and on load the panel asks the server whose blueprint
   * the framed URL belongs to and that answer outranks the memory. So a
   * state that assumed it was still on the example woke up on walkdown's own.
   */
  {
    name: 'rules-setup-block',
    steps: [
      ['tab', 'blueprints'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-pick]')].find(b => b.dataset.pick !== r.querySelector('[data-pick]').dataset.pick && /example/.test(b.dataset.pick))?.click()",
      ],
      ['wait', 2500],
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'waitlist.join.already-joined')?.click()",
      ],
      ['wait', 1200],
    ],
  },
  {
    name: 'rules-setup-absent',
    steps: [
      ['tab', 'blueprints'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-pick]')].find(b => /example/.test(b.dataset.pick))?.click()",
      ],
      ['wait', 2500],
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'waitlist.join.email-required')?.click()",
      ],
      ['wait', 1200],
    ],
  },

  /* ---- the bar: the fade, the picker, the tuner ------------------------- */

  /*
   * The fade is a drag, and these two drive it as one: press the handle, move
   * across the track, photograph part way, and only then let go. Setting
   * `#wdp-fade.value` from a script exercises the handler; it says nothing
   * about whether the handle can be taken hold of at all.
   *
   * The press lands five pixels inside the right edge. On the edge itself it
   * misses the input entirely and the drag does nothing at all, which reads
   * as a broken fade rather than as a missed grab - it cost a whole run once.
   *
   * `aim` only works out where; the pointer is not there until a `hover`, and
   * a `down` before it presses at the corner of the window and drags nothing.
   */
  {
    name: 'dock-fade-drag-midway',
    steps: [
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-fade').getBoundingClientRect(); return { x: b.right - 5, y: b.y + b.height / 2 }; }",
      ],
      ['hover'],
      ['down'],
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-fade').getBoundingClientRect(); return { x: b.x + b.width * 0.75, y: b.y + b.height / 2 }; }",
      ],
      ['hover'],
      ['wait', 300],
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-fade').getBoundingClientRect(); return { x: b.x + b.width * 0.5, y: b.y + b.height / 2 }; }",
      ],
      ['hover'],
      ['wait', 800],
      [
        'probe',
        "(d, fr, fd, fsr, gh) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'still held', fade: r.querySelector('#wdp-fade').value, ghost: !!gh, ghostSrc: gh && gh.src, ghostOpacity: gh && getComputedStyle(gh.parentElement).opacity, appOpacity: fr && getComputedStyle(fr).opacity }; }",
      ],
    ],
  },
  {
    name: 'dock-fade-drag-settled',
    steps: [
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-fade').getBoundingClientRect(); return { x: b.right - 5, y: b.y + b.height / 2 }; }",
      ],
      ['hover'],
      ['down'],
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-fade').getBoundingClientRect(); return { x: b.x + b.width * 0.75, y: b.y + b.height / 2 }; }",
      ],
      ['hover'],
      ['wait', 200],
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-fade').getBoundingClientRect(); return { x: b.x + b.width * 0.5, y: b.y + b.height / 2 }; }",
      ],
      ['hover'],
      ['wait', 400],
      ['up'],
      ['wait', 1200],
      [
        'probe',
        "(d, fr, fd, fsr, gh) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'let go', fade: r.querySelector('#wdp-fade').value, ghost: !!gh, ghostOpacity: gh && getComputedStyle(gh.parentElement).opacity, surfaceButtons: [...r.querySelectorAll('[data-surface]')].map((b) => b.dataset.surface + ' ' + b.className) }; }",
      ],
    ],
  },
  /* A screen chosen by hand, which outranks detection: the picker closes, the
   * frame travels, and the bar's button says the chosen screen. */
  {
    name: 'dock-screen-picked-by-hand',
    steps: [
      ['sr', "r => r.querySelector('#wdp-screen-btn').click()"],
      ['wait', 500],
      ['sr', 'r => r.querySelector(\'[data-screen="rule-detail"]\').click()'],
      ['wait', 2500],
      [
        'probe',
        "(d, fr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const list = r.querySelector('[data-screen]').parentElement; return { button: r.querySelector('#wdp-screen-btn').textContent.replace(/\\s+/g, ' ').trim(), buttonClass: r.querySelector('#wdp-screen-btn').className, pickerShowing: getComputedStyle(list).display, frameSrc: fr.src }; }",
      ],
    ],
  },
  /* The picker open while the page underneath changes: the list is about the
   * page, so it has to follow it rather than keep answering for the page it
   * was opened on. */
  {
    name: 'dock-list-follows-the-page',
    steps: [
      ['sr', "r => r.querySelector('#wdp-screen-btn').click()"],
      ['wait', 500],
      ['top', "(d, fr) => { fr.src = new URL('/stand-in/rule-detail', location.href).href; }"],
      ['wait', 2500],
      [
        'probe',
        "(d, fr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { frameSrc: fr.src, open: !!r.querySelector('[data-screen]'), button: r.querySelector('#wdp-screen-btn').textContent.replace(/\\s+/g, ' ').trim(), marked: [...r.querySelectorAll('[data-screen]')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()).filter((t) => /\\u25c9/.test(t)) }; }",
      ],
    ],
  },
  /*
   * The one kind of navigation nobody announces: history.pushState inside the
   * frame, no reload. Only the embed's slow poll can notice it, so this state
   * is the whole chain photographed - a screen picked by hand first, so the
   * navigation also has a previous-page answer to throw away, then a
   * pushState, then Back. The marker on the frame's window is what proves no
   * reload happened: a full load would tell everyone and prove nothing.
   */
  {
    name: 'spa-pushstate-refollows',
    steps: [
      ['sr', "r => r.querySelector('#wdp-screen-btn').click()"],
      ['wait', 500],
      ['sr', 'r => r.querySelector(\'[data-screen="review"]\').click()'],
      ['wait', 2500],
      [
        'probe',
        "(d, fr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'picked by hand', button: r.querySelector('#wdp-screen-btn').textContent.replace(/\\s+/g, ' ').trim(), buttonClass: r.querySelector('#wdp-screen-btn').className, frameHref: fr.contentWindow.location.href }; }",
      ],
      [
        'top',
        "(d, fr) => { fr.contentWindow.__spaMarker = 'set before pushState'; fr.contentWindow.history.pushState({}, '', '/stand-in/rule-detail'); }",
      ],
      ['wait', 1600],
      [
        'probe',
        "(d, fr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'after pushState', button: r.querySelector('#wdp-screen-btn').textContent.replace(/\\s+/g, ' ').trim(), buttonClass: r.querySelector('#wdp-screen-btn').className, frameHref: fr.contentWindow.location.href, noReload: fr.contentWindow.__spaMarker }; }",
      ],
      ['top', '(d, fr) => { fr.contentWindow.history.back(); }'],
      ['wait', 1600],
      [
        'probe',
        "(d, fr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'after back', button: r.querySelector('#wdp-screen-btn').textContent.replace(/\\s+/g, ' ').trim(), buttonClass: r.querySelector('#wdp-screen-btn').className, frameHref: fr.contentWindow.location.href, noReload: fr.contentWindow.__spaMarker }; }",
      ],
    ],
  },
  /*
   * Pin mode on, and then the panel's own gear pressed with a real pointer.
   * The bar is walkdown's, not the page's, so it must open the tuner and not
   * take a pin - and the click has to be a real one for the same reason the
   * Escape below it does: a synthetic click on the panel never tells you
   * whether the embed would have swallowed the pointer first.
   */
  {
    name: 'dock-chrome-gear-in-pin-mode',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-desk-btn').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }",
      ],
      ['click'],
      ['wait', 800],
      [
        'probe',
        "(d, fr, fd, fsr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { tuner: !!r.querySelector('#wdp-desk-hide'), pinLit: r.querySelector('#wdp-pin').className, formsInTheApp: fsr ? fsr.querySelectorAll('[data-testid=\"pin.form\"]').length : null, placeholders: fsr ? fsr.querySelectorAll('[data-testid=\"pin.placeholder\"]').length : null }; }",
      ],
    ],
  },
  /* Peeking at the desk: the app, the aside and the headless cover all go
   * faint together, so a headless rule is selected first - the cover only
   * exists while one is open, and peeking past a rule that never drew one
   * proves nothing about the rule that did. */
  {
    name: 'desk-peek-on',
    steps: [
      ['tab', 'rules'],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'screens.identity.fragment-is-identity')?.click()",
      ],
      ['wait', 1000],
      ['sr', "r => r.querySelector('#wdp-desk-btn').click()"],
      ['wait', 500],
      ['sr', "r => r.querySelector('#wdp-desk-hide').click()"],
      ['wait', 900],
      [
        'probe',
        "(d, fr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const faint = (e) => e && { opacity: getComputedStyle(e).opacity, box: e.getBoundingClientRect().toJSON() }; return { hideOn: r.querySelector('#wdp-desk-hide').checked, app: faint(fr), aside: faint(r.querySelector('aside')), bar: faint(r.querySelector('#wdp-pin')) }; }",
      ],
    ],
  },
  /*
   * A dial's number, typed. The cell only becomes an input under a real
   * pointer click, so this is one of the few states that cannot be driven
   * through `sr` at all - and the gear above it is opened by pointer too,
   * because Escape goes wherever focus is and focus opened by script is
   * still inside the app frame.
   */
  {
    name: 'desk-tuner-typed',
    steps: [
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-desk-btn').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }",
      ],
      ['click'],
      ['wait', 700],
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-desk-gap').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }",
      ],
      ['click'],
      ['wait', 500],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const cell = r.querySelector('#wdp-desk-gap'); const i = cell.querySelector('input'); return { at: 'clicked', editing: !!i, type: i && i.type, value: i && i.value }; }",
      ],
      // Selected by hand: a number input has no text selection to `select()`,
      // so typing over an opened dial appends to the number already there and
      // the dial's own clamp quietly answers with its maximum.
      ['key', 'ControlOrMeta+a'],
      ['type', '24'],
      ['key', 'Enter'],
      ['wait', 700],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'entered', cell: r.querySelector('#wdp-desk-gap').textContent.trim(), stillEditing: !!r.querySelector('#wdp-desk-gap input'), slider: r.querySelector('input[type=range][data-k=\"gap\"]')?.value }; }",
      ],
    ],
  },
  /* The presets. The window is narrower than 1440, which is what gives
   * zoom-to-fit anything to say: the frame is laid out at the preset and
   * scaled down, and the pill has to say what the scale is. */
  {
    name: 'vp-desktop-1440',
    steps: [
      ['sr', 'r => r.querySelector(\'[data-vp="1440"]\').click()'],
      ['wait', 2000],
      [
        'probe',
        "(d, fr, fd) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { laidOutAt: fd.defaultView.innerWidth, scale: new DOMMatrix(getComputedStyle(fr).transform).a, frameBox: fr.getBoundingClientRect().toJSON(), zoomPill: d.body.querySelector('[data-testid=\"panel.zoom\"]')?.textContent.trim() ?? null, toggle: [...r.querySelectorAll('[data-vp]')].map((b) => b.dataset.vp + ' ' + b.className) }; }",
      ],
    ],
  },
  /*
   * Mobile with the design over it. The slider is inverted - `setFade(1 -
   * value/100)` - so 0 is the design fully on and 100 tears the ghost down
   * altogether. Sliding it to 100 to "show the prototype" leaves nothing to
   * measure and reports, honestly and uselessly, that there is no ghost.
   */
  {
    name: 'vp-mobile-390-ghost',
    steps: [
      ['sr', 'r => r.querySelector(\'[data-vp="390"]\').click()'],
      ['wait', 2000],
      [
        'sr',
        "r => { const f = r.querySelector('#wdp-fade'); f.value = 0; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); }",
      ],
      ['wait', 2500],
      [
        'probe',
        '(d, fr, fd, fsr, gh, gd) => ({ laidOutAt: fd.defaultView.innerWidth, ghost: !!gh, ghostSrc: gh && gh.src, ghostOpacity: gh && getComputedStyle(gh.parentElement).opacity, ghostBox: gh && gh.getBoundingClientRect().toJSON(), ghostLaidOutAt: gd && gd.defaultView.innerWidth, appBox: fr.getBoundingClientRect().toJSON() })',
      ],
    ],
  },

  /* ---- how the panel was delivered -------------------------------------- */

  /*
   * The extension's delivery, imitated: the panel booted from answers on the
   * window rather than from the page it was served by. `config` patches what
   * walkdown's own review page writes, which is the only seam here - there is
   * no docked-by-script-tag delivery to reach for any more. panel.js returns
   * early with "no page to review — the panel needs a frame url", so every
   * state that wants the panel beside a page has to hand it a `frame`.
   */
  {
    /*
     * A server that is not there. Supply the stylesheet: it defaults to
     * `server + '/walkdown.css'`, so pointing the panel at a dead port kills
     * its skin as well as its data, and the first run of this looked like a
     * catastrophic failure when it was only an unstyled page. The extension
     * ships its own copy, so handing one over is the honest simulation.
     */
    name: 'start-no-server',
    config: { server: 'http://localhost:4999', stylesheet: `${BASE}/walkdown.css` },
    steps: [
      ['wait', 2500],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const said = [...r.children].filter((e) => e.tagName !== 'STYLE').map((e) => e.textContent.replace(/\\s+/g, ' ').trim()).join(' ').trim(); return { server: d.defaultView.__walkdownConfig.server, stylesheet: d.defaultView.__walkdownConfig.stylesheet, sheets: r.querySelectorAll('style, link[rel=stylesheet]').length, said: said.slice(0, 400) }; }",
      ],
    ],
  },
  {
    /*
     * The gate: two projects on disk and nothing saying which. `bp` alone is
     * not enough to raise it - the panel asks the server whose blueprint the
     * framed page belongs to and that answer outranks an empty choice - so
     * the frame points at an address neither project claims, which is the
     * situation the gate is actually for.
     */
    name: 'start-choose-blueprint',
    config: { bp: '', frame: { url: `${BASE}/nothing-declares-this` } },
    steps: [
      ['wait', 2500],
      // Read past the stylesheet: it lives in the shadow root too, and the
      // root's own textContent is a few thousand characters of Tailwind
      // before a word the gate actually says.
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const said = [...r.children].filter((e) => e.tagName !== 'STYLE').map((e) => e.textContent.replace(/\\s+/g, ' ').trim()).join(' ').trim(); return { offers: [...r.querySelectorAll('[data-pick]')].map((b) => b.dataset.pick), said: said.slice(0, 300) }; }",
      ],
    ],
  },
  {
    /* Only a delivery that publishes a build hash can be stale: a served
       panel is fetched fresh every load and never claims either way. */
    name: 'delivery-stale-copy-banner',
    config: { buildHash: 'deadbeef0000' },
    steps: [
      ['wait', 2500],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('[data-testid=\"panel.blueprint\"]'); return { carries: d.defaultView.__walkdownConfig.buildHash, blueprintSlot: b && b.textContent.replace(/\\s+/g, ' ').trim(), bar: r.querySelector('#wdp-pin').closest('div').textContent.replace(/\\s+/g, ' ').trim().slice(0, 200) }; }",
      ],
    ],
  },

  /* ---- conversations ----------------------------------------------------- */

  /* `All` is the only filter that reaches a thread which has ended - the
   * other two are about what is still owed. */
  {
    name: 'threads-filter-all',
    steps: [
      ['tab', 'threads'],
      ['sr', 'r => r.querySelector(\'[data-tfilter="all"]\').click()'],
      ['wait', 700],
      // Counted on the rows, not on `[data-open-thread]`: every reply line in
      // the list carries that attribute too, and counting both reports twice
      // as many conversations as the blueprint has.
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { filters: [...r.querySelectorAll('[data-tfilter]')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()), showing: r.querySelectorAll('.wd-row[data-open-thread]').length, statuses: [...r.querySelectorAll('.wd-row[data-open-thread] .badge')].map((b) => b.textContent.trim()) }; }",
      ],
    ],
  },
  /* A long conversation, for the shape of the stream rather than its words:
   * day dividers, a run of messages from one author collapsed into one, and
   * the composer still at the foot with the stream scrolled to the end. */
  {
    name: 'thread-stream-grouped',
    steps: [
      ['tab', 'threads'],
      ['sr', 'r => r.querySelector(\'[data-tfilter="all"]\').click()'],
      ['wait', 500],
      [
        'sr',
        "r => (r.querySelector('[data-open-thread=\"q-0070\"]') ?? r.querySelector('[data-open-thread]')).click()",
      ],
      ['wait', 1200],
      [
        'sr',
        'r => { const b = r.querySelector(\'[data-testid="thread.body"]\'); b.scrollTop = b.scrollHeight; }',
      ],
      ['wait', 500],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const body = r.querySelector('[data-testid=\"thread.body\"]'); const reply = r.querySelector('[data-testid=\"thread.reply\"]'); return { thread: r.querySelector('[data-testid=\"thread.provenance\"]').textContent.replace(/\\s+/g, ' ').trim(), messages: body.querySelectorAll('.wd-msg').length, continuations: body.querySelectorAll('.wd-msg.cont').length, days: [...body.querySelectorAll('.wd-day')].map((e) => e.textContent.trim()), authors: [...body.querySelectorAll('.wd-who')].map((e) => e.textContent.trim()), scrolled: body.scrollTop + ' of ' + body.scrollHeight, composerBox: reply.getBoundingClientRect().toJSON() }; }",
      ],
    ],
  },
  /*
   * A thread that has ended, opened but not touched. Nothing here may set a
   * status - the point is what the panel offers once one is set: no action
   * buttons at all, a footer saying who ended it, and the composer still
   * there, because a finished conversation can still be talked about.
   */
  {
    name: 'thread-terminal-verified',
    steps: [
      ['tab', 'threads'],
      ['sr', 'r => r.querySelector(\'[data-tfilter="all"]\').click()'],
      ['wait', 500],
      [
        'sr',
        "r => [...r.querySelectorAll('.wd-row[data-open-thread]')].find(e => /verified|waived/.test(e.querySelector('.badge:last-of-type')?.textContent ?? ''))?.click()",
      ],
      ['wait', 1200],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const body = r.querySelector('[data-testid=\"thread.body\"]'); return { thread: r.querySelector('[data-testid=\"thread.provenance\"]').textContent.replace(/\\s+/g, ' ').trim(), actions: [...r.querySelectorAll('[data-testid=\"thread.actions\"]')].map((a) => a.dataset.act), footer: body.lastElementChild.textContent.replace(/\\s+/g, ' ').trim(), composer: !!r.querySelector('[data-testid=\"thread.reply\"]'), otherButtonsInThePane: [...r.querySelector('[data-testid=\"thread.panel\"]').querySelectorAll('button')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean) }; }",
      ],
    ],
  },
  /* Shift-Enter breaks the line where Enter would send. Typed rather than
   * assigned: the whole rule is about which keystroke does what. */
  {
    name: 'composer-shift-enter',
    steps: [
      ['no-writes'],
      ['tab', 'threads'],
      ['sr', "r => r.querySelector('[data-open-thread]').click()"],
      ['wait', 1200],
      ['sr', "r => r.querySelector('#wdp-note').focus()"],
      ['type', 'first line'],
      ['key', 'Shift+Enter'],
      ['type', 'second line'],
      ['wait', 500],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const n = r.querySelector('#wdp-note'); return { value: n.value, lines: n.value.split('\\n').length, caret: n.selectionStart, sent: d.defaultView.__held, messages: r.querySelectorAll('[data-testid=\"thread.body\"] .wd-msg').length }; }",
      ],
    ],
  },
  /*
   * A reply the server refuses. It goes up optimistically, so what has to be
   * shown is the recovery: the message marked rather than vanishing, and the
   * words back in the composer to be sent again. Held at 500 - nothing is
   * written, and the record of what would have been sent is beside the
   * picture.
   */
  {
    name: 'composer-refused',
    steps: [
      ['no-writes', 500],
      ['tab', 'threads'],
      ['sr', "r => r.querySelector('[data-open-thread]').click()"],
      ['wait', 1200],
      ['sr', "r => r.querySelector('#wdp-note').focus()"],
      ['type', 'sitting probe — a reply the server will refuse'],
      ['key', 'Enter'],
      ['wait', 1200],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const body = r.querySelector('[data-testid=\"thread.body\"]'); const failed = body.querySelector('.wd-msg.failed'); return { attempted: d.defaultView.__held, failedMessage: failed && failed.textContent.replace(/\\s+/g, ' ').trim(), marks: failed && failed.className, textIsBack: r.querySelector('#wdp-note').value, said: r.querySelector('[data-testid=\"thread.say\"]').textContent.trim() }; }",
      ],
    ],
  },

  /* ---- the page under review, and the pins on it ------------------------ */

  /*
   * Everything above this line photographs the panel. The embed rules are
   * about the other half — what walkdown draws INTO the application, where a
   * reviewer's pointer does the work — so these states use `aim`/`click`/
   * `hover` (a real pointer, which is the only thing that reaches through a
   * frame the way a person does) and `probe` (a measurement saved beside the
   * picture, because "the pin is at 704,616 in the surface's own pixels" is
   * not something a screenshot can be read for).
   *
   * `no-writes` holds every POST to /api/threads and records what it would
   * have sent. A sitting that judged pins by filing them would leave a dozen
   * junk threads in the ledger it exists to keep honest, and the question
   * these rules ask is what gets recorded, not that a file appeared.
   */
  {
    name: 'embed-hover-anchored',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        '(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector(\'[data-testid="panel.rules-list"]\').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + 30 }; }',
      ],
      ['hover'],
      ['wait', 500],
      [
        'probe',
        "(d, fr, fd) => ({ pinning: fd.documentElement.className, lit: [...fd.querySelectorAll('.wd-hover')].map((e) => ({ anchor: e.getAttribute('data-testid'), outline: getComputedStyle(e).outline, cursor: getComputedStyle(e).cursor, box: e.getBoundingClientRect().toJSON() })) })",
      ],
    ],
  },
  {
    name: 'embed-form-below-the-spot',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        '(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector(\'[data-testid="panel.rules-list"]\').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + 20 }; }',
      ],
      ['click'],
      ['wait', 600],
      [
        'probe',
        "(d, fr, fd, fsr) => { const f = fsr.querySelector('[data-testid=\"pin.form\"]'), p = fsr.querySelector('[data-testid=\"pin.placeholder\"]'); const cur = (s) => { const e = f.querySelector(s); return e && getComputedStyle(e).cursor; }; return { surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight }, spot: { x: parseFloat(p.style.left) + 11, y: parseFloat(p.style.top) + 19 }, form: { left: f.style.left, top: f.style.top, box: f.getBoundingClientRect().toJSON() }, element: f.querySelector('b').textContent.trim(), elementBox: fd.querySelector('[data-testid=\"panel.rules-list\"]').getBoundingClientRect().toJSON(), placeholderMark: p.querySelector('.wd-kind').textContent, cursors: { textarea: cur('textarea'), checkbox: cur('input[type=checkbox]'), save: cur('[data-testid=\"pin.save\"]'), cancel: cur('[data-testid=\"pin.cancel\"]') } }; }",
      ],
    ],
  },
  {
    name: 'embed-form-above-near-the-bottom',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        '(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector(\'[data-testid="panel.counts"]\').getBoundingClientRect(); return { x: b.x + e.x + 40, y: b.y + e.y + e.height / 2 }; }',
      ],
      ['click'],
      ['wait', 600],
      [
        'probe',
        "(d, fr, fd, fsr) => { const f = fsr.querySelector('[data-testid=\"pin.form\"]'), p = fsr.querySelector('[data-testid=\"pin.placeholder\"]'); return { surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight }, spot: { x: parseFloat(p.style.left) + 11, y: parseFloat(p.style.top) + 19 }, form: { left: f.style.left, top: f.style.top, box: f.getBoundingClientRect().toJSON() }, element: f.querySelector('b').textContent.trim() }; }",
      ],
    ],
  },
  {
    /* The kind switch, and the proof that the form is UI: clicking its own
       checkbox must toggle the checkbox, not drop a second pin behind it. */
    name: 'embed-form-is-chrome',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        '(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector(\'[data-testid="panel.rules-list"]\').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + 20 }; }',
      ],
      ['click'],
      ['wait', 600],
      [
        'aim',
        '(d, fr, fd, fsr) => { const b = fr.getBoundingClientRect(), e = fsr.querySelector(\'[data-testid="pin.kind"]\').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + e.height / 2 }; }',
      ],
      ['click'],
      ['wait', 500],
      [
        'probe',
        '(d, fr, fd, fsr) => ({ forms: fsr.querySelectorAll(\'[data-testid="pin.form"]\').length, placeholders: fsr.querySelectorAll(\'[data-testid="pin.placeholder"]\').length, kindChecked: fsr.querySelector(\'[data-testid="pin.kind"]\').checked, placeholderMark: fsr.querySelector(\'[data-testid="pin.placeholder"] .wd-kind\').textContent })',
      ],
    ],
  },
  {
    name: 'embed-form-unanchored-spot',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        "(d, fr, fd) => { const b = fr.getBoundingClientRect(), w = fd.defaultView; for (let y = w.innerHeight - 24; y > 24; y -= 12) for (let x = 8; x < 120; x += 8) { const t = fd.elementFromPoint(x, y); if (t && !t.closest('[data-testid]')) return { x: b.x + x, y: b.y + y }; } throw new Error('no unanchored spot on this surface'); }",
      ],
      ['click'],
      ['wait', 600],
      [
        'probe',
        "(d, fr, fd, fsr) => ({ copy: fsr.querySelector('[data-testid=\"pin.form\"]').textContent.replace(/\\s+/g, ' ').trim(), formLeft: fsr.querySelector('[data-testid=\"pin.form\"]').style.left, placeholder: !!fsr.querySelector('[data-testid=\"pin.placeholder\"]') })",
      ],
    ],
  },
  {
    /* The promise the placeholder makes is kept both ways: the form goes, and
       the pin it was promising goes with it. */
    name: 'embed-form-escape-takes-the-placeholder',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        '(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector(\'[data-testid="panel.rules-list"]\').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + 20 }; }',
      ],
      ['click'],
      ['wait', 600],
      [
        'probe',
        "(d, fr, fd, fsr) => ({ at: 'form open', forms: fsr.querySelectorAll('[data-testid=\"pin.form\"]').length, placeholders: fsr.querySelectorAll('[data-testid=\"pin.placeholder\"]').length })",
      ],
      ['key', 'Escape'],
      ['wait', 500],
      [
        'probe',
        "(d, fr, fd, fsr) => ({ at: 'after Escape', forms: fsr.querySelectorAll('[data-testid=\"pin.form\"]').length, placeholders: fsr.querySelectorAll('[data-testid=\"pin.placeholder\"]').length, stillPinning: fd.documentElement.className })",
      ],
    ],
  },
  {
    /* The same spot, filed. Its own state because a screenshot is taken after
       the last step, and a state that saves the form photographs the surface
       with the form already gone. */
    name: 'embed-pin-filed-unanchored',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        "(d, fr, fd) => { const b = fr.getBoundingClientRect(), w = fd.defaultView; for (let y = w.innerHeight - 24; y > 24; y -= 12) for (let x = 8; x < 120; x += 8) { const t = fd.elementFromPoint(x, y); if (t && !t.closest('[data-testid]')) return { x: b.x + x, y: b.y + y }; } throw new Error('no unanchored spot on this surface'); }",
      ],
      ['click'],
      ['wait', 600],
      [
        'top',
        "(d, fr, fd, fsr) => { const t = fsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — unanchored spot'; t.dispatchEvent(new Event('input', { bubbles: true })); fsr.querySelector('[data-testid=\"pin.save\"]').click(); }",
      ],
      ['wait', 1000],
      ['probe', '(d) => d.defaultView.__held'],
    ],
  },
  {
    name: 'embed-pin-filed-anchored',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        '(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector(\'[data-testid="panel.counts"]\').getBoundingClientRect(); return { x: b.x + e.x + 40, y: b.y + e.y + e.height / 2 }; }',
      ],
      ['click'],
      ['wait', 600],
      [
        'top',
        "(d, fr, fd, fsr) => { const t = fsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — anchored on panel.counts'; t.dispatchEvent(new Event('input', { bubbles: true })); fsr.querySelector('[data-testid=\"pin.save\"]').click(); }",
      ],
      ['wait', 1000],
      [
        'probe',
        '(d, fr, fd) => ({ held: d.defaultView.__held, elementBox: fd.querySelector(\'[data-testid="panel.counts"]\').getBoundingClientRect().toJSON(), surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight }, panelWindow: { w: d.defaultView.innerWidth, h: d.defaultView.innerHeight } })',
      ],
    ],
  },
  {
    /* Fully faded to the design: the pin must land on the design, and the
       app behind it must be disarmed rather than taking the click too. */
    name: 'embed-pin-filed-on-the-prototype',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 500],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-surface]')].find(b => b.dataset.surface === 'prototype').click()",
      ],
      ['wait', 3500],
      [
        'probe',
        '(d, fr, fd, fsr, gh, gd) => ({ ghostSrc: gh && gh.src, ghostOpacity: gh && getComputedStyle(gh.parentElement).opacity, ghostArmed: gd && gd.documentElement.className, appArmed: fd.documentElement.className, ghostBox: gh && gh.getBoundingClientRect().toJSON(), appBox: fr.getBoundingClientRect().toJSON() })',
      ],
      [
        'aim',
        '(d, fr, fd, fsr, gh, gd) => { const b = gh.getBoundingClientRect(), e = gd.querySelector(\'[data-testid="panel.counts"]\').getBoundingClientRect(); return { x: b.x + e.x + 40, y: b.y + e.y + e.height / 2 }; }',
      ],
      ['click'],
      ['wait', 600],
      [
        'top',
        "(d, fr, fd, fsr, gh, gd, gsr) => { const t = gsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — on the design'; t.dispatchEvent(new Event('input', { bubbles: true })); gsr.querySelector('[data-testid=\"pin.save\"]').click(); }",
      ],
      ['wait', 1000],
      ['probe', '(d) => d.defaultView.__held'],
    ],
  },
  {
    /* Half-faded there is no honest answer to which surface a pin is about,
       so the control closes and says why. */
    name: 'embed-pin-mid-fade-refused',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 500],
      [
        'sr',
        "r => { const f = r.querySelector('#wdp-fade'); f.value = 50; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); }",
      ],
      ['wait', 2000],
      [
        'probe',
        "(d, fr, fd, fsr, gh, gd) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-pin'); return { disabled: b.disabled, title: b.title, ghostOpacity: gh && getComputedStyle(gh.parentElement).opacity, ghostArmed: gd && gd.documentElement.className, appArmed: fd.documentElement.className }; }",
      ],
    ],
  },
  {
    name: 'embed-pin-filed-at-mobile',
    steps: [
      ['no-writes'],
      ['sr', 'r => r.querySelector(\'[data-vp="390"]\').click()'],
      ['wait', 2000],
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        '(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector(\'[data-testid="panel.bar"]\').getBoundingClientRect(); return { x: b.x + e.x + 40, y: b.y + e.y + e.height / 2 }; }',
      ],
      ['click'],
      ['wait', 600],
      [
        'top',
        "(d, fr, fd, fsr) => { const t = fsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — at a mobile viewport'; t.dispatchEvent(new Event('input', { bubbles: true })); fsr.querySelector('[data-testid=\"pin.save\"]').click(); }",
      ],
      ['wait', 1000],
      [
        'probe',
        '(d, fr, fd) => ({ held: d.defaultView.__held, surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight }, frameBox: fr.getBoundingClientRect().toJSON() })',
      ],
    ],
  },
  {
    /* The surface laid out at 1440 and scaled into an 860px pane: what is
       recorded has to be the surface's own pixels, not the ones on screen. */
    name: 'embed-pin-filed-on-a-scaled-surface',
    steps: [
      ['no-writes'],
      ['sr', 'r => r.querySelector(\'[data-vp="1440"]\').click()'],
      ['wait', 2000],
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'aim',
        '(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector(\'[data-testid="panel.bar"]\').getBoundingClientRect(), s = new DOMMatrix(getComputedStyle(fr).transform).a; return { x: b.x + (e.x + 40) * s, y: b.y + (e.y + e.height / 2) * s }; }',
      ],
      ['click'],
      ['wait', 600],
      [
        'top',
        "(d, fr, fd, fsr) => { const t = fsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — on a scaled surface'; t.dispatchEvent(new Event('input', { bubbles: true })); fsr.querySelector('[data-testid=\"pin.save\"]').click(); }",
      ],
      ['wait', 1000],
      [
        'probe',
        '(d, fr, fd) => ({ held: d.defaultView.__held, scale: new DOMMatrix(getComputedStyle(fr).transform).a, frameBox: fr.getBoundingClientRect().toJSON(), surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight } })',
      ],
    ],
  },
  {
    /* The same pins, measured in the surface's own pixels through a zoom, a
       fade and a window resize. Their spot must not move because the panel
       around them did. */
    name: 'embed-pin-spot-survives-zoom',
    steps: [
      [
        'probe',
        "(d, fr, fd, fsr) => ({ at: 'fit', innerW: fd.defaultView.innerWidth, scale: new DOMMatrix(getComputedStyle(fr).transform).a, pins: Object.fromEntries([...fsr.querySelectorAll('.wd-pin')].map((p) => [p.dataset.thread, [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.top))]])) })",
      ],
      ['sr', 'r => r.querySelector(\'[data-vp="1440"]\').click()'],
      ['wait', 2000],
      [
        'probe',
        "(d, fr, fd, fsr) => ({ at: '1440', innerW: fd.defaultView.innerWidth, scale: new DOMMatrix(getComputedStyle(fr).transform).a, pins: Object.fromEntries([...fsr.querySelectorAll('.wd-pin')].map((p) => [p.dataset.thread, [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.top))]])) })",
      ],
      ['sr', 'r => r.querySelector(\'[data-vp="0"]\').click()'],
      ['wait', 1500],
      [
        'sr',
        "r => { const f = r.querySelector('#wdp-fade'); f.value = 30; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); }",
      ],
      ['wait', 2000],
      [
        'probe',
        "(d, fr, fd, fsr) => ({ at: 'faded', innerW: fd.defaultView.innerWidth, pins: Object.fromEntries([...fsr.querySelectorAll('.wd-pin')].map((p) => [p.dataset.thread, [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.top))]])) })",
      ],
      ['size', [1000, 700]],
      ['wait', 1500],
      [
        'probe',
        "(d, fr, fd, fsr) => ({ at: 'resized', innerW: fd.defaultView.innerWidth, pins: Object.fromEntries([...fsr.querySelectorAll('.wd-pin')].map((p) => [p.dataset.thread, [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.top))]])) })",
      ],
    ],
  },
  {
    name: 'embed-pin-tooltip',
    steps: [
      [
        'aim',
        "(d, fr, fd, fsr) => { const b = fr.getBoundingClientRect(); const p = [...fsr.querySelectorAll('.wd-pin')].find((x) => parseFloat(x.style.top) > 20); const e = p.querySelector('.wd-dot').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + e.height / 2 }; }",
      ],
      ['hover'],
      ['wait', 800],
      [
        'probe',
        "(d, fr, fd, fsr) => { const p = [...fsr.querySelectorAll('.wd-pin')].find((x) => parseFloat(x.style.top) > 20); const t = p.querySelector('[data-testid=\"pin.tip\"]'); const cs = getComputedStyle(t), r = t.getBoundingClientRect(), w = fd.defaultView; return { thread: p.dataset.thread, side: (p.className.match(/tooltip-\\w+/) || [])[0], titleAttribute: p.getAttribute('title'), lines: [...t.children].map((c) => c.textContent.replace(/\\s+/g, ' ').trim()), visible: cs.visibility + ' ' + cs.display + ' opacity ' + cs.opacity, pointerEvents: cs.pointerEvents, box: r.toJSON(), whollyOnSurface: r.left >= 0 && r.top >= 0 && r.right <= w.innerWidth && r.bottom <= w.innerHeight }; }",
      ],
    ],
  },
  {
    /* What walkdown puts in somebody else's document, and what it keeps to
       itself. The count of host stylesheets it adds is the whole rule. */
    name: 'embed-pin-own-skin',
    steps: [
      [
        'probe',
        "(d, fr, fd, fsr) => { const layer = [...fd.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot); const pin = fsr.querySelector('.wd-pin'); const dot = pin.querySelector('.wd-dot'); return { layerIsShadow: !!layer.shadowRoot, layerHasNoSize: layer.getBoundingClientRect().width + 'x' + layer.getBoundingClientRect().height, theme: layer.shadowRoot.querySelector('[data-theme]').dataset.theme, sheetsInShadow: layer.shadowRoot.querySelectorAll('style').length, sheetsAddedToHost: [...fd.querySelectorAll('style')].filter((s) => /wd-hover|wd-pinning|@property/.test(s.textContent)).map((s) => ({ selects: (s.textContent.match(/^[^{@][^{]*/gm) || []).map((x) => x.trim()).filter(Boolean).slice(0, 6), length: s.textContent.length })), pinMarkup: dot.innerHTML.replace(/\\s+/g, ' ').trim(), pinTone: getComputedStyle(dot).color, kindDisc: getComputedStyle(pin.querySelector('.wd-kind')).backgroundColor, kindLetter: pin.querySelector('.wd-kind').textContent }; }",
      ],
    ],
  },
  {
    /* The thread as the panel shows it, with the provenance of a pin that
       carries an element, a spot and the viewport it was placed at. */
    name: 'embed-thread-provenance',
    steps: [
      ['tab', 'threads'],
      [
        'sr',
        "r => (r.querySelector('[data-open-thread=\"n-0107\"]') ?? r.querySelector('[data-open-thread]')).click()",
      ],
      ['wait', 1200],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const prov = r.querySelector('[data-testid=\"thread.provenance\"]'); const body = r.querySelector('[data-testid=\"thread.body\"]'); const where = prov.parentElement.nextElementSibling; const reply = r.querySelector('[data-testid=\"thread.reply\"]'); const acts = [...r.querySelectorAll('[data-testid=\"thread.actions\"]')]; const lh = (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); return { provenance: { text: prov.textContent.replace(/\\s+/g, ' ').trim(), lines: lh(prov), fontSize: getComputedStyle(prov).fontSize, box: prov.getBoundingClientRect().toJSON() }, where: { text: where.textContent.replace(/\\s+/g, ' ').trim(), lines: lh(where), fontSize: getComputedStyle(where).fontSize }, body: { box: body.getBoundingClientRect().toJSON(), overflowY: getComputedStyle(body).overflowY, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, replies: body.querySelectorAll('.wd-msg').length, paneHeight: Math.round(r.querySelector('[data-testid=\"thread.panel\"]').getBoundingClientRect().height), fontSize: getComputedStyle(body.querySelector('.wd-text')).fontSize, first: body.querySelector('.wd-text').textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) }, reply: { placeholder: reply.placeholder, value: reply.value, row: reply.parentElement.textContent.replace(/\\s+/g, ' ').trim() }, actions: acts.map((a) => ({ label: a.textContent.trim(), act: a.dataset.act, top: Math.round(a.getBoundingClientRect().top) })) }; }",
      ],
    ],
  },
  {
    /*
     * One server, two sibling blueprints, and a page that says which of them
     * it belongs to. No panel here on purpose: this is the embed on its own,
     * the way an application carries it, and the question is whether the
     * thread it files goes to that project or to whichever one the server
     * happened to start in.
     */
    name: 'embed-pin-files-against-the-page-project',
    url: '/stand-in/review',
    config: { bp: 'example/blueprint', server: BASE },
    steps: [
      ['no-writes'],
      ['top', '(d) => d.defaultView.walkdownEmbed.setPinMode(true)'],
      ['wait', 400],
      ['aim', '(d) => ({ x: 300, y: 300 })'],
      ['click'],
      ['wait', 600],
      [
        'top',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const t = r.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — which project does this land in'; t.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-testid=\"pin.save\"]').click(); }",
      ],
      ['wait', 1000],
      [
        'probe',
        '(d) => ({ declares: d.defaultView.__walkdownConfig, held: d.defaultView.__held })',
      ],
    ],
  },
  {
    /* The other half of the same rule: a page that declares nothing must go
       on filing against the server's default, exactly as it did before. */
    name: 'embed-pin-files-against-the-default',
    url: '/stand-in/review',
    steps: [
      ['no-writes'],
      ['top', '(d) => d.defaultView.walkdownEmbed.setPinMode(true)'],
      ['wait', 400],
      ['aim', '(d) => ({ x: 300, y: 300 })'],
      ['click'],
      ['wait', 600],
      [
        'top',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const t = r.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — no project declared'; t.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-testid=\"pin.save\"]').click(); }",
      ],
      ['wait', 1000],
      [
        'probe',
        "(d) => ({ declares: d.defaultView.__walkdownConfig ?? null, tagBp: d.querySelector('script[data-walkdown]')?.dataset.bp ?? null, held: d.defaultView.__held })",
      ],
    ],
  },
  {
    /* Judged by making it refuse: waiving is recorded with a reason, so an
       empty reply box must be turned away rather than quietly waiving. */
    name: 'embed-thread-waive-needs-a-reason',
    steps: [
      ['tab', 'threads'],
      ['sr', "r => r.querySelector('[data-open-thread]').click()"],
      ['wait', 1200],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-testid=\"thread.actions\"]')].find((a) => a.dataset.act === 'waived').click()",
      ],
      ['wait', 1000],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const say = r.querySelector('[data-testid=\"thread.say\"]'); return { thread: r.querySelector('[data-testid=\"thread.provenance\"]').textContent.replace(/\\s+/g, ' ').trim(), said: say.textContent.trim(), shown: !say.classList.contains('hidden'), stillOnThread: !!r.querySelector('[data-testid=\"thread.reply\"]') }; }",
      ],
    ],
  },
  /*
   * The rail's legend, opened. It is a hover tooltip, so the picture needs
   * the pointer on it - but the content is in the DOM either way, and the
   * probe reads it whole.
   */
  {
    name: 'rules-legend-open',
    steps: [
      ['tab', 'rules'],
      ['wait', 400],
      [
        'aim',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('[data-testid=\"panel.legend\"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }",
      ],
      ['hover'],
      ['wait', 600],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const tip = r.querySelector('[data-testid=\"panel.legend-tip\"]'); return { visible: getComputedStyle(tip).visibility, lines: tip.textContent.replace(/\\s+/g, ' ').trim() }; }",
      ],
    ],
  },
  /*
   * A thread read up to a point, with replies landing after it: the card has
   * to say how much is new, and opening it has to land the reader at the
   * line. The read-mark is seeded (the state starts as a fresh reviewer, so
   * a real history has to be given to it) and the panel reloaded to read it.
   */
  {
    name: 'threads-new-since-you-looked',
    steps: [
      [
        'top',
        "(d) => { d.defaultView.localStorage.setItem('walkdown:seen:blueprint', JSON.stringify({ 'n-0071': '2026-08-26T00:00:00Z' })); }",
      ],
      ['top', '(d) => d.defaultView.location.reload()'],
      ['wait', 3000],
      ['tab', 'rules'],
      ['wait', 400],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find((e) => e.dataset.rule === 'panel.rules.takes-you-there').click()",
      ],
      ['wait', 900],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const badge = [...r.querySelectorAll('.badge')].find((b) => /new/.test(b.textContent)); return { at: 'collapsed', badge: badge ? badge.textContent.trim() : null }; }",
      ],
      ['sr', "r => r.querySelector('[data-open-thread]').click()"],
      ['wait', 900],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const line = [...r.querySelectorAll('*')].find((e) => e.children.length === 0 && /new/i.test(e.textContent) && e.textContent.trim().length < 30); const body = r.querySelector('[data-testid=\"thread.body\"]'); return { at: 'open', newLine: line ? line.textContent.trim() : null, scrolled: body ? body.scrollTop : null, scrollHeight: body ? body.scrollHeight : null }; }",
      ],
    ],
  },
  /*
   * Crossing to a blueprint that says nothing about this page: the surface
   * has to go to a page the chosen blueprint DOES claim, rather than keep
   * showing one it cannot say anything about.
   */
  {
    name: 'blueprints-crossing-goes-there',
    steps: [
      ['tab', 'blueprints'],
      ['wait', 600],
      [
        'probe',
        "(d, fr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'before', project: r.querySelector('[data-testid=\"panel.blueprint\"]')?.textContent.trim() ?? null, frameSrc: fr.src }; }",
      ],
      [
        'sr',
        "r => [...r.querySelectorAll('input[type=radio], [data-bp], button, [role=radio], .wd-row')].find((x) => /walkdown-example/.test(x.textContent ?? '') || /example/.test(x.dataset?.bp ?? ''))?.click()",
      ],
      ['wait', 3000],
      [
        'probe',
        "(d, fr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'crossed', project: r.querySelector('[data-testid=\"panel.blueprint\"]')?.textContent.trim() ?? null, frameSrc: fr ? fr.src : null, button: r.querySelector('#wdp-screen-btn')?.textContent.replace(/\\s+/g, ' ').trim() ?? null }; }",
      ],
    ],
  },
  /*
   * Swapping surfaces is a fade, not a load: the ghost built for one look is
   * still the same frame on the next. The marker on the ghost's window is the
   * proof - a reload would take it.
   */
  {
    name: 'dock-surface-swap-keeps-the-ghost',
    steps: [
      ['sr', "r => r.querySelector('[data-surface=\"prototype\"]').click()"],
      ['wait', 2000],
      [
        'probe',
        "(d, fr, fd, fsr, gh, gd) => { gd.defaultView.__noReload = 'set on the first look'; return { at: 'prototype', ghostSrc: gh.src, ghostOpacity: getComputedStyle(gh.parentElement).opacity }; }",
      ],
      ['sr', "r => r.querySelector('[data-surface=\"app\"]').click()"],
      ['wait', 800],
      ['sr', "r => r.querySelector('[data-surface=\"prototype\"]').click()"],
      ['wait', 800],
      [
        'probe',
        "(d, fr, fd, fsr, gh, gd) => ({ at: 'back on the prototype', ghostSrc: gh.src, ghostOpacity: getComputedStyle(gh.parentElement).opacity, noReload: gd.defaultView.__noReload })",
      ],
    ],
  },
  /* Escape with no form open: pin mode itself is what stands down. */
  {
    name: 'dock-escape-leaves-pin-mode',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"],
      ['wait', 700],
      [
        'probe',
        "(d, fr, fd, fsr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'pinning', pinCls: r.querySelector('#wdp-pin').className, appArmed: fd.documentElement.className }; }",
      ],
      ['key', 'Escape'],
      ['wait', 700],
      [
        'probe',
        "(d, fr, fd, fsr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'after Escape', pinCls: r.querySelector('#wdp-pin').className, appArmed: fd.documentElement.className }; }",
      ],
    ],
  },
  /*
   * The scratch states. Everything below WRITES - a session finished into the
   * runs ledger, a thread incorporated, a draft discarded - so they run only
   * when asked for by name, against a served scratch copy:
   *
   *   WALKDOWN_SITTING_URL=http://localhost:<scratch> \
   *     node tools/sitting.mjs capture walkdown-session-journey
   *
   * They expect the fixtures a sitting sets up on its copy (an answered
   * pinned question, a proposal-only screen with a thread) - see the
   * walkdown-sitting skill. Left out of the plain full capture on purpose:
   * against the real blueprint they would be exactly the junk-write hazard
   * the no-writes op exists to prevent, and no interceptor is protection
   * enough for a state whose PURPOSE is that the write lands.
   */
  {
    name: 'scratch-settled-pin-leaves',
    scratchOnly: true,
    steps: [
      // Fully onto the design: the pinned fixture question lives on the
      // prototype surface, and pins draw on the surface they belong to.
      ['sr', "r => r.querySelector('[data-surface=\"prototype\"]').click()"],
      ['wait', 2500],
      [
        'probe',
        "(d, fr, fd, fsr, gh, gd, gsr) => { gd.defaultView.__noReload = 'set before incorporating'; return { at: 'pinned', pins: [...gsr.querySelectorAll('.wd-pin')].map((p) => p.dataset.thread), ghostOpacity: getComputedStyle(gh.parentElement).opacity }; }",
      ],
      ['tab', 'threads'],
      ['wait', 600],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-open-thread]')].find((x) => /q-0125/.test(x.textContent)).click()",
      ],
      ['wait', 800],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-testid=\"thread.actions\"]')].find((a) => a.dataset.act === 'incorporated').click()",
      ],
      ['wait', 1500],
      [
        'probe',
        "(d, fr, fd, fsr, gh, gd, gsr) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'incorporated', pins: [...gsr.querySelectorAll('.wd-pin')].map((p) => p.dataset.thread), noReload: gd.defaultView.__noReload, thread: r.querySelector('[data-testid=\"thread.provenance\"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null }; }",
      ],
    ],
  },
  {
    name: 'scratch-sketch-over-the-app',
    scratchOnly: true,
    steps: [
      ['tab', 'threads'],
      ['wait', 600],
      ['sr', "r => [...r.querySelectorAll('button')].find((b) => /All/.test(b.textContent))?.click()"],
      ['wait', 400],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-open-thread]')].find((x) => /n-0126/.test(x.textContent)).click()",
      ],
      ['wait', 800],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('[data-sketch]'); return { at: 'thread open', sketchButton: b ? b.textContent.trim() : null }; }",
      ],
      ['sr', "r => r.querySelector('[data-sketch]').click()"],
      ['wait', 2000],
      [
        'probe',
        "(d, fr, fd, fsr, gh) => { const flag = [...(gh?.parentElement.children ?? [])].find((e) => /Proposed sketch/.test(e.textContent)); return { at: 'sketch shown', ghostSrc: gh && gh.src, badge: flag ? flag.textContent.trim() : null, ghostOpacity: gh && getComputedStyle(gh.parentElement).opacity }; }",
      ],
    ],
  },
  {
    name: 'walkdown-session-journey',
    scratchOnly: true,
    steps: [
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-walk'); return { at: 'before', button: b.textContent.trim(), title: b.title, cls: b.className }; }",
      ],
      ['sr', "r => r.querySelector('#wdp-walk').click()"],
      ['wait', 800],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-walk'); return { at: 'started', button: b.textContent.trim(), title: b.title }; }",
      ],
      // A rule with build evidence, so the pair is Pass/Fail.
      ['tab', 'rules'],
      ['wait', 400],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find((e) => e.dataset.rule === 'embed.pin.anchored-target').click()",
      ],
      ['wait', 900],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const v = r.querySelector('[data-testid=\"detail.verdict\"]'); const stmt = r.querySelector('[data-testid=\"detail.statement\"]'); const fb = r.querySelector('[data-testid=\"detail.feedback\"]'); const judged = r.querySelector('[data-testid=\"detail.judged\"]'); const pane = v.closest('[data-testid=\"detail.pane\"]') ?? r.querySelector('[data-walkdown-chrome]') ?? d.body; return { at: 'rule open in session', buttons: [...v.querySelectorAll('button')].map((b) => b.textContent.trim()), verdictTop: Math.round(v.getBoundingClientRect().top), statementBottom: Math.round(stmt.getBoundingClientRect().bottom), viewportH: d.defaultView.innerHeight, feedbackAboveVerdict: fb.getBoundingClientRect().bottom <= v.getBoundingClientRect().top, judged: judged.textContent.trim() }; }",
      ],
      // Fail with the box empty: refused, with the why named.
      ['sr', "r => r.querySelector('[data-v=\"fail\"]').click()"],
      ['wait', 800],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'fail refused', said: r.querySelector('[data-testid=\"detail.say\"]').textContent.trim(), judged: r.querySelector('[data-testid=\"detail.judged\"]').textContent.trim(), failCls: r.querySelector('[data-v=\"fail\"]').className }; }",
      ],
      // Now with a why: recorded, and the session stays put.
      [
        'sr',
        "r => { const t = r.querySelector('#wdp-vnote'); t.value = 'sitting probe — the why a fail owes, filed as a note'; t.dispatchEvent(new Event('input', { bubbles: true })); }",
      ],
      ['sr', "r => r.querySelector('[data-v=\"fail\"]').click()"],
      ['wait', 1500],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'fail recorded', rule: r.querySelector('[data-testid=\"detail.rule-id\"]').textContent.trim(), failCls: r.querySelector('[data-v=\"fail\"]').className, judged: r.querySelector('[data-testid=\"detail.judged\"]').textContent.trim() }; }",
      ],
      // Pass on the next rule: the session moves on by itself.
      ['sr', "r => [...r.querySelectorAll('[data-testid=\"detail.stepper\"]')].at(-1).click()"],
      ['wait', 900],
      ['sr', "r => r.querySelector('[data-v=\"pass\"]').click()"],
      ['wait', 1200],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'pass advanced', nowOn: r.querySelector('[data-testid=\"detail.rule-id\"]')?.textContent.trim() ?? '(list)', judged: r.querySelector('[data-testid=\"detail.judged\"]')?.textContent.trim() }; }",
      ],
      // The draft is on the project, not only in this tab.
      [
        'probe',
        "async (d) => { const res = await fetch('/api/draft?bp=blueprint&target=local'); return { at: 'draft on disk', draft: await res.json() }; }",
      ],
      // A reload, and the session comes back from what was written down.
      ['top', '(d) => d.defaultView.location.reload()'],
      ['wait', 3500],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-walk'); return { at: 'after reload', button: b.textContent.trim(), title: b.title }; }",
      ],
      // Finish, named: the record is appended - the ledger side is counted
      // on disk by the sitting reading this state's output.
      ['sr', "r => r.querySelector('#wdp-walk').click()"],
      ['wait', 2000],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-walk'); return { at: 'finished', button: b.textContent.trim(), said: r.textContent.match(/[Rr]ecorded[^.]*\\./)?.[0] ?? null }; }",
      ],
    ],
  },
  {
    name: 'walkdown-session-discard',
    scratchOnly: true,
    steps: [
      ['sr', "r => r.querySelector('#wdp-walk').click()"],
      ['wait', 600],
      ['tab', 'rules'],
      ['wait', 400],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find((e) => e.dataset.rule === 'embed.pin.tooltip-says-what-it-is').click()",
      ],
      ['wait', 900],
      ['sr', "r => r.querySelector('[data-v=\"pass\"]').click()"],
      ['wait', 1200],
      [
        'probe',
        "async (d) => { const res = await fetch('/api/draft?bp=blueprint&target=local'); return { at: 'one verdict drafted', draft: await res.json() }; }",
      ],
      /*
       * The Discard control lives on the blueprint-crossing ask, and a
       * scratch serves one blueprint - so the state exercises the same call
       * that control makes (discardSitting: POST /api/draft {discard:true}),
       * and the run ledger is counted on disk before and after by the
       * sitting reading this.
       */
      [
        'probe',
        "async (d) => { await fetch('/api/draft?bp=blueprint', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'local', discard: true }) }); const res = await fetch('/api/draft?bp=blueprint&target=local'); return { at: 'after discard', draft: await res.json() }; }",
      ],
    ],
  },
  /*
   * The sign-off pair, driven on rules the scratch ledger holds no build
   * evidence for: Approve and Refine where Pass and Fail would be, Refine
   * refused empty, an approval that advances - and a Finish whose record
   * carries `approved`, checked on the scratch's disk by the sitting.
   */
  {
    name: 'signoff-journey',
    scratchOnly: true,
    steps: [
      ['sr', "r => r.querySelector('#wdp-walk').click()"],
      ['wait', 600],
      ['tab', 'rules'],
      ['wait', 400],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find((e) => e.dataset.rule === 'panel.delivery.absent-until-asked').click()",
      ],
      ['wait', 900],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const v = r.querySelector('[data-testid=\"detail.verdict\"]'); return { at: 'unbuilt pair', buttons: [...v.querySelectorAll('button')].map((b) => b.textContent.trim()), underline: v.nextElementSibling?.textContent.trim() ?? null, placeholder: r.querySelector('[data-testid=\"detail.feedback\"]').placeholder }; }",
      ],
      ['sr', "r => r.querySelector('[data-v=\"refining\"]').click()"],
      ['wait', 800],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'refine refused empty', said: r.querySelector('[data-testid=\"detail.say\"]').textContent.trim(), judged: r.querySelector('[data-testid=\"detail.judged\"]').textContent.trim() }; }",
      ],
      [
        'sr',
        "r => { const t = r.querySelector('#wdp-vnote'); t.value = 'sitting probe — what should change about the wording'; t.dispatchEvent(new Event('input', { bubbles: true })); }",
      ],
      ['sr', "r => r.querySelector('[data-v=\"refining\"]').click()"],
      ['wait', 1500],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'refined, stays put', rule: r.querySelector('[data-testid=\"detail.rule-id\"]').textContent.trim(), judged: r.querySelector('[data-testid=\"detail.judged\"]').textContent.trim() }; }",
      ],
      ['sr', "r => r.querySelector('[data-testid=\"detail.back\"]').click()"],
      ['wait', 600],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find((e) => e.dataset.rule === 'panel.delivery.one-switch').click()",
      ],
      ['wait', 900],
      /* The next rule inherits a visibly empty box or the stale-why defect
       * fires here too - the probe records what the box holds either way. */
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'next rule box', rule: r.querySelector('[data-testid=\"detail.rule-id\"]').textContent.trim(), boxValue: r.querySelector('[data-testid=\"detail.feedback\"]').value }; }",
      ],
      [
        'sr',
        "r => { const t = r.querySelector('#wdp-vnote'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); }",
      ],
      ['sr', "r => r.querySelector('[data-v=\"approved\"]').click()"],
      ['wait', 1200],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'approved advanced', nowOn: r.querySelector('[data-testid=\"detail.rule-id\"]')?.textContent.trim() ?? '(list)', judged: r.querySelector('[data-testid=\"detail.judged\"]')?.textContent.trim() ?? null }; }",
      ],
      ['sr', "r => r.querySelector('#wdp-walk').click()"],
      ['wait', 2000],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return { at: 'finished', button: r.querySelector('#wdp-walk').textContent.trim() }; }",
      ],
    ],
  },
  /*
   * Finish reads the name the sitting was STARTED under - emptying Settings
   * mid-session changes nothing, by design - so the refusal can only be
   * provoked by starting nameless. This state leaves its refused session as
   * a draft on the scratch; the scratch is taken away at the end of the
   * sitting, so nothing outlives it.
   */
  {
    name: 'walkdown-finish-refused-nameless',
    scratchOnly: true,
    steps: [
      ['sr', "r => r.querySelector('#wdp-desk-btn').click()"],
      ['wait', 400],
      [
        'sr',
        "r => { for (const i of r.querySelectorAll('input')) if (/actor|name/i.test(i.dataset.testid ?? '')) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } }",
      ],
      ['key', 'Escape'],
      ['wait', 400],
      ['sr', "r => r.querySelector('#wdp-walk').click()"],
      ['wait', 600],
      ['tab', 'rules'],
      ['wait', 400],
      [
        'sr',
        "r => [...r.querySelectorAll('[data-rule]')].find((e) => e.dataset.rule === 'embed.pin.own-skin').click()",
      ],
      ['wait', 900],
      ['sr', "r => r.querySelector('[data-v=\"pass\"]').click()"],
      ['wait', 1000],
      ['sr', "r => r.querySelector('#wdp-walk').click()"],
      ['wait', 1000],
      [
        'probe',
        "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-walk'); return { at: 'finish refused nameless', button: b.textContent.trim(), toast: r.textContent.match(/recorded under a person[^.]*\\./)?.[0] ?? null, settingsOpen: !!r.querySelector('[data-testid=\"settings.actor\"]') }; }",
      ],
    ],
  },
];

/** This machine's evidence root, falling back to the blueprint's own. */
function evidenceRoot() {
  try {
    return resolveLocations({ dir: BP }).evidence.path;
  } catch {
    return join(BP, 'runs', 'evidence');
  }
}

async function capture(only = []) {
  const { chromium } = await import('@playwright/test');
  const ts = stamp();
  /*
   * Ask where evidence goes rather than assuming the blueprint - it does not
   * necessarily live in the repository (docs/08-locations.md). The ledger
   * still records `runs/evidence/<ts>/…`, which is a logical key the server
   * resolves per machine, so a moved evidence root needs no run record edited.
   */
  const dir = join(evidenceRoot(), ts);
  mkdirSync(dir, { recursive: true });

  /*
   * The storyboard is the only thing that may say where a screen lives - never
   * a URL written here. Parsed rather than pattern-matched, because the first
   * version of this read walkdown.yml for screens that live in storyboard.yml
   * and silently captured no design at all.
   */
  const cfg = parse(readFileSync(join(BP, 'walkdown.yml'), 'utf8'));
  const board = parse(readFileSync(join(BP, 'storyboard.yml'), 'utf8'));
  const protoRoot = String(cfg?.prototype?.root ?? 'prototype/').replace(/\/$/, '');
  const screens = (board?.screens ?? [])
    .filter((s) => s?.id && s.prototype && !s.retired)
    .map((s) => ({ id: s.id, path: s.prototype }));

  const browser = await chromium.launch();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
    pg.on('console', (m) => {
      if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`);
    });
    return pg;
  };
  let page = watch(await browser.newPage({ viewportSize: { width: 1280, height: 760 } }));
  const home = page;

  // The design first: what every judgment is made against.
  for (const s of screens) {
    const url = `${BASE}/${protoRoot}${s.path}`;
    const res = await page.goto(url, { waitUntil: 'load' }).catch(() => null);
    if (!res?.ok()) {
      console.log(`  proto-${s.id}: ${res?.status() ?? 'unreachable'} — skipped`);
      continue;
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(dir, `proto-${s.id}.png`) });
    console.log(`  proto-${s.id}.png`);
  }

  const inSr = (body) =>
    page.evaluate((src) => {
      const root = [...document.querySelectorAll('[data-walkdown-chrome]')].find(
        (e) => e.shadowRoot,
      )?.shadowRoot;
      if (!root) throw new Error('the panel has no shadow root — did it boot?');
      return new Function('root', `return (${src})(root)`)(root);
    }, body);

  /*
   * The same thing for the page under review. `sr` reaches the panel; this
   * reaches everything else a state might need to measure - this document, the
   * app frame and the design ghosted over it, and the shadow root the embed
   * draws its pins into inside each. Handed over as arguments rather than
   * looked up in every state, because the lookup for the ghost is a walk
   * through shadow roots and writing it fifteen times is how one of them ends
   * up subtly different from the others.
   */
  const inTop = (body) =>
    page.evaluate((src) => {
      const fr = document.querySelector('[data-testid="panel.app-frame"]');
      const found = [];
      const walk = (n) => {
        for (const e of n.querySelectorAll('*')) {
          if (e.tagName === 'IFRAME') found.push(e);
          if (e.shadowRoot) walk(e.shadowRoot);
        }
      };
      walk(document);
      const gh = found.find((f) => f !== fr) ?? null;
      const shadow = (f) => {
        const doc = f?.contentDocument;
        return doc
          ? ([...doc.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot)
              ?.shadowRoot ?? null)
          : null;
      };
      return new Function(
        'd',
        'fr',
        'fd',
        'fsr',
        'gh',
        'gd',
        'gsr',
        `return (${src})(d, fr, fd, fsr, gh, gd, gsr)`,
      )(
        document,
        fr,
        fr?.contentDocument ?? null,
        shadow(fr),
        gh,
        gh?.contentDocument ?? null,
        shadow(gh),
      );
    }, body);

  for (const state of STATES) {
    if (only.length && !only.includes(state.name)) continue;
    // The writing states run only when asked for by name, against a scratch
    // copy - a full sweep against the real blueprint must never reach them.
    if (state.scratchOnly && !only.length) continue;
    /*
     * Almost every state is the panel at the server's front door. `url` is for
     * the handful that are not - a page carrying the embed and no panel, which
     * is how an application under the browser extension is reviewed - and
     * `config` is what that delivery leaves on the window instead of a script
     * tag, so a state can be a page that declares which project it belongs to.
     *
     * It is a PATCH, not a replacement: walkdown's own review page assigns
     * `__walkdownConfig` itself on the way to loading the panel, so a plain
     * assignment here is overwritten a moment later and the state captures
     * the ordinary front door. Held behind an accessor, the page's answers
     * arrive and the state's few overrides survive them - which is the only
     * way to boot the panel here the way the extension boots it, pointed at
     * a server that is not this one or carrying a build hash of its own.
     */
    if (state.config) {
      // Its own tab, and thrown away after: an init script cannot be taken
      // back, and one state's config leaking into every state after it would
      // be the hardest kind of wrong answer to notice.
      page = watch(await browser.newPage({ viewportSize: { width: 1280, height: 760 } }));
      await page.addInitScript((c) => {
        let held = c;
        Object.defineProperty(window, '__walkdownConfig', {
          configurable: true,
          get: () => held,
          set: (v) => {
            held = { ...v, ...c };
          },
        });
      }, state.config);
    }
    /*
     * Each state starts as a fresh reviewer. The refusal states EMPTY the
     * identity to prove the panel refuses attributed work - and since the
     * emptied-name fix (2026-08-28, "an emptied name is an answer"), that
     * emptiness survives reloads by design. Left in place it bled into every
     * state after the first refusal, and a whole sitting's pins were refused
     * by a guard doing its job on the wrong state's answer. The panel's own
     * storage keys are cleared, never git's answers - a fresh reviewer is
     * the machine's default identity, not nobody.
     */
    await page.goto(state.url ? BASE + state.url : BASE, { waitUntil: 'load' });
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage))
        if (k.startsWith('walkdown:')) localStorage.removeItem(k);
    });
    await page.goto(state.url ? BASE + state.url : BASE, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    let spot = null;
    const probes = [];
    for (const [op, arg] of state.steps) {
      if (op === 'sr') await inSr(arg);
      else if (op === 'tab')
        await inSr(`r => r.querySelector('[role=tab][data-tab=${arg}]').click()`);
      else if (op === 'key') await page.keyboard.press(arg);
      else if (op === 'wait') await page.waitForTimeout(arg);
      else if (op === 'top') await inTop(arg);
      else if (op === 'probe') probes.push(await inTop(arg));
      else if (op === 'aim') spot = await inTop(arg);
      else if (op === 'hover') await page.mouse.move(spot.x, spot.y);
      else if (op === 'click') await page.mouse.click(spot.x, spot.y);
      /*
       * A press held across several `aim`/`hover` pairs is a drag. Kept as
       * three ops rather than one `drag` because what a drag has to prove is
       * what happens PART WAY through it, and a state can only photograph
       * that if it can stop in the middle.
       */ else if (op === 'down') await page.mouse.down();
      else if (op === 'up') await page.mouse.up();
      // Typing where focus already is - the panel's dial editors and the
      // composer both care that a real keystroke arrived, not that a value
      // was assigned.
      else if (op === 'type') await page.keyboard.type(arg);
      else if (op === 'size') await page.setViewportSize({ width: arg[0], height: arg[1] });
      /*
       * Hold every thread this state would file, and remember what it asked
       * for. These rules are about what a pin RECORDS, and a sitting that
       * answered that by filing a dozen throwaway threads would be writing
       * junk into the ledger it exists to keep honest.
       *
       * `['no-writes', 500]` answers refused instead of held, which is the
       * only way to photograph what the panel does with a reply the server
       * would not take. Matched on a substring rather than a route glob on
       * purpose: every call the panel makes carries `?bp=`, and a glob ending
       * in `/api/threads` matches none of them - a miss that filed real junk
       * threads twice in one night before it was noticed.
       */ else if (op === 'no-writes')
        await page.evaluate((status) => {
          window.__held = [];
          const real = window.fetch;
          window.fetch = (u, o) => {
            if (o?.method !== 'POST' || !String(u).includes('/api/threads')) return real(u, o);
            window.__held.push({ url: String(u), body: JSON.parse(o.body) });
            const body = status
              ? { error: 'held by the sitting harness' }
              : { id: 'n-HELD', thread: {} };
            return Promise.resolve(
              new Response(JSON.stringify(body), {
                status: status ?? 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          };
        }, arg ?? null);
      if (op === 'tab') await page.waitForTimeout(500);
    }
    await page.screenshot({ path: join(dir, `${state.name}.png`) });
    console.log(`  ${state.name}.png`);
    // A measurement is evidence too, and it goes beside the picture it explains.
    if (probes.length) {
      writeFileSync(
        join(dir, `${state.name}.json`),
        JSON.stringify(probes.length === 1 ? probes[0] : probes, null, 2) + '\n',
      );
      console.log(`  ${state.name}.json`);
    }
    await page.setViewportSize({ width: 1280, height: 760 });
    if (page !== home) {
      await page.close();
      page = home;
    }
  }
  await browser.close();

  console.log(`\nevidence: ${dir}  (recorded as runs/evidence/${ts}/)`);
  console.log(
    errors.length
      ? `\n${errors.length} PAGE ERROR(S):\n  ${errors.join('\n  ')}`
      : '\nno page errors in any state',
  );
  writeFileSync(join(dir, 'errors.txt'), errors.join('\n') + '\n');
  return ts;
}

/* ---- record ----------------------------------------------------------- */

/*
 * Takes the verdicts a sitting reached and appends the run. Every result must
 * carry its own reasoning: a pass with nothing said about it is the thing this
 * ledger exists to make impossible.
 */
function record(file) {
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const s = status();
  const bad = [];
  for (const r of input.results ?? []) {
    if (!r.reasoning || r.reasoning.trim().length < 40) bad.push(`${r.rule}: reasoning too thin`);
    if (!['pass', 'fail', 'blocked', 'skipped'].includes(r.status))
      bad.push(`${r.rule}: bad status`);
    if (!(r.evidence ?? []).length) bad.push(`${r.rule}: no evidence`);
    if (!s.rows.some((row) => row.rule === r.rule)) bad.push(`${r.rule}: no such rule`);
  }
  if (bad.length) {
    console.error('refusing to record:\n  ' + bad.join('\n  '));
    process.exit(1);
  }

  const ts = stamp();
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim()
    ? '-dirty'
    : '';
  const run = {
    run_id: `${ts}-local-01`,
    created: ts.replace(/T(\d\d)-(\d\d)-(\d\d)Z$/, (m, h, mi, sec) => `T${h}:${mi}:${sec}Z`),
    actor: 'agent',
    kind: 'walkdown',
    target: input.target ?? 'local',
    base_url: input.base_url ?? BASE,
    git_sha: sha + dirty,
    blueprint_sha: sha + dirty,
    ...(input.note && { note: input.note }),
    results: input.results,
  };
  const out = join(BP, 'runs', `${run.run_id}.json`);
  if (existsSync(out)) {
    console.error(`${out} exists`);
    process.exit(1);
  }
  writeFileSync(out, JSON.stringify(run, null, 2) + '\n');
  console.log(`recorded ${run.run_id} — ${run.results.length} verdict(s)`);
  console.log(`  ${out}`);
}

/* ----------------------------------------------------------------------- */

if (cmd === 'owed') owed();
else if (cmd === 'capture') await capture(rest);
else if (cmd === 'record')
  record(rest[0] ?? (console.error('usage: record <verdicts.json>'), process.exit(1)));
else {
  console.log(
    readFileSync(new URL(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^\/\*\n?/, '')
      .replace(/^ \* ?/gm, ''),
  );
  process.exit(cmd ? 1 : 0);
}
