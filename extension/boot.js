/*
 * walkdown inside the application, delivered by the browser rather than by the
 * page.
 *
 * This runs in the frame the application is loaded into while a tab is
 * reviewing it, and its only job is to put the embed there — the panel lives
 * one level up, in walkdown's own page, where the application cannot reach it.
 * Everything runs in the extension's ISOLATED world: the embed still sees the
 * page's DOM, but nothing it defines is reachable from the page's own scripts,
 * and the page cannot reach in.
 *
 * On every other page this does nothing at all. A tool that decides what you
 * are looking at is not one you want guessing.
 */
(async () => {
  let answer;
  try {
    answer = await chrome.runtime.sendMessage({ type: 'walkdown:role' });
  } catch {
    return;   // the worker is gone; stay out of the page entirely
  }
  if (answer?.role !== 'embed') return;

  window.__walkdownConfig = {
    // The panel settles the server and the blueprint and tells the embed
    // through the framed conversation; nothing down here needs to store them.
    server: 'http://localhost:4700',
    bp: '',
    stylesheet: chrome.runtime.getURL('walkdown.css'),
    anchorAttribute: 'data-testid',
  };

  try {
    await import(chrome.runtime.getURL('vendor/embed.js'));
  } catch (err) {
    console.warn('[walkdown] could not start:', err);
  }
})();
