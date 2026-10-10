# ADR 0016 — Rule focus

- **Status:** accepted 2026-10-10 by Topher; not yet built. Proposed the same
    day by the agent from [issue #24](https://github.com/profoundry-us/walkdown/issues/24);
    its rules were approved in his walkdown first (ADR 0015 §8).
- **Date:** 2026-10-10
- **Deciders:** Topher (product, eng)
- **Builds on:** ADR 0015 §8 (the walkdown is the design review), the anchor
    contract in [06-prototype-contract.md](../../06-prototype-contract.md),
    `panel.rules.takes-you-there`
- **Threads:** issue #24

## Context

Opening a rule takes the frame to the rule's screen and stops at the top of the
page. On a long screen, the reviewer then has to hunt for the part the rule is
about. Florence's design system split one long page into seven to work around
this, and three of the seven are still several screens tall.

Hovering an anchor in a rule's steps outlines that element with the pin-mode
ring, but does not scroll to it. Below the fold, the ring is drawn where nobody
sees it.

ADR 0015 makes this matter more. The walkdown is now where a person reviews a
design, so every rule on a long proposed page opens at the same spot, and the
reviewer finds the part each rule is about by hand, rule after rule.

"Scroll to the first anchor the steps name" helps but is not enough on its own:
anchors are optional, so a blueprint written from a designer's file or in a
quick pass may name none, and where a rule opens would depend on how its steps
happen to be worded.

## Decision

### 1. A rule may name its focus

```yaml
- id: components.states.dropdown-open
  screens: [ds-controls]
  focus: ds.dropdown-open
```

`focus` is one anchor id, declared on one of the rule's screens. It is optional.

### 2. Opening a rule goes to its focus

The panel goes to the rule's screen as it does today, then scrolls `focus` into
view, centred, and outlines it with the pin-mode ring. On the fade it does this
on both surfaces, so the design and the build line up at the same element.

With no `focus`, the panel uses the first anchor the steps name. With none of
those either, it stays at the top of the screen, as it does today. A blueprint
that never sets `focus` behaves exactly as before.

### 3. Hovering a step's anchor scrolls to it

Hovering or clicking an anchor in a step scrolls that element into view before
outlining it. It applies on whichever surface is in front.

### 4. Lint checks it

Lint refuses a `focus` that names no anchor declared on one of the rule's
screens, the same way it checks the anchors a step mentions.

### 5. It is not part of the wording

`focus` is not hashed. Changing it never makes a verdict stale, because it
changes where a rule opens, not what the rule says.

## Not now

- **Focus per screen** for a rule spanning several
  (`screens: [{ id: ds-controls, focus: ds.buttons }]`). Left out until a
  blueprint needs it.
- **A focus that is not an anchor** (a CSS selector or a scroll offset). Rules
  reference elements by anchor only.

## Consequences

- An additive schema field: no upgrade step, and an older walkdown ignores it.
  [02-blueprint-schema.md](../../02-blueprint-schema.md) gains it.
- `skills/formulate` mentions it for rules on long screens.
- It suits 0.5.0, alongside ADR 0015, because the walkdown becomes the design
  review there. It changes nothing in ADR 0015 and can slip to 0.5.1 on its own.
