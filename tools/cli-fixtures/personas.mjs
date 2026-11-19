/*
 * Fixtures for the lint screens of ADR 0018, slice 1: the `expenses` project
 * of the ADR 0017 screens, whose storyboard now declares who its people are.
 * Each fixture is the same six screens and nine rules with one thing wrong.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from '../../vendor/yaml.js';

/* A blueprint of ~/expenses, made if it is not there, with its sample feature gone. */
function blueprint(m, name, flags = []) {
  const dir = join(m.root, 'expenses');
  mkdirSync(join(dir, '.git'), { recursive: true });
  const wd = (args) => {
    const r = m.wd(args, dir);
    if (r.status !== 0)
      throw new Error(`fixture: walkdown ${args.join(' ')} exited ${r.status}\n${r.stderr}`);
    return r.stdout.trim();
  };
  wd(['blueprints', 'new', name, ...flags]);
  const spec = wd(['where', 'spec', '--blueprint', name]);
  for (const f of readdirSync(join(spec, 'features'))) rmSync(join(spec, 'features', f));
  return { name, spec, wd };
}

const LOCAL = {
  base_url: 'http://localhost:3000',
  fixtures: { expense_submitted: 412, view_only_team_manager: 18, view_only_org_manager: 22 },
};

const TEAM = {
  id: 'view-only-team',
  title: 'View-only team manager',
  setup: [{ visit: '/dev/impersonate?id={fixtures.view_only_team_manager}' }],
};
const ORG = {
  id: 'view-only-org',
  title: 'View-only org manager',
  setup: { recipe: 'as_view_only_org_manager' },
};
const people = () => ({
  personas: [
    {
      id: 'manager',
      title: 'Manager',
      of: 'Client company',
      group: 'customers',
      blurb: 'Runs a team and approves what it spends. Some may only look.',
      uses: 'Expenses app',
      users: [structuredClone(TEAM), structuredClone(ORG)],
    },
    {
      id: 'visitor',
      title: 'Visitor',
      group: 'customers',
      blurb: 'Anyone who reaches the public site.',
    },
  ],
  systems: [{ id: 'platform', title: 'Platform', of: 'Jobs and rules', group: 'hidden' }],
  groups: [
    { id: 'customers', title: 'Customers' },
    { id: 'staff', title: 'Staff' },
    { id: 'hidden', title: 'Out of sight', line: 'heavy' },
  ],
  recipes: {
    as_view_only_org_manager: [
      { post: '/dev/session', fields: { user_id: '{fixtures.view_only_org_manager}' } },
    ],
  },
});

const EXPENSE = '/expenses/{fixtures.expense_submitted}';
/* A screen with a design of its own, so lint asks for no design request. */
const screen = (id, app, anchors) => ({
  id,
  title: id,
  design: `/${id}/20261119.html`,
  app,
  anchors,
});
/* Six screens and twenty-one anchors: the ones every fixture here starts from. */
const screens = () => [
  screen('expense-list', { as: 'manager', path: '/expenses' }, [
    'nav.account',
    'expenses.list',
    'expenses.filter',
    'expenses.total',
  ]),
  screen('expense-team', { as: 'manager.view-only-team', path: EXPENSE }, [
    'expense.title',
    'expense.total',
    'expense.view-only-note',
    'expense.receipt',
  ]),
  screen('expense-org', { as: 'manager.view-only-org', path: EXPENSE }, [
    'expense.org-note',
    'expense.team-name',
    'expense.history',
  ]),
  // Its own step signs out, so lint has nothing to say of the session before it.
  screen('policy', { as: 'visitor', setup: [{ visit: '/dev/sign-out' }], path: '/policy' }, [
    'policy.body',
    'policy.updated',
    'policy.contact',
  ]),
  screen('sign-in', { path: '/sign-in' }, ['sign-in.form', 'sign-in.email', 'sign-in.submit']),
  screen('team-requests', { as: 'manager.view-only-team', path: '/team/requests' }, [
    'requests.list',
    'requests.empty',
    'requests.count',
    'requests.filter',
  ]),
];

/* Nine rules in four stories: as one persona, as two, by a system, and neither. */
const stories = () => [
  {
    file: 'expenses',
    id: 'expenses.view',
    title: 'Viewing an expense',
    statement: 'As a manager, I can open what my team has spent.',
    as: 'manager',
    rules: ['expense-list', 'expense-team', 'expense-org', 'team-requests'],
  },
  {
    file: 'expenses',
    id: 'expenses.sign-in',
    title: 'Signing in',
    statement: 'As anyone with an account, I can sign in.',
    as: ['manager', 'visitor'],
    rules: ['sign-in', 'sign-in'],
  },
  {
    file: 'expenses',
    id: 'expenses.alerts',
    title: 'Overspend alerts',
    statement: 'As a team, we hear when a budget is passed.',
    by: 'platform',
    rules: ['team-requests'],
  },
  {
    file: 'expenses',
    id: 'expenses.policy',
    title: 'The expense policy',
    statement: 'As anyone, I can read the expense policy.',
    rules: ['policy', 'policy'],
  },
];

/* Write a blueprint: its targets, its storyboard, and a feature file per `file`. */
function write(b, { targets = { local: LOCAL }, board, all }) {
  writeFileSync(
    join(b.spec, 'spec.yml'),
    stringify({ blueprint: b.name, runner: { targets } }, { lineWidth: 0 }),
  );
  writeFileSync(join(b.spec, 'storyboard.yml'), stringify(board, { lineWidth: 0 }));
  const files = [...new Set(all.map((s) => s.file))];
  for (const file of files)
    writeFileSync(
      join(b.spec, 'features', `${file}.yml`),
      stringify(
        {
          feature: file,
          stories: all
            .filter((s) => s.file === file)
            .map(({ file: _f, rules, ...story }) => ({
              ...story,
              rules: rules.map((r, i) => {
                const [on, id] = Array.isArray(r) ? r : [r, `${r}-${i + 1}`];
                return {
                  id: `${story.id}.${id}`,
                  statement: `The ${on} screen shows what the story says.`,
                  verify: ['checks'],
                  screens: [on],
                  steps: { then: ['It does'] },
                };
              }),
            })),
        },
        { lineWidth: 0 },
      ),
    );
  b.wd(['hash', '--write', '--blueprint', b.name]);
}

const base = () => ({ board: { screens: screens(), ...people() }, all: stories() });

/* A small sibling: `n` screens of three anchors each, and its rules, with whatever its storyboard says of people. */
function sibling(m, name, { rules, screens: n, anchors, extra }) {
  const b = blueprint(m, name);
  const ids = Array.from({ length: n }, (_, i) => `${name}-${i + 1}`);
  let left = anchors;
  write(b, {
    board: {
      screens: ids.map((id, i) => {
        const take = i === n - 1 ? left : Math.floor(anchors / n);
        left -= take;
        return screen(
          id,
          { path: `/${name}/${i + 1}` },
          Array.from({ length: take }, (_, k) => `${id}.part-${k + 1}`),
        );
      }),
      ...extra,
    },
    all: [
      {
        file: name,
        id: `${name}.claim`,
        title: `Claiming ${name}`,
        statement: `As a manager, I can claim ${name}.`,
        rules: Array.from({ length: rules }, (_, i) => ids[i % n]),
      },
    ],
  });
  return b;
}

export default {
  /* Four faults in what the storyboard declares, among people that hold together. */
  'personas-declared'(m) {
    const f = base();
    f.board.personas[1].group = 'public';
    f.board.personas.push(
      { id: 'finance-admin', of: 'Client company', group: 'staff' },
      { id: 'platform', title: 'Platform team', group: 'staff' },
    );
    f.board.systems.push({
      id: 'bank',
      title: 'Bank',
      group: 'hidden',
      users: [{ id: 'feed', title: 'Bank feed' }],
    });
    // Somebody names the new persona, so the only things said are the four faults.
    f.all[1].as = ['manager', 'visitor', 'finance-admin'];
    write(blueprint(m, 'expenses'), f);
  },

  /* Four blueprints of one project: one declares the people, three name them wrongly. */
  'personas-from'(m) {
    write(blueprint(m, 'expenses', ['--code', 'ex']), base());
    sibling(m, 'travel', {
      rules: 4,
      screens: 3,
      anchors: 9,
      extra: { personas_from: 'checkout' },
    });
    sibling(m, 'mileage', { rules: 3, screens: 2, anchors: 6, extra: { personas_from: 'travel' } });
    sibling(m, 'cards', {
      rules: 5,
      screens: 3,
      anchors: 11,
      extra: {
        personas_from: 'expenses',
        personas: [{ id: 'cardholder', title: 'Cardholder' }],
      },
    });
    // And `checkout`, a blueprint of another project, which `travel` names.
    m.ok(['blueprints', 'new', 'checkout']);
  },

  /* Two blueprints of one project, the second taking its people from the first. No screen draws it. */
  'personas-from-sibling'(m) {
    write(blueprint(m, 'expenses'), base());
    const b = blueprint(m, 'travel');
    const at = (id, as) => screen(id, { as, path: `/travel/${id}` }, [`${id}.title`]);
    write(b, {
      board: {
        personas_from: 'expenses',
        screens: [at('trip-team', 'manager.view-only-team'), at('trip-audit', 'auditor')],
      },
      all: [
        {
          file: 'travel',
          id: 'travel.view',
          title: 'Viewing a trip',
          statement: 'As a manager, I can open a trip.',
          as: 'manager',
          rules: ['trip-team', 'trip-audit'],
        },
      ],
    });
  },

  /* `travel` takes its personas from `expenses`, which this machine has not registered. */
  'personas-from-unread'(m) {
    const b = blueprint(m, 'travel');
    const at = (id, as) =>
      screen(id, { ...(as ? { as } : {}), path: `/travel/${id}` }, [
        `${id}.title`,
        `${id}.body`,
        `${id}.total`,
      ]);
    write(b, {
      board: {
        personas_from: 'expenses',
        screens: [
          at('trip-team', 'manager.view-only-team'),
          at('trip-list', 'manager.view-only-team'),
          at('trip-policy'),
        ],
      },
      all: [
        {
          file: 'travel',
          id: 'travel.view',
          title: 'Viewing a trip',
          statement: 'As a manager, I can open a trip.',
          as: 'manager',
          rules: ['trip-team', 'trip-list'],
        },
        {
          file: 'travel',
          id: 'travel.policy',
          title: 'The travel policy',
          statement: 'As a manager, I can read the travel policy.',
          as: 'manager',
          rules: ['trip-policy', 'trip-policy'],
        },
      ],
    });
  },

  /* Nobody names the visitor, and the review target cannot sign in as the org manager. */
  'persona-unused'(m) {
    const f = base();
    delete f.board.screens[3].app.as;
    f.all[1].as = 'manager';
    write(blueprint(m, 'expenses'), {
      ...f,
      targets: {
        local: LOCAL,
        review: {
          base_url: 'https://review.acme.test',
          fixtures: { expense_submitted: 9, view_only_team_manager: 4 },
        },
      },
    });
  },

  /* Four stories that say who acts or say nothing, and four that name nobody they can. */
  'story-as'(m) {
    const f = base();
    f.board.systems.push({
      id: 'bank',
      title: 'Bank',
      of: 'Outside service',
      group: 'hidden',
      outside: true,
    });
    const more = (id, title, who, rules) => ({
      file: 'expenses',
      id: `expenses.${id}`,
      title,
      statement: `As a team, we can ${id} an expense.`,
      ...who,
      rules,
    });
    f.all.push(
      more('approve', 'Approving', { as: 'approver' }, ['expense-team']),
      more('remind', 'Reminding', { by: 'scheduler' }, ['expense-list']),
      more('export', 'Exporting', { as: 'manager', by: 'platform' }, ['expense-list']),
      more('reimburse', 'Reimbursing', { by: 'bank' }, ['expense-team', 'expense-org']),
    );
    write(blueprint(m, 'expenses'), f);
  },

  /* A visitor's story with a rule on a manager's screen, and a system's story on the same one. */
  'rule-on-anothers-screen'(m) {
    const f = base();
    f.all[0].rules = ['expense-list', 'expense-team', 'expense-org'];
    f.all[2] = {
      file: 'alerts',
      id: 'alerts.overspend',
      title: 'Overspend alerts',
      statement: 'As a team, we hear when a budget is passed.',
      by: 'platform',
      rules: ['team-requests'],
    };
    f.all.push({
      file: 'access',
      id: 'access.request',
      title: 'Asking for access',
      statement: 'As a visitor, I can ask to join a team.',
      as: 'visitor',
      rules: [['team-requests', 'manager-is-told']],
    });
    write(blueprint(m, 'expenses'), f);
  },

  /* Two screens whose `as:` names nobody, and two users whose own setup lint has words for. */
  'screen-as'(m) {
    const f = base();
    const [manager] = f.board.personas;
    manager.users[0].setup.push({ wait_for: 'nav.signed-in' });
    manager.users[1].setup = [
      { post: '/dev/session', fields: { user_id: '{fixtures.view_only_org_manager}' } },
      { click: 'nav.switch-org' },
    ];
    f.board.screens = [
      screen('expense-team', { as: 'manager.view-only-team', path: EXPENSE }, [
        'nav.account',
        'expense.title',
      ]),
      screen('expense-list', { as: 'manager', path: '/expenses' }, ['expense.total']),
      screen('expense-approve', { as: 'finance-admin', path: `${EXPENSE}/approve` }, [
        'approve.confirm',
        'approve.amount',
        'approve.note',
        'approve.cancel',
        'approve.receipt',
      ]),
      screen('expense-org', { as: 'manager.org-admin', path: `${EXPENSE}/org` }, [
        'expense.org-note',
        'expense.team-name',
        'expense.history',
        'expense.owner',
        'expense.status',
      ]),
      f.board.screens[3],
      screen('team-requests', { as: 'manager.view-only-org', path: '/team/requests' }, [
        'requests.list',
        'requests.empty',
        'requests.count',
        'requests.filter',
        'requests.sort',
      ]),
    ];
    f.all[0].rules = ['expense-list', 'expense-team', 'expense-org', 'expense-approve'];
    f.all[1].rules = ['expense-list', 'expense-team'];
    write(blueprint(m, 'expenses'), f);
  },

  /* Two screens nobody signs in as, after one a user does: one signs out first, one does not. */
  'nobody-after-a-user'(m) {
    const f = base();
    const [list, , , policy, signIn] = f.board.screens;
    // The first screen a user signs in for is then expense-team.
    delete list.app.as;
    f.board.screens[3] = { ...policy, id: 'expense-help' };
    f.board.screens[4] = {
      ...signIn,
      id: 'expense-public',
      app: { as: 'visitor', path: '/public' },
    };
    f.all[1].rules = ['expense-public', 'expense-public'];
    f.all[3].rules = ['expense-help', 'expense-help'];
    write(blueprint(m, 'expenses'), f);
  },

  /* Personas with no users at all, and a screen as one: there is no session to be left over. */
  'nobody-signs-in'(m) {
    const f = base();
    delete f.board.personas[0].users;
    delete f.board.recipes;
    for (const s2 of f.board.screens) {
      if (s2.app.as) s2.app.as = String(s2.app.as).split('.')[0];
      delete s2.app.setup;
    }
    write(blueprint(m, 'expenses'), f);
  },

  /* One path three times: as two users, and once with the second user's steps written out. */
  'users-not-a-tie'(m) {
    const f = base();
    f.board.screens[5] = screen(
      'expense-org-by-hand',
      { setup: { recipe: 'as_view_only_org_manager' }, path: EXPENSE },
      ['by-hand.note', 'by-hand.title', 'by-hand.total', 'by-hand.receipt'],
    );
    f.all[0].rules = ['expense-list', 'expense-team', 'expense-org', 'expense-org-by-hand'];
    f.all[2].rules = ['expense-list'];
    write(blueprint(m, 'expenses'), f);
  },
};
