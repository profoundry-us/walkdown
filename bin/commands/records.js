import { dispatch } from './noun.js';

/*
 * `walkdown records`: one kind of record - runs, threads, evidence, drafts -
 * moved, and the blueprint left where it is (ADR 0012 §3). It was `walkdown
 * move`, which read as moving the blueprint once blueprints had a noun.
 */
export const VERBS = {
  list: {
    usage: 'walkdown records [list] [--blueprint <id>] [--json]',
    about:
      "Where each kind of record is kept, and why - the answer `walkdown where` gives.\nReads and writes nothing.",
    run: async (args) => (await import('./where.js')).run(args),
  },
  move: {
    usage: 'walkdown records move <kind> --to <path> --blueprint <id>',
    about:
      "Move one kind of record (runs, threads, evidence, drafts) somewhere else and record\nthe choice in ~/.walkdown. Moves files and never edits one. Refuses a destination that\nalready holds records rather than interleaving two ledgers.",
    run: async (args) => (await import('./move.js')).run(args),
  },
};

export const run = (args) => dispatch('records', VERBS, args);
