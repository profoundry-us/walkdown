# ADR 0002 — Claude Desktop extensions, and why walkdown is not one yet

- **Status:** accepted
- **Date:** 2026-09-10
- **Deciders:** Topher (product, eng)
- **Revisit when:** Claude Desktop lets an extension add a panel, tab or
  sidebar of its own, rather than a tool or an in-conversation view. See
  "Deferred, deliberately" at the end.

## Context

Claude Desktop has a drop zone: "Drag .MCPB or .DXT files here to install".
The question was what that installs, and whether walkdown could live inside
the desktop app as a panel instead of beside it in a browser.

What was found on 2026-09-10, from the format's own documentation:

1. **An extension is a packaged local MCP server.** An `.mcpb` (formerly
   `.dxt`, still accepted) is a zip holding a `manifest.json`, a stdio MCP
   server and its bundled `node_modules`. Claude Desktop ships its own Node,
   so a Node bundle installs with one click and needs nothing from the
   machine. The manifest names the command, the tools and prompts, and a
   `user_config` block that the app turns into a settings form, with
   directory pickers and keychain storage for anything marked sensitive.
   Once installed, the server's tools appear to Claude in chat. Nothing in
   the format adds a sidebar, tab or panel to the application.
2. **The only UI an extension can offer is an MCP App.** Since 2026-01-26 a
   tool may declare `_meta.ui.resourceUri` pointing at a `ui://` HTML
   resource, and Claude Desktop renders it in a sandboxed iframe *inside the
   conversation*. The iframe can call the server's tools over postMessage,
   receive tool results the host pushes, and update the model's context. It
   cannot touch the parent page, and it reaches external origins only through
   a CSP the resource declares. A May 2026 bug report says the Windows build
   falls back to text rather than rendering; macOS was not checked.

Against walkdown's three surfaces:

- **The board** (status, rules, threads, questions, runs ledger, the
  incorporate queue) is reads and writes over `lib/`. It would fit a stdio
  server wrapping `lib/api.js` without argument.
- **The panel** (`lib/viewer/panel.js`) could ship as the `ui://` resource,
  but it talks to `walkdown serve` over HTTP. Inside the iframe it would need
  either a CSP hole to `localhost:4700` or a second data backend that speaks
  MCP tools through the app bridge. The second is the honest one and is real
  work, since the panel's data layer assumes `fetch`.
- **The review surface does not fit at all.** The browser extension's whole
  reason to exist (`extension/README.md`) is framing the application under
  review and stripping the headers that refuse the frame. An MCP App iframe
  is double-sandboxed: it cannot frame arbitrary sites and cannot remove
  anything. Walking a running app down cannot move into the desktop app.

## Decision

### 1. Walkdown does not become a Claude Desktop extension now

The thing asked for, a walkdown panel inside Claude Desktop, is not something
the extension surface can hold. What it can hold is a tool server and an
in-conversation view, and neither is the surface people use walkdown through.
Building the MCP side on its own would give Claude in chat a way to answer a
thread or record a run, which is useful, but it is not the integration that
was asked about, and it should not be mistaken for it.

### 2. When walkdown does speak MCP, it is one server, not a desktop-only one

If and when a `walkdown` MCP server is built, it wraps `lib/api.js` and is
registered the ordinary way for Claude Code as well, the way Highball's is in
this repository. Packaging it as an `.mcpb` is then a `manifest.json` and a
`mcpb pack`, not a separate codebase. Nothing is built for the desktop app
alone.

### 3. The review surface stays in the browser

The extension in `extension/` remains the only delivery that can isolate the
application it is reviewing. No amount of desktop-app support changes that
until the desktop app can frame a third-party page and take its headers off.

## Consequences

### Good

- Nothing is built against a surface that cannot hold it.
- The eventual MCP server has one shape and two hosts, instead of a desktop
  bundle and a Code-tab registration that drift.

### Bad, and accepted

- Claude in chat cannot see the board today. Answering a question thread or
  filing a note from a desktop conversation means opening the panel.

### Deferred, deliberately

- **A walkdown panel in Claude Desktop.** Revisit if Claude Desktop begins to
  offer real UI extension support: an extension that can contribute a panel,
  tab or sidebar of its own, with room to frame a page, rather than a view
  rendered inside one conversation. The moment that exists, decisions 1 and 3
  are open again and this ADR is superseded. Check the Claude Desktop release
  notes and the MCP Apps client matrix before assuming nothing has moved.
- **The MCP server itself.** Not refused, just not asked for. The trigger for
  building it is wanting Claude in chat to act on the board, not the desktop
  app's drop zone.

## Sources

- Build a desktop extension with MCPB: https://claude.com/docs/connectors/building/mcpb
- MCPB manifest spec (v0.3): https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
- Adopting the MCP Bundle format: https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/
- MCP Apps overview: https://modelcontextprotocol.io/extensions/apps/overview
- Claude Desktop MCP Apps rendering report: https://github.com/modelcontextprotocol/ext-apps/issues/671
