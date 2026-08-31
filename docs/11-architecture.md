# 11 — Architecture: what is here, and what to change

A 5000-foot review, written at the point where the shape of the repository is
finally visible. It measures what exists, names what is wrong with it, states
the architecture we would build knowing what we know now, and gives an honest
answer to *rebuild or refactor*.

## What is here, measured

| area | lines | files | note |
|---|---|---|---|
| `lib/` | 3,408 | 18 | the domain. Median file 92 lines |
| `bin/walkdown.js` | 1,038 | 1 | every command, plus its rendering |
| `src/panel/` | 4,769 | 16 | of which `app.js` is 2,798 |
| `lib/viewer/embed.js` | 1,075 | 1 | hand-written, cannot import |
| `checks/` + `test/` | 5,185 | 25 | two suites, one documented rule for which |
| `blueprint/` | 7,350 | 132 | 128 rules, 122 threads, 93 runs |

### The healthy parts, which a rebuild would put at risk

**`lib/` is an acyclic graph and it is the right one.** `hash` and `locations`
are leaves; `blueprint` sits on `locations`; `status`, `lint` and `run-record`
sit on `blueprint`; `serve` is the only hub. Nothing imports upward. That
structure was not designed in advance — it fell out of the work, which is the
strongest possible evidence that the domain decomposition is correct.

**The ledger model is sound.** Append-only records, status derived by query,
currency answered per cell. It is the part most thoroughly tested and the part
that has survived the most redesign around it.

**The comments are the asset.** Three weeks of decisions are recorded where
they apply — why Rollup runs with `treeshake: false`, why the checks serve a
disposable blueprint, why a personal config may move files but never change
what a rule means. That is worth more than the code it annotates, and it is
exactly what does not survive a rewrite.

## The five real problems

### 1. There is no vocabulary module — the worst irony in the codebase

walkdown's entire thesis is that a term means one thing. Its own domain
vocabulary is string literals scattered across two runtimes:

- thread statuses (`open`, `addressed`, `answered`, `verified`, `waived`) in
  **10 files** across `lib/`, `src/panel/` and `lib/viewer/embed.js`
- verify tiers (`checks`, `agent`) in **10 files**
- roles, verdicts, run kinds, likewise

Nothing enforces that the panel's idea of "addressed" is the server's. It
happens to be, because two people wrote it carefully; it is one typo from not
being, and the typo would be silent in the one direction that matters — a
status the panel cannot draw is invisible rather than loud.

**The fix is small and touches everything once:** `lib/vocab.js`, frozen sets
plus the predicates that go with them (`isTerminal`, `canTransition`), imported
by `lib/`, bundled into the panel, and pasted into the embed by the mechanism
that already pastes `screen-match` there.

### 2. `src/panel/app.js` is 2,798 lines and the hub of a cycle

Sixteen modules have already been extracted from it, and the extraction stopped
at exactly the point where it stopped being mechanical. Every pane imports
`app.js` back for `render()`, `say()`, `threadPost()` — which is why
`rollup.config.mjs` has to whitelist circular dependencies inside `src/panel`.

The file is five things: chrome and layout; the app frame and viewport; session
and walkdown recording; thread I/O and messaging; render orchestration. Those
are real seams, not arbitrary ones — each has its own state in `S` and its own
listeners.

The cycle is the actual problem, and it has a standard shape: the panes need
*effects* (redraw, toast, post) and reach for the module that owns them. An
event bus or a small effects module they all import instead turns the cycle
into a DAG and lets the whitelist go.

### 3. `bin/walkdown.js` does three jobs in one file

Argument parsing, domain logic, and human rendering, 1,038 lines, fifteen
`cmd*` functions. `cmdStatus` alone is about 180 lines, most of it drawing a
table. That rendering is untestable where it sits and unreachable from
anywhere else — the panel draws the same information again, separately.

**Split into three:** `bin/walkdown.js` as a router; `bin/commands/<name>.js`
for parsing and orchestration; `lib/report/*.js` for rendering, which then has
tests and can be reused.

### 4. `lib/serve.js` is 704 lines and is the write boundary

Routing, API handlers, static files, evidence resolution, git identity,
blueprint discovery. It is also **the only place in walkdown where a browser
can cause a write**, and that fact is currently spread across a 450-line
function rather than stated anywhere.

`q-0019` already recorded the intended rule: *the server may write
specification, never implementation.* An allowlist that important should be one
module you can read in a minute — and the four separate author-defaulting bugs
found in one night (`n-0121`) are what happens when a write boundary is
implicit.

### 5. Two browser runtimes, one of which cannot import

The panel is bundled; the embed is hand-written and self-contained, so shared
logic is **pasted into it between markers** by `tools/sync-shared.mjs`. The tool
works, is checked, and its own comment states the exit: *"When the embed gets
the same treatment this tool retires."*

It should. A second Rollup entry costs one config and deletes a whole category
of drift — and every module the embed needs (`vocab` above, first among them)
stops being a special case.

### And one smaller: the schema is not data

What a rule may contain lives inside `lib/lint.js` as a sequence of hand-rolled
checks. For a tool whose subject is specification, "what a blueprint may say"
should be a declaration that lint *reads*, not a function that lint *is*.
It would also give the panel, the formatters and any future editor one answer
instead of three.

## The architecture we would build knowing this

Which is very nearly the one that exists, plus two layers at the bottom and
minus the fat files:

```
  vocabulary        lib/vocab.js            terms, frozen. No dependencies.
  schema            lib/schema.js           what a blueprint may say, as data
        ↑
  model             blueprint, hash, locations, screen-match
        ↑
  ledger            run-record, status, threads, draft
        ↑
  services          lint, checks, claims, run-cmd, init
        ↑                    ↖
  CLI                          HTTP
  bin/commands/*               lib/serve (router) + lib/api/* + lib/writes.js
  lib/report/*                       ↑
                               browser: one bundler, two entries
                               panel/ and embed/ over a shared core
```

Three properties are worth naming as goals rather than accidents:

- **Every layer is usable without the one above it.** The reason `lib/` is
  testable today.
- **One vocabulary, one schema, four consumers.** CLI, server, panel, embed.
- **One write boundary, stated in one file.**

## Rebuild or refactor?

**Refactor in place.** Not as a compromise — as the better engineering answer,
for three reasons.

**The code is mostly right, and the graph proves it.** A rebuild is a bet that
we understand the domain better than the existing decomposition does. `lib/`'s
dependency graph is already the target graph. What is wrong is concentrated in
four files, and every one of them is wrong in a way that has a name and a known
fix.

**A rebuild forfeits the ledger, and that cost is mechanical.** Verdicts are
tied to statement hashes *and* to the checks that claim them
(`status.derived.unbacked-pass-goes-stale`). Rewriting the suite from scratch
means every rule's checks cell goes stale at once: 128 rules back to grey, and
the only way back is judging them all again. Refactoring keeps a rule green
across a moved test, because matching is by rule id.

**walkdown has a tool for exactly this, and refusing to use it would be
strange.** `walkdown sweep` plus `walkdown-sitting` exist for "a refactor moved
a lot of code, earn the board again". A staged refactor is the case they were
designed for; a rebuild is the case where they have nothing to say.

The one honest argument for rebuilding applies to `src/panel` alone, where the
cycle keeps fighting extraction. Even there the evidence is against it: sixteen
modules already came out of that file without a rewrite, and what remains is
blocked by one structural thing — the effects the panes reach back for — which
is a day's work to invert.

## The order to do it in

Each step is independently shippable, ends green, and is a **refactor only** —
never combined with a behaviour change in the same commit.

0. **Write the standards down.** [10-house-style.md](10-house-style.md).
   *Done, and tooled: Biome owns format and correctness lint; `lib/` is
   JSDoc-typed under `tsc --checkJs`; both run in Highball.*
1. **`lib/vocab.js`.** Smallest change, highest leverage, touches every file
   once. *Done - the terminal set alone existed five times, in three orders.*
2. **Split `bin/`.** *Done: router + `bin/commands/` + `lib/report/`.* Purely mechanical, no behaviour to break, and it makes the
   next three easier to review by getting the noisiest file out of every diff.
   Types follow: `bin/` joins the `checkJs` scope as it splits.
3. **Split `lib/serve.js`**, and make the write allowlist a module with its own
   rule and its own checks. *Done: `lib/{serve,api,identity,writes}.js`, rule
   `ownership.writes.spec-never-implementation`.*
4. **Bundle the embed**; retire `tools/sync-shared.mjs`. *Done: `src/embed/`
   builds to `lib/viewer/embed.js`, the pasted blocks became imports, and the
   panel/embed `CHIP` duplicate collapsed into `lib/vocab.js`.*
5. **Rebuild the panel's panes on Lit** (decision made: lit-html + LitElement,
   the Chrome DevTools stack - see [10-house-style.md](10-house-style.md)).
   This *replaces* the old step 5: most of the `app.js` cycle is panes
   reaching back for `render()` and manual DOM patching, and Lit's own update
   model deletes that plumbing rather than rearranging it. Pane by pane,
   lit-html templates first, LitElement components where a pane owns real
   state; `app.js` shrinks to boot, session, and I/O. The Rollup cycle
   whitelist goes when the last pane stops importing `app.js` back.

   *Half done: every pane and the shell render as lit templates (the esc()
   discipline is gone; vendor/lit.js rides the bundle; both browser bundles
   are format:'iife' after the conversion surfaced the classic-script
   page-global trap). Still owed: the querySelector wire* functions become
   template event bindings; the action functions leave `app.js` for real
   modules so panes stop importing it back; then the whitelist goes and the
   scroll/caret/track-repaint hacks in render() can be re-examined - lit's
   diffing may make each unnecessary, but that is measured, not assumed.*
6. **Schema as data**, with `lint` reading it.

Sweep after each of 3, 4 and 5 — those move enough that a verdict recorded
before them should be re-earned rather than assumed. One sitting per sweep,
finished before the next step starts, or the board fills with stale cells
nobody gets back to.

**What not to do**, in the same breath, because every one of these has been
proposed for codebases at this exact moment in their lives: no vDOM framework in the
panel (Lit is a templating layer, not a framework - if a step needs a router
or a store, the step is wrong), no TypeScript compile step (JSDoc + checkJs
gives the checking; a build between clone and run would break the zero-install
property we just bought), no test-suite rewrite, no renaming things that are already named
after the glossary, and no refactor of `lib/`'s graph — it is the part that is
right.
