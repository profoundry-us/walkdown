/*
 * Every write a browser can cause, in one module short enough to read whole.
 *
 * The law is q-0019's second decision: through the review server a browser
 * writes SPECIFICATION and only specification - a thread, a draft, a run
 * record. Never implementation: no request creates or modifies features,
 * prototypes, source or checks, because the browser captures intent and the
 * agent structures it. The six functions below are the complete list; a write
 * that does not pass through here is a bug with a name
 * (ownership.writes.spec-never-implementation).
 *
 * It exists as ONE module because the boundary used to be implicit across a
 * 450-line request handler, and n-0121 records what that cost: four separate
 * author-defaulting bugs, found one per judging pass, each fixed as if it
 * were the last. The defaulting is now a single policy, applied where the
 * write happens.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { stringify } from '../vendor/yaml.js';
import { clearDraft, writeDraft } from './draft.js';
import { writeRunRecord } from './run-record.js';
import { transitionThread as moveThread, replyToThread as replyThread } from './threads.js';
import { threadPrefix } from './vocab.js';

/*
 * The one author policy. A missing author falls back to the machine's
 * username - the server cannot know who is at a browser that did not say -
 * and it happens HERE, once, so a new writer cannot re-invent the handoff
 * that n-0121 found four times. Whether the server should instead refuse is
 * that thread's open question; until it is decided there is one place to
 * decide it in.
 */
const asWho = (author) => author || userInfo().username;

const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** Next thread id: n-0001 / q-0001 style, scanning existing thread files. */
function nextThreadId(blueprintDir, kind) {
  const dir = join(blueprintDir, 'threads');
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
export function openThread(blueprint, { kind, body, anchor, author }) {
  const id = nextThreadId(blueprint.dir, kind);
  const thread = {
    id,
    kind,
    author: asWho(author),
    created: isoNow(),
    anchor,
    status: 'open',
    body,
  };
  writeFileSync(join(blueprint.dir, 'threads', `${id}.yml`), stringify(thread));
  return { id, thread };
}

/** Append a reply. The transition guard lives in threads.js; the author policy here. */
export const reply = (blueprint, id, { author, body }) =>
  replyThread(blueprint, id, { author: asWho(author), body });

/**
 * Move a thread through its lifecycle. No author default on purpose: a
 * transition's actor is validated by threads.js (verified/waived demand a
 * named human), and defaulting it here would hand "verified by whoever owns
 * this laptop" to a request that said nothing.
 */
export const transition = (blueprint, id, { status, actor, reason }) =>
  moveThread(blueprint, id, { status, actor, reason });

/** Save the sitting in progress. A draft is working state, never a verdict. */
export const saveDraft = (blueprint, draft) => writeDraft(blueprint.dir, draft);

/** Discard it - an emptied session and an explicit discard are the same thing. */
export const discardDraft = (blueprint, target) => clearDraft(blueprint.dir, target);

/**
 * Seal a walkdown: append the run record, delete the draft. One write, one
 * delete - never both shapes of the same session on disk.
 */
export function finishWalkdown(blueprint, { target, baseUrl, actor, roles, results }) {
  const { record } = writeRunRecord({
    blueprintDir: blueprint.dir,
    target,
    baseUrl,
    actor,
    roles,
    kind: 'walkdown',
    results,
  });
  clearDraft(blueprint.dir, target);
  return record;
}
