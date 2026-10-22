import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { parse } from 'yaml';
import { hashMatches } from './hash.js';

/**
 * What changed in a rule since a person signed it, and why
 * (panel.walkdown.what-changed-since-you-signed).
 *
 * A signature carries the hash of the words it was given against, and never
 * the words. They are found again in git: the feature file's history, newest
 * first, followed through renames, until a version of the rule hashes to
 * what was signed. A blueprint outside git, or a wording git never held,
 * answers `found: false` - never an empty list of changes, which would say
 * nothing had changed.
 *
 * The reasons are the ones recorded on the rule itself, `steps.changed` and
 * `steps.reworded`, dated after the signature: the words in history are for
 * reading, and carry no date a comparison could trust.
 */

const PHASES = ['given', 'when', 'then'];

// One answer per file and signed hash: a file's history does not change
// under a running server except by a commit, and a commit changes the head.
const cache = new Map();

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout : null;
}

function findRule(doc, id) {
  for (const story of doc?.stories ?? [])
    for (const rule of story?.rules ?? []) if (rule?.id === id) return rule;
  return null;
}

/** The rule as it read when `signedHash` was given, or null when git cannot say. */
export function signedWording(file, ruleId, signedHash) {
  // Git answers with real paths; a file reached through a link (macOS's
  // /var is /private/var) would otherwise sit outside the repository it is in.
  try {
    file = realpathSync(file);
  } catch {
    return null;
  }
  const cwd = dirname(file);
  const top = git(cwd, ['rev-parse', '--show-toplevel'])?.trim();
  const head = git(cwd, ['rev-parse', 'HEAD'])?.trim();
  if (!top || !head) return null;
  const key = `${file}\0${ruleId}\0${signedHash}\0${head}`;
  if (cache.has(key)) return cache.get(key);
  let found = null;
  const log =
    git(top, ['log', '--follow', '--format=%H', '--name-only', '--', relative(top, file)]) ?? '';
  // Pairs of "<sha>\n\n<path>" - the path each commit held the file under.
  const lines = log.split('\n').filter(Boolean);
  for (let i = 0; i + 1 < lines.length && !found; i += 2) {
    const text = git(top, ['show', `${lines[i]}:${lines[i + 1]}`]);
    if (text == null) continue;
    let rule;
    try {
      rule = findRule(parse(text), ruleId);
    } catch {
      continue;
    }
    if (rule?.statement && hashMatches(signedHash, rule)) found = rule;
  }
  cache.set(key, found);
  return found;
}

const words = (s) =>
  String(s)
    .split(/(\s+|[,;]|\.(?=\s|$))/)
    .filter(Boolean);
const bag = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .match(/[\w`'-]+/g) ?? [],
  );

function likeness(a, b) {
  const x = bag(a);
  const y = bag(b);
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.max(1, Math.min(x.size, y.size));
}

/**
 * A reworded step as runs of words that stayed, went and came, by the
 * longest common run of words. Whitespace rides with the word before it, so
 * the runs join back into each wording exactly.
 */
export function wordDiff(was, now) {
  const a = words(was);
  const b = words(now);
  const n = a.length;
  const m = b.length;
  const keep = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      keep[i][j] =
        a[i] === b[j] ? keep[i + 1][j + 1] + 1 : Math.max(keep[i + 1][j], keep[i][j + 1]);
  const runs = [];
  const push = (kind, text) => {
    const last = runs.at(-1);
    if (last?.kind === kind) last.text += text;
    else runs.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (keep[i + 1][j] >= keep[i][j + 1]) push('went', a[i++]);
    else push('came', b[j++]);
  }
  while (i < n) push('went', a[i++]);
  while (j < m) push('came', b[j++]);
  return runs;
}

/**
 * Each step added, removed or reworded between two wordings of a rule, the
 * statement first when it moved. A step that went and one that came in the
 * same phase are one reworded step when they share most of their words;
 * otherwise each stands as it is.
 */
export function stepChanges(was, now) {
  const changes = [];
  if (String(was.statement ?? '') !== String(now.statement ?? ''))
    changes.push({
      kind: 'reworded',
      phase: 'statement',
      runs: wordDiff(was.statement ?? '', now.statement ?? ''),
    });
  for (const phase of PHASES) {
    const before = (was.steps?.[phase] ?? []).map(String);
    const after = (now.steps?.[phase] ?? []).map(String);
    const went = before.filter((s) => !after.includes(s));
    const came = after.filter((s) => !before.includes(s));
    const paired = new Set();
    for (const step of came) {
      let best = -1;
      let score = 0.5;
      went.forEach((old, k) => {
        if (paired.has(k)) return;
        const l = likeness(old, step);
        if (l >= score) {
          score = l;
          best = k;
        }
      });
      if (best >= 0) {
        paired.add(best);
        changes.push({
          kind: 'reworded',
          phase,
          runs: wordDiff(went[best], step),
          at: after.indexOf(step),
        });
      } else changes.push({ kind: 'added', phase, text: step, at: after.indexOf(step) });
    }
    went.forEach((old, k) => {
      if (!paired.has(k))
        changes.push({ kind: 'removed', phase, text: old, at: before.indexOf(old) - 0.5 });
    });
  }
  const order = (c) => (c.phase === 'statement' ? -1 : PHASES.indexOf(c.phase) * 1000 + c.at);
  return changes.sort((x, y) => order(x) - order(y)).map(({ at: _at, ...c }) => c);
}

/** The reasons recorded on the rule since `since`, oldest first. */
export function reasonsSince(rule, since) {
  const t = Date.parse(since);
  return [...(rule.steps?.changed ?? []), ...(rule.steps?.reworded ?? [])]
    .filter((r) => r && typeof r === 'object' && r.why && r.at)
    .filter((r) => !(Date.parse(r.at) < t))
    .map((r) => ({ at: String(r.at), why: String(r.why) }))
    .sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}

/** The whole answer for one rule and one signature. */
export function sinceSigned({ file, rule }, signature) {
  const was = signedWording(file, rule.id, signature.hash);
  return {
    signed: signature.at,
    found: Boolean(was),
    changes: was ? stepChanges(was, rule) : [],
    reasons: reasonsSince(rule, signature.at),
  };
}
