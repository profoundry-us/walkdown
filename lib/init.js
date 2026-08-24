import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SKILLS_DIR = new URL('./skills/', import.meta.url).pathname;
const AGENTS_TEMPLATE = readFileSync(new URL('./templates/AGENTS.md', import.meta.url), 'utf8');

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

const CLAUDE_POINTER = `<!-- walkdown:begin -->
## walkdown

This project's spec is the walkdown blueprint in \`blueprint/\`. Before building,
testing, or reviewing, read and follow \`blueprint/AGENTS.md\`.
<!-- walkdown:end -->
`;

/**
 * Idempotently ensure the walkdown scaffold in `root`. Existing files are
 * never destroyed: user-owned files (config, storyboard, features) are always
 * kept; walkdown-owned docs (AGENTS.md, skills) are kept unless `force`, with
 * a note when the kept copy differs from the packaged version. Returns
 * [{ path, action }] with action: created | up-to-date | kept | kept-differs |
 * updated | pointer-appended.
 */
export function scaffold(root, { force = false } = {}) {
  root = resolve(root);
  const results = [];
  const ensure = (rel, content, { owned = false } = {}) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs)) {
      writeFileSync(abs, content);
      return results.push({ path: rel, action: 'created' });
    }
    if (readFileSync(abs, 'utf8') === content) return results.push({ path: rel, action: 'up-to-date' });
    if (owned && force) {
      writeFileSync(abs, content);
      return results.push({ path: rel, action: 'updated' });
    }
    results.push({ path: rel, action: owned ? 'kept-differs' : 'kept' });
  };

  ensure('blueprint/walkdown.yml', CONFIG_TEMPLATE.replace('__PROJECT__', basename(root)));
  ensure('blueprint/storyboard.yml', STORYBOARD_TEMPLATE);
  ensure('blueprint/features/_template.yml', FEATURE_TEMPLATE);
  ensure('blueprint/threads/.gitkeep', '');
  ensure('blueprint/runs/.gitkeep', '');
  // Unfinished sittings live here. They are working state, not history — the
  // directory ignores its own contents so no half-judged session is committed.
  ensure('blueprint/drafts/.gitignore', '*\n!.gitignore\n');
  ensure('blueprint/AGENTS.md', AGENTS_TEMPLATE, { owned: true });

  for (const file of readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const name = file.replace(/\.md$/, '');
    ensure(`.claude/skills/${name}/SKILL.md`, readFileSync(join(SKILLS_DIR, file), 'utf8'), { owned: true });
  }

  const claudeMd = join(root, 'CLAUDE.md');
  if (!existsSync(claudeMd)) {
    writeFileSync(claudeMd, CLAUDE_POINTER);
    results.push({ path: 'CLAUDE.md', action: 'created' });
  } else if (!readFileSync(claudeMd, 'utf8').includes('blueprint/AGENTS.md')) {
    appendFileSync(claudeMd, `\n${CLAUDE_POINTER}`);
    results.push({ path: 'CLAUDE.md', action: 'pointer-appended' });
  } else {
    results.push({ path: 'CLAUDE.md', action: 'up-to-date' });
  }
  return results;
}
