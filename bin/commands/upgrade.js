/*
 * `walkdown upgrade` - move walkdown's files to the layout ADR 0014 settled,
 * once, when a person runs it. lib/upgrade.js holds what moves; this says
 * it, step by step, and with `--dry-run` says it without moving anything.
 */
import { existsSync } from 'node:fs';
import { basename, dirname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultActor } from '../../lib/identity.js';
import { canon, expand, gitRoot, readRegistry } from '../../lib/locations.js';
import { dim, green, red } from '../../lib/report/tty.js';
import { planUpgrade, runUpgrade } from '../../lib/upgrade.js';
import { end } from './context.js';

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      'dry-run': { type: 'boolean', default: false },
      code: { type: 'string' },
      'layout-only': { type: 'boolean', default: false },
    },
  });
  /*
   * The code of the project standing here, chosen rather than derived from
   * its label (`--code ac` for acme_main, which would derive `am`). Asked
   * for here because the upgrade is what gives an existing project its code.
   */
  const code = values.code === undefined ? null : values.code.trim().toLowerCase();
  if (code !== null && !/^[a-z0-9]{2,3}$/.test(code)) {
    console.error(
      red(
        `✗ \`${values.code}\` is not a project code — two or three lowercase letters or digits. Nothing was changed.`,
      ),
    );
    return end(2);
  }
  // Asked before anything moves: a refusal halfway would leave the machine
  // half upgraded (n-0514).
  if (code !== null) {
    const top = gitRoot(process.cwd());
    if (!top) {
      console.error(
        red(
          '✗ `--code` names the code of the project you run this in, and this is no repository. Nothing was changed.',
        ),
      );
      return end(2);
    }
    const holder = readRegistry().rows.find(
      (r) => r?.code === code && r.checkout && canon(expand(String(r.checkout))) !== canon(top),
    );
    if (holder) {
      console.error(
        red(
          `✗ The project code \`${code}\` is already the project \`${holder.project}\`'s. Nothing was changed.`,
        ),
      );
      console.error(dim('  Choose another with `--code <two or three letters>`.'));
      return end(2);
    }
  }
  /*
   * `--layout-only` leaves the designs where they are (ADR 0015): the hooks
   * that keep a cached home current pass it, because they run against a
   * real checkout and must never move what a person draws.
   */
  const designs = !values['layout-only'];
  const { steps } = planUpgrade({ designs });
  if (!steps.length && code !== null) {
    console.error(
      red(
        `✗ Nothing to upgrade, so \`--code ${code}\` was not used: a project's code is chosen when it is first registered or upgraded. Nothing was changed.`,
      ),
    );
    return end(2);
  }
  if (!steps.length) {
    console.log(
      dim(
        "Nothing to upgrade — walkdown's files are already laid out the way this version keeps them.",
      ),
    );
    return end(0);
  }
  if (values['dry-run']) {
    console.log('Dry run. This is what `walkdown upgrade` would do to every blueprint.');
    const layout = steps.filter((s) => !s.designs && !s.redlines);
    if (layout.length) {
      console.log('');
      for (const s of layout) console.log(`  · ${s.what}`);
    }
    sayDesigns(steps);
    console.log('\nNothing was moved or removed. To do it, run:');
    console.log('  walkdown upgrade');
    return end(0);
  }
  try {
    runUpgrade({ code, designs, say: (what) => console.log(`  ${green('✓')} ${what}`) });
  } catch (e) {
    console.error(red(`✗ ${e.message}`));
    console.error(
      dim(
        '  The steps above landed; the rest did not. Run `walkdown upgrade` again once that is put right.',
      ),
    );
    return end(2);
  }
  const kept = steps.flatMap((s) => (s.designs?.kept.length ? [s.designs] : []));
  if (kept.length) {
    console.log('');
    sayKept(kept);
  }
  console.log(
    steps.some((s) => s.designs)
      ? '\n✓ Upgraded. Every design is in a folder of its screen, and every verdict is where it was.'
      : '\n✓ Upgraded. Every folder kept its name, and every verdict is where it was.',
  );
  return end(0);
}

/* Lines padded into columns, as the design lays out a group of moves. */
function columns(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(w[i]) : c)).join('   '));
}

const andList = (xs) =>
  xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** The designs half of a dry run (locations.keeping.upgrade-moves-prototypes). */
function sayDesigns(steps) {
  const plans = steps.flatMap((s) => (s.designs ? [s.designs] : []));
  const redlines = steps.flatMap((s) => (s.redlines ? [s.redlines] : []));
  const moving = plans.filter((p) => p.moves.length || p.keys || p.proposalKeys || p.specRoot);
  if (moving.length) {
    const roots = [...new Set(moving.map((p) => p.newSaid))];
    console.log('');
    console.log(
      `Designs move into ${roots.length === 1 ? roots[0] : 'designs/'}, a folder per screen, each dated by its first commit:`,
    );
    let vN = false;
    for (const p of moving) {
      console.log(`  ${p.name}`);
      if (p.moves.length)
        for (const line of columns(
          p.moves.map((m) => [
            `→ ${p.show(m.from)}`,
            `becomes ${p.show(m.to)}`,
            `${m.kind === 'accepted' ? 'accepted' : `proposed on ${m.request.data.id}`}${m.uncommitted ? ', not committed, so dated today' : ''}`,
          ]),
        ))
          console.log(`    ${line}`);
      vN ||= p.moves.some((m) => /-v\d+\.html$/.test(m.to));
      const accepted = new Set(p.moves.filter((m) => m.kind === 'accepted').map((m) => m.screen))
        .size;
      if (accepted)
        console.log(
          `    The storyboard is repointed at the ${accepted} accepted version${accepted === 1 ? '' : 's'}.`,
        );
      if (p.others.length)
        console.log(
          `    ${p.others.length} other file(s) beside them move to ${p.newSaid} as they are.`,
        );
      if (p.keys)
        console.log(
          `    storyboard.yml: ${p.keys} prototype: key${p.keys === 1 ? '' : 's'} become${p.keys === 1 ? 's' : ''} design:`,
        );
      if (p.proposalKeys)
        console.log(
          `    storyboard.yml: ${p.proposalKeys} proposal: key${p.proposalKeys === 1 ? ' goes' : 's go'}; the request names its version now`,
        );
      if (p.specRoot)
        console.log(`    spec.yml: prototype.root becomes design.root, set to ${p.newSaid}`);
    }
    if (vN)
      console.log('  Two versions of a screen first committed the same day are told apart by -v2.');
  }
  const removing = plans.filter((p) => p.removed.length || p.emptiedSaid?.length);
  if (removing.length) {
    console.log('');
    console.log(
      'Removed, because no screen or pending request names them. They stay in git history:',
    );
    for (const p of removing) {
      console.log(`  ${p.name}`);
      for (const f of p.removed) console.log(`    × ${p.show(f)}`);
      const dirs = (p.emptiedSaid ?? []).map((d) => `${p.show(d)}/`);
      if (dirs.length)
        console.log(
          `    × ${dirs.join(', ')}, once ${dirs.length === 1 ? 'it is' : 'they are'} empty`,
        );
    }
  }
  const keeping = plans.filter((p) => p.kept.length);
  if (keeping.length) sayKept(keeping);
  if (redlines.length) {
    console.log('');
    console.log('Redlines become threads:');
    for (const r of redlines) {
      const who = defaultActor(r.base).username ?? 'nobody';
      const screens = [...new Set(r.notes.map((n) => n.screen))];
      const file = relative(r.base, r.file);
      console.log(`  ${r.blueprint.config?.blueprint ?? basename(r.blueprint.dir)}`);
      console.log(
        `    → ${file}'s ${r.notes.length} note${r.notes.length === 1 ? '' : 's'} become${r.notes.length === 1 ? 's' : ''} ${r.notes.length} redline thread${r.notes.length === 1 ? '' : 's'}, on ${andList(screens)},`,
      );
      console.log(
        r.strays.length
          ? `      filed closed in ${who}'s name. ${r.strays.length} note(s) on screens no storyboard holds stay in ${file}.`
          : `      filed closed in ${who}'s name. Then ${file} is removed.`,
      );
    }
  }
}

/** What git does not hold, and so is left where it is. */
function sayKept(plans) {
  console.log(
    `Kept, because git does not hold ${plans.flatMap((p) => p.kept).length === 1 ? 'it' : 'them'}:`,
  );
  for (const p of plans) {
    console.log(`  ${p.name}`);
    for (const f of p.kept) {
      console.log(`    ! ${p.show(f)} KEPT`);
      console.log(
        `      It has no history, so the upgrade leaves it where it is, and ${p.show(dirname(f))}/ stays with it.`,
      );
      console.log('      Commit it to have it moved or removed next time, or delete it yourself.');
    }
  }
}
