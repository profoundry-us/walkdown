import { end } from './context.js';
import { parseArgs } from 'node:util';
import { dispatch } from './noun.js';

/*
 * `walkdown blueprints`: everything done to a whole blueprint (ADR 0012 §2).
 * Making one was `walkdown init`, registering one `walkdown import`, and
 * forgetting one `walkdown blueprint forget`; they live under one noun now,
 * beside `rename` and `commit`, which had nowhere to go.
 */
export const VERBS = {
  list: {
    usage: 'walkdown blueprints [list] [--stale]',
    about: 'Every blueprint this machine knows, with throwaway copies grouped under Ephemeral\nand marked when they are old enough to clear.',
    run: async (args) => (await import('./blueprint.js')).list(args),
  },
  new: {
    usage: 'walkdown blueprints new [<name>] [--folder <folder>] [--dir <project-root>] [--commit none|spec|all] [--project <label>] [--code <pc>] [--force]',
    about:
      "Make a blueprint for the project where you stand: a home folder holding the spec, its\nthreads, runs, evidence and drafts, and an ID on this machine. The name defaults to the\nproject directory's; the folder to this month and the name (202610-search), or --folder.\nBy default the home is in ~/.walkdown and the repository gets nothing; --commit spec puts\nit in .walkdown/blueprints/ with its own .gitignore keeping runs, evidence and drafts out,\nand --commit all the same with none. Run again, it changes nothing.",
    run: async (args) => {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          dir: { type: 'string' },
          commit: { type: 'string' },
          folder: { type: 'string' },
          project: { type: 'string' },
          code: { type: 'string' },
          force: { type: 'boolean', default: false },
        },
      });
      if (positionals.length > 1) return usage('new');
      const { make } = await import('./blueprints-new.js');
      return make({
        verb: 'new',
        id: positionals[0] ?? null,
        dir: values.dir,
        commit: values.commit,
        force: values.force,
        folder: values.folder ?? null,
        project: values.project ?? null,
        code: values.code ?? null,
      });
    },
  },
  import: {
    usage: 'walkdown blueprints import <path> [--all|--only <folders>] [--ephemeral] [--why <reason>] [--json]',
    about:
      "The one way a blueprint joins this machine's registry (ADR 0003). Name one blueprint's\nfolder and that one is registered. Name a repository and it lists every blueprint folder\nunder .walkdown/blueprints/ and asks which to take. --ephemeral marks a throwaway copy.",
    run: async (args) => (await import('./import.js')).run(args),
  },
  rename: {
    usage: 'walkdown blueprints rename <id> <new-name> [--folder <folder>]',
    about:
      "Change the name at the end of a blueprint's ID (cli in 0002-wd-cli); its number and\nproject code stay. --folder renames its folder too. Its rules, threads and runs are\nleft as they were.",
    run: async (args) => (await import('./blueprints-rename.js')).run(args),
  },
  commit: {
    usage: 'walkdown blueprints commit <none|spec|all> [--blueprint <id>] [--force]',
    about:
      "Move a blueprint's whole home into the repository, or back out: none keeps it in\n~/.walkdown, spec commits the spec and its threads, all commits everything. With\nseveral blueprints in the project, --blueprint says which.",
    run: async (args) => {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { blueprint: { type: 'string' }, dir: { type: 'string' }, force: { type: 'boolean', default: false } },
      });
      if (positionals.length !== 1) return usage('commit');
      const { make } = await import('./blueprints-new.js');
      return make({ verb: 'commit', id: values.blueprint ?? null, dir: values.dir, commit: positionals[0], force: values.force });
    },
  },
  forget: {
    usage: 'walkdown blueprints forget <id>',
    about: "Take a blueprint off this machine's list. None of its files are touched.",
    run: async (args) => (await import('./blueprint.js')).forget(args),
  },
};

function usage(verb) {
  console.error(`Usage: ${VERBS[verb].usage}`);
  return end(2);
}

export const run = (args) => dispatch('blueprints', VERBS, args);
