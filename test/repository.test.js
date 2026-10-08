/*
 * Whether a checkout is the repository a row was registered from, decided
 * over a described world instead of real repositories. Each row of these
 * tables is a case a judging found (the n-numbers are its thread); the
 * real-git tests in import-moves, import-repositories and judged-edges keep
 * the facts honest - that git is asked what this world only states.
 */
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { test } from 'node:test';
import { checkoutGone, couldHaveMoved } from '../lib/repository.js';

const RULE = '@rule:commands.blueprints.import-takes-what-it-is-pointed-at';

/*
 * A world: the repositories standing at each path, and which homes have a
 * spec on disk. A repository is its `.git` (an inode), the commits its
 * history holds, its remotes, and the homes any of its commits ever held.
 * A path given `{}` is a folder that is no repository.
 */
function world(dirs, homes = []) {
  const at = (d) => dirs[d] ?? null;
  return {
    exists: (p) => p in dirs || homes.some((h) => h.startsWith(`${p}/`)),
    isTop: (d) => Boolean(at(d)?.git),
    gitId: (d) => at(d)?.git ?? null,
    hasCommit: (d, sha) => Boolean(at(d)?.commits?.includes(sha)),
    hasHistory: (d) => Boolean(at(d)?.commits?.length),
    origin: (d) => at(d)?.origin ?? null,
    remotes: (d) => [at(d)?.origin, ...(at(d)?.remotes ?? [])].filter(Boolean),
    label: (d) => basename(at(d)?.origin ?? d),
    homeOnDisk: (h) => homes.includes(h),
    homeInHistory: (d, h) => Boolean(at(d)?.held?.includes(h)),
  };
}

// The row every case starts from: registered at /w/app from a clone of
// github.com/acme/app whose first commit is r1, with its .git at 1:100.
const row = {
  project: 'app',
  checkout: '/w/app',
  home: '/w/app/blueprints/0001-app',
  root: 'r1',
  origin: 'github.com/acme/app',
  git: '1:100',
};
const HOME = row.home;
const app = (more = {}) => ({
  git: '1:100',
  commits: ['r1', 'c2'],
  origin: 'github.com/acme/app',
  held: [HOME],
  ...more,
});

const gone = [
  ['standing, its home on disk', {}, world({ '/w/app': app() }, [HOME]), false],
  ['nothing at its path any more', {}, world({}), true],
  ['a row that never named a checkout', { checkout: undefined }, world({}), false],
  ['checked out at a commit from before its homes (n-0540)', {}, world({ '/w/app': app() }), false],
  [
    'on another branch, registered by an older walkdown that kept no repository',
    { root: undefined, origin: undefined, git: undefined },
    world({ '/w/app': app({ git: '1:200' }) }),
    false,
  ],
  [
    'its origin cloned back without the unpushed home',
    {},
    world({ '/w/app': app({ git: '1:200', held: [] }) }),
    true,
  ],
  [
    're-cloned, missing a local commit, its home pushed (n-0549)',
    {},
    world({ '/w/app': app({ git: '1:200', commits: ['r1'] }) }, [HOME]),
    false,
  ],
  [
    'its history amended and collected, its org renamed (n-0548, n-0549)',
    {},
    world({ '/w/app': app({ commits: ['r9'], origin: 'github.com/acme-inc/app' }) }, [HOME]),
    false,
  ],
  [
    'its remote respelled into a fork, upstream kept (n-0544)',
    {},
    world(
      {
        '/w/app': app({ origin: 'github.com/me/app', remotes: ['github.com/acme/app'] }),
      },
      [HOME],
    ),
    false,
  ],
  [
    'an unrelated repository with the same layout put there (n-0541)',
    {},
    world({ '/w/app': { git: '1:300', commits: ['x1'], origin: 'github.com/acme/other' } }, [HOME]),
    true,
  ],
  [
    'a template sibling put there, sharing the first commit (n-0546)',
    {},
    world(
      { '/w/app': { git: '1:300', commits: ['r1', 'x2'], origin: 'github.com/acme/sibling' } },
      [HOME],
    ),
    true,
  ],
  [
    'an older repository renamed into its path (n-0550)',
    {},
    world({ '/w/app': { git: '1:050', commits: ['o1'], held: [HOME] } }, [HOME]),
    true,
  ],
  ['a folder that is no repository, its home gone', {}, world({ '/w/app': {} }), true],
  ['a folder that is no repository, its home on disk', {}, world({ '/w/app': {} }, [HOME]), false],
];

for (const [name, change, facts, expected] of gone) {
  test(`gone: ${name} ${RULE}`, () => {
    assert.equal(checkoutGone({ ...row, ...change }, facts), expected);
  });
}

// The candidate is /w/new; the row's own path is empty unless a case puts
// something there.
const moved = [
  ['the same clone moved', {}, { '/w/new': app({ git: '1:100' }) }, null, true],
  [
    'not gone: the checkout is still standing',
    {},
    { '/w/app': app(), '/w/new': app() },
    null,
    false,
  ],
  [
    'an unrelated repository sharing its folder layout (n-0536)',
    {},
    { '/w/new': { git: '1:300', commits: ['x1'], origin: 'github.com/acme/app' } },
    null,
    false,
  ],
  ['a repository with no commits (n-0538)', {}, { '/w/new': { git: '1:300' } }, null, false],
  ['a shallow clone, deepened since, moved', {}, { '/w/new': app({ git: '1:300' }) }, null, true],
  [
    'retargeted to a fork, upstream kept, and moved (n-0545)',
    {},
    { '/w/new': app({ origin: 'github.com/me/app', remotes: ['github.com/acme/app'] }) },
    null,
    true,
  ],
  [
    'a template sibling with no remote (n-0544)',
    {},
    { '/w/new': { git: '1:300', commits: ['r1', 'x2'] } },
    null,
    false,
  ],
  [
    'a template sibling with a remote of its own',
    {},
    { '/w/new': { git: '1:300', commits: ['r1', 'x2'], origin: 'github.com/acme/sibling' } },
    null,
    false,
  ],
  [
    "another owner's repository of the same name, from an older row",
    { root: undefined },
    { '/w/new': { git: '1:300', commits: ['y1'], origin: 'github.com/someone/app' } },
    null,
    false,
  ],
  [
    'an older row with no repository kept, its label matching',
    { root: undefined, origin: undefined, git: undefined },
    { '/w/new': { git: '1:300', commits: ['y1'], origin: 'github.com/acme/app' } },
    null,
    true,
  ],
  [
    'an older row with no repository kept, another label',
    { root: undefined, origin: undefined, git: undefined },
    { '/w/new': { git: '1:300', commits: ['y1'], origin: 'github.com/acme/web' } },
    null,
    false,
  ],
  [
    'renamed with no remote, from a row that knew none',
    { root: undefined, origin: undefined, git: undefined },
    { '/w/new': { git: '1:300', commits: ['y1'] } },
    null,
    true,
  ],
  [
    'registered with no remote, given one under another name, and moved',
    { origin: undefined },
    { '/w/new': app({ git: '1:300', origin: 'github.com/acme/web' }) },
    null,
    true,
  ],
  [
    'its project named outright, whatever stands there',
    {},
    { '/w/new': { git: '1:300' } },
    'app',
    true,
  ],
  ['another project named outright', {}, { '/w/new': app() }, 'web', false],
];

for (const [name, change, dirs, project, expected] of moved) {
  test(`moved: ${name} ${RULE}`, () => {
    assert.equal(couldHaveMoved({ ...row, ...change }, '/w/new', project, world(dirs)), expected);
  });
}
