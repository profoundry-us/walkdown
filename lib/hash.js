import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
  const hex = String(stored)
    .replace(/^sha256:/, '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(hex)) return false;
  return statementHash(statement).startsWith(hex);
}

/*
 * Canonical form of a FILE for hashing. Unlike a statement, a file's structure
 * is load-bearing - YAML means different things at different indentations - so
 * this normalises only what is genuinely cosmetic: line endings, trailing
 * whitespace on a line, and how many blank lines the file ends with. Collapsing
 * runs of whitespace the way `canonicalize` does would make a re-indent
 * invisible, and a re-indent can change what a blueprint says.
 */
export function canonicalizeFile(text) {
  return (
    String(text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n+$/, '') + '\n'
  );
}

/**
 * The files that ARE the spec, relative to a blueprint directory: what it
 * declares about itself, its storyboard, and its features. Runs, threads and
 * drafts are what the spec produces rather than part of it, so a verdict
 * recorded against a spec does not change that spec's identity.
 */
export function specFiles(dir) {
  /*
   * A regular file, the way the loader means one.
   *
   * lib/blueprint.js has filtered `.isFile()` since it was written; this
   * counted anything whose name ended in .yml. A directory called
   * `features/thing.yml` - a mistake, but a cheap one to make - was therefore
   * invisible to the loader and a file to us, and `readFileSync` on it threw
   * EISDIR. Everything that stamps provenance calls specHash, so one oddly
   * named directory took down writeRunRecord, writeSweep and the skeleton
   * `walkdown judge` prints, all with a raw stack trace (n-0198). Silently,
   * because the two readers agreeing is the point: the hash covers what the
   * loader loads, and nothing else.
   */
  const isFile = (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const out = [];
  for (const name of ['walkdown.yml', 'storyboard.yml'])
    if (isFile(join(dir, name))) out.push(name);
  const features = join(dir, 'features');
  if (existsSync(features))
    for (const f of readdirSync(features))
      if (/\.ya?ml$/.test(f) && isFile(join(features, f))) out.push(`features/${f}`);
  return out.sort();
}

/**
 * A hash of the spec's own content, in the same `sha256:…` form rules use.
 *
 * This is what a run is judged against, and it replaces `blueprint_sha` - which
 * was the repository's HEAD and therefore moved on every commit, including the
 * many that never touched the blueprint. It could say WHEN a run happened but
 * not WHAT it was judged against, which was the only thing it was for. A
 * content hash also works where there is no repository to point at, which is
 * what lets a spec live outside one (docs/08-locations.md).
 *
 * The relative path is fed in beside each file's content so that moving a rule
 * between feature files changes the hash - the same words in a different file
 * are a different spec.
 */
export function specHash(dir, len = 12) {
  const h = createHash('sha256');
  for (const rel of specFiles(dir)) {
    h.update(rel, 'utf8');
    h.update('\n', 'utf8');
    // specFiles() has just said this is a regular file; between there and
    // here the only things left are permissions and a disappearing act, and
    // both used to surface as a bare errno stack from underneath every
    // recorded run (lib/run-record.js hashes on every write). Name the file
    // instead - the reader's next move is to look at it (n-0215).
    let text;
    try {
      text = readFileSync(join(dir, rel), 'utf8');
    } catch (e) {
      throw new Error(
        `${join(dir, rel)} cannot be read (${e.code ?? e.message}). ` +
          'The spec hash covers every spec file, so a run cannot be stamped without it.',
      );
    }
    h.update(canonicalizeFile(text), 'utf8');
  }
  return 'sha256:' + h.digest('hex').slice(0, len);
}
