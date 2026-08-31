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
 *   node tools/scratch.mjs new <label> --why "..."   make one, print its path
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
const TMP = join(root, '.walkdown', 'tmp');
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

function make(label, why) {
  if (!label || !/^[a-z0-9][a-z0-9-]*$/i.test(label))
    die('usage: scratch new <label> --why "..."   (label: letters, digits, dashes)');
  const path = join(TMP, label);
  /*
   * A collision is refused rather than reused. Two agents judging at once is
   * normal, and handing the second one the first one's half-written ledger
   * would produce a run record neither of them could account for.
   */
  if (existsSync(path))
    die(`${path} already exists — pick another label, or clean that one first.`);

  mkdirSync(path, { recursive: true });
  cpSync(join(root, 'blueprint'), join(path, 'blueprint'), { recursive: true });
  // A half-finished sitting is one person's working state; a copy of it is nobody's.
  rmSync(join(path, 'blueprint', 'drafts'), { recursive: true, force: true });
  // `prototype.root` resolves against the blueprint's parent, so it has to be beside it.
  symlinkSync(join(root, 'prototype'), join(path, 'prototype'), 'dir');
  /*
   * Evidence is linked, not copied. It lives outside the repository now
   * (docs/08-locations.md) and is two orders of magnitude larger than
   * everything else here — copying it is how the abandoned spaces got big
   * enough to notice.
   */
  const real = resolveLocations({ dir: join(root, 'blueprint') }).evidence.path;
  if (real && existsSync(real)) {
    mkdirSync(join(path, 'blueprint', 'runs'), { recursive: true });
    symlinkSync(real, join(path, 'blueprint', 'runs', 'evidence'), 'dir');
  }
  writeFileSync(
    join(path, STAMP),
    JSON.stringify(
      {
        label,
        why: why ?? null,
        created: new Date().toISOString(),
        pid: process.pid,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(path);
  console.error(
    `\nA disposable copy. Serve it with:\n` +
      `  node bin/walkdown.js serve --dir ${join(path, 'blueprint')}\n` +
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
    rest.find((a) => !a.startsWith('--') && a !== flag('why')),
    flag('why'),
  );
else if (cmd === 'list') list();
else if (cmd === 'clean') clean(rest);
else die('usage: scratch new <label> --why "..." | list | clean <label>… | clean --stale');
