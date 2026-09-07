/*
 * What a sitting is made of. One list, every hop.
 *
 * A walkdown in progress crosses four hands before it reaches disk: the
 * panel's `S.session`, `POST /api/draft`, `writes.saveDraft`, `writeDraft`.
 * Each of them used to name the fields it carried, by hand, in its own
 * object literal — and a field named in three of the four vanished at the
 * fourth with nothing raised anywhere. That is not a hypothetical: roles went
 * that way on 2026-08-24 and again on 2026-09-06, signatures at the run door
 * on 2026-09-07, and signatures again at the draft door hours later (n-0230),
 * where BOTH the handler and the writer had to be taught the same field
 * separately. Four instances of one bug, none of which failed loudly.
 *
 * The cure is not a louder refusal at each door — it is for there to be one
 * list. `sitting()` is the only thing that decides which keys a session
 * carries; every hop passes its result through whole. Adding a field is one
 * line here, and it then survives the whole path by construction rather than
 * by four people remembering.
 *
 * Browser-safe, like vocab.js: no node imports, no I/O. The panel bundles it.
 *
 * What is NOT here: `target` (routing, not content), `actor` (stamped by
 * lib/writes.js from the machine, never sent), and the bookkeeping a writer
 * adds — `draft`, `updated`. A caller cannot name any of those, so they are
 * not part of the shape a caller hands along.
 */

/** The fields a session carries, in the order a draft on disk shows them. */
export const SITTING_FIELDS = Object.freeze(['started', 'signatures', 'verdicts', 'threads']);

/*
 * Empty is absent. A sitting that named no signers is a sitting from before
 * signers existed, and writing `signatures: []` onto it would make an older
 * draft claim it chose to have none. Same for threads: `{}` is noise in a
 * file a person reads.
 */
const CARRIED = {
  started: (v) => typeof v === 'string' && v.trim() !== '',
  signatures: (v) => Array.isArray(v) && v.length > 0,
  verdicts: (v) => !!v && typeof v === 'object' && Object.keys(v).length > 0,
  threads: (v) => !!v && typeof v === 'object' && Object.keys(v).length > 0,
};

/**
 * The session fields of `source`, and nothing else. Keys that carry nothing
 * are left out entirely, so `{ ...defaults, ...sitting(source) }` is how a
 * hop applies its own defaults without a present-but-empty value silently
 * overwriting one.
 *
 * @param {any} source anything session-shaped: a panel state, a request body,
 *   a draft read back off disk.
 */
export function sitting(source) {
  const out = /** @type {Record<string, any>} */ ({});
  for (const field of SITTING_FIELDS) {
    const value = source?.[field];
    if (CARRIED[field](value)) out[field] = value;
  }
  return out;
}
