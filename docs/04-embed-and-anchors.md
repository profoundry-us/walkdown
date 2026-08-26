# 04 — Embed & anchors

## The anchor convention

Every element the blueprint cares about carries a stable identity, shared verbatim by the
prototype and the built app. **An anchor is the ID value plus its registry entry — not the
attribute.** The attribute that carries it is configurable per project and defaults to
**`data-testid`**, deliberately reusing the test-id convention the ecosystem already
standardized on rather than inventing a parallel one:

- **Playwright**: `page.getByTestId('checkout.submit')` works with zero configuration —
  `data-testid` is its default, and projects that pick a different attribute set the same
  value in `testIdAttribute` (Playwright config) that they set in `walkdown.yml`.
- **Testing Library** (React/Vue unit tests): `getByTestId` — same default attribute.
- **Capybara** (Rails workflow specs): set `Capybara.test_id = "data-testid"` and the
  built-in matchers (`click_button`, `find_field`, …) match anchors natively.

```html
<!-- prototype (Claude Design output) -->
<button data-testid="checkout.submit">Pay now</button>
```

```erb
<%# built app (Rails/ERB) %>
<%= f.submit "Pay now", data: { testid: "checkout.submit" } %>
```

```yaml
# blueprint/walkdown.yml
embed:
  anchor_attribute: data-testid   # default; the embed, lint, and check authoring all read this
```

Reuse cuts both ways, so the rule that keeps it honest: **anchor values must follow
walkdown's rules regardless of attribute** — dot-namespaced, globally stable, declared in
the storyboard. A legacy codebase with a pile of local, non-namespaced test ids
(`"submit-button"` on five screens) has two options: migrate those values to namespaced
ones (usually the right call — it improves their tests too), or set
`anchor_attribute: data-anchor` and keep the two conventions side by side. `walkdown lint`
validates value shape and storyboard membership either way; it never cares which attribute
carries them.

This one convention is the keystone of the system. It costs almost nothing (we control
both generators — the design tool emits anchors, and the builder agent is instructed to
carry them over) and it buys:

- **Element-precise feedback** — pins attach to `checkout.submit`, not to coordinates on a
  screenshot, so they survive layout changes and mean the same thing in both surfaces.
  When no anchored element sits under the click, the pin is still placed and recorded by
  its `{x, y}` — feedback is never blocked by a missing anchor. Positioned pins are the
  fallback, not the norm: they render as squared markers and are a standing hint that the
  spot deserves an anchor.
- **Resilient checks** — generated tests select `getByTestId('checkout.submit')` (or the
  Capybara equivalent) instead of brittle CSS paths.
- **Cheap coverage checking** — "does every anchor referenced by the blueprint exist in
  the built app?" is a DOM query.
- **Screen detection** — the embed infers which storyboard screen it is on from the
  anchors present (plus the URL).

Anchor IDs are dot-namespaced (`<screen-or-domain>.<element>`), declared (optionally) per
screen in the storyboard for linting.

Production builds ship without the embed, but **anchors can stay in production markup** —
they are inert data attributes, and stripping them is an optional build step, not a
requirement. (Teams that already strip `data-testid` from production bundles can keep
doing so; nothing in walkdown runs in production.)

## The embed script

A small, dependency-free script injected into the prototype and dev/staging builds.
Responsibilities:

1. **Element picking** — hover-highlight anchored elements; click to attach a note or
   question to `{screen, element}`, falling back to `{screen, position}` where nothing
   anchored sits under the cursor. Escape leaves pin mode. walkdown's own chrome —
   the badge, an open form, an existing pin, the docked panel — is never a pin target,
   so the way out is never swallowed by the mode you are trying to leave.
2. **Pin rendering** — draw open threads at their anchors (or their recorded positions) so
   feedback is seen in place.
3. **Screen reporting** — announce the current screen (URL + anchor fingerprint) so the
   panel can track where the user is.
4. **Navigation duty** — respond to "go to screen X" commands using the storyboard's
   locator for its surface.

It auto-detects its transport:

- **Framed** (inside walkdown's own page — the extension's review document, or the ghost
  overlay in either layout): a `postMessage` handshake with the parent; all traffic flows
  through the panel.
- **Standalone** (opened directly, or docked beside the panel in the app's own document):
  HTTP to the local walkdown server (`http://localhost:4700`), which writes threads
  straight into `blueprint/threads/`.

## Injection per surface — boring on purpose

| Surface | Mechanism |
|---|---|
| Prototype | Claude Design emits the tag in every export. |
| Dev app | Documented one-liner, gated on env: `<script src="http://localhost:4700/embed.js" data-walkdown></script>` — the embed only, served by `walkdown serve`, so the version always matches; fails silently when the server isn't running. It gives the page anchored pins when walkdown frames it. The panel does not travel this way: it needs a frame to review, and a page cannot frame itself. |
| Staging | Same snippet baked in behind an env flag (`WALKDOWN_EMBED=1`), loading `embed.js` from the app's own assets (bundled at build) since localhost may not be serving. |
| **Any page at all** | **The browser extension** ([extension/](../extension/)) — no markup change, so it reaches applications nobody can edit. Installed once; the reviewer chooses a blueprint per origin. |
| Production | Never. |

The embed answers *which server, which blueprint, which anchor attribute* through its own
tag attributes; the extension's bootstrap leaves the same answers on
`window.__walkdownConfig` before loading the very same file. A page carrying both gets one
instance, not two — the guard lives on the DOM rather than on `window`, because a content
script and a page script do not share a global.

**Until 2026-08-26 the panel travelled by script tag too**, docking into the application's
own document rather than framing it. That cost the application one line and the reviewer
no install, which is genuinely cheaper — and it was withdrawn anyway. Everything the frame
boundary gives for free, docking had to fight for: the browser's top layer to stay above
the app's modals, a reset for the inheritable CSS the host bled through our shadow root,
insetting the host's body and restoring it exactly on the way out. Eleven rules and the
most defensive code in the project, for an audience that never arrived. The panel is now
the extension's alone; the embed still travels either way.

**The example app carries no tags at all**, on purpose: it is reviewed through the
extension, the way an application nobody can edit would be.

## The staging trick (why v1 needs no backend)

The embed runs in **the reviewer's browser**, so `localhost` is *their* machine. Browsers
treat localhost as a trustworthy origin, so an HTTPS staging page is permitted to POST to
`http://localhost:4700`. Result: a PM verifying against staging still writes notes and
walkdown results **directly into their local checkout's blueprint files** — no hosted
receiver, no auth, and the feedback arrives as ordinary file changes the agent can read.

Requirements on the local server:

- Answer CORS preflights, including the Private Network Access header
  (`Access-Control-Allow-Private-Network: true`) for requests from public HTTPS origins.
- Allowlist origins per project config (`embed.allowed_origins`) rather than `*`.
- Bind to `127.0.0.1` only.

Failure mode: if no local server is reachable, the embed queues writes in
`localStorage` and shows an "offline — start `walkdown serve` and retry" badge, so
feedback given before the server starts isn't lost.

## Two layouts, one panel

A cross-origin iframe seals its DOM off from the parent — a wrapper alone cannot pick
elements, read the current URL, or render pins. So the embed script is the one true
mechanism; where the panel stands relative to the page is just layout, and there are two:

**Docked** — the script-tag delivery. The panel is injected into the application's own
document and pushes it aside: the app keeps its tab, its URL bar, its full width. The
prototype appears as the **ghost** — the storyboard screen's design rendered in a frame
over the app and faded with a slider — so comparing never costs the app half the window.
What the app positions against the viewport (native dialogs, full-screen overlays) is
beyond this layout's reach, which is why the second layout exists.

**Framed** — the extension delivery. walkdown owns the document: the application renders
inside an iframe lying as a sheet on walkdown's desk, panel alongside. A frame boundary
is real isolation — the app's modals center against the frame, and the `inert` a native
`<dialog showModal()>` imposes stops at the frame's edge instead of freezing walkdown's
own chrome. Pages that refuse framing render anyway: the extension strips
`X-Frame-Options`/`frame-ancestors` from sub-frame responses with session-scoped rules,
added when a review starts on that tab and removed when it ends. The ghost works the
same way, fading over the frame.

In both layouts:

- Picking a rule takes the surface under review to that rule's screen via the
  storyboard's locators.
- Stepping through rules advances a human walkdown session
  ([05-runs-ledger.md](05-runs-ledger.md)).
- The ghost and the framed app talk to the panel over `postMessage`; the panel persists
  through the local server.

## Security posture

- The embed is dev/staging tooling; it must never be reachable in production builds
  (env-gated at build time, not runtime-hidden).
- The local server accepts writes only for the currently-open project directory and only
  into `blueprint/threads/` and `blueprint/runs/` (append paths) — never arbitrary files.
- Embed payloads are data (thread YAML), never executed.
