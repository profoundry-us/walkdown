/*
 * Small pictures of screens, for the storyboard view (n-0095).
 *
 * The board first drew every screen as a live frame scaled down. Seven pages
 * rendering inside the page that reviews them wreaked havoc on the host's
 * CSS and everything around it (Topher, 2026-09-21), so the board shows
 * pictures instead: each screen is photographed once, by a real browser, and
 * the picture is kept until somebody asks for it again.
 *
 * The cache is a CACHE and lives like one: under the machine's temp
 * directory, never in the project or its home, because a picture of a page
 * is not a record and `ownership.writes.spec-never-implementation` is about
 * records. Losing it costs one redraw.
 *
 * The browser is Playwright's, found at run time: walkdown's checks already
 * need it, and a tree without it gets a plain sentence rather than a
 * storyboard of broken pictures.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CACHE_DIR = join(tmpdir(), 'walkdown-screens');
export const VIEWPORT = { width: 1280, height: 800 };

/** The address a page landed on when it is not the one asked for, ignoring the fragment; null when it stayed. */
export function elsewhere(asked, landed) {
  try {
    const a = new URL(asked);
    const b = new URL(landed);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search ? null : b.href;
  } catch {
    return null;
  }
}

/** Where a page's picture is kept: one file per address, named by its hash. */
export const pictureFile = (url) => join(CACHE_DIR, `${createHash('sha256').update(url).digest('hex').slice(0, 24)}.png`);

/*
 * Looked for twice: beside walkdown, which a development tree has, and in the
 * project being served, which a clone never has but most projects do. The
 * clone is the install and brings no node_modules (walkdown-setup), so a
 * storyboard that looked only beside walkdown could never draw on the
 * machines it is set up on (dry run, 2026-09-23).
 */
const found = new Map();
/** Where Playwright is looked for, in order: beside walkdown, then the project's own node_modules. */
export function candidates(projectRoot = null) {
  const here = [];
  if (projectRoot) {
    const req = createRequire(join(projectRoot, 'package.json'));
    for (const pkg of ['playwright', '@playwright/test'])
      try {
        here.push(pathToFileURL(req.resolve(pkg)).href);
      } catch {
        /* the project has no such package */
      }
  }
  return ['playwright', '@playwright/test', ...here];
}
/** Playwright's chromium, from walkdown's own tree or the project's, or null when neither has it. */
export function chromium(projectRoot = null) {
  const key = projectRoot ?? '';
  if (!found.has(key))
    found.set(
      key,
      (async () => {
        for (const spec of candidates(projectRoot)) {
          try {
            const mod = await import(spec);
            const cr = mod.chromium ?? mod.default?.chromium;
            if (cr) return cr;
          } catch {
            /* not here; try the next */
          }
        }
        return null;
      })(),
    );
  return found.get(key);
}

/*
 * One browser, one page at a time. The board asks for every screen at once,
 * and seven browsers launching together is the havoc this file exists to
 * end. The browser is put away a little after the last picture, so a serve
 * that drew a storyboard an hour ago is not holding a Chromium open.
 */
let browser = null;
let idle = null;
let queue = Promise.resolve();
const IDLE_MS = 30_000;
async function withBrowser(fn, projectRoot) {
  const cr = await chromium(projectRoot);
  if (!cr) throw new Error('no browser: add @playwright/test to this project (npm i -D @playwright/test && npx playwright install chromium) to draw the storyboard');
  clearTimeout(idle);
  browser ??= await cr.launch();
  try {
    return await fn(browser);
  } finally {
    idle = setTimeout(() => {
      const b = browser;
      browser = null;
      b?.close().catch(() => {});
    }, IDLE_MS);
    idle.unref?.();
  }
}

/** Put the browser away now rather than after the idle wait - for a process that is ending. */
export async function closeBrowser() {
  clearTimeout(idle);
  const b = browser;
  browser = null;
  await b?.close().catch(() => {});
}

/**
 * The picture of a page: from the cache when it is there, photographed when
 * it is not or when `refresh` says to. Answers the file's path and whether
 * it was a hit.
 */
export function pictureOf(url, { refresh = false, projectRoot = null } = {}) {
  const file = pictureFile(url);
  const note = `${file}.json`;
  const said = () => {
    try {
      return JSON.parse(readFileSync(note, 'utf8'));
    } catch {
      return {};
    }
  };
  if (!refresh && existsSync(file)) return Promise.resolve({ file, hit: true, landed: said().landed ?? null });
  const take = () =>
    withBrowser(async (b) => {
      const page = await b.newPage({ viewport: VIEWPORT });
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 15_000 }));
        mkdirSync(CACHE_DIR, { recursive: true });
        await page.screenshot({ path: file, type: 'png' });
        /*
         * Where the page actually ended up. This browser carries none of the
         * person's cookies, so an app behind a sign-in answers every address
         * with its login page - and a board of identical login pictures,
         * each titled as a different screen, says something false. A
         * picture that landed elsewhere says where (2026-09-23).
         */
        const landed = elsewhere(url, page.url());
        writeFileSync(note, JSON.stringify({ landed }));
        return { file, hit: false, landed };
      } finally {
        await page.close().catch(() => {});
      }
    }, projectRoot);
  // Serialised: the queue survives a failure so the next picture still gets taken.
  const mine = queue.then(take, take);
  queue = mine.catch(() => {});
  return mine;
}
