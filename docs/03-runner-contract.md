# 03 — Runner contract

**Criteria are the interface; tests are a pluggable implementation.** walkdown never owns
test authorship or execution. Checks are the team's own integration tests — RSpec workflow
specs driving Playwright, Playwright TS, Cypress, minitest system tests, anything — written
the way the team's engineers would have written them anyway. walkdown defines only a
three-part contract any project can satisfy in its config.

Framework-agnosticism lives in **configuration and per-project instructions, not codegen**:
because the test author is an agent, "support a framework" means telling the agent (in
`walkdown.yml` + CLAUDE.md) where checks live and how to tag them — not shipping a
generator.

## Part 1 — Linkage: how a test declares its rule

A check is any test carrying a rule ID, in the framework's native idiom:

```ruby
# RSpec — arbitrary metadata is first-class
it "requires a guest email before payment", rule: "checkout.guest.email-required" do
  ...
end
```

```ts
// Playwright — tags
test('guest email required', { tag: '@rule:checkout.guest.email-required' }, async ({ page }) => { ... });
```

```
# Universal fallback for frameworks with no metadata: magic comment on the test
# @rule checkout.guest.email-required
```

The contract: given a rule ID, the project can **(a)** find its checks, **(b)** run only
them, **(c)** attribute results back. One test may verify one rule; several tests may
verify the same rule; a test verifying multiple rules should be split (lint warns).

Optionally, a check carries the rule's `statement_hash` in a nearby comment so lint can
flag checks written against an older wording.

## Part 2 — Execution: command templates

```yaml
# blueprint/walkdown.yml
project: acme-store
prototype:
  root: prototype/          # storyboard `prototype:` paths resolve against this;
                            # `walkdown serve` mounts it at /prototype/ on its own port
runner:
  run_all:  "bundle exec rspec spec/workflows --format progress --format Walkdown::Formatter --out {results}"
  run_for_rule: "bundle exec rspec spec/workflows --tag 'rule:{id}' --format Walkdown::Formatter --out {results}"
  list:     "bundle exec rspec spec/workflows --dry-run --format json"
  results: native            # native | junit
  targets:
    local:
      base_url: http://localhost:3000
      env: { APP_HOST: "http://localhost:3000" }
    staging:
      base_url: https://staging.acme.com
      env: { APP_HOST: "https://staging.acme.com" }

# Instructions the builder agent follows when authoring checks:
authoring:
  location: spec/workflows/
  style: >
    Write workflow specs in house style (see spec/workflows/README.md). Tag each example
    with rule: metadata. Select elements by anchor (test id), never by CSS path.
    One rule per example.

# What a judging agent must be told about THIS project that no generic prompt
# can know. `walkdown judge` carries each line into every prompt verbatim, after
# its built-in governance (claim-never-accept, fail-needs-a-thread, append-only).
# Most projects need none: the target a judge runs against - a dev server, a
# review app, staging - already exists to absorb what judging does to it.
governance:
  - Checkout against the sandbox payment keys only; a declined test card is the
    happy path, not an incident.
```

- walkdown shells out; it does not know what RSpec is. `{id}`, `{results}`, and target
  `env` are the only substitutions.
- **Commands run in the CODE, not beside the spec.** Those are the same directory only
  while the blueprint lives in the repository, and `walkdown init` puts it outside by
  default — so the cwd is the code root: the `roots` of this project's config entry, or
  the spec's own parent when there is no entry. `walkdown where` reports it as `code`.
- `{results}` expands to an **absolute** path under that root, `.walkdown/results.out`
  by default. Name another with `runner.results_file` when a framework insists; a
  relative value is resolved against the code root, never the working directory.
- **Targets** reuse whatever base-URL mechanism the project already has (Capybara
  `APP_HOST`, Playwright `baseURL` env). The target name flows into the run record, which
  is what powers multi-environment status ("passes locally, never passed on staging").
- `list` powers coverage linting: RSpec's `--dry-run --format json` enumerates examples
  with metadata; Playwright has `test --list`; the grep-for-magic-comment fallback covers
  the rest.

## Part 3 — Results ingestion: two tiers

**Tier 1 (universal): JUnit XML.** Every framework emits it (`rspec_junit_formatter`,
Playwright's junit reporter, pytest, minitest). walkdown maps test cases to rule IDs via
the tag embedded in the test name or a sidecar produced by `list`. Lowest fidelity, zero
integration cost.

**Tier 2 (native): a tiny formatter per framework** that emits per-rule result entries
directly — status, failure message, duration, screenshot/trace paths as evidence.

- **Playwright** ships inside the `walkdown` package: add `['walkdown/reporter']` to the
  config's `reporter` array and every run appends a run record — rule results aggregated
  from `@rule:` tags, current `statement_hash` stamped, failure screenshots/error context
  attached as evidence, `git_sha` recorded (with a `-dirty` suffix for an unclean tree).
  Target/actor come from options or `WALKDOWN_TARGET`/`WALKDOWN_ACTOR` (defaulting to
  `ci` under CI, else the OS username). It never fails the test run; with no blueprint
  or no tagged tests it prints a warning and records nothing.
- **RSpec** ships as the `walkdown-rspec` gem (in-repo: `adapters/rspec/`):
  `--format Walkdown::Formatter` appends the identical record shape — statuses mapped
  (pending → skipped), first failure message captured, `evidence:` metadata attached,
  same hashing, git provenance, and env vars as the Playwright reporter. Its companion
  `Walkdown::ListFormatter` is the `runner.list` command (RSpec's JSON formatter omits
  custom metadata, so the lister prints `rule:<id> <file>:<line>` per tagged example).
  Adapters are small enough that an agent can write a new one on demand.

Either tier ends the same way: walkdown appends a run record to `blueprint/runs/`
(schema in [05-runs-ledger.md](05-runs-ledger.md)).

## Lint rules (`walkdown lint`)

1. Every rule whose `verify` list includes `checks` has ≥ 1 check (via `list`).
2. Every check references a rule ID that exists.
3. Steps whose `statement_hash` no longer matches their statement → stale.
4. Checks carrying a stale `statement_hash` → possibly-stale check.
5. Rules referencing screens or anchors not in the storyboard.
6. Threads stuck at `answered` (knowledge not yet incorporated); `waived` threads are
   exempt.
7. A test tagged with multiple rules → warn (split it).

## CLI surface (v1)

```
walkdown init                      # scaffold blueprint/ in a project
walkdown status [--target X]       # derived per-rule status table (see 05)
walkdown lint                      # the checks above
walkdown run [--target X] [--rule ID]
walkdown serve                     # panel + embed + blueprint API + feedback receiver
walkdown extract [--source prd|prototype]   # propose a merge diff
```

`status` and `lint` are also the agent's interface: their output is designed to be read by
Claude Code mid-build ("which rules have no checks yet?", "what failed on the last run?").
An MCP wrapper over the same core is a later nicety, not a v1 requirement.
