/*
 * Where `prototype.root` is (#17): beside the spec first, in the code second.
 */
import '../tools/test-home.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { prototypeDir } from '../lib/blueprint.js';

const root = mkdtempSync(join(tmpdir(), 'walkdown-proto-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('a relative prototype root beside the spec answers before the code, and the code answers otherwise (#17) @rule:locations.default.prototype-beside-the-spec', () => {
  const code = join(root, 'app');
  const home = join(root, 'home', '0001-app');
  const spec = join(home, 'blueprint');
  mkdirSync(join(code, 'prototype'), { recursive: true });
  mkdirSync(spec, { recursive: true });
  const bp = { dir: spec, codeRoot: code, config: { prototype: { root: 'prototype/' } } };

  // Nothing beside the spec: the code's prototype/, as walkdown's own blueprint keeps it.
  assert.equal(prototypeDir(bp), join(code, 'prototype'));

  // A home outside the repository keeps its design beside the spec, and that wins.
  mkdirSync(join(spec, 'prototype'), { recursive: true });
  assert.equal(prototypeDir(bp), join(spec, 'prototype'));

  // No root declared, no directory.
  assert.equal(prototypeDir({ ...bp, config: {} }), null);
});

test('the design pages, the stand-ins and the storyboard picture all read the one helper @rule:locations.default.prototype-beside-the-spec', async () => {
  const { readFileSync } = await import('node:fs');
  const serve = readFileSync(new URL('../lib/serve.js', import.meta.url), 'utf8');
  // Both routes that read files ask the helper; nothing resolves the root by hand.
  assert.equal(serve.match(/prototypeDir\(blueprint\)/g)?.length, 2);
  assert.doesNotMatch(serve, /resolve\([^)]*prototype\?\.root/);
});
