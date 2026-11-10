/*
 * A screen's setup, run in the App pane (ADR 0017 §§2, 5).
 *
 * A page that depends on who is signed in and which record is open cannot be
 * reached by its path alone. Where the storyboard writes the way there as
 * steps, the panel runs them before it loads the screen: each step is a
 * navigation of the app's own frame, so any session it sets is the app's.
 *
 * The server hands every screen its steps and path per target with that
 * target's fixtures already filled in (`screen.runs`). This module chooses
 * the target, runs the steps, and covers the frame while they run or after
 * one fails - a reviewer who sees the sign-in page where the screen should be
 * judges the wrong page.
 */
import { appUrlOf } from '../../lib/screen-match.js';
import { D, S, store } from './state.js';
import { esc } from './util.js';

/** The app frame's name, which a posted form targets. */
export const APP_FRAME_NAME = 'walkdown-app';

const WAIT_FOR_MS = 10000;
const LOAD_MS = 20000;
/* A page with walkdown in it says how it loaded just after it loads; one without says nothing. */
const SETTLE_MS = 900;

const TARGET_KEY = () => `walkdown:target:${S.data?.key ?? ''}`;

/** The targets the App pane can be pointed at, `local` first. */
export const appTargets = () => S.data?.appTargets ?? [];

/** The target in hand: the viewer's own choice while it is still declared, else the first. */
export const targetNow = () =>
  (appTargets().find((t) => t.name === S.target) ?? appTargets()[0])?.name ?? 'local';

/** Read the viewer's choice once, before the first blueprint is drawn. */
export async function restoreTarget() {
  S.target = (await store.get(TARGET_KEY()).catch(() => null)) ?? null;
}

/*
 * Point the storyboard at the target in hand: its base URL, and each screen's
 * path as that target's fixtures fill it in. Done to the data once, so every
 * reader of a screen's address - the matcher, the picker, the ghost - agrees.
 */
export function applyTarget() {
  if (!S.data) return;
  const t = appTargets().find((x) => x.name === targetNow());
  if (t) S.data.appBase = t.base;
  for (const sc of S.data.storyboard ?? []) {
    const run = sc.runs?.[targetNow()];
    if (run?.path) sc.app = { ...sc.app, path: run.path };
  }
}

/** Choose a target. The choice is this viewer's, kept in the browser. */
export function chooseTarget(name) {
  S.target = name;
  store.set(TARGET_KEY(), name);
  S.setupFor = null;
  applyTarget();
}

/** A screen's steps and path on the target in hand, or null where it has neither steps nor fixtures. */
export const runOf = (screen) => screen?.runs?.[targetNow()] ?? null;

const keyOf = (screen) => `${targetNow()}\0${screen?.id ?? ''}`;

/** Whether going to this screen runs anything first: steps not yet run here, or a fixture with no value. */
export function needsSetup(screen) {
  const run = runOf(screen);
  if (!run) return false;
  if (run.missing.length) return true;
  return run.steps.length > 0 && S.setupFor !== keyOf(screen);
}

/** Whether the panel last set this screen up on the target in hand. */
export const isSetUp = (screen) => S.setupFor === keyOf(screen);

/** The setup in progress or just ended, when it is this screen's on this target. */
export const setupState = (screen) =>
  S.setup && S.setup.screen === screen?.id && S.setup.target === targetNow() ? S.setup : null;

/* ---- the frame's answers ------------------------------------------------- */

let gen = 0;
let arrival = null; // the navigation a step is waiting on
let waiting = null; // the wait_for a step is waiting on

/**
 * The app frame saying it has loaded. While a setup runs, or after one
 * stopped part-way, every such word is the setup's: the frame is on a step,
 * not on a screen.
 *
 * @returns {boolean} whether the setup took it
 */
export function setupHeard(msg) {
  if (!S.setup || S.setup.state === 'done') return false;
  arrival?.heard(msg);
  return true;
}

/** The embed's answer to "how did this page load?", and to a wait_for. */
export function setupAnswered(msg) {
  if (msg.type === 'walkdown:loaded') arrival?.answered(msg);
  else if (waiting && msg.id === waiting.id) waiting.done(Boolean(msg.found));
}

/*
 * One navigation of the frame: how it was answered, or that nothing answered.
 *
 * The frame's own `load` is what says the new page is in. Only then is the
 * page asked how it loaded - a word heard before that may be the page being
 * left, still announcing itself, and taking it for the answer let a step
 * finish before its form had even been posted. A page with no walkdown in it
 * says nothing, and is taken as answered.
 */
function navigate(start) {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    let settle = null;
    let landed = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(settle);
      clearTimeout(limit);
      arrival = null;
      D.appFrame?.removeEventListener('load', loaded);
      resolve(r);
    };
    const loaded = () => {
      landed = true;
      D.appFrame?.contentWindow?.postMessage({ type: 'walkdown:how-loaded', id }, '*');
      settle = setTimeout(() => finish({ status: 0 }), SETTLE_MS);
    };
    const limit = setTimeout(() => finish({ status: 0, silent: true }), LOAD_MS);
    arrival = {
      answered: (msg) => msg.id === id && finish({ status: Number(msg.status) || 0 }),
      // A page whose walkdown arrived after it loaded announces itself late.
      heard: (msg) => landed && finish({ status: Number(msg.status) || 0 }),
    };
    D.appFrame?.addEventListener('load', loaded);
    start();
  });
}

/* A form submitted into the app's frame: a navigation, so the cookie it sets is the app's. */
function submit(url, fields) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = url;
  form.target = APP_FRAME_NAME;
  form.style.display = 'none';
  for (const [name, value] of Object.entries(fields ?? {})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function waitFor(anchor) {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const limit = setTimeout(() => done(false), WAIT_FOR_MS + 1500);
    const done = (found) => {
      clearTimeout(limit);
      waiting = null;
      resolve(found);
    };
    waiting = { id, done };
    D.appFrame?.contentWindow?.postMessage(
      { type: 'walkdown:wait-for', id, anchor, timeout: WAIT_FOR_MS },
      '*',
    );
  });
}

const STATUS = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  422: 'Unprocessable Content',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/**
 * Run a screen's setup on the target in hand.
 *
 * @param {object} screen
 * @param {{ answers: (url: string) => Promise<boolean>, paint: () => void }} with
 * @returns {Promise<'done' | 'failed' | 'down' | 'left'>} `down` when nothing
 *   answers at the target, `left` when the person moved on while it ran
 */
export async function runSetup(screen, { answers, paint }) {
  const mine = ++gen;
  const run = runOf(screen);
  const target = targetNow();
  const base = S.data?.appBase;
  S.setup = { screen: screen.id, target, at: -1, state: 'running', failure: null };
  S.setupFor = null;
  const fail = (failure) => {
    S.setup = { ...S.setup, state: 'failed', failure };
    paintCover();
    paint();
    return 'failed';
  };
  if (run.missing.length) {
    const key = run.missing[0];
    const inPath = String(screen.app?.written ?? '').includes(`{fixtures.${key}}`);
    return fail({
      kind: 'fixture',
      key,
      target,
      inPath,
      written: screen.app?.written,
      set: run.set,
    });
  }
  if (!base || !(await answers(appUrlOf('/', base)))) {
    if (mine === gen) S.setup = null;
    return mine === gen ? 'down' : 'left';
  }
  for (let i = 0; i < run.steps.length; i++) {
    if (mine !== gen) return 'left';
    const step = run.steps[i];
    S.setup = { ...S.setup, at: i };
    paintCover();
    paint();
    if (step.kind === 'wait_for') {
      const found = await waitFor(step.value);
      if (mine !== gen) return 'left';
      if (!found) return fail({ kind: 'wait', step: i, anchor: step.value });
      continue;
    }
    const url = appUrlOf(step.value, base);
    const r = await navigate(() => {
      if (step.kind === 'post') submit(url, step.fields);
      else D.appFrame.src = url;
    });
    if (mine !== gen) return 'left';
    if (r.silent)
      return fail({ kind: 'status', step: i, got: `No answer after ${LOAD_MS / 1000} seconds` });
    if (r.status >= 400)
      return fail({
        kind: 'status',
        step: i,
        got: `${r.status}${STATUS[r.status] ? ` ${STATUS[r.status]}` : ''}`,
      });
  }
  if (mine !== gen) return 'left';
  S.setup = { ...S.setup, at: run.steps.length, state: 'done' };
  S.setupFor = keyOf(screen);
  hideCover();
  paint();
  return 'done';
}

/** Whatever was running is not this trip's any more. */
export function leaveSetup() {
  gen++;
  arrival = null;
  waiting = null;
  S.setup = null;
  hideCover();
}

/* ---- what stands where the page would be -------------------------------- */

let cover = null;
/*
 * The frame eases to a new size over a fifth of a second, so a measurement
 * taken when the window changed is of the size it is leaving: the cover kept
 * the old box, and after a narrower window it lay over the rule's own
 * controls (n-0634). It is measured again whenever the frame's box changes.
 */
let watching = null;

/** The cover follows the frame's box, as the loading veil does. */
export function placeCover() {
  if (!cover || !D.appFrame) return;
  const r = D.appFrame.getBoundingClientRect();
  cover.style.top = `${r.top}px`;
  cover.style.left = `${r.left}px`;
  cover.style.width = `${r.width}px`;
  cover.style.height = `${r.height}px`;
}
export const coverIsUp = () => Boolean(cover);

export function hideCover() {
  watching?.disconnect();
  watching = null;
  cover?.remove();
  cover = null;
}

const KIND = { visit: 'visit', post: 'post', wait_for: 'wait for' };
const DOING = {
  visit: (s) => `Visiting <code>${esc(s.value)}</code>.`,
  post: (s) => `Posting the form to <code>${esc(s.value)}</code>.`,
  wait_for: (s) => `Waiting for <code>${esc(s.value)}</code> on the page.`,
};

function paintCover() {
  const st = S.setup;
  const screen = (S.data?.storyboard ?? []).find((s) => s.id === st?.screen);
  const run = screen?.runs?.[st?.target];
  if (!st || !run || !D.appFrame || !D.sr) return hideCover();
  if (!cover) {
    cover = document.createElement('div');
    cover.dataset.theme = 'blueprint';
    cover.className = 'wdp-setup-cover';
    D.sr.appendChild(cover);
    if (typeof ResizeObserver === 'function') {
      watching = new ResizeObserver(placeCover);
      watching.observe(D.appFrame);
    }
  }
  const n = run.steps.length;
  const path = `<code>${esc(run.path ?? '')}</code>`;
  if (st.state === 'running') {
    const step = run.steps[st.at];
    cover.innerHTML = `
      <div class="progress-card" data-testid="panel.setup-progress" role="status">
        <div class="font-semibold">Setting up this screen: step ${st.at + 1} of ${n}</div>
        <div class="pips">${run.steps
          .map((_, i) => `<i class="${i < st.at ? 'done' : i === st.at ? 'now' : ''}"></i>`)
          .join('')}</div>
        <div>${step ? DOING[step.kind](step) : ''}</div>
        <div class="mt-1 opacity-60">Then ${path} opens here.</div>
      </div>`;
  } else if (st.state === 'failed') {
    const f = st.failure;
    const step = run.steps[f.step];
    const not = `${path} was not loaded, so this is not the screen yet.`;
    const body =
      f.kind === 'fixture'
        ? `<div class="head"><i class="dot"></i>Setup did not run</div>
           <dl>
             <dt>Fixture</dt><dd><code>${esc(f.key)}</code></dd>
             <dt>Target</dt><dd>${esc(f.target)}</dd>
             <dt>Needed by</dt><dd>${f.inPath ? `the screen's path, <code>${esc(f.written ?? '')}</code>` : "the screen's setup"}</dd>
           </dl>
           <div>The ${esc(f.target)} target has no value for <code>${esc(f.key)}</code>, so nothing was run. Set the ${esc(f.target)} target's fixtures, then run the setup again from the rule.
             <code class="cmd">${esc(f.set)}</code></div>`
        : f.kind === 'wait'
          ? `<div class="head"><i class="dot"></i>Setup stopped at step ${f.step + 1} of ${n}</div>
             <dl>
               <dt>Step</dt><dd>${f.step + 1}, wait for</dd>
               <dt>Anchor</dt><dd><code>${esc(f.anchor)}</code></dd>
               <dt>Got</dt><dd>Not on the page after ten seconds</dd>
             </dl>
             <div>${not} Check that the page the step before lands on carries <code>${esc(f.anchor)}</code>, then run the setup again from the rule.</div>`
          : `<div class="head"><i class="dot"></i>Setup stopped at step ${f.step + 1} of ${n}</div>
             <dl>
               <dt>Step</dt><dd>${f.step + 1}, ${KIND[step.kind]}</dd>
               <dt>Path</dt><dd><code>${esc(step.value)}</code></dd>
               <dt>Got</dt><dd>${esc(f.got)}</dd>
             </dl>
             <div>${not} Look at the app's log for <code>${esc(step.value)}</code>, then run the setup again from the rule.</div>`;
    cover.innerHTML = `<div class="failed-card" data-testid="panel.setup-failed" role="alert">${body}</div>`;
  } else return hideCover();
  placeCover();
}
