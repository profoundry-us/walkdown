/*
 * Every write walkdown can be asked to make, in one module short enough to
 * read whole - whichever door the asking came through.
 *
 * The law is q-0019's second decision: a review server writes SPECIFICATION
 * and only specification - a thread, a draft, a run record. Never
 * implementation: no request creates or modifies features, prototypes, source
 * or checks, because the browser captures intent and the agent structures it.
 * The functions below are the complete list; a write that does not pass
 * through here is a bug with a name
 * (ownership.writes.spec-never-implementation).
 *
 * It exists as ONE module because the boundary used to be implicit across a
 * 450-line request handler, and n-0121 records what that cost: four separate
 * author-defaulting bugs, found one per judging pass, each fixed as if it
 * were the last.
 *
 * WHY IT NOW HOLDS THE POLICY AND NOT ONLY THE PLUMBING. This was the
 * browser's door, and the CLI reached around it into threads.js. The
 * mechanics were shared, so a legal transition meant the same thing at both -
 * but WHO a write is recorded under, and whether a machine may accept work at
 * all, were written out twice in the same words. Two copies of a rule is two
 * chances to be right: the accept gate was given to the CLI and not to the
 * API, and neither suite noticed, because each tested its own door
 * (n-0142, n-0143).
 *
 * So the interfaces keep what is genuinely theirs - parsing arguments,
 * shaping output, and saying HOW the ask arrived - and everything about who
 * may write what lives here, once. A third interface adds no fourth copy;
 * that is the point of doing it before there is one.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from '../vendor/yaml.js';
import { clearDraft, writeDraft } from './draft.js';
import { defaultActor } from './identity.js';
import { writeRunRecord } from './run-record.js';
import {
  checkTransition,
  getThread,
  transitionThread as moveThread,
  replyToThread as replyThread,
} from './threads.js';
import { HUMAN_ONLY, threadPrefix } from './vocab.js';

/*
 * WHO is acting, and it is never something the caller says.
 *
 * There was a `--actor <name>` at the CLI and an `actor` in every request
 * body, on the premise that the caller might be somebody other than the
 * person whose machine this is - which is backwards. An agent working here is
 * working for the person who asked it to, and a localhost review server has
 * no authentication and never will, so a name arriving from outside is
 * asserted and never proved (n-0139, n-0142).
 *
 * The one thing an interface may still say about who is acting is `via`:
 * provenance, not attribution. The author stays the person; `via: agent` says
 * a machine typed the words. It can only ever subtract authority.
 */
const whoIsActing = (blueprint) => defaultActor(blueprint.codeRoot ?? blueprint.projectRoot);

/*
 * And whether that person WROTE THEMSELVES DOWN. Removing the override is not
 * enough on its own: a machine whose config declares nobody still has a git
 * email and a login name to fall back on, and accepting work under one of
 * those is a record of who owns the laptop dressed as a decision (n-0130,
 * found again on the HTTP door as n-0143).
 *
 * One sentence, in one place, so both doors refuse in the same words - they
 * used to be a copy-paste of each other, which is how one of them came to be
 * missing.
 */
function mustBeDeclared(who, what) {
  if (who.declared) return;
  throw new Error(
    `"${what}" is recorded under a person's name, and this machine only has a guess (${who.username}, from ${who.source}). ` +
      (who.problem
        ? `${who.problem}. Fix it there`
        : 'Say who you are in ~/.walkdown/config.yml under `identity:`') +
      ' — a login name is not a decision',
  );
}

/*
 * The author policy, and n-0121's open question is answered: REFUSE.
 *
 * A missing author used to fall back to the machine's username, on the
 * reasoning that a server cannot know who is at a browser that did not say.
 * True, and precisely why it must not guess. Four separate defaulting bugs
 * were found here, one per judging pass, and every one was invisible because
 * the default always produced a plausible name. Nothing supplies an author
 * from outside any more, so this now guards against a resolver that came back
 * empty rather than against a caller who said nothing.
 */
const asWho = (author) => {
  const who = author?.trim?.() ?? author;
  if (!who) throw new Error('a write needs an author — say who is writing (n-0121)');
  return who;
};

/*
 * Millisecond precision on purpose. The panel's session gate asks whether a
 * thread arrived after a millisecond-stamped session start, and a seconds-only
 * stamp made the whole start second ambiguous - a thread POSTed just BEFORE
 * Start walkdown counted as a why for an empty-box Fail (n-0132). Agents
 * drive this panel at exactly the speed where that second is a real window.
 */
const isoNow = () => new Date().toISOString();

/** Next thread id: n-0001 / q-0001 style, scanning existing thread files. */
function nextThreadId(dir, kind) {
  const prefix = threadPrefix(kind);
  let max = 0;
  if (existsSync(dir))
    for (const f of readdirSync(dir)) {
      const m = f.match(/^[nq]-(\d+)/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}
/** Open a thread: assign its id, stamp author and time, file it open. */
export function openThread(blueprint, { kind, body, anchor, via = null }) {
  const who = whoIsActing(blueprint);
  /*
   * The RESOLVED threads directory - the one loadBlueprint reads - never
   * `<spec>/threads` by name. They are the same path until a config moves
   * the ledger, and then the hardcoded one filed pins where no reader
   * looks: the panel confirms the thread and the next reload has never
   * heard of it, while the id counter restarts from n-0001 in the shadow
   * directory. Same bug family `walkdown run` had.
   */
  const dir = blueprint.at.threads.path;
  mkdirSync(dir, { recursive: true });
  /*
   * Exclusive create, retried. Two concurrent filers both compute the next id
   * from the same directory listing, and the second write silently overwrote
   * the first thread - two judges collided on one id within a minute of each
   * other on 2026-09-01, and only the loser still being alive saved the note.
   * Losing the race now costs a re-scan; losing a thread is loss.
   */
  for (let attempt = 0; ; attempt++) {
    const id = nextThreadId(dir, kind);
    const thread = {
      id,
      kind,
      author: asWho(who.username),
      // Provenance beside attribution, never instead of it: an agent writing
      // for a person records under the person and says a machine typed it.
      ...(via ? { via } : {}),
      created: isoNow(),
      anchor,
      status: 'open',
      body,
    };
    try {
      writeFileSync(join(dir, `${id}.yml`), stringify(thread), { flag: 'wx' });
      return { id, thread };
    } catch (err) {
      if (err?.code !== 'EEXIST' || attempt >= 50) throw err;
    }
  }
}

/**
 * Append a reply. Claiming, not accepting, so it asks nothing of the machine
 * beyond having a name to write down.
 */
export function reply(blueprint, id, { body, via = null }) {
  const who = whoIsActing(blueprint);
  return { thread: replyThread(blueprint, id, { author: asWho(who.username), body, via }), by: who };
}

/**
 * Move a thread through its lifecycle. The lifecycle guards live in
 * threads.js - which flows are legal, what needs a reason, that an actor
 * called "agent" may not accept - and the guard about this MACHINE lives
 * here, because it is the same question the CLI and the API were each
 * answering separately.
 */
export function transition(blueprint, id, { status, reason, via = null }) {
  const who = whoIsActing(blueprint);
  if (HUMAN_ONLY.includes(status)) mustBeDeclared(who, status);
  return {
    thread: moveThread(blueprint, id, { status, actor: who.username, reason, via }),
    by: who,
  };
}

/**
 * A reply and a transition as ONE ask, because that is how they are meant.
 *
 * `walkdown thread <id> --reply "..." --status addressed` is a single
 * intention, and it used to be two calls with the ordering rule living in
 * bin/: validate the transition BEFORE writing anything, or a refused status
 * leaves the reply on disk while the output says nothing happened, and the
 * retry files it twice (n-0125, second sitting). That rule belongs to the
 * ask, not to the terminal that happened to make it - so a second interface
 * inherits it instead of rediscovering it.
 */
export function mutateThread(blueprint, id, { body = null, status = null, reason, via = null }) {
  const who = whoIsActing(blueprint);
  if (status && HUMAN_ONLY.includes(status)) mustBeDeclared(who, status);
  // Ask the lifecycle first, while nothing has been written.
  const before = status ? getThread(blueprint, id) : null;
  if (status && before) checkTransition(before, { status, actor: who.username, reason, via });
  let thread = null;
  if (body !== null) thread = replyThread(blueprint, id, { author: asWho(who.username), body, via });
  if (status) thread = moveThread(blueprint, id, { status, actor: who.username, reason, via });
  return { thread, by: who, was: before?.status ?? null };
}

/** Save the sitting in progress. A draft is working state, never a verdict. */
export const saveDraft = (blueprint, draft) =>
  writeDraft(blueprint.at.drafts.path, { ...draft, actor: whoIsActing(blueprint).username });

/** Discard it - an emptied session and an explicit discard are the same thing. */
export const discardDraft = (blueprint, target) => clearDraft(blueprint.at.drafts.path, target);

/**
 * Seal a walkdown: append the run record, delete the draft. One write, one
 * delete - never both shapes of the same session on disk.
 *
 * A walkdown is an acceptance - it fills a role's signature - so it asks the
 * same of the machine that verifying a thread does.
 */
export function finishWalkdown(blueprint, { target, baseUrl, roles, results }) {
  const who = whoIsActing(blueprint);
  mustBeDeclared(who, 'a walkdown');
  const { record } = writeRunRecord({
    blueprintDir: blueprint.dir,
    // Already resolved when the blueprint was loaded; re-asking from this
    // process's cwd would answer about a different tree.
    runsDir: blueprint.at?.runs?.path,
    target,
    baseUrl,
    actor: who.username,
    roles,
    kind: 'walkdown',
    results,
  });
  clearDraft(blueprint.at.drafts.path, target);
  return record;
}
