/*
 * ADR 0015 §2 - `walkdown upgrade` moves every blueprint's designs from
 * screens/, drafts/ and proposals/ into a folder per screen of dated
 * versions, on a throwaway machine of its own (tools/cli-scenarios.mjs).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';
import { parse } from '../vendor/yaml.js';

const m = machine();
after(() => m.done());
FIXTURES['g2-old-prototypes'](m);

const threadsOf = (name) => {
  const dir = join(m.specOf(name), 'threads');
  return readdirSync(dir).map((f) => ({
    file: join(dir, f),
    data: parse(readFileSync(join(dir, f), 'utf8')),
  }));
};

/*
 * Three cases g2-old-prototypes leaves out (the ADR 0015 audit, 2026-10-20),
 * added before the upgrade runs: a screen first committed as a near-copy of
 * another file, a CLI screen's redline under `cli/<screen>`, and a request
 * whose `proposes:` already names its draft.
 */
{
  const write = (rel, text) => {
    const f = join(m.shop, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  };
  const commit = (day, change, also = []) => {
    change();
    const at = `${day}T12:00:00-05:00`;
    // Only what this commit drew: payment-notes.html stays out of git.
    for (const args of [
      ['add', '-A', 'prototype', 'proposals/old-idea.html', ...also],
      ['commit', '-q', '-m', `designs ${day}`],
    ]) {
      const r = spawnSync('git', args, {
        cwd: m.shop,
        env: { ...m.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
      });
      if (r.status) throw new Error(`commit on ${day} failed\n${r.stderr}`);
    }
  };
  const long = (title) =>
    `<!doctype html><title>${title}</title>\n${Array.from({ length: 30 }, (_, i) => `<p>line ${i} of a page much like another</p>`).join('\n')}\n`;
  // A sketch, then a coupon screen drawn from it the day the sketch was retired:
  // git's likeness reads the coupon as the sketch renamed.
  commit('2026-09-27', () => write('proposals/old-idea.html', long('old idea')));
  commit('2026-10-08', () => {
    unlinkSync(join(m.shop, 'proposals', 'old-idea.html'));
    write('prototype/screens/coupon.html', long('coupon'));
    write('prototype/drafts/results-wide.html', '<!doctype html><title>wide results</title>\n');
    write('claude-design/screens/art.html', '<!doctype html><title>art</title>\n');
    write('claude-design/README.md', '# Drawn in Claude Design\n');
  }, ['claude-design']);
  // gallery keeps its designs under a root of its own naming, claude-design/.
  m.ok(['blueprints', 'new', 'gallery']);
  const gallery = m.specOf('gallery');
  writeFileSync(
    join(gallery, 'spec.yml'),
    `${readFileSync(join(gallery, 'spec.yml'), 'utf8')}\nprototype:\n  root: claude-design/\n`,
  );
  writeFileSync(
    join(gallery, 'storyboard.yml'),
    'screens:\n  - id: art\n    title: art\n    prototype: /screens/art.html\n    app: { path: /art }\n',
  );
  // On search, which the lint below never reads, so they need no rules.
  const board = join(m.specOf('search'), 'storyboard.yml');
  writeFileSync(
    board,
    `${readFileSync(board, 'utf8')}  - id: coupon\n    title: coupon\n    prototype: /screens/coupon.html\n    app: { path: /coupon }\n  - id: help\n    title: help\n    prototype: null\n    app: { path: /as-built/cli/help.html }\n`,
  );
  const redlines = join(m.shop, 'as-built', 'redlines.json');
  writeFileSync(
    redlines,
    `${JSON.stringify(
      {
        ...JSON.parse(readFileSync(redlines, 'utf8')),
        'cli/help': { title: 'help', redlines: ['The build prints the commands in two columns.'] },
      },
      null,
      2,
    )}\n`,
  );
  // A request on results that names its draft the way CLAUDE.md step 3 says to.
  m.ok([
    'threads',
    'new',
    '--screen',
    'results',
    '--body',
    'Draw the results wider.',
    '--blueprint',
    'search',
  ]);
  const req = threadsOf('search').find((t) => t.data.reason === 'request');
  writeFileSync(
    req.file,
    `${readFileSync(req.file, 'utf8').replace(/\n*$/, '\n')}proposes: /drafts/results-wide.html\n`,
  );
}

/* The [upgrade] warnings `walkdown lint` prints, one blueprint each. */
const oldLayoutWarnings = () =>
  `${m.wd(['lint', '--no-checks']).stdout}`.split('\n').filter((l) => l.includes('⚠ [upgrade]'));

test('before the upgrade, lint warns once on each blueprint on the old layout @rule:locations.keeping.old-layout-warns', () => {
  const lines = oldLayoutWarnings();
  assert.deepEqual(
    lines.map((l) => l.match(/\] (\w+)\/spec\.yml/)?.[1]).sort(),
    ['checkout', 'gallery', 'search'],
    lines.join('\n'),
  );
  for (const l of lines) assert.match(l, /`walkdown upgrade --dry-run`.*then `walkdown upgrade`/);
});

test('the dry run moves nothing @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const r = m.wd(['upgrade', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(m.shop, 'prototype', 'screens', 'cart.html')));
  assert.ok(!existsSync(join(m.shop, 'designs')));
  assert.ok(existsSync(join(m.shop, 'as-built', 'redlines.json')));
});

test('a screen is dated by its own first commit, never by a near-copy git follows it to @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const r = m.wd(['upgrade', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /prototype\/screens\/coupon\.html +becomes designs\/coupon\/20261008\.html/,
  );
  assert.doesNotMatch(r.stdout, /designs\/coupon\/20260927/);
});

test('upgrade moves each design into a dated version of its screen, and repoints the records @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const before = readFileSync(join(m.specOf('checkout'), 'storyboard.yml'), 'utf8');
  const r = m.wd(['upgrade']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = (...p) => join(m.shop, 'designs', ...p);

  // Accepted versions, dated by first commit; a same-day proposal is -v2.
  for (const f of [
    'cart/20260918.html',
    'payment/20260918.html',
    'receipt/20260921.html',
    'results/20260925.html',
  ])
    assert.ok(existsSync(d(f)), f);
  assert.ok(existsSync(d('receipt', '20260921-v2.html')));
  assert.ok(existsSync(d('shipping', '20261006.html')));

  // The storyboard: design keys, pointed at the accepted versions, nothing else touched.
  const board = readFileSync(join(m.specOf('checkout'), 'storyboard.yml'), 'utf8');
  assert.match(board, /^ {4}design: \/cart\/20260918\.html$/m);
  assert.match(board, /^ {4}design: null$/m);
  assert.doesNotMatch(board, /prototype:/);
  assert.equal(board.replace(/design: \S+/g, ''), before.replace(/prototype: \S+/g, ''));

  // spec.yml: the root renamed.
  const spec = parse(readFileSync(join(m.specOf('checkout'), 'spec.yml'), 'utf8'));
  assert.equal(spec.design?.root, 'designs/');
  assert.equal(spec.prototype, undefined);

  // Each pending request names its proposed version.
  const requests = threadsOf('checkout').filter((t) => t.data.reason === 'request');
  assert.deepEqual(requests.map((t) => [t.data.anchor.screen, t.data.proposes]).sort(), [
    ['receipt', '/receipt/20260921-v2.html'],
    ['shipping', '/shipping/20261006.html'],
  ]);

  // Leftovers: removed if git holds them, kept and named if not.
  assert.ok(!existsSync(join(m.shop, 'prototype')));
  assert.ok(!existsSync(join(m.shop, 'proposals', 'payment-sketch.html')));
  assert.ok(existsSync(join(m.shop, 'proposals', 'payment-notes.html')));
  assert.match(r.stdout, /! proposals\/payment-notes\.html KEPT/);

  // Redlines: closed threads in the person's name, and the file gone.
  const redlines = threadsOf('checkout').filter((t) => t.data.reason === 'redline');
  assert.deepEqual(redlines.map((t) => t.data.anchor.screen).sort(), ['cart', 'receipt']);
  for (const t of redlines) {
    assert.equal(t.data.status, 'recorded');
    assert.equal(t.data.author, 'topher');
  }
  assert.equal(
    redlines.find((t) => t.data.anchor.screen === 'cart').data.anchor.element,
    'cart.total',
  );
  assert.ok(!existsSync(join(m.shop, 'as-built', 'redlines.json')));

  // The panel's reading of it: accepted beside proposed, both served from designs/.
  const status = m.wd(['lint', '--no-checks', '--blueprint', 'checkout']);
  assert.doesNotMatch(status.stdout, /✗/, status.stdout);
});

test('a root the blueprint named itself keeps its place, and only the spec key is renamed @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const d = (...p) => join(m.shop, 'claude-design', ...p);
  assert.ok(existsSync(d('art', '20261008.html')));
  assert.ok(!existsSync(d('screens')));
  assert.ok(existsSync(d('README.md')));
  assert.ok(!existsSync(join(m.shop, 'designs', 'art')));
  const spec = parse(readFileSync(join(m.specOf('gallery'), 'spec.yml'), 'utf8'));
  assert.equal(spec.design?.root, 'claude-design/');
  assert.equal(spec.prototype, undefined);
  assert.match(
    readFileSync(join(m.specOf('gallery'), 'storyboard.yml'), 'utf8'),
    /^ {4}design: \/art\/20261008\.html$/m,
  );
});

test('a CLI screen redline, kept under cli/<screen>, becomes a thread on that screen @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const redlines = threadsOf('search').filter((t) => t.data.reason === 'redline');
  assert.deepEqual(
    redlines.map((t) => t.data.anchor.screen),
    ['help'],
  );
  assert.ok(!existsSync(join(m.shop, 'as-built', 'redlines.json')));
});

test('a draft a request already names by proposes: becomes its proposed version, and proposes: follows it @rule:locations.keeping.upgrade-moves-prototypes', () => {
  assert.ok(existsSync(join(m.shop, 'designs', 'results', '20261008.html')));
  const req = threadsOf('search').find((t) => t.data.reason === 'request');
  assert.equal(req.data.proposes, '/results/20261008.html');
  assert.equal((readFileSync(req.file, 'utf8').match(/^proposes:/gm) ?? []).length, 1);
});

test('run again, the upgrade finds nothing to do @rule:locations.keeping.upgrade-moves-prototypes', () => {
  const r = m.wd(['upgrade']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nothing to upgrade/);
});

test('after the upgrade, lint no longer warns of the old layout @rule:locations.keeping.old-layout-warns', () => {
  assert.deepEqual(oldLayoutWarnings(), []);
});
