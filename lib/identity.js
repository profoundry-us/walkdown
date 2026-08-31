/*
 * Who is sitting at this machine, as git and the OS know them. Read-only:
 * nothing here writes, and nothing here is a permission - what counts is
 * always what a RUN was recorded under, and the write path validates that
 * for real (lib/writes.js).
 */
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { ROLES } from './vocab.js';

/** One git config value, or '' if git is missing, unset, or not a repo here. */
function gitConfig(cwd, key) {
  try {
    const r = spawnSync('git', ['config', '--get', key], { cwd, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : '';
  } catch {
    return ''; // git missing or not a repo
  }
}

/**
 * Who is working here — two facts, not one.
 *
 * `username` is the **identity**: a stable handle, and the only thing records
 * are ever written under. `name` is the **display name**: the full name git
 * knows, shown in the UI because "Topher Fangio" reads better than "topher",
 * and absent for plenty of people, which is why it can never be the identity.
 *
 * Conflating the two is what this splits (n-0104). The handle is looked for in
 * the order someone would answer "what's your username here?" — an explicit
 * `user.username`, the `github.user` a lot of configs already carry, the local
 * part of the git email, and finally the OS username, which is what the CLI and
 * the test reporters have always recorded under.
 *
 * `handles` is every name this machine could plausibly have recorded under
 * before or after the split — the handle, the OS username, the full name. The
 * UI maps all of them onto one display name, so a ledger holding both
 * "Topher Fangio" (written yesterday) and "topher" (written today) still reads
 * as one person rather than two. Nothing rewrites the old records; they are
 * history, and history is append-only.
 *
 * `roles` is the third fact: which hats this person signs in. It is a default
 * offered to the panel, never a permission - a person changes it per sitting,
 * and what counts is the roles the RUN was recorded under. It is read from
 * `walkdown.roles` in git config (or WALKDOWN_ROLES), because the answer is
 * per-person-per-checkout, which is exactly what git config is for. Anything
 * unrecognised is dropped rather than refused: a bad default must not stop a
 * panel from booting, and the write path validates for real.
 */
function configuredRoles(cwd) {
  const raw = process.env.WALKDOWN_ROLES || gitConfig(cwd, 'walkdown.roles');
  const roles = raw
    .split(/[,\s]+/)
    .map((r) => r.trim())
    .filter((r) => ROLES.includes(r));
  return {
    roles: roles.length ? [...new Set(roles)] : ['eng'],
    roles_source: roles.length ? (process.env.WALKDOWN_ROLES ? 'env' : 'git') : 'default',
  };
}

export function defaultActor(cwd) {
  const os = userInfo().username;
  const name = gitConfig(cwd, 'user.name');
  const explicit = gitConfig(cwd, 'user.username') || gitConfig(cwd, 'github.user');
  const email = gitConfig(cwd, 'user.email');
  const local = email.includes('@') ? email.slice(0, email.indexOf('@')).trim() : '';
  const username = explicit || local || os;
  return {
    ...configuredRoles(cwd),
    // Every role there is, so the panel's control can offer the vocabulary
    // instead of hard-coding a copy that drifts from the one that validates.
    knownRoles: [...ROLES],
    // `actor` stays the recorded identity, so every existing reader of this
    // payload keeps getting the one string it is meant to write down.
    actor: username,
    username,
    name,
    source: explicit || local ? 'git' : 'os',
    name_source: name ? 'git' : null,
    handles: [...new Set([username, os, name].filter(Boolean))],
  };
}
