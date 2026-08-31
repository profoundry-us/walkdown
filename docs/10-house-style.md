# 10 — House style

Not a style guide imported from somewhere. This is what this repository already
does, written down so it keeps doing it — every rule below is here because it
was learned, and most of them cite the thing that taught us.

Two facts about the codebase set the tone. The median file in `lib/` is **92
lines**, and there is not one `TODO` in the entire source. Both are worth
keeping, and neither survives by accident.

## Comments explain the decision, never the code

A comment that restates the line below it is deleted. A comment that says why
the line is that way — what was tried, what broke, what would break if it
changed — is the most valuable thing in the file, because it is the only part
that cannot be re-derived by reading.

The measure: **could a competent stranger make this exact change six months
from now without re-learning what we learned?** `eslint.config.mjs` names the
two ReferenceErrors that cost a browser suite each. `rollup.config.mjs` says
which two settings are load-bearing and what a wrong guess deletes.
`src/panel/state.js` explains why the state is one object and not three dozen
free variables. Those are the model.

Corollaries:

- **A surprising line gets a comment; an obvious one does not.** Density
  should track how surprising the code is, not how long it is.
- **Record the failure, not the feeling.** "This is tricky" helps nobody;
  "an unanchored match ate the example's evidence" is a fact the next person
  can act on.
- **When a decision has two defensible answers, say which was rejected and
  why.** That is what makes it a decision rather than an accident.

## Vocabulary comes from the glossary

walkdown exists so a term means one thing. Its own code must hold to that:
[01-glossary.md](01-glossary.md) is authoritative, and a name that appears
there appears nowhere else in another form. No synonyms, no abbreviations that
only one file understands, no `st` for `status`.

Domain terms — thread statuses, verify tiers, roles, verdicts — belong in one
module and are imported, not typed as string literals in the file that happens
to need them. *(This is currently the repository's largest debt; see
[11-architecture.md](11-architecture.md).)*

## Files and modules

- **Around 300 lines is where a file starts asking to be split.** Not a limit
  — `lib/serve.js` and `src/panel/app.js` are both well past it and both are
  named in the architecture review as things to break up.
- **`lib/` stays acyclic.** It is a DAG today: `hash` and `locations` are
  leaves, `blueprint` sits in the middle, `serve` is the only hub. A cycle
  there is a design error, not an inconvenience to work around.
- **Named exports.** A default export appears only where a framework demands
  one (the two reporters, the Rollup and Playwright configs).
- **A module does one job and its name says which.** If the name needs "and",
  it is two modules.

## Where a thing goes

| | |
|---|---|
| `lib/` | everything that knows what walkdown means. No I/O of its own beyond files and the blueprint. |
| `bin/` | argument parsing and human rendering. No domain logic that a test would want to reach. |
| `src/panel/` | the panel's source. Never edit `lib/viewer/panel.js` — it is Rollup's output. |
| `tools/` | build and maintenance scripts for **this** repository. Nothing here ships. |
| `test/` | the ledger's own laws, over `lib/`, with `node:test`. |
| `checks/` | what a person sees or does, driving the real panel or embed with Playwright. |

Which of the last two a check belongs in is not a preference — it is
`ownership.evidence.same-surface`, and `blueprint/walkdown.yml` states it:
a rule describing a surface is not verified by a test that drives the layer
beneath it.

## Errors refuse, with a reason someone can act on

Every refusal in this codebase says what it refused and why, in a sentence a
person can act on: `walkdown move` refusing a non-empty destination ("two
ledgers merged into one directory is an edit of both"), the thread transitions
refusing an agent's `verified`, `walkdown pointer` leaving a file alone when it
finds an unclosed marker.

The pattern: **refuse rather than guess, and explain rather than fail.** A
guess is worse than a refusal because it produces a wrong answer confidently,
and the person who has to undo it does not know what to undo.

## Tests

- **One rule per test**, tagged `@rule:<id>` — in the test name for
  `node:test`, in `{ tag }` for Playwright.
- **A regression guard for a bug that fits no rule stays untagged**, with a
  comment saying why it claims none. Untagged is never a finding.
- **Test the claim, not the implementation.** The delivery suite copies the
  tree somewhere without `node_modules` and runs it, because reading
  `package.json` proves only that nobody *added* a dependency.
- **A test that writes must write somewhere disposable.** Pin every home the
  code reads — `WALKDOWN_HOME` *and* `WALKDOWN_SKILLS_DIR`; pinning one of two
  doors is not pinning anything, which we learned by writing five directories
  into a real `~/.claude/skills`.

## Generated files are never edited

Four files in this repository are machine-written: `lib/viewer/panel.js`,
`lib/viewer/walkdown.css`, `extension/vendor/*`, and `vendor/yaml.js`. Each has
a check that rebuilds to a scratch path and diffs, because rebuilding in place
would make the file current and the check could never fail. An edit to any of
them survives until the next build and then vanishes, which reads exactly like
the change never worked.

## Dependencies: none at runtime, ever

`git clone` is the whole install
([09-delivery.md](09-delivery.md), `delivery.install.clone-is-the-install`).
That is a rule, not a happy state: a new runtime dependency is a decision to be
argued for, and the only acceptable outcome is vendoring it the way
`vendor/yaml.js` is vendored.

The same constraint rules out a compile step. **No TypeScript**, not because
types are bad but because `tsc` puts a build between clone and run, which is
precisely what we spent a day removing. Where a type would genuinely help, JSDoc
gives most of the value and costs nothing at runtime.

## The concrete standards

What the philosophy above compiles down to, so nobody has to re-derive it.
These follow what the major JS projects converged on, with the deviations
named and reasoned.

### Tooling: the formatter owns style, the linter owns correctness

The split every large JS repo settled on: nobody reviews whitespace, and the
linter never argues taste. Here both jobs are **Biome** (`biome.json`, one
devDependency):

    npm run format          # biome format --write .
    npm run lint            # correctness rules only, wired into Highball

The lint set is deliberately small - undeclared names, unused variables,
unreachable code, `==`, duplicate keys, switch fallthrough. Every rule in it
catches a bug class this repo has actually had (its first run found a dead
helper and write-only state). Growing it requires the same argument: name the
failure it prevents. The old ESLint config's warning survives Biome: a rule
nobody asked for is a rule people learn to skip.

The one-time reformat is in `.git-blame-ignore-revs`; run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone and
blame answers with the person who decided a line, not the machine that
re-wrapped it.

### Types: JSDoc + tsc, the SvelteKit pattern, and never a compile step

`lib/` is typed the way SvelteKit and webpack are typed: plain JS, JSDoc
annotations, checked by `tsc --checkJs` (`jsconfig.json`, `npm run
check:types`, enforced by Highball). Zero build step, zero runtime cost -
clone-is-the-install holds.

The working rule: **let inference do it, annotate only where the checker
cannot follow, and treat a forced annotation as information.** Most of `lib/`
needed nothing. Where annotations were required, each found something - a
docstring lying about a return value, a union no caller used. An annotation
the checker did not force should usually be a `@typedef` documenting a real
contract (`Location` in `lib/locations.js`), not ceremony on obvious
parameters.

Scope grows with the refactor: `lib/` now, `bin/` when it splits, the panel
as panes are rebuilt on Lit - never annotate code that is about to be
rewritten.

### Naming

The ecosystem's conventions, which we already follow - written down so the
next fifty functions match the first fifty:

- `camelCase` functions and variables; `PascalCase` classes and Lit
  components; `UPPER_SNAKE` module-level constants.
- Predicates read as questions and return booleans: `is*`, `has*`, `can*`
  (`hashMatches`, `veilIsUp`). Never a predicate that returns a string.
- Actions start with the verb: `resolveLocations`, `writeRunRecord`,
  `placePointer`. Converters are `to*`/`from*`; factories are `create*`;
  event handlers are `on*`.
- Collections are plural (`threads`, `runs`); a lookup table says what it is
  keyed by (`rulesById`).
- And the rule above all of these: a name in
  [01-glossary.md](01-glossary.md) appears in exactly that form, everywhere.

### Modules and files

- **ESM only, named exports only** - a default export exists where a
  framework demands one (the two reporters). Named exports are what make
  renames find every caller.
- **`node:` prefix on builtins**, always.
- **Imports at the top, sorted by the formatter** - no lazy `import()` except
  in `bin/`, where it keeps command startup honest.
- **~300 lines is the smell threshold, not a limit.** The major projects do
  not lint file length and neither do we; culture holds it. The median `lib/`
  file is 92 lines. A file crossing ~300 owes a look at its seams; the two
  standing violations are named in [11-architecture.md](11-architecture.md)
  with their split plans.
- **One job per file, and the name says which.** `locations.js` resolves
  locations. If the name needs "and", it is two files.

### The panel: Lit, adopted with the refactor

The panel's UI standardizes on **lit-html + LitElement** - the stack Chrome
DevTools uses for the same kind of surface, and the smallest step from the
template-literal code we already write. What it buys, in order of how much we
have paid for the lack of it: values are escaped by default (the `esc()`
discipline stops being a convention someone can forget), events bind in the
template (`@click=${...}` instead of render-then-wire), and updates are
incremental (the focus-and-scroll preservation we hand-fought comes free).

Rules of engagement while the migration runs
([11-architecture.md](11-architecture.md) has the order):

- New panes and rewritten panes use `html\`...\`` from lit-html; a pane
  graduates to a LitElement component when it owns real state, not before.
- No raw `innerHTML` in new code. `unsafeHTML` is a code smell with one
  reviewer question attached: why is this not a template?
- Lit is bundled by Rollup into the committed panel bundle, exactly as yaml
  is vendored for the CLI - a devDependency at build time, zero install cost
  to adopters.
- One shared `CSSStyleSheet` adopted into each component's shadow root -
  Tailwind utilities do not pierce shadow boundaries, and per-component
  stylesheets would fork the design system.

## What this style is not

- **Not a style gate.** The lint set stays correctness-only; growth requires
  naming the failure a rule prevents.
- **Not a formatting debate.** Biome's output is the style. Nobody spends a
  minute on it, including in review.
- **Not a reason to rewrite working code.** These are the rules for what we
  write next, and for what we touch anyway. A file that breaks one of them and
  is not otherwise being changed is fine where it is.
