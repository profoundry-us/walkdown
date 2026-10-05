import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { gitRoot, resolveLocations, skillsHome } from './locations.js';

// The clone is the plugin (ADR 0010): its skills live at the root, where
// Claude Code reads them through one link to the clone.
const CLONE = resolve(new URL('..', import.meta.url).pathname);
const SKILLS_DIR = join(CLONE, 'skills');
const REPORTER = new URL('./playwright-reporter.js', import.meta.url).pathname;
// The RSpec formatter's load path in this clone - there is no gem to install,
// for the same reason there is no package to name the reporter by.
const RSPEC_LIB = new URL('../adapters/rspec/lib', import.meta.url).pathname;
const AGENTS_TEMPLATE = readFileSync(new URL('./templates/AGENTS.md', import.meta.url), 'utf8');

const CONFIG_TEMPLATE = `blueprint: __PROJECT__

# How to run this project's checks (tests tagged with rule ids).
# Keep the block for your framework; delete the other.
runner:
  # Playwright — add ['__REPORTER__'] to the reporter array in playwright.config.
  # That is this clone's reporter by path, because the clone is the install and
  # nothing puts a \`walkdown\` package in your node_modules. With walkdown
  # installed as a package, ['walkdown/reporter'] names the same file.
  run_all: "npx playwright test"
  run_for_rule: "npx playwright test --grep '@rule:{id}'"
  # RSpec — the formatter is in this clone, loaded by its path; no gem to add:
  # run_all: "bundle exec rspec spec/workflows -I __RSPEC__ -r walkdown/formatter --format progress --format Walkdown::Formatter"
  # run_for_rule: "bundle exec rspec spec/workflows -I __RSPEC__ -r walkdown/formatter --format progress --format Walkdown::Formatter --tag 'rule:{id}'"
  # list: "bundle exec rspec spec/workflows -I __RSPEC__ -r walkdown/formatter --dry-run --format Walkdown::ListFormatter"
  #
  # No \`list:\` is needed: lint reads the rule tags written in the files
  # under authoring.location. Name one only when your framework builds tags
  # at run time and the files cannot show them - it runs on every lint, so
  # a framework's own lister costs a second or more each time.
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
export const pointerBlock = (where) =>
  typeof where === 'string' || where.length === 1
    ? `${POINTER_BEGIN}
## walkdown

This project's spec is the walkdown blueprint in \`${typeof where === 'string' ? where : where[0].where}\`. Before building,
testing, or reviewing, read and follow that folder's \`AGENTS.md\`. Run
\`walkdown where\` to see where everything this project uses actually lives.
${POINTER_END}
`
    : /*
       * Several blueprints in the project (ADR 0013 §4): every one, by id,
       * because an agent arriving here should find each spec, not the first.
       */
      `${POINTER_BEGIN}
## walkdown

This project's specs are walkdown blueprints, one for each part of it:

${where.map((b) => (b.where ? `- \`${b.id}\` in \`${b.where}\`` : `- \`${b.id}\`, kept outside this repository - \`walkdown where --blueprint ${b.id}\` finds it`)).join('\n')}

Before building, testing, or reviewing, read and follow the \`AGENTS.md\` in the
folder of the blueprint you are working on. Commands that write - \`run\` aside -
need \`--blueprint <id>\`; \`walkdown where\` shows where everything lives.
${POINTER_END}
`;

/**
 * What the pointer names, for a project standing at `root`: each blueprint
 * registered for it, with its spec named from `base` - relative inside the
 * checkout, where the path means the same on every machine, and absolute
 * only for a spec outside it (n-0209).
 *
 * @param {string} root
 * @param {string} base the directory the block is read from
 * @returns {{ id: string, where: string | null }[]}
 */
export function pointerTargets(root, base = root) {
  const loc = resolveLocations({ cwd: root });
  const specs = loc.ambiguous
    ? loc.config.registry.candidates.map((id) => ({ id, spec: resolveLocations({ cwd: root, blueprint: id }).spec?.path }))
    : [{ id: loc.id, spec: loc.spec?.path }];
  const codeRoot = loc.code?.path ?? gitRoot(root);
  const inside = (p) => codeRoot && (p === codeRoot || p.startsWith(`${codeRoot}/`));
  const several = specs.length > 1;
  /*
   * Among several, a spec outside the checkout is named by id and not by
   * path: the block is committed, and a path into one person's home is
   * wrong on every other machine (n-0161). Alone, it is named as it always
   * was - that is the block somebody asked for by hand.
   */
  return specs
    .filter((b) => b.spec)
    .map((b) => ({
      id: b.id,
      where: inside(b.spec) && inside(base) ? `${relative(base, b.spec)}/` : several ? null : b.spec,
    }));
}

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

/*
 * Where our block ends, and what of the person's line survives it.
 *
 * Both writers used `to + POINTER_END.length + 1`, which assumes exactly one
 * newline follows the end marker and swallows whatever is really there: a
 * trailing space left a space-only line outside the block, a CRLF file lost
 * its \r and gained a blank line nobody wrote, and a comment written after the
 * marker lost its leading `<` and became broken markup (n-0187). Fixing it in
 * `placePointer` alone left `removePointer` corrupting the same three files,
 * reachable by `init --commit none` on a committed project (n-0194) - so it is
 * one function now, and both callers ask it.
 *
 * The block owns its markers and the line they sit on. Anything a person typed
 * after the end marker on that line is theirs, so it comes back as its own
 * line rather than being deleted along with our whitespace.
 */
export function afterPointer(text, to) {
  const eol = text.indexOf('\n', to + POINTER_END.length);
  const end = eol < 0 ? text.length : eol;
  const theirs = text.slice(to + POINTER_END.length, end).trim();
  return { after: eol < 0 ? text.length : eol + 1, kept: theirs ? `${theirs}\n` : '' };
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
  const { after, kept } = afterPointer(text, to);
  const current = text.slice(from, after);
  if (current === block) return 'up-to-date';
  writeFileSync(file, text.slice(0, from) + block + kept + text.slice(after));
  return 'pointer-updated';
}

/*
 * Which skills an adopting project gets.
 *
 * Not all of them. `walkdown-sitting` drives `tools/sitting.mjs`, a harness
 * that exists in walkdown's own repository and nowhere else, and a skill whose
 * first command is missing is worse than no skill - an agent follows it,
 * fails, and improvises the procedure the skill existed to stop it improvising.
 * It lives in this repository's own .claude/skills, which the plugin never
 * reads, and ships nowhere until the harness it needs does.
 */
const SHIPPED = ['setup', 'formulate', 'judge', 'incorporate', 'backlog'];

/*
 * A copy is for a place nothing namespaces - another agent's folder, or a
 * repository that asked - so it keeps the name it always had, walkdown-<name>,
 * where the plugin's own skill is just <name> under walkdown:.
 */
const copyName = (short) => `walkdown-${short}`;
const asCopy = (short, content) => content.replace(/^name: .*$/m, `name: ${copyName(short)}`);

/** The packaged skills, as copies: [{ name, content }]. */
export function skillFiles() {
  return SHIPPED.filter((short) => existsSync(join(SKILLS_DIR, short, 'SKILL.md')))
    .sort()
    .map((short) => ({
      name: copyName(short),
      content: asCopy(short, readFileSync(join(SKILLS_DIR, short, 'SKILL.md'), 'utf8')),
    }));
}

/*
 * Every copy walkdown has ever released, by hash, so an old copy can be told
 * from one its person edited (delivery.plugin.old-copies-make-way). Written by
 * tools/released-skills.mjs at release time, from the tags; a copy matching
 * ANY released version is walkdown's, not only one matching today's.
 */
const RELEASED_FILE = new URL('./released-skills.json', import.meta.url);
const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
export function releasedSkills() {
  const byVersion = existsSync(RELEASED_FILE) ? JSON.parse(readFileSync(RELEASED_FILE, 'utf8')) : {};
  const known = new Map();
  for (const skills of Object.values(byVersion))
    for (const [name, hash] of Object.entries(skills)) known.set(name, new Set([...(known.get(name) ?? []), hash]));
  return known;
}

// lstat that answers null for "nothing there", where existsSync would follow
// a link and answer for whatever it points at.
const lstatOr = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};
const realOr = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/*
 * Is this the agent's own folder - Claude Code's, where the plugin goes - or
 * somewhere a copy belongs? The personal skills directory is Claude Code's
 * (skillsHome honours CLAUDE_CONFIG_DIR); anything else named is copies.
 */
export const isClaudeSkills = (into) => resolve(into) === resolve(skillsHome());

/**
 * Install the skills. For Claude Code's own folder that is one link, named
 * walkdown, to this clone (ADR 0010); anywhere else it is copies.
 *
 * Neither ever writes through a link (delivery.plugin.never-through-a-link):
 * n-0197 was this function following a link it never noticed into walkdown's
 * own source. A link walkdown did not make is reported and left, `--force` or
 * not.
 */
export function installSkills(
  into,
  { force = false, dry = false, link = isClaudeSkills(into), released = releasedSkills(), clone = CLONE } = {},
) {
  return link ? installLink(into, { force, dry, released, clone }) : installCopies(into, { force, dry });
}

function installLink(into, { force, dry, released, clone }) {
  const rows = [];
  const at = join(into, 'walkdown');
  const there = lstatOr(at);
  if (!there) {
    if (!dry) {
      mkdirSync(into, { recursive: true });
      symlinkSync(clone, at, 'dir');
    }
    rows.push({ path: at, action: 'linked', target: clone });
  } else if (there.isSymbolicLink() && realOr(at) === realOr(clone)) {
    rows.push({ path: at, action: 'up-to-date', target: clone });
  } else {
    rows.push({ path: at, action: there.isSymbolicLink() ? 'someone-elses-link' : 'someone-elses' });
  }

  /*
   * The copies an earlier walkdown left here. Beside the plugin they list
   * every skill twice (delivery.plugin.old-copies-make-way), so they go - but
   * only on --force, only a folder holding nothing but the SKILL.md walkdown
   * wrote, and only when that file is one walkdown released. An edited copy is
   * somebody's work and is kept.
   */
  for (const short of SHIPPED) {
    const dir = join(into, copyName(short));
    const d = lstatOr(dir);
    if (!d) continue;
    const file = join(dir, 'SKILL.md');
    const f = d.isDirectory() ? lstatOr(file) : null;
    if (d.isSymbolicLink() || f?.isSymbolicLink()) {
      rows.push({ path: dir, action: 'someone-elses-link' });
      continue;
    }
    const alone = d.isDirectory() && f?.isFile() && readdirSync(dir).length === 1;
    const unedited = alone && Boolean(released.get(copyName(short))?.has(sha(readFileSync(file, 'utf8'))));
    if (!force) rows.push({ path: dir, action: unedited ? 'duplicate' : 'duplicate-edited' });
    else if (!unedited) rows.push({ path: dir, action: 'kept-edited' });
    else {
      if (!dry) rmSync(dir, { recursive: true });
      rows.push({ path: dir, action: 'removed' });
    }
  }
  return rows;
}

function installCopies(into, { force, dry }) {
  return skillFiles().map(({ name, content }) => {
    const dir = join(into, name);
    const abs = join(dir, 'SKILL.md');
    // Never through a link: whatever a link points at is not this folder's.
    if (lstatOr(dir)?.isSymbolicLink() || lstatOr(abs)?.isSymbolicLink())
      return { path: abs, action: 'someone-elses-link' };
    /*
     * `dry` answers what WOULD happen and writes nothing at all, not even the
     * directory - asking where skills could go must leave the disk as it found
     * it, the same way asking where anything lives does (n-0184). Every write
     * below is guarded, not just the mkdir: the first version guarded only the
     * directory, so surveying a destination that already existed installed into
     * it, and the one that did not exist crashed. A survey that installs is
     * worse than no survey.
     */
    if (!existsSync(abs)) {
      if (dry) return { path: abs, action: 'created' };
      mkdirSync(dir, { recursive: true });
      writeFileSync(abs, content);
      return { path: abs, action: 'created' };
    }
    if (readFileSync(abs, 'utf8') === content) return { path: abs, action: 'up-to-date' };
    if (force) {
      if (dry) return { path: abs, action: 'updated' };
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
 *
 * @param {string} root
 * @param {{ force?: boolean, specDir: string, skills?: string | null, commit?: string, name?: string | null }} opts
 */
export function scaffold(root, { force = false, specDir, skills = null, commit = 'none', name = null }) {
  root = resolve(root);
  /*
   * Where the spec goes is the caller's decision - a numbered home under
   * whichever `.walkdown` the commit standard needs (bin/commands/init.js).
   * `commit` says whether git is watching, and that is what the skills and
   * the pointer key off; the spec's PATH answers a different question and is
   * read where a path is what is wanted.
   *
   * Required, with no default. It used to fall back to `<root>/blueprint` -
   * a bare spec with no home around it, the layout from before homes - and
   * though `init` always named a home, the default sat here inviting the one
   * shape walkdown no longer answers for.
   */
  if (!specDir) throw new Error('scaffold needs the specDir its home puts the blueprint at');
  const spec = resolve(specDir);
  const inRepo = commit !== 'none';
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
  ensure('walkdown.yml', CONFIG_TEMPLATE.replace('__PROJECT__', name ?? basename(root)).replace('__REPORTER__', REPORTER).replaceAll('__RSPEC__', RSPEC_LIB), { at });
  ensure('storyboard.yml', STORYBOARD_TEMPLATE, { at });
  ensure('features/_template.yml', FEATURE_TEMPLATE, { at });
  ensure('AGENTS.md', AGENTS_TEMPLATE, { owned: true, at });
  /*
   * No runs/, threads/ or drafts/ are scaffolded. Every writer creates its own
   * directory on demand, and an empty one full of .gitkeep files is a project
   * carrying walkdown's furniture before it has decided to keep the tool.
   */

  /*
   * Skills go to the person's own directory. Always, whatever the spec did.
   *
   * They used to follow the spec - a committed spec is shared, so the
   * procedures for working on it should arrive with a clone. The argument is
   * sound and the coupling was not: a committed skill is a VENDORED COPY OF
   * ANOTHER TOOL'S SOURCE, and walkdown cannot keep it right after writing
   * it. It goes stale on the next upgrade with nothing to say so; this
   * repository needs a Highball check to notice the same drift in its own
   * copies. Every note this rule ever collected was a bill for that coupling:
   * skills left staged in a repository just told it gets nothing (n-0166),
   * two same-named sets one of which is stale (n-0184), and copies that are
   * symlinks the committed path does not model (n-0197).
   *
   * A team that wants them committed still gets them - `walkdown skills
   * --blueprint`, which asks and is a thing somebody chose. What is gone is
   * init deciding it on their behalf out of an unrelated answer.
   */
  const skillsInto = skills ?? skillsHome();
  // init installs only into Claude Code's own folder, so it is the plugin's link.
  for (const r of installSkills(skillsInto, { force, link: true }))
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
  /*
   * No pointer at all when nothing is committed. "Without altering the
   * repository" means without altering it, and the pointer was the one file
   * default `init` put in front of git - carrying, since the spec then sits
   * in a home directory, an absolute path that is wrong on every other
   * machine (n-0161). A person who wants one asks for it: `walkdown pointer
   * --into CLAUDE.md`.
   *
   * Relative whenever the spec is inside the root, which is a question about
   * PATHS - not about whether git tracks it, which is what `inRepo` answers
   * and what this used to key on (n-0161 again, one line down).
   */
  if (inRepo) {
    const block = pointerBlock(spec.startsWith(root + '/') ? `${spec.slice(root.length + 1)}/` : spec);
    const homes = pointerHomes(root);
    if (homes.length > 1) {
      results.push({ path: homes.join(', '), action: 'pointer-undecided' });
    } else {
      const rel = homes[0] ?? 'CLAUDE.md';
      results.push({ path: rel, action: placePointer(join(root, rel), block) });
    }
  }
  results.push({ path: spec, action: inRepo ? 'spec-in-repo' : 'spec-outside' });
  return results;
}
