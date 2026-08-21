import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const CONFIG_TEMPLATE = `project: __PROJECT__

# How to run this project's checks (tests tagged with rule ids).
# Keep the block for your framework; delete the other.
runner:
  # Playwright — add ['walkdown/reporter'] to the reporter array in playwright.config:
  run_all: "npx playwright test"
  run_for_rule: "npx playwright test --grep '@rule:{id}'"
  list: "npx playwright test --list --reporter=json"
  # RSpec — add the walkdown-rspec gem:
  # run_all: "bundle exec rspec spec/workflows --format progress --format Walkdown::Formatter"
  # run_for_rule: "bundle exec rspec spec/workflows --format progress --format Walkdown::Formatter --tag 'rule:{id}'"
  # list: "bundle exec rspec spec/workflows --dry-run --format Walkdown::ListFormatter"
  results: native
  targets:
    local:
      base_url: http://localhost:3000
      env: { APP_HOST: "http://localhost:3000" }
    # staging:
    #   base_url: https://staging.example.com
    #   env: { APP_HOST: "https://staging.example.com" }

# Where the design prototype lives; \`walkdown serve\` mounts it at /prototype/.
# Design owns this directory — see blueprint/AGENTS.md.
# prototype:
#   root: prototype/

embed:
  anchor_attribute: data-testid   # shared element ids across prototype, app, and checks
  port: 4700

authoring:
  location: tests/                # where checks live
  style: >
    Tag each test with its rule id. Select elements by anchor, never CSS paths.
    One rule per test. See blueprint/AGENTS.md.
`;

const STORYBOARD_TEMPLATE = `# The screen registry: rules reference screens by id, never by URL.
screens: []
#  - id: home
#    title: Home
#    prototype: /screens/home.html   # null if not yet designed — then file a design-request thread
#    app: { path: / }
#    anchors: [home.cta]
`;

const FEATURE_TEMPLATE = `# Rename this file after your first feature (one file per feature).
# feature: onboarding
# title: New-user onboarding
# stories:
#   - id: onboarding.signup
#     title: Visitor creates an account
#     statement: As a visitor, I can create an account with my email.
#     rules:
#       - id: onboarding.signup.email-required
#         origin: prd                  # prd | prototype | thread:<id> | walkdown
#         statement: A visitor must provide a valid email address to sign up.
#         verify: [checks]             # checks | agent | human — all listed are required
#         screens: [home]
#         steps:                       # run \`walkdown hash --write\` after editing statements
#           given:
#             - A visitor on screen \`home\`
#           when:
#             - Click anchor \`home.cta\`
#           then:
#             - ...
`;

const AGENTS_TEMPLATE = `# Walkdown — agent conventions

This project's spec lives in \`blueprint/\`: features, stories, and **rules**
(acceptance criteria), plus the storyboard (screens), threads (questions &
notes), and the runs ledger. The blueprint is the single source of truth for
*what to build*. Read this before building, testing, or reviewing.

## Before you build

- \`walkdown status --json\` gives per-rule verification state, drift, and your
  work queue: \`attention\` items with \`who: "agent"\`.
- A rule's plain-language \`statement\` is authoritative; its \`steps\` elaborate
  it. If they disagree, the statement wins. After editing any statement, run
  \`walkdown hash --write\` so staleness detection keeps working.
- If a rule is ambiguous, do not guess. File a question thread anchored to the
  rule/screen/element (\`POST /api/threads\` via \`walkdown serve\`, or write the
  YAML) and say what you assumed if you proceed.

## Ownership boundaries

- **Never edit \`prototype/\`** — design owns it. If the spec needs a screen that
  design hasn't drawn: set \`prototype: null\` on the storyboard screen, put a
  sketch under \`proposals/\` if a picture helps, and file a design-request
  thread anchored to the screen. Lint enforces this routing.
- The PRD is product's surface. Rules you introduce get
  \`origin: thread:<id>\` (or \`walkdown\`) so the drift report stays honest.

## Building

- Carry anchors **verbatim** from prototype to implementation. The attribute is
  \`embed.anchor_attribute\` in \`blueprint/walkdown.yml\` (default
  \`data-testid\`). Every element the spec references keeps its anchor.
- Reference screens and anchors by id — never URLs, never CSS selectors.

## Checks

- Write tests in this project's own framework and house style. Tag each with
  its rule id — Playwright: \`{ tag: '@rule:<id>' }\`; RSpec: \`rule: "<id>"\`
  metadata. One rule per test. Select by anchor (\`getByTestId\`), never CSS
  paths.
- Run with \`WALKDOWN_ACTOR=agent walkdown run [--target <t>] [--rule <id>]\` —
  the reporter/formatter appends the run record automatically.
- \`walkdown lint\` before you finish: coverage, staleness, storyboard refs,
  thread hygiene.

## Threads

- Work your queue: \`address\` open notes; \`incorporate\` answered questions —
  fold the answer into the rule's statement/steps, then mark the thread.
- Mutate threads only through \`walkdown thread <id> --actor agent
  --reply "..." --status <s>\` — never raw YAML edits — so transitions stay
  validated.
- After fixing what a note asks: reply with what you changed and which run
  re-verified it, then \`--status addressed\`.
- You may **never** set \`verified\` or \`waived\`. Those are human judgments —
  you claim work; a person accepts it.

## Quick reference

    walkdown status [--json]        derived verification + queues + drift
    walkdown status <rule-id>       one rule in full
    walkdown lint                   validate everything
    walkdown hash --write           re-stamp statement hashes
    walkdown run [--target] [--rule]  run checks, record the run
    walkdown threads [--rule <id>]  active questions & notes
    walkdown thread <id> [...]      view / reply / transition
    walkdown serve                  viewer + embed + pin/walkdown APIs
`;

const CLAUDE_POINTER = `<!-- walkdown:begin -->
## Walkdown

This project's spec is the Walkdown blueprint in \`blueprint/\`. Before building,
testing, or reviewing, read and follow \`blueprint/AGENTS.md\`.
<!-- walkdown:end -->
`;

/** Scaffold blueprint/ (plus agent conventions) in `root`. Returns created paths. */
export function scaffold(root) {
  root = resolve(root);
  const bp = join(root, 'blueprint');
  if (existsSync(join(bp, 'walkdown.yml')))
    throw new Error('blueprint/walkdown.yml already exists — refusing to overwrite');

  for (const d of ['features', 'threads', 'runs']) mkdirSync(join(bp, d), { recursive: true });
  const created = [];
  const write = (rel, content) => {
    writeFileSync(join(root, rel), content);
    created.push(rel);
  };

  write('blueprint/walkdown.yml', CONFIG_TEMPLATE.replace('__PROJECT__', basename(root)));
  write('blueprint/storyboard.yml', STORYBOARD_TEMPLATE);
  write('blueprint/features/_template.yml', FEATURE_TEMPLATE);
  write('blueprint/threads/.gitkeep', '');
  write('blueprint/runs/.gitkeep', '');
  write('blueprint/AGENTS.md', AGENTS_TEMPLATE);

  const claudeMd = join(root, 'CLAUDE.md');
  if (!existsSync(claudeMd)) {
    write('CLAUDE.md', CLAUDE_POINTER);
  } else if (!readFileSync(claudeMd, 'utf8').includes('blueprint/AGENTS.md')) {
    appendFileSync(claudeMd, `\n${CLAUDE_POINTER}`);
    created.push('CLAUDE.md (appended pointer)');
  }
  return created;
}
