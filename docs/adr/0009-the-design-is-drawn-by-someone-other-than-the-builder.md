# ADR 0009 — The design is drawn by someone other than the builder

- **Status:** proposed 2026-09-29; awaiting Topher. Nothing here is built.
- **Date:** 2026-09-29
- **Deciders:** Topher (product, eng, design)
- **Builds on:** "never edit `prototype/`" (`AGENTS.md`, "Ownership
    boundaries"), proposals as shop drawings and as-built drawings (ADR 0007),
    separate blueprints as a supported topology (roadmap, problem 9), the
    `request` reason (`lib/vocab.js`).
- **Threads:** [issue #2](https://github.com/profoundry-us/walkdown/issues/2)
    (the open half); roadmap problem 6, "Design records changes, an agent
    makes them", listed **blocked**.

## Context

`AGENTS.md` says *never edit `prototype/`* — design owns it. When the spec
needs a screen design has not drawn, the agent sets `prototype: null`,
sketches under `proposals/` if a picture helps, and files a design-request
thread anchored to the screen. Lint enforces the routing
(`ownership.drift.design-requests-required`).

That rule was written for one staffing: a designer who is a person. It
has two holes.

1. **A request has nowhere to go.** An open note routes to the agent
   (`lib/status.js`, `who: 'agent', action: 'address'`), including a design
   request the agent is forbidden to act on. The agent either carries an item
   it cannot do or marks it addressed without addressing it (issue #2).
2. **Nobody may draw.** On a project where an agent is the designer, "never"
   means the design never moves. The roadmap puts the real question plainly:
   does the ownership rule become conditional on who is staffing design? And
   "never" is easier to obey than "unless you are the design agent".

On 2026-08-27 Topher suggested a way through: a *separate blueprint* in which
the prototype is the app. The design is changed there, walked like any build,
and then carried across to the blueprints that want it. The rule stays
absolute; the drawing still moves.

On 2026-09-29 he said what the rule is for: *I will likely want the agent to
design my projects but at work we have a real designer who will be doing it.
I think the important thing for me is that a different agent builds the
designs / prototype than the one that is building the actual implementation
so that we get two different perspectives.*

That changes what the rule protects. It was never "an agent may not draw".
It is **the builder may not draw**. A design is worth comparing against only
if someone else made it. If the agent building a screen could also redraw
the design, every gap between the two could be closed from either side, and
the fade would show nothing.

## Decision

**Design is drawn by someone other than the builder. Who that is depends on
the project and is declared per blueprint. What is fixed is that the two are
never the same.**

### 1. The rule, restated

`prototype/` is never edited by whoever builds the implementation. That holds
whether design is staffed by a person, an agent, or a person working with one.
The builder's own drawings are still `proposals/` (before design draws) and
`as-built/` (after the build), and neither is design authority.

### 2. Each blueprint says who designs

```yaml
# walkdown.yml
design:
  by: person      # person (the default) | agent
```

- **`person`**: today's behaviour, and the default, so no existing blueprint
  changes meaning. A designer draws in their own tools and lands the result in
  `prototype/`. walkdown's part is the queue (§3) and the comparison.
- **`agent`**: a design agent draws. It is a separate agent from the builder.
  It works through the design blueprint (§4), never in the building session,
  and never on the builder's instructions alone.

Nothing else in walkdown reads `by`. It decides where requests queue and
which skill `AGENTS.md` sends an agent to. It does not change who may sign.
The `design` signoff role is still a person's.

### 3. A design request queues for design

A note whose reason is `request` routes to **`design`**, not `agent`. It
becomes a third audience in the status report's attention list, beside the
agent and the person. This closes the first half of issue #2.

- With `by: person`, the design queue is the designer's, shown in the report
  and the panel the way a person's queue is today.
- With `by: agent`, it is what the design agent reads when it starts. The
  building agent's queue no longer holds work it is forbidden to do.

A request is anchored to a screen, and the element if it has one, as the
ownership rule already asks. It still closes the way a request closes today:
a person accepts it once the design has landed.

### 4. A design agent draws in a blueprint of its own

This is the Aug 27 idea, made concrete. A blueprint with `by: agent` has a
sibling **design blueprint**. There, the two surfaces are:

| | design blueprint | the building blueprint |
|---|---|---|
| **Prototype** surface | `prototype/`, the design of record | `prototype/` |
| **App** surface | the draft design, in a folder of its own | the build |

The design agent works only in the draft, and the design blueprint's rules
are the open design requests. Walking the design blueprint uses the fade the
same way a build walk does: the draft over the design of record, pins on the
draft, a person's pass or fail. When a person accepts a screen, the draft is
copied onto `prototype/` and the request closes. Only then does the building
blueprint see the new design, and it arrives as a design change the builder
did not make.

The copy is made by the design agent, or by a person, after that acceptance.
The builder never makes it. `prototype/` still has one way in, and the fade
on the building blueprint still compares against someone else's drawing.

A project with `by: person` may keep a design blueprint too, if its designer
wants their drafts walked before they land. Nothing requires it.

### 5. What "a different agent" means

walkdown cannot tell one agent session from another, and this ADR does not
pretend it can. "Different" means:

- a separate session, started for design with its own skill
  (`walkdown-design`, to be written), which reads the spec and the design
  requests, not the implementation's code;
- that never takes instructions from the building session other than through
  a filed request;
- and whose work is recorded as design's (`via` on its threads and runs),
  so a reader can see who drew what.

The building agent's `AGENTS.md` keeps *never edit `prototype/`* as an
absolute. It gains one line: design work goes through a request, and a
request is for design, not for you.

## Consequences

- Roadmap problem 6 is unblocked. Design records a change, and whoever is
  designing makes it, without the builder crossing the line.
- Issue #2's first half is fixed by §3. Its second half, a screen-anchored
  thread rendering as "(unanchored)", is fixed separately either way.
- Rules change wording, and each needs Topher's approval before it is built:
  - `status.attention.blocked-queues` ("for an agent or a person") gains design;
  - `ownership.drift.design-requests-required` gains the design queue;
  - a new rule for `design.by`, and one for the design blueprint's copy step.
- `walkdown thread new --screen` should file a screen-anchored `request` by
  default. That fix was waiting on this decision.
- walkdown's own blueprint is `by: person` (Topher designs it) and changes
  nothing until he says otherwise.

## What this does not decide

- **The copy step's tool.** Whether carrying a draft onto `prototype/` is a
  command (`walkdown design accept <screen>`) or a documented copy waits on
  the first design blueprint.
- **Enforcement.** A local hook (Highball) that refuses writes to `prototype/`
  from a building session would make §1 mechanical. It is plausible and not
  decided. walkdown itself only records.
- **A designer's own tools.** Figma exports, a design system's components:
  how a person's design becomes files in `prototype/` stays outside walkdown,
  as it is today.
- **Where the draft folder lives and what it is called.** It belongs to the
  design blueprint and is served as its app. The name waits on the first one.

## Alternatives considered

- **Let the agent edit `prototype/` when `by: agent`.** Rejected. It is the
  "unless you are the design agent" rule the roadmap warns about, and with one
  agent doing both jobs, the two-perspectives point is lost.
- **Route requests to the person, not a third queue.** Rejected. With
  `by: agent` the person is not the one who draws. They would be asked to
  hand-carry every request to the design agent.
- **An `audience:` field on every thread.** Rejected as larger than the
  problem. The `request` reason already says who a note is for; the queue only
  has to read it.
- **No design blueprint; the design agent edits a branch.** Rejected. A branch
  is invisible to the panel, so the design change would land unwalked. The
  separate blueprint is how it gets looked at before the builder inherits it.
