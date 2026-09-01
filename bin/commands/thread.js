import { parseArgs } from 'node:util';
import { collectRules, loadBlueprint } from '../../lib/blueprint.js';
import { defaultActor } from '../../lib/identity.js';
import { anchorText, paintStatus } from '../../lib/report/threads.js';
import { dim } from '../../lib/report/tty.js';
import { checkTransition, getThread, replyToThread, transitionThread } from '../../lib/threads.js';
import { HUMAN_ONLY, THREAD_KINDS } from '../../lib/vocab.js';
import { openThread } from '../../lib/writes.js';
import { end, loadOrExit } from './context.js';

export function run(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      json: { type: 'boolean', default: false },
      reply: { type: 'string' },
      status: { type: 'string' },
      verify: { type: 'boolean', default: false },
      reopen: { type: 'boolean', default: false },
      waive: { type: 'boolean', default: false },
      reason: { type: 'string' },
      'as-agent': { type: 'boolean', default: false },
      kind: { type: 'string' },
      rule: { type: 'string' },
      screen: { type: 'string' },
      element: { type: 'string' },
      body: { type: 'string' },
    },
    allowPositionals: true,
  });
  const id = positionals[0];
  if (!id) {
    console.error(
      'Usage: walkdown thread <id> [--reply <text>] [--status <s>|--verify|--reopen|--waive] [--reason <text>] [--as-agent]\n' +
        '       walkdown thread new --rule <id> --body <text> [--kind note|question] [--screen <id>] [--element <sel>] [--as-agent]',
    );
    process.exit(2);
  }
  let blueprint = loadOrExit(values.dir);

  /*
   * Who this runs as is not an argument. There was a `--actor <name>` here,
   * and a WALKDOWN_ACTOR beside it, on the premise that the caller might be
   * somebody other than the person whose machine this is - which is exactly
   * backwards. An agent working here IS working for the person who asked it
   * to; it acts on their behalf and records under their name, and a flag that
   * lets any caller type a name is not attribution, it is a text field
   * (n-0139).
   *
   * So the identity comes from the personal config, and the only thing a
   * caller may say about who is acting is `--as-agent` - provenance, and the
   * one deviation that matters: it says a machine typed this. It can only
   * ever subtract authority.
   */
  const who = defaultActor(blueprint.codeRoot ?? blueprint.projectRoot);
  const actor = who.username?.trim() || 'unknown';
  const via = values['as-agent'] ? 'agent' : null;
  /*
   * SAID versus INHERITED, which outlives the flag that used to answer it. An
   * acceptance may not ride on a guess: a machine login name is what this box
   * is called, not a signature, and a bare --verify accepting under it is
   * n-0130. What counts as said is now the identity block in the personal
   * config - a person wrote it down, or asked for it to be written.
   */
  const explicit = who.declared;
  const status = values.verify
    ? 'verified'
    : values.reopen
      ? 'open'
      : values.waive
        ? 'waived'
        : values.status;
  /*
   * Present, not truthy: `--reply "$MSG"` with an empty variable is still a
   * mutation ask, and answering it with read output - or applying the status
   * while silently dropping the reply - is the round-three finding on
   * n-0125. An empty body reaches replyToThread and gets its refusal.
   */
  const replying = values.reply !== undefined;

  /*
   * `thread new` opens a thread from the CLI - the door that was missing.
   * Filing a finding used to take a running serve (POST /api/threads) or a
   * hand-edited YAML, and this project forbids the second; the mutation
   * commands and the creation belong behind the same front door. Opening is
   * claiming, never accepting, so the ordinary actor chain applies.
   */
  if (id === 'new') {
    if (replying || status) {
      console.error('thread new opens a thread; --reply and the status flags act on one that exists.');
      process.exit(2);
    }
    const kind = values.kind ?? 'note';
    if (!THREAD_KINDS.includes(kind)) {
      console.error(`kind must be ${THREAD_KINDS.join(' or ')}`);
      process.exit(2);
    }
    const body = values.body?.trim();
    if (!body) {
      console.error('a thread needs a body — say what was seen (--body <text>)');
      process.exit(2);
    }
    const rule = values.rule?.trim();
    if (!rule) {
      console.error('a thread needs an anchor — name the rule it is about (--rule <id>)');
      process.exit(2);
    }
    if (!collectRules(blueprint.features).some((r) => r.rule?.id === rule)) {
      console.error(`No rule "${rule}". \`walkdown status\` lists every rule.`);
      process.exit(2);
    }
    const anchor = {
      rule,
      ...(values.screen ? { screen: values.screen } : {}),
      ...(values.element ? { element: values.element } : {}),
    };
    const { id: opened, thread } = openThread(blueprint, { kind, body, anchor, author: actor, via });
    if (values.json) {
      console.log(
        JSON.stringify({ id: opened, kind, status: thread.status, by: actor, ...(via ? { via } : {}), anchor }),
      );
      return end(0);
    }
    console.log(`✓ ${opened} opened · ${kind} · by ${actor}${via ? dim(` (via ${via})`) : ''}`);
    console.log(dim(`  ${anchorText(anchor)}`));
    console.log(dim(`  walkdown thread ${opened} reads it in full`));
    return end(0);
  }

  const mutating = Boolean(replying || status);
  // What it was before we touched it, so the command can say what it changed
  // rather than only what the thread now happens to say.
  const was = mutating ? getThread(blueprint, id) : null;
  if (mutating) {
    try {
      if (status && HUMAN_ONLY.includes(status) && !explicit)
        throw new Error(
          `"${status}" is recorded under a person's name, and this machine only has a guess (${actor}, from ${who.source}). Say who you are in ~/.walkdown/config.yml under \`identity:\` — a login name is not a decision`,
        );
      // Validate the transition before ANY write: a refused status must
      // refuse the whole command, or the reply lands and the output denies it.
      if (status && was) checkTransition(was, { status, actor, reason: values.reason, via });
      if (replying) replyToThread(blueprint, id, { author: actor, body: values.reply, via });
      if (status) transitionThread(blueprint, id, { status, actor, reason: values.reason, via });
    } catch (err) {
      console.error(err.message);
      process.exit(2);
    }
    blueprint = loadBlueprint(blueprint.dir);
  }

  const t = getThread(blueprint, id);
  if (!t) {
    console.error(`No thread "${id}". \`walkdown threads --all\` lists every thread.`);
    process.exit(2);
  }
  if (values.json && !mutating) {
    console.log(JSON.stringify(t, null, 2));
    return end(0);
  }
  /*
   * A command that changed something reports the change, not the thread.
   * Printing the whole conversation back was right for a bare `walkdown
   * thread <id>` - that IS the ask - but after a mutation it buries the one
   * fact the caller needs, and a loop over five threads scrolls the answer off
   * the screen. Worse, it reads identically whether or not anything happened,
   * which is what drove people to chase it with a second command to check.
   */
  if (mutating) {
    const added = (t.replies ?? []).length - (was?.replies ?? []).length;
    /*
     * Who THIS change was recorded under is the invocation's actor - the
     * reply's author, or the transition's actor (a terminal transition just
     * recorded that same name). Preferring the thread's status holder here
     * named the waiver for someone else's reply (n-0125, round five); the
     * holder belongs to the read path below, where it is the record.
     */
    const under = actor;
    if (values.json) {
      console.log(
        JSON.stringify({
          id: t.id,
          was: was?.status ?? null,
          status: t.status,
          moved: Boolean(status),
          by: under,
          ...(via ? { via } : {}),
          replies_added: added,
        }),
      );
      return end(0);
    }
    const parts = [];
    if (status) parts.push(`${was?.status ?? '?'} → ${paintStatus(t.status)}`);
    else parts.push(`still ${paintStatus(t.status)}`);
    /*
     * Who it was recorded under, on every path - a name nobody read back is
     * how four attribution bugs stayed invisible (n-0125), and it is the line
     * that says `via agent` out loud too. Prefer what the thread recorded -
     * status-gated, because a reopened thread still carries the old
     * waived_by; the actor is what this invocation ran under either way.
     */
    parts.push(`by ${under}${via ? ` (via ${via})` : ''}`);
    if (added > 0) parts.push(`+${added} ${added === 1 ? 'reply' : 'replies'}`);
    console.log(`✓ ${t.id} ${parts.join(' · ')}`);
    console.log(dim(`  ${anchorText(t.anchor)}`));
    console.log(dim(`  walkdown thread ${t.id} reads it in full`));
    return end(0);
  }
  console.log(
    `${t.id} · ${t.kind} · ${paintStatus(t.status)}${
      t.status === 'waived' && t.waived_by
        ? dim(` by ${t.waived_by}`)
        : t.status === 'verified' && t.verified_by
          ? dim(` by ${t.verified_by}`)
          : ''
    }`,
  );
  console.log(dim(`  ${anchorText(t.anchor)}`));
  /*
   * Author, and how the words arrived. Provenance was written to disk and
   * rendered by nothing - the thread file carried `via: agent` while every
   * report showed the author alone, so the one reader who could have used it
   * never saw it (n-0142). A person typing is the ordinary case and stays
   * unannotated; a machine typing says so.
   */
  const saidVia = (m) => (m?.via ? dim(` · via ${m.via}`) : '');
  console.log(dim(`  ${t.author ?? 'unknown'}`) + saidVia(t) + dim(` · ${t.created ?? 'undated'}`));
  console.log(
    `\n  ${String(t.body ?? '')
      .trim()
      .replace(/\n/g, '\n  ')}`,
  );
  for (const r of t.replies ?? []) {
    console.log(
      dim(`\n  ↳ ${r.author ?? 'unknown'}`) + saidVia(r) + dim(` · ${r.created ?? 'undated'}`),
    );
    console.log(
      `    ${String(r.body ?? '')
        .trim()
        .replace(/\n/g, '\n    ')}`,
    );
  }
  return end(0);
}
