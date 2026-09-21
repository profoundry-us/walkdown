/*
 * THE VOICE - what text written into a blueprint should sound like, and the
 * mechanical faults that say it does not.
 *
 * Every field is written for a stranger (ADR 0004): someone who has never
 * seen the blueprint reads the sentence alone and knows what it wants. The
 * faults below are the shapes that keep failing that test - in rules, and
 * in the machine's own words on a thread, which is where most of the text
 * on a board comes from. Each check is one habit, named, with what to do
 * instead; none of them is a judgment of meaning. docs/13-voice.md is the
 * voice in prose; this is the part a door can run.
 *
 * Browser-safe: no node imports, no I/O.
 */

/** Words this repository uses that a stranger does not, and a plain word for each. */
const HOUSE_WORDS = [
  ['ledger law', 'a rule the records must keep'],
  ['provenance', 'where it came from'],
  ['currency', 'whether it is still current'],
  ['canonicalise', 'resolve to one spelling'],
  ['canonicalize', 'resolve to one spelling'],
  ['derivation', 'how it is worked out'],
  ['idempotent', 'safe to repeat'],
  ['orthogonal', 'separate'],
  ['load-bearing', 'relied on'],
  ['read off the tree', 'found by looking at the files'],
];

/* "kind of" and "sort of" are left out: "no kind of record" is a count, not a hedge. */
const HEDGES = /\b(perhaps|arguably|basically|essentially|somewhat|probably|it seems|i think|i believe|more or less)\b/i;
const THROAT = /^(note that|it should be noted|it is worth (noting|saying|mentioning)|in other words|to be clear|needless to say|as you can see)\b/i;
const FIRST_PERSON = /\b(i|i'm|i've|i'd|my|me|we|we're|we've|our|us)\b/i;

/**
 * Code spans, quoted copy and thread ids are names, not prose: a rule id may
 * carry a house word, and a statement that quotes the same line of copy as
 * its step is naming the thing, not restating the step.
 */
const prose = (s) =>
  String(s ?? '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/\b[nq]-\d{4}\b/g, ' ');
const sentencesOf = (s) => prose(s).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const wordsOf = (s) => s.split(/\s+/).filter(Boolean);
const short = (s) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

/**
 * The faults in one piece of text. `field` says what it is: a rule's
 * `statement`, `because`, `history` or `step`, a story's `story`, or the
 * machine's own words on a `thread`. A rule's fields are not first person;
 * a thread's may be. `steps` lets a statement be checked for restating them.
 *
 * @param {string} text
 * @param {{ field?: string, steps?: string[] }} [opts]
 * @returns {{ code: string, message: string }[]}
 */
export function voiceFindings(text, { field = 'thread', steps = [] } = {}) {
  const out = [];
  const say = (code, message) => out.push({ code, message });
  const raw = String(text ?? '');
  if (!raw.trim()) return out;
  const sentences = sentencesOf(raw);
  for (const s of sentences) {
    const n = wordsOf(s).length;
    if (n > 40) say('long-sentence', `a sentence of ${n} words ("${short(s)}") — one idea per sentence; split it`);
    /*
     * A pair of dashes around a short aside is punctuation. Two dashes with
     * a whole clause between them, or three, is a second thought bolted on.
     */
    const parts = s.split(/\s[-—–]\s/);
    const aside = parts.length === 3 && wordsOf(parts[1]).length <= 8;
    if (parts.length >= 3 && !aside)
      say('dash-clause', `two thoughts bolted on with dashes ("${short(s)}") — give the second its own sentence, or cut it`);
    const hedge = s.match(HEDGES);
    if (hedge) say('hedge', `"${hedge[0]}" hedges ("${short(s)}") — say what is true, or say what is not known`);
    const throat = s.match(THROAT);
    if (throat) say('throat-clearing', `"${throat[0]}" clears its throat ("${short(s)}") — start with the thing itself`);
  }
  const p = prose(raw);
  for (const [word, plain] of HOUSE_WORDS)
    if (new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(p))
      say('house-word', `"${word}" is a house word — a stranger reads "${plain}"`);
  if (/!/.test(p)) say('exclamation', 'an exclamation mark — the sentence carries the weight, or it does not');
  if (field !== 'thread' && FIRST_PERSON.test(p))
    say('first-person', `a rule is not written in the first person ("${short(p.match(FIRST_PERSON)?.[0] ?? '')}") — say what is true of the built thing`);
  if (field === 'statement' && steps.length) {
    const runs = new Set();
    for (const st of steps) {
      const w = wordsOf(prose(st).toLowerCase().replace(/[^a-z0-9\s]/g, ' '));
      for (let i = 0; i + 8 <= w.length; i++) runs.add(w.slice(i, i + 8).join(' '));
    }
    const w = wordsOf(p.toLowerCase().replace(/[^a-z0-9\s]/g, ' '));
    for (let i = 0; i + 8 <= w.length; i++)
      if (runs.has(w.slice(i, i + 8).join(' '))) {
        say('restates-steps', `the statement restates a step ("${w.slice(i, i + 8).join(' ')}…") — the steps carry the detail`);
        break;
      }
  }
  return out;
}

/** One line per fault, for a refusal or a lint message. */
export const voiceLines = (findings) => findings.map((f) => `${f.code}: ${f.message}`);
