/**
 * A refusal walkdown WROTE, as distinct from an error nobody thought about.
 *
 * The convention here has always been that a mistake a person can act on
 * reaches them as one sentence — what was wrong, and what to do — while a
 * genuine bug reaches them as a stack trace, because that is what a stack
 * trace is for. Commands enforced that one at a time by catching their own
 * failures, which works right up until the failure comes from three layers
 * down: n-0215 gave the unreadable-spec-file case its sentence, and it still
 * arrived under `file:///…/lib/hash.js:122`, a caret and four stack frames,
 * because nothing between there and the terminal knew the difference between
 * a sentence and a crash (n-0217).
 *
 * So the marker travels with the error. Throw one of these when the message
 * is finished prose for a person; bin/walkdown.js prints it and stops. Throw
 * an ordinary Error when the message is for whoever has to debug walkdown.
 */
export class Refused extends Error {}
