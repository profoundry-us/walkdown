/*
 * The panel's transient word to the reviewer.
 */
import { D, W } from './state.js';

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
  t.className = 'toast toast-end pointer-events-auto';
  t.dataset.theme = 'blueprint';
  t.style.right = `${W + 18}px`;
  t.innerHTML = `<div class="alert ${TOAST_TONE[tone] ?? TOAST_TONE.neutral} text-[13px]">${html}</div>`;
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
