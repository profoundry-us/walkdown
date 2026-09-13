#!/usr/bin/env node
/*
 * Disposable blueprint copies, and the reaping of them.
 *
 * Some judging cannot be done against the real blueprint. A rule saying the
 * panel REFUSES something is judged by making it refuse, and pressing the
 * button that would file a thread files a thread — so the honest way to judge
 * governance is to drive a server whose ledger nobody cares about. The checks
 * suite has had one of these forever (checks/global-setup.mjs); this is the
 * same idea for a person or an agent doing it by hand.
 *
 * It exists because doing it by hand left six abandoned copies behind — 367MB
 * of them, found weeks later, kept only because nobody remembered which run
 * had made which. A scratch space nobody can name is a scratch space nobody
 * deletes, so every space made here is stamped with who asked for it and why,
 * and `clean --stale` will take any that outlived their sitting.
 *
 *   node tools/scratch.mjs new <label> --why "..." [--port <n>]   make one, print its path
 *   node tools/scratch.mjs list                      what is lying around
 *   node tools/scratch.mjs clean <label>             take yours away
 *   node tools/scratch.mjs clean --stale             and anything abandoned
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocations } from '../lib/locations.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(root, 'tmp', 'scratch');
/** walkdown's own home, relative to either root. */
const HOME = join('.walkdown', 'blueprints', '0001-walkdown');
const STAMP = '.scratch.json';
/* Long enough for any sitting, short enough that a forgotten space is gone
 * before it is a mystery. */
const STALE_MS = 4 * 60 * 60 * 1000;

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const age = (ms) =>
  ms < 90e3
    ? `${Math.round(ms / 1e3)}s`
    : ms < 5400e3
      ? `${Math.round(ms / 60e3)}m`
      : `${Math.round(ms / 36e5)}h`;

function spaces() {
  if (!existsSync(TMP)) return [];
  return readdirSync(TMP, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const path = join(TMP, e.name);
      let stamp = null;
      try {
        stamp = JSON.parse(readFileSync(join(path, STAMP), 'utf8'));
      } catch {
        /* unstamped */
      }
      return { label: e.name, path, stamp, touched: statSync(path).mtimeMs };
    })
    .sort((a, b) => a.touched - b.touched);
}

function make(label, why, port) {
  if (!label || !/^[a-z0-9][a-z0-9-]*$/i.test(label))
    die('usage: scratch new <label> --why "..." [--port <n>]   (label: letters, digits, dashes)');
  if (port != null && !/^\d{2,5}$/.test(String(port))) die(`--port wants a number, not ${port}`);
  const path = join(TMP, label);
  /*
   * A collision is refused rather than reused. Two agents judging at once is
   * normal, and handing the second one the first one's half-written ledger
   * would produce a run record neither of them could account for.
   */
  if (existsSync(path))
    die(`${path} already exists — pick another label, or clean that one first.`);

  mkdirSync(path, { recursive: true });
  // The home as it is laid out - and no drafts: a half-finished sitting is one
  // person's working state, and a copy of it is nobody's.
  for (const part of ['blueprint', 'threads', 'runs'])
    cpSync(join(root, HOME, part), join(path, HOME, part), { recursive: true });
  // `prototype.root` resolves against the code root, which is this directory.
  symlinkSync(join(root, 'prototype'), join(path, 'prototype'), 'dir');
  /*
   * Evidence is linked, not copied. It lives outside the repository now
   * (docs/08-locations.md) and is two orders of magnitude larger than
   * everything else here — copying it is how the abandoned spaces got big
   * enough to notice.
   *
   * Entry by entry, though, and not the directory itself. Linking `evidence`
   * whole shares the real root outright: everything a judge saves lands in the
   * real home, and anything that moves or renames an evidence directory moves
   * the real one. That is the opposite of what the governance block in every
   * judge prompt promises, and it is not theoretical — on 2026-09-05 a judge
   * relocated 121 real entries believing they were a copy's, and restored them
   * only because it happened to be judging the rule about moving evidence
   * roots (n-0193). Linking the entries keeps reading free, leaves anything
   * new inside the copy where `clean` takes it away, and narrows the sharp
   * edge to deliberately reaching into a stamp that already existed.
   */
  const real = resolveLocations({ spec: join(root, HOME, 'blueprint') }).evidence.path;
  const shared = real && existsSync(real) ? readdirSync(real) : [];
  mkdirSync(join(path, HOME, 'evidence'), { recursive: true });
  for (const entry of shared) symlinkSync(join(real, entry), join(path, HOME, 'evidence', entry));
  /*
   * A personal home of its own, with a registry naming the copy and nothing
   * else, so that a server started with WALKDOWN_HOME pointed at it answers
   * for the copy alone (ADR 0003). The real project's row lives in the real
   * registry; a server reading this one cannot see it, so the real ledger is
   * not one `?bp=` away (q-0149) - which is what checks/checkspace.mjs has
   * always done. The copy carries a manifest too, so it is what a checkout
   * looks like; `import` would register it from this file.
   */
  mkdirSync(join(path, '.walkdown'), { recursive: true });
  writeFileSync(
    join(path, '.walkdown', 'config.yml'),
    [
      '# A scratch copy for judging. Serve it with WALKDOWN_HOME pointed at its',
      '# home/, whose registry names this copy and nothing else.',
      'blueprints:',
      '  - id: blueprint',
      '    home: 0001-walkdown',
      '',
    ].join('\n'),
  );
  mkdirSync(join(path, 'home'), { recursive: true });
  writeFileSync(
    join(path, 'home', 'config.yml'),
    `identity:\n  username: scratch-${label}\n  name: A scratch sitting (${label})\n`,
  );
  writeFileSync(
    join(path, 'home', 'registry.yml'),
    [
      'blueprints:',
      '  - id: blueprint',
      `    project: ${path}`,
      `    home: ${join(path, HOME)}`,
      // Not `ephemeral:` - a scratch row is reached by standing in the copy,
      // which an ephemeral row never is; the home it lives in is the throwaway.
      `    registered: { by: import, at: '${new Date().toISOString()}' }`,
      '',
    ].join('\n'),
  );
  /*
   * The app surface follows the copy. The blueprint's `local` target names
   * the real server's port, and the panel builds the app frame from it - so a
   * copy served on another port still framed the REAL server's stand-in,
   * whose embed would have pinned into the real ledger. Every browser judge
   * found this and edited the copy's walkdown.yml by hand; with --port the
   * copy is retargeted here, once, and the serve line below matches.
   */
  if (port != null) {
    const yml = join(path, HOME, 'blueprint', 'walkdown.yml');
    const before = readFileSync(yml, 'utf8');
    const after = before.replace(
      /^(\s*base_url:\s*http:\/\/localhost:)\d+/gm,
      `$1${port}`,
    );
    if (after === before) die(`${yml} has no localhost base_url to retarget`);
    writeFileSync(yml, after);
  }
  writeFileSync(
    join(path, STAMP),
    JSON.stringify(
      {
        label,
        why: why ?? null,
        port: port != null ? Number(port) : null,
        created: new Date().toISOString(),
        pid: process.pid,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(path);
  console.error(
    `\nA disposable copy, registered to itself. Serve it with its own home:\n` +
      `  cd ${path} && WALKDOWN_HOME=${join(path, 'home')} node ${join(root, 'bin', 'walkdown.js')} serve --port ${port ?? '<n>'}\n` +
      `Started there it offers this copy and nothing else - not the real ledger.\n` +
      (port != null
        ? `Its local target points at :${port} too, so the app surface is this server's, not the real one's.\n`
        : `Its local target still names the REAL server's port: pass --port <n> so the app surface is this server's.\n`) +
      (shared.length
        ? `Evidence is the exception: its ${shared.length} existing entries are LINKS to the real ones, so\n` +
          `read them freely and move or delete none of them. Anything you save lands in the copy.\n`
        : `Evidence starts empty here, and anything you save lands in the copy.\n`) +
      `Take it away when the sitting closes:\n` +
      `  node tools/scratch.mjs clean ${label}\n`,
  );
}

function list() {
  const all = spaces();
  if (!all.length) return console.log('No scratch spaces. Nothing to clean up.');
  const now = Date.now();
  for (const s of all) {
    const stale = now - s.touched > STALE_MS;
    console.log(
      `${stale ? '!' : ' '} ${s.label.padEnd(24)} ${age(now - s.touched).padStart(5)} old  ${s.stamp?.why ?? (s.stamp ? '(no why recorded)' : '(unstamped — made by hand)')}`,
    );
  }
  if (all.some((s) => now - s.touched > STALE_MS))
    console.log(`\n! = untouched for over ${STALE_MS / 36e5}h. \`clean --stale\` takes those.`);
}

function clean(args) {
  const all = spaces();
  const now = Date.now();
  /*
   * `--stale` and named labels, but never a blanket "delete everything":
   * sittings run side by side, and a close-out that swept the board would take
   * the space another agent is still judging in.
   */
  const targets = args.includes('--stale')
    ? all.filter((s) => now - s.touched > STALE_MS)
    : all.filter((s) => args.includes(s.label));
  const unknown = args.filter((a) => !a.startsWith('--') && !all.some((s) => s.label === a));
  for (const u of unknown) console.error(`no scratch space named ${u} — already gone?`);
  if (!targets.length) return console.log('Nothing to remove.');
  for (const s of targets) {
    rmSync(s.path, { recursive: true, force: true });
    console.log(`removed ${s.label}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i < 0 ? null : rest[i + 1];
};
if (cmd === 'new')
  make(
    rest.find((a) => !a.startsWith('--') && a !== flag('why') && a !== flag('port')),
    flag('why'),
    flag('port'),
  );
else if (cmd === 'list') list();
else if (cmd === 'clean') clean(rest);
else die('usage: scratch new <label> --why "..." [--port <n>] | list | clean <label>… | clean --stale');
