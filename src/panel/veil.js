/*
 * The loading veil: what the panel says while the frame is fetching.
 *
 * It lives in the HOST document beside the frame rather than in the shadow
 * root, which is why it carries its styles inline, and it is marked as
 * walkdown's own chrome so pin mode ignores it.
 */
import { D } from './state.js';

/*
 * While the frame is fetching, say so. A page that takes its time leaves the
 * PREVIOUS screen on display, and a reviewer reads that as a walkdown that
 * went somewhere wrong rather than one still on its way - the slower the app,
 * the longer it lies (n-0071).
 *
 * Held back by a short delay, because a veil that flashes on every quick load
 * is its own kind of noise. Lives in the host document beside the frame, so
 * it carries its styles inline, and it is marked as walkdown's own chrome so
 * pin mode ignores it.
 */
const VEIL_DELAY = 180;
let veil = null;
let veilTimer = null;

/** Whether a veil is currently up — the frame's placement asks before it schedules. */
export const veilIsUp = () => Boolean(veil);

export function placeVeil() {
  if (!veil || !D.appFrame) return;
  const r = D.appFrame.getBoundingClientRect();
  veil.style.top = `${r.top}px`;
  veil.style.left = `${r.left}px`;
  veil.style.width = `${r.width}px`;
  veil.style.height = `${r.height}px`;
}

function showVeil(label) {
  if (!D.appFrame) return;
  if (!veil) {
    veil = document.createElement('div');
    veil.dataset.walkdownChrome = '';
    veil.dataset.testid = 'panel.frame-loading';
    veil.dataset.theme = 'blueprint';
    veil.style.cssText = `position:fixed; z-index:2147483004; border-radius:10px;
      display:flex; align-items:center; justify-content:center; gap:.55rem;
      background:rgba(255,255,255,.82); backdrop-filter:blur(1.5px);
      font:500 13px/1.4 ui-sans-serif, system-ui, sans-serif; color:#334155;
      pointer-events:none; transition:opacity .15s ease;`;
    veil.innerHTML = `<span style="width:14px;height:14px;border:2px solid currentColor;
        border-right-color:transparent;border-radius:50%;display:inline-block;
        animation:wdspin .7s linear infinite;opacity:.65"></span><span class="wd-veil-label"></span>
      <style>@keyframes wdspin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(veil);
  }
  veil.querySelector('.wd-veil-label').textContent = label;
  placeVeil();
}

export function hideVeil() {
  clearTimeout(veilTimer);
  veilTimer = null;
  veil?.remove();
  veil = null;
}

/** The frame is going somewhere: promise a veil if it does not arrive fast. */
/*
 * Short enough to read at a glance. Screen titles carry a parenthetical
 * saying which state they are - useful in a list, too long for a veil.
 */
export function screenLabel(screen) {
  const name = String(screen?.title ?? screen?.id ?? 'the page');
  const plain = name.split('(')[0].trim() || name;
  return plain.length > 38 ? `${plain.slice(0, 37)}…` : plain;
}

export function frameLoading(url, label) {
  if (!D.appFrame) return;
  hideVeil();
  veilTimer = setTimeout(() => showVeil(label), VEIL_DELAY);
}
