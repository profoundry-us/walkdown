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
import { parse } from 'yaml';

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, '..');
const BP = join(ROOT, 'blueprint');
const BASE = process.env.WALKDOWN_SITTING_URL ?? 'http://localhost:4700';

const [cmd, ...rest] = process.argv.slice(2);
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z').replaceAll(':', '-');

/*
 * `walkdown status` exits non-zero when anything is failing, which is most of
 * the time and is not an error here - we want the report, not the verdict on
 * the report. The JSON is on stdout either way.
 */
const status = () => {
  try {
    return JSON.parse(execFileSync('node', [join(ROOT, 'bin/walkdown.js'), 'status', '--json'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    }));
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
      console.log(`    ${r.agent.state.padEnd(7)} ${r.rule}${screens.length ? `  [${screens.join(' ')}]` : '  [headless]'}`);
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
  { name: 'panel-screens-list', steps: [['sr', "r => r.querySelector('#wdp-screen-btn').click()"], ['wait', 400]] },
  { name: 'panel-settings', steps: [['sr', "r => r.querySelector('#wdp-desk-btn').click()"], ['wait', 400]] },
  { name: 'panel-pin-mode', steps: [['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 600]] },
  { name: 'panel-tab-blueprints', steps: [['tab', 'blueprints']] },
  { name: 'panel-tab-rules', steps: [['tab', 'rules']] },
  { name: 'panel-tab-threads', steps: [['tab', 'threads']] },
  { name: 'panel-rule-detail', steps: [['tab', 'rules'], ['sr', "r => r.querySelector('[data-rule]').click()"], ['wait', 800]] },
  {
    name: 'detail-check-source',
    steps: [
      ['tab', 'rules'],
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.rules.tiers-at-a-glance')?.click()"],
      ['wait', 900],
      ['sr', "r => { const d = r.querySelector('[data-testid=\"detail.technical-disclosure\"]'); (d?.querySelector('summary') ?? d)?.click(); }"],
      ['wait', 1800],
      ['sr', "r => r.querySelector('[data-testid=\"detail.technical-disclosure\"]')?.scrollIntoView({ block: 'center' })"],
      ['wait', 400],
    ],
  },
  {
    name: 'detail-screenshots-modal',
    steps: [
      ['tab', 'rules'],
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.identity.default-actor')?.click()"],
      ['wait', 900],
      ['sr', "r => (r.querySelector('[data-testid=\"detail.screenshots\"]') ?? [...r.querySelectorAll('button')].find(x => /^open \\d+$/.test(x.textContent.trim())))?.click()"],
      ['wait', 1200],
    ],
  },
  {
    name: 'rules-search-filtered',
    steps: [
      ['tab', 'rules'],
      ['sr', "r => { const q = r.querySelector('input[placeholder*=\"Search\"]'); q.value = 'ghost'; q.dispatchEvent(new Event('input', { bubbles: true })); }"],
      ['wait', 600],
    ],
  },
  {
    name: 'panel-thread-panel',
    steps: [['tab', 'threads'], ['sr', "r => r.querySelector('[data-open-thread]')?.click()"], ['wait', 900]],
  },
  {
    /* The governance one: with no name set, a verdict must be refused. */
    name: 'refuses-without-a-name',
    steps: [
      ['sr', "r => r.querySelector('#wdp-desk-btn').click()"], ['wait', 400],
      ['sr', "r => { for (const i of r.querySelectorAll('input')) if (/actor|name/i.test(i.dataset.testid ?? '')) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } }"],
      ['wait', 600], ['key', 'Escape'], ['wait', 400],
      ['tab', 'threads'],
      ['sr', "r => r.querySelector('[data-open-thread]')?.click()"], ['wait', 800],
      ['sr', "r => [...r.querySelectorAll('button')].find(x => /Verify/.test(x.textContent))?.click()"],
      ['wait', 900],
    ],
  },
  { name: 'panel-put-away', steps: [['sr', "r => r.querySelector('#wdp-undock').click()"], ['wait', 1000]] },

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
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.rules.tiers-at-a-glance')?.click()"],
      ['wait', 900],
      ['sr', "r => r.querySelector('[data-testid=\"detail.technical-disclosure\"]')?.scrollIntoView({ block: 'center' })"],
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
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.identity.default-actor')?.click()"],
      ['wait', 900],
      ['sr', "r => r.querySelector('[data-testid=\"detail.evidence\"]')?.scrollIntoView({ block: 'center' })"],
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
    ],
  },
  /* Hovering an anchor a step names lights that element up on the surface.
   * `panel.counts` is one the stand-in review page actually carries. */
  {
    name: 'rules-anchor-hover-highlights',
    steps: [
      ['tab', 'rules'],
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.rules.counts-legible')?.click()"],
      ['wait', 900],
      ['sr', "r => { const a = [...r.querySelectorAll('.wdp-anchor')].find(x => x.dataset.anchor === 'panel.counts'); a.scrollIntoView({ block: 'center' }); a.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); }"],
      ['wait', 700],
    ],
  },
  /* A rule with no screen: the desk is covered, in walkdown's own voice. */
  {
    name: 'rules-headless-cover',
    steps: [
      ['tab', 'rules'],
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'screens.identity.fragment-is-identity')?.click()"],
      ['wait', 1000],
    ],
  },
  /* A rule open, then another tab picked: the tab shows its own content and
   * the rule detail is off the panel's edge rather than on top of it. */
  {
    name: 'rules-open-then-blueprints-tab',
    steps: [
      ['tab', 'rules'],
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'panel.rules.detail-slide')?.click()"],
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
      ['sr', "r => { const q = r.querySelector('#wdp-search'); q.value = 'panel.rules'; q.dispatchEvent(new Event('input', { bubbles: true })); }"],
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
      ['sr', "r => [...r.querySelectorAll('[data-pick]')].find(b => b.dataset.pick !== r.querySelector('[data-pick]').dataset.pick && /example/.test(b.dataset.pick))?.click()"],
      ['wait', 2500],
      ['tab', 'rules'],
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'waitlist.join.already-joined')?.click()"],
      ['wait', 1200],
    ],
  },
  {
    name: 'rules-setup-absent',
    steps: [
      ['tab', 'blueprints'],
      ['sr', "r => [...r.querySelectorAll('[data-pick]')].find(b => /example/.test(b.dataset.pick))?.click()"],
      ['wait', 2500],
      ['tab', 'rules'],
      ['sr', "r => [...r.querySelectorAll('[data-rule]')].find(e => e.dataset.rule === 'waitlist.join.email-required')?.click()"],
      ['wait', 1200],
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
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector('[data-testid=\"panel.rules-list\"]').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + 30 }; }"],
      ['hover'], ['wait', 500],
      ['probe', "(d, fr, fd) => ({ pinning: fd.documentElement.className, lit: [...fd.querySelectorAll('.wd-hover')].map((e) => ({ anchor: e.getAttribute('data-testid'), outline: getComputedStyle(e).outline, cursor: getComputedStyle(e).cursor, box: e.getBoundingClientRect().toJSON() })) })"],
    ],
  },
  {
    name: 'embed-form-below-the-spot',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector('[data-testid=\"panel.rules-list\"]').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + 20 }; }"],
      ['click'], ['wait', 600],
      ['probe', "(d, fr, fd, fsr) => { const f = fsr.querySelector('[data-testid=\"pin.form\"]'), p = fsr.querySelector('[data-testid=\"pin.placeholder\"]'); const cur = (s) => { const e = f.querySelector(s); return e && getComputedStyle(e).cursor; }; return { surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight }, spot: { x: parseFloat(p.style.left) + 11, y: parseFloat(p.style.top) + 19 }, form: { left: f.style.left, top: f.style.top, box: f.getBoundingClientRect().toJSON() }, element: f.querySelector('b').textContent.trim(), elementBox: fd.querySelector('[data-testid=\"panel.rules-list\"]').getBoundingClientRect().toJSON(), placeholderMark: p.querySelector('.wd-kind').textContent, cursors: { textarea: cur('textarea'), checkbox: cur('input[type=checkbox]'), save: cur('[data-testid=\"pin.save\"]'), cancel: cur('[data-testid=\"pin.cancel\"]') } }; }"],
    ],
  },
  {
    name: 'embed-form-above-near-the-bottom',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector('[data-testid=\"panel.counts\"]').getBoundingClientRect(); return { x: b.x + e.x + 40, y: b.y + e.y + e.height / 2 }; }"],
      ['click'], ['wait', 600],
      ['probe', "(d, fr, fd, fsr) => { const f = fsr.querySelector('[data-testid=\"pin.form\"]'), p = fsr.querySelector('[data-testid=\"pin.placeholder\"]'); return { surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight }, spot: { x: parseFloat(p.style.left) + 11, y: parseFloat(p.style.top) + 19 }, form: { left: f.style.left, top: f.style.top, box: f.getBoundingClientRect().toJSON() }, element: f.querySelector('b').textContent.trim() }; }"],
    ],
  },
  {
    /* The kind switch, and the proof that the form is UI: clicking its own
       checkbox must toggle the checkbox, not drop a second pin behind it. */
    name: 'embed-form-is-chrome',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector('[data-testid=\"panel.rules-list\"]').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + 20 }; }"],
      ['click'], ['wait', 600],
      ['aim', "(d, fr, fd, fsr) => { const b = fr.getBoundingClientRect(), e = fsr.querySelector('[data-testid=\"pin.kind\"]').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + e.height / 2 }; }"],
      ['click'], ['wait', 500],
      ['probe', "(d, fr, fd, fsr) => ({ forms: fsr.querySelectorAll('[data-testid=\"pin.form\"]').length, placeholders: fsr.querySelectorAll('[data-testid=\"pin.placeholder\"]').length, kindChecked: fsr.querySelector('[data-testid=\"pin.kind\"]').checked, placeholderMark: fsr.querySelector('[data-testid=\"pin.placeholder\"] .wd-kind').textContent })"],
    ],
  },
  {
    name: 'embed-form-unanchored-spot',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), w = fd.defaultView; for (let y = w.innerHeight - 24; y > 24; y -= 12) for (let x = 8; x < 120; x += 8) { const t = fd.elementFromPoint(x, y); if (t && !t.closest('[data-testid]')) return { x: b.x + x, y: b.y + y }; } throw new Error('no unanchored spot on this surface'); }"],
      ['click'], ['wait', 600],
      ['probe', "(d, fr, fd, fsr) => ({ copy: fsr.querySelector('[data-testid=\"pin.form\"]').textContent.replace(/\\s+/g, ' ').trim(), formLeft: fsr.querySelector('[data-testid=\"pin.form\"]').style.left, placeholder: !!fsr.querySelector('[data-testid=\"pin.placeholder\"]') })"],
    ],
  },
  {
    /* The promise the placeholder makes is kept both ways: the form goes, and
       the pin it was promising goes with it. */
    name: 'embed-form-escape-takes-the-placeholder',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector('[data-testid=\"panel.rules-list\"]').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + 20 }; }"],
      ['click'], ['wait', 600],
      ['probe', "(d, fr, fd, fsr) => ({ at: 'form open', forms: fsr.querySelectorAll('[data-testid=\"pin.form\"]').length, placeholders: fsr.querySelectorAll('[data-testid=\"pin.placeholder\"]').length })"],
      ['key', 'Escape'], ['wait', 500],
      ['probe', "(d, fr, fd, fsr) => ({ at: 'after Escape', forms: fsr.querySelectorAll('[data-testid=\"pin.form\"]').length, placeholders: fsr.querySelectorAll('[data-testid=\"pin.placeholder\"]').length, stillPinning: fd.documentElement.className })"],
    ],
  },
  {
    /* The same spot, filed. Its own state because a screenshot is taken after
       the last step, and a state that saves the form photographs the surface
       with the form already gone. */
    name: 'embed-pin-filed-unanchored',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), w = fd.defaultView; for (let y = w.innerHeight - 24; y > 24; y -= 12) for (let x = 8; x < 120; x += 8) { const t = fd.elementFromPoint(x, y); if (t && !t.closest('[data-testid]')) return { x: b.x + x, y: b.y + y }; } throw new Error('no unanchored spot on this surface'); }"],
      ['click'], ['wait', 600],
      ['top', "(d, fr, fd, fsr) => { const t = fsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — unanchored spot'; t.dispatchEvent(new Event('input', { bubbles: true })); fsr.querySelector('[data-testid=\"pin.save\"]').click(); }"],
      ['wait', 1000],
      ['probe', "(d) => d.defaultView.__held"],
    ],
  },
  {
    name: 'embed-pin-filed-anchored',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector('[data-testid=\"panel.counts\"]').getBoundingClientRect(); return { x: b.x + e.x + 40, y: b.y + e.y + e.height / 2 }; }"],
      ['click'], ['wait', 600],
      ['top', "(d, fr, fd, fsr) => { const t = fsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — anchored on panel.counts'; t.dispatchEvent(new Event('input', { bubbles: true })); fsr.querySelector('[data-testid=\"pin.save\"]').click(); }"],
      ['wait', 1000],
      ['probe', "(d, fr, fd) => ({ held: d.defaultView.__held, elementBox: fd.querySelector('[data-testid=\"panel.counts\"]').getBoundingClientRect().toJSON(), surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight }, panelWindow: { w: d.defaultView.innerWidth, h: d.defaultView.innerHeight } })"],
    ],
  },
  {
    /* Fully faded to the design: the pin must land on the design, and the
       app behind it must be disarmed rather than taking the click too. */
    name: 'embed-pin-filed-on-the-prototype',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 500],
      ['sr', "r => [...r.querySelectorAll('[data-surface]')].find(b => b.dataset.surface === 'prototype').click()"],
      ['wait', 3500],
      ['probe', "(d, fr, fd, fsr, gh, gd) => ({ ghostSrc: gh && gh.src, ghostOpacity: gh && getComputedStyle(gh).opacity, ghostArmed: gd && gd.documentElement.className, appArmed: fd.documentElement.className, ghostBox: gh && gh.getBoundingClientRect().toJSON(), appBox: fr.getBoundingClientRect().toJSON() })"],
      ['aim', "(d, fr, fd, fsr, gh, gd) => { const b = gh.getBoundingClientRect(), e = gd.querySelector('[data-testid=\"panel.counts\"]').getBoundingClientRect(); return { x: b.x + e.x + 40, y: b.y + e.y + e.height / 2 }; }"],
      ['click'], ['wait', 600],
      ['top', "(d, fr, fd, fsr, gh, gd, gsr) => { const t = gsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — on the design'; t.dispatchEvent(new Event('input', { bubbles: true })); gsr.querySelector('[data-testid=\"pin.save\"]').click(); }"],
      ['wait', 1000],
      ['probe', "(d) => d.defaultView.__held"],
    ],
  },
  {
    /* Half-faded there is no honest answer to which surface a pin is about,
       so the control closes and says why. */
    name: 'embed-pin-mid-fade-refused',
    steps: [
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 500],
      ['sr', "r => { const f = r.querySelector('#wdp-fade'); f.value = 50; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); }"],
      ['wait', 2000],
      ['probe', "(d, fr, fd, fsr, gh, gd) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const b = r.querySelector('#wdp-pin'); return { disabled: b.disabled, title: b.title, ghostOpacity: gh && getComputedStyle(gh).opacity, ghostArmed: gd && gd.documentElement.className, appArmed: fd.documentElement.className }; }"],
    ],
  },
  {
    name: 'embed-pin-filed-at-mobile',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('[data-vp=\"390\"]').click()"], ['wait', 2000],
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector('[data-testid=\"panel.bar\"]').getBoundingClientRect(); return { x: b.x + e.x + 40, y: b.y + e.y + e.height / 2 }; }"],
      ['click'], ['wait', 600],
      ['top', "(d, fr, fd, fsr) => { const t = fsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — at a mobile viewport'; t.dispatchEvent(new Event('input', { bubbles: true })); fsr.querySelector('[data-testid=\"pin.save\"]').click(); }"],
      ['wait', 1000],
      ['probe', "(d, fr, fd) => ({ held: d.defaultView.__held, surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight }, frameBox: fr.getBoundingClientRect().toJSON() })"],
    ],
  },
  {
    /* The surface laid out at 1440 and scaled into an 860px pane: what is
       recorded has to be the surface's own pixels, not the ones on screen. */
    name: 'embed-pin-filed-on-a-scaled-surface',
    steps: [
      ['no-writes'],
      ['sr', "r => r.querySelector('[data-vp=\"1440\"]').click()"], ['wait', 2000],
      ['sr', "r => r.querySelector('#wdp-pin').click()"], ['wait', 700],
      ['aim', "(d, fr, fd) => { const b = fr.getBoundingClientRect(), e = fd.querySelector('[data-testid=\"panel.bar\"]').getBoundingClientRect(), s = new DOMMatrix(getComputedStyle(fr).transform).a; return { x: b.x + (e.x + 40) * s, y: b.y + (e.y + e.height / 2) * s }; }"],
      ['click'], ['wait', 600],
      ['top', "(d, fr, fd, fsr) => { const t = fsr.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — on a scaled surface'; t.dispatchEvent(new Event('input', { bubbles: true })); fsr.querySelector('[data-testid=\"pin.save\"]').click(); }"],
      ['wait', 1000],
      ['probe', "(d, fr, fd) => ({ held: d.defaultView.__held, scale: new DOMMatrix(getComputedStyle(fr).transform).a, frameBox: fr.getBoundingClientRect().toJSON(), surfaceViewport: { w: fd.defaultView.innerWidth, h: fd.defaultView.innerHeight } })"],
    ],
  },
  {
    /* The same pins, measured in the surface's own pixels through a zoom, a
       fade and a window resize. Their spot must not move because the panel
       around them did. */
    name: 'embed-pin-spot-survives-zoom',
    steps: [
      ['probe', "(d, fr, fd, fsr) => ({ at: 'fit', innerW: fd.defaultView.innerWidth, scale: new DOMMatrix(getComputedStyle(fr).transform).a, pins: Object.fromEntries([...fsr.querySelectorAll('.wd-pin')].map((p) => [p.dataset.thread, [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.top))]])) })"],
      ['sr', "r => r.querySelector('[data-vp=\"1440\"]').click()"], ['wait', 2000],
      ['probe', "(d, fr, fd, fsr) => ({ at: '1440', innerW: fd.defaultView.innerWidth, scale: new DOMMatrix(getComputedStyle(fr).transform).a, pins: Object.fromEntries([...fsr.querySelectorAll('.wd-pin')].map((p) => [p.dataset.thread, [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.top))]])) })"],
      ['sr', "r => r.querySelector('[data-vp=\"0\"]').click()"], ['wait', 1500],
      ['sr', "r => { const f = r.querySelector('#wdp-fade'); f.value = 30; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); }"],
      ['wait', 2000],
      ['probe', "(d, fr, fd, fsr) => ({ at: 'faded', innerW: fd.defaultView.innerWidth, pins: Object.fromEntries([...fsr.querySelectorAll('.wd-pin')].map((p) => [p.dataset.thread, [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.top))]])) })"],
      ['size', [1000, 700]], ['wait', 1500],
      ['probe', "(d, fr, fd, fsr) => ({ at: 'resized', innerW: fd.defaultView.innerWidth, pins: Object.fromEntries([...fsr.querySelectorAll('.wd-pin')].map((p) => [p.dataset.thread, [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.top))]])) })"],
    ],
  },
  {
    name: 'embed-pin-tooltip',
    steps: [
      ['aim', "(d, fr, fd, fsr) => { const b = fr.getBoundingClientRect(); const p = [...fsr.querySelectorAll('.wd-pin')].find((x) => parseFloat(x.style.top) > 20); const e = p.querySelector('.wd-dot').getBoundingClientRect(); return { x: b.x + e.x + e.width / 2, y: b.y + e.y + e.height / 2 }; }"],
      ['hover'], ['wait', 800],
      ['probe', "(d, fr, fd, fsr) => { const p = [...fsr.querySelectorAll('.wd-pin')].find((x) => parseFloat(x.style.top) > 20); const t = p.querySelector('[data-testid=\"pin.tip\"]'); const cs = getComputedStyle(t), r = t.getBoundingClientRect(), w = fd.defaultView; return { thread: p.dataset.thread, side: (p.className.match(/tooltip-\\w+/) || [])[0], titleAttribute: p.getAttribute('title'), lines: [...t.children].map((c) => c.textContent.replace(/\\s+/g, ' ').trim()), visible: cs.visibility + ' ' + cs.display + ' opacity ' + cs.opacity, pointerEvents: cs.pointerEvents, box: r.toJSON(), whollyOnSurface: r.left >= 0 && r.top >= 0 && r.right <= w.innerWidth && r.bottom <= w.innerHeight }; }"],
    ],
  },
  {
    /* What walkdown puts in somebody else's document, and what it keeps to
       itself. The count of host stylesheets it adds is the whole rule. */
    name: 'embed-pin-own-skin',
    steps: [
      ['probe', "(d, fr, fd, fsr) => { const layer = [...fd.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot); const pin = fsr.querySelector('.wd-pin'); const dot = pin.querySelector('.wd-dot'); return { layerIsShadow: !!layer.shadowRoot, layerHasNoSize: layer.getBoundingClientRect().width + 'x' + layer.getBoundingClientRect().height, theme: layer.shadowRoot.querySelector('[data-theme]').dataset.theme, sheetsInShadow: layer.shadowRoot.querySelectorAll('style').length, sheetsAddedToHost: [...fd.querySelectorAll('style')].filter((s) => /wd-hover|wd-pinning|@property/.test(s.textContent)).map((s) => ({ selects: (s.textContent.match(/^[^{@][^{]*/gm) || []).map((x) => x.trim()).filter(Boolean).slice(0, 6), length: s.textContent.length })), pinMarkup: dot.innerHTML.replace(/\\s+/g, ' ').trim(), pinTone: getComputedStyle(dot).color, kindDisc: getComputedStyle(pin.querySelector('.wd-kind')).backgroundColor, kindLetter: pin.querySelector('.wd-kind').textContent }; }"],
    ],
  },
  {
    /* The thread as the panel shows it, with the provenance of a pin that
       carries an element, a spot and the viewport it was placed at. */
    name: 'embed-thread-provenance',
    steps: [
      ['tab', 'threads'],
      ['sr', "r => (r.querySelector('[data-open-thread=\"n-0107\"]') ?? r.querySelector('[data-open-thread]')).click()"],
      ['wait', 1200],
      ['probe', "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const prov = r.querySelector('[data-testid=\"thread.provenance\"]'); const body = r.querySelector('[data-testid=\"thread.body\"]'); const where = prov.parentElement.nextElementSibling; const reply = r.querySelector('[data-testid=\"thread.reply\"]'); const acts = [...r.querySelectorAll('[data-testid=\"thread.actions\"]')]; const lh = (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); return { provenance: { text: prov.textContent.replace(/\\s+/g, ' ').trim(), lines: lh(prov), fontSize: getComputedStyle(prov).fontSize, box: prov.getBoundingClientRect().toJSON() }, where: { text: where.textContent.replace(/\\s+/g, ' ').trim(), lines: lh(where), fontSize: getComputedStyle(where).fontSize }, body: { box: body.getBoundingClientRect().toJSON(), overflowY: getComputedStyle(body).overflowY, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, replies: body.querySelectorAll('.wd-msg').length, paneHeight: Math.round(r.querySelector('[data-testid=\"thread.panel\"]').getBoundingClientRect().height), fontSize: getComputedStyle(body.querySelector('.wd-text')).fontSize, first: body.querySelector('.wd-text').textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) }, reply: { placeholder: reply.placeholder, value: reply.value, row: reply.parentElement.textContent.replace(/\\s+/g, ' ').trim() }, actions: acts.map((a) => ({ label: a.textContent.trim(), act: a.dataset.act, top: Math.round(a.getBoundingClientRect().top) })) }; }"],
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
      ['top', "(d) => d.defaultView.walkdownEmbed.setPinMode(true)"], ['wait', 400],
      ['aim', "(d) => ({ x: 300, y: 300 })"], ['click'], ['wait', 600],
      ['top', "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const t = r.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — which project does this land in'; t.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-testid=\"pin.save\"]').click(); }"],
      ['wait', 1000],
      ['probe', "(d) => ({ declares: d.defaultView.__walkdownConfig, held: d.defaultView.__held })"],
    ],
  },
  {
    /* The other half of the same rule: a page that declares nothing must go
       on filing against the server's default, exactly as it did before. */
    name: 'embed-pin-files-against-the-default',
    url: '/stand-in/review',
    steps: [
      ['no-writes'],
      ['top', "(d) => d.defaultView.walkdownEmbed.setPinMode(true)"], ['wait', 400],
      ['aim', "(d) => ({ x: 300, y: 300 })"], ['click'], ['wait', 600],
      ['top', "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const t = r.querySelector('[data-testid=\"pin.note\"]'); t.value = 'sitting probe — no project declared'; t.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-testid=\"pin.save\"]').click(); }"],
      ['wait', 1000],
      ['probe', "(d) => ({ declares: d.defaultView.__walkdownConfig ?? null, tagBp: d.querySelector('script[data-walkdown]')?.dataset.bp ?? null, held: d.defaultView.__held })"],
    ],
  },
  {
    /* Judged by making it refuse: waiving is recorded with a reason, so an
       empty reply box must be turned away rather than quietly waiving. */
    name: 'embed-thread-waive-needs-a-reason',
    steps: [
      ['tab', 'threads'],
      ['sr', "r => r.querySelector('[data-open-thread]').click()"], ['wait', 1200],
      ['sr', "r => [...r.querySelectorAll('[data-testid=\"thread.actions\"]')].find((a) => a.dataset.act === 'waived').click()"],
      ['wait', 1000],
      ['probe', "(d) => { const r = [...d.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; const say = r.querySelector('[data-testid=\"thread.say\"]'); return { thread: r.querySelector('[data-testid=\"thread.provenance\"]').textContent.replace(/\\s+/g, ' ').trim(), said: say.textContent.trim(), shown: !say.classList.contains('hidden'), stillOnThread: !!r.querySelector('[data-testid=\"thread.reply\"]') }; }"],
    ],
  },
];

async function capture(only = []) {
  const { chromium } = await import('@playwright/test');
  const ts = stamp();
  const dir = join(BP, 'runs', 'evidence', ts);
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
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });
    return pg;
  };
  let page = watch(await browser.newPage({ viewportSize: { width: 1280, height: 760 } }));
  const home = page;

  // The design first: what every judgment is made against.
  for (const s of screens) {
    const url = `${BASE}/${protoRoot}${s.path}`;
    const res = await page.goto(url, { waitUntil: 'load' }).catch(() => null);
    if (!res?.ok()) { console.log(`  proto-${s.id}: ${res?.status() ?? 'unreachable'} — skipped`); continue; }
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(dir, `proto-${s.id}.png`) });
    console.log(`  proto-${s.id}.png`);
  }

  const inSr = (body) => page.evaluate((src) => {
    const root = [...document.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot)?.shadowRoot;
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
  const inTop = (body) => page.evaluate((src) => {
    const fr = document.querySelector('[data-testid="panel.app-frame"]');
    const found = [];
    const walk = (n) => { for (const e of n.querySelectorAll('*')) { if (e.tagName === 'IFRAME') found.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
    walk(document);
    const gh = found.find((f) => f !== fr) ?? null;
    const shadow = (f) => {
      const doc = f?.contentDocument;
      return doc ? [...doc.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot)?.shadowRoot ?? null : null;
    };
    return new Function('d', 'fr', 'fd', 'fsr', 'gh', 'gd', 'gsr', `return (${src})(d, fr, fd, fsr, gh, gd, gsr)`)(
      document, fr, fr?.contentDocument ?? null, shadow(fr), gh, gh?.contentDocument ?? null, shadow(gh));
  }, body);

  for (const state of STATES) {
    if (only.length && !only.includes(state.name)) continue;
    /*
     * Almost every state is the panel at the server's front door. `url` is for
     * the handful that are not - a page carrying the embed and no panel, which
     * is how an application under the browser extension is reviewed - and
     * `config` is what that delivery leaves on the window instead of a script
     * tag, so a state can be a page that declares which project it belongs to.
     */
    if (state.config) {
      // Its own tab, and thrown away after: an init script cannot be taken
      // back, and one state's config leaking into every state after it would
      // be the hardest kind of wrong answer to notice.
      page = watch(await browser.newPage({ viewportSize: { width: 1280, height: 760 } }));
      await page.addInitScript((c) => { window.__walkdownConfig = c; }, state.config);
    }
    await page.goto(state.url ? BASE + state.url : BASE, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    let spot = null;
    const probes = [];
    for (const [op, arg] of state.steps) {
      if (op === 'sr') await inSr(arg);
      else if (op === 'tab') await inSr(`r => r.querySelector('[role=tab][data-tab=${arg}]').click()`);
      else if (op === 'key') await page.keyboard.press(arg);
      else if (op === 'wait') await page.waitForTimeout(arg);
      else if (op === 'top') await inTop(arg);
      else if (op === 'probe') probes.push(await inTop(arg));
      else if (op === 'aim') spot = await inTop(arg);
      else if (op === 'hover') await page.mouse.move(spot.x, spot.y);
      else if (op === 'click') await page.mouse.click(spot.x, spot.y);
      else if (op === 'size') await page.setViewportSize({ width: arg[0], height: arg[1] });
      /*
       * Hold every thread this state would file, and remember what it asked
       * for. These rules are about what a pin RECORDS, and a sitting that
       * answered that by filing a dozen throwaway threads would be writing
       * junk into the ledger it exists to keep honest.
       */
      else if (op === 'no-writes') await page.evaluate(() => {
        window.__held = [];
        const real = window.fetch;
        window.fetch = (u, o) => {
          if (o?.method !== 'POST' || !String(u).includes('/api/threads')) return real(u, o);
          window.__held.push({ url: String(u), body: JSON.parse(o.body) });
          return Promise.resolve(new Response(JSON.stringify({ id: 'n-HELD', thread: {} }),
            { headers: { 'content-type': 'application/json' } }));
        };
      });
      if (op === 'tab') await page.waitForTimeout(500);
    }
    await page.screenshot({ path: join(dir, `${state.name}.png`) });
    console.log(`  ${state.name}.png`);
    // A measurement is evidence too, and it goes beside the picture it explains.
    if (probes.length) {
      writeFileSync(join(dir, `${state.name}.json`), JSON.stringify(probes.length === 1 ? probes[0] : probes, null, 2) + '\n');
      console.log(`  ${state.name}.json`);
    }
    await page.setViewportSize({ width: 1280, height: 760 });
    if (page !== home) { await page.close(); page = home; }
  }
  await browser.close();

  console.log(`\nevidence: blueprint/runs/evidence/${ts}/`);
  console.log(errors.length ? `\n${errors.length} PAGE ERROR(S):\n  ${errors.join('\n  ')}` : '\nno page errors in any state');
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
    if (!['pass', 'fail', 'blocked', 'skipped'].includes(r.status)) bad.push(`${r.rule}: bad status`);
    if (!(r.evidence ?? []).length) bad.push(`${r.rule}: no evidence`);
    if (!s.rows.some((row) => row.rule === r.rule)) bad.push(`${r.rule}: no such rule`);
  }
  if (bad.length) { console.error('refusing to record:\n  ' + bad.join('\n  ')); process.exit(1); }

  const ts = stamp();
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() ? '-dirty' : '';
  const run = {
    run_id: `${ts}-local-01`,
    created: ts.replace(/T(\d\d)-(\d\d)-(\d\d)Z$/, (m, h, mi, sec) => `T${h}:${mi}:${sec}Z`),
    actor: 'agent', kind: 'walkdown', target: input.target ?? 'local',
    base_url: input.base_url ?? BASE,
    git_sha: sha + dirty, blueprint_sha: sha + dirty,
    ...(input.note && { note: input.note }),
    results: input.results,
  };
  const out = join(BP, 'runs', `${run.run_id}.json`);
  if (existsSync(out)) { console.error(`${out} exists`); process.exit(1); }
  writeFileSync(out, JSON.stringify(run, null, 2) + '\n');
  console.log(`recorded ${run.run_id} — ${run.results.length} verdict(s)`);
  console.log(`  ${out}`);
}

/* ----------------------------------------------------------------------- */

if (cmd === 'owed') owed();
else if (cmd === 'capture') await capture(rest);
else if (cmd === 'record') record(rest[0] ?? (console.error('usage: record <verdicts.json>'), process.exit(1)));
else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
