/*
 * The panel's entry point, and deliberately nothing else.
 *
 * The graph below is a DAG now. The panes used to import the behaviour they
 * triggered — render, open, goTo — from app.js while app.js imported them
 * back, a cycle rollup had to be told to excuse. Today a pane renders
 * templates and either calls a module that owns the action (conversation.js,
 * shell.js) or fires a wd-* event the shell catches at the root; nothing
 * imports app.js. The entry holds one import and no code of its own; app.js
 * calls boot() at the foot of its own body, where it always did.
 */
import './app.js';
