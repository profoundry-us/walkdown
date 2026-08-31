/*
 * How derived status is said in text: the glyphs, the colours per state, and
 * the cell renderers the status table and the rule detail share. Pure - every
 * function here returns a string or a parts list and prints nothing - which
 * is what makes this the testable half of the report, and what would let the
 * panel and the CLI one day read the same vocabulary of marks.
 */
import { dim, green, red, yellow } from './tty.js';

/** "n-0001 addressed, q-0002 open" up to two threads; beyond that "n-0001 addressed +2".
 *  `walkdown threads --rule <id>` shows the full list. */
function formatThreads(threads) {
  if (!threads.length) return '—';
  const shown = threads
    .slice(0, 2)
    .map((t) => `${t.id} ${t.status}`)
    .join(', ');
  return threads.length > 2 ? `${shown} +${threads.length - 2}` : shown;
}

const paint = {
  pass: green,
  fail: red,
  stale: yellow,
  blocked: yellow,
  never: dim,
  skipped: dim,
  na: dim,
  approved: yellow,
  refining: yellow,
};
const cellText = (cell, withActor = false) => {
  if (cell.state === 'na') return '·';
  if (cell.state === 'never') return 'never';
  const glyph =
    { pass: '✓', fail: '✗', stale: '~', skipped: '–', blocked: '⊘', approved: '✍︎', refining: '✎︎' }[
      cell.state
    ] ?? '?';
  const label = withActor && cell.actor ? cell.actor : cell.state;
  return `${glyph} ${label}`;
};

/*
 * A tier a rule has excused reads as EXCUSED, not as a dot.
 *
 * Both are `na` to the deriver, and they mean opposite things to a reader: a
 * dot is "this does not apply here", an excuse is "we decided this cannot
 * honestly be verified, and there is a sentence saying why". Collapsing them
 * hid the decision the whole `unverifiable` block exists to make visible - the
 * report would have looked exactly the same if somebody had simply forgotten.
 */
const tierText = (row, tier, cell) =>
  cell.state === 'na' && row.excuses?.[tier] ? 'excused' : cellText(cell);

/*
 * How each role has answered, in one cell.
 *
 * Named rather than counted, because "1/2 signed" is the one thing nobody can
 * act on: the question is always WHICH signature is missing, and whose day it
 * is going to take. The panel draws this as a row of dots; the terminal has no
 * dots to spare, so it spells the roles out.
 */
const ACCEPT_MARK = {
  signed: ['✓', green],
  approved: ['✍︎', yellow],
  'sent-back': ['✗', red],
  stale: ['~', yellow],
  none: ['○', dim],
};
const acceptanceCell = (acceptance) => {
  if (!acceptance?.length) return { text: '·', state: 'na' };
  const parts = [];
  for (const a of acceptance) {
    const [glyph, colour] = ACCEPT_MARK[a.state] ?? ['?', yellow];
    if (parts.length) parts.push([' ', (s) => s]);
    parts.push([`${glyph} ${a.role}`, colour]);
  }
  return { text: parts.map(([s]) => s).join(''), parts };
};

export { ACCEPT_MARK, acceptanceCell, cellText, formatThreads, paint, tierText };
