/*
 * A FIXTURE BUILT ONCE PER FILE, A COPY PER TEST.
 *
 * Building a project the way a person does - `git init`, `blueprints new`,
 * `where` to find what it made - is a dozen processes, and a file that did it
 * in every test spent half its time there (several-project, 2026-10-08:
 * eight CLI runs a fixture, nine fixtures). The build runs once; each test
 * gets a copy of the whole tree in a folder of its own, so what one test
 * writes no other sees.
 *
 * The registry and the claims index name absolute paths under the fixture's
 * folder, so a copy rewrites them to its own. Nothing else is touched: a
 * copied `.git` is a new one (another inode), which the registry already
 * reads as a re-clone of the same repository and keeps listed.
 */
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEXT = /\.(ya?ml|json)$/;

/** Every text file under `dir` that may name a path, skipping `.git`. */
function* textFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const at = join(dir, name);
    const st = statSync(at);
    if (st.isDirectory()) yield* textFiles(at);
    else if (TEXT.test(name)) yield at;
  }
}

/**
 * `build(root)` makes the fixture in `root` and returns whatever the tests
 * need to know about it. The result is a function: each call copies the
 * built tree into a fresh folder and returns `{ root, made }`, where `made`
 * is what `build` returned with every path in it re-rooted.
 * @template T
 * @param {string} prefix
 * @param {(root: string) => T} build
 * @param {string[]} [roots] where each copy's folder is pushed, for clean-up
 */
export function builtOnce(prefix, build, roots = []) {
  let template = null;
  return () => {
    if (!template) {
      const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
      roots.push(root);
      template = { root, made: build(root) };
    }
    const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    roots.push(root);
    cpSync(template.root, root, { recursive: true, verbatimSymlinks: true });
    for (const file of textFiles(root)) {
      const text = readFileSync(file, 'utf8');
      if (text.includes(template.root)) writeFileSync(file, text.split(template.root).join(root));
    }
    const made = JSON.parse(JSON.stringify(template.made).split(template.root).join(root));
    return { root, made };
  };
}
