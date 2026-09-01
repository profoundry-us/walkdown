# walkdown-rspec

The RSpec adapter for [walkdown](../../README.md): a formatter that appends a walkdown
run record after every spec run, byte-compatible with the records the Playwright
reporter emits — so `walkdown status`, `lint`, and staleness detection work identically
whether checks are RSpec workflow specs or Playwright tests.

## Usage

Tag examples with the rule they verify:

```ruby
it "requires a guest email before payment", rule: "checkout.guest.email-required" do
  # ordinary workflow spec — Capybara, playwright-ruby, anything
end
```

Run with the formatter (alongside your normal one):

```
bundle exec rspec spec/workflows --format progress --format Walkdown::Formatter
```

In `blueprint/walkdown.yml`:

```yaml
runner:
  run_all: "bundle exec rspec spec/workflows --format progress --format Walkdown::Formatter"
  run_for_rule: "bundle exec rspec spec/workflows --format progress --format Walkdown::Formatter --tag 'rule:{id}'"
  list: "bundle exec rspec spec/workflows --dry-run --format Walkdown::ListFormatter"
  results: native
```

`Walkdown::ListFormatter` exists because RSpec's built-in JSON formatter omits custom
metadata: it dry-run-prints `rule:<id> <file>:<line>` per tagged example, which is what
`walkdown lint`'s coverage check scans.

## Behavior

- Statuses: passed → `pass`, failed → `fail` (first failure message recorded), pending →
  `skipped`. Multiple examples per rule aggregate (fail > pass > skipped; durations sum).
- Pass/fail results are stamped with the rule's current `statement_hash` (identical
  hashing to the JS CLI: sha256 of the whitespace-normalized statement, 12 hex chars).
- `git_sha`/`blueprint_sha` recorded, with a `-dirty` suffix for an unclean tree.
- Target: `WALKDOWN_TARGET` (default `local`). Who a run is recorded under is `ci`
  under CI and the `identity:` in `~/.walkdown/config.yml` otherwise — never an env
  var. `base_url`: `Capybara.app_host`, else `APP_HOST`.
- Evidence: add `evidence: ["tmp/screenshots/foo.png"]` metadata to an example to attach
  files your spec saved.
- Never fails the run: with no blueprint or no tagged examples it warns and writes nothing.

## Fixture

[fixture/](fixture/) is a self-contained RSpec project with its own blueprint — the
integration proof. From `fixture/`: `rspec` (the `.rspec` file wires the formatter), then
`node ../../../bin/walkdown.js status` reads the Ruby-written record with the JS CLI.
