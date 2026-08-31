/*
 * How threads are said in text: status colour and the anchor digest. Shared
 * by every command that lists or shows a thread, so a thread reads the same
 * in `status`, `threads` and `thread`.
 */
import { dim, green, yellow } from './tty.js';

const STATUS_COLOR = {
  open: yellow,
  answered: yellow,
  addressed: green,
  incorporated: green,
  verified: green,
  waived: dim,
};
const paintStatus = (s) => (STATUS_COLOR[s] ?? ((x) => x))(s);

/*
 * The shortest true thing about where a thread is anchored, for a digest line.
 * A rule is the usual answer, but the ownership rules ask for design requests
 * anchored to a SCREEN and nothing else - and reading those back as
 * "unanchored" said the opposite of what filing one means.
 */
function anchorLabel(a = {}) {
  if (a.rule) return a.rule;
  if (a.element) return a.element;
  if (a.screen) return `screen ${a.screen}`;
  return 'unanchored';
}

function anchorText(a = {}) {
  return (
    [
      a.rule && `rule ${a.rule}`,
      a.screen && `screen ${a.screen}`,
      a.element && `element ${a.element}`,
    ]
      .filter(Boolean)
      .join(' · ') || '(unanchored)'
  );
}

export { anchorLabel, anchorText, paintStatus };
