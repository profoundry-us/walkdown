# 01 — Glossary

One term, one meaning. These names were chosen to avoid collision with RSpec (`spec`),
Cucumber (`features/` directory, `scenario`), the day-job's "workflow specs" (`workflow`),
and the many meanings of `test`. BDD ancestry is noted where it exists — agents already
know Gherkin, and mapping to it measurably helps them.

| Term | Definition | BDD ancestry |
|---|---|---|
| **Project** | A directory somebody imported — normally a repository. What a person means by "what I am working on". It may hold several blueprints; walkdown learns about one through `walkdown blueprints new` or `walkdown blueprints import`, and never by walking a tree (ADR 0001). In the registry a project is a label on each row, named after the repository unless the person names it (ADR 0014). | — |
| **Blueprint** | The whole artifact: the files that are the canonical statement of what we're building, with its own storyboard, rules, threads and runs, kept in one flat folder, its **home**, around a `spec.yml`. A project may hold several; `walkdown blueprints` lists the ones this machine can reach, each under a registry ID this machine gave it (`0002-wd-cli`). Inside its project the bare name (`cli`) does as well. | Executable specification / living documentation |
| **Feature** | Top-level grouping of stories. One file per feature. | Gherkin `Feature` |
| **Story** | A user-goal within a feature. | User story (Example Mapping yellow card) |
| **Rule** | A single verifiable statement — an acceptance criterion. The atomic unit everything else attaches to. | Gherkin `Rule` (Example Mapping blue card) |
| **Statement** | The plain-language half of a rule. Canonical: when statement and steps diverge, the statement wins. | Rule statement |
| **Steps** | The technical half of a rule: given/when/then instructions referencing screens and anchors. Derived from the statement, hash-stamped for staleness. Doubles as the human walkdown script. | Given/When/Then |
| **Check** | A pointer from a rule to one or more tests in the *project's own* test suite (RSpec workflow spec, Playwright test, …). walkdown never owns the test itself. | Example (green card) / step definition |
| **Verify list** | A rule's evidence tiers: `agent` (AI judgment), assumed for every rule, and `checks` (deterministic tests), asked for with `verify: [checks]`. A tier a rule cannot honestly have is excused under `unverifiable:`, with a reason. Every tier left must pass. | — |
| **Sign-off list** | Who accepts a rule, by role (`signoff: [eng, product]`): `eng` always, with `product` or `design`. A person's acceptance is a signed walkdown verdict, never a verify tier. | — |
| **Storyboard** | The registry of named screens, with per-surface locators (design version, app path, optional setup recipe). Criteria reference screens by ID, never by URL. | *(no BDD analogue — ours)* |
| **Design version** | One dated drawing of a screen, in `designs/<screen>/` (`20261019.html`, then `-v2`). The storyboard's `design:` names the accepted one; a design request's `proposes:` names the one waiting on a person. Approving every rule on the screen accepts it. ADR 0015. | — |
| **Focus** | The anchor a rule is about, where opening the rule centres and rings both surfaces: its `focus:`, else the first anchor its steps name. ADR 0016. | — |
| **Screen** | One entry in the storyboard. May represent a URL-reachable page or a named state (modal open, wizard step 3). | — |
| **Headless rule** | A rule with no screens — API behavior, CLI contract, job, or policy. Gets the full ledger (statements, coverage, runs, staleness, threads) without the UI layer (storyboard, anchors, embed). | Executable specification |
| **Anchor** | A stable, dot-namespaced element identity shared by prototype and app (e.g. `checkout.submit`), carried by a configurable attribute — `data-testid` by default, reusing the Playwright/Testing Library/Capybara test-id convention. Pins, steps, and checks all anchor to anchors. | *(no BDD analogue — ours)* |
| **Run** | One append-only record of verification: who/what verified, against which target, at which commit, with per-rule results. | Test run |
| **walkdown** (session) | A judgment-based run: a person (in the panel) or an AI agent steps through rules, comparing the build against the design, and records verdicts. Named for the engineering practice of walking a site to verify construction matches drawings. Only a person's signed verdict counts as acceptance; an agent's fills the `agent` tier. | Walkthrough |
| **Target** | A named environment a run executed against (`local`, `staging`), defined in project config. | — |
| **Note** | A remark pinned to a rule/screen/element, carrying a **reason** that says what it is: a person's `feedback`, a judge's `finding`, an agent's `observation` (the agent may settle it), a `request` (to design), a `decision` (filed `recorded`, in no queue), or a `redline` (see below). On a rule the walk can reach, every note but a decision or a redline is part of the rule's **conversation** and closes on the person's next signed pass (ADR 0006); off the walk, a person verifies or waives it from the thread's screen (ADR 0005). | Punch-list item |
| **As-built** | A drawing of what was actually built, kept by engineering under `as-built/` for a build walkdown cannot frame (its own panel, a native app) and named as a screen's app path. Never the design, never evidence. ADR 0007. | As-built drawing (construction) |
| **Redline** | A person's record that the build leaves the design at one element on purpose, and why, with what each side shows. A note filed closed (`recorded`), only by a person, drawn in red on both sides of the fade, and read by a judge as an intended gap rather than a fail. A person may reopen one into a note waiting on the agent. ADR 0015. | Redline (construction) |
| **Conversation** | Everything ever said on one rule, drawn as one stream under it: each thread's opening message tagged with the thread, its kind and status. A rule's verdict is what the conversation waits on - a pass ends it, a fail continues it. ADR 0006. | Discussion thread |
| **Question** | A clarification request — from an agent *or* a human — anchored the same way as a note. Lifecycle ends at **incorporated**: the answer must land in the rule's statement/steps; the thread remains as provenance. | Example Mapping red card |
| **Thread** | The container for a note or question and its replies. | — |
| **Waived** | Terminal thread status: reviewed and deliberately not acted on — the construction term for a punch-list item accepted as-is. Requires a person and a reason; agents may propose but never waive. | — |
| **Sign-off** | A walkdown verdict on an *unbuilt* rule's spec rather than a build: `approved` ("build it as written", hash-stamped so rewording stales it) or `refining` (the required feedback, filed as a thread). Never satisfies a verify tier. Approving every rule on a screen accepts that screen's proposed design. | — |
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
- **project** (meaning a blueprint) — it meant both for a year, in the payload, the CLI
  and the config, and the day two blueprints had to share a page the ambiguity stopped
  being survivable. A project is a directory; a blueprint is a specification inside one
  (ADR 0001). q-0270 settled the last of it: the config key is `blueprints:` and a
  blueprint's own `walkdown.yml` opens `blueprint:`. Since ADR 0014 that file is `spec.yml`,
  still opening `blueprint:`, and `blueprints:` is the registry's, the repository's
  `.walkdown/config.yml` being gone. Nothing walkdown writes says the old
  word any more; the threads that argued it out still do, because the ledger is history.
