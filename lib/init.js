import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { skillsHome } from './locations.js';

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

export const POINTER_BEGIN = '<!-- walkdown:begin -->';
export const POINTER_END = '<!-- walkdown:end -->';

/**
 * The paragraph that tells an agent this project has a spec, fenced in markers
 * so walkdown can find its own words again later and change nothing else.
 */
export const pointerBlock = (where) => `${POINTER_BEGIN}
## walkdown

This project's spec is the walkdown blueprint in \`${where}\`. Before building,
testing, or reviewing, read and follow that folder's \`AGENTS.md\`. Run
\`walkdown where\` to see where everything this project uses actually lives.
${POINTER_END}
`;

/*
 * Where an agent in this project would look for its instructions.
 *
 * Only files that already exist: this list is for finding the home a project
 * has ALREADY chosen, not for proposing one. Order is preference among the
 * ones found, and CLAUDE.md leads only because walkdown's own agents read it.
 *
 * Deliberately root-only. In a monorepo the pointer belongs beside the pack it
 * describes, and the way to say that is `walkdown init --dir packs/billing`,
 * not a search that guesses which of thirty packs the spec was about.
 */
const POINTER_HOMES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.github/copilot-instructions.md',
  'CONVENTIONS.md',
];

/** The agent-instruction files this project actually has. */
export function pointerHomes(root) {
  return POINTER_HOMES.filter((rel) => existsSync(join(root, rel)));
}

/**
 * Put the pointer in a file, without taking anything that was not offered.
 *
 * Three cases and no fourth: no file, so write one; no marker, so add the block
 * at the end; a marker, so replace what is between the markers and leave every
 * other line exactly as it was. Replacing rather than skipping is what makes a
 * moved spec correct itself - a pointer that still names `blueprint/` after
 * the spec moved out is worse than no pointer, because an agent believes it.
 */
export function placePointer(file, block) {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, block);
    return 'created';
  }
  const text = readFileSync(file, 'utf8');
  const from = text.indexOf(POINTER_BEGIN);
  if (from < 0) {
    appendFileSync(file, `${text.endsWith('\n') ? '' : '\n'}\n${block}`);
    return 'pointer-appended';
  }
  const to = text.indexOf(POINTER_END, from);
  if (to < 0) return 'kept'; // somebody is mid-edit; do not guess
  const current = text.slice(from, to + POINTER_END.length + 1);
  if (current === block) return 'up-to-date';
  writeFileSync(file, text.slice(0, from) + block + text.slice(to + POINTER_END.length + 1));
  return 'pointer-updated';
}

/*
 * Which skills an adopting project gets.
 *
 * Not all of them. `walkdown-sitting` drives `tools/sitting.mjs`, a harness
 * that exists in walkdown's own repository and nowhere else, and a skill whose
 * first command is missing is worse than no skill - an agent follows it,
 * fails, and improvises the procedure the skill existed to stop it improvising.
 * It stays here so this repository has one copy of everything, and ships
 * nowhere until the harness it needs does.
 */
const SHIPPED = [
  'walkdown-setup',
  'walkdown-formulate',
  'walkdown-judge',
  'walkdown-incorporate',
  'walkdown-backlog',
];

/** The packaged skills, as [{ name, content }]. */
export function skillFiles() {
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith('.md') && SHIPPED.includes(f.replace(/\.md$/, '')))
    .sort()
    .map((f) => ({
      name: f.replace(/\.md$/, ''),
      content: readFileSync(join(SKILLS_DIR, f), 'utf8'),
    }));
}

/**
 * Put the skills in a skills directory - a project's `.claude/skills/` or the
 * person's own. Same idempotence as everything else here: a modified copy is
 * kept and reported rather than overwritten, because a person who edited a
 * procedure meant it.
 */
export function installSkills(into, { force = false } = {}) {
  return skillFiles().map(({ name, content }) => {
    const abs = join(into, name, 'SKILL.md');
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs)) {
      writeFileSync(abs, content);
      return { path: abs, action: 'created' };
    }
    if (readFileSync(abs, 'utf8') === content) return { path: abs, action: 'up-to-date' };
    if (force) {
      writeFileSync(abs, content);
      return { path: abs, action: 'updated' };
    }
    return { path: abs, action: 'kept-differs' };
  });
}

/**
 * Idempotently ensure the walkdown scaffold in `root`. Existing files are
 * never destroyed: user-owned files (config, storyboard, features) are always
 * kept; walkdown-owned docs (AGENTS.md, skills) are kept unless `force`, with
 * a note when the kept copy differs from the packaged version. Returns
 * [{ path, action }] with action: created | up-to-date | kept | kept-differs |
 * updated | pointer-appended.
 */
export function scaffold(root, { force = false, specDir = null, skills = null } = {}) {
  root = resolve(root);
  /*
   * Where the spec goes. Outside the repository unless asked otherwise -
   * adopting walkdown should cost a project nothing and be reversible by
   * deleting one directory. Runs and threads follow it there without being
   * mentioned, which is the point of them following it (docs/08-locations.md).
   */
  const spec = specDir ? resolve(specDir) : join(root, 'blueprint');
  const inRepo = spec.startsWith(root + '/');
  const results = [];
  const ensure = (rel, content, { owned = false, at = root } = {}) => {
    const abs = join(at, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const shown = abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs;
    if (!existsSync(abs)) {
      writeFileSync(abs, content);
      return results.push({ path: shown, action: 'created' });
    }
    if (readFileSync(abs, 'utf8') === content)
      return results.push({ path: shown, action: 'up-to-date' });
    if (owned && force) {
      writeFileSync(abs, content);
      return results.push({ path: shown, action: 'updated' });
    }
    results.push({ path: shown, action: owned ? 'kept-differs' : 'kept' });
  };

  const at = spec;
  ensure('walkdown.yml', CONFIG_TEMPLATE.replace('__PROJECT__', basename(root)), { at });
  ensure('storyboard.yml', STORYBOARD_TEMPLATE, { at });
  ensure('features/_template.yml', FEATURE_TEMPLATE, { at });
  ensure('AGENTS.md', AGENTS_TEMPLATE, { owned: true, at });
  /*
   * No runs/, threads/ or drafts/ are scaffolded. Every writer creates its own
   * directory on demand, and an empty one full of .gitkeep files is a project
   * carrying walkdown's furniture before it has decided to keep the tool.
   */

  /*
   * Skills follow the spec, for the same reason runs and threads do: a spec
   * committed to the repository is a thing the team shares, and the procedures
   * for working on it should arrive with a clone. A spec kept outside is one
   * person's, and so are the skills - they go to that person's own directory,
   * where they also work in every other project, and the repository gets
   * nothing.
   */
  const skillsInto = skills ?? (inRepo ? join(root, '.claude', 'skills') : skillsHome());
  for (const r of installSkills(skillsInto, { force }))
    results.push({
      ...r,
      path: r.path.startsWith(root + '/') ? r.path.slice(root.length + 1) : r.path,
    });
  results.push({
    path: skillsInto,
    action: skillsInto.startsWith(root + '/') ? 'skills-in-repo' : 'skills-personal',
  });

  /*
   * The pointer, into a file this project already keeps its agent conventions
   * in - and only when there is no question which one that is.
   *
   * Most projects walkdown arrives in already have a CLAUDE.md, and some have
   * three files fighting over the same job. Writing into all of them is noise;
   * picking one and being wrong puts the sentence somewhere nobody reads. So:
   * none, and there is nothing to disturb, so write CLAUDE.md. Exactly one,
   * and the project has already answered - use it. Several, and the choice is
   * a person's (or the setup wizard's), so name them and write nothing.
   */
  const block = pointerBlock(inRepo ? `${spec.slice(root.length + 1)}/` : spec);
  const homes = pointerHomes(root);
  if (homes.length > 1) {
    results.push({ path: homes.join(', '), action: 'pointer-undecided' });
  } else {
    const rel = homes[0] ?? 'CLAUDE.md';
    results.push({ path: rel, action: placePointer(join(root, rel), block) });
  }
  results.push({ path: spec, action: inRepo ? 'spec-in-repo' : 'spec-outside' });
  return results;
}
