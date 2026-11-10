/*
 * Fixtures for the screens of ADR 0017: a project called `expenses`, at
 * ~/expenses, whose screens have setup steps and fixtures.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* ~/expenses with one blueprint, `expenses`: its spec folder, emptied of the sample feature. */
function expenses(m) {
  const dir = join(m.root, 'expenses');
  mkdirSync(join(dir, '.git'), { recursive: true });
  const wd = (args) => {
    const r = m.wd(args, dir);
    if (r.status !== 0)
      throw new Error(`fixture: walkdown ${args.join(' ')} exited ${r.status}\n${r.stderr}`);
    return r.stdout.trim();
  };
  wd(['blueprints', 'new', 'expenses']);
  const spec = wd(['where', 'spec', '--blueprint', 'expenses']);
  for (const f of readdirSync(join(spec, 'features'))) rmSync(join(spec, 'features', f));
  return { dir, spec, wd };
}

/* One rule per screen, so lint has nothing to say about a screen no rule names. */
function rulesFor(e, screens) {
  writeFileSync(
    join(e.spec, 'features', 'expenses.yml'),
    [
      'feature: expenses',
      'stories:',
      '  - id: expenses.view',
      '    title: Viewing an expense',
      '    statement: As a manager I open an expense.',
      '    rules:',
      ...screens.flatMap((id) => [
        `      - id: expenses.view.${id}`,
        `        statement: The ${id} screen shows the expense.`,
        '        verify: [checks]',
        `        screens: [${id}]`,
        '        steps:',
        '          then: [It does]',
      ]),
      '',
    ].join('\n'),
  );
  e.wd(['hash', '--write', '--blueprint', 'expenses']);
}

/* The spec's targets, written over whatever `blueprints new` left. */
function targets(e, yaml) {
  writeFileSync(
    join(e.spec, 'spec.yml'),
    ['blueprint: expenses', 'runner:', '  targets:', ...yaml.map((l) => `    ${l}`), ''].join('\n'),
  );
}

/* A screen with a design of its own, so lint asks for no design request. */
const screen = (id, lines) => [
  `  - id: ${id}`,
  `    title: ${id}`,
  `    design: /${id}/20261023.html`,
  ...lines.map((l) => `    ${l}`),
];

function storyboard(e, screens, recipes = []) {
  writeFileSync(
    join(e.spec, 'storyboard.yml'),
    ['screens:', ...screens.flat(), ...(recipes.length ? ['recipes:', ...recipes] : []), ''].join(
      '\n',
    ),
  );
}

const ORG_RECIPE = [
  '  as_view_only_org_manager:',
  '    - post: /dev/session',
  '      fields: { user_id: "{fixtures.view_only_org_manager}" }',
];
const LOCAL_ALL = [
  'local:',
  '  base_url: http://localhost:3000',
  '  fixtures: { expense_submitted: 412, view_only_team_manager: 18, view_only_org_manager: 22 }',
];

export default {
  /* Six screens: three whose setup runs, and three lint has something to say about. */
  'setup-steps'(m) {
    const e = expenses(m);
    targets(e, LOCAL_ALL);
    storyboard(
      e,
      [
        screen('expense-list', [
          'app: { path: /expenses, setup: Sign in as any manager first. }',
          'anchors: [expenses.list]',
        ]),
        screen('expense-view-only-team', [
          'app:',
          '  setup:',
          '    - visit: /dev/impersonate?id={fixtures.view_only_team_manager}',
          '    - post: /dev/team',
          '      fields: { team: finance }',
          '    - wait_for: nav.signed-in',
          '  path: /expenses/{fixtures.expense_submitted}',
          'anchors: [nav.signed-in]',
        ]),
        screen('expense-view-only-org', [
          'app:',
          '  setup: { recipe: as_view_only_org_manager }',
          '  path: /expenses/{fixtures.expense_submitted}',
          'anchors: [expense.view-only-note]',
        ]),
        screen('expense-approve', [
          'app:',
          '  setup:',
          '    - visit: /dev/impersonate?id={fixtures.view_only_team_manager}',
          '    - click: expense.approve',
          '  path: /expenses/{fixtures.expense_submitted}/approve',
          'anchors: [expense.approve]',
        ]),
        screen('expense-finance', [
          'app:',
          '  setup: { recipe: as_finance_admin }',
          '  path: /finance',
          'anchors: [finance.queue]',
        ]),
        screen('expense-receipt', [
          'app:',
          '  setup:',
          '    - visit: /dev/impersonate?id={fixtures.view_only_team_manager}',
          '    - visit: /expenses/{fixtures.expense_submitted}/receipt',
          '    - wait_for: receipt.preview',
          '  path: /expenses/{fixtures.expense_submitted}/receipt',
          'anchors: [receipt.image, receipt.total, receipt.download]',
        ]),
      ],
      ORG_RECIPE,
    );
    rulesFor(e, [
      'expense-list',
      'expense-view-only-team',
      'expense-view-only-org',
      'expense-approve',
      'expense-finance',
      'expense-receipt',
    ]);
  },

  /* One screen using two fixtures: staging gives both, review one, local none. */
  'fixture-missing'(m) {
    const e = expenses(m);
    targets(e, [
      'local:',
      '  base_url: http://localhost:3000',
      'review:',
      '  base_url: https://review.acme.test',
      '  fixtures: { expense_submitted: 9 }',
      'staging:',
      '  base_url: https://staging.acme.test',
      '  fixtures: { expense_submitted: 30871, view_only_team_manager: 77 }',
    ]);
    storyboard(e, [
      screen('expense-view-only-team', [
        'app:',
        '  setup:',
        '    - visit: /dev/impersonate?id={fixtures.view_only_team_manager}',
        '  path: /expenses/{fixtures.expense_submitted}',
        'anchors: [expense.view-only-note]',
      ]),
    ]);
    rulesFor(e, ['expense-view-only-team']);
  },

  /* Three pairs: two states of one page, a real tie, and two paths that only look alike. */
  'screens-tie'(m) {
    const e = expenses(m);
    targets(e, [
      'local:',
      '  base_url: http://localhost:3000',
      '  fixtures: { expense_submitted: 412, view_only_team_manager: 18, view_only_org_manager: 22, finance_admin: 3, my_expense: 418, team_expense: 415 }',
    ]);
    const at = (id, setup, path = '/expenses/{fixtures.expense_submitted}') =>
      screen(id, ['app:', `  setup: ${setup}`, `  path: ${path}`, `anchors: [${id}.body]`]);
    storyboard(
      e,
      [
        at('expense-view-only-team', '{ recipe: as_view_only_team_manager }'),
        at('expense-view-only-org', '{ recipe: as_view_only_org_manager }'),
        at('expense-approve', '{ recipe: as_finance_admin }'),
        at('expense-approve-confirm', '{ recipe: as_finance_admin }'),
        at('expense-mine', '{ recipe: as_finance_admin }', '/expenses/{fixtures.my_expense}'),
        at('expense-team', '{ recipe: as_finance_admin }', '/expenses/{fixtures.team_expense}'),
      ],
      [
        '  as_view_only_team_manager:',
        '    - visit: /dev/impersonate?id={fixtures.view_only_team_manager}',
        ...ORG_RECIPE,
        '  as_finance_admin:',
        '    - visit: /dev/impersonate?id={fixtures.finance_admin}',
      ],
    );
    rulesFor(e, [
      'expense-view-only-team',
      'expense-view-only-org',
      'expense-approve',
      'expense-approve-confirm',
      'expense-mine',
      'expense-team',
    ]);
  },

  /* `expenses` with a local target and nothing kept on this machine. */
  'expenses-local'(m) {
    const e = expenses(m);
    targets(e, ['local:', '  base_url: http://localhost:3000']);
    storyboard(e, []);
    rulesFor(e, []);
  },
};
