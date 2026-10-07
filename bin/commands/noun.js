import { dim } from '../../lib/report/tty.js';
import { end } from './context.js';

/*
 * A NOUN AND ITS VERBS (ADR 0012).
 *
 * `walkdown <noun> <verb>`: the noun alone lists, `walkdown <noun> help`
 * prints the noun's verbs with their usage, and an unknown verb is refused
 * with the verbs there are. Each noun is a table of verbs; this is the one
 * place that reads it, so they all behave alike.
 */

/**
 * @typedef {{ usage: string, about: string, run: (args: string[]) => any }} Verb
 * @param {string} noun
 * @param {Record<string, Verb>} verbs  the first is what the bare noun does
 * @param {string[]} args
 */
export async function dispatch(noun, verbs, args) {
  const [first, ...rest] = args;
  const bare = Object.keys(verbs)[0];
  if (first === 'help' || first === '--help' || first === '-h') {
    console.log(nounHelp(noun, verbs));
    return end(0);
  }
  if (first === undefined || first.startsWith('-')) return verbs[bare].run(args);
  const verb = verbs[first];
  if (!verb) {
    console.error(
      `walkdown ${noun}: no verb "${first}". It takes ${Object.keys(verbs).join(', ')}.`,
    );
    console.error(dim(`\`walkdown ${noun} help\` says what each does.`));
    return end(2);
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(`Usage: ${verb.usage}\n\n${verb.about}`);
    return end(0);
  }
  return verb.run(rest);
}

/** `walkdown <noun> help`: every verb, its usage line, and what it does. */
export function nounHelp(noun, verbs) {
  return [
    `Usage: walkdown ${noun} <${Object.keys(verbs).join('|')}> ...`,
    '',
    ...Object.entries(verbs).flatMap(([, v]) => [
      `  ${v.usage}`,
      ...v.about.split('\n').map((l) => `      ${l}`),
      '',
    ]),
    // Only a noun whose first verb lists runs it bare; `rules` alone is a usage line.
    ...(Object.keys(verbs)[0] === 'list' ? [`The bare noun is \`walkdown ${noun} list\`.`] : []),
  ]
    .join('\n')
    .trimEnd();
}
