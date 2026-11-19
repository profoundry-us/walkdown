/*
 * WHO A BLUEPRINT'S PEOPLE ARE, READ ONCE (ADR 0018 §§2, 3).
 *
 * Personas, their users, systems and groups are declared in one storyboard
 * of a project, and a sibling takes them with `personas_from:`. Lint reads
 * them to refuse a name nobody declared, the server reads them to hand the
 * panel a user's sign-in steps, and both read a screen's `app.as` the same
 * way, so the reading lives here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../vendor/yaml.js';
import { nameOf, readRegistry } from './locations.js';
import { siblingsOf } from './project.js';
import { setupOf } from './setup.js';

const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/** What one storyboard declares itself: the four lists, and the recipes its users' setups name. */
export function declared(storyboard) {
  return {
    personas: list(storyboard?.personas),
    systems: list(storyboard?.systems),
    groups: list(storyboard?.groups),
    recipes: storyboard?.recipes ?? {},
  };
}

/** Which of the three lists a storyboard has of its own, by their keys. */
export const declaresOwn = (storyboard) =>
  ['personas', 'systems', 'groups'].filter(
    (k) => Array.isArray(storyboard?.[k]) && storyboard[k].length,
  );

function storyboardAt(dir) {
  try {
    return parse(readFileSync(join(dir, 'storyboard.yml'), 'utf8')) ?? {};
  } catch {
    return null;
  }
}

/**
 * A blueprint's people, wherever they are declared.
 *
 * `state` says how far the reading got. `own` and `from` have people to
 * check names against. `unread` is a `personas_from:` naming a blueprint
 * this machine has not registered, which is no fault of the author's.
 * `foreign` names a blueprint of another project, `chained` one that takes
 * its own from a third, and `both` a storyboard that has `personas_from:`
 * and lists of its own. Only `own` and `from` are `known`.
 *
 * @param {{ dir: string, storyboard: any }} blueprint
 * @returns {{ state: 'own' | 'from' | 'unread' | 'foreign' | 'chained' | 'both', known: boolean,
 *   from: string | null, personas: any[], systems: any[], groups: any[], recipes: Record<string, any>,
 *   dir?: string, own?: string[], declarers?: string[] }}
 */
export function peopleOf(blueprint) {
  const sb = blueprint?.storyboard ?? {};
  const from =
    sb.personas_from == null || sb.personas_from === '' ? null : String(sb.personas_from);
  if (!from) return { state: 'own', known: true, from: null, ...declared(sb) };
  const empty = { known: false, from, personas: [], systems: [], groups: [], recipes: {} };
  const siblings = siblingsOf(blueprint.dir).map((s) => ({
    ...s,
    storyboard: storyboardAt(s.dir),
  }));
  // The blueprints of this project that declare people themselves: what a wrong name should have been.
  const declarers = siblings
    .filter((s) => s.storyboard && !s.storyboard.personas_from && declaresOwn(s.storyboard).length)
    .map((s) => nameOf(s.id));
  const own = declaresOwn(sb);
  if (own.length) return { ...empty, state: 'both', own, declarers };
  const named = siblings.find((s) => nameOf(s.id) === from || s.id === from);
  if (named?.storyboard?.personas_from) return { ...empty, state: 'chained', declarers };
  if (named?.storyboard)
    return { state: 'from', known: true, from, dir: named.dir, ...declared(named.storyboard) };
  // Registered, and somebody else's: a blueprint of another project.
  const elsewhere = readRegistry().rows.some(
    (r) => r?.registered && !r.ephemeral && (nameOf(r.id) === from || String(r.id) === from),
  );
  return { ...empty, state: elsewhere ? 'foreign' : 'unread', declarers };
}

/** A user's id as a screen writes it. */
export const userId = (persona, user) => `${persona.id}.${user.id}`;

/** Every user a blueprint's people have, with its persona. */
export function usersOf(people) {
  return people.personas.flatMap((persona) =>
    list(persona.users).map((user) => ({ persona, user, id: userId(persona, user) })),
  );
}

/**
 * Who a screen is signed in as (ADR 0018 §3). `app.as` names a user as
 * `<persona>.<user>`, or a persona alone for its first user.
 *
 * `kind` is `none` (no `as:`), `unread` (the people could not be read),
 * `no-persona` and `no-user` (a name nobody declared), `nobody` (a persona
 * with no users, so no sign-in), or `user`.
 *
 * @returns {{ kind: 'none' | 'unread' | 'no-persona' | 'no-user' | 'nobody' | 'user',
 *   as?: string, id?: string, persona?: any, user?: any }}
 */
export function signedInAs(screen, people) {
  const raw = screen?.app?.as;
  if (raw === undefined || raw === null || raw === '') return { kind: 'none' };
  const as = String(raw);
  if (!people?.known) return { kind: 'unread', as };
  const dot = as.indexOf('.');
  const pid = dot < 0 ? as : as.slice(0, dot);
  const persona = people.personas.find((p) => String(p.id) === pid);
  if (!persona) return { kind: 'no-persona', as, persona: pid };
  const users = list(persona.users);
  if (dot < 0) {
    if (!users.length) return { kind: 'nobody', as, persona };
    return { kind: 'user', as, id: userId(persona, users[0]), persona, user: users[0] };
  }
  const uid = as.slice(dot + 1);
  const user = users.find((u) => String(u.id) === uid);
  if (!user) return { kind: 'no-user', as, persona, user: uid };
  return { kind: 'user', as, id: userId(persona, user), persona, user };
}

/** A user's setup, read as a screen's is, against the recipes of the storyboard that declares it. */
export const userSetup = (user, people) =>
  setupOf({ app: { setup: user?.setup } }, { recipes: people?.recipes ?? {} });

/** The steps signing in as a screen's user runs, or none. */
export function signInSteps(screen, people) {
  const who = signedInAs(screen, people);
  if (who.kind !== 'user') return [];
  const setup = userSetup(who.user, people);
  return setup.kind === 'steps' && !setup.missingRecipe ? setup.steps : [];
}
