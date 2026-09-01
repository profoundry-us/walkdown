/*
 * The blueprint API: what a panel or an embed can ask about ONE blueprint,
 * and the requests that mutate it. Which blueprint answers - the ?bp=
 * selection, ownership routing by page URL - is the router's business
 * (lib/serve.js); every mutation goes through lib/writes.js, which is the
 * complete list of what a browser may cause to be written.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { collectRules } from './blueprint.js';
import { checkedRuleIds, scanCheckFiles } from './checks.js';
import { readDraft } from './draft.js';
import { formatHash } from './hash.js';
import { defaultActor } from './identity.js';
import { normalizeRoles } from './run-record.js';
import { locationOfUrl, matchScreen } from './screen-match.js';
import { deriveStatus } from './status.js';
import { RESULT_STATUSES, THREAD_KINDS } from './vocab.js';
import * as writes from './writes.js';

const VIEWER_DIR = new URL('./viewer/', import.meta.url).pathname;

/*
 * Where each rule's checks live in the tree right now, as ledger-shaped refs.
 *
 * The ledger's own refs are the record of what a run went through, and they
 * stay the first answer. This is the fallback for a rule whose checks exist
 * but have never been recorded - without it the panel's check-source
 * disclosure has nothing to show until the first run, which reads as a
 * disclosure that was never built (n-0084) - and the second opinion that
 * catches a recorded ref whose file has been edited out from under it.
 */
function sourceRefs(config, projectRoot) {
  const out = {};
  for (const hit of scanCheckFiles(config, projectRoot))
    (out[hit.ruleId] ??= []).push(`${relative(projectRoot, hit.file)}:${hit.line}`);
  return out;
}

/**
 * Resolve a page URL (from a standalone embed) to a storyboard screen id,
 * with the same matcher the browser side uses — a pin that the panel calls
 * one screen and the server files under another is worse than no pin.
 */
const screenForUrl = (blueprint, url) => {
  const loc = locationOfUrl(url);
  if (!loc) return null;
  return matchScreen(blueprint.storyboard?.screens ?? [], loc)?.screen?.id ?? null;
};

const OPENER = /^\s*(test|it|describe|context|RSpec\.describe)\s*[('"]/;

/*
 * Normalize a "path:line" ref to the enclosing test opener. A run records the
 * `test(` line; the tag scan records the `@rule:` line a couple of lines
 * inside it (scanCheckFiles keeps them within a 3-line window). Snapping both
 * to the opener makes them comparable, and starts a snippet where the test
 * does instead of at its tag.
 */
const snapRef = (projectRoot, ref) => {
  const m = String(ref).match(/^(.*?):(\d+)$/);
  if (!m) return String(ref);
  const abs = resolve(projectRoot, m[1]);
  if (!abs.startsWith(projectRoot + '/') || !existsSync(abs)) return String(ref);
  const lines = readFileSync(abs, 'utf8').split('\n');
  const at = Number(m[2]) - 1;
  for (let i = at; i >= 0 && i > at - 4; i--) if (OPENER.test(lines[i] ?? '')) return `${m[1]}:${i + 1}`;
  return String(ref);
};

/**
 * Source snippet for a recorded check ref ("path:line" relative to the
 * project root). Cuts at the next test/describe/it opener or 40 lines.
 */
const checkSnippet = (projectRoot, ref) => {
  const m = String(ref).match(/^(.*?):(\d+)$/);
  const relPath = m ? m[1] : String(ref);
  const line = m ? Number(m[2]) : 1;
  const abs = resolve(projectRoot, relPath);
  if (!abs.startsWith(projectRoot + '/')) return null;
  if (!existsSync(abs)) return { ref, missing: true };
  const lines = readFileSync(abs, 'utf8').split('\n');
  const start = Math.max(0, line - 1);
  let end = Math.min(lines.length, start + 40);
  for (let i = start + 1; i < end; i++) {
    if (OPENER.test(lines[i])) {
      end = i;
      break;
    }
  }
  while (end > start && !lines[end - 1].trim()) end--;
  return { ref, startLine: start + 1, source: lines.slice(start, end).join('\n') };
};

export const handlers = {
  'GET /api/blueprint': (blueprint, _req, _url) => {
    const { targets, rows, drift, attention } = deriveStatus(blueprint, {
      checkRefs: checkedRuleIds(blueprint.config, blueprint.codeRoot ?? blueprint.projectRoot),
    });
    const config = blueprint.config ?? {};
    return {
      project: config.project ?? 'walkdown',
      // What this server currently ships as the panel. The extension's
      // vendored copy hashes itself the same way; a mismatch means the
      // extension is running yesterday's walkdown and should say so.
      panelHash: createHash('sha256')
        .update(readFileSync(join(VIEWER_DIR, 'panel.js')))
        .digest('hex')
        .slice(0, 12),
      projects: blueprint.projects,
      root: blueprint.root,
      targets,
      rows,
      drift,
      attention,
      // A retired screen leaves every surface - the picker, the matcher, the
      // ghost - while its id keeps resolving for the threads anchored to it.
      storyboard: (blueprint.storyboard?.screens ?? []).filter((s) => !s?.retired),
      // The screen a surface falls back to when the page is not one, so the
      // fade control is never dead just because you happen to be elsewhere.
      defaultScreen: blueprint.storyboard?.default_screen ?? null,
      threads: blueprint.threads.map((t) => t.data).filter((t) => t?.id),
      // The sitting in progress, if any — so a panel that just booted can
      // pick up the session where it was left without a second request.
      draft: readDraft(blueprint.dir),
      anchorAttr: config.embed?.anchor_attribute ?? 'data-testid',
      appBase: config.runner?.targets?.local?.base_url ?? null,
      hasPrototype: Boolean(config.prototype?.root),
      // The check source each rule carries in the tree, for the detail
      // pane's disclosure when the ledger has not recorded any yet.
      checkSource: sourceRefs(config, blueprint.codeRoot ?? blueprint.projectRoot),
      identity: defaultActor(blueprint.codeRoot ?? blueprint.projectRoot),
    };
  },

  'GET /api/checks': (blueprint, _req, url) => {
    const ruleId = url.searchParams.get('rule');
    const { targets, rows } = deriveStatus(blueprint, {
      checkRefs: checkedRuleIds(blueprint.config, blueprint.codeRoot ?? blueprint.projectRoot),
    });
    const row = rows.find((r) => r.rule === ruleId);
    if (!row) throw new Error(`unknown rule "${ruleId}"`);
    const recorded = [...new Set(targets.flatMap((t) => row.cells[t]?.checks ?? []))];
    const root = blueprint.codeRoot ?? blueprint.projectRoot;
    const scanned = [
      ...new Set((sourceRefs(blueprint.config, root)[ruleId] ?? []).map((r) => snapRef(root, r))),
    ];
    /*
     * Same order of preference as before - what a run recorded, else what the
     * tree carries - EXCEPT that a recorded ref the tree's own tag scan no
     * longer corroborates is drift: the file was edited above the test and
     * the old line points into a neighbor. Served literally, that showed the
     * evidence test's tail as this rule's source and failed the rule's own
     * check (the 2026-09-01T01-04-49Z run, refs recorded at :843/:869 against
     * a file whose tests had moved to :883/:909). The tree answers for
     * content then; the recorded ref stays visible as provenance.
     */
    const snapped = new Map(recorded.map((ref) => [ref, snapRef(root, ref)]));
    let serve;
    if (!recorded.length) serve = scanned.map((ref) => ({ ref }));
    else if (!scanned.length || recorded.every((ref) => scanned.includes(snapped.get(ref))))
      serve = recorded.map((ref) => ({ ref }));
    else {
      // Drifted recorded refs, queued per file in line order, so each current
      // test can name the stale line that used to be its address.
      const stale = new Map();
      for (const ref of recorded) {
        if (scanned.includes(snapped.get(ref))) continue;
        const file = ref.replace(/:\d+$/, '');
        if (!stale.has(file)) stale.set(file, []);
        stale.get(file).push(ref);
      }
      for (const q of stale.values())
        q.sort((a, b) => Number(a.match(/:(\d+)$/)?.[1]) - Number(b.match(/:(\d+)$/)?.[1]));
      const current = new Set(snapped.values());
      serve = scanned.map((ref) => {
        if (current.has(ref)) return { ref };
        const was = stale.get(ref.replace(/:\d+$/, ''))?.shift();
        return was ? { ref, recorded: was } : { ref };
      });
    }
    return {
      rule: ruleId,
      checks: serve
        .map(({ ref, recorded: was }) => {
          const snip = checkSnippet(root, ref);
          return snip && was ? { ...snip, recorded: was } : snip;
        })
        .filter(Boolean),
    };
  },

  'POST /api/threads': (blueprint, _req, _url, body) => {
    const { kind = 'note', body: text, anchor = {}, author, url } = body ?? {};
    if (!THREAD_KINDS.includes(kind)) throw new Error(`kind must be ${THREAD_KINDS.join('|')}`);
    if (!text || typeof text !== 'string') throw new Error('body text required');
    const screen = anchor.screen ?? (url ? screenForUrl(blueprint, url) : null);
    // Fallback targeting: a pin with no anchored element under it keeps its
    // place by position, so feedback is never blocked by a missing anchor.
    // Positions are in the SURFACE's own CSS-pixel space, never the viewer's
    // screen pixels, so a pin holds its spot across zoom and pane changes.
    const point = (p) =>
      p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
        ? { x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) }
        : null;
    // The spot is recorded whether or not an element was under it: it is
    // where the reviewer was pointing, and a pin drawn at the corner of its
    // element instead is a pin pointing at something else. The anchor is the
    // durable part alongside it - `offset` says where within the element the
    // spot was, so the same spot survives the element moving.
    const position = point(anchor.position);
    const offset = anchor.element ? point(anchor.offset) : null;
    // Which surface the reviewer was looking at, and at what viewport — a note
    // about a layout must never be read against the wrong width.
    const surface = ['prototype', 'app'].includes(anchor.surface) ? anchor.surface : null;
    const vp = anchor.viewport;
    const viewport =
      vp && typeof vp.name === 'string' && Number.isFinite(Number(vp.width))
        ? { name: vp.name, width: Math.round(Number(vp.width)) }
        : null;
    return writes.openThread(blueprint, {
      kind,
      body: text,
      author,
      anchor: {
        ...(anchor.rule && { rule: anchor.rule }),
        ...(screen && { screen }),
        ...(anchor.element && { element: anchor.element }),
        ...(offset && { offset }),
        ...(position && { position }),
        ...(surface && { surface }),
        ...(viewport && { viewport }),
      },
    });
  },

  // The sitting in progress. A draft is not a run: it lives in drafts/, has
  // no run_id, and nothing derives verification from it — it exists so the
  // work behind an unfinished walkdown survives a reload, a second window,
  // or a closed browser, without editing history to get there.
  'GET /api/draft': (blueprint, _req, url) => ({
    draft: readDraft(blueprint.dir, url.searchParams.get('target') ?? 'local'),
  }),

  'POST /api/draft': (blueprint, _req, _url, body) => {
    const { target = 'local', actor = null, started, verdicts, threads = {}, discard } = body ?? {};
    // An emptied session and an explicit discard are the same thing: no
    // draft. Leaving a husk behind would haunt the next sitting.
    if (discard || !verdicts || !Object.keys(verdicts).length) {
      writes.discardDraft(blueprint, target);
      return { draft: null };
    }
    const rulesById = new Map(collectRules(blueprint.features).map(({ rule }) => [rule?.id, rule]));
    for (const [rule, status] of Object.entries(verdicts)) {
      if (!rulesById.has(rule)) throw new Error(`unknown rule "${rule}"`);
      if (!RESULT_STATUSES.includes(status)) throw new Error(`invalid status "${status}"`);
    }
    return { draft: writes.saveDraft(blueprint, { target, actor, started, verdicts, threads }) };
  },

  'POST /api/walkdowns': (blueprint, _req, _url, body) => {
    const { actor, target = 'local', results, roles } = body ?? {};
    if (!actor) throw new Error('actor required');
    /*
     * Validated here rather than shrugged off, because a role nobody
     * recognises is not a harmless label: acceptance is derived by matching
     * these against a rule's `signoff` list, so a typo signs nothing while
     * looking exactly like a signature. An empty list is not an error - it
     * means "none stated", which the ledger reads as engineering's.
     */
    const signedAs = normalizeRoles(roles);
    if (!Array.isArray(results) || !results.length) throw new Error('results required');
    const rulesById = new Map(collectRules(blueprint.features).map(({ rule }) => [rule?.id, rule]));
    const prepared = results.map((r) => {
      if (!rulesById.has(r.rule)) throw new Error(`unknown rule "${r.rule}"`);
      if (!RESULT_STATUSES.includes(r.status)) throw new Error(`invalid status "${r.status}"`);
      const rule = rulesById.get(r.rule);
      return {
        rule: r.rule,
        status: r.status,
        ...(rule.statement &&
          ['pass', 'fail', 'approved'].includes(r.status) && {
            statement_hash: formatHash(rule.statement),
          }),
        ...(r.threads?.length && { threads: r.threads }),
      };
    });
    const record = writes.finishWalkdown(blueprint, {
      target,
      baseUrl: blueprint.config?.runner?.targets?.[target]?.base_url ?? null,
      actor,
      roles: signedAs,
      results: prepared,
    });
    // The roles come back so the panel can say what it actually filed
    // rather than what it hoped to - an emptied list files none.
    return { run_id: record.run_id, roles: record.roles ?? null };
  },
};

/** The two per-thread mutations: POST /api/threads/<id>/(replies|status). */
export function threadAction(blueprint, id, action, body) {
  const thread =
    action === 'replies'
      ? writes.reply(blueprint, id, { author: body.author, body: body.body })
      : writes.transition(blueprint, id, {
          status: body.status,
          actor: body.actor,
          reason: body.reason,
        });
  return { thread };
}
