# walkdown — browser extension (unpacked)

walkdown's panel, delivered by the browser instead of by the page. The point is
reach: a script tag only works on apps whose markup you can edit, and framing is
refused by anything that sets `X-Frame-Options`. An extension has neither limit.

Not published anywhere, and not meant to be yet — load it unpacked.

## Install

`vendor/` and `walkdown.css` are committed, so this directory is ready to load
as it stands — no build needed first.

1. Run the server in your project: `walkdown serve` (defaults to `localhost:4700`).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked**, and pick this `extension/` directory.
4. Visit the app you want to review and click the walkdown toolbar icon. The tab
   reloads, the panel docks, and it asks which blueprint this site is.

The button is the whole interface: click to start, click again to stop. It wears
an **on** badge for sites walkdown is running on, since without a popup there is
nowhere else to see that. Which server and which blueprint are asked in the
panel's **Blueprints** tab, where the descriptions are readable and you can see
what you are choosing between — and both answers are remembered per origin.

Until you turn it on for a site, the extension does nothing at all on any page —
a tool that guesses what you are looking at is not one you want running
everywhere.

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

`background.js` owns one piece of state — whether walkdown is on for an origin —
and paints the button to match. `boot.js` reads that, answers the questions a
`<script>` tag used to answer on `window.__walkdownConfig`, and imports the same
`embed.js` and `panel.js` that the server delivers. One implementation, two
deliveries; forking it would guarantee the two drift.

Both run in the extension's **isolated world**. They see the page's DOM and each
other, but nothing they define is reachable from the page's own scripts and the
page cannot reach in — stronger isolation than the script tag gets.

## Known limits

- **Anchors still have to exist.** The extension removes the injection barrier,
  not the anchor barrier. On a page with no `data-testid`, pins fall back to
  coordinates: feedback still lands, but it no longer survives a layout change.
- **The server must be reachable.** The panel reads and writes through
  `walkdown serve` on localhost. Chrome treats localhost as trustworthy, so an
  HTTPS page can reach it, but the server has to be running.
- **Chrome/Chromium only** so far. The manifest is MV3 and mostly portable;
  Firefox and Safari have not been tried.
