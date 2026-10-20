/*
 * `walkdown threads new --design / --build`: a redline's pair from the
 * terminal, refused on anything that is not a new redline; and a person
 * declining a design request with `threads set --waive --reason`, each on a
 * throwaway machine.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FIXTURES, machine } from '../tools/cli-scenarios.mjs';

const REDLINE = '@rule:threads.lifecycle.redline-is-a-persons';
const ENDINGS = '@rule:threads.lifecycle.reasoned-endings';

const m = machine();
after(() => m.done());
FIXTURES['g2-receipt-drawn'](m);
const where = ['--screen', 'receipt', '--element', 'receipt.total'];
const body = ['--body', 'The total sits under the items.'];
const bp = ['--blueprint', 'checkout'];
const dir = join(m.specOf('checkout'), 'threads');
const count = () => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.yml')).length;
  } catch {
    return 0;
  }
};

test(`a redline filed with only --build prints a dash for the design, as threads show does ${REDLINE}`, () => {
  const r = m.wd([
    'threads',
    'new',
    '--reason',
    'redline',
    ...where,
    ...body,
    '--build',
    'the total under the items',
    ...bp,
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}design {2}—$/m, r.stdout);
  assert.match(r.stdout, /^ {2}build {3}the total under the items$/m, r.stdout);
  const id = r.stdout.match(/n-\d+/)[0];
  const shown = m.wd(['threads', 'show', id, ...bp]).stdout;
  for (const line of r.stdout.split('\n').filter((l) => /^ {2}(design|build) /.test(l)))
    assert.ok(shown.split('\n').includes(line), `threads show prints "${line}" too:\n${shown}`);
  const json = JSON.parse(
    m.wd([
      'threads',
      'new',
      '--reason',
      'redline',
      ...where,
      ...body,
      '--design',
      'beside',
      '--json',
      ...bp,
    ]).stdout,
  );
  assert.equal(json.design, 'beside');
  assert.equal(json.build, undefined);
});

test(`--design and --build on a thread that is not a new redline are refused, and nothing is written ${REDLINE}`, () => {
  const before = count();
  for (const args of [
    ['threads', 'new', ...where, ...body, '--design', 'beside', ...bp],
    ['threads', 'new', '--reason', 'feedback', ...where, ...body, '--build', 'under', ...bp],
    [
      'threads',
      'new',
      '--kind',
      'question',
      ...where,
      '--body',
      'Is the total meant to sit under the items?',
      '--design',
      'beside',
      ...bp,
    ],
  ]) {
    const r = m.wd(args);
    assert.equal(r.status, 2, `${args.join(' ')}\n${r.stdout}`);
    assert.match(r.stderr, /they go with --reason redline\.\nNothing was filed\./, r.stderr);
  }
  assert.equal(count(), before, 'a refused pair leaves no file');
  const r = m.wd(['threads', 'set', 'n-0001', '--waive', '--reason', 'x', '--design', 'y', ...bp]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /go on a new redline.*\nNothing was changed\./, r.stderr);
});

test(`threads new --help says what a redline is and names --design and --build ${REDLINE}`, () => {
  const r = m.wd(['threads', 'new', '--help']);
  const text = `${r.stdout}${r.stderr}`.replace(/\s+/g, ' ');
  assert.match(
    text,
    /--reason redline files a redline: a person's record that the build leaves the design at an element on purpose, filed closed\./,
  );
  assert.match(text, /\[--design <text>\] \[--build <text>\]/);
});

test(`a person declines an open design request with threads set --waive --reason, and the help says so ${ENDINGS}`, () => {
  const d = machine();
  try {
    FIXTURES['g2-undrawn-screens'](d);
    const why = 'The receipt reuses the order page, so it needs no drawing of its own.';
    const r = d.wd(['threads', 'set', 'n-0001', '--waive', '--reason', why, ...bp]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^✓ n-0001 open → waived · by topher · \+1 reply$/m, r.stdout);
    const t = JSON.parse(d.wd(['threads', 'show', 'n-0001', '--json', ...bp]).stdout);
    assert.equal(t.reason, 'request');
    assert.equal(t.status, 'waived');
    assert.equal(t.waived_by, 'topher');
    assert.equal(t.replies.at(-1).body, why);
    const help = `${d.wd(['threads', 'set', '--help']).stdout}`.replace(/\s+/g, ' ');
    assert.match(help, /A person declines a design request with --waive --reason "<why>"\./);
  } finally {
    d.done();
  }
});
