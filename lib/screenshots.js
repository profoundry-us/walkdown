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
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CACHE_DIR = join(tmpdir(), 'walkdown-screens');
export const VIEWPORT = { width: 1280, height: 800 };

/** Where a page's picture is kept: one file per address, named by its hash. */
export const pictureFile = (url) => join(CACHE_DIR, `${createHash('sha256').update(url).digest('hex').slice(0, 24)}.png`);

let chromiumPromise = null;
/** Playwright's chromium, whichever package brings it, or null when neither is installed. */
export function chromium() {
  chromiumPromise ??= (async () => {
    for (const pkg of ['playwright', '@playwright/test']) {
      try {
        const mod = await import(pkg);
        if (mod.chromium) return mod.chromium;
      } catch {
        /* not here; try the next */
      }
    }
    return null;
  })();
  return chromiumPromise;
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
async function withBrowser(fn) {
  const cr = await chromium();
  if (!cr) throw new Error('no browser: install @playwright/test (or playwright) to draw the storyboard');
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

/**
 * The picture of a page: from the cache when it is there, photographed when
 * it is not or when `refresh` says to. Answers the file's path and whether
 * it was a hit.
 */
export function pictureOf(url, { refresh = false } = {}) {
  const file = pictureFile(url);
  if (!refresh && existsSync(file)) return Promise.resolve({ file, hit: true });
  const take = () =>
    withBrowser(async (b) => {
      const page = await b.newPage({ viewport: VIEWPORT });
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 15_000 }));
        mkdirSync(CACHE_DIR, { recursive: true });
        await page.screenshot({ path: file, type: 'png' });
      } finally {
        await page.close().catch(() => {});
      }
      return { file, hit: false };
    });
  // Serialised: the queue survives a failure so the next picture still gets taken.
  const mine = queue.then(take, take);
  queue = mine.catch(() => {});
  return mine;
}
