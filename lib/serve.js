import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { handlers, threadAction } from './api.js';
import { listedBlueprints, loadBlueprint } from './blueprint.js';
import { blueprintForUrl } from './claims.js';
import { resolveLocations } from './locations.js';
import { splitScreenRef } from './screen-match.js';

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

/*
 * Where walkdown opens when nobody has said where to look: the storyboard's
 * default screen, on the app surface if it has one and otherwise its design.
 * The same order the panel's own fade control falls back through, so the front
 * door and the surface controls agree about where "the front" is.
 */
function frontDoor(blueprint) {
  const screens = blueprint.storyboard?.screens ?? [];
  const wanted = blueprint.storyboard?.default_screen;
  const screen =
    screens.find((s) => s.id === wanted) ?? screens.find((s) => s.app?.path || s.prototype);
  if (!screen) return null;
  const appBase = blueprint.config?.runner?.targets?.local?.base_url;
  if (screen.app?.path && appBase) return appBase + screen.app.path;
  if (screen.prototype && blueprint.config?.prototype?.root) return '/prototype' + screen.prototype;
  return null;
}

function asStandIn(html) {
  // A design may be a whole document or a fragment; either way it comes back
  // themed and marked. A stand-in that forgot to say so would be the one
  // failure mode that matters.
  if (!/<html\b/i.test(html))
    return `<!doctype html>\n<html data-theme="emerald">\n<head>\n<meta charset="utf-8">${
      STAND_IN_HEAD
    }\n</head>\n<body>\n${html}\n${STAND_IN_MARK}\n</body>\n</html>\n`;
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

/**
 * The walkdown local server: the review page, the panel and embed scripts, the
 * blueprint API, and the write paths for pins (threads) and human walkdown
 * sessions (run records).
 * Binds 127.0.0.1 only. Writes are restricted to threads/ and runs/.
 */
/**
 * @param {string} blueprintDir the blueprint served by default
 * @param {{ cwd?: string }} [from] where the server was started - the
 *   `.walkdown` that answers THERE is the scope of everything it offers
 */
export function createWalkdownServer(blueprintDir, { cwd = process.cwd() } = {}) {
  /*
   * Where this machine keeps evidence, resolved once. A location is a question
   * about configuration and the working tree, and neither changes between
   * requests - re-asking it per screenshot would be a filesystem walk per
   * image for an answer that cannot have moved.
   */
  const evidenceRoot = (() => {
    try {
      /*
       * Standing up the server claims the home. The server is a write
       * surface - threads, drafts, runs - and ownership.writes says a
       * browser request may write to those three resolved directories and
       * NOWHERE else, which includes the registry's allocation index. So a
       * fresh project's tentative home is made real here, by the person
       * starting the server, and no request ever has an allocation to do.
       */
      return resolveLocations({ spec: blueprintDir }).evidence.path;
    } catch {
      return null; // a broken personal config must not stop the server serving
    }
  })();

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
    // Multi-project: ?bp=<id> selects a declared blueprint. Selection is by
    // membership in the declared set — never a raw path.
    const baseRoot = dirname(resolve(blueprintDir));
    /*
     * The blueprints somebody wrote down, not the ones a walk of the tree
     * turned up. Ids are the config entry's, so `?bp=example` is the same
     * string on every machine (n-0133).
     *
     * Written down WHERE THE SERVER WAS STARTED. Listing from the served
     * blueprint's parent instead re-derived the answering `.walkdown` from
     * wherever that blueprint sat, so a server started at a repository's root
     * over a spec declared inside a pack offered the pack's whole list,
     * served it, wrote to it, and refused the root's own project (n-0159).
     * One `.walkdown` answers for a place, and the place is the cwd.
     */
    const projects = listedBlueprints({ cwd });
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
    blueprint.root = baseRoot.startsWith(homedir())
      ? '~' + baseRoot.slice(homedir().length)
      : baseRoot;
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
          const loaded = projects.map((p) => ({
            id: p.id,
            dir: p.dir,
            blueprint: loadBlueprint(p.dir),
          }));
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
      const onThread = url.pathname.match(/^\/api\/threads\/([^/]+)\/(replies|status)$/);
      if (req.method === 'POST' && onThread) {
        const body = JSON.parse((await readBody(req)) || '{}');
        const [, id, action] = onThread;
        return sendJson(res, 200, threadAction(blueprint, id, action, body));
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
      /*
       * walkdown's own page: the panel, with the blueprint's front door framed
       * inside it. Served rather than vendored so the copy always matches the
       * server, and baked with the address to open because the page cannot
       * work out the front door before the panel it is about to load has read
       * the blueprint.
       */
      if (req.method === 'GET' && url.pathname === '/') {
        const html = readFileSync(join(VIEWER_DIR, 'review.html'), 'utf8')
          .replace('__FRONT_DOOR__', frontDoor(blueprint) ?? '')
          .replace('__BLUEPRINT__', blueprint.projects.find((p) => p.current)?.id ?? '');
        res.writeHead(200, { 'content-type': MIME['.html'] });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/embed.js') {
        const src = readFileSync(join(VIEWER_DIR, 'embed.js'), 'utf8').replace(
          '__ANCHOR_ATTR__',
          blueprint.config?.embed?.anchor_attribute ?? 'data-testid',
        );
        res.writeHead(200, { 'content-type': MIME['.js'] });
        return res.end(src);
      }
      // The one stylesheet: Tailwind + daisyUI, built ahead of time and shipped
      // in the package. The panel pulls it into its shadow root; prototypes and
      // example apps borrow it from here too.
      if (req.method === 'GET' && url.pathname === '/walkdown.css')
        return serveFile(res, join(VIEWER_DIR, 'walkdown.css'));
      // The docked panel — walkdown's chrome beside a real app, no framing.
      if (req.method === 'GET' && url.pathname === '/panel.js') {
        res.writeHead(200, { 'content-type': MIME['.js'] });
        return res.end(readFileSync(join(VIEWER_DIR, 'panel.js'), 'utf8'));
      }
      /*
       * The screenshots a run attached.
       *
       * The ledger records these as "runs/evidence/<run>/<shot>.png", and that
       * stays a LOGICAL key rather than a filesystem path: a run record says
       * which evidence it left, never which disk somebody filed it on. So the
       * key is resolved here - against this machine's evidence root first, and
       * against the blueprint folder second, which is where every record
       * written before evidence was relocatable still points.
       *
       * That is what lets 97MB of screenshots leave a repository without
       * editing a single run record, which the ledger's append-only law would
       * not have allowed anyway (docs/08-locations.md).
       *
       * Nothing outside those two roots is servable: a count of pictures is
       * not evidence until they can be looked at, and everything else on this
       * disk is nobody's business.
       */
      if (req.method === 'GET' && url.pathname.startsWith('/evidence/')) {
        const rel = normalize(decodeURIComponent(url.pathname.slice('/evidence/'.length))).replace(
          /^(\.\.[/\\])+/,
          '',
        );
        if (!rel.startsWith('runs/evidence/')) {
          res.writeHead(404);
          return res.end('not found');
        }
        const tail = rel.slice('runs/evidence/'.length);
        const inRepo = join(blueprint.dir, rel);
        const configured = evidenceRoot ? join(evidenceRoot, tail) : null;
        const found = [configured, inRepo].find((p) => p && existsSync(p));
        return serveFile(res, found ?? inRepo);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/proposals/')) {
        const rel = normalize(url.pathname.slice('/proposals/'.length)).replace(
          /^(\.\.[/\\])+/,
          '',
        );
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
        const rel = normalize(url.pathname.slice('/prototype/'.length)).replace(
          /^(\.\.[/\\])+/,
          '',
        );
        return serveFile(res, join(rootDir, rel));
      }
      res.writeHead(404);
      res.end('not found');
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
}

/** @param {string} blueprintDir @param {{ port?: number, cwd?: string }} [opts] */
export function startServe(blueprintDir, { port, cwd } = {}) {
  const blueprint = loadBlueprint(blueprintDir);
  const chosenPort = port ?? blueprint.config?.embed?.port ?? 4700;
  const server = createWalkdownServer(blueprintDir, { cwd });
  return new Promise((resolvePromise) => {
    server.listen(chosenPort, '127.0.0.1', () =>
      resolvePromise({
        server,
        port: /** @type {import('node:net').AddressInfo} */ (server.address()).port,
      }),
    );
  });
}
