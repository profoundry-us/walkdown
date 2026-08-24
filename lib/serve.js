import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { loadBlueprint, collectRules } from './blueprint.js';
import { formatHash } from './hash.js';
import { writeRunRecord } from './run-record.js';
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

const RUN_STATUSES = ['pass', 'fail', 'skipped', 'blocked'];

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

  /** Resolve a page URL (from a standalone embed) to a storyboard screen id. */
  const screenForUrl = (blueprint, url) => {
    let path;
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
    for (const s of blueprint.storyboard?.screens ?? []) {
      if (s?.app?.path && (path === s.app.path || path.endsWith(s.app.path))) return s.id;
      if (s?.prototype && path.endsWith(s.prototype)) return s.id;
    }
    return null;
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
      const { targets, rows, drift, attention } = deriveStatus(blueprint);
      const config = blueprint.config ?? {};
      return {
        project: config.project ?? 'walkdown',
        projects: blueprint.projects,
        root: blueprint.root,
        targets,
        rows,
        drift,
        attention,
        storyboard: blueprint.storyboard?.screens ?? [],
        threads: blueprint.threads.map((t) => t.data).filter((t) => t?.id),
        anchorAttr: config.embed?.anchor_attribute ?? 'data-testid',
        appBase: config.runner?.targets?.local?.base_url ?? null,
        hasPrototype: Boolean(config.prototype?.root),
        identity: defaultActor(blueprint.projectRoot),
      };
    },

    'GET /api/checks': (blueprint, _req, url) => {
      const ruleId = url.searchParams.get('rule');
      const { targets, rows } = deriveStatus(blueprint);
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
      const pos = anchor.position;
      const position = !anchor.element && pos && Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.y))
        ? { x: Math.round(Number(pos.x)), y: Math.round(Number(pos.y)) }
        : null;
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
          ...(rule.statement && ['pass', 'fail'].includes(r.status) && {
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
        return sendJson(res, 200, handlers[key](blueprint, req, url, body));
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
