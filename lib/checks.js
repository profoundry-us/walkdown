import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULE_REF = /rule:\s*[:"']?([A-Za-z0-9][A-Za-z0-9._-]*)/g;
const HASH_REF = /sha256:([0-9a-f]{8,64})/;

/**
 * Run the project's `runner.list` command (from the blueprint's parent dir) and
 * return its combined output, or null when no list command is configured.
 * The output format is framework-specific; we only ever scan it for rule refs,
 * which is what keeps this framework-agnostic.
 */
export function runListCommand(config, projectRoot) {
  const cmd = config?.runner?.list;
  if (!cmd) return null;
  const res = spawnSync(cmd, {
    shell: true,
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { error: res.error.message, raw: '' };
  return { error: null, raw: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
}

/** Every rule ID referenced (as `rule:<id>` / `@rule:<id>` / `rule: "<id>"`) in raw text. */
export function extractRuleRefs(raw) {
  const refs = new Set();
  for (const m of raw.matchAll(RULE_REF)) refs.add(m[1]);
  return refs;
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walkFiles(path, out);
    else if (st.isFile() && st.size < 1024 * 1024) out.push(path);
  }
  return out;
}

/**
 * Scan check source files (under config.authoring.location) for rule refs and
 * any nearby sha256 comment: returns [{ file, line, ruleId, hash|null }].
 * A hash within 3 lines of the ref is treated as the statement_hash the check
 * was written against.
 *
 * `authoring.location` may be one path or several. Several is the honest shape
 * for a project whose rules are not all checkable the same way - walkdown's own
 * browser rules live in a Playwright suite and its ledger laws in a node:test
 * one, and a scan that saw only the first would report the other's rules as
 * uncovered.
 */
export function scanCheckFiles(config, projectRoot) {
  const location = config?.authoring?.location;
  if (!location) return [];
  const dirs = (Array.isArray(location) ? location : [location])
    .map((loc) => join(projectRoot, loc))
    .filter((dir) => existsSync(dir));
  if (!dirs.length) return [];
  const found = [];
  for (const file of dirs.flatMap((dir) => walkFiles(dir))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      for (const m of text.matchAll(RULE_REF)) {
        const window = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
        const hash = window.match(HASH_REF);
        found.push({ file, line: i + 1, ruleId: m[1], hash: hash ? hash[1] : null });
      }
    });
  }
  return found;
}

/**
 * The set of rule ids the check suite currently references — the inventory
 * `deriveStatus` needs to tell a live pass from one whose check has gone.
 * A file scan, not a subprocess: this is called on every status read, and
 * `runner.list` shells out to the test framework.
 */
export function checkedRuleIds(config, projectRoot) {
  return new Set(scanCheckFiles(config, projectRoot).map((r) => r.ruleId));
}
