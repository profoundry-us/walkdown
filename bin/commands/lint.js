import { parseArgs } from 'node:util';
import { lint } from '../../lib/lint.js';
import { dim, green, red, yellow } from '../../lib/report/tty.js';
import { eachOrExit, end, sectionHead } from './context.js';

export function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      blueprint: { type: 'string' },
      checks: { type: 'boolean', default: true },
      json: { type: 'boolean', default: false },
    },
    allowNegative: true,
  });
  const each = eachOrExit(values.blueprint);
  const several = each.length > 1;
  if (values.json) {
    const answers = each.map(({ id, blueprint }) => {
      const { findings, summary, exitCode } = lint(blueprint, { checks: values.checks });
      return { id, findings, summary, exitCode };
    });
    const worst = Math.max(...answers.map((a) => a.exitCode));
    const one = ({ findings, summary }) => ({ findings, summary });
    console.log(
      JSON.stringify(
        several ? { blueprints: answers.map((a) => ({ id: a.id, ...one(a) })) } : one(answers[0]),
        null,
        2,
      ),
    );
    return end(worst);
  }
  let worst = 0;
  each.forEach(({ id, blueprint }, i) => {
    if (several) console.log(`${i ? '\n' : ''}${sectionHead(id)}\n`);
    worst = Math.max(worst, report(blueprint, values));
  });
  return end(worst);
}

/* One blueprint's lint, printed; its exit code returned. */
function report(blueprint, values) {
  const { findings, summary, exitCode } = lint(blueprint, { checks: values.checks });

  console.log(dim(`walkdown lint — ${blueprint.dir}\n`));
  for (const level of ['error', 'warn']) {
    const group = findings.filter((f) => f.level === level);
    if (!group.length) continue;
    console.log(level === 'error' ? red('ERRORS') : yellow('WARNINGS'));
    for (const f of group) {
      const where = [f.file, f.subject].filter(Boolean).join(' › ');
      console.log(
        `  ${level === 'error' ? red('✗') : yellow('⚠')} [${f.category}] ${where ? `${where}: ` : ''}${f.message}`,
      );
    }
    console.log('');
  }
  const s = summary;
  const counts = `${s.rules} rules, ${s.screens} screens, ${s.anchors} anchors, ${s.threads} threads, ${s.runs} runs`;
  const verdict = s.errors ? red(`${s.errors} error(s)`) : green('0 errors');
  console.log(
    `${s.errors ? red('✗') : green('✓')} ${counts} — ${verdict}, ${s.warnings} warning(s)`,
  );
  return exitCode;
}
