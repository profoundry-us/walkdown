/*
 * Who is sitting at this machine: what the personal config says, and what git
 * and the OS can guess where it says nothing. Read-only:
 * nothing here writes, and nothing here is a permission - what counts is
 * always what a RUN was recorded under, and the write path validates that
 * for real (lib/writes.js).
 */
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { readUserConfig } from './locations.js';
import { ROLES } from './vocab.js';

/**
 * One git config value, or '' if git is missing, unset, or not a repo here.
 *
 * Asked with every GIT_CONFIG_* variable stripped from the environment. Those
 * inject config values directly - `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=...`
 * is a whole config file in three environment variables - so on a machine
 * that has not declared an identity they let a caller name whoever they like,
 * which is the environment override this design exists to remove (n-0142).
 * Stripped rather than refused: a person's real git config is a fine guess at
 * who they are, and only the injection is the problem.
 */
function gitConfig(cwd, key) {
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG')),
    );
    const r = spawnSync('git', ['config', '--get', key], { cwd, encoding: 'utf8', env });
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
 * and what counts is the roles the RUN was recorded under. The personal
 * config answers it where it says so; failing that `walkdown.roles` in git
 * config (or WALKDOWN_ROLES), which is per-person-per-checkout. Anything
 * unrecognised is dropped rather than refused: a bad default must not stop a
 * panel from booting, and the write path validates for real.
 */
function configuredRoles(cwd, declared) {
  if (Array.isArray(declared?.roles)) {
    const roles = declared.roles.filter((r) => ROLES.includes(r));
    if (roles.length) return { roles: [...new Set(roles)], roles_source: 'config' };
  }
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
  /*
   * The personal config first, because it is the one place a person has
   * actually SAID who they are. Everything under it is inference - a git
   * email, a login name - which is a fine guess and a poor basis for
   * accepting work under somebody's name (n-0139). It is read from the
   * personal config only; a committed file naming a person would be wrong on
   * every machine but one, and readUserConfig drops the repository's.
   */
  const declared = readUserConfig({ cwd }).config.identity ?? null;
  const name = declared?.name || gitConfig(cwd, 'user.name');
  const explicit =
    declared?.username?.trim() || gitConfig(cwd, 'user.username') || gitConfig(cwd, 'github.user');
  const email = gitConfig(cwd, 'user.email');
  const local = email.includes('@') ? email.slice(0, email.indexOf('@')).trim() : '';
  const username = explicit || local || os;
  return {
    ...configuredRoles(cwd, declared),
    // Every role there is, so the panel's control can offer the vocabulary
    // instead of hard-coding a copy that drifts from the one that validates.
    knownRoles: [...ROLES],
    // `actor` stays the recorded identity, so every existing reader of this
    // payload keeps getting the one string it is meant to write down.
    actor: username,
    username,
    name,
    source: declared?.username?.trim() ? 'config' : explicit || local ? 'git' : 'os',
    name_source: declared?.name ? 'config' : name ? 'git' : null,
    /*
     * Whether the person WROTE this down, which is the question the accept
     * gate asks. A guess is not a signature.
     */
    declared: Boolean(declared?.username?.trim()),
    handles: [...new Set([username, os, name].filter(Boolean))],
  };
}
