#!/usr/bin/env node
/*
 * Record the hash of every skill copy walkdown has released, so the installer
 * can tell a copy an earlier walkdown left from one its person edited
 * (delivery.plugin.old-copies-make-way, ADR 0010).
 *
 * Read from the tags, because that is what "released" means, plus the
 * working tree under package.json's version - run this as part of a release,
 * before tagging, so the tag carries its own hashes. A shallow clone with no
 * tags still installs; it just knows fewer old copies.
 *
 *   node tools/released-skills.mjs          write lib/released-skills.json
 *   node tools/released-skills.mjs --check  exit 1 if it is not current
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'lib', 'released-skills.json');
const SHIPPED = ['setup', 'formulate', 'judge', 'incorporate', 'backlog'];
const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const show = (tag, path) => {
  try {
    return git('show', `${tag}:${path}`);
  } catch {
    return null;
  }
};
// The copy a version installed: before ADR 0010 the source WAS the copy;
// after, the copy is the plugin's skill renamed walkdown-<name>.
const asCopy = (short, content) => content.replace(/^name: .*$/m, `name: walkdown-${short}`);
const copyAt = (read, short) => {
  const old = read(`lib/skills/walkdown-${short}.md`);
  if (old != null) return old;
  const now = read(`skills/${short}/SKILL.md`);
  return now == null ? null : asCopy(short, now);
};

const versions = {};
const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
for (const tag of tags) {
  const skills = {};
  for (const short of SHIPPED) {
    const copy = copyAt((p) => show(tag, p), short);
    if (copy != null) skills[`walkdown-${short}`] = sha(copy);
  }
  versions[tag.replace(/^v/, '')] = skills;
}
// The version about to be tagged, from the working tree - but never over a
// tag that already exists: what a tag released is what the tag holds.
const current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
if (!(current in versions)) {
  const here = {};
  for (const short of SHIPPED) {
    const copy = copyAt(
      (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null),
      short,
    );
    if (copy != null) here[`walkdown-${short}`] = sha(copy);
  }
  versions[current] = here;
}

const ordered = Object.fromEntries(
  Object.entries(versions).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
);
const text = `${JSON.stringify(ordered, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const was = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (was !== text) {
    console.error('lib/released-skills.json is not current - run node tools/released-skills.mjs');
    process.exit(1);
  }
  console.log('lib/released-skills.json is current');
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${Object.keys(ordered).length} version(s) to lib/released-skills.json`);
}
