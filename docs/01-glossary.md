# 01 — Glossary

One term, one meaning. These names were chosen to avoid collision with RSpec (`spec`),
Cucumber (`features/` directory, `scenario`), the day-job's "workflow specs" (`workflow`),
and the many meanings of `test`. BDD ancestry is noted where it exists — agents already
know Gherkin, and mapping to it measurably helps them.

| Term | Definition | BDD ancestry |
|---|---|---|
| **Blueprint** | The whole artifact: the directory of files (`blueprint/`) that is the canonical statement of what we're building. | Executable specification / living documentation |
| **Feature** | Top-level grouping of stories. One file per feature. | Gherkin `Feature` |
| **Story** | A user-goal within a feature. | User story (Example Mapping yellow card) |
| **Rule** | A single verifiable statement — an acceptance criterion. The atomic unit everything else attaches to. | Gherkin `Rule` (Example Mapping blue card) |
| **Statement** | The plain-language half of a rule. Canonical: when statement and steps diverge, the statement wins. | Rule statement |
| **Steps** | The technical half of a rule: given/when/then instructions referencing screens and anchors. Derived from the statement, hash-stamped for staleness. Doubles as the human walkdown script. | Given/When/Then |
| **Check** | A pointer from a rule to one or more tests in the *project's own* test suite (RSpec workflow spec, Playwright test, …). walkdown never owns the test itself. | Example (green card) / step definition |
| **Verify list** | A rule's declared evidence requirements: any of `checks` (deterministic tests), `agent` (AI judgment), `human` (a person's verdict). All listed types must pass. Agent judgment never satisfies a `human` requirement. | — |
| **Storyboard** | The registry of named screens, with per-surface locators (prototype URL, app path, optional setup recipe). Criteria reference screens by ID, never by URL. | *(no BDD analogue — ours)* |
| **Screen** | One entry in the storyboard. May represent a URL-reachable page or a named state (modal open, wizard step 3). | — |
| **Headless rule** | A rule with no screens — API behavior, CLI contract, job, or policy. Gets the full ledger (statements, coverage, runs, staleness, threads) without the UI layer (storyboard, anchors, embed). | Executable specification |
| **Anchor** | A stable, dot-namespaced element identity shared by prototype and app (e.g. `checkout.submit`), carried by a configurable attribute — `data-testid` by default, reusing the Playwright/Testing Library/Capybara test-id convention. Pins, steps, and checks all anchor to anchors. | *(no BDD analogue — ours)* |
| **Run** | One append-only record of verification: who/what verified, against which target, at which commit, with per-rule results. | Test run |
| **walkdown** (session) | A judgment-based run: a human (in the panel) or an AI agent steps through rules, comparing app against prototype, and records verdicts. Named for the engineering practice of walking a site to verify construction matches drawings. Only human sessions satisfy a `human` verify requirement. | Walkthrough |
| **Target** | A named environment a run executed against (`local`, `staging`), defined in project config. | — |
| **Note** | Human feedback pinned to a rule/screen/element via the embed. | — |
| **Question** | A clarification request — from an agent *or* a human — anchored the same way as a note. Lifecycle ends at **incorporated**: the answer must land in the rule's statement/steps; the thread remains as provenance. | Example Mapping red card |
| **Thread** | The container for a note or question and its replies. | — |
| **Waived** | Terminal thread status: reviewed and deliberately not acted on — the construction term for a punch-list item accepted as-is. Requires a person and a reason; agents may propose but never waive. | — |
| **Sign-off** | A walkdown verdict on an *unbuilt* rule's spec rather than a build: `approved` ("build it as written", hash-stamped so rewording stales it) or `refining` (the required feedback, filed as a thread). Never satisfies a verify requirement. | — |
| **Panel** | walkdown's chrome riding beside the page under review — the rules list, detail, threads, and walkdown session controls, served by `walkdown serve`. Delivered *docked* (a script tag injects it into the app's own document and pushes the app aside) or *framed* (the browser extension frames the app inside walkdown's own page). | Living documentation browser |
| **Ghost** | The other surface — usually the prototype — rendered translucently over the page under review and faded in and out with a slider. The comparison mechanism; there are no side-by-side panes. | — |
| **Desk** | The drafting-table backdrop of the framed layout: the app lies on it as a sheet, so it reads as the thing being examined rather than as part of the tool. | — |
| **Embed** | The small script injected into prototype and dev/staging app that does element picking, pin rendering, and screen reporting. | — |

## Process vocabulary

Cucumber's discovery → formulation → automation maps onto the walkdown loop:

| Cucumber phase | walkdown activity |
|---|---|
| Discovery | Reading the PRD and prototype; question threads |
| Formulation | `walkdown extract` proposing features/stories/rules; human-approved merge |
| Automation | Builder agent writing checks in the project's native test framework |

## Words we deliberately do not use

- **spec** — means RSpec in every Rails codebase this will live in.
- **workflow** — collides with "workflow specs," the day-job's test type.
- **scenario** — too overloaded (Gherkin vs. casual product-speak); its meaning is split
  precisely between *rule* and *check*.
- **test** (as an entity name) — means something different to every audience; we say
  *check* for the linkage and let each project call its own tests whatever it likes.
- **walkthrough** — replaced by *walkdown* (session) so product name and ritual share one
  word.
