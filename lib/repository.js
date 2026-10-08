/*
 * WHETHER A CHECKOUT IS THE REPOSITORY A ROW WAS REGISTERED FROM.
 *
 * The decisions only. Every fact they rest on - does the path exist, which
 * `.git` stands there, does its history hold a commit, which remotes it
 * names - is asked of `git`, an object the caller hands in. lib/locations.js
 * hands in one that asks the disk and git itself; test/repository.test.js
 * hands in a described world, so each case a judging found is a row in a
 * table rather than a repository built, cloned and moved.
 *
 * Paths are passed to `git` as the row spells them; resolving `~` and
 * relative paths is the asker's business.
 */

/**
 * @typedef {object} GitFacts
 * @property {(path: string) => boolean} exists       anything at the path
 * @property {(dir: string) => boolean} isTop          the path is the top of a repository
 * @property {(dir: string) => string|null} gitId      its `.git`, as device and inode
 * @property {(dir: string, sha: string) => boolean} hasCommit  its history holds the commit
 * @property {(dir: string) => boolean} hasHistory     it has any commit at all
 * @property {(dir: string) => string|null} origin     its `origin`, spelled one way
 * @property {(dir: string) => string[]} remotes       every remote, spelled one way
 * @property {(dir: string) => string} label           the project label it would be given
 * @property {(home: string) => boolean} homeOnDisk    a spec stands in the home
 * @property {(dir: string, home: string) => boolean} homeInHistory  a commit there ever held the home
 */

/**
 * @typedef {{ checkout?: unknown, home?: unknown, project?: unknown,
 *   root?: unknown, origin?: unknown, git?: unknown }} Row
 */

/**
 * Whether a checkout is certainly not the repository a row was registered
 * from, asked of the row's old path and of a candidate for its new one.
 *
 * At the row's own path, the very `.git` the row was registered from - the
 * same inode, kept on the row - is the same checkout, whatever has happened
 * to its commits or its remote since: amended and collected, an org
 * renamed, a remote removed (n-0548, n-0549). Any other `.git` there - a
 * re-clone, a sibling cloned where a gone project stood (n-0547), another
 * repository renamed in (n-0550) - is put to the tests below.
 *
 * The first commit, kept on the row, rules out a repository whose history
 * does not hold it, or that has none (n-0538, n-0547); a shallow cut, since
 * deepened, is still held. It cannot rule one in: a whole template family
 * shares it. So a row that knew its origin also wants it named - as the
 * origin, or among the remotes, as a fork keeps it in `upstream` (n-0544,
 * n-0545). A later commit is no test at all: an amend and a gc take it from
 * a checkout that never moved (n-0549).
 * @param {Row} row
 * @param {string} dir
 * @param {'here' | 'elsewhere'} where
 * @param {GitFacts} git
 */
export function anotherRepository(row, dir, where, git) {
  if (where === 'here' && row.git) {
    if (git.gitId(dir) === String(row.git)) return false;
  }
  if (row.root && !git.hasCommit(dir, String(row.root))) return true;
  if (!row.origin || git.origin(dir) === String(row.origin)) return false;
  return !git.remotes(dir).includes(String(row.origin));
}

/**
 * Whether a row's checkout is gone. A home missing from its place is not
 * enough: the same repository checked out at a commit from before its homes
 * is still there, and an unrelated repository with the same layout must not
 * take its rows (n-0538). Something else standing at the old path - another
 * repository, or no repository at all - leaves it gone.
 * @param {Row} row
 * @param {GitFacts} git
 */
export function checkoutGone(row, git) {
  if (!row?.checkout) return false;
  const old = String(row.checkout);
  if (!git.exists(old)) return true;
  const repo = git.isTop(old);
  // Another repository put at the old path leaves the row gone (n-0541),
  // by the same test a candidate for its new path is put to (n-0546).
  if (repo && anotherRepository(row, old, 'here', git)) return true;
  // Its home still on disk stands where it is, committed or not.
  if (row.home && git.homeOnDisk(String(row.home))) return false;
  if (!repo) return true;
  // The same repository is still standing if, whatever it has checked out,
  // the home is somewhere in its history (n-0540). One that never held it -
  // its origin cloned back without an unpushed home - is not.
  return !(row.home && git.homeInHistory(old, String(row.home)));
}

/**
 * Whether a registered row whose checkout is gone could be `checkout` moved:
 * the same place inside it is not enough, since an unrelated repository can
 * share a folder layout (n-0536). A project named outright must be the row's;
 * failing that, a checkout with an origin must give the row's label. Only a
 * checkout with neither - a rename with no remote - is judged by layout alone.
 * @param {Row} row
 * @param {string} checkout
 * @param {string|null} project
 * @param {GitFacts} git
 */
export function couldHaveMoved(row, checkout, project, git) {
  if (!checkoutGone(row, git)) return false;
  if (project) return String(row.project ?? '') === project;
  if (anotherRepository(row, checkout, 'elsewhere', git)) return false;
  if (row.root && git.hasHistory(checkout)) return true;
  if (git.origin(checkout) && !row.origin) return String(row.project ?? '') === git.label(checkout);
  return true;
}
