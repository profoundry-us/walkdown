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
import { anchorId } from './anchor-id.js';
import { defaultActor } from './identity.js';
import { configPath } from './locations.js';
import { writeRunRecord } from './run-record.js';
import {
  checkTransition,
  closeByVerdict,
  getThread,
  deferThread,
  transitionThread as moveThread,
  replyToThread as replyThread,
} from './threads.js';
import { isoNow } from './time.js';
import {
  defaultReason,
  HUMAN_ONLY,
  saysSomething,
  THREAD_REASONS,
  threadPrefix,
} from './vocab.js';

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
        : `Say who you are in ${configPath()} under \`identity:\``) +
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
/*
 * WHOSE WORDS, when a machine is typing.
 *
 * For a month every sentence an agent typed was recorded under the person
 * it worked for with `via: agent` beside the name - and since nearly every
 * sentence in a thread is one the agent typed, the board filled with
 * "topher via agent" over paragraphs Topher never wrote (2026-09-17). The
 * instruction was his; the words were not, and a record that names him as
 * author of them is the fiction n-0139 was trying to end from the other
 * side.
 *
 * So `via` now answers a narrower question. A machine typing its OWN words
 * is the agent, and records as `agent` - the same author a finding or an
 * observation already had. A machine RELAYING a person's words - what they
 * said in a chat, pasted as typed - records them under the person with
 * `via` beside the name, and anything it put in beyond their words goes in
 * `added`, apart, marked as its own. Attribution follows the words.
 *
 * `via` still only ever subtracts authority: the agent's own name accepts
 * nothing, and a relayed message carries the machine's mark.
 */
const whoseWords = (who, { via = null, said = null, body = null, added = null }) => {
  if (!via) return { author: asWho(who.username), body, via: null, added: null };
  if (said?.trim()) return { author: asWho(who.username), body: said, via, added };
  if (added?.trim()) throw new Error('`added` goes beside a person\'s words - say what they said (`said`)');
  // Its own words. A machine naming itself more precisely than "agent"
  // keeps that name beside the author; the plain word would say nothing.
  return { author: 'agent', body, via: via === 'agent' ? null : via, added: null };
};

/**
 * Open a thread: assign its id, stamp author and time, file it open.
 *
 * A note says why it exists (ADR 0005 §1), and the reason decides two things
 * here. WHO SIGNS IT: a finding or an observation is the machine's own
 * account of what it saw, authored `agent` and never under the person whose
 * machine it ran on. And WHETHER IT IS OPEN: a decision is a record, filed
 * closed as `recorded`, and enters no queue.
 *
 * Beyond those, the author follows the words (whoseWords): a machine's own
 * words are the agent's, a person's words it relays (`said`) are the
 * person's with the machine's mark beside them and its addition apart.
 */
/*
 * The choices a question offers, as data rather than prose. A person picks
 * one on the rule and the answer records the label (`chosen`), so the
 * question reads as one ask with its ways out drawn beneath it - not three
 * paragraphs a reader has to find the fork in (q-0257, q-0262; Topher,
 * 2026-09-19: "the agent specifies the questions one at a time and the
 * user responds to each"). Two to six, each a short label and, if it
 * helps, a why; the labels are what the answer names, so they are unique.
 */
function askOptions(kind, options) {
  if (options == null) return null;
  if (kind !== 'question') throw new Error('options are the choices a QUESTION offers; a note offers none');
  if (!Array.isArray(options) || options.length < 2 || options.length > 6)
    throw new Error('options are two to six choices, each { label, why? }');
  const out = options.map((o) => {
    const label = typeof o?.label === 'string' ? o.label.trim() : '';
    if (!label || label.length > 80) throw new Error('every option needs a label - a short line a person can pick');
    const why = typeof o.why === 'string' && o.why.trim() ? o.why.trim() : null;
    return { label, ...(why ? { why } : {}) };
  });
  if (new Set(out.map((o) => o.label)).size !== out.length) throw new Error('two options share a label - the answer names one, so each label is its own');
  return out;
}

export function openThread(blueprint, { kind, body, anchor, via = null, reason = null, said: relayed = null, added = null, options = null }) {
  const choices = askOptions(kind, options);
  /*
   * The last door. A body of nothing but format characters looks empty on
   * every screen and is not empty to `trim()`, which is how a single U+200B
   * satisfied the panel's fail-requires-why gate and filed a note that renders
   * as an author, a timestamp and a blank line (n-0203). Refused here as well
   * as at the gate, so a client that gets it wrong cannot put one in.
   */
  if (!saysSomething(body)) throw new Error('a thread needs a body — say what was seen');
  const who = whoIsActing(blueprint);
  // A reason nobody said - absent, empty, or blank - is unsaid, and the
  // default answers for it. An empty string once slipped past both the
  // default (`??`) and the vocabulary (falsy) and filed a note with no
  // reason at all, which read as the person's feedback (n-0295).
  const said = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
  if (reason != null && said === null && !(typeof reason === 'string'))
    throw new Error(`unknown reason "${String(reason)}" — one of ${THREAD_REASONS.join(', ')}`);
  if (kind === 'question' && said) throw new Error('a question carries no reason; only a note does');
  // A machine's own words are an observation unless it says otherwise; a
  // person's, relayed or not, are feedback.
  const why = kind === 'question' ? null : (said ?? defaultReason({ kind, via: relayed?.trim() ? null : via, author: who.username }));
  if (why && !THREAD_REASONS.includes(why))
    throw new Error(`unknown reason "${why}" — one of ${THREAD_REASONS.join(', ')}`);
  const machinesOwn = why === 'finding' || why === 'observation';
  const words = machinesOwn
    ? { author: 'agent', body, via: null, added: null }
    : whoseWords(who, { via, said: relayed, body, added });
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
  // The element's id, never a selector for it (lib/anchor-id.js).
  if (typeof anchor?.element === 'string')
    anchor = { ...anchor, element: anchorId(anchor.element, blueprint.config?.embed?.anchor_attribute ?? 'data-testid') };
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
      ...(why ? { reason: why } : {}),
      author: words.author,
      // Provenance beside attribution, never instead of it: an agent relaying
      // a person's words records under the person and says a machine typed it.
      ...(words.via ? { via: words.via } : {}),
      created: isoNow({ ms: true }),
      anchor,
      status: why === 'decision' ? 'recorded' : 'open',
      body: words.body,
      ...(words.added?.trim() ? { added: words.added.trim() } : {}),
      ...(choices ? { options: choices } : {}),
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
 * beyond having a name to write down. `said` is a person's words a machine
 * is relaying; `body` is then what the machine added beside them.
 */
export function reply(blueprint, id, { body, via = null, said = null, added = null }) {
  const who = whoIsActing(blueprint);
  const words = whoseWords(who, { via, said, body, added });
  return { thread: replyThread(blueprint, id, words), by: who, as: words.author };
}

/**
 * Move a thread through its lifecycle. The lifecycle guards live in
 * threads.js - which flows are legal, what needs a reason, that an actor
 * called "agent" may not accept - and the guard about this MACHINE lives
 * here, because it is the same question the CLI and the API were each
 * answering separately.
 *
 * A machine moving a thread acts as itself: the reason it gives for a
 * reopen is its own sentence, so it is recorded under `agent`, and the
 * human-only endings refuse it by that name as they always did.
 */
export function transition(blueprint, id, { status, reason, via = null, chosen = null }) {
  const who = whoIsActing(blueprint);
  if (HUMAN_ONLY.includes(status)) mustBeDeclared(who, status);
  const actor = via ? 'agent' : who.username;
  return {
    thread: moveThread(blueprint, id, { status, actor, reason, via: via === 'agent' ? null : via, chosen }),
    by: who,
    as: actor,
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
export function mutateThread(
  blueprint,
  id,
  { body = null, status = null, reason, via = null, said = null, added = null },
) {
  const who = whoIsActing(blueprint);
  if (status && HUMAN_ONLY.includes(status)) mustBeDeclared(who, status);
  const words = body !== null || said !== null ? whoseWords(who, { via, said, body, added }) : null;
  // A machine moving a thread does so as itself; relaying a person's words
  // does not make the move theirs.
  const actor = via ? 'agent' : who.username;
  const moveVia = via === 'agent' ? null : via;
  // Ask the lifecycle first, while nothing has been written.
  const before = status ? getThread(blueprint, id) : null;
  if (status && before) checkTransition(before, { status, actor, reason, via: moveVia });
  let thread = null;
  if (words) thread = replyThread(blueprint, id, words);
  if (status) thread = moveThread(blueprint, id, { status, actor, reason, via: moveVia });
  return { thread, by: who, as: words?.author ?? actor, was: before?.status ?? null };
}

/** Put an open question off until later: the person's own queue, reordered. */
export function defer(blueprint, id) {
  return { thread: deferThread(blueprint, id), by: whoIsActing(blueprint) };
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
export function finishWalkdown(blueprint, { target, baseUrl, roles, signatures, results }) {
  const who = whoIsActing(blueprint);
  mustBeDeclared(who, 'a walkdown');
  const { record } = writeRunRecord({
    blueprintDir: blueprint.dir,
    // Already resolved when the blueprint was loaded; re-asking from this
    // process's cwd would answer about a different tree.
    runsDir: blueprint.at?.runs?.path,
    // git_sha is about the CODE this verdict judged, never the home the
    // blueprint sits in (n-0190, n-0192).
    codeRoot: blueprint.codeRoot,
    target,
    baseUrl,
    actor: who.username,
    roles,
    signatures,
    kind: 'walkdown',
    results,
  });
  clearDraft(blueprint.at.drafts.path, target);
  /*
   * The look the threads were waiting for (ADR 0005 §2, §3). A pass on a
   * rule closes the findings and the person's own feedback addressed on it
   * before this moment, under the signer's name: they judged the rule, and
   * the rule is what the notes were about. Only a signed pass - a walkdown
   * signed in no role accepts nothing, and neither does an approval of the
   * wording or a skip.
   */
  const signed = Array.isArray(signatures) && signatures.some((s) => s?.role);
  const closed = [];
  if (signed)
    for (const r of results ?? [])
      if (r?.status === 'pass' && r.rule)
        closed.push(
          ...closeByVerdict(blueprint, {
            rule: r.rule,
            signer: who.username,
            runId: record.run_id,
            created: record.created,
          }),
        );
  return /** @type {Record<string, any>} */ ({ ...record, closed });
}
