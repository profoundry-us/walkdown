#!/usr/bin/env node
/*
 * The app side of every `cli` screen, drawn from a real run (ADR 0013 §7).
 *
 * Each scenario in test/cli/scenarios/ is one moment at a terminal. This runs
 * it - the same run test/cli.test.js checks - and writes what the command
 * printed, steadied, into a terminal frame at as-built/cli/<screen>.html.
 * The storyboard's app paths point there, so the fade shows the output the
 * design agent drew (prototype-cli/screens/) against the output as built.
 *
 * Every anchor a scenario declares becomes a block with that `data-testid`
 * around the lines its pattern matched, so a rule can name the line it is
 * about, a pin sits on it, and the agent tier compares text by anchor. The
 * prompt and the exit code are anchors on every screen: `cli.prompt` and
 * `cli.exit`.
 *
 *   node tools/cli-captures.mjs                 every screen
 *   node tools/cli-captures.mjs init-another    one
 *   node tools/cli-captures.mjs --frame         print the frame's CSS, for the design side
 *
 * The redlines - where the build left the design - are prose in
 * as-built/redlines.json under `cli/<screen>`, kept across recaptures.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { placeAnchors, run, scenarios } from './cli-scenarios.mjs';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const OUT = join(ROOT, 'as-built', 'cli');

/*
 * The frame, shared with the design side word for word: the design agent's
 * pages carry this same block, so the two line up under the fade and only
 * the text differs. Change it here and hand it over with `--frame`.
 */
const FRAME_CSS = `
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #14161a; }
  .term { box-sizing: border-box; min-height: 100%; padding: 18px 22px 28px;
    font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #d7dae0; tab-size: 12; }
  .term-bar { display: flex; align-items: center; gap: 7px; margin: 0 0 14px; color: #7d8590; font-size: 11.5px; }
  .term-bar i { width: 10px; height: 10px; border-radius: 50%; background: #3a3f47; display: inline-block; }
  .term-bar span { margin-left: 8px; }
  .ln { white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.55em; }
  .prompt { color: #8fbcff; }
  .prompt b { color: #7d8590; font-weight: 400; }
  .exit { margin-top: 10px; color: #7d8590; }
  .exit.bad { color: #f0a36b; }
  [data-testid] { border-radius: 3px; }
`;

const AS_BUILT_CSS = `
  .as-built-ring { position: fixed; inset: 4px; z-index: 10; pointer-events: none;
    border: 2px solid oklch(72% 0.17 25); border-radius: 10px; }
  .as-built-label { position: fixed; left: 0; bottom: 0; z-index: 11; pointer-events: none;
    padding: 3px 10px; font: 700 10.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .08em; text-transform: uppercase; color: oklch(22% 0.045 25);
    background: oklch(72% 0.17 25); border-top-right-radius: 6px; }
  .as-built-notes { position: fixed; right: 12px; bottom: 12px; z-index: 11; width: 320px; max-height: 50vh; overflow-y: auto;
    padding: 10px 12px; border: 1px dashed oklch(72% 0.17 25); border-radius: 6px;
    background: oklch(26% 0.042 25 / .96); color: oklch(93% 0.015 40);
    font: 11.5px/1.5 system-ui, sans-serif; }
  .as-built-notes summary { cursor: pointer; font-weight: 700; color: oklch(78% 0.15 30); letter-spacing: .04em; }
  .as-built-notes ul { margin: 6px 0 0; padding-left: 16px; }
  .as-built-notes li { margin: 4px 0; }
`;

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const shellWord = (w) => (/^[\w./:@=+-]+$/.test(w) ? w : `"${w.replaceAll('"', '\\"')}"`);

/* What is typed at the prompt: the walkdown command, or `tree` or `cat` for a screen that shows a folder or a file. */
const typed = (scenario) =>
  scenario.cat
    ? `cat ${scenario.cat.replace(/^shop\//, '')}`
    : scenario.tree
      ? `tree -a ${scenario.tree.replace(/^shop\//, '')}`
      : `walkdown ${scenario.command.map(shellWord).join(' ')}`;

/** The terminal's body: prompt, the output with its anchors, the exit code. */
function terminal(scenario, out) {
  const lines = out.text ? out.text.split('\n') : [];
  const placed = placeAnchors(lines, scenario.anchors);
  const opens = new Map([...placed].map(([id, at]) => [at.from, id]));
  const closes = new Set([...placed.values()].map((at) => at.to));
  const body = [];
  lines.forEach((line, i) => {
    if (opens.has(i)) body.push(`      <div data-testid="${opens.get(i)}">`);
    body.push(`      <div class="ln">${esc(line)}</div>`);
    if (closes.has(i)) body.push('      </div>');
  });
  // The folder the command ran in, as the scenario's cwd says (default ~/shop).
  const at =
    scenario.cwd === '.'
      ? '~'
      : scenario.cwd
        ? `~/${scenario.cwd.replace(/^home(?=\/|$)/, '.walkdown')}`
        : '~/shop';
  return [
    `    <div class="term-bar"><i></i><i></i><i></i><span>${esc(at)}</span></div>`,
    `    <div class="ln prompt" data-testid="cli.prompt"><b>${esc(at)} $</b> ${esc(typed(scenario))}</div>`,
    ...body,
    `    <div class="ln exit${out.status ? ' bad' : ''}" data-testid="cli.exit">[exit ${out.status}]</div>`,
  ].join('\n');
}

function page(scenario, out, redlines) {
  const notes = redlines?.redlines?.length
    ? `\n  <details class="as-built-notes" open><summary>Redlines</summary><ul>\n${redlines.redlines.map((r) => `    <li>${r}</li>`).join('\n')}\n  </ul></details>`
    : '';
  return `<!doctype html>
<!--
  AS-BUILT: ${scenario.screen}

  What \`${typed(scenario)}\` printed, run by tools/cli-captures.mjs
  from test/cli/scenarios/${scenario.file} - the same run test/cli.test.js
  checks against ${scenario.rule}. Paths, times and hashes are made steady so
  the fade shows what changed and nothing else. Regenerated, never edited: the
  redlines live in as-built/redlines.json under "cli/${scenario.screen}".

  The design is prototype-cli/screens/${scenario.screen}.html. Nothing here is
  evidence; a verdict given against this page is a verdict about a drawing of
  the build.
-->
<html lang="en" data-theme="redline">
<head>
  <meta charset="utf-8">
  <title>As-built &mdash; ${esc(scenario.title)}</title>
  <style>${FRAME_CSS}${AS_BUILT_CSS}</style>
</head>
<body>
  <div class="term">
${terminal(scenario, out)}
  </div>
  <div class="as-built-ring"></div>
  <div class="as-built-label">As-built</div>${notes}
</body>
</html>
`;
}

const args = process.argv.slice(2);
if (args.includes('--frame')) {
  process.stdout.write(FRAME_CSS.trimStart());
  process.exit(0);
}
const redlinesFile = join(ROOT, 'as-built', 'redlines.json');
const redlines = existsSync(redlinesFile) ? JSON.parse(readFileSync(redlinesFile, 'utf8')) : {};
const all = scenarios();
const want = args.filter((a) => !a.startsWith('--'));
const unknown = want.filter((w) => !all.some((s) => s.screen === w));
if (unknown.length) {
  console.error(
    `no scenario draws ${unknown.join(', ')} — the screens are ${all.map((s) => s.screen).join(', ')}`,
  );
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const s of all.filter((x) => !want.length || want.includes(x.screen))) {
  const out = run(s);
  const missing = (s.anchors ?? [])
    .map((a) => a.id)
    .filter((id) => !placeAnchors(out.text.split('\n'), s.anchors).has(id));
  const wrongExit = out.status !== s.exit;
  writeFileSync(join(OUT, `${s.screen}.html`), page(s, out, redlines[`cli/${s.screen}`]));
  const warn = [
    wrongExit && `exit ${out.status}, the scenario says ${s.exit}`,
    missing.length && `no line for ${missing.join(', ')}`,
  ].filter(Boolean);
  if (warn.length) failed++;
  console.log(
    `${warn.length ? '!' : '✓'} as-built/cli/${s.screen}.html${warn.length ? `  — ${warn.join('; ')}` : ''}`,
  );
}
// Drawn either way - a picture of a broken run is still the build - but said.
process.exit(failed ? 1 : 0);
