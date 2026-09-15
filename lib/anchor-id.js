/*
 * An anchor is the element's ID, never a selector for it. Judges filing from
 * the CLI wrote the selector they had been driving - `[data-testid="x"]` -
 * and every such thread read as anchored to something the storyboard never
 * declared, while the element it named was declared all along. This unwraps
 * the one form the config's anchor attribute makes unambiguous and leaves
 * anything else as typed: the door applies it on the way in, and lint on the
 * threads that came in before it did.
 */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @param {unknown} element @param {string} [attr] */
export function anchorId(element, attr = 'data-testid') {
  if (typeof element !== 'string') return element;
  const m = element.trim().match(new RegExp(`^\\[${escape(attr)}=["']([^"']+)["']\\]$`));
  return m ? m[1] : element;
}
