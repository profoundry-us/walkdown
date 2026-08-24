/*
 * walkdown, delivered by the browser rather than by the page.
 *
 * The panel and the embed are unchanged — this only answers the questions a
 * <script> tag used to answer (which server, which blueprint, where the
 * stylesheet is) and then loads them. Everything runs in the extension's
 * ISOLATED world: they still see the page's DOM and still see each other, but
 * nothing they define is reachable from the page's own scripts, and the page
 * cannot reach in. That is stronger isolation than the script-tag delivery has.
 *
 * walkdown stays completely absent until a project is chosen for this origin
 * in the popup. A tool that decides what you are looking at is not one you
 * want guessing.
 */
const SITES = 'walkdown:sites';

(async () => {
  let sites = {};
  try {
    sites = (await chrome.storage.local.get(SITES))[SITES] ?? {};
  } catch {
    return;   // storage unavailable: stay out of the page entirely
  }
  const site = sites[location.origin];
  if (!site?.on) return;

  window.__walkdownConfig = {
    server: site.server || 'http://localhost:4700',
    // Deliberately not chosen here. Which blueprint a site is gets asked once,
    // in the panel, where the descriptions are readable — the popup only
    // decides whether walkdown runs at all.
    bp: site.bp || '',
    stylesheet: chrome.runtime.getURL('walkdown.css'),
    anchorAttribute: site.anchorAttribute || 'data-testid',
    // The panel remembers its choices in the extension's own storage, so they
    // survive a site clearing its data and never touch the page's localStorage.
    store: {
      get: async (k) => (await chrome.storage.local.get(k))[k] ?? null,
      set: async (k, v) => chrome.storage.local.set({ [k]: v }),
    },
  };

  try {
    // Order matters: the panel's tool bar mirrors pin mode, which the embed owns.
    await import(chrome.runtime.getURL('vendor/embed.js'));
    await import(chrome.runtime.getURL('vendor/panel.js'));
  } catch (err) {
    console.warn('[walkdown] could not start:', err);
  }
})();
