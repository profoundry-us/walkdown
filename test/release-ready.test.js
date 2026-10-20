import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startsARelease } from '../tools/release-ready.mjs';

test('the release gate stops a version tag, a push of one, and a GitHub release', () => {
  for (const command of [
    'git tag -a v0.5.0 -m "walkdown 0.5.0"',
    'git commit -q -m x && git tag -a v0.5.0 -m y',
    'git push origin main v0.5.0',
    'git push --tags',
    'gh release create v0.5.0 --title "walkdown 0.5.0" --notes-file notes.md',
    'GH_TOKEN=x gh release create v0.5.0',
  ])
    assert.ok(startsARelease(command), command);
});

test('the release gate lets everything else by, a deleted tag and a mention included', () => {
  for (const command of [
    'git tag -d v0.5.0',
    'git tag --delete v0.5.0',
    'git push origin main',
    'git tag --sort=-v:refname',
    'git status',
    "python3 - <<'EOF'\ns = 'run it before `gh release create`, or any git tag v0.5.0'\nEOF",
  ])
    assert.ok(!startsARelease(command), command);
});
