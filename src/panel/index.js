/*
 * The panel's entry point, and deliberately nothing else.
 *
 * The panes import the behaviour they trigger — render, open, goTo, start —
 * from app.js, and app.js imports the panes back. That cycle is inherent to a
 * user interface whose controls cause the thing that drew them to be redrawn,
 * and it is safe here for one reason: nothing crosses the cycle at module
 * evaluation time. Every import is called from a handler or a render, long
 * after both bodies have run. It is the same invariant Phase 2b wrote down
 * for D, applied to functions instead of elements.
 *
 * What the cycle must NOT include is the entry, because the entry is where
 * evaluation order stops being something Rollup can reason about. So the
 * entry holds one import and no code of its own; app.js calls boot() at the
 * foot of its own body, where it always did.
 */
import './app.js';
