/*
 * The install, checked from the outside.
 *
 * A clone with no node_modules is the claim, and the way to break it is
 * ordinary: somebody adds an import, npm installs the package, every test
 * passes on the machine that has it, and the tool stops working for everyone
 * who cloned it. So this reads the package manifest and the source rather
 * than trusting that today's suite would have noticed.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from '../tools/test-home.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Every .js/.mjs file walkdown SHIPS - what package.json's `files` covers. */
function shipped(dir, out = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) shipped(rel, out);
    else if (/\.m?js$/.test(e.name)) out.push(rel);
  }
  return out;
}

test('nothing walkdown ships at runtime resolves outside itself @rule:delivery.install.clone-is-the-install', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(
    pkg.dependencies,
    undefined,
    'a runtime dependency is a package registry on the critical path',
  );
  assert.ok(pkg.files.includes('vendor'), 'and the vendored library has to be published too');

  /*
   * Bare specifiers, excluding node: builtins. `yaml` is the one that used to
   * be here; it is now vendor/yaml.js, imported by a relative path like
   * everything else.
   */
  const offenders = [];
  for (const file of [...shipped('lib'), ...shipped('bin'), ...shipped('vendor')]) {
    for (const [, spec] of read(file).matchAll(
      /^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm,
    ))
      if (!spec.startsWith('.') && !spec.startsWith('node:')) offenders.push(`${file} → ${spec}`);
  }
  assert.deepEqual(offenders, [], 'these would need installing before walkdown could run');
});

test('the third-party code it carries is attributed and machine-built @rule:delivery.install.clone-is-the-install', () => {
  assert.ok(existsSync(join(root, 'vendor', 'LICENSE')), "yaml's own licence, verbatim");
  const bundle = read('vendor/yaml.js');
  assert.match(bundle, /vendored into walkdown, not hand-written/);
  assert.match(bundle, /npm run build:yaml/, 'the header says how to reproduce it');
  // And it is genuinely the library, not a stub that happens to satisfy imports.
  assert.ok(statSync(join(root, 'vendor', 'yaml.js')).size > 100_000);
  // Every licence file the vendor README names is there, and tracked: one
  // named and never committed left DOMPurify's terms out of every clone (n-0558).
  const named = [...read('vendor/README.md').matchAll(/`(LICENSE[\w-]*)`/g)].map((m) => m[1]);
  assert.ok(named.includes('LICENSE-dompurify'), named.join(', '));
  const tracked = spawnSync('git', ['ls-files', 'vendor'], { cwd: root, encoding: 'utf8' }).stdout;
  for (const f of new Set(named))
    assert.match(tracked, new RegExp(`^vendor/${f}$`, 'm'), `vendor/${f} is committed`);
  assert.match(read('vendor/LICENSE-dompurify'), /Apache License[\s\S]*Mozilla Public License/);
});

/*
 * The claim itself, exercised the only way that proves it: copy out what a
 * clone would carry, leave node_modules behind, and run it. Reading the
 * manifest (above) says nobody has ADDED a dependency; only this says the tool
 * actually runs without one - Node resolves node_modules by walking parent
 * directories, so a test run inside this repository would find them however
 * hard it tried not to.
 */
test('the CLI runs from a tree with no node_modules @rule:delivery.install.clone-is-the-install', () => {
  const away = mkdtempSync(join(tmpdir(), 'wd-bare-'));
  try {
    for (const d of ['bin', 'lib', 'vendor'])
      cpSync(join(root, d), join(away, d), { recursive: true });
    cpSync(join(root, 'package.json'), join(away, 'package.json'));
    assert.equal(existsSync(join(away, 'node_modules')), false);
    // This repository's own blueprints, registered in the suite's home the
    // way `walkdown import .` would put them there (ADR 0003). Both: since
    // ADR 0013 the suite tags rules of each, and lint reads the project.
    for (const [id, home] of [
      ['walkdown', '0001-walkdown'],
      ['cli', '0002-cli'],
    ])
      register({
        id,
        project: root.replace(/\/$/, ''),
        homeDir: join(root, '.walkdown', 'blueprints', home),
      });

    const out = execFileSync(
      process.execPath,
      [join(away, 'bin', 'walkdown.js'), 'lint', '--blueprint', 'walkdown'],
      { cwd: root },
    ).toString();
    assert.match(
      out,
      /rules, \d+ screens/,
      "it parsed walkdown's own blueprint with nothing installed",
    );
  } finally {
    rmSync(away, { recursive: true, force: true });
  }
});
