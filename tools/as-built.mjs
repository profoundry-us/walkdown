#!/usr/bin/env node
/*
 * Redraw the as-built screens from the running panel (ADR 0007).
 *
 * prototype/ is the design as drawn and never edited. as-built/ is a drawing
 * of the panel as built - the panel's own markup, captured from a live serve,
 * flattened out of its shadow root, and wrapped in the `redline` theme with a
 * ring, a label and a Redlines note saying where the build left the design.
 * The storyboard's app paths point at it, so it is what the App side of the
 * fade shows. When a screen changes shape, run this and commit what it wrote.
 *
 *   node tools/as-built.mjs                 every screen, against a serve it starts
 *   node tools/as-built.mjs rule-detail     one screen
 *   node tools/as-built.mjs --port 4700     against a serve already running
 *
 * The states are data: the list below is what to edit when the panel grows a
 * screen. The redlines live in as-built/redlines.json, one list per screen,
 * because they are prose somebody wrote and a recapture must not lose them.
 * The two retired screens (docked, unclaimed-page) are written by hand and
 * this tool leaves them alone.
 *
 * Nothing here writes to the ledger. The panel is driven read-only - opened,
 * clicked between tabs, a rule and a thread opened - against this working
 * tree's own blueprint; no verdict, pin or reply is ever posted.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'as-built');
const BP = join(ROOT, '.walkdown/blueprints/0001-walkdown/blueprint');
const REDLINES = JSON.parse(readFileSync(join(OUT, 'redlines.json'), 'utf8'));

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const PORT = portAt >= 0 ? Number(args[portAt + 1]) : 4732;
const only = args.filter((a, i) => !a.startsWith('--') && i !== portAt + 1);

/* ---- the states --------------------------------------------------------- */

// `sr` runs a function against the panel's shadow root; `fn` waits for one to
// return something truthy; `wait` is milliseconds.
const STATES = {
  review: { steps: [] },
  'rule-detail': {
    steps: [
      ['fn', `r => r.querySelector('[data-rule="panel.walkdown.pass-verifies-feedback"]')`],
      ['sr', `r => r.querySelector('[data-rule="panel.walkdown.pass-verifies-feedback"]').click()`],
      ['wait', 1500],
    ],
  },
  'thread-panel': {
    steps: [
      ['sr', `r => r.querySelector('[data-tab="threads"]').click()`],
      ['wait', 400],
      ['sr', `r => r.querySelector('[data-tfilter="all"]').click()`],
      ['wait', 400],
      ['sr', `r => (r.querySelector('[data-open-thread="n-0297"]') ?? r.querySelector('.wd-row[data-open-thread]')).click()`],
      ['wait', 1500],
    ],
  },
  settings: {
    steps: [['sr', `r => r.querySelector('#wdp-desk-btn').click()`], ['wait', 800]],
  },
  // The gate itself rises only for a project holding several blueprints; the
  // Blueprints tab draws the same rows with the same anchors.
  'choose-blueprint': {
    steps: [['sr', `r => r.querySelector('[data-tab="blueprints"]').click()`], ['wait', 600]],
  },
  // The extension's shape with a server that answers nothing: first run.
  start: { host: { srv: 'http://localhost:1' }, steps: [['wait', 3000]] },
  // And a page no blueprint claims: which project?
  'project-modal': { host: { frame: '/nothing-declares-this' }, steps: [['wait', 3000]] },
};

/* ---- the capture, in the page --------------------------------------------- */

/*
 * Trim the live panel to a drawing's worth of data, then flatten every shadow
 * root into light DOM. Styles are dropped (the page links /walkdown.css) except
 * the conversation's own rules, which ride with the panel's sheet and are
 * returned separately.
 */
const FLATTEN = `(() => {
  const roots = [document, ...[...document.querySelectorAll('*')].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
  const q = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
  const trim = (parent, keep) => { if (!parent) return; while (parent.children.length > keep) parent.lastElementChild.remove(); };
  // Rules: the first screen group, up to the second screen head.
  for (const list of q('[data-testid="panel.list-scroll"]')) {
    const kids = [...list.children];
    const second = kids.findIndex((k, i) => i > 0 && k.dataset.testid === 'panel.rules-screen');
    for (const k of kids.slice(second > 0 ? Math.min(second, 22) : 22)) k.remove();
  }
  for (const pane of q('[data-testid="panel.threads-list"]')) trim(pane, 6);
  for (const body of q('[data-testid="thread.body"], [data-testid="detail.stream"]')) trim(body, 8);
  for (const dd of q('[data-testid="ref.preview"]')) dd.remove();
  // The panes the track holds off-screen: a drawing of one view is one view.
  // Emptied and un-anchored, so a hidden thread.panel never doubles the embed's.
  for (const track of q('.wdp-track')) {
    const at = Math.round(Math.abs(parseFloat((track.style.transform.match(/-?[\\d.]+/) ?? ['0'])[0])) / 33.3333);
    [...track.children].forEach((pane, i) => { if (i !== at) { pane.replaceChildren(); pane.removeAttribute('data-testid'); } });
  }
  const clone = document.documentElement.cloneNode(true);
  const walk = (src, dst) => {
    if (src.shadowRoot) {
      const kids = [];
      for (const c of src.shadowRoot.children) if (c.tagName !== 'STYLE' && c.tagName !== 'LINK') kids.push(c.cloneNode(true));
      dst.replaceChildren(...kids);
      return;
    }
    const sc = [...src.children], dc = [...dst.children];
    for (let i = 0; i < sc.length; i++) if (dc[i]) walk(sc[i], dc[i]);
  };
  walk(document.documentElement, clone);
  for (const s of clone.querySelectorAll('script, style, link[rel=stylesheet], [data-testid="host.title"]')) s.remove();
  return clone.outerHTML;
})()`;

const STREAM_CSS = `(async () => {
  const base = await (await fetch('/walkdown.css')).text();
  const r = [...document.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot;
  const sheet = [...r.querySelectorAll('style')].find((s) => s.textContent.startsWith(base.slice(0, 200)));
  return sheet ? sheet.textContent.slice(base.length) : '';
})()`;

const inRoot = (fn) =>
  `(() => { const r = [...document.querySelectorAll('[data-walkdown-chrome]')].find((e) => e.shadowRoot).shadowRoot; return (${fn})(r); })()`;

/* ---- the wrap ------------------------------------------------------------- */

const MARK_CSS = `
  /* The as-built's own marks. Baked into the page rather than injected by the
     server, because this is a file somebody keeps - not a trick. */
  .as-built-ring { position: fixed; inset: 0; z-index: 10; pointer-events: none;
    border: 2px solid oklch(72% 0.17 25); }
  .as-built-label { position: fixed; left: 0; bottom: 0; z-index: 11; pointer-events: none;
    padding: 3px 10px; font: 700 10.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .08em; text-transform: uppercase; color: oklch(22% 0.045 25);
    background: oklch(72% 0.17 25); border-top-right-radius: 6px; }
  .as-built-notes { position: fixed; left: 12px; bottom: 34px; z-index: 11; width: 320px; max-height: 60vh; overflow-y: auto;
    padding: 10px 12px; border: 1px dashed oklch(72% 0.17 25); border-radius: 6px;
    background: oklch(26% 0.042 25 / .96); color: oklch(93% 0.015 40); font-size: 11.5px; line-height: 1.5; }
  .as-built-notes summary { cursor: pointer; font-weight: 700; color: oklch(78% 0.15 30); letter-spacing: .04em; }
  .as-built-notes ul { margin: 6px 0 0; padding-left: 16px; }
  .as-built-notes li { margin: 4px 0; }
  .as-built-notes li + li { border-top: 1px dotted oklch(41% 0.05 25); padding-top: 4px; }
`;

const BLOCK = new Set(
  'html head body div header aside section main nav p ul ol li h1 h2 h3 h4 h5 h6 button textarea table thead tbody tr details summary dialog form label pre iframe svg hr input select dl dt dd meta link title style script'.split(
    ' ',
  ),
);
const VOID = new Set('br img input meta link hr path circle line rect polyline polygon source wbr'.split(' '));

/*
 * A pretty-printer for one purpose: a line per block so the page can be read
 * and hand-edited. Inline elements stay on their line, a whitespace-only run
 * between two of them stays a space (or "BECAUSE" runs into its text), and
 * a textarea is left exactly as wide as its contents - which is nothing, so
 * its placeholder shows. Comments are dropped: lit's markers, nothing a
 * drawing needs.
 */
function pretty(html) {
  const out = [];
  let depth = 0;
  let pre = 0;
  const nl = () => {
    if (pre) return;
    if (out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
    out.push('  '.repeat(depth));
  };
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+/g;
  for (const m of html.matchAll(re)) {
    const [tok, close, open, , self] = m;
    if (tok.startsWith('<!--')) continue;
    if (open) {
      const t = open.toLowerCase();
      if (BLOCK.has(t)) nl();
      out.push(tok);
      if (t === 'pre' || t === 'textarea') pre += 1;
      if (!VOID.has(t) && !self) depth += 1;
    } else if (close) {
      const t = close.toLowerCase();
      if (VOID.has(t)) continue;
      depth = Math.max(0, depth - 1);
      if (t === 'pre' || t === 'textarea') {
        pre -= 1;
        out.push(tok);
        continue;
      }
      const last = out.slice(-3).join('');
      if (BLOCK.has(t) && /<\/?[a-zA-Z0-9-]+[^>]*>\s*$/.test(last) && BLOCK.has((last.match(/<\/?([a-zA-Z0-9-]+)[^>]*>\s*$/) ?? [])[1]?.toLowerCase()))
        nl();
      out.push(tok);
    } else {
      if (pre) {
        if (tok.trim()) out.push(tok);
        continue;
      }
      if (!tok.trim()) {
        const prev = out[out.length - 1] ?? '';
        if (prev && !prev.endsWith('\n') && !prev.endsWith(' ')) out.push(' ');
        continue;
      }
      out.push(tok);
    }
  }
  return out.join('');
}

const PLACEHOLDER = (style) => `<div data-testid="panel.app-frame" title="the application under review" class="grid place-items-center text-center text-[12px] leading-relaxed" style="${style}; color: oklch(50% 0.03 25)">
  <div>THE APP &mdash; the page under review, framed at the chosen viewport.<br>The as-built cannot frame a page: this box stands where the frame stands.</div>
</div>`;

function wrap(id, raw, streamCss) {
  const n = REDLINES[id];
  if (!n) throw new Error(`as-built/redlines.json has no entry for ${id}`);
  let html = raw
    .replace(/^<html[^>]*>/, '<html lang="en" data-theme="redline">')
    .replace(/data-theme="blueprint"/g, 'data-theme="redline"')
    // The panel marks its own chrome so the embed never pins on it. On a
    // drawing, the chrome IS the thing to pin on.
    .replace(/\s*data-walkdown-chrome(="[^"]*")?/g, '')
    .replace(/\s*data-walkdown-panel(="[^"]*")?/g, '')
    // The panel floats over a page at the top of the stack; a drawing of it
    // is the page, and the embed's pins must float over IT.
    .replace(/z-index: 2147483000;/g, 'z-index: 1;')
    .replace(/<head>[\s\S]*?<\/head>/, '')
    .replace(/<body[^>]*>/, '<body>')
    // Whatever port this ran against, the drawing names the declared one.
    .replace(/localhost:\d+/g, 'localhost:4700');
  // The frame: a box, not a page.
  const frame = html.match(/<iframe\b[^>]*style="([^"]*)"[^>]*>\s*<\/iframe>/);
  if (frame)
    html = html.replace(
      frame[0],
      PLACEHOLDER(frame[1].replace('background: rgb(255, 255, 255)', 'background: oklch(97% 0.01 40)')),
    );
  const stream = html.includes('wd-msg')
    ? `\n<!-- The conversation's own rules, as the panel carries them (lib/message-stream.js MSG.css). -->\n<style>${streamCss.trim()}</style>`
    : '';
  const head = `<head>
<meta charset="utf-8">
<title>As-built &mdash; walkdown ${n.title}</title>
<link rel="stylesheet" href="/walkdown.css">
<style>${MARK_CSS}</style>${stream}
</head>`;
  html = html.replace('<html lang="en" data-theme="redline">', `<html lang="en" data-theme="redline">\n${head}`);
  const marks = `
  <div class="as-built-ring" aria-hidden="true"></div>
  <div class="as-built-label" aria-hidden="true">as-built &mdash; a drawing of the build, redlined after the fact</div>
  <details class="as-built-notes" open>
    <summary>Redlines &mdash; where the build left the design</summary>
    <ul>
${n.redlines.map((x) => `      <li>${x}</li>`).join('\n')}
    </ul>
  </details>
  <script src="/embed.js" data-walkdown></script>
</body>`;
  html = html.replace('</body>', marks);
  const today = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<!--
  AS-BUILT: ${n.title}

  A drawing of walkdown's panel as it was actually built - the panel's own
  markup, captured from the running build by tools/as-built.mjs on ${today}
  and kept by hand since (ADR 0007). It is neither the design
  (prototype/screens/${id}.html, which stays as it was drawn) nor the build
  (the panel you are holding, which cannot frame itself). It exists so the
  App side of the fade has something true to show, and so the distance
  between what was designed and what was built is visible on the slider.

  Nothing here is evidence. A verdict given against this page is a verdict
  about a drawing of the build.
-->
${pretty(html)}
`;
}

/* ---- the run -------------------------------------------------------------- */

/*
 * The extension's host page, served from here so the two states the framed
 * page cannot reach - no server, no claim - can be. The same shape as
 * checks/fixtures/extension.html, without the fixture's knobs.
 */
function hostPage(wd, { srv, frame }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><script>
window.__walkdownConfig = {
  server: ${JSON.stringify(srv ?? wd)},
  reinjects: true,
  frame: { url: ${JSON.stringify(frame ?? `${wd}/as-built/review.html`)} },
};
const s = document.createElement('script'); s.src = ${JSON.stringify(`${wd}/panel.js`)}; s.setAttribute('data-bp', 'blueprint');
document.body.appendChild(s);
</script></body></html>`;
}

async function main() {
  const wd = `http://localhost:${PORT}`;
  let serve = null;
  if (portAt < 0) {
    serve = spawn('node', [join(ROOT, 'bin/walkdown.js'), 'serve', '--port', String(PORT)], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${wd}/api/blueprint`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const host = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html');
    res.end(
      hostPage(wd, {
        srv: u.searchParams.get('srv') ?? undefined,
        frame: u.searchParams.get('frame') ? wd + u.searchParams.get('frame') : undefined,
      }),
    );
  });
  await new Promise((r) => host.listen(0, r));
  const hostAt = `http://localhost:${host.address().port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  let streamCss = '';
  mkdirSync(OUT, { recursive: true });
  try {
    for (const [id, st] of Object.entries(STATES)) {
      if (only.length && !only.includes(id)) continue;
      process.stdout.write(`${id} `);
      const url = st.host
        ? `${hostAt}/?${new URLSearchParams(st.host)}`
        : `${wd}/?bp=${encodeURIComponent(BP)}#${encodeURIComponent(`${wd}/as-built/review.html`)}`;
      // Through blank first: the same address with a different hash is a
      // hash navigation, and the pruned panel from the last state would be
      // what this one captures.
      await page.goto('about:blank');
      await page.goto(url);
      await page.waitForTimeout(2500);
      for (const [k, v] of st.steps) {
        if (k === 'wait') await page.waitForTimeout(v);
        else if (k === 'fn') await page.waitForFunction(inRoot(v), null, { timeout: 15000 });
        else if (k === 'sr') await page.evaluate(inRoot(v));
      }
      if (!st.host) streamCss = (await page.evaluate(STREAM_CSS)) || streamCss;
      const raw = await page.evaluate(FLATTEN);
      writeFileSync(join(OUT, `${id}.html`), wrap(id, raw, streamCss));
      console.log('written');
    }
  } finally {
    await browser.close();
    host.close();
    serve?.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
