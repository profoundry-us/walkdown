/*
 * What the panel knows before it draws anything: how it was delivered, where
 * it keeps things, and the two holders every other shard reads and writes.
 *
 * These live together because they are one dependency: S.SERVER is derived
 * from the delivery, and STYLESHEET is derived from S.SERVER. Splitting
 * config from state would only buy a cycle.
 *
 * Nothing here has a side effect. That matters more than it looks: Rollup
 * emits this module's body ahead of the panel's own, which means it runs
 * BEFORE the once-per-page guard in index.js has had its say. Building two
 * objects and reading two globals is safe to do twice; creating an element or
 * hanging a listener would not be.
 */
// See the note in embed.js: served as a <script> tag, or handed the same
// answers by the extension's bootstrap on window.__walkdownConfig.
export const script = document.currentScript;
export const cfg = window.__walkdownConfig ?? {};

/*
 * Everything the panel remembers, in one object rather than as three dozen
 * free variables scattered down the file.
 *
 * The reason is the split. A module's exported binding is read-only to
 * whoever imports it, so `view = 'detail'` from another file is a syntax
 * error where `S.view = 'detail'` is not — the holder is what lets any of
 * this state be written from more than one shard. Collecting it has a
 * second effect worth having on its own: the panel's entire memory is now
 * readable in one place instead of being reconstructed from declarations
 * four thousand lines apart.
 *
 * State that never leaves one neighbourhood stayed a plain `let` where it
 * was — the veil's timer, the shot layer, the desk element, `framedPinMode`,
 * `seen` — because those travel with the code that owns them and gain
 * nothing from being global. `S` is for what genuinely crosses.
 *
 * One field is seeded later on purpose: `S.desk` waits for DESK_DEFAULTS,
 * so the defaults stay beside the dials that tune them.
 */
export const S = {
  SERVER: cfg.server ?? new URL(script?.src ?? 'http://localhost:4700').origin,
  BP: cfg.bp ?? script?.dataset.bp ?? '',
  frameUrl: cfg.frame?.url ?? null, // where the app frame actually is

  data: null,
  view: 'list',
  selected: null,
  session: null,
  ghost: null,
  ghostOpacity: 0.5,
  protoShare: null, // 0 = all app, 1 = all prototype; null = follow the page
  pickedScreen: cfg.screen ?? script?.dataset.screen ?? null,
  openThread: null, // the thread expanded in the detail pane, by id

  /*
   * A screen the ghost is pinned to for a moment — viewing a sketch from a
   * thread, say. Kept apart from pickedScreen on purpose: pickedScreen
   * answers "which screen is this page?", and a passing look at another
   * screen's artwork must not rewrite that answer, or the panel spends the
   * rest of the session describing a page you are not on.
   */
  ghostOverride: null,

  /*
   * Which of the three things the panel is doing: finding a server, choosing
   * a blueprint from the ones it found, or reviewing. The first two are not
   * error states — a fresh install genuinely does not know either answer yet.
   */
  phase: 'loading', // loading | connect | choose | ready
  projects: [],
  jumpOnLoad: false, // set when a blueprint is chosen by hand, spent once it has loaded
  servedRoot: null, // the folder the server reports it is serving
  listTab: 'rules', // blueprints | rules | threads — what the side lists

  /*
   * Which threads the Threads tab is showing. The same three questions
   * `walkdown threads` answers at the command line: what is live, what is
   * waiting on me, and everything ever said. Default `active`, because that
   * is the one with work in it - `all` is for going back to a conversation
   * that ended, which is the thing that was impossible before this tab.
   */
  threadFilter: 'active', // active | you | all

  /*
   * What the rule search box says, and what the two note boxes say. Kept out
   * here rather than read off the inputs, because the panes are rebuilt
   * wholesale on every render and a value whose only record was the DOM
   * would forget itself the next time anything else on the panel changed.
   */
  ruleQuery: '',
  threadNote: '', // what the reply box says, kept across re-renders
  verdictNote: '', // the verdict feedback box, kept across re-renders
  ruleNote: '', // the rule's own new-thread box, kept the same way

  /*
   * The check-source disclosure, kept OUTSIDE the markup that draws it.
   *
   * Renders arrive unbidden - the framed surface announcing itself is
   * enough. So a disclosure whose only record of being open was the DOM
   * closed itself a frame later, and the source, fetched meanwhile, was
   * written into a node that had already been thrown away: opened, it said
   * "Loading…" forever (n-0084, n-0057). Both the asking and the answer live
   * here now, keyed by rule, so moving to another rule collapses it again
   * without anything to reset.
   */
  srcOpenFor: null, // the rule whose source is open
  srcCache: { rule: null, view: null },

  ghostWidth: 0, // 0 = fill the stage; otherwise a fixed CSS width
  viewportW: 0, // framed viewport preset: 0 = fit the space, else CSS px

  dragging: false, // whether the pointer is holding one of our own controls
  deskOpen: false, // the desk tuner behind the gear
  screensOpen: false, // the screen picker's list
  hideAppOn: false, // the tuner's "see the full effect" peek
  docked: false, // whether the chrome is out; the × in the bar puts it away

  /*
   * Set when the copy of walkdown inside the ghost announces itself. A
   * prototype carries the embed by contract (docs/06 §4); an app being
   * ghosted from a prototype page may not, and then the ghosted surface
   * simply cannot be pinned. Saying so is the point — the alternative is a
   * pin that lands on the page hidden underneath the one you are looking at.
   */
  ghostReady: false,
  ghostSrc: null, // what the kept ghost copy is showing, so a toggle can reuse it

  headlessCover: null, // the opaque cover a headless rule lays over the desk
};

/*
 * The chrome itself, on a holder for the same reason S exists: these are
 * written once, at build time, from whichever shard ends up owning each
 * element, and an imported binding cannot be assigned.
 *
 * Every field is null until buildChrome() runs. Nothing above the boot
 * sequence at the foot of this file may touch them at module level — that
 * is the property that keeps the shards order-independent, because an
 * import graph decides evaluation order and no shard should care.
 */
export const D = {
  shell: null, // the popover over the whole viewport, host of the shadow root
  sr: null, // that shadow root
  host: null, // the transparent carrier inside it
  bar: null, // the tool bar across the top
  side: null, // the side panel
  deskPanel: null, // the desk tuner behind the gear
  screenPanel: null, // the screen picker's list
  tab: null, // the WALKDOWN pull tab, shown when the chrome is put away
  swap: null, // the prototype/app cross beside it
  appFrame: null, // the application under review
};
/*
 * Whether this delivery comes back after a real page load. The extension
 * says so, because its content script runs on every page; a script tag
 * cannot, because the navigation unloads it. It decides whether a trip the
 * panel wants to make is taken or merely offered.
 */
export const REINJECTS = cfg.reinjects === true;
/*
 * Where the choice of blueprint is remembered. The extension hands us
 * chrome.storage — its own, per-profile, and untouched by a site clearing
 * its data. A page that loaded us from a script tag has already said which
 * blueprint it is, so the localStorage fallback is for a case that in
 * practice never arises.
 */
export const store = cfg.store ?? {
  get: async (k) => {
    try {
      return JSON.parse(localStorage.getItem(k) ?? 'null');
    } catch {
      return null;
    }
  },
  set: async (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};
export const CHOICE = `walkdown:blueprint:${location.origin}`;
// The extension ships the stylesheet itself; served, it comes off the server.
export const STYLESHEET = cfg.stylesheet ?? S.SERVER + '/walkdown.css';

/* The panel's geometry, in pixels. */
export const W = 384; // the side panel
export const TOP = 44; // the tool bar across the top
export const GAP = 12; // how much desk shows around the wrapped page
// Nothing separates the bar from the page any more, so the bar's own bottom
// padding does that job — a second 12px gap on top of it read as a gutter.
export const HEAD = TOP;

/*
 * Identity is two fields, not one (n-0104). Each holds null for "nothing
 * said" - fall back to what the server derived - or the string the person
 * typed, the empty string very much included.
 *
 * `username` is what every record is written under - verdicts, replies,
 * transitions, the draft. It is a handle, it is stable, and it is the only
 * thing the ledger ever sees. `name` is the full name git may or may not
 * know; it is what the panel SHOWS, because "Topher Fangio" reads better
 * than "topher", and it is never what gets recorded, because plenty of
 * people do not have one.
 *
 * Either can be set in Settings, including by someone whose git knows
 * neither - honour system, as asked. Empty means "no override": the field
 * falls back to what the server derived, so clearing a box is how you undo.
 *
 * ACTOR_KEY is the single free-text field this replaces. It is read once, at
 * boot, and migrated into the display name - which is the field it actually
 * held, since it was seeded from `git config user.name`. The username goes
 * back to being derived. Nothing in the ledger is touched: records written
 * under the old value stay exactly as written, and nameMap keeps showing
 * them under one face (see `handles` in the identity payload).
 */
/*
 * `roles` is the third field and the odd one out: it is not a name, it is
 * which hats this person signs in. It lives here because it is the same kind
 * of setting - per person, per machine, said once and remembered - and
 * because a signature's role has to be known before the signature is written.
 * null means nothing said; an empty array means "none of these", which is a
 * different answer and survives the reload the same way an emptied name does.
 */
export const ACTOR_KEY = 'walkdown:actor'; // legacy: one free-text name
export const IDENTITY_KEY = 'walkdown:identity'; // { username, name, roles }
export const identityOverride = { username: null, name: null, roles: null };
export const saveIdentity = () =>
  store.set(IDENTITY_KEY, {
    username: identityOverride.username,
    name: identityOverride.name,
    roles: identityOverride.roles,
  });
