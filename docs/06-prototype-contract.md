# 06 — The prototype contract

## Why a contract at all

A prototype is one of the four surfaces the blueprint keeps in sync
([00-vision.md](00-vision.md)), and the only one produced by a generator. Today that
means someone reads the prototype and describes it to walkdown: types screen ids into a
storyboard, copies anchor names, keeps the two in step by hand.

That is backwards. If the design tool follows a contract, **the prototype ships the facts
about itself** and walkdown reads them. The storyboard stops being transcription and
becomes a merge.

This document is what we hand a design tool — Claude Design today, anything else later —
so its output is walkdown-ready. It asks for five things, and exactly one of them is
load-bearing.

## 1. Anchors are a contract, not a convenience

**The rule that matters more than the other four put together: an anchor id, once
emitted, never changes.** Not when the screen is redrawn, not when the element moves,
not when the copy changes, not when the component is replaced.

Everything downstream is attached by that id — pins, threads, checks, rules, run history.
Rename `checkout.submit` to `checkout.submit-button` on a regeneration and every one of
those detaches silently: the pins stop rendering, the checks stop selecting, and the
blueprint still lints clean because nothing it references is *missing* — it is just
pointing at an element that no longer answers to that name.

- Attribute: **`data-testid`** by default (`embed.anchor_attribute` overrides it).
- Value: dot-namespaced `<screen-or-domain>.<element>` — `waitlist.submit`,
  `checkout.line-item`.
- Stable, globally unique, and lowercase-kebab within each segment.
- Emit them on every element the design intends as *meaningful*: controls, headings,
  status text, list containers, empty states, error messages. Not on layout wrappers.

Repeated elements (rows, cards) share one anchor on the container; the individual
instances are addressed by position within it, not by inventing `row-1`, `row-2`.

## 2. One screen, one file, one URL

Every distinct state a reviewer needs to reach directly is its own file with its own
path. A prototype that can only be navigated by clicking through cannot be deep-linked,
and a walkdown is a sequence of deep links.

```
screens/waitlist-join.html
screens/waitlist-confirm.html
screens/waitlist-admin.html
```

Screen ids are kebab-case, stable across regenerations for the same reason anchors are,
and match the file name.

**States that a URL fragment expresses are separate screens.** Modals, drawers, tabs and
SPA routes are exactly the states worth walking down, and they are addressed by
fragment:

```
/orders#/order/1234        an SPA route
/settings#billing          a tab
/waitlist#invite-batch     an open dialog
```

So **a screen is identified by origin + path + fragment**, and the fragment is
significant. Query strings are *not*: `?page=2` is the same screen holding different
data, and forking the storyboard on every filter would be absurd. A query written into
the storyboard still does one job — it tells apart two screens that share a path, as
`/confirm.html` and `/confirm.html?already=1` do — but the constraint that a page belongs
to exactly one blueprint is read on origin + path + fragment alone.

A fragment nobody has enumerated yet resolves to the screen at that path. At
`/orders#/order/1234` with only `/orders` in the storyboard you are, correctly, on the
orders screen; writing the route down later sharpens the answer without breaking the one
you had.

The consequence for a prototype: reaching a fragment state must actually render it on
load, not only after a click. If `#invite-batch` is only reachable by pressing the
button, it is not a screen.

## 3. The manifest

Alongside the screens, the export ships one file describing them. This is what turns
transcription into a merge:

```yaml
# walkdown.prototype.yml — emitted by the design tool, read by `walkdown extract`
version: 1
generated: 2026-08-24T09:15:00Z
generator: claude-design
screens:
  - id: waitlist-join
    title: Join the waitlist
    path: /screens/waitlist-join.html
    anchors: [waitlist.email, waitlist.email-error, waitlist.submit]
  - id: waitlist-admin
    title: Waitlist admin
    path: /screens/waitlist-admin.html
    anchors: [waitlist.heading, waitlist.count, waitlist.export, waitlist.invite-batch, waitlist.table]
    states:
      - id: waitlist-invite-batch
        title: Confirm a batch invite
        fragment: "#invite-batch"
        anchors: [waitlist.confirm-batch]
```

A state's nested `fragment:` is a convenience for the generator, which knows the
states as belonging to their page. `walkdown extract` flattens each one into a screen of
its own, written the way a URL is written:

```yaml
# blueprint/storyboard.yml, after the merge
  - id: waitlist-invite-batch
    title: Confirm a batch invite
    prototype: /screens/waitlist-admin.html#invite-batch
    app: { path: /admin.html#invite-batch }
    anchors: [waitlist.confirm-batch]
```

Nothing in it is inferred from the markup by walkdown. The generator knows which
elements it meant as anchors and which states it meant as screens; asking a parser to
guess would reintroduce the drift the manifest exists to remove.

## 4. The embed tag

Every screen carries it, so a prototype opened directly is pinnable without anyone
editing the export:

```html
<script src="http://localhost:4700/embed.js" data-walkdown></script>
```

The browser extension covers prototypes that lack it, so this is a convenience rather
than a requirement — but it is the difference between a prototype that works out of the
box and one that needs setup.

## 5. Regeneration is a merge

A re-export proposes a diff against the existing blueprint; it never replaces it.
For that to be possible the generator must treat these as immutable once published:

| Immutable | May change freely |
|---|---|
| Anchor ids | Element position, styling, copy |
| Screen ids | Screen title, layout, content |
| Fragment values for existing states | Anything not listed left |

New screens and new anchors are additions and always safe. **Removals are a diff a human
approves**, never a silent deletion — a removed anchor is a signal that rules and checks
need attention, which is information, not an error.

## Hosting

Serve the export from `blueprint/prototype/` and `walkdown serve` mounts it at
`/prototype/` with working paths and deep links. No second server, no build step.

A prototype hosted somewhere else is fine too, but note what breaks: share URLs that
wrap the page in a viewer chrome usually intercept history navigation, which takes deep
linking and fragment states with it — and those are two of the five things above.
A plain static export avoids the whole class of problem.

## What this contract does not ask for

- **No walkdown-specific markup** beyond the anchor attribute. No wrapper elements, no
  data attributes describing rules, no comments.
- **No styling constraints.** The prototype looks however design wants; walkdown only
  needs to find things and link to them.
- **No completeness.** A partial prototype is normal and useful — walkdown records what
  has no design yet as drift ([00-vision.md](00-vision.md)), which is how a screen born
  in the spec gets routed back to design.
