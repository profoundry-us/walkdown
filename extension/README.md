# walkdown — browser extension (unpacked)

walkdown, delivered by the browser instead of by the page — and, more than that,
the only delivery that can isolate the application it is reviewing.

A script tag reaches only apps whose markup you can edit, and it has to live in
the application's own document, where the application owns the viewport:
anything it positions against that viewport ignores the inset the panel gives
it, and a native `<dialog showModal()>` makes everything outside it inert. The
extension frames the app instead, giving it a viewport of its own — and takes
off the headers that would refuse the frame. Both are things only an extension
can do.

Not published anywhere, and not meant to be yet — load it unpacked.

## Install

`vendor/` and `walkdown.css` are committed, so this directory is ready to load
as it stands — no build needed first.

1. Run the server in your project: `walkdown serve` (defaults to `localhost:4700`).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked**, and pick this `extension/` directory.
4. Visit the app you want to review and click the walkdown toolbar icon. The tab
   opens walkdown's own page with that app framed inside it, and asks which
   blueprint this site is.

The button is the whole interface: click to review this page, click again to go
back to it — at whatever URL the app has reached, not the one you started from.
The icon says which of the two states it is in, since without a popup there is
nowhere else to see that. Which server and which blueprint are asked in the
panel's **Blueprints** tab, where the descriptions are readable and you can see
what you are choosing between; both answers are remembered per origin.

Until you click it, the extension does nothing at all on any page — a tool that
guesses what you are looking at is not one you want running everywhere.

## Rebuilding

`vendor/` and `walkdown.css` are copies, not sources. After changing
`lib/viewer/*`, rebuild them **from the repository root** — `walkdown/`, the
directory holding `package.json`, not its parent:

```bash
cd path/to/walkdown && npm run build
```

Chrome caches an unpacked extension's files, so hit **Reload** on the extension
card afterwards and reload the page.

## How it fits together

`background.js` owns one piece of state — which tabs are reviewing, and what
they are reviewing — and paints the button to match. Starting a review it also
adds a **session** rule that removes `X-Frame-Options` and the CSP from framed
responses. Scoped to that one tab, and dropped the moment the review ends: the
rule exists to let walkdown frame a page, not to leave a hole open.

`review.html` is walkdown's page. `boot-host.js` answers the questions a
`<script>` tag used to answer on `window.__walkdownConfig`, adds the URL to
frame, and loads `panel.js`. `boot.js` runs in the framed application, asks the
background whether this tab is reviewing, and loads `embed.js` there — the
embed belongs with the anchors, the panel belongs outside where the app cannot
reach it. The two talk by `postMessage`: the frame reports where it is and what
was pinned, the panel answers with the screen, the surface and pin mode.

It is the same `embed.js` and `panel.js` the server delivers to a script tag.
One implementation, two deliveries; forking it would guarantee the two drift.

Everything the extension loads runs in its **isolated world**: it sees the
page's DOM but nothing it defines is reachable from the page's own scripts, and
the page cannot reach in.

## Known limits

- **Anchors still have to exist.** The extension removes the injection barrier,
  not the anchor barrier. On a page with no `data-testid`, pins fall back to
  coordinates: feedback still lands, but it no longer survives a layout change.
- **The server must be reachable.** The panel reads and writes through
  `walkdown serve` on localhost. Chrome treats localhost as trustworthy, so an
  HTTPS page can reach it, but the server has to be running.
- **The frame is the app's viewport.** Framed, the application is laid out at
  the size of the sheet rather than the whole window — which is what makes its
  modals behave, and also means you are judging it at that width. Say what
  viewport you reviewed at.
- **Frame-busting scripts are not headers.** A page whose own JavaScript checks
  `top !== self` and navigates away is not stopped by removing a header.
- **Chrome/Chromium only** so far. The manifest is MV3 and mostly portable;
  Firefox and Safari have not been tried.
