/*
 * The panel's transient word to the reviewer.
 */
import { D, GAP, S, W } from './state.js';

/*
 * What a toast is telling you, in colour. Written as whole class names - a
 * template-built `alert-${tone}` is a class Tailwind's scanner never sees,
 * and the rule would be missing from the built sheet.
 *
 * The mapping is the panel's existing one: green for something recorded,
 * red for a refusal or a write that did not land, yellow for a question the
 * toast is asking, and neutral for a plain statement of fact. Nothing here
 * invents a fifth voice.
 */
const TOAST_TONE = {
  neutral: 'alert-neutral',
  success: 'alert-success',
  warning: 'alert-warning',
  error: 'alert-error',
};

export function toast(html, { sticky = false, on = null, tone = 'neutral' } = {}) {
  const t = document.createElement('div');
  // The container is the positioned box and the one with the cap, so what
  // is measured against the frame is what was placed.
  t.className = 'toast pointer-events-auto max-h-40 overflow-y-auto';
  t.dataset.testid = 'panel.toast';
  t.dataset.theme = 'blueprint';
  /*
   * Inside the app frame, the same distance from its bottom edge as from
   * its right (n-0324). The frame sits GAP in from the window's bottom and
   * W + 2*GAP in from its right while the panel is out; put away, it is the
   * window. It used to hang off the panel's edge, half over the desk.
   */
  const rect = D.appFrame?.getBoundingClientRect?.();
  const inFrame = rect && rect.width > 0 && rect.height > 0;
  // Measured from the frame as drawn - it is scaled to fit and centred on
  // the desk, so its edges are not where the window's are.
  const right = inFrame ? innerWidth - rect.right + GAP : (S.docked ? W + GAP * 2 : 0) + GAP * 2;
  const bottom = inFrame ? innerHeight - rect.bottom + GAP : GAP * 2;
  t.style.cssText = `right:${right}px; bottom:${bottom}px; max-width:min(24rem, 60vw);`;
  /*
   * And a size it cannot outgrow (n-0325): a Finish that closed sixteen
   * threads listed every id and ran off the top of the page. Past the cap
   * it scrolls, and a block (not a flex row) so long text wraps.
   */
  t.innerHTML = `<div class="alert ${TOAST_TONE[tone] ?? TOAST_TONE.neutral} block whitespace-normal text-[13px]">${html}</div>`;
  if (on)
    for (const [name, fn] of Object.entries(on))
      t.querySelector(`[data-sitting="${name}"]`)?.addEventListener('click', () => {
        t.remove();
        fn();
      });
  // Onto the shell, not into the panel: render() rewrites the panel's markup
  // wholesale, and the things worth toasting - a verdict recorded, a thread
  // ended - are exactly the things that trigger a repaint, so a toast living
  // in there was swept away in the same tick it appeared.
  D.host.appendChild(t);
  if (!sticky) setTimeout(() => t.remove(), 4200);
}
