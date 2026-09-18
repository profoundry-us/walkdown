import { parseArgs } from 'node:util';
import { collectRules, loadBlueprint } from '../../lib/blueprint.js';
import { defaultActor } from '../../lib/identity.js';
import { anchorText, paintStatus } from '../../lib/report/threads.js';
import { dim } from '../../lib/report/tty.js';
import { getThread } from '../../lib/threads.js';
import { whenIn } from '../../lib/time.js';
import { saysSomething, THREAD_KINDS } from '../../lib/vocab.js';
import { mutateThread, openThread } from '../../lib/writes.js';
import { end, loadOrExit } from './context.js';

export function run(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      blueprint: { type: 'string' },
      json: { type: 'boolean', default: false },
      reply: { type: 'string' },
      status: { type: 'string' },
      verify: { type: 'boolean', default: false },
      reopen: { type: 'boolean', default: false },
      waive: { type: 'boolean', default: false },
      reason: { type: 'string' },
      'as-agent': { type: 'boolean', default: false },
      said: { type: 'string' },
      added: { type: 'string' },
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
      'Usage: walkdown thread <id> [--reply <text>] [--status <s>|--verify|--reopen|--waive] [--reason <text>] [--as-agent [--said <text>] [--added <text>]]\n' +
        '       walkdown thread new --rule <id> --body <text> [--kind note|question] [--reason feedback|finding|observation|request|decision] [--screen <id>] [--element <sel>] [--as-agent [--said <text>] [--added <text>]]',
    );
    process.exit(2);
  }
  let blueprint = loadOrExit(values.blueprint);

  /*
   * Who this runs as is not an argument. There was a `--actor <name>` here,
   * and a WALKDOWN_ACTOR beside it, on the premise that the caller might be
   * somebody other than the person whose machine this is - which is exactly
   * backwards. An agent working here IS working for the person who asked it
   * to; it acts on their behalf and records under their name, and a flag that
   * lets any caller type a name is not attribution, it is a text field
   * (n-0139).
   *
   * The identity itself is resolved by lib/writes.js, which every interface
   * writes through - this reads the same answer only to REPORT it, since a
   * command that changes something has to say whose name went on the change.
   * The only thing this door says about who is acting is `--as-agent`:
   * provenance, and the one deviation that matters. It says a machine typed
   * this, and it can only ever subtract authority.
   */
  const who = defaultActor(blueprint.codeRoot ?? blueprint.projectRoot);
  const actor = who.username?.trim() || 'unknown';
  const via = values['as-agent'] ? 'agent' : null;
  /*
   * WHOSE WORDS. With --as-agent alone the words are the machine's own and
   * record as `agent`. --said carries a person's words as they typed them,
   * recorded under the person with the machine's mark beside them; --added
   * is what the machine put beside those words, kept apart from them
   * (lib/writes.js, whoseWords). Neither means anything without --as-agent,
   * and --said is a reply of its own - --reply beside it would be two
   * bodies for one message.
   */
  if ((values.said !== undefined || values.added !== undefined) && !via) {
    console.error('--said and --added say what a machine relayed and added; they go with --as-agent');
    process.exit(2);
  }
  if (values.added !== undefined && values.said === undefined) {
    console.error('--added goes beside a person\'s words - say what they said with --said');
    process.exit(2);
  }
  if (values.said !== undefined && values.reply !== undefined) {
    console.error('--said is the message; what the machine adds to it goes in --added, not --reply');
    process.exit(2);
  }
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
  const replying = values.reply !== undefined || (id !== 'new' && values.said !== undefined);

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
    // Not `trim()` alone: a body of nothing but format characters is a thread
    // that renders as a blank line, which is what n-0203 walked in through.
    // A relayed thread's body is what the person said; --body beside --said
    // would be two bodies for one message.
    if (values.said !== undefined && values.body !== undefined) {
      console.error('--said is the body of a relayed thread; what the machine adds goes in --added, not --body');
      process.exit(2);
    }
    const body = saysSomething(values.body ?? values.said) ? (values.body ?? values.said).trim() : '';
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
    // A judge files a finding, an agent in passing an observation, a person
    // feedback, a request, or a decision (ADR 0005 §1). Left unsaid, a machine's
    // note is an observation and a person's is feedback. The same flag that
    // carries a waive's sentence carries this one word on `new`.
    const reason = values.reason ?? null;
    const { id: opened, thread } = openThread(blueprint, {
      kind,
      body,
      anchor,
      via,
      reason,
      said: values.said ?? null,
      added: values.added ?? null,
    });
    // Whose name went on it is the record's answer, not this door's guess.
    const by = thread.author;
    const marked = thread.via ?? null;
    if (values.json) {
      console.log(
        JSON.stringify({ id: opened, kind, status: thread.status, by, ...(marked ? { via: marked } : {}), anchor }),
      );
      return end(0);
    }
    console.log(`✓ ${opened} opened · ${kind} · by ${by}${marked ? dim(` (via ${marked})`) : ''}`);
    console.log(dim(`  ${anchorText(anchor)}`));
    console.log(dim(`  walkdown thread ${opened} reads it in full`));
    return end(0);
  }

  const mutating = Boolean(replying || status);
  // What it was before we touched it, so the command can say what it changed
  // rather than only what the thread now happens to say.
  const was = mutating ? getThread(blueprint, id) : null;
  // Whose name the change went under - the record's answer, read back from
  // the write rather than guessed here (n-0125; and since 2026-09-17 a
  // machine's own words are the agent's, not the person's).
  let under = actor;
  if (mutating) {
    try {
      /*
       * One ask, one call. The reply and the transition used to be issued
       * separately from here, with the rule that a refused status must refuse
       * the WHOLE command living in this file - so the ordering that keeps a
       * refused transition from stranding its reply was the terminal's
       * property rather than the ask's. It belongs to the ask
       * (ownership.writes.spec-never-implementation), and a second interface
       * now inherits it instead of rediscovering it (n-0125).
       */
      ({ as: under } = mutateThread(blueprint, id, {
        ...(values.reply !== undefined ? { body: values.reply } : {}),
        ...(values.said !== undefined ? { said: values.said } : {}),
        ...(values.added !== undefined ? { added: values.added } : {}),
        ...(status ? { status } : {}),
        reason: values.reason,
        via,
      }));
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
    // The mark beside the name is only drawn where the record carries it:
    // a machine's own words are the agent's and need no "via".
    const marked = via && under !== 'agent' ? via : null;
    if (values.json) {
      console.log(
        JSON.stringify({
          id: t.id,
          was: was?.status ?? null,
          status: t.status,
          moved: Boolean(status),
          by: under,
          ...(marked ? { via: marked } : {}),
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
    parts.push(`by ${under}${marked ? ` (via ${marked})` : ''}`);
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
  // The record holds UTC; the reader's clock is theirs (n-0290).
  const at = (m) => dim(` · ${m?.created ? whenIn(m.created, who.timezone) : 'undated'}`);
  console.log(dim(`  ${t.author ?? 'unknown'}`) + saidVia(t) + at(t));
  console.log(
    `\n  ${String(t.body ?? '')
      .trim()
      .replace(/\n/g, '\n  ')}`,
  );
  // What a machine added beside a person's words, apart from them and
  // marked as its own.
  const addition = (m, pad) =>
    m?.added ? `\n${pad}${dim('┆ agent added:')}\n${pad}${dim('┆')} ${String(m.added).trim().replace(/\n/g, `\n${pad}${dim('┆')} `)}` : '';
  console.log(addition(t, '  ').replace(/^\n/, ''));
  for (const r of t.replies ?? []) {
    console.log(
      dim(`\n  ↳ ${r.author ?? 'unknown'}`) + saidVia(r) + at(r),
    );
    console.log(
      `    ${String(r.body ?? '')
        .trim()
        .replace(/\n/g, '\n    ')}${addition(r, '    ')}`,
    );
  }
  return end(0);
}
