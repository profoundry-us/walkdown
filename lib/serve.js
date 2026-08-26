import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { loadBlueprint, collectRules } from './blueprint.js';
import { clearDraft, readDraft, writeDraft } from './draft.js';
import { formatHash } from './hash.js';
import { writeRunRecord } from './run-record.js';
import { locationOfUrl, matchScreen, splitScreenRef } from './screen-match.js';
import { checkedRuleIds } from './checks.js';
import { blueprintForUrl } from './claims.js';
import { deriveStatus } from './status.js';
import { replyToThread, transitionThread } from './threads.js';

const VIEWER_DIR = new URL('./viewer/', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const RUN_STATUSES = ['pass', 'fail', 'skipped', 'blocked', 'approved', 'refining'];

/*
 * A mockup dressed as the running app: a different theme (emerald — the skin
 * the example app wears, so it reads as neither walkdown's blue chrome nor a
 * wireframe), solid edges where the mockup drew dashed ones, and a corner mark
 * that never lets it pass for the real build. Nothing else is touched: the
 * anchors, the embed tag, and the markup stay exactly as designed, which is
 * what makes pins and the ghost line up between the two surfaces.
 */
const STAND_IN_HEAD = `
<style id="walkdown-stand-in-style">
  /* Built, not drawn — the mockup's dashed "designed" edges go solid. */
  .wire { border-style: solid; }
  #walkdown-stand-in, #walkdown-stand-in-ring {
    position: fixed; z-index: 2147483646; pointer-events: none;
  }
  /* A green ring around the whole surface: whatever the design happens to look
     like, the stand-in is never in doubt at a glance. */
  #walkdown-stand-in-ring { inset: 0; border: 2px solid oklch(70% 0.16 160); }
  #walkdown-stand-in {
    right: 0; bottom: 0;
    padding: 2px 8px; font: 600 10px/1.6 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: .06em; text-transform: uppercase;
    color: #fff; background: oklch(55% 0.14 160); border-top-left-radius: 4px;
  }
</style>`;
const STAND_IN_MARK =
  '<div id="walkdown-stand-in-ring"></div>' +
  '<div id="walkdown-stand-in">stand-in app — the design, served as the app</div>';

function asStandIn(html) {
  // A design may be a whole document or a fragment; either way it comes back
  // themed and marked. A stand-in that forgot to say so would be the one
  // failure mode that matters.
  if (!/<html\b/i.test(html))
    return `<!doctype html>\n<html data-theme="emerald">\n<head>\n<meta charset="utf-8">${
      STAND_IN_HEAD}\n</head>\n<body>\n${html}\n${STAND_IN_MARK}\n</body>\n</html>\n`;
  const themed = /<html[^>]*\sdata-theme="/i.test(html)
    ? html.replace(/(<html[^>]*\sdata-theme=")[^"]*(")/i, '$1emerald$2')
    : html.replace(/<html\b/i, '<html data-theme="emerald"');
  const headed = themed.includes('</head>')
    ? themed.replace('</head>', `${STAND_IN_HEAD}\n</head>`)
    : STAND_IN_HEAD + themed;
  return /<\/body>/i.test(headed)
    ? headed.replace(/<\/body>/i, `${STAND_IN_MARK}\n</body>`)
    : headed + STAND_IN_MARK;
}

/** Next thread id: n-0001 / q-0001 style, scanning existing thread files. */
function nextThreadId(blueprintDir, kind) {
  const dir = join(blueprintDir, 'threads');
  const prefix = kind === 'question' ? 'q' : 'n';
  let max = 0;
  if (existsSync(dir))
    for (const f of readdirSync(dir)) {
      const m = f.match(/^[nq]-(\d+)/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * Who is working here: the repository's git identity, falling back to the OS
 * username — the same order the CLI and run records already use, so the viewer
 * stops asking for a name the machine already knows.
 */
export function defaultActor(cwd) {
  try {
    const name = spawnSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8' });
    const trimmed = name.status === 0 ? name.stdout.trim() : '';
    if (trimmed) return { actor: trimmed, source: 'git' };
  } catch {
    // git missing or not a repo — fall through to the OS
  }
  return { actor: userInfo().username, source: 'os' };
}

/**
 * Find every blueprint under `baseRoot` (dirs containing walkdown.yml), so one
 * server can host sibling projects — e.g. a repo's own blueprint plus its
 * example's. Skips node_modules and dotdirs; ids are baseRoot-relative paths.
 */
export function discoverBlueprints(baseRoot) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Fixtures are inputs to the test suite, not projects anyone reviews —
      // offering one in the picker is noise at best and a wrong turn at worst.
      const skip = ['node_modules', 'fixture', 'fixtures', '__fixtures__'];
      if (!entry.isDirectory() || skip.includes(entry.name) || entry.name.startsWith('.')) continue;
      const child = join(dir, entry.name);
      if (existsSync(join(child, 'walkdown.yml'))) found.push(child);
      else walk(child, depth + 1);
    }
  };
  walk(baseRoot, 0);
  return found.map((dir) => {
    let name = null, description = null;
    try {
      const cfg = parse(readFileSync(join(dir, 'walkdown.yml'), 'utf8'));
      name = cfg?.project ?? null;
      description = cfg?.description ?? null;
    } catch { /* unnamed */ }
    return { id: relative(baseRoot, dir), dir, name: name ?? relative(baseRoot, dir), description };
  });
}

/**
 * The walkdown local server: viewer UI, embed script, blueprint API, and the
 * write paths for pins (threads) and human walkdown sessions (run records).
 * Binds 127.0.0.1 only. Writes are restricted to threads/ and runs/.
 */
export function createWalkdownServer(blueprintDir) {
  const cors = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    // Private Network Access: lets HTTPS staging pages POST to this localhost server.
    if (req.headers['access-control-request-private-network'])
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
  };
  const sendJson = (res, code, data) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const readBody = (req) =>
    new Promise((resolvePromise, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) reject(new Error('body too large'));
      });
      req.on('end', () => resolvePromise(body));
      req.on('error', reject);
    });

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
      if (/^\s*(test|it|describe|context|RSpec\.describe)\s*[('"]/.test(lines[i])) {
        end = i;
        break;
      }
    }
    while (end > start && !lines[end - 1].trim()) end--;
    return { ref, startLine: start + 1, source: lines.slice(start, end).join('\n') };
  };

  const handlers = {
    'GET /api/blueprint': (blueprint, _req, _url) => {
      const { targets, rows, drift, attention } = deriveStatus(blueprint, {
        checkRefs: checkedRuleIds(blueprint.config, blueprint.projectRoot),
      });
      const config = blueprint.config ?? {};
      return {
        project: config.project ?? 'walkdown',
        // What this server currently ships as the panel. The extension's
        // vendored copy hashes itself the same way; a mismatch means the
        // extension is running yesterday's walkdown and should say so.
        panelHash: createHash('sha256')
          .update(readFileSync(join(VIEWER_DIR, 'panel.js')))
          .digest('hex').slice(0, 12),
        projects: blueprint.projects,
        root: blueprint.root,
        targets,
        rows,
        drift,
        attention,
        storyboard: blueprint.storyboard?.screens ?? [],
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
        identity: defaultActor(blueprint.projectRoot),
      };
    },

    'GET /api/checks': (blueprint, _req, url) => {
      const ruleId = url.searchParams.get('rule');
      const { targets, rows } = deriveStatus(blueprint, {
        checkRefs: checkedRuleIds(blueprint.config, blueprint.projectRoot),
      });
      const row = rows.find((r) => r.rule === ruleId);
      if (!row) throw new Error(`unknown rule "${ruleId}"`);
      const refs = [...new Set(targets.flatMap((t) => row.cells[t]?.checks ?? []))];
      return {
        rule: ruleId,
        checks: refs.map((ref) => checkSnippet(blueprint.projectRoot, ref)).filter(Boolean),
      };
    },

    'POST /api/threads': (blueprint, _req, _url, body) => {
      const { kind = 'note', body: text, anchor = {}, author, url } = body ?? {};
      if (!['note', 'question'].includes(kind)) throw new Error('kind must be note|question');
      if (!text || typeof text !== 'string') throw new Error('body text required');
      const screen = anchor.screen ?? (url ? screenForUrl(blueprint, url) : null);
      // Fallback targeting: a pin with no anchored element under it keeps its
      // place by position, so feedback is never blocked by a missing anchor.
      // Positions are in the SURFACE's own CSS-pixel space, never the viewer's
      // screen pixels, so a pin holds its spot across zoom and pane changes.
      const point = (p) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
        ? { x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) } : null);
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
      const viewport = vp && typeof vp.name === 'string' && Number.isFinite(Number(vp.width))
        ? { name: vp.name, width: Math.round(Number(vp.width)) }
        : null;
      const id = nextThreadId(blueprint.dir, kind);
      const thread = {
        id,
        kind,
        author: author || userInfo().username,
        created: isoNow(),
        anchor: {
          ...(anchor.rule && { rule: anchor.rule }),
          ...(screen && { screen }),
          ...(anchor.element && { element: anchor.element }),
          ...(offset && { offset }),
          ...(position && { position }),
          ...(surface && { surface }),
          ...(viewport && { viewport }),
        },
        status: 'open',
        body: text,
      };
      writeFileSync(join(blueprint.dir, 'threads', `${id}.yml`), stringify(thread));
      return { id, thread };
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
        clearDraft(blueprint.dir, target);
        return { draft: null };
      }
      const rulesById = new Map(collectRules(blueprint.features).map(({ rule }) => [rule?.id, rule]));
      for (const [rule, status] of Object.entries(verdicts)) {
        if (!rulesById.has(rule)) throw new Error(`unknown rule "${rule}"`);
        if (!RUN_STATUSES.includes(status)) throw new Error(`invalid status "${status}"`);
      }
      return { draft: writeDraft(blueprint.dir, { target, actor, started, verdicts, threads }) };
    },

    'POST /api/walkdowns': (blueprint, _req, _url, body) => {
      const { actor, target = 'local', results } = body ?? {};
      if (!actor) throw new Error('actor required');
      if (!Array.isArray(results) || !results.length) throw new Error('results required');
      const rulesById = new Map(collectRules(blueprint.features).map(({ rule }) => [rule?.id, rule]));
      const prepared = results.map((r) => {
        if (!rulesById.has(r.rule)) throw new Error(`unknown rule "${r.rule}"`);
        if (!RUN_STATUSES.includes(r.status)) throw new Error(`invalid status "${r.status}"`);
        const rule = rulesById.get(r.rule);
        return {
          rule: r.rule,
          status: r.status,
          ...(rule.statement && ['pass', 'fail', 'approved'].includes(r.status) && {
            statement_hash: formatHash(rule.statement),
          }),
          ...(r.threads?.length && { threads: r.threads }),
        };
      });
      const { record } = writeRunRecord({
        blueprintDir: blueprint.dir,
        target,
        baseUrl: blueprint.config?.runner?.targets?.[target]?.base_url ?? null,
        actor,
        kind: 'walkdown',
        results: prepared,
      });
      // Sealed: the sitting is history now, so its draft stops existing. One
      // write, one delete — never both shapes of the same session on disk.
      clearDraft(blueprint.dir, target);
      return { run_id: record.run_id };
    },
  };

  const serveFile = (res, path) => {
    if (!existsSync(path)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(readFileSync(path));
  };

  return createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    // Multi-project: ?bp=<id> selects a discovered sibling blueprint. Selection
    // is by membership in the discovered set — never a raw path.
    const baseRoot = dirname(resolve(blueprintDir));
    const projects = discoverBlueprints(baseRoot);
    const requested = url.searchParams.get('bp');
    let selectedDir = resolve(blueprintDir);
    if (requested) {
      const match = projects.find((p) => p.id === requested);
      if (!match) return sendJson(res, 404, { error: `unknown project "${requested}"` });
      selectedDir = match.dir;
    }
    const blueprint = loadBlueprint(selectedDir); // reload per request: files are the truth
    // The folder this server is serving. The panel asks for an address, and
    // this is how it can still answer "which folder is that?" — the question
    // a person actually has.
    blueprint.root = baseRoot.startsWith(homedir()) ? '~' + baseRoot.slice(homedir().length) : baseRoot;
    blueprint.projects = projects.map((p) => ({
      id: p.id,
      name: p.name,
      // What this blueprint covers, so a picker can say more than a file name.
      description: p.description,
      current: p.dir === selectedDir,
    }));

    try {
      const key = `${req.method} ${url.pathname}`;
      if (handlers[key]) {
        const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : null;
        /*
         * A pin belongs to the project whose page it was placed on, not to
         * whichever blueprint this server happens to serve by default. An
         * embed on a page nobody edited cannot name its project - there is no
         * script tag to carry one - so the address it reports is the only
         * thing that can, and the claims index turns that into an answer.
         *
         * Only when the caller did not say: an explicit ?bp= is a decision
         * already made, and this must never override it.
         */
        let target = blueprint;
        if (key === 'POST /api/threads' && !requested && body?.url) {
          const loaded = projects.map((p) => ({ id: p.id, dir: p.dir, blueprint: loadBlueprint(p.dir) }));
          const whose = blueprintForUrl(loaded, body.url);
          const owner = whose && loaded.find((p) => p.id === whose.id);
          if (owner && owner.dir !== selectedDir) {
            target = owner.blueprint;
            target.root = blueprint.root;
            target.projects = blueprint.projects;
          }
        }
        return sendJson(res, 200, handlers[key](target, req, url, body));
      }
      const threadAction = url.pathname.match(/^\/api\/threads\/([^/]+)\/(replies|status)$/);
      if (req.method === 'POST' && threadAction) {
        const body = JSON.parse((await readBody(req)) || '{}');
        const [, id, action] = threadAction;
        const thread =
          action === 'replies'
            ? replyToThread(blueprint, id, { author: body.author || userInfo().username, body: body.body })
            : transitionThread(blueprint, id, { status: body.status, actor: body.actor, reason: body.reason });
        return sendJson(res, 200, { thread });
      }
      /*
       * Whose page is this? The panel asks before falling back to whatever was
       * chosen last, because a remembered choice is about the person and this
       * question is about the page. Answered from the claims index rather than
       * by loading every blueprint's rules - with dozens in a repo, routing has
       * to be cheap (q-0019).
       */
      if (req.method === 'GET' && url.pathname === '/api/whose') {
        const asked = url.searchParams.get('url');
        if (!asked) return sendJson(res, 400, { error: 'url required' });
        const loaded = projects.map((p) => ({ id: p.id, blueprint: loadBlueprint(p.dir) }));
        return sendJson(res, 200, { url: asked, match: blueprintForUrl(loaded, asked) });
      }
      if (req.method === 'GET' && url.pathname === '/') return serveFile(res, join(VIEWER_DIR, 'index.html'));
      if (req.method === 'GET' && url.pathname === '/embed.js') {
        const src = readFileSync(join(VIEWER_DIR, 'embed.js'), 'utf8').replace(
          '__ANCHOR_ATTR__',
          blueprint.config?.embed?.anchor_attribute ?? 'data-testid'
        );
        res.writeHead(200, { 'content-type': MIME['.js'] });
        return res.end(src);
      }
      // The one stylesheet: Tailwind + daisyUI, built ahead of time and shipped
      // in the package. The viewer links it; the panel pulls it into its shadow
      // root; prototypes and example apps borrow it from here too.
      if (req.method === 'GET' && url.pathname === '/walkdown.css')
        return serveFile(res, join(VIEWER_DIR, 'walkdown.css'));
      // The docked panel — walkdown's chrome beside a real app, no framing.
      if (req.method === 'GET' && url.pathname === '/panel.js') {
        res.writeHead(200, { 'content-type': MIME['.js'] });
        return res.end(readFileSync(join(VIEWER_DIR, 'panel.js'), 'utf8'));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/proposals/')) {
        const rel = normalize(url.pathname.slice('/proposals/'.length)).replace(/^(\.\.[/\\])+/, '');
        return serveFile(res, join(blueprint.projectRoot, 'proposals', rel));
      }
      /*
       * The stand-in app.
       *
       * Some projects have no page to point the App surface at — walkdown's own
       * screens are the clearest case: the running walkdown is the panel you
       * are holding, not a URL. That left the App side empty, and with it every
       * comparison feature: no fade, no ghost, and no way to pin a note *on the
       * app*. A stand-in serves the screen's own design back as the app,
       * wearing a different theme and saying so on its face, so the machinery
       * works while nobody can mistake it for the build.
       *
       * It is emphatically not evidence: what it shows is the design, so a
       * verdict given against it is a verdict about the design.
       */
      if (req.method === 'GET' && url.pathname.startsWith('/stand-in/')) {
        const id = decodeURIComponent(url.pathname.slice('/stand-in/'.length));
        const screen = (blueprint.storyboard?.screens ?? []).find((s) => s.id === id);
        const ref = screen?.prototype ? splitScreenRef(screen.prototype) : null;
        const root = blueprint.config?.prototype?.root;
        if (!ref || !root) {
          res.writeHead(404);
          return res.end(`no stand-in for screen "${id}" — it has no prototype`);
        }
        const rel = normalize(ref.path).replace(/^(\.\.[/\\])+/, '');
        const file = join(resolve(blueprint.projectRoot, root), rel);
        if (!existsSync(file)) {
          res.writeHead(404);
          return res.end('not found');
        }
        res.writeHead(200, { 'content-type': MIME['.html'] });
        return res.end(asStandIn(readFileSync(file, 'utf8')));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/prototype/')) {
        const root = blueprint.config?.prototype?.root;
        if (!root) {
          res.writeHead(404);
          return res.end('no prototype root configured');
        }
        const rootDir = resolve(blueprint.projectRoot, root);
        const rel = normalize(url.pathname.slice('/prototype/'.length)).replace(/^(\.\.[/\\])+/, '');
        return serveFile(res, join(rootDir, rel));
      }
      res.writeHead(404);
      res.end('not found');
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
}

export function startServe(blueprintDir, { port } = {}) {
  const blueprint = loadBlueprint(blueprintDir);
  const chosenPort = port ?? blueprint.config?.embed?.port ?? 4700;
  const server = createWalkdownServer(blueprintDir);
  return new Promise((resolvePromise) => {
    server.listen(chosenPort, '127.0.0.1', () => resolvePromise({ server, port: server.address().port }));
  });
}
