# walkdown first milestone — hand-run

This directory is the milestone from [00-vision.md](../docs/00-vision.md): the schema
exercised end to end **by hand** on one small feature (a launch-waitlist signup), before
any walkdown tooling exists. Every artifact here was produced with file tools, a browser,
and Playwright — no walkdown CLI.

## What's here

| Path | Playing the role of |
|---|---|
| `prototype/` | A Claude Design export — two screens, anchors as `data-testid` |
| `app/` | The built product (vanilla HTML/JS), anchors carried over |
| `blueprint/` | The hand-written blueprint: config, storyboard, one feature (5 rules), runs, threads |
| `checks/` | The project's "own" test suite — Playwright tests tagged `@rule:<id>` |

Run the checks: `npm install && npx playwright test` (the config serves `app/` itself).
Per-rule: `npx playwright test --grep '@rule:waitlist.join.email-required'`.

## Seeing walkdown's loading veil, by hand

When walkdown sends the framed app somewhere, it draws a veil naming the screen
it is fetching over a dimmed copy of what was there, held back 180ms so quick
loads do not flash, and lifted by the frame's own `load` event. On a fast fixture
that is over before you can look at it. `waitlist-export` exists so you can look
at it: `app/export.html` holds its own load event open for about three seconds.

Two servers, from the repository root:

    python3 -m http.server 4310 --directory example/app
    node bin/walkdown.js serve --dir example/blueprint --port 4700

Then open <http://localhost:4700/>, go to the Rules tab, and open
**waitlist.export.says-why-it-waits**. The frame heads for the export screen and
the veil comes up reading "Loading Waitlist export…", holds for about three
seconds, and lifts as the report lands. Clicking **Export** on the admin screen
does the same trip, the way an operator would take it.

How it stays slow under a plain static file server, and why it is not the obvious
busy-wait, is written at the bottom of `app/export.html`. Short version: the app
and the panel are the same *site*, so they share a renderer main thread, and a
busy-wait starves the very timer that draws the veil.

## What happened (read the ledger)

1. **Run 01** (`kind: checks`): both automated rules pass; `visual-match` skipped —
   `verify: [agent, human]` is not satisfiable by checks.
2. **Run 02** (`kind: walkdown`, `actor: agent`): screenshots of prototype vs app for both
   screens (see `blueprint/runs/evidence/`). Verdict: **fail** — the join button reads
   "Join waitlist" but the prototype says "Join the waitlist". Copy drift the functional
   checks were structurally blind to; the agent judgment tier caught it and spawned note
   `n-0001` anchored to `waitlist.submit`.
3. The app was fixed per the note; **run 03** re-judged it as pass and `n-0001` moved to
   `addressed`. The `human` half of `verify: [agent, human]` — and question `q-0001` —
   still await a human, deliberately: that's the state a real project sits in most of the
   time.

## Milestone verdict: the loop feels right in raw files

Everything the docs promised worked as plain files + existing tools: tagging tests with
rule IDs (`--grep '@rule:…'` targets one rule), `getByTestId` against shared anchors,
append-only runs, threads anchored to rule/screen/element, and derived status readable by
eye across three run files.

## Friction found (feed into tooling priorities)

1. **`statement_hash` by hand is untenable.** Computing and pasting hashes is exactly the
   kind of bookkeeping humans skip. The CLI must own hashing; `lint` recomputes and flags.
   (Highest-priority automation.)
2. **The config needed a `prototype` section the docs didn't have.** An agent walkdown
   must serve *both* surfaces; the storyboard's `prototype:` paths need a root and port to
   resolve against. Added here as `prototype: { root, port }` in `walkdown.yml` — docs
   updated to match.
3. **Runs before the first commit have no useful `git_sha`.** Used
   `blueprint_sha: "uncommitted"`; the schema should bless an explicit value for
   dirty-tree runs rather than leaving it ad hoc.
4. **Run-record authoring is mechanical but fiddly** (timestamps, seq suffixes, evidence
   paths). This is the native-formatter/CLI's job; doing it by hand twice was enough to
   prove the shape and the tedium.
5. **`--list` doesn't print tags** in the human output. The lint adapter should use
   Playwright's JSON reporter (which includes tags), not parse the list output.

None of these are schema changes — the entities held up. They are tooling priorities:
hashing, run emission, surface serving, then status/lint.
