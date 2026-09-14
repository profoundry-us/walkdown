/**
 * When things happened, written once and read anywhere.
 *
 * Every stamp walkdown writes is an instant in UTC - ISO 8601 with a Z - so
 * a record means the same moment on every machine that ever reads it. The
 * zone belongs to the READER: a person says theirs once in the personal
 * config, and every clock the CLI and the panel show is turned into it
 * there. Nothing about a zone is ever written into a record (n-0290).
 *
 * The one stamp that was not an instant, `reworded[].at`, was the UTC date
 * sliced bare: written at 01:12Z on the 14th under a `why` that said the
 * 13th, with no zone to say which day it meant.
 */

/**
 * Now, as walkdown writes it: whole seconds, Z. A thread opened from the
 * panel keeps its milliseconds - the session gate compares that stamp to a
 * millisecond start, and seconds alone made the whole start second
 * ambiguous (n-0132).
 */
export const isoNow = ({ ms = false } = {}) =>
  ms ? new Date().toISOString() : new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** The zone this machine is set to, which is the reader's until they say otherwise. */
export const machineZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** An IANA zone name this runtime knows, or null. */
export function knownZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return null;
  try {
    return Intl.DateTimeFormat(undefined, { timeZone: zone.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Which zone to read times in, from what the person declared. A name the
 * runtime does not know falls back to the machine's and says so, rather
 * than throwing out of a config read - a typo in the one file that must be
 * right must never take the panel down (n-0148).
 */
export function readerZone(declared) {
  const said = declared === undefined || declared === null ? '' : String(declared).trim();
  if (!said) return { zone: machineZone(), source: 'machine', problem: null };
  const known = knownZone(said);
  if (known) return { zone: known, source: 'config', problem: null };
  return {
    zone: machineZone(),
    source: 'machine',
    problem: `\`identity.timezone\` is "${said}", which is not a zone this machine knows - write an IANA name such as America/Chicago`,
  };
}

/**
 * An instant as a person in `zone` would say it: "Sep 13, 2026, 8:12 PM CDT".
 * The zone's own abbreviation rides along, so a stamp copied into a message
 * still says which clock it was read from. A string that is not a time comes
 * back as it was, since "undated" is an answer and "Invalid Date" is not.
 */
export function whenIn(iso, zone) {
  const at = new Date(iso ?? '');
  if (!Number.isFinite(at.getTime())) return iso == null ? '' : String(iso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: knownZone(zone) ?? undefined,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(at);
}

/** The calendar date of an instant in `zone`, as YYYY-MM-DD - for "is this today". */
export function dateIn(iso, zone) {
  const at = new Date(iso ?? '');
  if (!Number.isFinite(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: knownZone(zone) ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
