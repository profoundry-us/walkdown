/*
 * The three things a pane or module below the shell may ask of it: repaint,
 * refetch, open Settings. Nothing else — this is a narrow, named interface,
 * not a registry, and growing it needs the same argument a lint rule needs.
 *
 * It exists to break the one cycle that kept rollup's whitelist alive: every
 * pane needed render() and reached back into app.js for it, which made the
 * hub of the graph also its floor. The shell provides these at boot; until
 * then each is a safe no-op, because a module evaluated before boot has
 * nothing to repaint anyway.
 */
let shell = {
  render: () => {},
  reload: async () => {},
  settings: () => {},
};

/** app.js, once, at boot. */
export function provideShell(impl) {
  shell = impl;
}

/** Repaint the panel from S. */
export const requestRender = () => shell.render();

/** Refetch the blueprint payload, then repaint. */
export const requestReload = () => shell.reload();

/** Open Settings (the gear) — where refusals about identity send people. */
export const openSettings = () => shell.settings();
