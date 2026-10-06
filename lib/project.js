/*
 * THE OTHER BLUEPRINTS IN A BLUEPRINT'S PROJECT (ADR 0013).
 *
 * Several blueprints registered for one project share its test suite and its
 * thread numbering, and cite each other's threads. A reader that knows only
 * its own blueprint calls a sibling's check "a rule that does not exist" and
 * numbers a thread its sibling already used. This is the one place that asks
 * the registry who the siblings are.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../vendor/yaml.js';
import { canon, expand, readRegistry, resolveLocations } from './locations.js';

/**
 * Every other blueprint registered for the project this spec belongs to,
 * with where its spec and threads are. None for a blueprint with no project
 * (a scratch copy) or one alone in its project.
 *
 * @param {string} specDir
 * @returns {{ id: string, dir: string, threads: string | null }[]}
 */
export function siblingsOf(specDir) {
  const me = resolveLocations({ spec: specDir });
  const project = me.blueprint?.project;
  if (!project) return [];
  const mine = canon(specDir);
  const out = [];
  for (const r of readRegistry().rows) {
    // A raw row names its repository `checkout`; `project` there is the label.
    if (!r?.registered || !r.home || r.ephemeral || !r.checkout) continue;
    if (canon(expand(String(r.checkout))) !== canon(project)) continue;
    const loc = resolveLocations({ blueprint: String(r.id), cwd: project });
    if (!loc.spec?.path || canon(loc.spec.path) === mine || !existsSync(loc.spec.path)) continue;
    out.push({ id: String(r.id), dir: loc.spec.path, threads: loc.threads?.path ?? null });
  }
  return out;
}

/*
 * THE THREADS IN A DIRECTORY, by what they say (ADR 0014 §9). A thread's
 * file is named by its UUID now and its label - `n-0357` - is inside it, so
 * the file name alone says nothing; an older thread named `n-0001.yml`
 * still answers by its name. Read by a line match rather than a YAML parse,
 * because numbering a new thread reads every thread in the project.
 *
 * @returns {{ label: string, uuid: string | null, aliases: string[], file: string }[]}
 */
export function threadsIn(dir) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    let text;
    try {
      text = readFileSync(join(dir, f), 'utf8');
    } catch {
      continue;
    }
    const label = text.match(/^id:\s*['"]?([nq]-\d+)/m)?.[1] ?? f.match(/^([nq]-\d+)\.ya?ml$/)?.[1];
    if (!label) continue;
    const uuid = text.match(/^uuid:\s*['"]?([0-9a-f-]{36})/m)?.[1] ?? null;
    // Rare - only a relabelled thread has one - so parsed only when there.
    let aliases = [];
    if (/^aliases:/m.test(text))
      try {
        aliases = (parse(text)?.aliases ?? []).map(String);
      } catch {
        /* lint reports a thread that does not parse */
      }
    out.push({ label, uuid, aliases, file: join(dir, f) });
  }
  return out;
}

/** The thread labels held in a threads directory, aliases included. */
export function threadIdsIn(dir) {
  return threadsIn(dir).flatMap((t) => [t.label, ...t.aliases]);
}
