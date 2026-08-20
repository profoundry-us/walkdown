import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Locate the blueprint directory: `dir` itself if it holds walkdown.yml,
 * a `blueprint/` child, or the same probed on ancestors (up to 6 levels).
 */
export function findBlueprintDir(start = process.cwd()) {
  let dir = resolve(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'walkdown.yml'))) return dir;
    if (existsSync(join(dir, 'blueprint', 'walkdown.yml'))) return join(dir, 'blueprint');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function listFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile())
    .sort();
}

/**
 * Load every blueprint artifact under `dir`. Parse failures never throw; they
 * are collected as { file, message } in `problems` so lint can report them.
 */
export function loadBlueprint(dir) {
  const problems = [];
  const readYaml = (file) => {
    try {
      return parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push({ file, message: `YAML parse error: ${err.message.split('\n')[0]}` });
      return null;
    }
  };
  const readJson = (file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push({ file, message: `JSON parse error: ${err.message}` });
      return null;
    }
  };

  const config = readYaml(join(dir, 'walkdown.yml')) ?? {};
  const storyboard = existsSync(join(dir, 'storyboard.yml'))
    ? readYaml(join(dir, 'storyboard.yml')) ?? { screens: [] }
    : { screens: [] };

  const features = listFiles(join(dir, 'features'), ['.yml', '.yaml'])
    .map((file) => ({ file, data: readYaml(file) }))
    .filter((f) => f.data != null);
  const threads = listFiles(join(dir, 'threads'), ['.yml', '.yaml'])
    .map((file) => ({ file, data: readYaml(file) }))
    .filter((t) => t.data != null);
  const runs = listFiles(join(dir, 'runs'), ['.json'])
    .map((file) => ({ file, data: readJson(file) }))
    .filter((r) => r.data != null);

  return { dir, projectRoot: dirname(dir), config, storyboard, features, threads, runs, problems };
}

/** Flatten features into [{ file, feature, story, rule }]. */
export function collectRules(features) {
  const rules = [];
  for (const { file, data } of features) {
    for (const story of data?.stories ?? []) {
      for (const rule of story?.rules ?? []) {
        rules.push({ file, feature: data, story, rule });
      }
    }
  }
  return rules;
}

/** A rule's required evidence types; the documented default is [checks]. */
export function verifyList(rule) {
  const v = rule.verify ?? ['checks'];
  return Array.isArray(v) ? v : [v];
}
