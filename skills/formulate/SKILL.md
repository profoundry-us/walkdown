---
name: formulate
description: Formulate a walkdown feature - derive storyboard screens, stories, and rules with steps from a design artifact (prototype export, mockups) or PRD notes, then wire rule-tagged checks. Use when starting a new feature, adding something to the blueprint, or turning a design or PRD into acceptance criteria.
---

# Formulate a feature

Conventions live in the blueprint's `AGENTS.md` (`walkdown where spec` names the directory) — read it first. Formulation turns a
source (prototype, PRD, conversation) into the blueprint's canonical form:
screens, stories, rules. Plain language is authoritative; everything else
derives from it.

## Procedure

0. **Which blueprint.** A feature belongs in the blueprint whose screens and
   rules it extends. An unrelated one in the same project gets a blueprint of
   its own: `walkdown blueprints new <name>`, run inside the project. Every
   command below that writes (`hash --write`, `threads new`, `sweep`, `rules
   move`) takes `--blueprint <id>`, even in a project with one blueprint;
   `walkdown blueprints` lists the IDs.

1. **Inventory the source.** Walk every screen/state the artifact shows. List
   the elements that matter per screen. Note anchors already present
   (`data-testid` in a prototype export); propose dot-namespaced names
   (`checkout.submit`) for elements that lack them.

2. **Storyboard first.** One entry per screen/state in
   the home's `storyboard.yml`: stable id, the `prototype:` path, declared
   `anchors`. Leave `app:` out until something is built at that path: a
   screen with only a design is complete, and the panel shows its design side
   alone. The agent that builds the screen adds its `app:` path. A screen the source
   implies but doesn't show gets `prototype: null` plus a design-request
   thread (see ownership rules). States (modal open, error showing) are
   screens too if rules need to point at them. **Design comes first:** a rule
   on a screen with no design is not built until the screen's design has been
   drawn and a person has accepted it. A designer draws it where there is
   one; where there is none, a design agent drafts it (a separate agent,
   never the one building). Every screen has rules, worked out with its
   design (the two may go back and forth until they agree), and no screen
   reaches a person without them; approving every rule on a screen
   accepts its design. Say so in the report, and stop there for that screen
   rather than building ahead of its design.

3. **Stories, then rules.** One feature file per feature. Stories are user
   goals; rules are single verifiable statements — if a statement needs "and",
   it's usually two rules. For each rule:
   - id: `feature.story.slug`, assigned once, never regenerated
   - `origin`: `prd` or `prototype` (whichever the rule came from)
   - `verify`: honest — `[checks]` only for what a script can prove; visual
     fidelity, tone and feel get `[agent]` (a judge compares the two
     surfaces), often beside `[checks]`. It lists only `checks` and `agent`.
   - `signoff`: who accepts it, by role — `[eng, product]` or `[eng, design]`.
     `eng` is always there. A person's acceptance is a signature, never a
     `verify` tier
   - `screens`: the screens it touches (unordered; tooling derives flow)
   - `focus` (optional): on a long screen, the anchor the rule is about, so
     opening it in the panel scrolls there. Without it the panel uses the
     first anchor the steps name
   - `steps`: given/when/then referencing screens and anchors **in backticks
     by id** — never URLs or CSS. Steps double as the human walkthrough
     script, so write them clickable.

4. **Read each statement alone.** Cover the steps, the because and the
   history, and read the statement as a stranger would. Does it say what the
   rule wants, in one or two sentences, in words a product or design reader
   would use? If it lists cases, they are steps. If it argues, that is
   `because`. If it has a dash-clause, that is a second sentence or a cut.
   The template AGENTS.md has the checklist ("Writing a rule"); ADR 0004
   has the before/after pairs.

5. **Hash.** `walkdown hash --write --blueprint <id>` stamps every statement.

6. **Questions, not guesses.** Everything the source doesn't answer (empty
   states, error copy, edge flows) becomes a question thread anchored to the
   rule/screen (`walkdown threads new --kind question --blueprint <id>`) — do
   not invent product decisions. Proceeding on an assumption
   is allowed only if the thread records the assumption.

7. **Lint early.** `walkdown lint --no-checks` until the structure is clean.

8. **Checks.** One test per `checks` rule, in the project's own framework,
   tagged with the rule id, selecting by anchor. Then `walkdown run` and a
   full `walkdown lint`.

9. **Report.** `walkdown status` — say what's verified, what awaits judgment
   (`agent` rules, and signatures), what questions are open, and any drift (screens
   awaiting design). Then say how to walk it: a `walkdown serve` already
   running anywhere on this machine serves the new blueprint as it is, with no
   restart and no `--blueprint`; otherwise `walkdown serve` from any directory.
   Clicking the extension on one of its pages opens it; `walkdown claims --url
   <page>` confirms the page is claimed.

Rules without screens are fine — headless rules (API behavior, CLI contracts,
jobs, policies) get the full ledger without the UI layer. The guardrail: a
rule is a behavior product would recognize as a requirement, never a mirror
of the unit-test suite.

Quality bar for a rule: a fresh session reading only the blueprint should
build the right thing, and a PM reading only the statement should recognize
their intent.

**When the thing in front of you is a bug, default to bug.** A rule is a claim
somebody could have decided differently and would sign; if the answer to "who
would have wanted this another way?" is nobody, write the check and skip the
rule. A defect that fits no existing rule is usually still just a defect — the
absence of a rule is not evidence of a gap, and a rule written to mark where a
bug happened is one nobody will ever meaningfully sign. Write the rule only
when the fix changed what the product *claims*, not when it changed whether
the product delivers a claim it had already made.

The failure here runs one way. Formulating after a fix inflates: it turns
defects into requirements and makes the board longer without making it truer.
Nobody has ever come back from this skill with too few rules.
