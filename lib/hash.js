import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Refused } from './refusal.js';

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

/*
 * What a verdict is pinned to. A rule is its statement AND its steps - the
 * steps are what a judge actually drives - so the hash covers both, and a
 * step changing renders the verdicts stale the same as the statement moving.
 * Handed a bare string it hashes the statement alone, which is the shape
 * every record carried before the steps were included (2026-09-13); those
 * hashes keep matching (see hashMatches) until `walkdown hash --write`
 * re-stamps the rule.
 */
export function ruleHash(rule) {
  if (typeof rule === 'string') return statementHash(rule);
  const steps = rule.steps ?? {};
  const h = createHash('sha256').update(canonicalize(rule.statement), 'utf8');
  for (const phase of ['given', 'when', 'then'])
    for (const step of steps[phase] ?? []) h.update('\n').update(canonicalize(step), 'utf8');
  return h.digest('hex');
}

/** Stored form: "sha256:" + first `len` hex chars (default 12). */
export function formatHash(rule, len = 12) {
  return 'sha256:' + ruleHash(rule).slice(0, len);
}

function hexOf(stored) {
  if (!stored) return null;
  const hex = String(stored)
    .replace(/^sha256:/, '')
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{8,64}$/.test(hex) ? hex : null;
}

/**
 * Does a stored hash (possibly truncated, with or without the "sha256:" prefix)
 * still name this rule? Truncations of at least 8 hex chars are accepted.
 *
 * Three things count. The rule as it reads now, statement and steps. The
 * statement alone, for hashes written before the steps were part of it. And
 * any hash the rule's `steps.reworded` list carries: a person said the words
 * changed but not the meaning (`walkdown hash --write --reword`), and a
 * verdict against those words still holds. Re-earning a rule because a
 * sentence got better English is how rewording stops happening.
 */
export function hashMatches(stored, rule) {
  const hex = hexOf(stored);
  if (!hex) return false;
  if (ruleHash(rule).startsWith(hex)) return true;
  if (typeof rule === 'string') return false;
  if (statementHash(rule.statement).startsWith(hex)) return true;
  return (rule.steps?.reworded ?? []).some((r) => {
    const old = hexOf(typeof r === 'string' ? r : r?.hash);
    return old && (old.startsWith(hex) || hex.startsWith(old));
  });
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
      throw new Refused(
        `${rel} cannot be read (${e.code ?? e.message}) — it is one of ${dir}'s spec files.\n` +
          'The spec hash covers every spec file, so a run cannot be stamped against a spec ' +
          'this machine cannot read all of. Fix that file first.',
      );
    }
    h.update(canonicalizeFile(text), 'utf8');
  }
  return 'sha256:' + h.digest('hex').slice(0, len);
}
