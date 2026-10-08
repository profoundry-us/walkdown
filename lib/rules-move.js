/*
 * MOVING RULES BETWEEN A PROJECT'S BLUEPRINTS (ADR 0013 §5).
 *
 * A project that grows a second blueprint starts by carving rules out of its
 * first, and every one of those rules has a history: checks recorded against
 * it, the agent's verdicts, people's signatures, the threads that argued it
 * into shape. Cut by hand, the rules arrive bare and every verdict is earned
 * again. So a move takes it all:
 *
 *   - the rule's YAML, node for node, into the feature file of the same name
 *     in the destination - its statement, steps, hashes and rewordings intact;
 *   - its threads, moved and keeping their ids (unique in the project since
 *     §3), with the pictures they carry;
 *   - every run record holding a result for it, COPIED with only the moved
 *     rules' results and a `copied_from` saying whence - the source's records
 *     are never edited, because the ledger is append-only;
 *   - every sweep, copied naming the moved rules, so a verdict that was stale
 *     stays stale and the destination's own rules are not swept (q-0528);
 *   - the evidence the copies cite, under the same logical keys.
 *
 * Planned first and applied second, so `--dry-run` is the plan, printed.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isMap, parseDocument } from '../vendor/yaml.js';
import { canon, resolveLocations, SPEC_FILE } from './locations.js';
import { samePlace } from './status.js';
import { isoNow } from './time.js';

/** The record directories of a blueprint, by its spec. */
function places(specDir) {
  const at = resolveLocations({ spec: specDir });
  return {
    spec: specDir,
    threads: at.threads.path,
    runs: at.runs.path,
    evidence: at.evidence.path,
  };
}

const featureFiles = (specDir) => {
  const dir = join(specDir, 'features');
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('_'))
        .sort()
        .map((f) => join(dir, f))
    : [];
};

const ruleIdsIn = (specDir) => {
  const ids = new Set();
  for (const file of featureFiles(specDir)) {
    const data = parseDocument(readFileSync(file, 'utf8')).toJS() ?? {};
    for (const story of data.stories ?? [])
      for (const rule of story?.rules ?? []) if (rule?.id) ids.add(String(rule.id));
  }
  return ids;
};

/*
 * What `what` names in a blueprint: a rule id, a story id, or a feature (its
 * `feature:` name, or its file's name). The most specific match wins, so a
 * story that shares its feature's name is still the story.
 */
function select(specDir, what) {
  const hits = { rule: [], story: [], feature: [] };
  for (const file of featureFiles(specDir)) {
    const doc = parseDocument(readFileSync(file, 'utf8'));
    const data = doc.toJS() ?? {};
    const name = String(data.feature ?? basename(file).replace(/\.ya?ml$/, ''));
    (data.stories ?? []).forEach((story, si) => {
      if (String(story?.id) === what) hits.story.push({ file, si, story });
      (story?.rules ?? []).forEach((rule, ri) => {
        if (String(rule?.id) === what) hits.rule.push({ file, si, ri, story, rule });
      });
    });
    if (name === what || basename(file).replace(/\.ya?ml$/, '') === what)
      hits.feature.push({ file, data });
  }
  if (hits.rule.length) return { kind: 'rule', ...hits.rule[0] };
  if (hits.story.length) return { kind: 'story', ...hits.story[0] };
  if (hits.feature.length) return { kind: 'feature', ...hits.feature[0] };
  return null;
}

/* Uncommitted changes under a blueprint's features, when git keeps them at all. */
function dirtyFeatures(specDir) {
  const dir = join(specDir, 'features');
  const inside = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  });
  if (inside.status !== 0) return [];
  const out = spawnSync('git', ['-C', dir, 'status', '--porcelain', '--', '.'], {
    encoding: 'utf8',
  });
  return out.stdout.split('\n').filter(Boolean);
}

const EVIDENCE_KEY = /^runs\/evidence\/(.+)$/;

/**
 * Work out a move without making it. Every refusal is collected, so a dry
 * run lists all of them at once rather than the first.
 *
 * @param {{ from: { id: string, dir: string }, to: { id: string, dir: string },
 *   what: string | string[], project: { id: string, dir: string }[] }} ask
 */
export function planMove({ from, to, what, project }) {
  const asked = [what].flat();
  const refusals = [];
  if (!project.some((b) => canon(b.dir) === canon(to.dir)))
    refusals.push(
      `\`${to.id}\` is not a blueprint of this project — a rule moves only between blueprints of one project`,
    );
  if (canon(from.dir) === canon(to.dir)) refusals.push(`the rules are already in \`${to.id}\``);
  const pickedAll = asked.map((w) => ({ w, hit: select(from.dir, w) }));
  for (const { w, hit } of pickedAll)
    if (!hit) refusals.push(`\`${from.id}\` has no rule, story or feature called \`${w}\``);
  const picks = pickedAll.map((p) => p.hit).filter(Boolean);
  if (!picks.length)
    return {
      refusals,
      rules: [],
      threads: [],
      runs: [],
      sweeps: [],
      evidence: [],
      picked: null,
      picks,
      from,
      to,
    };
  const picked = picks[0];
  const rulesOfPick = (p) =>
    p.kind === 'rule'
      ? [String(p.rule.id)]
      : p.kind === 'story'
        ? (p.story.rules ?? []).map((r) => String(r.id))
        : (p.data.stories ?? []).flatMap((s) => (s?.rules ?? []).map((r) => String(r.id)));
  const rules = [...new Set(picks.flatMap(rulesOfPick))];
  const moved = new Set(rules);
  const theirs = ruleIdsIn(to.dir);
  for (const id of rules)
    if (theirs.has(id)) refusals.push(`\`${to.id}\` already has a rule \`${id}\``);
  for (const b of [from, to]) {
    const dirty = dirtyFeatures(b.dir);
    if (dirty.length)
      refusals.push(
        `\`${b.id}\` has uncommitted changes to its features (${dirty.length} file(s)) — commit them first, so the move is one diff of its own`,
      );
  }

  const src = places(from.dir);
  const dst = places(to.dir);

  // Threads anchored to a moved rule, and the pictures they carry.
  const threads = [];
  if (existsSync(src.threads))
    // Named by UUID now, or by label from before (ADR 0014 §9): every YAML
    // file in the folder is a thread, and its label is inside it.
    for (const f of readdirSync(src.threads)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()) {
      const text = readFileSync(join(src.threads, f), 'utf8');
      const t = parseDocument(text).toJS();
      if (!t?.id || !moved.has(String(t?.anchor?.rule ?? ''))) continue;
      const pictures = [...new Set(text.match(/attachments\/[A-Za-z0-9._-]+/g) ?? [])];
      if (existsSync(join(dst.threads, f)))
        refusals.push(`\`${to.id}\` already has a thread \`${f.replace(/\.ya?ml$/, '')}\``);
      threads.push({ id: String(t.id), file: f, pictures });
    }
  threads.sort((a, b) => a.id.localeCompare(b.id));

  // Run records with a result for a moved rule, filtered; sweeps whole.
  const runs = [];
  const sweeps = [];
  const evidence = new Set();
  if (existsSync(src.runs))
    for (const f of readdirSync(src.runs)
      .filter((f) => f.endsWith('.json'))
      .sort()) {
      let record;
      try {
        record = JSON.parse(readFileSync(join(src.runs, f), 'utf8'));
      } catch {
        continue; // unreadable is lint's to say, and it is nobody's verdict
      }
      if (record?.kind === 'sweep') {
        sweeps.push({ file: f, record });
        continue;
      }
      const results = (record?.results ?? []).filter((r) => moved.has(String(r?.rule)));
      if (!results.length) continue;
      for (const r of results)
        for (const e of r.evidence ?? []) if (EVIDENCE_KEY.test(String(e))) evidence.add(String(e));
      runs.push({ file: f, record: { ...record, results } });
    }
  /*
   * A verdict belongs to a place (status.derived.verdict-belongs-to-a-place):
   * a copy recorded at an address the destination's target of that name does
   * not point at fills no cell there. Moved anyway, every such verdict would
   * read as never - so the targets are made to agree first.
   */
  const targetsOf = (dir) => {
    try {
      return (
        parseDocument(readFileSync(join(dir, SPEC_FILE), 'utf8')).toJS()?.runner?.targets ?? {}
      );
    } catch {
      return {};
    }
  };
  const theirTargets = targetsOf(to.dir);
  const astray = new Map();
  for (const { record } of runs) {
    if (!record.base_url) continue;
    const want = theirTargets[record.target]?.base_url;
    if (want && samePlace(record.base_url, want)) continue;
    const key = `${record.target}\u0000${record.base_url}\u0000${want ?? ''}`;
    astray.set(key, (astray.get(key) ?? 0) + 1);
  }
  for (const [key, n] of astray) {
    const [target, at, want] = key.split('\u0000');
    refusals.push(
      want
        ? `${n} verdict(s) were recorded at ${at}, but \`${to.id}\`'s target \`${target}\` points at ${want} — they would read as never there; point it at ${at} first`
        : `${n} verdict(s) were recorded against target \`${target}\` at ${at}, and \`${to.id}\` has no such target — they would read as never there; add it to its spec.yml first`,
    );
  }

  /*
   * Where each copy lands. A sweep is copied naming the moved rules it
   * governed, and sweeps only them there (q-0528); a rule an earlier move
   * already carried it to is not named twice, and a sweep with nothing left
   * to name is not copied - every copy is another sweep to the report. A
   * record whose file name is taken (an earlier move copied other rules'
   * results from the same run) is written beside it with a suffix: the two
   * share a run id and hold different rules, which reads as one run.
   */
  const carried = new Map(); // source run id -> rules a copy here already names
  if (existsSync(dst.runs))
    for (const f of readdirSync(dst.runs).filter((f) => f.endsWith('.json'))) {
      try {
        const copy = JSON.parse(readFileSync(join(dst.runs, f), 'utf8'));
        const c = copy.copied_from;
        if (copy.kind !== 'sweep' || c?.blueprint !== from.id || !c.run) continue;
        // A copy from before copies named their rules swept everything.
        const named = Array.isArray(copy.rules) ? copy.rules : [...moved];
        carried.set(c.run, new Set([...(carried.get(c.run) ?? []), ...named]));
      } catch {
        // not a copy, or not readable: either way not ours to skip over
      }
    }
  const keptSweeps = [];
  for (const s_ of sweeps) {
    const own = Array.isArray(s_.record.rules) ? new Set(s_.record.rules.map(String)) : null;
    const done = carried.get(s_.record.run_id) ?? new Set();
    const names = rules.filter((r) => (!own || own.has(r)) && !done.has(r));
    if (names.length) keptSweeps.push({ ...s_, record: { ...s_.record, rules: names } });
  }
  const place = (file) => {
    const base = file.replace(/\.json$/, '');
    let name = file;
    for (let n = 2; existsSync(join(dst.runs, name)); n++) name = `${base}--${n}.json`;
    return name;
  };
  for (const r of runs) r.as = place(r.file);
  for (const s_ of keptSweeps) s_.as = place(s_.file);

  return {
    refusals,
    picked,
    picks,
    rules,
    threads,
    runs,
    sweeps: keptSweeps,
    evidence: [...evidence],
    from,
    to,
    src,
    dst,
  };
}

/*
 * A feature file written back as it was written: no folding of long lines,
 * no padding inside `[checks]`. The library's defaults re-wrapped every rule
 * walkdown's own split touched, in both blueprints - the same words, and a
 * diff of nothing but noise. With these, a file read and written unchanged
 * is byte for byte the file it was.
 */
const emit = (doc) => doc.toString({ lineWidth: 0, flowCollectionPadding: false });

/* The feature document in the destination a moved node lands in. */
function destinationDoc(file, name) {
  if (existsSync(file)) return parseDocument(readFileSync(file, 'utf8'));
  const doc = parseDocument(`feature: ${name}\nstories: []\n`);
  /** @type {any} */ (doc.get('stories')).flow = false;
  return doc;
}

const storyIndex = (doc, id) =>
  /** @type {any} */ (doc.get('stories')?.items ?? []).findIndex(
    (s) => isMap(s) && String(s.get('id')) === id,
  );

/* One selection's YAML, out of its feature file and into the destination's. */
function moveYaml(picked, to) {
  const srcDoc = parseDocument(readFileSync(picked.file, 'utf8'));
  const name = String(srcDoc.get('feature') ?? basename(picked.file).replace(/\.ya?ml$/, ''));
  const destFile = join(to.dir, 'features', basename(picked.file));
  const destDoc = destinationDoc(destFile, name);
  const srcStories = /** @type {any} */ (srcDoc.get('stories'));
  const destStories = /** @type {any} */ (destDoc.get('stories'));
  const takeStory = (node) => {
    const id = String(node.get('id'));
    const there = storyIndex(destDoc, id);
    if (there < 0) return void destStories.items.push(node);
    // The story is already there: its rules join the ones it has.
    const into = destStories.items[there].get('rules', true);
    for (const r of node.get('rules', true)?.items ?? []) into.items.push(r);
  };
  if (picked.kind === 'feature') {
    for (const node of [...srcStories.items]) takeStory(node);
    srcStories.items = [];
  } else if (picked.kind === 'story') {
    takeStory(srcStories.items[picked.si]);
    srcStories.items.splice(picked.si, 1);
  } else {
    const storyNode = srcStories.items[picked.si];
    const rulesNode = storyNode.get('rules', true);
    const [ruleNode] = rulesNode.items.splice(picked.ri, 1);
    const there = storyIndex(destDoc, String(storyNode.get('id')));
    if (there >= 0) destStories.items[there].get('rules', true).items.push(ruleNode);
    else {
      // A story of its own in the destination: the same id, title and
      // statement, holding the one rule.
      const shell = destDoc.createNode({});
      for (const pair of storyNode.items)
        if (String(pair.key) !== 'rules') shell.items.push(pair.clone());
      const seq = destDoc.createNode([]);
      seq.items.push(ruleNode);
      shell.set('rules', seq);
      destStories.items.push(shell);
    }
    if (!rulesNode.items.length) srcStories.items.splice(picked.si, 1);
  }
  mkdirSync(dirname(destFile), { recursive: true });
  writeFileSync(destFile, emit(destDoc));
  if (!srcStories.items.length) rmSync(picked.file);
  else writeFileSync(picked.file, emit(srcDoc));

  return destFile;
}

/**
 * Make the move a plan describes. Refuses outright if the plan has any
 * refusals - a half-made move is two blueprints that both disagree with
 * their own histories.
 */
export function applyMove(plan) {
  if (plan.refusals.length) throw new Error(plan.refusals.join('\n'));
  const { from, to, src, dst } = plan;
  const at = isoNow();

  // ---- the YAML -------------------------------------------------------------
  // One selection at a time, each re-read: an earlier one may have changed
  // the file a later one is in.
  let destFile = null;
  for (const want of plan.picks) {
    const now = select(
      from.dir,
      want.kind === 'feature'
        ? String(want.data.feature ?? basename(want.file).replace(/\.ya?ml$/, ''))
        : String((want.rule ?? want.story).id),
    );
    if (now) destFile = moveYaml(now, to);
  }
  // ---- threads, and their pictures -------------------------------------------
  mkdirSync(dst.threads, { recursive: true });
  for (const t of plan.threads) {
    renameSync(join(src.threads, t.file), join(dst.threads, t.file));
    for (const p of t.pictures) {
      const from_ = join(src.threads, p);
      if (!existsSync(from_)) continue;
      mkdirSync(dirname(join(dst.threads, p)), { recursive: true });
      renameSync(from_, join(dst.threads, p));
    }
  }

  // ---- run records, sweeps and evidence: copied, never moved ------------------
  mkdirSync(dst.runs, { recursive: true });
  const copiedFrom = (record) => ({ blueprint: from.id, run: record.run_id ?? null, at });
  for (const { as, record } of [...plan.runs, ...plan.sweeps])
    writeFileSync(
      join(dst.runs, as),
      `${JSON.stringify({ ...record, copied_from: copiedFrom(record) }, null, 2)}\n`,
    );
  let pictures = 0;
  for (const key of plan.evidence) {
    const rel = key.match(EVIDENCE_KEY)[1];
    const from_ = join(src.evidence, rel);
    if (!existsSync(from_)) continue;
    mkdirSync(dirname(join(dst.evidence, rel)), { recursive: true });
    copyFileSync(from_, join(dst.evidence, rel));
    pictures++;
  }
  return { file: destFile, evidenceCopied: pictures };
}
