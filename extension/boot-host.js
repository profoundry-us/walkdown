/*
 * The host side of the framed delivery.
 *
 * This page IS walkdown — the app under review is a frame inside it. That is
 * the difference between this and the injected delivery: docked beside a page,
 * walkdown lives in the application's own document, where the application owns
 * the viewport. Anything it positions against that viewport — a modal, a
 * backdrop, a sticky header — ignores the margin walkdown insets the page by,
 * and a native <dialog showModal()> additionally makes everything outside it
 * inert. A frame ends all of that by giving the app a viewport of its own.
 *
 * Only the panel loads here. The embed belongs inside the frame, with the
 * application it is anchoring to, and boot.js puts it there.
 */
const target = decodeURIComponent(location.hash.slice(1));

if (!target) {
  document.body.textContent = 'walkdown: no page to review.';
} else {
  window.__walkdownConfig = {
    // Only a starting point; the panel's Blueprints tab settles and remembers it.
    server: 'http://localhost:4700',
    // Asked once in the panel, where the descriptions are readable.
    bp: '',
    stylesheet: chrome.runtime.getURL('walkdown.css'),
    /*
     * The extension re-injects itself into whatever page loads next — its
     * content script matches every URL — so unlike a script tag, walkdown
     * survives a real navigation and can simply take you where you asked to
     * go. A page carrying walkdown by <script> cannot: navigating unloads the
     * very script drawing the panel, so it offers the trip instead.
     */
    reinjects: true,
    anchorAttribute: 'data-testid',
    // The panel's choices live in the extension's own storage, so they survive
    // a site clearing its data and never touch any page's localStorage.
    store: {
      get: async (k) => (await chrome.storage.local.get(k))[k] ?? null,
      set: async (k, v) => chrome.storage.local.set({ [k]: v }),
    },
    // What makes this the framed delivery rather than the docked one.
    frame: { url: target },
  };

  document.title = `walkdown — ${new URL(target).host}`;
  (async () => {
    // The vendored copy only updates when the extension itself is reloaded.
    // Hash what we actually run, so the panel can compare it against what the
    // server ships and say plainly when this copy has gone stale — a stale
    // walkdown reviewing a moving spec quietly undermines every verdict.
    try {
      const src = await (await fetch(chrome.runtime.getURL('vendor/panel.js'))).text();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
      window.__walkdownConfig.buildHash = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 12);
    } catch {
      /* undetectable staleness beats not starting */
    }
    import(chrome.runtime.getURL('vendor/panel.js')).catch((err) =>
      console.warn('[walkdown] could not start:', err),
    );
  })();
}
