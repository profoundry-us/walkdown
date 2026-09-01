/*
 * The dispatcher's manners. A subcommand asked for --help answers with the
 * usage, and an unknown option is refused as the usage mistake it is - on
 * stderr, exit 2, in words. Both used to be a raw parseArgs stack trace
 * pointing at node internals (found in passing by the 2026-09-01 sitting).
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const CLI = new URL('../bin/walkdown.js', import.meta.url).pathname;
const run = (args) =>
  execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('a subcommand asked for --help prints the usage and exits 0', () => {
  for (const cmd of ['thread', 'status', 'judge']) {
    const out = run([cmd, '--help']);
    assert.match(out, /Usage:/);
    assert.doesNotMatch(out, /parse_args|SyntaxError|at ModuleLoader/);
  }
});

test('an unknown option is a worded refusal, never a stack trace', () => {
  assert.throws(
    () => run(['status', '--bogus']),
    (err) => {
      assert.equal(err.status, 2, 'a script must be able to stop on it');
      assert.match(String(err.stderr), /walkdown status: Unknown option '--bogus'/);
      assert.match(String(err.stderr), /walkdown --help/);
      assert.doesNotMatch(String(err.stderr), /parse_args|at ModuleLoader|internal/);
      assert.equal(err.stdout, '', 'refusals live on stderr');
      return true;
    },
  );
});
