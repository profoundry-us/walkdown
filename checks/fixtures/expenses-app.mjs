#!/usr/bin/env node
/*
 * An application with sign-in, for the checks of ADR 0017.
 *
 * What a page shows depends on who is signed in, and the only way to be
 * signed in is the dev routes a screen's setup steps drive - which is the
 * whole reason setup steps exist. The example's waitlist has no users, so it
 * cannot stand in for this.
 *
 *   GET  /dev/impersonate?id=N   signs in as N
 *   POST /dev/session            signs in as the form's user_id
 *   POST /dev/broken             answers 500
 *   GET  /dev/slow               a page that never carries nav.signed-in
 *   GET  /expenses/:id           the expense, as whoever is signed in; else the sign-in page
 *   GET  /__log                  every request so far, oldest first; POST /__reset clears it
 *
 * It listens on every port it is given: one process is the `local` target
 * and the `review` target, told apart by the port in the page's own heading.
 */
import { createServer } from 'node:http';

const [wd, ...ports] = process.argv.slice(2);
const log = [];

const page = (title, body, status = 200) => ({
  status,
  body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:2rem}nav{opacity:.6;margin-bottom:1rem}</style></head>
<body>${body}
<script src="${wd}/embed.js" data-walkdown data-bp="expenses"></script></body></html>`,
});

const ROLE = { 14: 'view-only team manager', 31: 'view-only org manager', 77: 'review manager' };
const who = (req) => /(?:^|;\s*)uid=(\d+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
const signedIn = (uid) =>
  `<nav data-testid="nav.signed-in">Signed in as <b data-testid="nav.user">${uid}</b> (${ROLE[uid] ?? 'someone'})</nav>`;

function answer(req, port, form) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const uid = who(req);
  if (url.pathname === '/dev/impersonate') {
    const id = url.searchParams.get('id');
    return { ...page('Signed in', signedIn(id)), cookie: `uid=${id}; Path=/` };
  }
  if (url.pathname === '/dev/session' && req.method === 'POST') {
    const id = form.get('user_id');
    return { ...page('Signed in', signedIn(id)), cookie: `uid=${id}; Path=/` };
  }
  if (url.pathname === '/dev/broken')
    return page('Broken', '<h1 data-testid="app.broken">Something went wrong</h1>', 500);
  if (url.pathname === '/dev/slow') return page('Not yet', '<h1>Still signing in</h1>');
  const expense = /^\/expenses\/(\d+)$/.exec(url.pathname);
  if (expense) {
    if (!uid) return page('Sign in', '<h1 data-testid="app.sign-in">Sign in to Acme Expenses</h1>');
    return page(
      `Expense ${expense[1]}`,
      `${signedIn(uid)}<h1 data-testid="expense.title">Expense ${expense[1]} on :${port}</h1>
       <p data-testid="expense.note">${
         uid === '31'
           ? 'You can view expenses across the organisation.'
           : 'You can view this expense. Approving it needs an approver.'
}</p>`,
    );
  }
  return page('Not found', '<h1>Not found</h1>', 404);
}

for (const port of ports) {
  createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = new URL(req.url, 'http://x').pathname;
      const cors = { 'access-control-allow-origin': '*' };
      if (path === '/__log') {
        res.writeHead(200, { 'content-type': 'application/json', ...cors });
        return res.end(JSON.stringify(log));
      }
      if (path === '/__reset') {
        log.length = 0;
        res.writeHead(204, cors);
        return res.end();
      }
      if (path === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      log.push({
        port: Number(port),
        method: req.method,
        url: req.url,
        // A navigation of a frame, or one of the panel's own probes.
        frame: req.headers['sec-fetch-dest'] === 'iframe',
        uid: who(req),
        form: Object.fromEntries(form),
      });
      const a = answer(req, port, form);
      res.writeHead(a.status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...(a.cookie ? { 'set-cookie': a.cookie } : {}),
      });
      res.end(a.body);
    });
  }).listen(Number(port));
}
