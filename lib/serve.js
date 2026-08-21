import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { stringify } from 'yaml';
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
 * The Walkdown local server: viewer UI, embed script, blueprint API, and the
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

  const handlers = {
    'GET /api/blueprint': (blueprint, _req, _url) => {
      const { targets, rows } = deriveStatus(blueprint);
      const config = blueprint.config ?? {};
      return {
        project: config.project ?? 'walkdown',
        targets,
        rows,
        storyboard: blueprint.storyboard?.screens ?? [],
        threads: blueprint.threads.map((t) => t.data).filter((t) => t?.id),
        anchorAttr: config.embed?.anchor_attribute ?? 'data-testid',
        appBase: config.runner?.targets?.local?.base_url ?? null,
        hasPrototype: Boolean(config.prototype?.root),
      };
    },

    'POST /api/threads': (blueprint, _req, _url, body) => {
      const { kind = 'note', body: text, anchor = {}, author, url } = body ?? {};
      if (!['note', 'question'].includes(kind)) throw new Error('kind must be note|question');
      if (!text || typeof text !== 'string') throw new Error('body text required');
      const screen = anchor.screen ?? (url ? screenForUrl(blueprint, url) : null);
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
    const blueprint = loadBlueprint(blueprintDir); // reload per request: files are the truth

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
