import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultActor } from '../../lib/identity.js';
import { readRegistry, registryPath, rememberIdentity, skillsHome, walkdownHome, writeRegistry } from '../../lib/locations.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { end } from './context.js';
import { install } from './skills.js';

/*
 * `walkdown init`: this machine, ready for walkdown - and nothing else
 * (ADR 0012 §1).
 *
 * It used to do five jobs, and making a blueprint was one of them; that is
 * `walkdown blueprints new` now. What is left is what a machine needs once:
 * the home and its registry, the person's name, the skills, and an honest
 * word about what walkdown needs and cannot find. It takes no project and
 * writes nothing in one, so it is safe anywhere and as often as you like.
 */

/** What walkdown needs, and how to get it when a machine lacks it. */
const NODE_MAJOR = 20;

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      force: { type: 'boolean', default: false },
      // The project half moved to `blueprints` (ADR 0012); asked for here, it
      // is refused with the command that does it now.
      id: { type: 'string' },
      dir: { type: 'string' },
      commit: { type: 'string' },
    },
  });
  if (values.id !== undefined || values.dir !== undefined || values.commit !== undefined) {
    const { oldForm } = await import('./old-forms.js');
    return oldForm(['init', ...args]);
  }

  // ---- the home and its registry -------------------------------------------
  const home = walkdownHome();
  const made = [];
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
    made.push(['created', home]);
  } else made.push(['up-to-date', home]);
  const registry = readRegistry();
  if (registry.error) {
    console.error(red(`${registryPath()} does not parse — ${registry.error}`));
    console.error(dim('  Fix it first: walkdown reads every blueprint it knows from it.'));
    return end(2);
  }
  if (!registry.exists) {
    mkdirSync(dirname(registryPath()), { recursive: true });
    writeRegistry([]);
    made.push(['created', registryPath()]);
  } else made.push(['up-to-date', registryPath()]);

  const MARK = { created: green('+ created'), 'up-to-date': dim('· up to date') };
  for (const [action, path] of made) console.log(`  ${MARK[action]}  ${path}`);

  // ---- who is sitting here --------------------------------------------------
  /*
   * Every record is written under the config's identity and nothing else can
   * name a person, so an absent block is a wall rather than a default: work
   * cannot be accepted on a machine that only has a git email to go on.
   */
  const who = defaultActor(process.cwd());
  const me = rememberIdentity({ username: who.username, name: who.name });
  if (me.action === 'written') console.log(`  ${green('+ you')}      ${me.path}  ${dim(`as \`${me.username}\``)}`);
  else if (me.action === 'kept') console.log(`  ${dim('· you')}      ${me.path}  ${dim('already says who you are')}`);
  else
    console.log(`  ${yellow('? you')}      this machine offers no name — add \`identity:\` to ${me.path} before accepting work`);

  // ---- the skills, by the one installer -------------------------------------
  // Whether Claude Code is here is asked before the install, which makes the
  // folder it would have found.
  const claude = dirname(skillsHome());
  const claudeHere = existsSync(claude);
  console.log('');
  await install(skillsHome(), { force: values.force });

  // ---- what walkdown needs --------------------------------------------------
  const missing = [];
  const major = Number(process.versions.node.split('.')[0]);
  const lines = [];
  if (major < NODE_MAJOR) {
    missing.push('node');
    lines.push(`  ${red('✗ node')}     ${process.versions.node} — walkdown needs ${NODE_MAJOR} or later: https://nodejs.org`);
  } else lines.push(`  ${dim('· node')}     ${dim(process.versions.node)}`);
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.error || git.status !== 0) {
    missing.push('git');
    lines.push(`  ${red('✗ git')}      not found — walkdown reads a project's history through it: https://git-scm.com/downloads`);
  } else lines.push(`  ${dim('· git')}      ${dim(git.stdout.trim().replace(/^git version /, ''))}`);
  lines.push(
    claudeHere
      ? `  ${dim('· claude')}   ${dim(`${claude} — Claude Code loads the skills from here`)}`
      : `  ${yellow('? claude')}   ${claude} is not there — the skills wait for Claude Code; another agent takes copies with \`walkdown skills --into <dir>\``,
  );
  console.log(`\n${lines.join('\n')}`);

  if (missing.length) {
    console.log(red(`\n  walkdown needs ${missing.join(' and ')} and does not install ${missing.length > 1 ? 'them' : 'it'} itself. Everything else above is set up.`));
    return end(1);
  }
  console.log(`\nReady. In a project, \`walkdown blueprints new\` starts a spec.`);
  return end(0);
}
