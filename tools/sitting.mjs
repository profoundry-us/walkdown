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
];

async function capture(only) {
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
  const page = await browser.newPage({ viewportSize: { width: 1280, height: 760 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`); });

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

  for (const state of STATES) {
    if (only && state.name !== only) continue;
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    for (const [op, arg] of state.steps) {
      if (op === 'sr') await inSr(arg);
      else if (op === 'tab') await inSr(`r => r.querySelector('[role=tab][data-tab=${arg}]').click()`);
      else if (op === 'key') await page.keyboard.press(arg);
      else if (op === 'wait') await page.waitForTimeout(arg);
      if (op === 'tab') await page.waitForTimeout(500);
    }
    await page.screenshot({ path: join(dir, `${state.name}.png`) });
    console.log(`  ${state.name}.png`);
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
else if (cmd === 'capture') await capture(rest[0]);
else if (cmd === 'record') record(rest[0] ?? (console.error('usage: record <verdicts.json>'), process.exit(1)));
else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
