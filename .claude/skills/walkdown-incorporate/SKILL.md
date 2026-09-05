---
name: walkdown-incorporate
description: Work the walkdown agent queue - incorporate an answered question into the blueprint (fold the answer into rules and steps, route storyboard and design changes, add checks) or address an open note (fix, verify, reply). Use when status shows agent-queue items (incorporate or address), when a thread is answered awaiting incorporation, or when asked to handle a specific thread id.
---

# Incorporate & address

Conventions live in the blueprint's `AGENTS.md` (`walkdown where spec` names the directory) — read it first. The governing idea:
knowledge must land in the blueprint, not stay in thread side-channels — and
you claim work, you never accept it.

## Find the work

`walkdown status --json` → `attention` items with `who: "agent"`:
`incorporate` (an answered question) or `address` (an open note). Read the full
thread: `walkdown thread <id>`.

## Incorporating an answered question

1. **Decide the spec impact.** Does the answer amend an existing rule's
   statement/steps, or create a new rule? New rules: id extends the story
   (`story.id` + `.slug`), `origin: thread:<id>`, honest `verify` list
   (`checks` only for what a script can prove; `agent`/`human` for judgment).
2. **Statement edits** → immediately `walkdown hash --write`.
3. **Screens.** If the change needs a screen or state the storyboard lacks,
   add it — and check design coverage. If design hasn't drawn it: set
   `prototype: null`, optionally sketch under `proposals/` (**never** touch
   `prototype/` — design owns it), and file a design-request thread anchored
   to the new screen explaining what the spec needs and pointing at the
   proposal. Lint enforces this routing.
4. **Implement** the app change, carrying anchors verbatim
   (`embed.anchor_attribute`, default `data-testid`).
5. **Check.** Write or extend a test in the project's own framework, tagged
   with the rule id, selecting by anchor. `walkdown run [--rule <id>]` —
   confirm a run record was appended.
6. **Validate.** `walkdown lint` must be clean (coverage, hashes, refs).
7. **Close the thread** — only via the CLI so the transition is validated:
   `walkdown thread <id> --as-agent --reply "<what changed, which files,
   which rule(s), which run re-verified it>" --status incorporated`. It records
   under the human you are working for — that is whose instruction it was —
   and `--as-agent` says a machine typed it.

## Addressing an open note

Same shape, smaller: understand exactly what the note's anchor points at →
fix it (spec change? follow the incorporation steps; implementation-only?
just fix, carrying anchors) → re-verify with a run (`walkdown run --rule ...`,
or an agent walkdown via the walkdown-judge skill for judgment rules) →
`walkdown thread <id> --as-agent --reply "<fix + evidence>"
--status addressed`.

## Never

- Never set `verified` or `waived` — human judgments.
- Never mark `incorporated` while the knowledge only exists in the thread —
  the rule text is the test: could a fresh session build correctly from the
  blueprint alone, without reading this thread?
- Never edit thread YAML by hand; the CLI validates transitions.
