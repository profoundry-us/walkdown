---
name: walkdown-formulate
description: Formulate a Walkdown feature - derive storyboard screens, stories, and rules with steps from a design artifact (prototype export, mockups) or PRD notes, then wire rule-tagged checks. Use when starting a new feature, adding something to the blueprint, or turning a design or PRD into acceptance criteria.
---

# Formulate a feature

Conventions live in `blueprint/AGENTS.md` — read it first. Formulation turns a
source (prototype, PRD, conversation) into the blueprint's canonical form:
screens, stories, rules. Plain language is authoritative; everything else
derives from it.

## Procedure

1. **Inventory the source.** Walk every screen/state the artifact shows. List
   the elements that matter per screen. Note anchors already present
   (`data-testid` in a prototype export); propose dot-namespaced names
   (`checkout.submit`) for elements that lack them.

2. **Storyboard first.** One entry per screen/state in
   `blueprint/storyboard.yml`: stable id, per-surface locators
   (`prototype:` path, `app:` path), declared `anchors`. A screen the source
   implies but doesn't show gets `prototype: null` plus a design-request
   thread (see ownership rules). States (modal open, error showing) are
   screens too if rules need to point at them.

3. **Stories, then rules.** One feature file per feature. Stories are user
   goals; rules are single verifiable statements — if a statement needs "and",
   it's usually two rules. For each rule:
   - id: `feature.story.slug`, assigned once, never regenerated
   - `origin`: `prd` or `prototype` (whichever the rule came from)
   - `verify`: honest — `[checks]` only for what a script can prove; visual
     fidelity, tone, and feel get `[agent, human]` or `[human]`
   - `screens`: the screens it touches (unordered; tooling derives flow)
   - `steps`: given/when/then referencing screens and anchors **in backticks
     by id** — never URLs or CSS. Steps double as the human walkthrough
     script, so write them clickable.

4. **Hash.** `walkdown hash --write` stamps every statement.

5. **Questions, not guesses.** Everything the source doesn't answer (empty
   states, error copy, edge flows) becomes a question thread anchored to the
   rule/screen — do not invent product decisions. Proceeding on an assumption
   is allowed only if the thread records the assumption.

6. **Lint early.** `walkdown lint --no-checks` until the structure is clean.

7. **Checks.** One test per `checks` rule, in the project's own framework,
   tagged with the rule id, selecting by anchor. Then `walkdown run` (with
   `WALKDOWN_ACTOR=agent`) and a full `walkdown lint`.

8. **Report.** `walkdown status` — say what's verified, what awaits judgment
   (`agent`/`human` rules), what questions are open, and any drift (screens
   awaiting design).

Rules without screens are fine — headless rules (API behavior, CLI contracts,
jobs, policies) get the full ledger without the UI layer. The guardrail: a
rule is a behavior product would recognize as a requirement, never a mirror
of the unit-test suite.

Quality bar for a rule: a fresh session reading only the blueprint should
build the right thing, and a PM reading only the statement should recognize
their intent.
