# ADR 0017 — Screen setup

- **Status:** accepted 2026-10-23 by Topher. Proposed the same day by the agent
    from [issue #25](https://github.com/profoundry-us/walkdown/issues/25). Its rules
    and screens are written first and walked before anything with a screen is
    built (ADR 0015 §8).
- **Date:** 2026-10-23
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0001 (page to blueprint routing), ADR 0014 (file layout and
    locations), ADR 0016 (rule focus), the runner contract's `targets`
    ([03-runner-contract.md](../../03-runner-contract.md)), the two layouts in
    [04-embed-and-anchors.md](../../04-embed-and-anchors.md) (whose docked layout was
    withdrawn on 2026-08-26; that page has not caught up)
- **Threads:** issue #25

## Context

A screen's `app.setup` is prose. The panel shows it above a rule's steps and never
runs it ([02-blueprint-schema.md](../../02-blueprint-schema.md), Storyboard). Opening a
rule deep-links the App pane to the screen's `path` and stops there.

That is enough for a page anyone can reach by URL. It fails when what a page shows
depends on **who is signed in** and **which record is open**. Take an expense approval
page with one rule per kind of viewer: "As a view-only manager, opening a submitted
expense, I see no Approve button and a 'view only' note." The rule has one screen,
but reaching that screen's state means signing in as a view-only manager and finding a
submitted expense. The panel does neither, so the App pane shows the sign-in page, or
the page as whoever last signed in. The reviewer does it by hand, on every rule. The
Design pane has no such problem, because each state of the design has a URL of its own.

Three more things get in the way:

- **Ids differ by machine.** The submitted expense is #412 on one laptop, #9 on
  another and #30871 on staging. A path written into the storyboard is right on one of
  them at most.
- **Two screens on one page tie.** Lint warns when two screens share an `app.path`, and
  the matcher skips the tie (`screens.identity.query-is-not-identity`). The lint
  comment says why it only warns: "until `setup` is executable that spelling is the
  honest one".
- **The App pane only knows `local`.** `runner.targets` can declare several base URLs,
  and runs already record which target they were made against. The panel still reads
  `targets.local.base_url` and nothing else (`lib/api.js`).

An earlier version of #25 proposed a blueprint-level list of "viewers" that a rule
could switch between. It was dropped on 2026-10-20: a different kind of user means a
different rule, with its own screen, so no rule needs a viewer switch. A screen needs
a way to reach its own state, and that is all.

## Decision

### 1. A screen's setup can be steps

`app.setup` is one of three things:

```yaml
screens:
  - id: expense-view-only-team
    design: /expense-view-only-team/20261023.html
    app:
      setup:                                   # steps, run in order
        - visit: /dev/impersonate?id={fixtures.view_only_team_manager}
        - wait_for: nav.signed-in
      path: /expenses/{fixtures.expense_submitted}

  - id: expense-view-only-org
    app:
      setup: { recipe: as_view_only_org_manager }   # steps written once, below
      path: /expenses/{fixtures.expense_submitted}

  - id: checkout-payment
    app:
      setup: Add one item to the cart first.   # prose, as today
      path: /checkout/payment

recipes:                                       # storyboard.yml, beside screens:
  as_view_only_org_manager:
    - post: /dev/session
      fields: { user_id: "{fixtures.view_only_org_manager}" }
```

A string stays prose: shown to the reviewer, never run, exactly as today. A list is
steps, and `{ recipe: <name> }` is the steps of a recipe declared under the
storyboard's `recipes:`. A recipe takes no arguments, because fixtures (§3) already
carry everything that changes between machines.

There are three kinds of step:

| Step | What the panel does |
|---|---|
| `visit: <path>` | Navigates the app to that path, relative to the target's `base_url`, and waits for it to load. |
| `post: <path>` with `fields:` | Submits an HTML form with those fields to that path, in the app's own frame or tab, and waits for the result to load. |
| `wait_for: <anchor>` | Waits until that anchor is on the page, for up to ten seconds. |

`post` submits a form and never sends JSON. A form submission is a navigation, so any
cookie it sets belongs to the app. A `fetch` from the panel's own origin would need
the app's CORS headers just to set a session, and most apps would not have them.

`wait_for` names an anchor and never a CSS selector. Rules reference elements by anchor
only (ADR 0016, "Not now"). Lint warns when the anchor is not declared on the screen.

### 2. The panel runs the steps, then loads the screen

When the panel takes the App pane to a screen with steps, it runs them in order and
then loads the screen's `path`, the same as today. Every step is a navigation of the
app frame. (The docked layout, where the panel ran inside the app's own page, was
withdrawn on 2026-08-26, so the frame is the only place setup runs.)

Setup runs when the screen being shown changes, when the target changes (§5), or when
the reviewer asks for it. Opening a second rule on the same screen does not run it
again. A rule's detail shows the steps under the prose setup's heading, with a
control to run them again.

A step that fails stops the setup. That covers a load that returns 4xx or 5xx, a
`wait_for` that times out, and a fixture that has no value. The panel cannot read a
cross-origin frame's status, so the embed in the app's page reports it from the
page's own navigation timing. The extension puts the embed in every page it frames,
so a review there always has it; an app served without the extension or the embed's
script tag can only fail a `wait_for`. The App pane then says
which step failed and why, and it does not load the screen's path as if setup had
worked. Without that, a reviewer would be judging the sign-in page and calling it the
screen.

Setup runs in the reviewer's own browser, against apps they can already reach. walkdown
never stores a credential, and a blueprint should never hold one. The intended route is
a dev-only impersonation endpoint or a seeded session, as in the examples above.

### 3. Fixtures fill in what differs by machine

`{fixtures.<key>}` may appear in any setup step and in `app.path`. Values are per
target, and come from two places. The later one wins:

1. **`runner.targets.<t>.fixtures`** in `spec.yml`. These are committed, so they suit
   ids that are the same for everyone, such as a shared staging's.
2. **What `walkdown fixtures set --blueprint <b> --target <t>` kept.** It reads a
   flat JSON object on standard input, or `key=value` pairs as arguments, and keeps
   them for this machine only, under `~/.walkdown/fixtures/<blueprint id>/<t>.yml`.
   Each run merges key by key: a key it is handed replaces that key's value, and a
   key it is not handed is kept.
   Like every command that writes, it names its blueprint. The home is not the place
   for these values: they are the machine's, like the registry (ADR 0014, "the
   project declares *what*, the machine declares *where*").

   Values are strings, numbers or booleans. Each fills in a path or a form field, so
   it must have a text form: `true` suits a field such as `remember`, while null, a
   list or an object has none, and is refused.

walkdown never makes the records itself, and never runs the app's code to make them.
The app's own task does that, run by the agent or by a person, and its output is
handed over (Topher, 2026-10-23):

```bash
bin/rake walkdown:seed | walkdown fixtures set --blueprint expenses --target local
walkdown fixtures set --blueprint expenses --target local expense_submitted=412
```

```yaml
runner:
  targets:
    local:
      base_url: http://localhost:3000
    staging:
      base_url: https://staging.acme.com
      fixtures: { expense_submitted: 30871, view_only_team_manager: 77 }
```

Lint warns about a key that a screen uses and a target lacks, naming the target, the
key and the screen. A target with no fixtures at all gets one warning that says to set
them, rather than one per key. The panel refuses to run setup with a
missing value and says the same thing (§2).

### 4. Setup is part of a screen's identity

Two screens are the same state only when they share both their path and their setup.
Each path is resolved with its target's fixtures before it is compared. Two screens
with one path and different setups are two states, and lint no longer warns about
them.

From the URL alone, the matcher still cannot tell those two apart. When the URL in the
App pane ties between screens that differ only in setup, the matcher picks the screen
the panel last set up at that path on this target. With none, it shows the tied
screens in the picker and does not quietly skip the tie as it does today. Two screens
with the same path and the same setup are still a tie, and lint still warns, as today.

ADR 0001 is unchanged: which blueprint a page belongs to is still read on path and
fragment alone, never on setup.

### 5. The App pane can switch targets

The App pane lists every declared target that has a `base_url`, with `local` first
when there is one. Choosing one points the App pane at that target, runs the current
screen's setup there and loads its path. The choice is the viewer's own, kept in the
browser, and it falls back to `local`. Comparing today's build with a branch's review
app becomes one click.

### 6. A rule shows its latest verdict on each target

A rule's Evidence block shows a row for each tier on each declared target that has a
recorded run: the latest verdict there, its date and its evidence line, from the
computation `walkdown status --target` already does. Evidence already names each row by
tier and target (`checks/local`), so this adds rows rather than a block of its own
(Topher, 2026-10-23). The rail and its marks are unchanged.

## Not now

- **`script` steps** that run a command on the runner's side. A `script` step would
  run one because a page asked the local server to, and the server accepts requests
  from every origin the embed is allowed on. Nothing a browser asks for runs a
  command. A setup that cannot be done with `visit` and `post` belongs in the app's
  own dev route, or in the app's own seed task. Putting a record back after a walk changed it, such as an expense somebody
  approved, is the job of the agent running the walkdown, when it is needed or asked
  for. walkdown does not build it in (Topher, 2026-10-23).
- **Recipes with arguments.** Use fixtures until a blueprint needs both.
- **Setup for the Design pane.** Each state of a design already has a URL of its own.
- **Tearing down** what setup changed. Setup is meant to be repeatable, such as
  signing in, rather than additive, such as creating a record. Records belong in the
  app's own seed task.
- **A `walkdown seed`** that runs the app's seed task itself, as `walkdown run` runs
  its tests. Proposed and dropped on 2026-10-23: making the app's data is the app's
  and the agent's job, not walkdown's (Topher).

## Consequences

- **Cookies.** A session cookie set by a step reaches the next navigation in the frame
  only where the browser lets the frame keep it. A spike in Chromium on 2026-10-23
  tried three parents framing an app on localhost, setting the cookie by a `visit` and
  by a form `post`:

  | The frame's parent | Which cookies carried |
  |---|---|
  | The extension's own page, which has host permission for every site | all of them: no `SameSite`, `Lax`, `Strict` and `None` |
  | A page on another localhost port | no `SameSite`, `Lax` and `None` |
  | A page on another site (127.0.0.1) | only `SameSite=None; Secure`, which holds over plain http on localhost |

  The extension, where reviews happen, needs nothing of the app: Chromium treats a
  frame in an extension page that has the host's permission as first-party. Only
  `walkdown serve`'s own page framing another site is cross-site, and the GUIDE says
  what an app needs for that. Firefox and WebKit are not installed here and were not
  tried; the extension is Chromium's alone.
- **The schema is additive.** Prose setup behaves exactly as before, and no upgrade
  step is needed. An older walkdown shows steps as unrun data.
  [02-blueprint-schema.md](../../02-blueprint-schema.md) and the runner contract gain
  `recipes:`, `fixtures` and the step table, and the CLI gains `walkdown fixtures set`. `skills/formulate` learns to
  write steps where a screen's state is not URL-reachable.
- **Rules.** Lint's warning about two screens on one path has had no rule of its own;
  §4 gives it one. `screens.identity.query-is-not-identity` is about queries and stays
  as it is. The lint comment that looks forward to executable setup goes. New rules cover §§1–6. The ones with screens are, at least: the setup
  steps in a rule's detail, a failed setup in the App pane, the target picker, and the
  per-target verdict lines. Per "Design comes first", each gets a design request and an
  accepted design before it is built.
- **Proving it needs an app with sign-in.** The example blueprint's waitlist has no
  users. The checks need a small fixture app with a dev impersonation route and a
  record or two, served beside the example, and the as-built drawings are captured
  against it.
- **All of it ships in 0.6.0.** §§1–4 (steps, fixtures and identity) are built first,
  because they make the issue's example walkable on one machine; §§5–6 (targets and
  verdicts) follow in the same release. The commit that finishes §6 closes #25.
