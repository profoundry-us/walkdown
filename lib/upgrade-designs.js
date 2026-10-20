/*
 * `walkdown upgrade`, for designs: every blueprint's designs moved from the
 * folders that sorted them by who drew them - screens/, drafts/, proposals/ -
 * into a folder per screen of dated versions (ADR 0015 §2,
 * locations.keeping.upgrade-moves-prototypes).
 *
 *   <root>/screens/cart.html        becomes designs/cart/20260918.html
 *   <root>/drafts/receipt.html      becomes designs/receipt/20260921-v2.html,
 *                                   when a pending request on receipt names it
 *   proposals/shipping.html         the same, for a request on shipping
 *   a draft or proposal no request names is removed (git keeps it)
 *   a file git does not hold, and no screen names, stays where it is
 *   storyboard `prototype:` keys    become `design:`, `proposal:` keys go
 *   spec.yml `prototype.root`       becomes `design.root`
 *   as-built/redlines.json          each note a closed redline thread
 *
 * A version is dated by its file's first commit. Two versions of one screen
 * from the same day are told apart by -v2. Planned for every blueprint at
 * once, because two blueprints may share a proposals/ folder, and a file one
 * of them names is never removed as the other's leftover.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, posix, relative } from 'node:path';
import { parse } from '../vendor/yaml.js';
import { loadBlueprint } from './blueprint.js';
import { isHome } from './locations.js';
import { isLiveRequest } from './vocab.js';
import { fileRecordedRedline } from './writes.js';

const RETIRED = ['screens', 'drafts'];

/* The storyboard as written: loadBlueprint's has already read `design:` into `prototype:`. */
function screensAsWritten(bp) {
  const file = join(bp.dir, 'storyboard.yml');
  if (!existsSync(file)) return [];
  try {
    return parse(readFileSync(file, 'utf8'))?.screens ?? [];
  } catch {
    return [];
  }
}
const VERSION = /^\/?[^/]+\/\d{8}(-v\d+)?\.html$/;
/** A path that names a version, not a file in one of the retired folders. */
const isVersion = (p) =>
  VERSION.test(String(p)) &&
  !RETIRED.concat('proposals').includes(String(p).replace(/^\//, '').split('/')[0]);

/** Every file under a folder, at any depth. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

/**
 * git's answer for one file: whether it holds it, and the day it was first
 * committed. `--follow` finds renames and copies by likeness, so it would date
 * a screen by an unrelated near-duplicate it was once copied from. A rename is
 * followed only while the name - the screen - stays the same; where the name
 * changes, the file was first committed in that commit, under its own name.
 */
function history(file) {
  const run = (...args) => spawnSync('git', ['-C', dirname(file), ...args], { encoding: 'utf8' });
  const own = basename(file);
  const held = run('ls-files', '--error-unmatch', '--', own);
  if (held.error || held.status !== 0) return { tracked: false, date: null };
  const log = run(
    'log',
    '--follow',
    '--name-status',
    '--format=%x00%ad',
    '--date=format:%Y%m%d',
    '--',
    own,
  );
  let date = null;
  for (const chunk of (log.stdout ?? '').split('\0').filter((c) => c.trim())) {
    const [day, ...rest] = chunk.split('\n').map((l) => l.trim());
    const status = rest.find(Boolean)?.split('\t') ?? [];
    date = day || date;
    if (/^A/.test(status[0] ?? '')) break;
    if (/^[RC]/.test(status[0] ?? '') && basename(status[1] ?? '') !== own) break;
  }
  return { tracked: true, date };
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

/* A blueprint's old design root on this disk, and the string spec.yml wrote. */
function oldRoot(bp) {
  const said = bp.config?.prototype?.root;
  if (said == null) return null;
  const inSpec = join(bp.dir, String(said));
  const at = existsSync(inSpec)
    ? inSpec
    : join(bp.codeRoot ?? bp.projectRoot ?? bp.dir, String(said));
  return { said: String(said), at };
}

/*
 * prototype/ becomes designs/, and prototype-cli/ designs-cli/, so two
 * blueprints keep two folders. A root the blueprint named otherwise
 * (claude-design/, say) stays where it is, and its versions go inside it
 * (ADR 0015 §2a, Topher 2026-10-20): only the spec's key is renamed.
 */
const isPrototypeRoot = (said) => /^prototype/.test(posix.basename(said.replace(/\/+$/, '')));
function newRootName(said) {
  if (!isPrototypeRoot(said)) return said;
  const name = posix.basename(said.replace(/\/+$/, ''));
  const parent = posix.dirname(said.replace(/\/+$/, ''));
  return `${parent === '.' ? '' : `${parent}/`}${name.replace(/^prototype/, 'designs')}/`;
}

function proposalsOf(bp) {
  const inSpec = join(bp.dir, 'proposals');
  if (existsSync(inSpec)) return inSpec;
  return join(bp.codeRoot ?? bp.projectRoot ?? bp.dir, 'proposals');
}

/** A request's words, where a draft or proposal it names would be mentioned. */
const wordsOf = (t) =>
  [t.body, t.added, ...(t.replies ?? []).flatMap((r) => [r.body, r.added])]
    .filter(Boolean)
    .join('\n');

/**
 * What the designs upgrade would do to every blueprint in `homes`.
 *
 * @param {Iterable<string>} homes
 */
export function planDesigns(homes) {
  const bps = [];
  for (const home of homes) {
    if (!isHome(home)) continue;
    try {
      bps.push(loadBlueprint(home));
    } catch {
      // A blueprint that does not load is said by every other command; the
      // upgrade moves what it can read.
    }
  }

  // ---- what every blueprint names ---------------------------------------------
  const named = new Set();
  const per = bps.map((bp) => {
    const root = oldRoot(bp);
    const proposals = proposalsOf(bp);
    const screens = screensAsWritten(bp);
    const requests = bp.threads.map((t) => ({ file: t.file, data: t.data }));
    /** @type {{ screen: string, from: string, kind: 'accepted' | 'proposed', request?: any, named?: boolean }[]} */
    const versions = [];
    for (const s of screens) {
      if (!s?.id) continue;
      const path = s.prototype ?? s.design;
      if (root && path && !isVersion(path)) {
        const from = join(root.at, String(path));
        if (existsSync(from)) versions.push({ screen: s.id, from, kind: 'accepted' });
      }
      for (const r of requests) {
        const t = r.data;
        if (!isLiveRequest(t) || t.anchor?.screen !== s.id || t.anchor?.rule) continue;
        // A request that already names a version keeps it. One that names a
        // draft or proposal (`/drafts/<screen>.html`) proposes that file.
        const proposes = typeof t.proposes === 'string' ? t.proposes.trim() : '';
        if (proposes && isVersion(proposes)) continue;
        const rel = proposes.replace(/^\//, '');
        const named = proposes
          ? [
              root ? join(root.at, rel) : null,
              rel.startsWith('proposals/') ? join(proposals, rel.slice('proposals/'.length)) : null,
            ].find((f) => f && existsSync(f))
          : null;
        if (named)
          versions.push({ screen: s.id, from: named, kind: 'proposed', request: r, named: true });
        const words = wordsOf(t);
        const candidates = [
          s.proposal ? join(proposals, String(s.proposal)) : null,
          root ? join(root.at, 'drafts', `${s.id}.html`) : null,
          join(proposals, `${s.id}.html`),
          ...[root ? join(root.at, 'drafts') : null, proposals]
            .filter(Boolean)
            .flatMap((d) => filesUnder(d).filter((f) => words.includes(basename(f)))),
        ].filter((f) => f && existsSync(f) && f !== named);
        for (const from of new Set(candidates))
          versions.push({ screen: s.id, from, kind: 'proposed', request: r });
      }
    }
    for (const v of versions) named.add(v.from);
    return { bp, root, proposals, versions };
  });

  // ---- each blueprint's plan --------------------------------------------------
  const claimed = new Set();
  const plans = [];
  for (const { bp, root, proposals, versions } of per) {
    const said = root?.said ?? null;
    const newSaid = said ? newRootName(said) : 'designs/';
    const rootAt = root ? root.at.replace(/\/+$/, '') : null;
    const base = rootAt ? dirname(rootAt) : (bp.codeRoot ?? bp.dir);
    // The folder itself, beside the old one (or the old one, kept); never
    // the spec's string joined again under the old one's parent.
    const designs = !rootAt
      ? join(base, newSaid)
      : isPrototypeRoot(root.said)
        ? join(base, posix.basename(newSaid.replace(/\/+$/, '')))
        : rootAt;
    const show = (p) => relative(base, p) || '.';

    // Versions, in order: the accepted first, so it takes the plain date.
    const moves = [];
    const taken = new Set();
    const accepted = new Map();
    const seen = new Map();
    for (const v of [...versions].sort((a, b) =>
      a.kind === b.kind ? 0 : a.kind === 'accepted' ? -1 : 1,
    )) {
      if (seen.has(v.from)) {
        moves.push({ ...v, to: seen.get(v.from), shared: true });
        continue;
      }
      const h = history(v.from);
      let date = h.date ?? today();
      if (v.kind === 'proposed' && accepted.has(v.screen) && date < accepted.get(v.screen))
        date = accepted.get(v.screen);
      if (v.kind === 'accepted') accepted.set(v.screen, date);
      let name = `${date}.html`;
      for (
        let n = 2;
        taken.has(`${v.screen}/${name}`) || existsSync(join(designs, v.screen, name));
        n++
      )
        name = `${date}-v${n}.html`;
      taken.add(`${v.screen}/${name}`);
      const to = join(designs, v.screen, name);
      seen.set(v.from, to);
      moves.push({ ...v, to, ref: `/${v.screen}/${name}`, date, uncommitted: !h.tracked });
    }

    // Whatever else the old root holds goes with it, as it is.
    const others = [];
    if (rootAt && designs !== rootAt) {
      for (const f of filesUnder(root.at)) {
        const rel = relative(root.at, f);
        if (RETIRED.includes(rel.split(/[\\/]/)[0])) continue;
        if (named.has(f)) continue;
        others.push({ from: f, to: join(designs, rel) });
      }
    }

    // Leftovers: in the retired folders, named by no blueprint.
    const removed = [];
    const kept = [];
    const folders = [...(root ? RETIRED.map((d) => join(root.at, d)) : []), proposals];
    for (const dir of folders)
      for (const f of filesUnder(dir)) {
        if (named.has(f) || claimed.has(f)) continue;
        claimed.add(f);
        (history(f).tracked ? removed : kept).push(f);
      }
    // Which folders empty is settled once every blueprint's kept files are known.
    const retired = [...folders];
    if (rootAt && designs !== rootAt) retired.push(root.at);

    // Keys.
    const keys = screensAsWritten(bp).filter((s) => s && 'prototype' in s).length;
    const proposalKeys = screensAsWritten(bp).filter((s) => s && 'proposal' in s).length;
    const specRoot = said !== null;

    const work =
      moves.length || others.length || removed.length || keys || proposalKeys || specRoot;
    if (!work) continue;
    plans.push({
      blueprint: bp,
      name: bp.config?.blueprint ?? basename(bp.dir),
      base,
      show,
      designs,
      newSaid,
      moves,
      others,
      removed,
      kept,
      retired,
      rootAt: root?.at ?? null,
      emptied: [],
      keys,
      proposalKeys,
      specRoot,
    });
  }

  // A folder empties when no blueprint keeps a file in it, and is said once.
  const allKept = plans.flatMap((p) => p.kept);
  const listed = new Set();
  for (const p of plans)
    for (const d of p.retired) {
      if (!existsSync(d) || allKept.some((f) => f.startsWith(`${d}/`))) continue;
      p.emptied.push(d);
      if (d !== p.rootAt && !listed.has(d)) (p.emptiedSaid ??= []).push(d);
      listed.add(d);
    }

  // ---- as-built/redlines.json, each note a thread -----------------------------
  const redlines = [];
  const roots = new Map();
  for (const bp of bps) {
    const at = join(bp.codeRoot ?? bp.projectRoot ?? bp.dir, 'as-built', 'redlines.json');
    if (existsSync(at)) roots.set(at, [...(roots.get(at) ?? []), bp]);
  }
  for (const [file, owners] of roots) {
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const notes = [];
    const strays = [];
    // A key names its as-built page: `rule-detail` is /as-built/rule-detail.html,
    // and a CLI screen's `cli/help` is /as-built/cli/help.html (tools/cli-captures.mjs).
    // A key no app path matches is read as a screen id, as before.
    const screenFor = (key) => {
      const page = `/as-built/${key}.html`;
      for (const via of [(s) => s?.app?.path === page, (s) => s?.id === key])
        for (const bp of owners) {
          const s = (bp.storyboard?.screens ?? []).find(via);
          if (s) return { owner: bp, screen: s.id };
        }
      return null;
    };
    for (const [key, entry] of Object.entries(data ?? {}))
      for (const html of entry?.redlines ?? []) {
        const found = screenFor(key);
        if (found) notes.push({ screen: found.screen, key, html, owner: found.owner });
        else strays.push({ screen: key, key, html, owner: null });
      }
    if (notes.length)
      redlines.push({ file, base: dirname(dirname(file)), notes, strays, blueprint: owners[0] });
  }
  return { plans, redlines };
}

/** A redline's words from the HTML redlines.json kept: code as `code`, the rest as text. */
function noteOf(html) {
  const element =
    [...html.matchAll(/<code>([^<]+)<\/code>/g)]
      .map((m) => m[1])
      .find((c) => /^[a-z][\w-]*(\.[\w-]+)+$/.test(c)) ?? null;
  const body = html
    .replace(/<code>([^<]*)<\/code>/g, '`$1`')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
  return { element, body };
}

/** Remove a folder and the empty folders inside it, if nothing else is left. */
function removeIfEmpty(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const name of readdirSync(dir)) removeIfEmpty(join(dir, name));
  if (!readdirSync(dir).length) rmdirSync(dir);
}

/*
 * The storyboard, spec and threads are edited line by line, never parsed and
 * written back: a round trip through a YAML library re-folds a person's
 * paragraphs and respaces their flow maps, and the upgrade changes keys and
 * paths, nothing else.
 */
const edit = (file, change) => writeFileSync(file, change(readFileSync(file, 'utf8')));

/** Each screen's `prototype:` becomes `design:`, at its new version where it moved; `proposal:` goes. */
export function storyboardText(text, refs) {
  let screen = null;
  const out = [];
  for (const line of text.split('\n')) {
    const id = line.match(/^\s*-\s+id:\s*['"]?([^'"\s#]+)/);
    if (id) screen = id[1];
    if (/^\s+proposal:/.test(line)) continue;
    const key = line.match(/^(\s+)prototype:(\s*)(.*)$/);
    if (key) {
      const to = screen && refs.get(screen);
      // A comment on the line is the person's, and stays with it.
      const note = key[3].match(/\s+#.*$/)?.[0] ?? '';
      out.push(to ? `${key[1]}design: ${to}${note}` : `${key[1]}design:${key[2]}${key[3]}`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** `prototype.root` becomes `design.root`, merged into a `design:` the spec already has. */
export function specText(text, root) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^prototype:/.test(l));
  if (at === -1) return text;
  let end = at + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === '')) end++;
  while (end > at + 1 && lines[end - 1].trim() === '') end--;
  const block = lines.slice(at, end);
  const design = lines.findIndex((l) => /^design:/.test(l));
  if (design === -1) {
    block[0] = block[0].replace(/^prototype:/, 'design:');
    const inline = block[0].match(/^design:\s*\{(.*)\}(.*)$/);
    if (inline)
      block[0] = `design: {${inline[1].replace(/root:\s*[^,}]+/, `root: ${root}`)}}${inline[2]}`;
    for (let i = 1; i < block.length; i++)
      block[i] = block[i].replace(/^(\s+root:\s*)[^\s#]+/, `$1${root}`);
    return [...lines.slice(0, at), ...block, ...lines.slice(end)].join('\n');
  }
  // A `design:` already there (`design: { by: agent }`, say) takes the root.
  const rest = [...lines.slice(0, at), ...lines.slice(end)];
  const d = rest.findIndex((l) => /^design:/.test(l));
  const flow = rest[d].match(/^design:\s*\{(.*)\}(.*)$/);
  if (flow) rest[d] = `design: { root: ${root},${flow[1].replace(/^\s*/, ' ')}}${flow[2]}`;
  else rest.splice(d + 1, 0, `  root: ${root}`);
  return rest.join('\n');
}

/** Carry out one blueprint's plan. */
export function runDesignPlan(plan) {
  const bp = plan.blueprint;
  for (const m of [...plan.moves.filter((m) => !m.shared), ...plan.others]) {
    mkdirSync(dirname(m.to), { recursive: true });
    renameSync(m.from, m.to);
  }
  for (const f of plan.removed) if (existsSync(f)) unlinkSync(f);
  for (const d of plan.emptied) removeIfEmpty(d);

  // The storyboard: accepted versions pointed at, keys renamed, proposals gone.
  const refs = new Map(
    plan.moves.filter((m) => m.kind === 'accepted').map((m) => [m.screen, m.ref ?? null]),
  );
  for (const m of plan.moves)
    if (m.shared && m.kind === 'accepted')
      refs.set(m.screen, plan.moves.find((x) => x.to === m.to && x.ref)?.ref ?? null);
  const board = join(bp.dir, 'storyboard.yml');
  if (existsSync(board)) edit(board, (t) => storyboardText(t, refs));

  // Each pending request names its proposed version: the one its `proposes:`
  // already named, moved, or else the latest.
  const latest = new Map();
  const chosen = new Set();
  for (const m of plan.moves)
    if (m.kind === 'proposed') {
      const ref = m.ref ?? plan.moves.find((x) => x.to === m.to && x.ref)?.ref;
      const file = m.request.file;
      if (chosen.has(file)) continue;
      const prev = latest.get(file);
      if (m.named || !prev || ref > prev) latest.set(file, ref);
      if (m.named) chosen.add(file);
    }
  for (const [file, ref] of latest)
    edit(file, (t) =>
      /^proposes:.*$/m.test(t)
        ? t.replace(/^proposes:.*$/m, `proposes: ${ref}`)
        : `${t.replace(/\n*$/, '\n')}proposes: ${ref}\n`,
    );

  // spec.yml: the root, renamed.
  if (plan.specRoot) edit(join(bp.dir, 'spec.yml'), (t) => specText(t, plan.newSaid));
}

/** File one redlines.json's notes as threads, then remove what was filed. */
export function runRedlines(entry) {
  for (const n of entry.notes) {
    const { element, body } = noteOf(n.html);
    fileRecordedRedline(n.owner, { screen: n.screen, element, body });
  }
  if (!entry.strays.length) {
    unlinkSync(entry.file);
    return;
  }
  // A note on a screen no storyboard holds stays, so nothing is lost.
  const left = {};
  for (const s of entry.strays) {
    left[s.screen] ??= { redlines: [] };
    left[s.screen].redlines.push(s.html);
  }
  writeFileSync(entry.file, `${JSON.stringify(left, null, 2)}\n`);
}

export { noteOf as redlineNoteOf };
