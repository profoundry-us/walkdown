#!/usr/bin/env node
/*
 * Say whether a release may start: RELEASING.md step 1, as a gate rather than
 * a paragraph. Exits 1 and names what is left while anything is.
 *
 * A release is started only once there is nothing left to walk down (Topher,
 * 2026-10-20). 0.5.0 was cut and tagged with nine rules unsigned, a question
 * open and a design undrawn, because step 1 was read as advice.
 *
 *   node tools/release-ready.mjs           every blueprint, each section named
 *   node tools/release-ready.mjs --hook    a Claude Code PreToolUse hook: reads
 *                                          the Bash call on stdin, and for a
 *                                          version tag, a push of one, or a
 *                                          GitHub release, blocks it (exit 2)
 *                                          unless the release is ready
 *
 * Ready means, for every blueprint the project holds:
 *   - status asks nothing of anyone: no item waiting on a person, the agent
 *     or design, and no rule failing or pending;
 *   - the agent tier owes nothing (tools/sitting.mjs owed);
 * and, once for the project, lint shows no errors and the tree is clean.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The commands that start or publish a release, matched where a command
// starts, so a file being written that only mentions one is not stopped.
// Deleting a tag undoes a release, so it never needs the gate.
const RELEASING = [
  /^git\s+tag\s+(?!-d\b|--delete\b)[^|;&]*\bv\d+\.\d+\.\d+/,
  /^git\s+push\b[^|;&]*(--tags|\bv\d+\.\d+\.\d+)/,
  /^gh\s+release\s+create\b/,
];

export function startsARelease(command) {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim().replace(/^(\w+=\S*\s+)+/, ''))
    .some((s) => RELEASING.some((re) => re.test(s)));
}

function run(cmd, args) {
  try {
    return {
      out: execFileSync(cmd, args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      code: 0,
    };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? 2 };
  }
}

// Everything still left before a release may start, one line each.
export function whatIsLeft() {
  const left = [];

  const status = run('node', [join(ROOT, 'bin/walkdown.js'), 'status', '--json']);
  let blueprints = [];
  try {
    blueprints = JSON.parse(status.out).blueprints ?? [];
  } catch {
    left.push(`walkdown status --json did not answer:\n${status.out.trim()}`);
  }
  for (const bp of blueprints) {
    for (const a of bp.attention ?? []) {
      const what = a.rule ?? a.thread ?? a.threads?.join(', ') ?? '';
      const role = a.role ? ` (${a.role})` : '';
      left.push(`${bp.id}: ${a.who}${role} owes ${a.action} on ${what}`);
    }
    const queued = new Set((bp.attention ?? []).map((a) => a.rule).filter(Boolean));
    for (const r of bp.rows ?? []) {
      if ((r.verdict === 'fail' || r.verdict === 'pending') && !queued.has(r.rule))
        left.push(`${bp.id}: ${r.rule} is ${r.verdict}, and nobody is asked for it`);
    }
  }

  const owed = run('node', [join(ROOT, 'tools/sitting.mjs'), 'owed']);
  for (const m of owed.out.matchAll(/^(\d+) of \d+ agent-tier rules owed/gm)) {
    if (Number(m[1]) > 0)
      left.push(`the agent tier owes ${m[1]} rule(s): node tools/sitting.mjs owed`);
  }
  if (owed.code !== 0) left.push(`tools/sitting.mjs owed failed:\n${owed.out.trim()}`);

  const lint = run('node', [join(ROOT, 'bin/walkdown.js'), 'lint']);
  for (const m of lint.out.matchAll(/— (\d+) error\(s\)/g))
    left.push(`lint shows ${m[1]} error(s): node bin/walkdown.js lint`);

  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).out.trim();
  if (dirty) left.push(`the working tree is not clean:\n${dirty}`);

  return left;
}

async function main() {
  const hook = process.argv.includes('--hook');
  if (hook) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    let command = '';
    try {
      command = JSON.parse(input).tool_input?.command ?? '';
    } catch {
      return;
    }
    if (!startsARelease(command)) return;
  }
  const left = whatIsLeft();
  if (left.length) {
    console.error(`Not ready to release. ${left.length} thing(s) left:`);
    for (const l of left) console.error(`  - ${l}`);
    console.error('Walk them down first; RELEASING.md step 1.');
    process.exit(hook ? 2 : 1);
  }
  console.log(
    'Ready to release: nothing waits on anyone, the agent tier owes nothing, lint is clean, the tree is clean.',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
