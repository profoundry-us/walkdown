#!/usr/bin/env node
/*
 * The development loop: a server that is never older than the tree.
 *
 * A `walkdown serve` holds every module it imported at startup, so an edit to
 * lib/ reaches the browser only after somebody remembers to restart it. That
 * is not a theoretical problem here - it has now cost us three separate
 * afternoons, each identical: the panel sends a field, the running server was
 * started before that field existed, the door drops it, and the record on disk
 * says something nobody chose (roles on 2026-09-06, signatures on 2026-09-07).
 * The failure looks exactly like a bug in the thing you just wrote.
 *
 * So: one command that watches everything and rebuilds or restarts whichever
 * half changed.
 *
 *   npm run dev -- --port 4788
 *
 * Three watchers, because this repo has three kinds of source:
 *
 *   src/panel, src/embed   built assets. Rollup rebuilds them; the server
 *                          reads the build from disk per request, so a rebuild
 *                          reaches the next reload with no restart at all.
 *   styles/walkdown.css    the stylesheet, whose utilities are generated from
 *                          the classes it finds in those sources. Left out of
 *                          this loop, a `w-96` written in src/panel simply had
 *                          no rule, and the element sized itself to its text -
 *                          which reads as a layout bug, not a missing build.
 *   lib/, bin/             the server's own modules. `node --watch` restarts
 *                          the process, because nothing else can.
 *
 * Everything is passed through to `walkdown serve`, so the flags are the ones
 * you already know. Ctrl-C stops all of it.
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

/*
 * Rollup's own watch, once per bundle. `--silent` would hide the errors that
 * matter most here - a build that stopped compiling is the thing you need
 * shouted at you, since the server will happily keep serving the last good
 * bundle and the page will look merely stale.
 */
const kids = [
  ['rollup', ['-c', '-w'], 'panel'],
  ['rollup', ['-c', 'rollup.embed.mjs', '-w'], 'embed'],
  ['npm', ['run', '--silent', 'watch:css'], 'css'],
  ['node', ['--watch', 'bin/walkdown.js', 'serve', ...args], 'serve'],
].map(([cmd, argv, label]) => {
  const kid = spawn(cmd, argv, { stdio: 'inherit', env: process.env });
  kid.on('exit', (code, signal) => {
    // One half dying leaves a loop that lies: a server with no rebuilds, or
    // rebuilds nothing serves. Stop the whole thing and say which half went.
    if (stopping) return;
    console.error(`\ndev: ${label} exited (${signal ?? code}) — stopping the rest.`);
    stop(code ?? 1);
  });
  return kid;
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const kid of kids) kid.kill('SIGTERM');
  // Give them the moment they need to put their ports down, then go.
  setTimeout(() => process.exit(code), 200).unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
