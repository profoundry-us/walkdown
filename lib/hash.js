import { createHash } from 'node:crypto';

/**
 * Canonical form of a rule statement for hashing: whitespace runs collapse to a
 * single space, ends trimmed. This makes hand-written plain scalars, folded
 * YAML scalars, and re-wrapped text hash identically as long as the words match.
 */
export function canonicalize(statement) {
  return String(statement).replace(/\s+/g, ' ').trim();
}

/** Full sha256 hex of the canonicalized statement. */
export function statementHash(statement) {
  return createHash('sha256').update(canonicalize(statement), 'utf8').digest('hex');
}

/** Stored form: "sha256:" + first `len` hex chars (default 12). */
export function formatHash(statement, len = 12) {
  return 'sha256:' + statementHash(statement).slice(0, len);
}

/**
 * Does a stored hash (possibly truncated, with or without the "sha256:" prefix)
 * match the statement? Truncations of at least 8 hex chars are accepted.
 */
export function hashMatches(stored, statement) {
  if (!stored) return false;
  const hex = String(stored).replace(/^sha256:/, '').trim().toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(hex)) return false;
  return statementHash(statement).startsWith(hex);
}
