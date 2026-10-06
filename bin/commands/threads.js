import { end } from './context.js';
import { dispatch } from './noun.js';

/*
 * `walkdown threads`: a thread read, answered and changed one verb at a time
 * (ADR 0012 §4). `walkdown thread <id> --reply <t> --status <s>` was one
 * command that read, replied and moved a thread at once; now `show` reads,
 * `reply` says something and leaves the status alone, and `set` changes the
 * status - with `--reply` when the two must land together or not at all,
 * which is still decided where it lives, in mutateThread.
 */

/* The flags that change a thread's status; `set` takes them and nothing else does. */
const SETS = ['--status', '--verify', '--reopen', '--waive', '--option'];
const sets = (args) => args.filter((a) => SETS.some((s) => a === s || a.startsWith(`${s}=`)));
const thread = async (args) => (await import('./thread.js')).run(args);

export const VERBS = {
  list: {
    usage: 'walkdown threads [list] [--rule <id>] [--all] [--blueprint <id>] [--json]',
    about: 'The open threads, questions and notes, newest first. --all includes the ended ones;\n--rule keeps those anchored to one rule.',
    run: async (args) => (await import('./threads-list.js')).run(args),
  },
  new: {
    usage:
      'walkdown threads new --rule <id> | --screen <id> --body <text> --blueprint <id> [--kind note|question] [--element <sel>]\n' +
      '                     [--reason <why>] [--option "<label> :: <why>"]... [--as-agent [--said <text>] [--added <text>]] [--json]',
    about:
      'Open a thread on a rule, or on a screen alone (a design request). --body says what was\nseen; with --as-agent, --said carries what the person said and --added what the\nmachine put beside it.',
    run: (args) => thread(['new', ...args]),
  },
  show: {
    usage: 'walkdown threads show <id> [--blueprint <id>] [--json]',
    about: 'One thread in full: its anchor, its body and every reply. Changes nothing.',
    run: (args) => {
      const [id, ...rest] = args;
      if (!id || id.startsWith('-')) return usage('show');
      if (sets(rest).length || rest.some((a) => ['--reply', '--said', '--added'].includes(a))) {
        console.error('threads show reads a thread and changes nothing — `walkdown threads reply` or `walkdown threads set` changes one.');
        return end(2);
      }
      return thread([id, ...rest]);
    },
  },
  reply: {
    usage: 'walkdown threads reply <id> <text> [--as-agent [--said <text>] [--added <text>]] [--as-is] [--attach <file>]... --blueprint <id> [--json]',
    about:
      "Say something on a thread and leave its status as it was. With --as-agent and --said,\nthe text is a person's words relayed; it is under their name with the machine marked.",
    run: (args) => {
      const [id, ...rest] = args;
      if (!id || id.startsWith('-')) return usage('reply');
      if (sets(rest).length) {
        console.error(`threads reply leaves the status as it was — \`walkdown threads set ${id} ... --reply <text>\` changes it and says why together.`);
        return end(2);
      }
      // The text is the one word no flag owns, wherever it stands.
      const VALUED = ['--said', '--added', '--attach', '--blueprint', '--reply'];
      let text;
      for (let i = 0; i < rest.length; i++) {
        if (VALUED.includes(rest[i])) i++;
        else if (!rest[i].startsWith('-')) {
          text = rest.splice(i, 1)[0];
          break;
        }
      }
      if (text === undefined && !rest.includes('--said') && !rest.includes('--added')) return usage('reply');
      return thread([id, ...(text !== undefined ? ['--reply', text] : []), ...rest]);
    },
  },
  set: {
    usage:
      'walkdown threads set <id> --status <s> | --verify | --reopen | --waive | --option "<label> :: <why>"...\n' +
      '                     --blueprint <id> [--reason <text>] [--reply <text>] [--as-agent [--said <text>] [--added <text>]] [--json]',
    about:
      'Change a thread: its status, or the choices a question offers. Transitions are checked\n(a note: open → addressed → verified | reopen | waived; a question: open → answered →\nincorporated | reopen | waived). Verified and waived need a named person; waiving and\nreopening need --reason. --reply lands with the change, or neither lands.',
    run: (args) => {
      const [id, ...rest] = args;
      if (!id || id.startsWith('-')) return usage('set');
      if (!sets(rest).length) {
        console.error(`threads set changes a thread's status — say how (${SETS.join(', ')}). \`walkdown threads reply\` only says something.`);
        return end(2);
      }
      return thread([id, ...rest]);
    },
  },
  relabel: {
    usage: 'walkdown threads relabel <label|uuid> --blueprint <id> [--yes] [--json]',
    about:
      'Give the newer of two threads sharing a label (a merge can leave two) the next free\nlabel, keeping the old one as its alias. Asks first; with no terminal, --yes.',
    run: async (args) => (await import('./threads-relabel.js')).run(args),
  },
};

function usage(verb) {
  console.error(`Usage: ${VERBS[verb].usage}`);
  return end(2);
}

export const run = (args) => dispatch('threads', VERBS, args);
