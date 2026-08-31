/*
 * The two helpers everything else needs: escaping, and where the server is.
 *
 * They are here rather than in state.js because state has no dependencies and
 * these have one — api reads S — and because a module named for what it holds
 * beats a module named for where things happened to end up.
 */
import { S } from './state.js';

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/*
 * The blueprint rides along as a query parameter — and it has to go BEFORE any
 * fragment, or the fragment swallows it: "#invite-batch?bp=..." is one
 * fragment named that, not a query, so the server never sees the blueprint and
 * the screen never sees its own fragment.
 */
export const api = (path) => {
  const h = path.indexOf('#');
  const head = h < 0 ? path : path.slice(0, h);
  const frag = h < 0 ? '' : path.slice(h);
  const q = S.BP ? (head.includes('?') ? '&' : '?') + 'bp=' + encodeURIComponent(S.BP) : '';
  return S.SERVER + head + q + frag;
};
